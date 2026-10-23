import assert from "node:assert/strict";
import { test } from "node:test";
import { zeroAddress, type Address } from "viem";
import { same, type Call } from "../src/chain.ts";
import {
  ANCHORS,
  EXCHANGES,
  HYDREX_PRICING,
  SWAP_PRICING,
  swapperOf,
  type Exchange,
  type Feed,
} from "../src/config.ts";
import {
  SPAN,
  WINDOW,
  feedsAt,
  narrow,
  observedPrice,
  pairPrice,
  points,
  pricesAt,
  tickPrice,
  type Search,
  type Token,
} from "../src/prices.ts";

const close = (actual: number, expected: number, relative = 1e-9) =>
  assert.ok(Math.abs(actual - expected) <= Math.abs(expected) * relative, `${actual} is not ${expected}`);

test("a concentrated pool's tick, in whole tokens of each", () => {
  close(tickPrice(0, 18, 18), 1);
  close(tickPrice(0, 18, 6), 1e12);
  close(tickPrice(10_000, 6, 6), 1.0001 ** 10_000);
  // USDC (6 decimals) is token0 of USDC / cbBTC (8): about 0.0000123 cbBTC a dollar, with bitcoin at $81,500.
  close(1 / tickPrice(-67_040, 6, 8), 81_460, 1e-3);
});

test("a classic pair's price: the ratio of its reserves, or the slope of x³y + xy³ for a stable one", () => {
  close(pairPrice(100, 250, false), 2.5);
  close(pairPrice(100, 100, true), 1);
  // A stable pair keeps its price near 1 even when its reserves are uneven; a volatile pair would not.
  const stable = pairPrice(110, 90, true);
  assert.ok(stable < 1 && stable > 0.99, String(stable));
  assert.ok(pairPrice(90, 110, true) > 1);
});

test("a classic pair's average between two observations, unless they are too far apart or it held nothing", () => {
  const flip = 1_792_022_400n;
  // 2,000 of token0 (18 decimals) and 50 of token1 (6 decimals), held for the 50 minutes between the two.
  const [reserve0, reserve1] = [2_000n * 10n ** 18n, 50n * 10n ** 6n];
  const at = (time: bigint, elapsed: bigint) => [time, reserve0 * elapsed, reserve1 * elapsed] as const;
  const first = at(flip - BigInt(WINDOW) - 600n, 0n);
  close(observedPrice(first, at(flip + 600n, 3_000n), 18, 6, false)!, 0.025);
  assert.equal(observedPrice(first, at(first[0] + BigInt(SPAN) + 1n, BigInt(SPAN) + 1n), 18, 6, false), undefined);
  assert.equal(observedPrice(first, [flip + 600n, 0n, 0n], 18, 6, false), undefined, "it held nothing");
  assert.equal(observedPrice(first, first, 18, 6, false), undefined);
});

test("a search probes every point of a short range, and spreads its points over a long one", () => {
  assert.deepEqual(points(3, 8), [3, 4, 5, 6, 7]);
  const spread = points(0, 11_769);
  assert.equal(spread.length, 16);
  assert.equal(spread[0], 0);
  assert.ok(spread.every((point, i) => i === 0 || point > spread[i - 1]!));
  assert.ok(spread.at(-1)! < 11_769);
});

// A list of timestamps, and a reader that counts the batches it reads.
function history(times: number[], failAt?: number) {
  let batches = 0;
  const probe = (index: number): Call => ({ address: zeroAddress, abi: [], functionName: "at", args: [index] });
  const reader = async (calls: Call[]) => {
    batches++;
    return calls.map(({ args: [index] }) => (index === failAt ? undefined : times[index as number]));
  };
  const search = (at: number, lo = 0): Search => ({
    lo,
    hi: times.length,
    probe,
    passes: (time) => (time as number) >= at,
    seen: new Map(),
  });
  return { reader, search, batches: () => batches };
}

test("searches narrow together, a batch a round, and keep the reads either side of what they find", async () => {
  // About half an hour apart, unevenly, as a classic pair records them.
  const times = Array.from({ length: 5_000 }, (_, i) => 1_000_000 + i * 1_800 + (i % 7) * 60);
  const { reader, search, batches } = history(times);
  const target = times[3_210]! - 30;
  const searches = [search(target), search(times[4_999]! + 1), search(0)];
  await narrow(searches, reader);
  const [found, none, first] = searches as [Search, Search, Search];
  assert.equal(found.hi, 3_210);
  assert.equal(found.seen.get(3_210), times[3_210]);
  assert.equal(found.seen.get(3_209), times[3_209]);
  assert.equal(none.hi, 5_000, "none passes: the end");
  assert.equal(first.hi, 0);
  assert.ok(batches() <= 4, `${batches()} rounds`);
});

test("a search that starts from a bound finds the same, and a read that fails ends it", async () => {
  const times = Array.from({ length: 100 }, (_, i) => i * 10);
  const { reader, search } = history(times, 50);
  const bounded = search(705, 60);
  await narrow([bounded], reader);
  assert.equal(bounded.hi, 71);
  assert.ok(bounded.seen.has(70));
  const broken = search(500);
  await narrow([broken], reader);
  assert.equal(broken.failed, true);
});

