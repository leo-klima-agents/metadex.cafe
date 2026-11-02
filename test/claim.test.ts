import assert from "node:assert/strict";
import { test } from "node:test";
import { decodeFunctionData, encodeAbiParameters, encodeEventTopics, parseAbi, type Address } from "viem";
import { DOUBLE_ESPRESSO } from "../src/config.ts";
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
  type Claim,
} from "../src/claim.ts";

const FEES: Address = "0x00000000000000000000000000000000000000f1";
const BRIBES: Address = "0x00000000000000000000000000000000000000B1";
const USDC: Address = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const AVNT: Address = "0x696F9436B67233384889472Cd7cD58A6fB5DF4f1";
const OWNER: Address = "0x60924601E73EBc5C2Bd9244c788d93e0710a6c93";
type Owed = Claim["owed"][number];

const owed: Owed[] = [
  { contract: FEES, token: USDC, amount: 1_000_000n, fee: true, passes: 1 },
  { contract: BRIBES, token: USDC, amount: 520_000n, fee: false, passes: 1 },
  { contract: BRIBES, token: AVNT, amount: 2_400_000_000_000_000_000n, fee: false, passes: 1 },
  { contract: "0x00000000000000000000000000000000000000f2", token: AVNT, amount: 0n, fee: true, passes: 1 },
];
// Contracts and tokens at addresses made from their numbers. `many` has the shape of account #82774's claim on a fork:
// 71 contracts, 37 tokens.
const contract = (n: number): Address => `0x${n.toString(16).padStart(40, "0")}`;
const token = (n: number): Address => contract(n + 0x1000);
const owe = (contract: Address, token: Address, fee = false): Owed => ({ contract, token, amount: 1n, fee, passes: 1 });
const many = Array.from({ length: 71 }, (_, i) =>
  (i % 3 ? [i] : [i, i + 1]).map((t) => owe(contract(i), token(t % 37), i % 2 === 0)),
).flat();
const pairs = (calls: { owed: Owed[] }[]) =>
  calls.flatMap(({ owed }) => owed.map(({ contract, token }) => `${contract} ${token}`)).sort();

test("a claim that fits one call passes only the contracts and tokens that owe something", () => {
  const calls = claimCalls({ id: 9540n, owed });
  assert.equal(calls.length, 1);
  assert.deepEqual(claimArgs(calls[0]!), [9540n, [FEES], [BRIBES], [USDC, AVNT]]);
  const abi = parseAbi([
    "function claim(uint256 tokenId, address[] feeAddresses, address[] bribeAddresses, address[] tokens) returns (uint256[] amounts)",
  ]);
  const slip = claimSlip({ id: 9540n, owed }, new Map());
  assert.equal(slip.to, DOUBLE_ESPRESSO.address);
  assert.deepEqual(decodeFunctionData({ abi, data: slip.data }).args, [9540n, [FEES], [BRIBES], [USDC, AVNT]]);
  assert.equal(slip.says, "Claims account #9540's rewards through Double Espresso, which pays them to you, less 1%.");
});

test("a contract owing past the 50 epochs one asking reads is listed, and costed, once for each asking", () => {
  const twice: Owed[] = [
    { contract: FEES, token: USDC, amount: 1n, fee: true, passes: 1 },
    { contract: BRIBES, token: USDC, amount: 1n, fee: false, passes: 2 },
  ];
  assert.deepEqual(claimArgs({ id: 1n, owed: twice }), [1n, [FEES], [BRIBES, BRIBES], [USDC]]);
  assert.equal(
    claimGas(twice),
    claimGas([twice[0]!, owe(BRIBES, USDC), owe(contract(7), USDC)]),
    "as a third contract",
  );
  const { fields, says } = claimSlip({ id: 1n, owed: twice }, new Map(), false);
  assert.match(says, /from 2 reward contracts/);
  assert.deepEqual(
    fields.map(({ description }) => description),
    [
      undefined,
      "Pools' fees contracts that owe it",
      "Pools' incentives contracts that owe it; twice where one asking cannot reach all it owes",
      undefined,
    ],
  );
});

