import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { zeroAddress, type Address } from "viem";
import { SETTLED, same, type Call } from "../src/rpc.ts";
import { ANCHORS, FIAT_FEEDS, EXCHANGES, HYDREX_PRICING, PRICING, swapperOf, type Exchange } from "../src/config.ts";
import {
  BY_ID,
  WINDOW,
  forget,
  pairPrice,
  pricesAt,
  pricesAtFlip,
  pricesNow,
  quotesOf,
  tickPrice,
  waysFor,
  type Token,
} from "../src/prices.ts";

beforeEach(forget);

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

test("prices come from Aero's, Aerodrome's and Hydrex's pools, in that order, and an epoch's from Hydrex's", () => {
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
  assert.deepEqual(
    HYDREX_PRICING.map(({ name }) => name),
    ["Hydrex Classic Pools", "Hydrex Integral"],
  );
});

const NOW = 1_792_800_000;
// Prices now are read at the newest block less those an RPC may not have yet. The fake chain makes a block every seven
// seconds, so nothing may count on Base's two, and its window starts half an hour before the newest block, not before
// the one priced.
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
// tick follows the price those give, and its `liquidity` at the price, by default plenty, is that of a basic pool
// holding `inRange` times what it holds. A pool `since` a block has no state before it.
type Fake = {
  exchange: Exchange;
  token: Token;
  now: [number, number];
  held?: [number, number];
  anchor?: Address;
  stable?: boolean;
  since?: number;
  inRange?: number;
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
  const sqrtPriceOf = (pool: Fake) => {
    const [x, y] = units(pool, pool.now).map(Number);
    return BigInt(Math.round(Math.sqrt(y! / x!) * 2 ** 96));
  };
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
        case "slot0":
        case "globalState":
          return [sqrtPriceOf(pool), 0, 0, 0, 0, true];
        case "liquidity": {
          // A basic pool holding x and y at the price y / x has liquidity √(xy).
          const [x, y] = units(pool, pool.now).map(Number);
          return BigInt(Math.round(Math.sqrt(x! * y!) * (pool.inRange ?? 1_000)));
        }
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
  forget();
  close((await priceOf(pools, TOKEN, NOW - 7 * 86_400))!, 3 * USDC_USD);
});

test("an epoch's prices come from Hydrex's pools only; current ones from all", async () => {
  // 15,000 USDC deep at 3 in Aerodrome, 8,000 at 4 in Hydrex Classic.
  const pools: Fake[] = [
    { exchange: AERODROME, token: TOKEN, now: [5_000, 15_000] },
    { exchange: HYDREX, token: TOKEN, now: [2_000, 8_000] },
  ];
  const { reader, asked } = market(pools);
  close((await pricesAtFlip([TOKEN], new Map(), NOW - 7 * 86_400, reader)).of.get(TOKEN.address)!, 4 * USDC_USD);
  for (const { name, factory } of PRICING.filter((each) => !HYDREX_PRICING.includes(each)))
    assert.ok(!asked.has(factory.toLowerCase()), `an epoch's prices do not look in ${name}`);
  close((await pricesNow([TOKEN], new Map(), reader)).of.get(TOKEN.address)!, 3 * USDC_USD);
});

