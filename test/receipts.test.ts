import assert from "node:assert/strict";
import { test } from "node:test";
import { encodeAbiParameters, encodeEventTopics, parseAbi, parseAbiParameters, type Address, type Hex } from "viem";
import { changes, lastChange, payouts, type Log } from "../src/receipts.ts";

const abi = parseAbi([
  "event CarbonRetired(address indexed creditToken_, uint256 retireTonnes, uint256 kvcmSpent)",
  "event ClaimSwapAndDistributeCompleted(uint256 indexed tokenId, address indexed owner, address indexed recipient, address[] claimedTokens, uint256[] claimedAmounts, address[] distributedTokens, uint256[] distributedAmounts, uint256[] treasuryFees)",
]);
const KVCM: Address = "0x00fBAC94Fec8D4089d3fe979F39454F48c71A65d";
const USDC: Address = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const OWNER: Address = "0x60924601E73EBc5C2Bd9244c788d93e0710a6c93";
const OTHER: Address = "0xa79cd47655156b299762DFE92A67980805ce5a31";
const CREDIT: Address = "0x0000000000000000000000000000000000000c02";

// A total retired that steps up at the given blocks, read one block at a time.
function counter(steps: number[]) {
  const reads: number[] = [];
  const at = async (block: number) => {
    reads.push(block);
    return BigInt(steps.filter((step) => step <= block).length);
  };
  return { at, reads };
}

test("the stretch where a total that only grows last changed, in a few reads", async () => {
  const { at, reads } = counter([1_000, 51_698_051]);
  const found = await lastChange(at, 51_000_000, 52_694_000, 1n, 2n, 100);
  assert.ok(found.lower < 51_698_051 && 51_698_051 <= found.upper, `${found.lower} to ${found.upper}`);
  assert.ok(found.upper - found.lower <= 100);
  assert.equal(found.below, 1n);
  assert.ok(reads.length <= 15, `${reads.length} reads`);
});

test("each stretch in which the total changed, and none where it is the same at both ends", async () => {
  const steps = [100, 105, 160, 900];
  const { at } = counter(steps);
  const stretches = await changes(at, 50, 1_000, await at(50), await at(1_000), 10);
  for (const [first, last] of stretches) {
    assert.ok(last - first < 10, `${first} to ${last}`);
    assert.ok(
      steps.some((step) => first <= step && step <= last),
      `${first} to ${last} holds no change`,
    );
  }
  for (const step of steps)
    assert.equal(stretches.filter(([first, last]) => first <= step && step <= last).length, 1, `${step}`);
  const { at: flat, reads } = counter([10]);
  assert.deepEqual(await changes(flat, 50, 200, 1n, 1n, 10), []);
  assert.deepEqual(reads, []);
});

let index = 0;
const at = (tx: Hex, block: number) => ({
  transactionHash: tx,
  blockNumber: `0x${block.toString(16)}` as Hex,
  logIndex: `0x${(index++).toString(16)}` as Hex,
});

function retired(tx: Hex, block: number, tonnes: bigint, kvcm: bigint): Log {
  return {
    topics: encodeEventTopics({ abi, eventName: "CarbonRetired", args: { creditToken_: CREDIT } }) as [Hex, ...Hex[]],
    data: encodeAbiParameters(parseAbiParameters("uint256, uint256"), [tonnes, kvcm]),
    ...at(tx, block),
  };
}

type Tokens = [Address[], bigint[]];
function paidOut(
  tx: Hex,
  block: number,
  id: bigint,
  owner: Address,
  claimed: Tokens,
  paid: Tokens,
  fees: bigint[],
): Log {
  return {
    topics: encodeEventTopics({
      abi,
      eventName: "ClaimSwapAndDistributeCompleted",
      args: { tokenId: id, owner, recipient: owner },
    }) as [Hex, ...Hex[]],
    data: encodeAbiParameters(parseAbiParameters("address[], uint256[], address[], uint256[], uint256[]"), [
      ...claimed,
      ...paid,
      fees,
    ]),
    ...at(tx, block),
  };
}

const TX = `0x${"09".repeat(32)}` as Hex;
const t = (n: number) => BigInt(Math.round(n * 1e6)) * 10n ** 12n;

test("each account's payout, with the retirement just before it in the same transaction", () => {
  index = 0;
  const logs = [
    retired(TX, 51_698_051, t(65.26), t(326.8)),
    paidOut(
      TX,
      51_698_051,
      82774n,
      OWNER,
      [
        [USDC, KVCM],
        [12_000_000n, 0n],
      ],
      [
        [KVCM, USDC],
        [t(727.11), 0n],
      ],
      [0n, 0n],
    ),
    paidOut(TX, 51_698_051, 14247n, OTHER, [[], []], [[KVCM], [t(5)]], [t(0.05)]),
  ];
  const found = payouts([...logs].reverse());
  assert.deepEqual(
    found.map(({ id, owner, block, tonnes, retiredKvcm, earned, paid, fees }) => ({
      id,
      owner,
      block,
      tonnes,
      retiredKvcm,
      earned,
      paid,
      fees,
    })),
    [
      {
        id: 82774n,
        owner: OWNER,
        block: 51_698_051,
        tonnes: t(65.26),
        retiredKvcm: t(326.8),
        earned: [{ token: USDC, amount: 12_000_000n }],
        paid: [{ token: KVCM, amount: t(727.11) }],
        fees: [],
      },
      {
        id: 14247n,
        owner: OTHER,
        block: 51_698_051,
        tonnes: 0n,
        retiredKvcm: 0n,
        earned: [],
        paid: [{ token: KVCM, amount: t(5) }],
        fees: [{ token: KVCM, amount: t(0.05) }],
      },
    ],
    "in the order of the logs, whatever order they come in, and a retirement only for the account it precedes",
  );
  assert.equal(found[0]!.tx, TX);
});
