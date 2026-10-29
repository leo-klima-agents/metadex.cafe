import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { encodeAbiParameters, encodeEventTopics, parseAbi, parseAbiParameters, type Address, type Hex } from "viem";
import { blockTime, resetRateLimits, type Call } from "../src/chain.ts";
import { WEEK } from "../src/format.ts";
import { pricesIn, type Token } from "../src/prices.ts";
import {
  BLOCK_TIME,
  blockTimes,
  firstBlockAt,
  firstReached,
  forgetReads,
  paidFor,
  payoutBlocks,
  payouts,
  payoutsIn,
  readEarned,
  readStamps,
  standingOf,
  valueAt,
  waitingWords,
  watchedOf,
  weighed,
  weightAt,
  type Log,
  type Pair,
  type Records,
  type Rewards,
  type Standing,
} from "../src/receipts.ts";

const abi = parseAbi([
  "event CarbonRetired(address indexed creditToken_, uint256 retireTonnes, uint256 kvcmSpent)",
  "event ClaimSwapAndDistributeCompleted(uint256 indexed tokenId, address indexed owner, address indexed recipient, address[] claimedTokens, uint256[] claimedAmounts, address[] distributedTokens, uint256[] distributedAmounts, uint256[] treasuryFees)",
]);
const KVCM: Address = "0x00fBAC94Fec8D4089d3fe979F39454F48c71A65d";
const USDC: Address = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const OWNER: Address = "0x60924601E73EBc5C2Bd9244c788d93e0710a6c93";
const OTHER: Address = "0xa79cd47655156b299762DFE92A67980805ce5a31";
const CREDIT: Address = "0x0000000000000000000000000000000000000c02";

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

// A fake Base for the search: each reward contract's tokenTimestamp for an account and a token, as it moves at given
// blocks, and each block's time. Block times are two seconds apart, from Base's first block, as on Base.
const GENESIS = 1_686_789_347;
const timeOf = (block: number) => GENESIS + BLOCK_TIME * block;
const SEP_17 = 1_789_603_200; // Thu 17 Sep 2026, 00:00 UTC
const OCT_15 = SEP_17 + 4 * WEEK;
const TOP = 52_694_000; // Fri 16 Oct 2026, 18:22 UTC
const PAID = 51_698_051; // Wed 23 Sep 2026, 17:44 UTC
const FEES: Address = "0x59Bcf560Cd567f2eAaE9d7aDfF399E019B54A20d";
const BRIBES: Address = "0x0000000000000000000000000000000000000b1b";
const WETH: Address = "0x4200000000000000000000000000000000000006";

type Move = { id: bigint; pair: Pair; block: number; epoch: number };

function rewards(moves: Move[]) {
  const reads: { block: number; calls: number }[] = [];
  const timed: number[] = [];
  const at = (call: Call, block: number): bigint => {
    if (call === blockTime) return BigInt(timeOf(block));
    const [id, token] = call.args as [bigint, Address];
    const moved = moves.filter(
      (move) =>
        move.id === id && move.pair.contract === call.address && move.pair.token === token && move.block <= block,
    );
    return BigInt(Math.max(0, ...moved.map(({ epoch }) => epoch)));
  };
  const reader = async (calls: Call[], block: number | "latest" = "latest") => {
    const number = block === "latest" ? TOP : block;
    if (calls.every((call) => call === blockTime)) timed.push(number);
    else reads.push({ block: number, calls: calls.length });
    return calls.map((call) => at(call, number));
  };
  return { reader, reads, timed };
}

const fees: Pair = { contract: FEES, token: USDC };
const bribes: Pair = { contract: BRIBES, token: WETH };
const standing = (id: bigint, through = SEP_17, pair = fees): Standing => ({
  id,
  through,
  pair,
  paid: false,
  late: false,
  waiting: [],
  unknown: false,
});

test("one account's last payout, from about 20 reads", async () => {
  const { reader, reads, timed } = rewards([
    { id: 82774n, pair: fees, block: 49_000_000, epoch: SEP_17 - 8 * WEEK },
    { id: 82774n, pair: fees, block: PAID, epoch: SEP_17 },
  ]);
  const found = await payoutBlocks([standing(82774n)], TOP, timeOf(TOP), reader);
  assert.deepEqual([...found], [[82774n, PAID]]);
  assert.ok(reads.length <= 22, `${reads.length} reads`);
  assert.equal(timed.length, 2, "two reads of block times find the epoch's first block");
  assert.ok(
    reads.every(({ block }) => timeOf(block) >= SEP_17 - 1),
    "nothing before the epoch began is read",
  );
  reads.length = timed.length = 0;
  assert.deepEqual([...(await payoutBlocks([standing(82774n)], TOP, timeOf(TOP), reader))], [[82774n, PAID]]);
  assert.equal(reads.length + timed.length, 0, "a block found is kept");
});