test("pool lookups go 1,000 to a batch, since each is cheap; other reads go in smaller ones", async () => {
  const { reader } = market([{ exchange: AERODROME, token: TOKEN, now: [5_000, 15_000] }]);
  const batches = new Map<string, Set<number | undefined>>();
  const watched = async (
    calls: readonly Call[],
    options?: { block?: number | "latest"; perBatch?: number },
  ): Promise<any> => {
    for (const { address, functionName } of calls) {
      const lookup = functionName !== "tickSpacings" && EXCHANGES.some(({ factory }) => same(factory, address));
      const kind = lookup ? "lookup" : functionName;
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
      forget();
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

test("a pool holding under $250 of its anchor is dropped before its sums are read", async () => {
  // 200 USDC in Aerodrome, at 2 USDC; 4,000 USDC in Hydrex Classic, at 4.
  const { reader } = market([
    { exchange: AERODROME, token: TOKEN, now: [100, 200] },
    { exchange: HYDREX, token: TOKEN, now: [1_000, 4_000] },
  ]);
  const summed = new Set<string>();
  const watched = async (calls: readonly Call[], options?: { block?: number | "latest" }): Promise<any> => {
    for (const { address, functionName } of calls)
      if (functionName === "currentCumulativePrices") summed.add(address.toLowerCase());
    return reader(calls, options);
  };
  close((await pricesAt([TOKEN], new Map(), Infinity, watched)).of.get(TOKEN.address)!, 4 * USDC_USD);
  assert.equal(summed.size, 1, "only the Hydrex pool's sums are read");
});

test("a concentrated pool counts only the liquidity at its price, not what it parks away from it", async () => {
  // The Slipstream pool holds 20,000 USDC, but its liquidity at the price is that of a basic pool holding 20 USDC; the
  // Aero pool holds 3,000 USDC at 3.
  const pools: Fake[] = [
    { exchange: AERO, token: TOKEN, now: [1_000, 3_000] },
    { exchange: AERO_CL, token: TOKEN, now: [10_000, 20_000], inRange: 0.001 },
  ];
  close((await priceOf(pools))!, 3 * USDC_USD, 1e-6);
});

test("a failed read of the pools, at either end of the window, leaves them unpriced and keeps Chainlink's prices", async () => {
  const { reader } = market([{ exchange: AERODROME, token: TOKEN, now: [5_000, 15_000] }]);
  const failing =
    (fails: (calls: readonly Call[], block: number | "latest") => boolean) =>
    async (calls: readonly Call[], options?: { block?: number | "latest" }): Promise<any> => {
      if (fails(calls, options?.block ?? "latest")) throw new Error("No Base RPC answered eth_call.");
      return reader(calls, options);
    };
  const sums = failing(
    (calls, block) => block === START && calls.some((c) => c.functionName === "currentCumulativePrices"),
  );
  const search = failing(
    (calls, block) =>
      typeof block === "number" && block < PRICED && calls[0]!.functionName === "getCurrentBlockTimestamp",
  );
  const reserves = failing((calls, block) => block === PRICED && calls.some((c) => c.functionName === "getReserves"));
  for (const rd of [sums, search, reserves]) {
    forget();
    const prices = await pricesAt([TOKEN], new Map(), Infinity, rd);
    close(prices.of.get(USDC.toLowerCase())!, USDC_USD);
    assert.equal(prices.of.get(TOKEN.address), undefined);
    assert.equal(prices.unread, true, "and say some pools went unread");
  }
  assert.equal((await pricesAt([TOKEN], new Map(), Infinity, reader)).unread, undefined);
});

test("an epoch's prices fail if a pool could not be read, rather than leave its token out", async () => {
  const { reader } = market([{ exchange: HYDREX, token: TOKEN, now: [2_000, 8_000] }]);
  const failing = async (calls: readonly Call[], options?: { block?: number | "latest" }): Promise<any> => {
    if (calls.some((c) => c.functionName === "currentCumulativePrices")) throw new Error("No Base RPC answered.");
    return reader(calls, options);
  };
  await assert.rejects(pricesAtFlip([TOKEN], new Map(), NOW - 7 * 86_400, failing), /could not be read/);
  close((await pricesAtFlip([TOKEN], new Map(), NOW - 7 * 86_400, reader)).of.get(TOKEN.address)!, 4 * USDC_USD);
});

test("a search for the window's start that fails after the pools are dropped is not left unhandled", async () => {
  // USDC's feed fails and its one pool, holding 100 EURC, is too thin to price it; then every search for a past block
  // fails.
  const { reader } = market(
    [{ exchange: HYDREX, token: USDC_TOKEN, anchor: EURC, now: [115, 100] }],
    new Map([[EURC, EURC_USD]]),
  );
  const failing = async (calls: readonly Call[], options?: { block?: number | "latest" }): Promise<any> => {
    if (typeof options?.block === "number" && calls[0]!.functionName === "getCurrentBlockTimestamp")
      await new Promise((_, fail) => setTimeout(() => fail(new Error("No Base RPC answered eth_call.")), 10));
    return reader(calls, options);
  };
  const unhandled: unknown[] = [];
  const note = (reason: unknown) => unhandled.push(reason);
  process.on("unhandledRejection", note);
  try {
    const prices = await pricesAt([], new Map(), Infinity, failing);
    assert.equal(prices.of.get(USDC.toLowerCase()), undefined);
    await new Promise((done) => setTimeout(done, 50));
    assert.deepEqual(unhandled, []);
  } finally {
    process.off("unhandledRejection", note);
  }
});

test("tokens that are all anchors with feeds read no past block", async () => {
  const { reader, blocks } = market([{ exchange: AERODROME, token: TOKEN, now: [5_000, 15_000] }]);
  await pricesAt([USDC_TOKEN, EURC_TOKEN], new Map(), Infinity, reader);
  assert.deepEqual([...blocks.get("getCurrentBlockTimestamp")!], ["latest"]);
});

test("searches read no block past the newest settled one, and find a past time's block once", async () => {
  const { reader } = market([{ exchange: HYDREX, token: TOKEN, now: [2_000, 8_000] }]);
  let probed: (number | "latest")[] = [];
  const watched = async (calls: readonly Call[], options?: { block?: number | "latest" }): Promise<any> => {
    if (calls.length === 1 && calls[0]!.functionName === "getCurrentBlockTimestamp")
      probed.push(options?.block ?? "latest");
    return reader(calls, options);
  };
  const flip = NOW - 7 * 86_400;
  await pricesAt([TOKEN], new Map(), flip, watched);
  assert.ok(
    probed.length > 2 && probed.every((block) => block === PRICED || (typeof block === "number" && block < PRICED)),
    String(probed),
  );
  probed = [];
  await pricesAt([TOKEN], new Map(), flip, watched);
  assert.deepEqual(probed, [PRICED], "only the newest settled block's time, to tell a past time from a recent one");
  // Prices now share their window's start while the newest block stays the same, and search again once it moves on.
  await pricesNow([TOKEN], new Map(), watched);
  probed = [];
  await Promise.all([pricesNow([TOKEN], new Map(), watched), pricesNow([TOKEN], new Map(), watched)]);
  assert.deepEqual(probed, [PRICED, PRICED], "the start found before");
  const later = async (calls: readonly Call[], options?: { block?: number | "latest" }): Promise<any> => {
    if ((options?.block ?? "latest") !== "latest") return watched(calls, options);
    const replies = await watched(calls, { ...options, block: NEWEST + 10 });
    return calls.map((c, i) => (c.functionName === "getBlockNumber" ? BigInt(NEWEST + 10) : replies[i]));
  };
  probed = [];
  await pricesNow([TOKEN], new Map(), later);
  assert.ok(probed.length > 2, String(probed));
  probed = [];
  await pricesNow([TOKEN], new Map(), watched);
  assert.ok(probed.length > 2, `only the latest start is kept: ${probed}`);
});

test("pricings at one flip at once share their searches", async () => {
  const { reader } = market([{ exchange: HYDREX, token: TOKEN, now: [2_000, 8_000] }]);
  let probes = 0;
  const watched = async (calls: readonly Call[], options?: { block?: number | "latest" }): Promise<any> => {
    const block = options?.block ?? "latest";
    if (calls[0]!.functionName === "getCurrentBlockTimestamp" && typeof block === "number" && block < PRICED) probes++;
    return reader(calls, options);
  };
  const flip = NOW - 7 * 86_400;
  await pricesAt([TOKEN], new Map(), flip, watched);
  const once = probes;
  forget();
  probes = 0;
  const each = await Promise.all([1, 2, 3].map(() => pricesAt([TOKEN], new Map(), flip, watched)));
  assert.equal(probes, once, "as many past blocks as one pricing");
  for (const prices of each) close(prices.of.get(TOKEN.address)!, 4 * USDC_USD);
});

test("an exchange whose pools cannot price is refused before anything is read", async () => {
  const { reader } = market([{ exchange: HYDREX, token: TOKEN, now: [2_000, 8_000] }]);
  let reads = 0;
  const counting = async (calls: readonly Call[], options?: { block?: number | "latest" }): Promise<any> => {
    reads++;
    return reader(calls, options);
  };
  const v2 = EXCHANGES.find(({ kind }) => kind === "v2")!;
  await assert.rejects(pricesAt([TOKEN], new Map(), Infinity, counting, [v2]), /Uniswap v2 cannot price tokens/);
  assert.equal(reads, 0);
});

test("a failed lookup leaves its pools unpriced and says so, so an epoch's prices fail until it is read", async () => {
  const { reader } = market([{ exchange: HYDREX, token: TOKEN, now: [2_000, 8_000] }]);
  const failing = async (calls: readonly Call[], options?: { block?: number | "latest" }): Promise<any> => {
    const replies = await reader(calls, options);
    return calls.map((c, i) => (c.functionName === "getPair" ? undefined : replies[i]));
  };
  const now = await pricesAt([TOKEN], new Map(), Infinity, failing);
  assert.equal(now.of.get(TOKEN.address), undefined);
  assert.equal(now.unread, true);
  await assert.rejects(pricesAtFlip([TOKEN], new Map(), NOW - 7 * 86_400, failing), /could not be read/);
  close((await pricesAtFlip([TOKEN], new Map(), NOW - 7 * 86_400, reader)).of.get(TOKEN.address)!, 4 * USDC_USD);
});

test("quotes are prices now without amounts, read once for every caller, and read again after a failure", async () => {
  // 2,000 TKN against 8,000 USDC is too thin to price 1,000 TKN, worth $4,000, but quotes TKN all the same.
  const { reader } = market([{ exchange: HYDREX, token: TOKEN, now: [2_000, 8_000] }]);
  let reads = 0;
  const counting = async (calls: readonly Call[], options?: { block?: number | "latest" }): Promise<any> => {
    reads++;
    return reader(calls, options);
  };
  const lots = new Map([[TOKEN.address, 1_000n * 10n ** 18n]]);
  assert.equal((await pricesNow([TOKEN], lots, reader)).of.get(TOKEN.address), undefined);
  forget();
  const quoted = await quotesOf([TOKEN], counting);
  close(quoted.of.get(TOKEN.address)!, 4 * USDC_USD);
  assert.equal(quoted.unread, undefined);
  const once = reads;
  await quotesOf([TOKEN], counting);
  assert.equal(reads, once, "nothing read again");
  forget();
  reads = 0;
  await Promise.all([quotesOf([TOKEN], counting), quotesOf([TOKEN], counting)]);
  assert.equal(reads, once, "callers at once share one read");
  forget();
  const failing = async (calls: readonly Call[], options?: { block?: number | "latest" }): Promise<any> => {
    if (calls.some((c) => c.functionName === "currentCumulativePrices")) throw new Error("No Base RPC answered.");
    return reader(calls, options);
  };
  const failed = await quotesOf([TOKEN], failing);
  assert.deepEqual([failed.of.size, failed.unread], [0, true]);
  close((await quotesOf([TOKEN], reader)).of.get(TOKEN.address)!, 4 * USDC_USD);
});

test("lookups among which Uniswap v4's are keep the usual batches", async () => {
  const { reader } = market([]);
  const batches: (number | undefined)[] = [];
  const watched = async (
    calls: readonly Call[],
    options?: { block?: number | "latest"; perBatch?: number },
  ): Promise<any> => {
    if (calls.some(({ functionName }) => functionName === "extsload")) batches.push(options?.perBatch);
    return reader(calls, options);
  };
  await waysFor([[TOKEN.address, USDC]], BY_ID, watched);
  assert.deepEqual(batches, [undefined]);
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
    forget();
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
