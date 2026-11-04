import assert from "node:assert/strict";
import { test } from "node:test";
import {
  decodeFunctionData,
  encodeAbiParameters,
  encodeEventTopics,
  encodeFunctionResult,
  numberToHex,
  parseAbi,
} from "viem";
import type { Address, Hex, RpcLog } from "viem";
import { MATCHA_LATTE } from "../src/config.ts";
import { WEEK, type Money } from "../src/format.ts";
import { key, type Prices, type Token } from "../src/prices.ts";
import {
  WALK_LIMIT,
  claimsOf,
  firstReached,
  paidFor,
  payoutsOf,
  passesTo,
  readOwed,
  readStamps,
  standingOf,
  totals,
  valueAt,
  walkClaims,
  weighed,
  worthAt,
  windowStart,
  type ClaimLog,
  type Pair,
  type Records,
} from "../src/payouts.ts";

const abi = parseAbi([
  "event CarbonRetired(address indexed creditToken_, uint256 retireTonnes, uint256 kvcmSpent)",
  "event ClaimSwapAndDistributeCompleted(uint256 indexed tokenId, address indexed owner, address indexed recipient, address[] claimedTokens, uint256[] claimedAmounts, address[] distributedTokens, uint256[] distributedAmounts, uint256[] treasuryFees)",
  "event Claimed(uint256 indexed tokenId, address indexed owner, address indexed caller, address[] tokens, uint256[] amounts, uint256[] fees, uint256 previousClaimBlock)",
]);
const KVCM: Address = "0x00fBAC94Fec8D4089d3fe979F39454F48c71A65d";
const USDC: Address = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const WETH: Address = "0x4200000000000000000000000000000000000006";
const OWNER: Address = "0x60924601E73EBc5C2Bd9244c788d93e0710a6c93";
const OTHER: Address = "0xa79cd47655156b299762DFE92A67980805ce5a31";
const STRANGER: Address = "0x000000000000000000000000000000000000dEaD";
const FEES: Address = "0x59Bcf560Cd567f2eAaE9d7aDfF399E019B54A20d";
const BRIBES: Address = "0x0000000000000000000000000000000000000b1b";
const TX = `0x${"09".repeat(32)}` as Hex;
const PAID = 51_698_051;
const t = (n: number) => BigInt(Math.round(n * 1e6)) * 10n ** 12n;
const amount = (token: Address, amount: bigint) => ({ token, amount });

// Each log follows the one made before it and has a transaction of its own, unless `tx` is given.
let index = 0;
function log(
  eventName: (typeof abi)[number]["name"],
  args: object,
  values: unknown[],
  block: number,
  tx?: Hex,
): RpcLog {
  const inputs = abi.find(({ name }) => name === eventName)!.inputs.filter((input) => !("indexed" in input));
  index++;
  return {
    address: MATCHA_LATTE.address,
    topics: encodeEventTopics({ abi, eventName, args } as never) as [Hex, ...Hex[]],
    data: encodeAbiParameters(inputs, values as never),
    transactionHash: tx ?? numberToHex(index, { size: 32 }),
    transactionIndex: "0x0",
    blockHash: numberToHex(block, { size: 32 }),
    blockNumber: numberToHex(block),
    logIndex: numberToHex(index),
    removed: false,
  };
}
type Amounts = Record<Address, bigint>;
const lists = (amounts: Amounts) => [Object.keys(amounts), Object.values(amounts)];
const retired = (...values: bigint[]) => log("CarbonRetired", { creditToken_: KVCM }, values, PAID, TX);
function paidOut(id: bigint, owner: Address, claimed: Amounts, paid: Amounts, fees: bigint[]) {
  const values = [...lists(claimed), ...lists(paid), fees];
  return log("ClaimSwapAndDistributeCompleted", { tokenId: id, owner, recipient: owner }, values, PAID, TX);
}
function claimed(id: bigint, block: number, previous: number, amounts: Amounts, caller = OTHER) {
  const fees = Object.values(amounts).map((n) => n / 100n);
  return log("Claimed", { tokenId: id, owner: OWNER, caller }, [...lists(amounts), fees, BigInt(previous)], block);
}