test("an epoch's first block, from the blocks' own times, whatever the time between blocks", async () => {
  // Blocks two seconds apart up to block 1,000,000, then one second apart, then three.
  const timeAt = (block: number) =>
    GENESIS +
    2 * Math.min(block, 1_000_000) +
    Math.max(0, Math.min(block, 2_000_000) - 1_000_000) +
    3 * Math.max(0, block - 2_000_000);
  const reads: number[] = [];
  const reader = async (calls: Call[], block: number | "latest" = "latest") => {
    reads.push(Number(block));
    return calls.map(() => BigInt(timeAt(Number(block))));
  };
  const top = 3_000_000;
  for (const block of [10, 999_999, 1_000_000, 1_500_001, 2_000_000, 2_500_000, top]) {
    reads.length = 0;
    const time = timeAt(block);
    assert.equal(await firstBlockAt(time, top, timeAt(top), reader), block, `block ${block}`);
    assert.equal(
      await firstBlockAt(time - 1, top, timeAt(top), reader),
      timeAt(block - 1) >= time - 1 ? block - 1 : block,
    );
    assert.ok(reads.length <= 2 * 26, `${reads.length} reads for block ${block}, in two searches`);
  }
  // Base's blocks, two seconds apart: two reads.
  const { reader: base, timed } = rewards([]);
  assert.equal(await firstBlockAt(SEP_17, TOP, timeOf(TOP), base), (SEP_17 + 1 - GENESIS) / BLOCK_TIME);
  assert.equal(timed.length, 2);
});

test("accounts paid in one block are read together, in one call each step", async () => {
  const ids = [26432n, 82774n, 14247n, 35366n];
  const { reader, reads } = rewards(ids.map((id) => ({ id, pair: fees, block: PAID, epoch: SEP_17 })));
  const found = await payoutBlocks(
    ids.map((id) => standing(id)),
    TOP,
    timeOf(TOP),
    reader,
  );
  assert.deepEqual(
    ids.map((id) => found.get(id)),
    [PAID, PAID, PAID, PAID],
  );
  assert.ok(reads.length <= 22, `${reads.length} reads`);
  assert.ok(reads.every(({ calls }) => calls === 4));
});

test("accounts paid in different blocks, or through different epochs, each get their own", async () => {
  const later = PAID + 1_234;
  const { reader } = rewards([
    { id: 1n, pair: fees, block: PAID, epoch: SEP_17 },
    { id: 2n, pair: bribes, block: later, epoch: SEP_17 },
    { id: 3n, pair: fees, block: PAID, epoch: SEP_17 },
    { id: 3n, pair: bribes, block: TOP - 10, epoch: OCT_15 },
  ]);
  const found = await payoutBlocks(
    [standing(1n), standing(2n, SEP_17, bribes), standing(3n, OCT_15, bribes)],
    TOP,
    timeOf(TOP),
    reader,
  );
  assert.deepEqual(
    [1n, 2n, 3n].map((id) => found.get(id)),
    [PAID, later, TOP - 10],
  );
});

test("an account never paid is not searched, and one whose record never reaches its epoch is left out", async () => {
  const { reader, reads } = rewards([{ id: 7n, pair: fees, block: PAID, epoch: SEP_17 - WEEK }]);
  const never: Standing = { id: 6n, through: 0, paid: false, late: false, waiting: [], unknown: false };
  assert.deepEqual([...(await payoutBlocks([never], TOP, timeOf(TOP), reader))], []);
  assert.equal(reads.length, 0);
  // The standings said it reached Sep 17, but the blocks searched say otherwise, as an RPC behind the others might.
  assert.deepEqual([...(await payoutBlocks([standing(7n)], TOP, timeOf(TOP), reader))], []);
  assert.equal(reads.length, 1, "it is read once, at the last block");
});