test("the swap's page prices in Aero's, Aerodrome's and Hydrex's pools, in that order; the Hydrex pages in Hydrex's", () => {
  assert.deepEqual(
    SWAP_PRICING.map(({ name }) => name),
    ["Aero Basic Pools", "Aero Basic Pools", "Aerodrome Basic Pools", "Hydrex Classic Pools", "Hydrex Integral"],
  );
  assert.deepEqual(
    HYDREX_PRICING.map(({ name }) => name),
    ["Hydrex Classic Pools", "Hydrex Integral"],
  );
});

const NOW = 1_792_800_000;
const [USDC, EURC] = [swapperOf("usdc")!.token, swapperOf("eurc")!.token];
// TOKEN sorts before every anchor, so it is token0 of its pools; LATE sorts after, so it is token1.
const TOKEN: Token = { address: "0x0000000000000000000000000000000000000001", decimals: 18, symbol: "TKN" };
const LATE: Token = { address: "0xffffffffffffffffffffffffffffffffffffff01", decimals: 18, symbol: "LATE" };
const USDC_TOKEN: Token = { address: USDC, decimals: 6, symbol: "USDC" };
// Chainlink's answers, by token.
const USDC_USD = 0.999;
const EURC_USD = 1.15;
const ANSWERS = new Map<Address, number>([
  [USDC, USDC_USD],
  [EURC, EURC_USD],
]);
const exchange = (name: string, stable = false): Exchange =>
  EXCHANGES.find((each) => each.name === name && !!each.stable === stable)!;
const [AERO, AERO_STABLE, AERODROME, HYDREX] = [
  exchange("Aero Basic Pools"),
  exchange("Aero Basic Pools", true),
  exchange("Aerodrome Basic Pools"),
  exchange("Hydrex Classic Pools"),
];

// A pool of `token` against `anchor`, USDC by default: its reserves now in whole tokens, the token's first, and those it
// held throughout before, if they differ. Aero's pools keep that history, unless `fresh`; classic pools record it every
// half hour.
type Fake = {
  exchange: Exchange;
  token: Token;
  now: [number, number];
  held?: [number, number];
  anchor?: Address;
  stable?: boolean;
  fresh?: boolean;
};

function market(pools: Fake[], answers = ANSWERS) {
  const asked = new Set<string>();
  const addressOf = (i: number): Address => `0x${(0xa0 + i).toString(16).padStart(40, "0")}`;
  const anchorOf = (pool: Fake) => ANCHORS.find(({ address }) => same(address, pool.anchor ?? USDC))!;
  // A pool's reserves in its own order and units.
  const units = (pool: Fake, [token, anchor]: [number, number]) => {
    const amounts = [
      BigInt(token) * 10n ** BigInt(pool.token.decimals),
      BigInt(anchor) * 10n ** BigInt(anchorOf(pool).decimals),
    ];
    return pool.token.address.toLowerCase() < anchorOf(pool).address.toLowerCase() ? amounts : amounts.reverse();
  };
  const sumsAt = (pool: Fake, time: number) =>
    units(pool, pool.held ?? pool.now).map((amount) => amount * BigInt(time));
  // Classic pools' observations: every half hour, the last ten minutes ago.
  const COUNT = 10;
  const observedAt = (i: number) => NOW - 600 - 1800 * (COUNT - 1 - i);
  const reader = async (calls: Call[]) =>
    calls.map(({ address, functionName, args }) => {
      asked.add(address.toLowerCase());
      const fed = ANCHORS.find(({ feed }) => same(feed.address, address));
      if (fed) {
        const answer = answers.get(fed.address);
        return answer === undefined ? undefined : [1n, BigInt(Math.round(answer * 1e8)), 0n, BigInt(NOW), 1n];
      }
      const factory = EXCHANGES.find((each) => same(each.factory, address));
      if (factory) {
        const [a, b, stable] = args as [Address, Address, boolean | undefined];
        const i = pools.findIndex(
          (pool) =>
            pool.exchange === factory &&
            same(pool.token.address, a) &&
            same(anchorOf(pool).address, b) &&
            (stable === undefined || !!pool.stable === stable),
        );
        return i < 0 ? zeroAddress : addressOf(i);
      }
      const pool = pools.find((_, i) => same(addressOf(i), address));
      if (!pool) return undefined;
      switch (functionName) {
        case "getReserves":
          return [...units(pool, pool.now), 0n];
        case "observe":
          return pool.fresh
            ? undefined
            : [0, 1].map((side) => (args[0] as number[]).map((ago) => sumsAt(pool, NOW - ago)[side]!));
        case "observationLength":
          return BigInt(COUNT);
        case "observations":
          return [BigInt(observedAt(Number(args[0]))), ...sumsAt(pool, observedAt(Number(args[0])))];
        case "currentCumulativePrices":
          return [...sumsAt(pool, NOW), BigInt(NOW)];
      }
    });
  return { reader, asked };
}