test("each account's payout, with the retirement just before it in the same transaction", () => {
  const logs = [
    retired(t(65.26), t(326.8)),
    paidOut(82774n, OWNER, { [USDC]: 12_000_000n, [KVCM]: 0n }, { [KVCM]: t(727.11), [USDC]: 0n }, [0n, 0n]),
    paidOut(14247n, OTHER, {}, { [KVCM]: t(5) }, [t(0.05)]),
  ];
  const [first, second] = payoutsOf([...logs].reverse());
  const common = { recipient: OWNER, tx: TX, block: PAID };
  assert.deepEqual(first, {
    ...common,
    id: 82774n,
    owner: OWNER,
    earned: [amount(USDC, 12_000_000n)],
    paid: [amount(KVCM, t(727.11))],
    fees: [],
    tonnes: t(65.26),
    retiredKvcm: t(326.8),
  });
  const { id, owner, earned, paid, fees, tonnes, retiredKvcm } = second!;
  assert.deepEqual([id, owner, earned, paid, fees], [14247n, OTHER, [], [amount(KVCM, t(5))], [amount(KVCM, t(0.05))]]);
  assert.deepEqual([tonnes, retiredKvcm], [0n, 0n], "a retirement only for the account it precedes");
});

const SEP_17 = 1_789_603_200; // Thu 17 Sep 2026, 00:00 UTC
const OCT_15 = SEP_17 + 4 * WEEK;
const OCT_8 = OCT_15 - WEEK;
const OCT_1 = OCT_15 - 2 * WEEK;
const TOP = 52_694_000; // Fri 16 Oct 2026, 19:02 UTC

test("each item's first block to reach what it waits for, those reaching it together read together", async () => {
  const steps: Record<string, number> = { a: 105, b: 105, c: 180, d: 1_000 };
  const reads: [number, number][] = [];
  const reached = async (block: number, items: string[]) => {
    reads.push([block, items.length]);
    return items.map((item) => steps[item]! <= block);
  };
  const found = await firstReached(reached, ["a", "b", "c", "d"], 100, 200);
  assert.deepEqual(Object.fromEntries(found), { a: 105, b: 105, c: 180 });
  assert.deepEqual(reads[0], [200, 4], "the last block first: d, never reached, is read no more");
  reads.length = 0;
  await firstReached(reached, ["a", "b"], 0, 1_000_000);
  assert.ok(reads.length <= 21 && reads.every(([, n]) => n === 2), `${reads.length} reads`);
  assert.deepEqual([...(await firstReached(async () => [true], ["a"], 200, 200))], [], "an empty range");
});

const usdc: Token = { address: USDC, decimals: 6, symbol: "USDC" };
const weth: Token = { address: WETH, decimals: 18, symbol: "WETH" };
const tokens = new Map([usdc, weth].map((token) => [key(token.address), token]));
const byKey = (prices: object) => new Map(Object.entries(prices).map(([at, price]) => [key(at), price as number]));
const prices = (of: object): Prices => ({ unit: "USD", of: byKey(of) });

test("what amounts are worth: nothing for a token without a price or decimals", () => {
  const waiting = [amount(USDC, 2_500_000n), amount(WETH, 10n ** 15n)];
  assert.equal(valueAt(waiting, tokens, prices({ [USDC]: 1 })), 2.5);
  assert.equal(valueAt(waiting, tokens, prices({ [USDC]: 1, [WETH]: 4_000 })), 6.5);
  assert.equal(valueAt([amount(KVCM, 10n ** 18n)], tokens, prices({ [KVCM]: 1 })), 0);
});

// Last epoch's rewards are $90 of USDC fees, $8 of WETH bribes and $2 of kVCM bribes; the epoch before's are $60 of
// fees and $40 of WETH bribes.
const fees: Pair = { contract: FEES, token: USDC };
const bribes: Pair = { contract: BRIBES, token: WETH };
const PAIRS = [fees, bribes, { contract: BRIBES, token: KVCM }];
const rewards = (start: number, ...values: number[]) => ({
  start,
  pairs: values.map((value, i) => ({ ...PAIRS[i]!, value })),
});
const last = rewards(OCT_8, 90, 8, 2);
const before = rewards(OCT_1, 60, 40);
const owed: (bigint | undefined)[] = [2_500_000n, 10n ** 15n, 0n];
const of = (records: Partial<Records>, voted = { last: true, before: true }) =>
  standingOf(1n, last, before, { last: [0, 0, 0], earned: owed, before: [0, 0], ...records }, voted);
const brief = ({ paidUpTo, paid, late }: ReturnType<typeof of>) => [paidUpTo?.through ?? 0, paidUpTo?.pair, paid, late];

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

