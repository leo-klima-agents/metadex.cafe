import assert from "node:assert/strict";
import { test } from "node:test";
import { decodeFunctionData, encodeAbiParameters, encodeEventTopics, parseAbi, type Address } from "viem";
import { AUTOMAXI } from "../src/config.ts";
import {
  CLAIM_CALL_GAS,
  SAFE_CLAIM_CALL_GAS,
  claimArgs,
  claimCalls,
  claimGas,
  claimSlip,
  claimTransactions,
  claimedIn,
  paidBy,
  type Owed,
} from "../src/claim.ts";

const FEES: Address = "0x00000000000000000000000000000000000000f1";
const FEES_2: Address = "0x00000000000000000000000000000000000000f2";
const BRIBES: Address = "0x00000000000000000000000000000000000000B1";
const USDC: Address = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const AVNT: Address = "0x696F9436B67233384889472Cd7cD58A6fB5DF4f1";
const OWNER: Address = "0x60924601E73EBc5C2Bd9244c788d93e0710a6c93";

const owed: Owed[] = [
  { contract: FEES, token: USDC, amount: 1_000_000n, fee: true },
  { contract: BRIBES, token: USDC, amount: 520_000n, fee: false },
  { contract: BRIBES, token: AVNT, amount: 2_400_000_000_000_000_000n, fee: false },
  // A contract that owes nothing is left out.
  { contract: FEES_2, token: AVNT, amount: 0n, fee: true },
];

test("a claim passes only the contracts and tokens that owe something", () => {
  assert.deepEqual(claimArgs({ id: 9540n, owed }), [9540n, [FEES], [BRIBES], [USDC, AVNT]]);
  // Written separately from src/claim.ts, from AutoMaxi's verified source on Sourcify.
  const abi = parseAbi([
    "function claim(uint256 tokenId, address[] feeAddresses, address[] bribeAddresses, address[] tokens) returns (uint256[] amounts)",
  ]);
  const slip = claimSlip({ id: 9540n, owed }, new Map());
  assert.equal(slip.to, AUTOMAXI.address);
  assert.deepEqual(decodeFunctionData({ abi, data: slip.data }).args, [9540n, [FEES], [BRIBES], [USDC, AVNT]]);
});

test("AutoMaxi takes 1% of what each token brings, rounded down, and pays the rest", () => {
  assert.deepEqual(paidBy(owed), [
    { token: USDC, earned: 1_520_000n, fee: 15_200n, paid: 1_504_800n },
    { token: AVNT, earned: 2_400_000_000_000_000_000n, fee: 24_000_000_000_000_000n, paid: 2_376_000_000_000_000_000n },
  ]);
  assert.deepEqual(paidBy([{ contract: FEES, token: USDC, amount: 99n, fee: true }]), [
    { token: USDC, earned: 99n, fee: 0n, paid: 99n },
  ]);
});

test("a claim's receipt reads its Claimed event, and says so when the keeper's claim came first", () => {
  const abi = parseAbi([
    "event Claimed(uint256 indexed tokenId, address indexed owner, address indexed caller, address[] tokens, uint256[] amounts, uint256[] fees, uint256 previousClaimBlock)",
  ]);
  const log = (amounts: bigint[], fees: bigint[], caller: Address = OWNER) => ({
    address: AUTOMAXI.address,
    topics: encodeEventTopics({
      abi,
      eventName: "Claimed",
      args: { tokenId: 9540n, owner: OWNER, caller },
    }) as `0x${string}`[],
    data: encodeAbiParameters(
      [{ type: "address[]" }, { type: "uint256[]" }, { type: "uint256[]" }, { type: "uint256" }],
      [[USDC, AVNT], amounts, fees, 0n],
    ),
  });
  const receipt = (logs: ReturnType<typeof log>[]) => ({
    transactionHash: "0x01" as const,
    status: "0x1" as const,
    logs,
  });
  assert.deepEqual(claimedIn([receipt([log([1_520_000n, 0n], [15_200n, 0n])])], [9540n], OWNER), [
    {
      id: 9540n,
      received: [{ token: USDC, amount: 1_520_000n }],
      fees: [{ token: USDC, amount: 15_200n }],
      paid: [{ token: USDC, amount: 1_504_800n }],
    },
  ]);
  assert.deepEqual(claimedIn([receipt([log([0n, 0n], [0n, 0n])])], [9540n], OWNER), [
    { id: 9540n, received: [], fees: [], paid: [] },
  ]);
  // Another caller's claim, as the keeper's, is not the page's own.
  assert.deepEqual(claimedIn([receipt([log([5n, 0n], [0n, 0n], AVNT)])], [9540n], OWNER), []);
});

// A contract at an address of its number, and a token at another.
const contract = (n: number): Address => `0x${n.toString(16).padStart(40, "0")}`;
const token = (n: number): Address => `0x${(n + 0x1000).toString(16).padStart(40, "0")}`;

test("a claim that fits one call stays one, as claimArgs gives it", () => {
  const calls = claimCalls({ id: 9540n, owed });
  assert.equal(calls.length, 1);
  assert.deepEqual(claimArgs(calls[0]!), claimArgs({ id: 9540n, owed }));
  assert.equal(
    claimSlip(calls[0]!, new Map()).says,
    "Claims #9540's rewards through AutoMaxi, which pays them to you, less 1%.",
  );
});

