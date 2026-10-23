import assert from "node:assert/strict";
import { test } from "node:test";
import { zeroAddress, type Address } from "viem";
import type { Call } from "../src/chain.ts";
import { EXCHANGES, PRICE_EXCHANGES } from "../src/config.ts";
import {
  SPAN,
  WINDOW,
  narrow,
  observedPrice,
  pairPrice,
  points,
  pricesAt,
  tickPrice,
  type Search,
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

test("prices come from the pools of seven exchanges, in order", () => {
  assert.deepEqual(
    [...new Set(PRICE_EXCHANGES.map(({ name }) => name.replace(/ V\d$/, "")))],
    [
      "Aero Slipstream",
      "Aero Basic Pools",
      "Aerodrome Slipstream",
      "Aerodrome Basic Pools",
      "Uniswap v3",
      "Hydrex Classic Pools",
      "Hydrex Integral",
    ],
  );
  // Every factory of those exchanges, once: both of Aero's basic pools' and all three of Aerodrome's Slipstream.
  const names = new Set(PRICE_EXCHANGES.map(({ name }) => name));
  assert.deepEqual(
    PRICE_EXCHANGES.map(({ id }) => id).sort(),
    EXCHANGES.filter(({ name }) => names.has(name))
      .map(({ id }) => id)
      .sort(),
  );
});

// A chain with USDC as the only anchor, and two tokens below its address, so each is its pools' token0. TOKEN trades in
// a deep Uniswap v3 pool, a shallower Aero basic pool and a Hydrex Integral pool too thin to count. LONE trades only in
// a Uniswap v3 pool.
const USDC: Address = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const TOKEN: Address = "0x0000000000000000000000000000000000000a01";
const LONE: Address = "0x0000000000000000000000000000000000000a02";
const factoryOf = (id: number): Address => EXCHANGES.find((each) => each.id === id)!.factory;
const [V3, AERO_VOLATILE, ALGEBRA] = [factoryOf(10), factoryOf(2), factoryOf(0)];
const POOLS = {
  v3: "0x0000000000000000000000000000000000000b01",
  aero: "0x0000000000000000000000000000000000000b02",
  algebra: "0x0000000000000000000000000000000000000b03",
  lone: "0x0000000000000000000000000000000000000b04",
  plugin: "0x0000000000000000000000000000000000000b05",
} as const;
const E18 = 10n ** 18n;
const E6 = 10n ** 6n;
// The tick at which a token of 18 decimals is worth `usd` in USDC.
const tickAt = (usd: number) => Math.round(Math.log(usd / 1e12) / Math.log(1.0001));

function chain(v3History: boolean) {
  const asked: string[] = [];
  const is = (a: unknown, b: string) => typeof a === "string" && a.toLowerCase() === b.toLowerCase();
  const answer = ({ address, functionName, args }: Call): unknown => {
    switch (functionName) {
      case "tickSpacings":
        return [];
      case "getPool":
        if (is(address, V3) && is(args[0], TOKEN) && args[2] === 500) return POOLS.v3;
        if (is(address, V3) && is(args[0], LONE) && args[2] === 3000) return POOLS.lone;
        if (is(address, AERO_VOLATILE) && is(args[0], TOKEN)) return POOLS.aero;
        return zeroAddress;
      case "poolByPair":
        return is(address, ALGEBRA) && is(args[0], TOKEN) ? POOLS.algebra : zeroAddress;
      case "getPair":
        return zeroAddress;
      // The v3 pool holds $3M a side at $3, LONE's $1M a side at $0.50, and the Aero pool $200,000 a side at $2.
      case "balanceOf":
        if (is(args[0], POOLS.v3)) return is(address, TOKEN) ? 1_000_000n * E18 : 3_000_000n * E6;
        if (is(args[0], POOLS.lone)) return is(address, LONE) ? 2_000_000n * E18 : 1_000_000n * E6;
        return undefined;
      case "slot0":
        return [0n, tickAt(is(address, POOLS.v3) ? 3 : 0.5), 0, 1, 1, 0, true];
      case "getReserves":
        if (is(address, POOLS.aero)) return [100_000n * E18, 200_000n * E6, 0n];
        return [10n * E18, 10n * E6];
      case "globalState":
        return [0n, tickAt(1), 0, 0, 0, true];
      case "plugin":
        return POOLS.plugin;
      // Over the window, the v3 pool averaged $2.80, and the Aero pool held 250,000 USDC for 100,000 tokens: $2.50.
      // LONE's pool keeps no history that far back.
      case "observe":
        asked.push(address);
        if (is(address, POOLS.aero))
          return [
            [0n, 100_000n * E18 * BigInt(WINDOW)],
            [0n, 250_000n * E6 * BigInt(WINDOW)],
          ];
        if (is(address, POOLS.v3) && v3History)
          return [
            [0n, BigInt(tickAt(2.8) * WINDOW)],
            [0n, 0n],
          ];
        return undefined;
      default:
        return undefined;
    }
  };
  const reader = async (calls: Call[]) => calls.map(answer);
  return { reader, asked };
}

const tokens = [
  { address: TOKEN, decimals: 18, symbol: "TOKEN" },
  { address: LONE, decimals: 18, symbol: "LONE" },
];
const flip = 1_792_627_200;

test("the deepest pool whose history reaches the flip gives the price", async () => {
  const { reader, asked } = chain(true);
  const prices = await pricesAt(tokens, new Map(), flip, flip + 3_600, reader);
  close(prices.get(USDC.toLowerCase())!, 1);
  close(prices.get(TOKEN)!, 2.8, 1e-3);
  assert.ok(!asked.includes(POOLS.aero), "the shallower pool is not asked");
});

test("a pool whose history falls short gives way to the next, and a token without any takes its price now", async () => {
  const { reader, asked } = chain(false);
  const prices = await pricesAt(tokens, new Map(), flip, flip + 3_600, reader);
  close(prices.get(TOKEN)!, 2.5);
  assert.deepEqual(asked, [POOLS.v3, POOLS.lone, POOLS.aero]);
  close(prices.get(LONE)!, 0.5, 1e-3);
});

test("a pool too thin for the amount priced does not count", async () => {
  const { reader } = chain(true);
  // A million TOKEN, about $3M, needs $30M in a pool: neither the v3 pool's $3M nor the Aero pool's $200,000 is enough.
  const prices = await pricesAt(tokens, new Map([[TOKEN, 1_000_000n * E18]]), flip, flip + 3_600, reader);
  assert.equal(prices.get(TOKEN), undefined);
});