test("an account is paid up to last epoch until its payout, which a claim of a few rewards is not", () => {
  const due = of({ last: [OCT_8, OCT_8, 0], before: [OCT_8, OCT_8] });
  const waiting = [
    { ...fees, amount: 2_500_000n },
    { ...bribes, amount: 10n ** 15n },
  ];
  const paidUpTo = { through: OCT_8, pair: fees };
  assert.deepEqual(due, { id: 1n, paidUpTo, paid: false, late: false, waiting, unknown: false });
  // A stranger claimed its small bribes through Double Espresso after the flip, so it is still due.
  assert.deepEqual(brief(of({ last: [OCT_8, OCT_15, OCT_15], before: [OCT_8, OCT_8] })), [OCT_8, fees, false, false]);
  // Claims took most of last epoch's rewards, so it is paid up to the flip, through the most valuable reward claimed.
  assert.deepEqual(brief(of({ last: [OCT_15, OCT_8, 0], before: [OCT_15, OCT_8] })), [OCT_15, fees, true, false]);
  assert.deepEqual(brief(of({ last: [OCT_15, OCT_15, OCT_15], before: [OCT_8, OCT_8] })), [OCT_15, fees, true, false]);
});

test("late, never paid, joined since, and what could not be read", () => {
  // Unpaid for the epoch from Oct 1, so it is late, and paid up to its newest record before then.
  assert.deepEqual(brief(of({ last: [SEP_17, OCT_15, 0], before: [SEP_17, 0] })), [SEP_17, fees, false, true]);
  assert.deepEqual(brief(of({})), [0, undefined, false, true]);
  const joined = of({ last: [OCT_8, 0, 0] }, { last: true, before: false });
  assert.deepEqual(brief(joined), [OCT_8, fees, false, false], "nothing owed for Oct 1");
  const since = of({ last: [OCT_15, 0, 0] }, { last: false, before: false });
  assert.deepEqual(brief(since), [OCT_15, fees, false, false], "its newest record");
  const partly = of({ earned: [3_000_000n, undefined, 0n], before: [OCT_8, OCT_8] });
  assert.deepEqual(partly.waiting, [{ ...fees, amount: 3_000_000n }], "at least what was read");
  assert.equal(partly.unknown, true);
});

test("each reward weighed at today's quotes, and none without one", () => {
  const rewards = [
    { pool: FEES, contract: FEES, token: usdc, amount: 90_000_000n, fee: true },
    { pool: FEES, contract: BRIBES, token: weth, amount: 10n ** 18n, fee: false },
  ];
  assert.deepEqual(weighed(rewards, { of: byKey({ [USDC]: 1 }) }), [
    { ...fees, value: 90 },
    { ...bribes, value: 0 },
  ]);
  // With WETH quoted at $2,500, a claim of the USDC alone is not a payout.
  const pairs = weighed(rewards, { of: byKey({ [USDC]: 1, [WETH]: 2_500 }) });
  assert.equal(pairs[1]!.value, 2_500);
  assert.equal(paidFor(pairs, [OCT_15, 0], OCT_15), false);
});

test("what amounts were worth: 'at least' when one had no price or decimals, and nothing when none counted", () => {
  const waiting = [amount(USDC, 2_500_000n), amount(WETH, 10n ** 15n)];
  const brief = (sum?: Money) => sum && [sum.value, !!sum.atLeast];
  assert.deepEqual(brief(worthAt(waiting, tokens, prices({ [USDC]: 1, [WETH]: 4_000 }))), [6.5, false]);
  assert.deepEqual(brief(worthAt(waiting, tokens, prices({ [USDC]: 1 }))), [2.5, true], "WETH had no price");
  const kvcm = prices({ [USDC]: 1, [WETH]: 4_000, [KVCM]: 1 });
  assert.deepEqual(
    brief(worthAt([...waiting, amount(KVCM, 10n ** 18n)], tokens, kvcm)),
    [6.5, true],
    "nor kVCM decimals",
  );
  assert.equal(worthAt(waiting, tokens, prices({})), undefined);
});