test("a claim too large for one transaction is split into calls that each fit, each contract asked for its own tokens", () => {
  // As #82774's on a fork of Base: 71 contracts, each owing one or two of 37 tokens.
  const many: Owed[] = Array.from({ length: 71 }, (_, i) => [
    { contract: contract(i), token: token(i % 37), amount: 1n, fee: i % 2 === 0 },
    ...(i % 3 === 0 ? [{ contract: contract(i), token: token((i + 1) % 37), amount: 2n, fee: i % 2 === 0 }] : []),
  ]).flat();
  assert.ok(claimGas(many) > 1_000_000_000n, "asked of every contract for every token, it would need a billion gas");
  const calls = claimCalls({ id: 82774n, owed: many });
  assert.ok(calls.length > 1);
  for (const { owed } of calls) assert.ok(claimGas(owed) <= CLAIM_CALL_GAS);
  // Every pair is claimed once.
  const pairs = (list: Owed[]) => list.map(({ contract, token }) => `${contract} ${token}`).sort();
  assert.deepEqual(pairs(calls.flatMap(({ owed }) => owed)), pairs(many));
  // A contract's tokens stay together.
  for (let i = 0; i < 71; i++)
    assert.equal(calls.filter(({ owed }) => owed.some((o) => o.contract === contract(i))).length, 1);
  assert.match(
    claimSlip(calls[0]!, new Map(), false).says,
    /^Claims #82774's rewards from \d+ reward contracts? through AutoMaxi/,
  );
});

test("contracts that owe the same tokens share a call, and one that owes too many for one call is asked in several", () => {
  const same: Owed[] = [1, 2, 3].map((i) => ({ contract: contract(i), token: token(0), amount: 1n, fee: true }));
  assert.equal(claimCalls({ id: 1n, owed: same }).length, 1);
  const wide: Owed[] = Array.from({ length: 40 }, (_, i) => ({
    contract: contract(9),
    token: token(i),
    amount: 1n,
    fee: false,
  }));
  const calls = claimCalls({ id: 1n, owed: wide });
  assert.ok(calls.length > 1);
  for (const { owed } of calls) assert.ok(claimGas(owed) <= CLAIM_CALL_GAS);
  assert.equal(
    calls.reduce((n, { owed }) => n + owed.length, 0),
    40,
  );
});

test("for a Safe, a claim splits into small calls that ask each contract only for the tokens it owes", () => {
  const many: Owed[] = Array.from({ length: 71 }, (_, i) => [
    { contract: contract(i), token: token(i % 37), amount: 1n, fee: i % 2 === 0 },
    ...(i % 3 === 0 ? [{ contract: contract(i), token: token((i + 1) % 37), amount: 2n, fee: i % 2 === 0 }] : []),
  ]).flat();
  const calls = claimCalls({ id: 82774n, owed: many }, SAFE_CLAIM_CALL_GAS);
  const pairs = (list: Owed[]) => list.map(({ contract, token }) => `${contract} ${token}`).sort();
  assert.deepEqual(pairs(calls.flatMap(({ owed }) => owed)), pairs(many));
  // AutoMaxi asks each contract of a call for each of its tokens: none of those pairs owes nothing.
  for (const { owed } of calls) {
    const contracts = new Set(owed.map(({ contract }) => contract));
    const tokens = new Set(owed.map(({ token }) => token));
    assert.equal(contracts.size * tokens.size, owed.length);
  }
  assert.ok(calls.length > claimCalls({ id: 82774n, owed: many }).length);
});

test("a Safe proposes a split claim's calls in as few Safe transactions as their gas allows, in order", () => {
  const million = 1_000_000n;
  // Twelve calls that need about two million gas each fit two Safe transactions of at most 15 million.
  assert.deepEqual(claimTransactions(Array.from({ length: 12 }, () => 2n * million)), [7, 5]);
  // One that fits nowhere else starts a transaction of its own, and the next ones join it if they fit.
  assert.deepEqual(claimTransactions([12n * million, 4n * million, 2n * million, 14n * million]), [1, 2, 1]);
  // Calls that fit one transaction together stay in one.
  assert.deepEqual(claimTransactions([3n * million, 5n * million]), [2]);
});

test("the receipt of a claim split into calls sums their Claimed events", () => {
  const abi = parseAbi([
    "event Claimed(uint256 indexed tokenId, address indexed owner, address indexed caller, address[] tokens, uint256[] amounts, uint256[] fees, uint256 previousClaimBlock)",
  ]);
  const log = (tokens: Address[], amounts: bigint[], fees: bigint[]) => ({
    address: AUTOMAXI.address,
    topics: encodeEventTopics({
      abi,
      eventName: "Claimed",
      args: { tokenId: 82774n, owner: OWNER, caller: OWNER },
    }) as `0x${string}`[],
    data: encodeAbiParameters(
      [{ type: "address[]" }, { type: "uint256[]" }, { type: "uint256[]" }, { type: "uint256" }],
      [tokens, amounts, fees, 0n],
    ),
  });
  const receipt = (logs: ReturnType<typeof log>[]) => ({
    transactionHash: "0x01" as const,
    status: "0x1" as const,
    logs,
  });
  assert.deepEqual(
    claimedIn(
      [receipt([log([USDC, AVNT], [100n, 7n], [1n, 0n])]), receipt([log([USDC], [200n], [2n])])],
      [82774n],
      OWNER,
    ),
    [
      {
        id: 82774n,
        received: [
          { token: USDC, amount: 300n },
          { token: AVNT, amount: 7n },
        ],
        fees: [{ token: USDC, amount: 3n }],
        paid: [
          { token: USDC, amount: 297n },
          { token: AVNT, amount: 7n },
        ],
      },
    ],
  );
});