test("the first block at which each item has reached what it waits for", async () => {
  const steps = new Map([
    ["a", 105],
    ["b", 105],
    ["c", 180],
    ["d", 1_000],
  ]);
  const blocks: number[] = [];
  const found = await firstReached(
    async (block, items: string[]) => {
      blocks.push(block);
      return items.map((item) => steps.get(item)! <= block);
    },
    ["a", "b", "c", "d"],
    100,
    200,
  );
  assert.deepEqual([...found].sort(), [
    ["a", 105],
    ["b", 105],
    ["c", 180],
  ]);
  assert.equal(blocks[0], 200, "the last block first");
  assert.deepEqual([...(await firstReached(async () => [true], ["a"], 200, 200))], [], "an empty range");
});

const usdc: Token = { address: USDC, decimals: 6, symbol: "USDC" };
const weth: Token = { address: WETH, decimals: 18, symbol: "WETH" };
const tokens = new Map([usdc, weth].map((token) => [token.address.toLowerCase(), token]));

test("what amounts are worth, at the prices of each token", () => {
  const waiting = [
    { contract: FEES, token: USDC, amount: 2_500_000n },
    { contract: BRIBES, token: WETH, amount: 10n ** 15n },
  ];
  const usdcOnly: [string, number] = [USDC.toLowerCase(), 1];
  assert.equal(valueAt(waiting, tokens, pricesIn("USD", [usdcOnly])), 2.5, "WETH has no price here");
  assert.equal(valueAt(waiting, tokens, pricesIn("USD", [usdcOnly, [WETH.toLowerCase(), 4_000]])), 6.5);
  assert.equal(valueAt([{ token: KVCM, amount: 10n ** 18n }], tokens, pricesIn("USD", [[KVCM.toLowerCase(), 1]])), 0);
  const standIn = pricesIn("USD", [usdcOnly]);
  standIn.standIns.set(WETH.toLowerCase(), 4_000);
  assert.equal(valueAt(waiting, tokens, standIn), 2.5, "a stand-in is never shown");
});

// On Fri 16 Oct, in the epoch from Oct 15: last epoch ran from Oct 8, and the one before from Oct 1. Last epoch's
// rewards: $90 of USDC fees, $8 of WETH bribes and $2 of kVCM bribes; the epoch before's, $60 of USDC fees and $40 of
// WETH bribes.
const OCT_8 = OCT_15 - WEEK;
const OCT_1 = OCT_15 - 2 * WEEK;
const kvcmBribes: Pair = { contract: BRIBES, token: KVCM };
const last: Rewards = {
  start: OCT_8,
  pairs: [
    { ...fees, value: 90 },
    { ...bribes, value: 8 },
    { ...kvcmBribes, value: 2 },
  ],
};
const before: Rewards = {
  start: OCT_1,
  pairs: [
    { ...fees, value: 60 },
    { ...bribes, value: 40 },
  ],
};
const both = { last: true, before: true };
const owed: (bigint | undefined)[] = [2_500_000n, 10n ** 15n, 0n];
const of = (records: Partial<Records>, voted = both) =>
  standingOf(1n, last, before, { last: [0, 0, 0], earned: owed, before: [0, 0], ...records }, voted);

test("an epoch is paid once claims since it ended took more than half of what its rewards were worth", () => {
  const end = OCT_15;
  assert.equal(paidFor(last.pairs, [end, 0, 0], end), true, "its largest reward");
  assert.equal(paidFor(last.pairs, [end, end, 0], end), true, "all but a token the operator could not swap");
  assert.equal(paidFor(last.pairs, [OCT_8, end, end], end), false, "a claim of a few small rewards");
  assert.equal(paidFor(before.pairs, [end, 0], OCT_8), true, "claimed after the next epoch ended still counts");
  assert.equal(paidFor(before.pairs, [OCT_1, OCT_1], OCT_8), false, "claimed before it ended");
  assert.equal(paidFor([], [], end), true, "nothing to pay");
  const unpriced = last.pairs.map((pair) => ({ ...pair, value: 0 }));
  assert.equal(paidFor(unpriced, [end, end, 0], end), true, "with no prices, most of the rewards");
  assert.equal(paidFor(unpriced, [end, 0, 0], end), false);
});

test("the rewards watched for a payout: the fewest worth half of all", () => {
  assert.deepEqual(watchedOf(last.pairs), [last.pairs[0]]);
  assert.deepEqual(watchedOf(before.pairs), [before.pairs[0]], "exactly half will do");
  const even = [30, 25, 25, 20].map((value, i) => ({
    contract: BRIBES,
    token: `0x${String(i).repeat(40)}` as Address,
    value,
  }));
  assert.deepEqual(
    watchedOf(even).map(({ value }) => value),
    [30, 25],
  );
  assert.deepEqual(watchedOf([]), []);
});