test("records are read in one batch; what waits in batches of 20, and what lies past earned()'s 50 epochs", async (t) => {
  const multicall = parseAbi([
    "function aggregate3((address target, bool allowFailure, bytes callData)[] calls) payable returns ((bool success, bytes returnData)[])",
  ]);
  const reads = parseAbi([
    "function earned(uint256, address)",
    "function tokenTimestamp(uint256, address)",
    "function firstBribeTimestamp()",
    "function earnedTokenId(uint256, address, uint48)",
    "function getFirstEscrowPoint(uint256)",
  ]);
  const word = (value: bigint) => ({ success: true, returnData: encodeAbiParameters([{ type: "uint256" }], [value]) });
  // The fees contract had its first incentives 54 epochs before OCT_15, and account #1 never claimed from it.
  const FIRST = OCT_15 - 54 * WEEK;
  const point = encodeAbiParameters(
    ["int128", "int128", "int128", "uint48"].map((type) => ({ type })),
    [0n, 0n, 0n, FIRST - 100 * WEEK],
  );
  // 50 epochs after `OCT_15`, so past the first 50 that one asking reads; it owes nothing.
  const LATER = OCT_15 + 50 * WEEK;
  const batches: number[] = [];
  const past: unknown[] = [];
  t.mock.method(globalThis, "fetch", async (_: unknown, init: RequestInit) => {
    const calls = decodeFunctionData({ abi: multicall, data: JSON.parse(String(init.body)).params[0].data }).args[0];
    batches.push(calls.length);
    const result = calls.map(({ target, callData }) => {
      const { functionName, args = [] } = decodeFunctionData({ abi: reads, data: callData });
      if (functionName === "tokenTimestamp") return word(args[0] === 1n && target === FEES ? 0n : BigInt(SEP_17));
      if (functionName === "firstBribeTimestamp") return word(BigInt(target === FEES ? FIRST : OCT_1 - 10 * WEEK));
      if (functionName === "getFirstEscrowPoint") return { success: true, returnData: point };
      if (functionName === "earnedTokenId") return (past.push(args), word(args[2] === LATER ? 0n : 7n));
      return args[0] === 2n && args[1] === WETH ? { success: false, returnData: "0x" as Hex } : word(5n);
    });
    return Response.json({ result: encodeFunctionResult({ abi: multicall, functionName: "aggregate3", result }) });
  });
  const ids = Array.from({ length: 11 }, (_, i) => BigInt(i + 1));
  const stamps = await readStamps(ids, [fees, bribes], TOP);
  assert.deepEqual(stamps.get(2n), [SEP_17, SEP_17]);
  batches.length = 0;
  const owed = await readOwed(ids, [fees, bribes], TOP, [OCT_8, OCT_15]);
  assert.deepEqual(
    batches.sort((a, b) => a - b),
    [2, 2, 2, 11, 20, 22],
  );
  // `earned()` reads 50 epochs from a week before the first incentives. Both epochs lie beyond those 50, so each is
  // read on its own.
  assert.deepEqual(past, [
    [1n, USDC, OCT_8],
    [1n, USDC, OCT_15],
  ]);
  assert.deepEqual(owed[0], {
    id: 1n,
    owing: [
      { pair: fees, amount: 19n, passes: 2, stamp: 0 },
      { pair: bribes, amount: 5n, passes: 1, stamp: SEP_17 },
    ],
  });
  assert.deepEqual(
    owed[1]!.owing[1],
    { pair: bribes, amount: undefined, passes: 1, stamp: SEP_17 },
    "a failed read is unknown",
  );
  assert.deepEqual(
    new Map(owed.map(({ id, owing }) => [id, owing.map(({ stamp }) => stamp)])),
    await readStamps(ids, [fees, bribes], TOP),
    "with the records it read",
  );
  const [first] = await readOwed([1n], [fees], TOP, [OCT_8, LATER]);
  assert.deepEqual(
    first?.owing,
    [{ pair: fees, amount: 12n, passes: 2, stamp: 0 }],
    "asked as far as an epoch that owes something",
  );
  assert.equal(windowStart(SEP_17, FIRST, 0), SEP_17, "from the last claim");
  assert.equal(windowStart(0, FIRST, OCT_1), OCT_1, "or from the account's creation, after the first incentives");
  assert.deepEqual([passesTo(OCT_1, OCT_15), passesTo(OCT_15 - 50 * WEEK, OCT_15)], [1, 2]);
});

