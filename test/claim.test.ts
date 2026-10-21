import assert from "node:assert/strict";
import { test } from "node:test";
import { decodeFunctionData, encodeAbiParameters, encodeEventTopics, parseAbi, type Address } from "viem";
import { AUTOMAXI } from "../src/config.ts";
import { claimArgs, claimSlip, claimedIn, paidBy, type Owed } from "../src/claim.ts";

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