test("Double Espresso takes 1% of what each token brings, rounded down, and pays the rest", () => {
  assert.deepEqual(paidBy(owed), [
    { token: USDC, earned: 1_520_000n, fee: 15_200n, paid: 1_504_800n },
    { token: AVNT, earned: 2_400_000_000_000_000_000n, fee: 24_000_000_000_000_000n, paid: 2_376_000_000_000_000_000n },
  ]);
  assert.deepEqual(paidBy([{ token: USDC, amount: 99n }]), [{ token: USDC, earned: 99n, fee: 0n, paid: 99n }]);
});

test("a claim too large for one call splits into calls that fit, each contract's tokens kept together", () => {
  assert.ok(claimGas(many) > 1_000_000_000n);
  const calls = claimCalls({ id: 82774n, owed: many });
  assert.ok(calls.length > 1);
  for (const { owed } of calls) assert.ok(claimGas(owed) <= CLAIM_CALL_GAS);
  assert.deepEqual(pairs(calls), pairs([{ owed: many }]));
  for (let i = 0; i < 71; i++)
    assert.equal(calls.filter(({ owed }) => owed.some((o) => o.contract === contract(i))).length, 1);
  assert.match(
    claimSlip(calls[0]!, new Map(), false).says,
    /^Claims account #82774's rewards from \d+ reward contracts? through/,
  );
});

test("contracts owing the same tokens share a call; one owing too many is asked in several", () => {
  assert.equal(claimCalls({ id: 1n, owed: [1, 2, 3].map((i) => owe(contract(i), token(0))) }).length, 1);
  const calls = claimCalls({ id: 1n, owed: Array.from({ length: 40 }, (_, i) => owe(contract(9), token(i))) });
  assert.ok(calls.length > 1);
  for (const { owed } of calls) assert.ok(claimGas(owed) <= CLAIM_CALL_GAS);
  assert.equal(pairs(calls).length, 40);
});

test("for a Safe, a claim splits into more, smaller calls, none asking a contract for a token it does not owe", () => {
  const calls = claimCalls({ id: 82774n, owed: many }, SAFE_CLAIM_CALL_GAS);
  assert.deepEqual(pairs(calls), pairs([{ owed: many }]));
  for (const call of calls) {
    const [, fees, bribes, tokens] = claimArgs(call);
    assert.equal((fees.length + bribes.length) * tokens.length, call.owed.length);
  }
  assert.ok(calls.length > claimCalls({ id: 82774n, owed: many }).length);
});

test("a Safe sends a split claim's calls in as few transactions as their gas allows, in order", () => {
  const million = 1_000_000n;
  assert.deepEqual(claimTransactions(Array.from({ length: 12 }, () => 2n * million)), [7, 5]);
  assert.deepEqual(claimTransactions([12n * million, 4n * million, 2n * million, 14n * million]), [1, 2, 1]);
  assert.deepEqual(claimTransactions([3n * million, 5n * million]), [2]);
});

test("a claim's receipts sum the page's own Claimed events, and none when another caller came first", () => {
  const abi = parseAbi([
    "event Claimed(uint256 indexed tokenId, address indexed owner, address indexed caller, address[] tokens, uint256[] amounts, uint256[] fees, uint256 previousClaimBlock)",
  ]);
  const receipt = (tokens: Address[], amounts: bigint[], fees: bigint[], caller = OWNER) => ({
    logs: [
      {
        address: DOUBLE_ESPRESSO.address,
        topics: encodeEventTopics({
          abi,
          eventName: "Claimed",
          args: { tokenId: 9540n, owner: OWNER, caller },
        }) as `0x${string}`[],
        data: encodeAbiParameters(
          [{ type: "address[]" }, { type: "uint256[]" }, { type: "uint256[]" }, { type: "uint256" }],
          [tokens, amounts, fees, 0n],
        ),
      },
    ],
  });
  const split = [receipt([USDC, AVNT], [100n, 7n], [1n, 0n]), receipt([USDC], [200n], [2n])];
  assert.deepEqual(claimedIn(split, [9540n], OWNER), [
    {
      id: 9540n,
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
  ]);
  assert.deepEqual(claimedIn([receipt([USDC, AVNT], [0n, 0n], [0n, 0n])], [9540n], OWNER), [
    { id: 9540n, received: [], fees: [], paid: [] },
  ]);
  assert.deepEqual(claimedIn([receipt([USDC], [5n], [0n], AVNT)], [9540n], OWNER), []);
});