function doubleEspresso(logs: ReturnType<typeof claimed>[]) {
  const reads: { block: number; ids: bigint[] }[] = [];
  const all = claimsOf(logs);
  const claimsAt = async (block: number, ids: bigint[]) => {
    reads.push({ block, ids });
    return all.filter((claim) => claim.block === block && ids.includes(claim.id));
  };
  return { claimsAt, reads };
}
const blocks = (list: { block: number }[]) => list.map(({ block }) => block);
const walk = async (claimsAt: (block: number, ids: bigint[]) => Promise<ClaimLog[]>, from: number, since: number) =>
  (await walkClaims(new Map([[1n, { from, since }]]), claimsAt)).get(1n)!;

test("an account's claims, newest first, back to the start of the epoch of its last one", async () => {
  // The epoch starts at block 900: a claim at 400 before it, one at 1,000 in it, then a stranger's dust at 1,500.
  const { claimsAt, reads } = doubleEspresso([
    claimed(1n, 400, 0, { [USDC]: 5_000_000n }),
    claimed(1n, 1_000, 400, { [USDC]: 12_000_000n, [WETH]: 10n ** 15n }),
    claimed(1n, 1_500, 1_000, { [USDC]: 1n }, STRANGER),
  ]);
  const { claims, stopped } = await walk(claimsAt, 1_500, 900);
  const callers = claims.map(({ caller }) => caller);
  assert.deepEqual([blocks(claims), callers, stopped], [[1_500, 1_000], [STRANGER, OTHER], false]);
  assert.deepEqual(blocks(reads), [1_500, 1_000], "the claim before the epoch is not read");
});

test("accounts claimed in the same block share each read, and an account never claimed reads nothing", async () => {
  const { claimsAt, reads } = doubleEspresso([
    claimed(1n, 1_000, 0, { [USDC]: 1_000_000n }),
    claimed(2n, 1_000, 0, { [USDC]: 2_000_000n }),
    claimed(3n, 1_200, 0, { [USDC]: 3_000_000n }),
  ]);
  const froms = new Map([1_000, 1_000, 1_200, 0].map((from, i) => [BigInt(i + 1), { from, since: from && 900 }]));
  const walks = await walkClaims(froms, claimsAt);
  reads.sort((a, b) => a.block - b.block);
  assert.deepEqual(reads, [
    { block: 1_000, ids: [1n, 2n] },
    { block: 1_200, ids: [3n] },
  ]);
  const found = [...walks.values()].map(({ claims }) => blocks(claims));
  assert.deepEqual(found, [[1_000], [1_000], [1_200], []]);
});

test("several claims in one block: the first points back, the later ones to the block itself", async () => {
  const { claimsAt } = doubleEspresso([
    claimed(1n, 700, 0, { [USDC]: 1_000_000n }),
    claimed(1n, 1_000, 700, { [USDC]: 2_000_000n }),
    claimed(1n, 1_000, 1_000, { [WETH]: 10n ** 14n }),
    claimed(1n, 1_000, 1_000, {}, STRANGER),
  ]);
  assert.deepEqual(blocks((await walk(claimsAt, 1_000, 600)).claims), [1_000, 1_000, 700], "less the empty claim");
});

test("a long history of dust stops the walk after a set number of blocks, and says so", async () => {
  const logs = Array.from({ length: 15 }, (_, i) => claimed(1n, 1_000 + i, i && 999 + i, { [USDC]: 1n }, STRANGER));
  const { claimsAt, reads } = doubleEspresso(logs);
  const long = await walk(claimsAt, 1_014, 900);
  assert.deepEqual([reads.length, long.claims.length, long.stopped], [WALK_LIMIT, WALK_LIMIT, true]);
  const short = await walk(doubleEspresso(logs).claimsAt, 1_014, 1_010);
  assert.deepEqual([short.claims.length, short.stopped], [5, false], "it reached the start of the epoch first");
});

test("what the claims received, the fee, and what reached the owner, token by token", () => {
  const claims = claimsOf([
    claimed(1n, 1_000, 0, { [USDC]: 12_000_000n, [WETH]: 10n ** 15n }),
    claimed(1n, 1_500, 1_000, { [USDC]: 150n }, STRANGER),
  ]);
  assert.deepEqual(blocks(claims), [1_500, 1_000], "newest first");
  const both = (usdc: bigint, weth: bigint) => [amount(USDC, usdc), amount(WETH, weth)];
  assert.deepEqual(totals(claims), {
    received: both(12_000_150n, 10n ** 15n),
    fees: both(120_001n, 10n ** 13n),
    paid: both(11_880_149n, 99n * 10n ** 13n),
  });
});
