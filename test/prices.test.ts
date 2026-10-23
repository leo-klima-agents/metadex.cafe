import assert from "node:assert/strict";
import { test } from "node:test";
import { zeroAddress, type Address } from "viem";
import { same, type Call } from "../src/chain.ts";
import {
  ALGEBRA_FACTORY,
  ANCHORS,
  EXCHANGES,
  HYDREX_PRICING,
  PAIR_FACTORY,
  SWAP_PRICING,
  swapperOf,
} from "../src/config.ts";
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
// Its address sorts before USDC's, so it is token0 of each of its pools.
const TOKEN: Token = { address: "0x0000000000000000000000000000000000000001", decimals: 18, symbol: "TKN" };
type Market = { aero?: [number, number]; aerodrome?: [number, number]; hydrex?: [number, number] };
const POOLS: Record<keyof Market, Address> = {
  aero: "0x00000000000000000000000000000000000000a1",
  aerodrome: "0x00000000000000000000000000000000000000a2",
  hydrex: "0x00000000000000000000000000000000000000a3",
};
const [USDC, EURC] = [swapperOf("usdc")!.token, swapperOf("eurc")!.token];
// What Chainlink's USDC / USD and EURC / USD feeds answer, with their 8 decimals.
const USDC_USD = 0.999;
const EURC_USD = 1.15;
const feedOf = (token: Address): Address => ANCHORS.find(({ address }) => same(address, token))!.feed;
const ANSWERS: [Address, number][] = [
  [feedOf(USDC), USDC_USD],
  [feedOf(EURC), EURC_USD],
];
const factoryOf = (name: string, stable = false): Address =>
  EXCHANGES.find((exchange) => exchange.name === name && !!exchange.stable === stable)!.factory;

// TOKEN's volatile pools against USDC, of Aero, Aerodrome and Hydrex Classic, each with its reserves now in whole
// tokens, TOKEN's first. Aero's reads back `average` over the window, or refuses it. Only USDC's and EURC's feeds answer,
// TOKEN has no pool against EURC, and the classic pools have no observations yet.
function market(pools: Market, average?: [number, number]) {
  const asked = new Set<string>();
  const units = ([token, usdc]: [number, number]) => [BigInt(token) * 10n ** 18n, BigInt(usdc) * 10n ** 6n] as const;
  const poolOf = (name: keyof Market) => (pools[name] ? POOLS[name] : zeroAddress);
  const reader = async (calls: Call[]) =>
    calls.map(({ address, functionName, args }) => {
      asked.add(address.toLowerCase());
      const answer = ANSWERS.find(([feed]) => same(feed, address))?.[1];
      if (answer !== undefined)
        return functionName === "decimals" ? 8 : [1n, BigInt(Math.round(answer * 1e8)), 0n, BigInt(NOW), 1n];
      const found = (name: keyof Market, stable = false) =>
        !stable && same(String(args[1]), USDC) ? poolOf(name) : zeroAddress;
      if (same(address, factoryOf("Aero Basic Pools"))) return found("aero");
      if (same(address, factoryOf("Aerodrome Basic Pools"))) return found("aerodrome", !!args[2]);
      if (same(address, PAIR_FACTORY)) return found("hydrex", !!args[2]);
      if (same(address, factoryOf("Aero Basic Pools", true)) || same(address, ALGEBRA_FACTORY)) return zeroAddress;
      const name = (Object.keys(POOLS) as (keyof Market)[]).find((each) => same(POOLS[each], address));
      if (!name) return undefined;
      const [token, usdc] = units(pools[name]!);
      if (functionName === "getReserves") return [token, usdc, 0n];
      if (functionName === "observationLength") return 0n;
      if (functionName === "currentCumulativePrices") return [0n, 0n, BigInt(NOW)];
      if (functionName !== "observe" || !average) return undefined;
      const [held, paid] = units(average);
      return [
        [0n, held * BigInt(WINDOW)],
        [0n, paid * BigInt(WINDOW)],
      ];
    });
  return { reader, asked };
}

const priceOf = async (reader: (calls: Call[]) => Promise<unknown[]>, exchanges = SWAP_PRICING) =>
  (await pricesAt([TOKEN], new Map(), NOW, NOW, exchanges, reader)).get(TOKEN.address);

test("USDC and EURC take Chainlink's prices, and a token priced in USDC takes USDC's", async () => {
  const { reader } = market({ hydrex: [2_000, 8_000] });
  for (const exchanges of [SWAP_PRICING, HYDREX_PRICING]) {
    const prices = await pricesAt([TOKEN], new Map(), NOW, NOW, exchanges, reader);
    close(prices.get(USDC.toLowerCase())!, USDC_USD);
    close(prices.get(EURC.toLowerCase())!, EURC_USD);
    close(prices.get(TOKEN.address)!, 4 * USDC_USD);
  }
});

test("the deepest pool wins: of all four exchanges for the swap's page, of Hydrex's two for the Hydrex pages", async () => {
  // 2,000 USDC deep at 2 USDC in Aero, 15,000 at 3 in Aerodrome, 8,000 at 4 in Hydrex Classic.
  const { reader, asked } = market({ aero: [1_000, 2_000], aerodrome: [5_000, 15_000], hydrex: [2_000, 8_000] });
  close((await priceOf(reader))!, 3 * USDC_USD);
  asked.clear();
  close((await priceOf(reader, HYDREX_PRICING))!, 4 * USDC_USD);
  for (const { name, factory } of SWAP_PRICING.filter((exchange) => !HYDREX_PRICING.includes(exchange)))
    assert.ok(!asked.has(factory.toLowerCase()), `the Hydrex pages do not look in ${name}`);
});

test("an Aero pool gives its average over the window, or its price now when it refuses a window before its history", async () => {
  const pools: Market = { aero: [10_000, 20_000], hydrex: [2_000, 8_000] };
  close((await priceOf(market(pools, [10_000, 25_000]).reader))!, 2.5 * USDC_USD);
  close((await priceOf(market(pools).reader))!, 2 * USDC_USD);
});