test("between the flip and the payout, an account is paid up to the start of last epoch", () => {
  const standing = of({ last: [OCT_8, OCT_8, 0], before: [OCT_8, OCT_8] });
  assert.deepEqual(standing, {
    id: 1n,
    through: OCT_8,
    pair: fees,
    paid: false,
    late: false,
    waiting: [
      { contract: FEES, token: USDC, amount: 2_500_000n },
      { contract: BRIBES, token: WETH, amount: 10n ** 15n },
    ],
    unknown: false,
  });
});

test("a claim of a few rewards is not a payout, such as a stranger's through Double Espresso", () => {
  // Its small bribes were claimed since the flip: it is still paid up to Oct 8 only, and its payout is still due.
  const early = of({ last: [OCT_8, OCT_15, OCT_15], before: [OCT_8, OCT_8] });
  assert.deepEqual([early.through, early.paid, early.late], [OCT_8, false, false]);
  // Not paid for the epoch from Oct 1: still late, and paid up to its newest record from before then.
  const late = of({ last: [SEP_17, OCT_15, 0], before: [SEP_17, 0] });
  assert.deepEqual([late.through, late.pair, late.paid, late.late], [SEP_17, fees, false, true]);
});

test("a payout of most of last epoch's rewards pays the account up to the flip", () => {
  const paid = of({ last: [OCT_15, OCT_8, 0], before: [OCT_15, OCT_8] });
  assert.deepEqual([paid.through, paid.pair, paid.paid, paid.late], [OCT_15, fees, true, false]);
  // The payout is found through the reward worth the most among those it claimed.
  const most = of({ last: [OCT_15, OCT_15, OCT_15], before: [OCT_8, OCT_8] });
  assert.deepEqual([most.through, most.pair], [OCT_15, fees]);
});

test("late, never paid, joined since, and what could not be read", () => {
  const never = of({});
  assert.deepEqual([never.through, never.pair, never.late], [0, undefined, true]);
  const joined = of({ last: [OCT_8, 0, 0] }, { last: true, before: false });
  assert.deepEqual([joined.through, joined.paid, joined.late], [OCT_8, false, false], "nothing owed for Oct 1");
  const since = of({ last: [OCT_15, 0, 0] }, { last: false, before: false });
  assert.deepEqual([since.through, since.paid, since.late], [OCT_15, false, false], "its newest record");
  const partly = of({ earned: [3_000_000n, undefined, 0n], before: [OCT_8, OCT_8] });
  assert.deepEqual(partly.waiting, [{ contract: FEES, token: USDC, amount: 3_000_000n }], "at least what was read");
  assert.equal(partly.unknown, true);
});

test("each reward weighed at last epoch's prices, or its stand-in, today's; none for a token without either", () => {
  const rewards = [
    { pool: FEES, contract: FEES, token: usdc, amount: 90_000_000n, fee: true },
    { pool: FEES, contract: BRIBES, token: weth, amount: 10n ** 18n, fee: false },
  ];
  const prices = pricesIn("USD", [[USDC.toLowerCase(), 1]]);
  assert.deepEqual(weighed(rewards, prices), [
    { ...fees, value: 90 },
    { ...bribes, value: 0 },
  ]);
  // WETH had no price at the flip: weighed at today's, it keeps a claim of the USDC alone from passing for a payout.
  prices.standIns.set(WETH.toLowerCase(), 2_500);
  const pairs = weighed(rewards, prices);
  assert.deepEqual(pairs, [
    { ...fees, value: 90 },
    { ...bribes, value: 2_500 },
  ]);
  assert.equal(paidFor(pairs, [OCT_15, 0], OCT_15), false);
});

