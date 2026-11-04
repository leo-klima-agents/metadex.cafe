import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { zeroAddress, type Address } from "viem";
import { SETTLED, same, type Call } from "../src/rpc.ts";
import { ANCHORS, FIAT_FEEDS, EXCHANGES, PRICING, swapperOf, type Exchange } from "../src/config.ts";
import { WINDOW, pairPrice, pools as poolCache, pricesAt, pricesNow, tickPrice, type Token } from "../src/prices.ts";

beforeEach(() => poolCache.clear());

const close = (actual: number, expected: number, relative = 1e-9) =>
  assert.ok(Math.abs(actual - expected) <= Math.abs(expected) * relative, `${actual} is not ${expected}`);

test("a concentrated pool's tick, in whole tokens of each", () => {
  close(tickPrice(0, 18, 18), 1);
  close(tickPrice(0, 18, 6), 1e12);
  close(tickPrice(10_000, 6, 6), 1.0001 ** 10_000);
  // USDC (6 decimals) is token0 of USDC / cbBTC (8 decimals), so the tick gives cbBTC per dollar: about 0.0000123, with
  // bitcoin at about $81,460.
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

test("prices come from Aero's, Aerodrome's and Hydrex's pools, in that order", () => {
  assert.deepEqual(
    PRICING.map(({ name }) => name),
    [
      "Aero Basic Pools",
      "Aero Basic Pools",
      "Aero Slipstream",
      "Aerodrome Basic Pools",
      "Aerodrome Slipstream V3",
      "Aerodrome Slipstream V2",
      "Aerodrome Slipstream",
      "Hydrex Classic Pools",
      "Hydrex Integral",
    ],
  );
});

const NOW = 1_792_800_000;
// The block prices are read at now, the newest an RPC gives less those it may not have yet.
// The fake chain makes a block every seven seconds, unlike Base, so nothing may count on Base's two; and the last block
// half an hour before the newest is not half an hour before the one priced.
const PACE = 7;
const PRICED = 60_000_000;
const NEWEST = PRICED + SETTLED;
const timeOf = (block: number) => NOW + (block - PRICED) * PACE;
const blockOf = (time: number) => PRICED + Math.floor((time - NOW) / PACE);
const START = blockOf(timeOf(NEWEST) - WINDOW);
const [USDC, EURC] = [swapperOf("usdc")!.token, swapperOf("eurc")!.token];
// TOKEN sorts before every anchor, so it is token0 of its pools; LATE sorts after, so it is token1.
const TOKEN: Token = { address: "0x0000000000000000000000000000000000000001", decimals: 18, symbol: "TKN" };
const LATE: Token = { address: "0xffffffffffffffffffffffffffffffffffffff01", decimals: 18, symbol: "LATE" };
const USDC_TOKEN: Token = { address: USDC, decimals: 6, symbol: "USDC" };
const EURC_TOKEN: Token = { address: EURC, decimals: 6, symbol: "EURC" };
const USDC_USD = 0.999;
const EURC_USD = 1.15;
const ANSWERS = new Map<Address, number>([
  [USDC, USDC_USD],
  [EURC, EURC_USD],
]);
const exchange = (name: string, stable = false): Exchange =>
  EXCHANGES.find((each) => each.name === name && !!each.stable === stable)!;
const [AERO, AERO_STABLE, AERO_CL, AERODROME, HYDREX, INTEGRAL] = [
  exchange("Aero Basic Pools"),
  exchange("Aero Basic Pools", true),
  exchange("Aero Slipstream"),
  exchange("Aerodrome Basic Pools"),
  exchange("Hydrex Classic Pools"),
  exchange("Hydrex Integral"),
];
const SPACING = 100;

// A pool of `token` against `anchor` (USDC by default). `now` is what it holds at the block priced and `held` what it
// held through the window before, if different, both in whole tokens with the token's first. A concentrated pool's
// tick follows the price those give. A pool `since` a block has no state before it.
type Fake = {
  exchange: Exchange;
  token: Token;
  now: [number, number];
  held?: [number, number];
  anchor?: Address;
  stable?: boolean;
  since?: number;
};

function market(pools: Fake[], answers = ANSWERS) {
  const asked = new Set<string>();
  const blocks = new Map<string, Set<number | "latest">>();
  const addressOf = (i: number): Address => `0x${(0xa0 + i).toString(16).padStart(40, "0")}`;
  const pluginOf = (i: number): Address => `0x${(0xc0 + i).toString(16).padStart(40, "0")}`;
  const anchorOf = (pool: Fake) => ANCHORS.find(({ address }) => same(address, pool.anchor ?? USDC))!;
  const tokenFirst = (pool: Fake) => pool.token.address.toLowerCase() < anchorOf(pool).address.toLowerCase();
  const units = (pool: Fake, [token, anchor]: [number, number]) => {
    const amounts = [
      BigInt(token) * 10n ** BigInt(pool.token.decimals),
      BigInt(anchor) * 10n ** BigInt(anchorOf(pool).decimals),
    ];
    return tokenFirst(pool) ? amounts : amounts.reverse();
  };
  const reservesSums = (pool: Fake, block: number) =>
    units(pool, pool.held ?? pool.now).map((amount) => amount * BigInt(timeOf(block)));
  const tickSum = (pool: Fake, block: number) => {
    const [x, y] = units(pool, pool.held ?? pool.now).map(Number);
    return BigInt(Math.round((Math.log(y! / x!) / Math.log(1.0001)) * timeOf(block)));
  };
  const reader = async (
    calls: readonly Call[],
    { block = "latest" }: { block?: number | "latest" } = {},
  ): Promise<any> =>
    calls.map(({ address, functionName, args }) => {
      asked.add(address.toLowerCase());
      blocks.set(functionName, (blocks.get(functionName) ?? new Set()).add(block));
      const at = block === "latest" ? NEWEST : block;
      if (functionName === "getBlockNumber") return BigInt(NEWEST);
      if (functionName === "getCurrentBlockTimestamp") return BigInt(timeOf(at));
      const fed = ANCHORS.find(({ feed }) => same(feed, address));
      if (fed) {
        const answer = answers.get(fed.address);
        return answer === undefined ? undefined : [1n, BigInt(Math.round(answer * 1e8)), 0n, 0n, 1n];
      }
      const factory = EXCHANGES.find((each) => same(each.factory, address));
      if (factory) {
        if (functionName === "tickSpacings") return [SPACING];
        const [a, b, third] = args as [Address, Address, boolean | number | undefined];
        const i = pools.findIndex(
          (pool) =>
            pool.exchange === factory &&
            [a, b].some((x) => same(x, pool.token.address)) &&
            [a, b].some((x) => same(x, anchorOf(pool).address)) &&
            (factory.kind === "slipstream" ? third === SPACING : third === undefined || !!pool.stable === third),
        );
        return i < 0 ? zeroAddress : addressOf(i);
      }
      if (functionName === "balanceOf") {
        const i = pools.findIndex((_, i) => same(addressOf(i), args[0] as Address));
        const pool = pools[i];
        if (!pool || at < (pool.since ?? 0)) return undefined;
        const [first, second] = units(pool, pool.now);
        return same(address, pool.token.address) === tokenFirst(pool) ? first : second;
      }
      const i = pools.findIndex((_, i) => same(addressOf(i), address) || same(pluginOf(i), address));
      const pool = pools[i];
      if (!pool || at < (pool.since ?? 0)) return undefined;
      switch (functionName) {
        case "getReserves":
          return [...units(pool, pool.now), 0n];
        case "plugin":
          return pluginOf(i);
        case "observe":
          return pool.exchange.kind === "slipstream"
            ? [[tickSum(pool, at)], [0n]]
            : reservesSums(pool, at).map((sum) => [sum]);
        case "getTimepoints":
          return [[tickSum(pool, at)], [0n]];
        case "currentCumulativePrices":
          return [...reservesSums(pool, at), BigInt(timeOf(at))];
      }
    });
  return { reader, asked, blocks };
}

const priceOf = async (pools: Fake[], token = TOKEN, time = Infinity) =>
  (await pricesAt([token], new Map(), time, market(pools).reader)).of.get(token.address.toLowerCase());

test("USDC and EURC take Chainlink's prices, and a token priced in USDC takes USDC's", async () => {
  const { reader } = market([{ exchange: HYDREX, token: TOKEN, now: [2_000, 8_000] }]);
  const prices = await pricesAt([TOKEN], new Map(), Infinity, reader);
  assert.equal(prices.unit, "USD");
  close(prices.of.get(USDC.toLowerCase())!, USDC_USD);
  close(prices.of.get(EURC.toLowerCase())!, EURC_USD);
  close(prices.of.get(TOKEN.address)!, 4 * USDC_USD);
});

test("an anchor whose feed fails is priced like any other token", async () => {
  // 11,500 USDC against 10,000 EURC at $1.15 puts USDC at a dollar.
  const pools: Fake[] = [{ exchange: HYDREX, token: USDC_TOKEN, anchor: EURC, now: [11_500, 10_000] }];
  const answers = new Map([[EURC, EURC_USD]]);
  const prices = await pricesAt([USDC_TOKEN], new Map(), Infinity, market(pools, answers).reader);
  close(prices.of.get(USDC.toLowerCase())!, 1);
});

test("an anchor whose feed fails is priced first, so that the tokens priced against it are too", async () => {
  // EURC at 1.15 USDC, and TOKEN at 2 EURC, in Hydrex's pools only.
  const pools: Fake[] = [
    { exchange: HYDREX, token: EURC_TOKEN, now: [10_000, 11_500] },
    { exchange: HYDREX, token: TOKEN, anchor: EURC, now: [5_000, 10_000] },
  ];
  const answers = new Map([[USDC, USDC_USD]]);
  const prices = await pricesAt([TOKEN], new Map(), Infinity, market(pools, answers).reader);
  assert.equal(prices.unit, "USD");
  close(prices.of.get(EURC.toLowerCase())!, 1.15 * USDC_USD);
  close(prices.of.get(TOKEN.address)!, 2 * 1.15 * USDC_USD);
});

test("without any of Chainlink's prices, prices are in USDC, from the pools alone", async () => {
  const pools: Fake[] = [
    { exchange: HYDREX, token: EURC_TOKEN, now: [10_000, 11_500] },
    { exchange: HYDREX, token: TOKEN, anchor: EURC, now: [5_000, 10_000] },
  ];
  const prices = await pricesAt([TOKEN], new Map(), Infinity, market(pools, new Map()).reader);
  assert.equal(prices.unit, "USDC");
  assert.equal(prices.of.get(USDC.toLowerCase()), 1);
  close(prices.of.get(EURC.toLowerCase())!, 1.15);
  close(prices.of.get(TOKEN.address)!, 2.3);
});

test("each currency's rate goes with dollar prices, read with the anchors' feeds; prices in USDC have none", async () => {
  const pools: Fake[] = [{ exchange: HYDREX, token: TOKEN, now: [2_000, 8_000] }];
  // Also answers EUR / USD at 1.12 dollars a euro and GBP / USD at 1.34; CHF / USD and the other fiat feeds fail.
  const withRates = (answers?: Map<Address, number>) => {
    const { reader } = market(pools, answers);
    return async (calls: readonly Call[], options?: object): Promise<any> => {
      const replies = await reader(calls, options);
      return calls.map(({ address }, i) =>
        same(address, FIAT_FEEDS.EUR)
          ? [1n, 112_000_000n, 0n, 0n, 1n]
          : same(address, FIAT_FEEDS.GBP)
            ? [1n, 134_000_000n, 0n, 0n, 1n]
            : replies[i],
      );
    };
  };
  const inDollars = await pricesAt([TOKEN], new Map(), Infinity, withRates());
  assert.equal(inDollars.unit, "USD");
  assert.deepEqual(inDollars.rates, { EUR: 1.12, GBP: 1.34 });
  const inUsdc = await pricesAt([TOKEN], new Map(), Infinity, withRates(new Map()));
  assert.equal(inUsdc.unit, "USDC");
  assert.deepEqual(inUsdc.rates, {});
});

test("the deepest pool wins, now and at a flip", async () => {
  // 2,000 USDC deep at 2 USDC in Aero, 15,000 at 3 in Aerodrome, 8,000 at 4 in Hydrex Classic.
  const pools: Fake[] = [
    { exchange: AERO, token: TOKEN, now: [1_000, 2_000] },
    { exchange: AERODROME, token: TOKEN, now: [5_000, 15_000] },
    { exchange: HYDREX, token: TOKEN, now: [2_000, 8_000] },
  ];
  close((await priceOf(pools))!, 3 * USDC_USD);
  poolCache.clear();
  close((await priceOf(pools, TOKEN, NOW - 7 * 86_400))!, 3 * USDC_USD);
});

test("pool lookups go 1,000 to a batch, since each is cheap; other reads go in smaller ones", async () => {
  const { reader } = market([{ exchange: AERODROME, token: TOKEN, now: [5_000, 15_000] }]);
  const batches = new Map<string, Set<number | undefined>>();
  const watched = async (
    calls: readonly Call[],
    options?: { block?: number | "latest"; perBatch?: number },
  ): Promise<any> => {
    for (const { address, functionName } of calls) {
      const kind = EXCHANGES.some(({ factory }) => same(factory, address)) ? "lookup" : functionName;
      batches.set(kind, (batches.get(kind) ?? new Set()).add(options?.perBatch));
    }
    return reader(calls, options);
  };
  await pricesAt([TOKEN], new Map(), Infinity, watched);
  assert.deepEqual([...batches.get("lookup")!], [1_000]);
  assert.deepEqual([...batches.get("currentCumulativePrices")!], [undefined]);
});

test("every kind of pool gives its average over the window, not what it holds at its end", async () => {
  // At 2 USDC at the end, and 2.5 through the window; as token0 and as token1.
  for (const kind of [AERO, AERO_CL, AERODROME, HYDREX, INTEGRAL])
    for (const token of [TOKEN, LATE]) {
      poolCache.clear();
      const pool: Fake = { exchange: kind, token, now: [10_000, 20_000], held: [10_000, 25_000] };
      const price = await priceOf([pool], token);
      assert.ok(price !== undefined, `${kind.name} prices ${token.symbol}`);
      close(price, 2.5 * USDC_USD, 1e-6);
    }
});

test("a concentrated pool's depth is what it holds of each token", async () => {
  // Both at 3 USDC; the Aero Slipstream pool holds 30,000 USDC and the Aero pool 3,000.
  const pools: Fake[] = [
    { exchange: AERO, token: TOKEN, now: [1_000, 3_000], held: [1_000, 2_000] },
    { exchange: AERO_CL, token: TOKEN, now: [10_000, 30_000] },
  ];
  close((await priceOf(pools))!, 3 * USDC_USD, 1e-6);
});

test("sums are read at the block priced and the last block half an hour before the newest, reserves at the first", async () => {
  const pools: Fake[] = [{ exchange: AERODROME, token: TOKEN, now: [5_000, 15_000] }];
  const { reader, blocks } = market(pools);
  await pricesAt([TOKEN], new Map(), Infinity, reader);
  assert.deepEqual([...blocks.get("getBlockNumber")!], ["latest"]);
  assert.deepEqual([...blocks.get("getCurrentBlockTimestamp")!].slice(0, 1), ["latest"]);
  assert.deepEqual([...blocks.get("latestRoundData")!], [PRICED]);
  assert.deepEqual([...blocks.get("getReserves")!], [PRICED]);
  assert.deepEqual([...blocks.get("currentCumulativePrices")!].sort(), [START, PRICED]);
});

test("a pool younger than the window gives no price, so the next deepest does", async () => {
  const young: Fake = { exchange: AERO, token: TOKEN, now: [10_000, 40_000], since: START + 1 };
  const older: Fake = { exchange: AERODROME, token: TOKEN, now: [5_000, 15_000] };
  close((await priceOf([young, older]))!, 3 * USDC_USD);
  assert.equal(await priceOf([young]), undefined);
});

test("now is the newest block less a few; a flip, the last block before it, unless that is newer", async () => {
  const pools: Fake[] = [{ exchange: HYDREX, token: TOKEN, now: [2_000, 8_000] }];
  const feedBlocks = async (price: (reader: any) => Promise<unknown>) => {
    poolCache.clear();
    const { reader, blocks } = market(pools);
    await price(reader);
    return [...blocks.get("latestRoundData")!];
  };
  assert.deepEqual(await feedBlocks((reader) => pricesNow([TOKEN], new Map(), reader)), [PRICED]);
  const flip = NOW - 7 * 86_400;
  assert.deepEqual(await feedBlocks((reader) => pricesAt([TOKEN], new Map(), flip, reader)), [blockOf(flip)]);
  assert.deepEqual(await feedBlocks((reader) => pricesAt([TOKEN], new Map(), NOW + 60, reader)), [PRICED]);
});

test("Aero's stable factory prices on the stable curve", async () => {
  for (const token of [TOKEN, LATE]) {
    const price = await priceOf([{ exchange: AERO_STABLE, token, now: [1_100, 900] }], token);
    close(price!, pairPrice(1_100, 900, true) * USDC_USD);
  }
});