const priceOf = async (pools: Fake[], token = TOKEN, exchanges = SWAP_PRICING) =>
  (await pricesAt([token], new Map(), NOW, NOW, exchanges, market(pools).reader)).get(token.address.toLowerCase());

test("USDC and EURC take Chainlink's prices, and a token priced in USDC takes USDC's", async () => {
  const { reader } = market([{ exchange: HYDREX, token: TOKEN, now: [2_000, 8_000] }]);
  for (const exchanges of [SWAP_PRICING, HYDREX_PRICING]) {
    const prices = await pricesAt([TOKEN], new Map(), NOW, NOW, exchanges, reader);
    close(prices.get(USDC.toLowerCase())!, USDC_USD);
    close(prices.get(EURC.toLowerCase())!, EURC_USD);
    close(prices.get(TOKEN.address)!, 4 * USDC_USD);
  }
});

test("an anchor whose feed fails is priced like any other token", async () => {
  // 11,500 USDC against 10,000 EURC at $1.15: a dollar.
  const pools: Fake[] = [{ exchange: HYDREX, token: USDC_TOKEN, anchor: EURC, now: [11_500, 10_000] }];
  const answers = new Map([[EURC, EURC_USD]]);
  const prices = await pricesAt([USDC_TOKEN], new Map(), NOW, NOW, SWAP_PRICING, market(pools, answers).reader);
  close(prices.get(USDC.toLowerCase())!, 1);
});

test("the deepest pool wins: of all four exchanges for the swap's page, of Hydrex's two for the Hydrex pages", async () => {
  // 2,000 USDC deep at 2 USDC in Aero, 15,000 at 3 in Aerodrome, 8,000 at 4 in Hydrex Classic.
  const pools: Fake[] = [
    { exchange: AERO, token: TOKEN, now: [1_000, 2_000] },
    { exchange: AERODROME, token: TOKEN, now: [5_000, 15_000] },
    { exchange: HYDREX, token: TOKEN, now: [2_000, 8_000] },
  ];
  close((await priceOf(pools))!, 3 * USDC_USD);
  const { reader, asked } = market(pools);
  close((await pricesAt([TOKEN], new Map(), NOW, NOW, HYDREX_PRICING, reader)).get(TOKEN.address)!, 4 * USDC_USD);
  for (const { name, factory } of SWAP_PRICING.filter((each) => !HYDREX_PRICING.includes(each)))
    assert.ok(!asked.has(factory.toLowerCase()), `the Hydrex pages do not look in ${name}`);
});

test("an Aero pool gives its average over the window, or its price now if its history is too short", async () => {
  // At 2 USDC now, and 2.5 before; as token0 and as token1.
  for (const token of [TOKEN, LATE]) {
    const pool: Fake = { exchange: AERO, token, now: [10_000, 20_000], held: [10_000, 25_000] };
    close((await priceOf([pool], token))!, 2.5 * USDC_USD);
    close((await priceOf([{ ...pool, fresh: true }], token))!, 2 * USDC_USD);
  }
});

test("Aero's stable factory prices on the stable curve", async () => {
  for (const token of [TOKEN, LATE]) {
    const price = await priceOf([{ exchange: AERO_STABLE, token, now: [1_100, 900] }], token);
    close(price!, pairPrice(1_100, 900, true) * USDC_USD);
  }
});

test("an Aerodrome pool gives its average between the observations around the window", async () => {
  const pool: Fake = { exchange: AERODROME, token: TOKEN, now: [5_000, 15_000], held: [5_000, 12_500] };
  close((await priceOf([pool]))!, 2.5 * USDC_USD);
});

test("an exchange whose pools cannot price is refused", async () => {
  const slipstream = exchange("Aero Slipstream");
  await assert.rejects(pricesAt([TOKEN], new Map(), NOW, NOW, [slipstream], market([]).reader), /cannot price/);
});

test("feeds: one read for the latest rounds, then one search for the rounds in effect at the flip", async () => {
  // Two feeds, in their second phase, with a round an hour; and one that does not answer.
  const phase = 2n << 64n;
  const feeds: Feed[] = [1, 2, 3].map((i) => ({ address: `0x${"f".repeat(39)}${i}`, decimals: 8 }));
  const round = (feed: number, n: number) => [
    phase + BigInt(n),
    BigInt(feed * 100 + n) * 10n ** 8n,
    0n,
    BigInt(NOW - 3_600 * (200 - n)),
    0n,
  ];
  let reads = 0;
  const reader = async (calls: Call[]) => {
    reads++;
    return calls.map(({ address, functionName, args }) => {
      const feed = Number(address.at(-1));
      if (feed === 3) return undefined;
      return functionName === "latestRoundData" ? round(feed, 200) : round(feed, Number((args[0] as bigint) - phase));
    });
  };
  // Round 150 started 50 hours before NOW, and 151 49 hours before.
  const flip = NOW - 3_600 * 50 + 1;
  assert.deepEqual(await feedsAt(feeds, flip, reader), [250, 350, undefined]);
  assert.ok(reads <= 4, `${reads} reads`);
  assert.deepEqual(await feedsAt(feeds, Infinity, reader), [300, 400, undefined]);
});
