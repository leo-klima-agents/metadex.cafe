import assert from "node:assert/strict";
import { test } from "node:test";
import { encodeAbiParameters, encodeEventTopics, parseAbiParameters, type Address, type Hex } from "viem";
import { claimsOf, type Claimed } from "../src/claim.ts";
import { ABI, DOUBLE_ESPRESSO, MATCHA_LATTE } from "../src/config.ts";
import { WEEK } from "../src/format.ts";
import { firstReached, paidFor, payoutsOf, standingOf, walkClaims, watchedOf } from "../src/payouts.ts";
import type { Log } from "../src/rpc.ts";

const address = (n: number) => `0x${n.toString(16).padStart(40, "0")}` as Address;
const pair = (n: number, value: number) => ({ contract: address(n), token: address(100 + n), value });
const LAST = 1_792_022_400;
const last = { start: LAST, pairs: [pair(1, 60), pair(2, 30), pair(3, 10)] };
const before = { start: LAST - WEEK, pairs: [pair(4, 100)] };
const voted = { last: true, before: true };

test("paid once claims since the end took more than half the worth; watched, the fewest worth half", () => {
  assert.equal(paidFor(last.pairs, [LAST + WEEK, 0, 0], LAST + WEEK), true);
  assert.equal(paidFor(last.pairs, [0, LAST + WEEK, LAST + WEEK], LAST + WEEK), false, "a few small rewards");
  assert.equal(paidFor([pair(1, 0), pair(2, 0)], [LAST + WEEK, 0], LAST + WEEK), false, "without prices, by count");
  assert.deepEqual(watchedOf(last.pairs), [pair(1, 60)]);
});

test("standing: paid for last epoch, between the flip and the payout, late, and what waits", () => {
  const paid = standingOf(
    1n,
    last,
    before,
    { last: [LAST + WEEK, 0, 0], earned: [0n, 5n, undefined], before: [LAST] },
    voted,
  );
  assert.deepEqual([paid.through, paid.pair?.contract, paid.paid, paid.late], [LAST + WEEK, address(1), true, false]);
  assert.deepEqual([paid.waiting, paid.unknown], [[{ contract: address(2), token: address(102), amount: 5n }], true]);
  const between = standingOf(1n, last, before, { last: [LAST, LAST, 0], earned: [1n, 1n, 1n], before: [LAST] }, voted);
  assert.deepEqual([between.through, between.paid, between.late], [LAST, false, false]);
  const late = standingOf(1n, last, before, { last: [0, 0, 0], earned: [], before: [LAST - WEEK] }, voted);
  assert.deepEqual([late.through, late.late], [LAST - WEEK, true]);
});

test("the first block at which each item reached what it waits for, items reaching it together read together", async () => {
  const at = new Map([
    ["a", 5],
    ["b", 5],
    ["c", 9],
    ["d", 99],
  ]);
  const asked: number[] = [];
  const found = await firstReached(
    async (block, items: string[]) => (asked.push(items.length), items.map((item) => block >= at.get(item)!)),
    [...at.keys()],
    0,
    16,
  );
  assert.deepEqual([...found].sort(), [
    ["a", 5],
    ["b", 5],
    ["c", 9],
  ]);
  assert.ok(asked.length < 12, `${asked.length} reads`);
});

const claimLog = (id: bigint, block: number, previous: number, amount: bigint): Log => ({
  address: DOUBLE_ESPRESSO.address,
  topics: encodeEventTopics({
    abi: ABI.doubleEspresso,
    eventName: "Claimed",
    args: { tokenId: id, owner: address(1), caller: address(2) },
  }) as Hex[],
  data: encodeAbiParameters(parseAbiParameters("address[], uint256[], uint256[], uint256"), [
    [address(3)],
    [amount],
    [0n],
    BigInt(previous),
  ]),
  transactionHash: `0x${block.toString(16).padStart(64, "0")}`,
  blockNumber: `0x${block.toString(16)}`,
  logIndex: "0x0",
});

test("an account's claims, newest first, back to its last claim's epoch, at most so many blocks", async () => {
  const all = claimsOf([
    claimLog(1n, 400, 0, 5n),
    claimLog(1n, 1_000, 400, 0n),
    claimLog(1n, 1_500, 1_000, 1n),
    claimLog(2n, 1_500, 0, 7n),
  ]);
  const reads: number[] = [];
  const claimsAt = async (block: number, ids: bigint[]): Promise<Claimed[]> => {
    reads.push(block);
    return all.filter((claim) => claim.block === block && ids.includes(claim.id));
  };
  const starts = new Map([
    [1n, { from: 1_500, since: 900 }],
    [2n, { from: 1_500, since: 0 }],
    [3n, { from: 0, since: 0 }],
  ]);
  const walks = await walkClaims(starts, claimsAt);
  assert.deepEqual(
    walks.get(1n)!.claims.map(({ block }) => block),
    [1_500],
    "a claim of nothing moved nothing",
  );
  assert.deepEqual(reads, [1_500, 1_000], "accounts in one block share its read; never claimed reads nothing");
  assert.equal((await walkClaims(new Map([[1n, { from: 1_500, since: 0 }]]), claimsAt, 2)).get(1n)!.stopped, true);
});

test("Matcha Latte's payout, with the retirement before it in the same transaction", () => {
  const tx = `0x${"ab".repeat(32)}` as Hex;
  const at = (topics: Hex[], data: Hex, logIndex: Hex): Log => ({
    address: MATCHA_LATTE.address,
    topics,
    data,
    transactionHash: tx,
    blockNumber: "0x10",
    logIndex,
  });
  const retired = at(
    encodeEventTopics({
      abi: ABI.matchaLatte,
      eventName: "CarbonRetired",
      args: { creditToken_: address(9) },
    }) as Hex[],
    encodeAbiParameters(parseAbiParameters("uint256, uint256"), [3n, 40n]),
    "0x1",
  );
  const paid = at(
    encodeEventTopics({
      abi: ABI.matchaLatte,
      eventName: "ClaimSwapAndDistributeCompleted",
      args: { tokenId: 7n, owner: address(1), recipient: address(1) },
    }) as Hex[],
    encodeAbiParameters(parseAbiParameters("address[], uint256[], address[], uint256[], uint256[]"), [
      [address(3)],
      [10n],
      [address(4)],
      [60n],
      [0n],
    ]),
    "0x2",
  );
  const [payout] = payoutsOf([paid, retired]);
  assert.deepEqual(
    [payout!.id, payout!.tonnes, payout!.retiredKvcm, payout!.paid, payout!.fees],
    [7n, 3n, 40n, [{ token: address(4), amount: 60n }], []],
  );
});