test("what waits is read in small batches, as each earned() can take a million gas; a failed one is unknown", async () => {
  const batches: { name: string; perBatch: number | undefined }[] = [];
  const reader = async (calls: Call[], _block?: number | "latest", _later?: boolean, perBatch?: number) => {
    batches.push({ name: calls[0]!.functionName, perBatch });
    return calls.map((call, i) => (call.functionName === "earned" ? (i === 1 ? undefined : 5n) : BigInt(SEP_17)));
  };
  const [stamps, earned] = await Promise.all([
    readStamps([1n, 2n], [fees, bribes], TOP, reader),
    readEarned([1n, 2n], [fees, bribes], TOP, reader),
  ]);
  assert.deepEqual(batches, [
    { name: "tokenTimestamp", perBatch: undefined },
    { name: "earned", perBatch: 20 },
  ]);
  assert.deepEqual(stamps, [
    [SEP_17, SEP_17],
    [SEP_17, SEP_17],
  ]);
  assert.deepEqual(earned, [
    [5n, undefined],
    [5n, 5n],
  ]);
});

test("no logs in a payout's block is taken only once no RPC has any", async () => {
  const replies: unknown[][] = [];
  globalThis.fetch = async () => {
    const result = replies.shift() ?? [];
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result }));
  };
  index = 0;
  const log = paidOut(TX, PAID, 82774n, OWNER, [[], []], [[KVCM], [t(5)]], [0n]);
  replies.push([], [log]);
  assert.deepEqual(
    (await payoutsIn([PAID])).map(({ id }) => id),
    [82774n],
    "the RPC behind is passed over",
  );
  replies.push([], [], []);
  assert.deepEqual(await payoutsIn([PAID + 1]), [], "every RPC agrees: a claim made outside Matcha Latte");
  replies.push([paidOut(TX, PAID + 1, 82774n, OWNER, [[], []], [[KVCM], [t(5)]], [0n])]);
  assert.deepEqual(
    (await payoutsIn([PAID + 1])).map(({ id }) => id),
    [82774n],
    "no logs is not kept: the RPCs that had them may not have answered",
  );
  assert.deepEqual(
    (await payoutsIn([PAID])).map(({ id }) => id),
    [82774n],
    "logs found are kept",
  );
});

test("a block's time is read once", async () => {
  const asked: number[] = [];
  globalThis.fetch = async (_, init) => {
    const { params } = JSON.parse(String(init?.body)) as { params: [Hex] };
    asked.push(Number(params[0]));
    const result = { timestamp: `0x${timeOf(Number(params[0])).toString(16)}` };
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result }));
  };
  assert.deepEqual(
    [...(await blockTimes([123_456, 123_457]))],
    [
      [123_456, timeOf(123_456)],
      [123_457, timeOf(123_457)],
    ],
  );
  await blockTimes([123_456]);
  assert.deepEqual(asked, [123_456, 123_457]);
});

const original = globalThis.fetch;
beforeEach(() => {
  resetRateLimits();
  forgetReads();
});
afterEach(() => (globalThis.fetch = original));

test("claims are ranked at a stand-in's price for a token without one then, which is never shown", () => {
  const prices = pricesIn("USD", [[USDC.toLowerCase(), 1]]);
  prices.standIns.set(WETH.toLowerCase(), 4_000);
  const [small, large] = [[{ token: USDC, amount: 2_500_000n }], [{ token: WETH, amount: 10n ** 15n }]];
  assert.equal(valueAt(large, tokens, prices), 0);
  assert.ok(weightAt(large, tokens, prices) > weightAt(small, tokens, prices), "WETH's $4 before USDC's $2.50");
});

test("what waits, in words: its worth says it leaves out tokens without a price, or decimals, that wait too", () => {
  const waiting = [
    { token: USDC, amount: 2_500_000n },
    { token: WETH, amount: 10n ** 15n },
  ];
  const priced = (entries: [string, number][]) => ({ tokens, prices: pricesIn("USD", entries) });
  const both = waitingWords(
    waiting,
    priced([
      [USDC.toLowerCase(), 1],
      [WETH.toLowerCase(), 4_000],
    ]),
  );
  assert.deepEqual(both, { worth: "≈\u00a0$6.50", partial: false, tokens: "2 tokens" });
  const usdcOnly = waitingWords(waiting, priced([[USDC.toLowerCase(), 1]]));
  assert.deepEqual(usdcOnly, { worth: "≈\u00a0$2.50", partial: true, tokens: "2 tokens" });
  assert.deepEqual(waitingWords(waiting, undefined), { partial: false, tokens: "2 tokens" }, "in tokens until priced");
  const kvcm = waitingWords(
    [...waiting, { token: KVCM, amount: 1n }],
    priced([
      [USDC.toLowerCase(), 1],
      [WETH.toLowerCase(), 4_000],
    ]),
  );
  assert.equal(kvcm.partial, true, "kVCM's decimals are not known here");
});
