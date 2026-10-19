import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { encodeAbiParameters, encodeEventTopics, parseAbi, parseAbiParameters, type Address, type Hex } from "viem";
import { resetRateLimits, type Call } from "../src/chain.ts";
import { WEEK } from "../src/format.ts";
import type { Token } from "../src/prices.ts";
import {
  BLOCK_TIME,
  blockTimes,
  changes,
  dollars,
  firstReached,
  isLate,
  lastChange,
  payoutBlocks,
  payouts,
  standingsOf,
  type Log,
  type Pair,
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

// A total retired that goes up by one at each of the given blocks.
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

// A fake Base for the search: each reward contract's tokenTimestamp for an account and a token, as it moves at given
// blocks. Block times are two seconds apart, from Base's first block, as on Base.
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
  const at = (call: Call, block: number): bigint => {
    const [id, token] = call.args as [bigint, Address];
    const moved = moves.filter(
      (move) =>
        move.id === id && move.pair.contract === call.address && move.pair.token === token && move.block <= block,
    );
    return BigInt(Math.max(0, ...moved.map(({ epoch }) => epoch)));
  };
  const reader = async (calls: Call[], block: number | "latest" = "latest") => {
    const number = block === "latest" ? TOP : block;
    reads.push({ block: number, calls: calls.length });
    return calls.map((call) => at(call, number));
  };
  return { reader, reads };
}

const fees: Pair = { contract: FEES, token: USDC };
const bribes: Pair = { contract: BRIBES, token: WETH };
const standing = (id: bigint, through = SEP_17, pair = fees): Standing => ({ id, through, pair, waiting: [] });

test("one account's last payout, from about 20 reads", async () => {
  const { reader, reads } = rewards([
    { id: 82774n, pair: fees, block: 49_000_000, epoch: SEP_17 - 8 * WEEK },
    { id: 82774n, pair: fees, block: PAID, epoch: SEP_17 },
  ]);
  const found = await payoutBlocks([standing(82774n)], TOP, timeOf(TOP), reader);
  assert.deepEqual([...found], [[82774n, PAID]]);
  assert.ok(reads.length <= 22, `${reads.length} reads`);
  assert.ok(
    reads.every(({ block }) => timeOf(block) >= SEP_17 - 1),
    "nothing before the epoch began is read",
  );
  reads.length = 0;
  assert.deepEqual([...(await payoutBlocks([standing(82774n)], TOP, timeOf(TOP), reader))], [[82774n, PAID]]);
  assert.equal(reads.length, 0, "a block found is kept");
});

test("accounts paid in one block are read together, in one call each step", async () => {
  const ids = [26432n, 82775n, 14247n, 35366n];
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
  const never: Standing = { id: 6n, through: 0, waiting: [] };
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

test("paid through, waiting and late, from fixed reads", () => {
  const pairs = [fees, bribes, { contract: BRIBES, token: KVCM }];
  const values = [
    // #1: paid through Sep 17 by its fees, and earlier by its bribes; WETH and USDC waiting.
    [BigInt(SEP_17), 2_500_000n, BigInt(SEP_17 - 3 * WEEK), 10n ** 15n, 0n, 0n],
    // #2: never paid, nothing waiting.
    [0n, 0n, 0n, 0n, 0n, 0n],
  ].flat();
  const [paid, never] = standingsOf([1n, 2n], pairs, values) as [Standing, Standing];
  assert.deepEqual(paid, {
    id: 1n,
    through: SEP_17,
    pair: fees,
    waiting: [
      { token: USDC, amount: 2_500_000n },
      { token: WETH, amount: 10n ** 15n },
    ],
  });
  assert.deepEqual(never, { id: 2n, through: 0, waiting: [] });
  const prices = new Map([[USDC.toLowerCase(), 1]]);
  assert.equal(dollars(paid.waiting, tokens, prices), 2.5, "WETH has no price here");
  assert.equal(dollars(paid.waiting, tokens, new Map([...prices, [WETH.toLowerCase(), 4_000]])), 6.5);
  assert.equal(dollars([{ token: KVCM, amount: 10n ** 18n }], tokens, new Map([[KVCM.toLowerCase(), 1]])), 0);

  // On Oct 16, in the epoch from Oct 15, an account that voted with the automation from Oct 1 should have been paid
  // through Oct 8.
  assert.equal(isLate(SEP_17, true, OCT_15), true);
  assert.equal(isLate(OCT_15 - 2 * WEEK, true, OCT_15), true);
  assert.equal(isLate(0, true, OCT_15), true, "never paid");
  assert.equal(isLate(OCT_15 - WEEK, true, OCT_15), false, "paid for the epoch that ended Oct 8; Oct 15's comes next");
  assert.equal(isLate(SEP_17, false, OCT_15), false, "it joined since, so nothing is owed yet");
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
beforeEach(() => resetRateLimits());
afterEach(() => (globalThis.fetch = original));
