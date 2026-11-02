import { encodeAbiParameters, keccak256, parseAbi, zeroAddress, type Abi, type Address, type Hex } from "viem";
import { memo } from "./cache.ts";
import * as config from "./config.ts";
import type { Anchor, Exchange, ExchangeKind, Fiat } from "./config.ts";
import { figure, money, moneyAt, type Basis, type Money, type Rates } from "./format.ts";
import { call, now, read, same, type Call, type Read } from "./rpc.ts";

export type Token = { address: Address; decimals: number; symbol: string };
// Per whole token, by lower-case address. `standIns` are today's prices of tokens none of whose pools kept a history
// at a past time: only to weigh rewards against one another, never shown.
export type Prices = Basis & { of: Map<string, number>; standIns: Map<string, number> };
export const key = (address: string): string => address.toLowerCase();
// Prices of nothing, as for votes that earned nothing.
export const noPrices = (): Prices => ({ unit: "USD", of: new Map(), standIns: new Map() });
export const worthOf = (amount: bigint, decimals: number, price: number): number =>
  (Number(amount) / 10 ** decimals) * price;

// Pools

export type Hop = { exchange: number; pool: Address; tokenOut: Address; fee: number; tickSpacing: number };
// `stable` is set for a pool of reserves: true on the stable curve.
export type Way = Hop & { tokenIn: Address; stable?: boolean };
export const BY_ID = [...config.EXCHANGES].sort((a, b) => a.id - b.id);
export const exchangeOf = (id: number): Exchange => BY_ID[id]!;
export const pairKey = (a: Address, b: Address): string => `${key(a)} ${key(b)}`;

const factoryAbis = {
  algebra: parseAbi(["function poolByPair(address, address) view returns (address)"]),
  pair: parseAbi(["function getPair(address, address, bool stable) view returns (address)"]),
  solidly: parseAbi(["function getPool(address, address) view returns (address)"]),
  aerodrome: parseAbi(["function getPool(address, address, bool stable) view returns (address)"]),
  slipstream: parseAbi([
    "function getPool(address, address, int24 tickSpacing) view returns (address)",
    "function tickSpacings() view returns (int24[])",
  ]),
  v2: parseAbi(["function getPair(address, address) view returns (address)"]),
  v3: parseAbi(["function getPool(address, address, uint24 fee) view returns (address)"]),
  v4: parseAbi(["function extsload(bytes32 startSlot, uint256 nSlots) view returns (bytes32[])"]),
} satisfies Record<ExchangeKind, Abi>;
// Uniswap v4's standard pools without hooks, as [fee, tick spacing]; v3 takes the same fees.
const V4_POOLS = [
  [100, 1],
  [500, 10],
  [3000, 60],
  [10_000, 200],
] as const;

// Where Uniswap v4's PoolManager keeps a pool's state: slot 6, by pool id.
function v4Slot([a, b]: [Address, Address], fee: number, tickSpacing: number): Hex {
  const types = ["address", "address", "uint24", "int24", "address"].map((type) => ({ type }));
  const id = keccak256(encodeAbiParameters(types, [a, b, fee, tickSpacing, zeroAddress]));
  return keccak256(encodeAbiParameters([{ type: "bytes32" }, { type: "uint256" }], [id, 6n]));
}

type PoolFound = Omit<Way, "tokenIn" | "tokenOut">;
type Lookup = { call: Call; found(reply: unknown): PoolFound | undefined };
// An exchange's reads for a pair's pools, its tokens sorted: one per curve, fee tier or tick spacing.
function lookupsOn(exchange: Exchange, pair: [Address, Address], spacings: Map<number, number[]>): Lookup[] {
  const { id, factory, kind } = exchange;
  const abi: Abi = factoryAbis[kind];
  const lookup = (name: string, args: unknown[], way: Partial<PoolFound> = {}): Lookup => ({
    call: call(factory, abi, name, ...pair, ...args),
    found: (pool) =>
      typeof pool === "string" && !same(pool, zeroAddress)
        ? { exchange: id, pool: pool as Address, fee: 0, tickSpacing: 0, ...way }
        : undefined,
  });
  const curves = (name: string) => [false, true].map((stable) => lookup(name, [stable], { stable }));
  switch (kind) {
    case "algebra":
      return [lookup("poolByPair", [])];
    case "pair":
      return curves("getPair");
    case "aerodrome":
      return curves("getPool");
    case "solidly":
      return [lookup("getPool", [], { stable: !!exchange.stable })];
    case "v2":
      return [lookup("getPair", [])];
    case "slipstream":
      return (spacings.get(id) ?? []).map((spacing) => lookup("getPool", [spacing], { tickSpacing: spacing }));
    case "v3":
      return V4_POOLS.map(([fee]) => lookup("getPool", [fee], { fee }));
    case "v4":
      // A pool is there once its price is set, and worth trying while it holds liquidity.
      return V4_POOLS.map(([fee, tickSpacing]) => ({
        call: call(factory, abi, "extsload", v4Slot(pair, fee, tickSpacing), 4n),
        found: (reply) => {
          const [slot0, , , liquidity] = (reply as Hex[] | undefined) ?? [];
          if (!slot0 || !liquidity || !BigInt(slot0) || !(BigInt(liquidity) % 2n ** 128n)) return undefined;
          return { exchange: id, pool: zeroAddress, fee, tickSpacing };
        },
      }));
  }
}

// The pools found, by exchange and sorted pair, kept for the visit. A lookup that fails is asked again next time.
export const pools = new Map<string, Promise<PoolFound[]>>();
let spacingsRead: Promise<Map<number, number[]>> | undefined;
function spacings(rd: Read): Promise<Map<number, number[]>> {
  const slipstreams = BY_ID.filter(({ kind }) => kind === "slipstream");
  return (spacingsRead ??= rd(
    slipstreams.map(({ factory }) => call(factory, factoryAbis.slipstream, "tickSpacings")),
  ).then(
    (replies) => {
      if (replies.includes(undefined)) spacingsRead = undefined;
      return new Map(
        slipstreams.flatMap(({ id }, i) => {
          const found = replies[i];
          return found ? [[id, [...found]]] : [];
        }),
      );
    },
    (error: unknown) => {
      spacingsRead = undefined;
      throw error;
    },
  ));
}

// Each pair's pools on the exchanges given, in their order, by pairKey. Lookups not yet kept go in one read.
export async function waysFor(
  pairs: [Address, Address][],
  exchanges: Exchange[] = BY_ID,
  rd: Read = read,
): Promise<Map<string, Way[]>> {
  const sorted = (a: Address, b: Address): [Address, Address] => (key(a) < key(b) ? [a, b] : [b, a]);
  const at = (exchange: Exchange, pair: [Address, Address]) => `${exchange.id} ${pairKey(...sorted(...pair))}`;
  const missing = [
    ...new Map(pairs.flatMap((pair) => exchanges.map((e) => [at(e, pair), [e, sorted(...pair)] as const]))).entries(),
  ].filter(([id]) => !pools.has(id));
  if (missing.length) {
    const needsSpacings = missing.some(([, [exchange]]) => exchange.kind === "slipstream");
    const all = (needsSpacings ? spacings(rd) : Promise.resolve(new Map<number, number[]>())).then(async (known) => {
      const each = missing.map(([, [exchange, pair]]) => lookupsOn(exchange, pair, known));
      const replies = await rd(each.flat().map(({ call }) => call));
      let next = 0;
      return each.map((lookups, i) => {
        const answers = lookups.map(() => replies[next++]);
        const [exchange] = missing[i]![1];
        const failed = answers.includes(undefined) || (exchange.kind === "slipstream" && !known.has(exchange.id));
        return { failed, found: lookups.flatMap((lookup, j) => lookup.found(answers[j]) ?? []) };
      });
    });
    missing.forEach(([id], i) => {
      const found = all.then(
        (each) => {
          if (each[i]!.failed) pools.delete(id);
          return each[i]!.found;
        },
        (error: unknown) => {
          pools.delete(id);
          throw error;
        },
      );
      pools.set(id, found);
    });
  }
  const unique = [...new Map(pairs.map((pair) => [pairKey(...pair), pair])).values()];
  return new Map(
    await Promise.all(
      unique.map(async ([tokenIn, tokenOut]) => {
        const found = await Promise.all(exchanges.map((exchange) => pools.get(at(exchange, [tokenIn, tokenOut]))!));
        return [pairKey(tokenIn, tokenOut), found.flat().map((way) => ({ ...way, tokenIn, tokenOut }))] as const;
      }),
    ),
  );
}

// Prices

// Pools are averaged over the half hour before the flip. A pool prices a token only if it holds at least $250 of each
// side, and ten times the value priced. Classic pairs observe at most every half hour, when they trade.
export const WINDOW = 1800;
export const SPAN = 4 * WINDOW;
const FLOOR = 250;
const DEPTH = 10;

const pairAbi = parseAbi([
  "function getReserves() view returns (uint256 reserve0, uint256 reserve1, uint256 blockTimestampLast)",
  "function observe(uint32[] secondsAgos) view returns (uint256[] reserve0Cumulatives, uint256[] reserve1Cumulatives)",
  "function observationLength() view returns (uint256)",
  "function observations(uint256 index) view returns (uint256 timestamp, uint256 reserve0Cumulative, uint256 reserve1Cumulative)",
  "function currentCumulativePrices() view returns (uint256 reserve0Cumulative, uint256 reserve1Cumulative, uint256 blockTimestamp)",
]);
const algebraPoolAbi = parseAbi([
  "function getReserves() view returns (uint128 reserve0, uint128 reserve1)",
  "function globalState() view returns (uint160 price, int24 tick, uint16 lastFee, uint8 pluginConfig, uint16 communityFee, bool unlocked)",
  "function plugin() view returns (address)",
  "function getTimepoints(uint32[] secondsAgos) view returns (int56[] tickCumulatives, uint88[] volatilityCumulatives)",
]);
const feedAbi = parseAbi([
  "function latestRoundData() view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)",
  "function getRoundData(uint80 roundId) view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)",
]);

type Round = readonly [bigint, bigint, bigint, bigint, bigint];
// Running sums of a pool's reserves: [timestamp, reserve0, reserve1].
type Observation = readonly [bigint, bigint, bigint];
type Pool = { address: Address; exchange: Exchange; stable: boolean; token: Token; anchor: Anchor };
type Measured = { pool: Pool; spot: number; depth: number; state: unknown[] };
const whole = (amount: bigint, decimals: number): number => Number(amount) / 10 ** decimals;

// Token0's price in token1, in whole tokens, at a concentrated pool's tick.
export const tickPrice = (tick: number, decimals0: number, decimals1: number): number =>
  1.0001 ** tick * 10 ** (decimals0 - decimals1);
// Token0's price in token1 from whole-token reserves: x × y = k, or x³y + xy³ = k if stable.
export const pairPrice = (x: number, y: number, stable: boolean): number =>
  stable ? (3 * x * x * y + y ** 3) / (x ** 3 + 3 * x * y * y) : y / x;
// Token0's average price in token1 between two observations, unless too far apart, or the pool held nothing.
export function observedPrice(
  first: Observation,
  last: Observation,
  decimals0: number,
  decimals1: number,
  stable: boolean,
) {
  const elapsed = last[0] - first[0];
  if (elapsed <= 0n || elapsed > BigInt(SPAN)) return undefined;
  const [x, y] = [whole((last[1] - first[1]) / elapsed, decimals0), whole((last[2] - first[2]) / elapsed, decimals1)];
  return x > 0 && y > 0 ? pairPrice(x, y, stable) : undefined;
}

// A search for the first index in [lo, hi) whose read passes, every later one passing too. It ends with hi there;
// `seen` keeps the reads, those at hi - 1 and hi included. A failed read ends it.
export type Search = {
  lo: number;
  hi: number;
  probe(index: number): Call;
  passes(value: unknown): boolean;
  seen: Map<number, unknown>;
  failed?: boolean;
};
export function points(lo: number, hi: number, width = 16): number[] {
  const n = hi - lo;
  return n <= width
    ? Array.from({ length: n }, (_, i) => lo + i)
    : Array.from({ length: width }, (_, i) => lo + Math.floor((i * n) / width));
}
// Runs the searches together, one read a round.
export async function narrow(searches: Search[], rd: Read = read): Promise<void> {
  for (;;) {
    const open = searches.filter((search) => search.lo < search.hi && !search.failed);
    if (!open.length) return;
    const probes = open.map(({ lo, hi }) => points(lo, hi));
    const values = await rd(open.flatMap((search, i) => probes[i]!.map((index) => search.probe(index))));
    let k = 0;
    open.forEach((search, i) => {
      for (const index of probes[i]!) {
        const value = values[k++];
        if (value === undefined) search.failed = true;
        if (search.failed) continue;
        search.seen.set(index, value);
        if (search.passes(value)) search.hi = Math.min(search.hi, index);
        else if (index < search.hi) search.lo = index + 1;
      }
    });
  }
}

// Chainlink's answers at `flip`, Infinity being now: the latest rounds, then a search for the rounds in effect at the
// flip. A feed without a round of that time gives no price: a price from another time would pass for the flip's.
export async function feedsAt(feeds: Address[], flip: number, rd: Read = read): Promise<(number | undefined)[]> {
  const latest = await rd(feeds.map((feed) => call(feed, feedAbi, "latestRoundData")));
  const searchOf = (i: number): Search | undefined => {
    const round = latest[i];
    if (!round || Number(round[3]) <= flip) return undefined;
    // A round id holds its phase above its lowest 64 bits.
    const phase = (round[0] >> 64n) << 64n;
    return {
      lo: 1,
      hi: Number(round[0] - phase),
      probe: (index) => call(feeds[i]!, feedAbi, "getRoundData", phase + BigInt(index)),
      passes: (found) => Number((found as Round)[3]) > flip,
      seen: new Map(),
    };
  };
  const searches = feeds.map((_, i) => searchOf(i));
  await narrow(
    searches.filter((search) => !!search),
    rd,
  );
  // A search that a failed read ended runs once more.
  const again = searches.map((search, i) => (search?.failed ? searchOf(i) : search));
  await narrow(again.filter((search, i) => !!search && search !== searches[i]) as Search[], rd);
  return feeds.map((_, i) => {
    const search = again[i];
    const round = search
      ? search.failed
        ? undefined
        : (search.seen.get(search.hi - 1) as Round | undefined)
      : latest[i];
    return round && Number(round[1]) / 1e8;
  });
}

// Every kind of pool sorts its tokens by address.
const tokenFirst = ({ token, anchor }: Pool): boolean => key(token.address) < key(anchor.address);
const decimalsOf = (pool: Pool): [number, number] =>
  tokenFirst(pool) ? [pool.token.decimals, pool.anchor.decimals] : [pool.anchor.decimals, pool.token.decimals];
const inAnchor = (pool: Pool, price0: number): number => (tokenFirst(pool) ? price0 : 1 / price0);

// How a kind of pool prices: its reads now, reserves first; token0's price in token1 now; and the reads or searches
// for its average over the window, with the average they give.
type History = { calls: Call[]; searches: Search[]; price(replies: unknown[]): number | undefined };
type Pricing = {
  abi: Abi;
  state: string[];
  spot(reserve0: number, reserve1: number, state: unknown[], pool: Pool): number;
  history(entry: Measured, flip: number, ago: number): History;
};
const reservesSpot: Pricing["spot"] = (x, y, _, pool) => pairPrice(x, y, pool.stable);
// Aero's basic pools read back their reserves' running sums at any time in their history.
const aero: Pricing = {
  abi: pairAbi,
  state: ["getReserves"],
  spot: reservesSpot,
  history: ({ pool }, _, ago) => ({
    calls: [call(pool.address, pairAbi, "observe", [ago + WINDOW, ago])],
    searches: [],
    price: ([found]) => {
      const [sums0, sums1] = (found as [bigint[], bigint[]] | undefined) ?? [];
      if (!sums0 || !sums1) return undefined;
      return observedPrice(
        [0n, sums0[0]!, sums1[0]!],
        [BigInt(WINDOW), sums0[1]!, sums1[1]!],
        ...decimalsOf(pool),
        pool.stable,
      );
    },
  }),
};
// Aerodrome's and Hydrex's classic pools: the last observation before the window, and the first after it, or now.
const classic: Pricing = {
  abi: pairAbi,
  state: ["getReserves", "observationLength", "currentCumulativePrices"],
  spot: reservesSpot,
  history: ({ pool, state: [length, current] }, flip, ago) => {
    const count = Number(length as bigint);
    const lo = Math.max(0, count - Math.ceil((ago + WINDOW) / WINDOW) - 3);
    const [start, end] = [flip - WINDOW + 1, flip].map((time): Search => ({
      lo,
      hi: count,
      probe: (index) => call(pool.address, pairAbi, "observations", BigInt(index)),
      passes: (observation) => Number((observation as Observation)[0]) >= time,
      seen: new Map(),
    })) as [Search, Search];
    return {
      calls: [],
      searches: [start, end],
      price: () => {
        const [sums0, sums1, time] = current as bigint[];
        const first = start.seen.get(start.hi - 1) as Observation | undefined;
        const last =
          end.hi < count ? (end.seen.get(end.hi) as Observation | undefined) : ([time!, sums0!, sums1!] as const);
        if (start.failed || end.failed || !first || !last) return undefined;
        return observedPrice(first, last, ...decimalsOf(pool), pool.stable);
      },
    };
  },
};
// Hydrex Integral's concentrated pools: the average tick, from their plugin.
const algebra: Pricing = {
  abi: algebraPoolAbi,
  state: ["getReserves", "globalState", "plugin"],
  spot: (_, __, [globalState], pool) => tickPrice((globalState as [bigint, number])[1], ...decimalsOf(pool)),
  history: ({ pool, state: [, plugin] }, _, ago) => ({
    calls: [call(plugin as Address, algebraPoolAbi, "getTimepoints", [ago + WINDOW, ago])],
    searches: [],
    price: ([found]) => {
      const ticks = (found as [bigint[]] | undefined)?.[0];
      return ticks && tickPrice(Number(ticks[1]! - ticks[0]!) / WINDOW, ...decimalsOf(pool));
    },
  }),
};
const PRICING: Partial<Record<ExchangeKind, Pricing>> = { solidly: aero, aerodrome: classic, pair: classic, algebra };
function pricingOf({ kind, name }: Exchange): Pricing {
  const found = PRICING[kind];
  if (!found) throw new Error(`${name} cannot price tokens.`);
  return found;
}

// Each pool's price and depth now, in the prices' unit; pools too thin for the amount priced are dropped.
async function measure(pools: Pool[], prices: Prices, amounts: Map<string, bigint>, rd: Read): Promise<Measured[]> {
  const kinds = pools.map(({ exchange }) => pricingOf(exchange));
  const replies = await rd(
    pools.flatMap(({ address }, i) => kinds[i]!.state.map((name) => call(address, kinds[i]!.abi, name))),
  );
  let next = 0;
  return pools.flatMap((pool, i): Measured[] => {
    const kind = kinds[i]!;
    const [reserves, ...state] = replies.slice(next, (next += kind.state.length)) as [bigint[], ...unknown[]];
    if (!reserves || state.includes(undefined)) return [];
    const [decimals0, decimals1] = decimalsOf(pool);
    const [x, y] = [whole(reserves[0]!, decimals0), whole(reserves[1]!, decimals1)];
    if (!(x > 0 && y > 0)) return [];
    const anchorPrice = prices.of.get(key(pool.anchor.address))!;
    const spot = inAnchor(pool, kind.spot(x, y, state, pool)) * anchorPrice;
    const [tokenReserve, anchorReserve] = tokenFirst(pool) ? [x, y] : [y, x];
    const depth = Math.min(tokenReserve * spot, anchorReserve * anchorPrice);
    const value = whole(amounts.get(key(pool.token.address)) ?? 0n, pool.token.decimals) * spot;
    return Number.isFinite(spot) && depth >= Math.max(FLOOR, DEPTH * value) ? [{ pool, spot, depth, state }] : [];
  });
}

// Each pool's price at the flip, from its history, in one read: undefined where it has none.
async function atFlipIn(entries: Measured[], prices: Prices, flip: number, ago: number, rd: Read) {
  const found = new Map<Measured, number | undefined>();
  const histories = entries.map((entry) => pricingOf(entry.pool.exchange).history(entry, flip, ago));
  if (!entries.length) return found;
  const [replies] = await Promise.all([
    rd(histories.flatMap(({ calls }) => calls)),
    narrow(
      histories.flatMap(({ searches }) => searches),
      rd,
    ),
  ]);
  let next = 0;
  entries.forEach((entry, i) => {
    const { calls, price } = histories[i]!;
    const price0 = price(replies.slice(next, (next += calls.length)));
    const atFlip = price0 && inAnchor(entry.pool, price0) * prices.of.get(key(entry.pool.anchor.address))!;
    found.set(entry, atFlip && Number.isFinite(atFlip) && atFlip > 0 ? atFlip : undefined);
  });
  return found;
}

// Prices the tokens in their deepest pools against the anchors priced, of two as deep the first in `exchanges`. Now, a
// pool whose history falls short gives its price now; at a past flip, the next deepest is tried, and without any, the
// deepest's price now only stands in.
async function inPools(
  tokens: Token[],
  prices: Prices,
  amounts: Map<string, bigint>,
  flip: number,
  ago: number,
  exchanges: Exchange[],
  rd: Read,
) {
  if (!tokens.length) return;
  const anchors = config.ANCHORS.filter(({ address }) => prices.of.has(key(address)));
  const pairs = tokens.flatMap((token) => anchors.map((anchor) => ({ token, anchor })));
  const ways = await waysFor(
    pairs.map(({ token, anchor }) => [token.address, anchor.address]),
    exchanges,
    rd,
  );
  const rank = (pool: Pool) => exchanges.findIndex(({ id }) => id === pool.exchange.id);
  const candidates = pairs
    .flatMap(({ token, anchor }) =>
      ways.get(pairKey(token.address, anchor.address))!.map((way): Pool => ({
        address: way.pool,
        exchange: exchangeOf(way.exchange),
        stable: !!way.stable,
        token,
        anchor,
      })),
    )
    .sort((a, b) => rank(a) - rank(b));
  const ranked = new Map<string, Measured[]>();
  for (const entry of await measure(candidates, prices, amounts, rd)) {
    const token = key(entry.pool.token.address);
    ranked.set(token, [...(ranked.get(token) ?? []), entry]);
  }
  for (const pools of ranked.values()) pools.sort((a, b) => b.depth - a.depth);
  const found = await atFlipIn(
    [...ranked.values()].map((pools) => pools[0]!),
    prices,
    flip,
    ago,
    rd,
  );
  if (ago) {
    const rest = [...ranked.values()]
      .filter((pools) => found.get(pools[0]!) === undefined)
      .flatMap((pools) => pools.slice(1));
    for (const [entry, price] of await atFlipIn(rest, prices, flip, ago, rd)) found.set(entry, price);
  }
  for (const [token, pools] of ranked) {
    const price = pools.map((entry) => found.get(entry)).find((each) => each !== undefined);
    if (price !== undefined) prices.of.set(token, price);
    else if (!ago) prices.of.set(token, pools[0]!.spot);
    else prices.standIns.set(token, pools[0]!.spot);
  }
  for (const token of prices.of.keys()) prices.standIns.delete(token);
}

// Prices per whole token at the flip, `time` being now. Anchors take their Chainlink feed, in dollars, with each
// currency's rate; without any, prices are in USDC at 1 USDC each. Anchors without a price come next, then the others.
// `amounts` is how much will be priced.
export async function pricesAt(
  tokens: Token[],
  amounts: Map<string, bigint>,
  flip: number,
  time: number,
  exchanges: Exchange[],
  rd: Read = read,
): Promise<Prices> {
  exchanges.forEach(pricingOf);
  const ago = Math.max(0, time - flip);
  const fiat = Object.entries(config.FIAT_FEEDS) as [Fiat, Address][];
  const feeds = await feedsAt(
    [...config.ANCHORS.map(({ feed }) => feed), ...fiat.map(([, feed]) => feed)],
    ago ? flip : Infinity,
    rd,
  );
  const fed = config.ANCHORS.flatMap(({ address }, i) =>
    feeds[i] === undefined ? [] : [[key(address), feeds[i]] as const],
  );
  const rates: Rates = Object.fromEntries(
    fiat.flatMap(([currency], i) =>
      feeds[config.ANCHORS.length + i] === undefined ? [] : [[currency, feeds[config.ANCHORS.length + i]]],
    ),
  );
  const prices: Prices = fed.length
    ? { unit: "USD", rates, of: new Map(fed), standIns: new Map() }
    : { unit: "USDC", rates: {}, of: new Map([[key(config.USDC), 1]]), standIns: new Map() };
  const unpriced = config.ANCHORS.filter(({ address }) => !prices.of.has(key(address)));
  await inPools(
    unpriced.map(({ address, decimals }) => ({ address, decimals, symbol: "" })),
    prices,
    amounts,
    flip,
    ago,
    exchanges,
    rd,
  );
  await inPools(
    tokens.filter(({ address }) => !prices.of.has(key(address))),
    prices,
    amounts,
    flip,
    ago,
    exchanges,
    rd,
  );
  return prices;
}

export function pricesNow(tokens: Token[], amounts = new Map<string, bigint>(), rd: Read = read): Promise<Prices> {
  const time = now();
  return pricesAt(tokens, amounts, time, time, config.SWAP_PRICING, rd);
}
export const pricesAtFlip = (
  tokens: Token[],
  amounts: Map<string, bigint>,
  flip: number,
  rd: Read = read,
): Promise<Prices> => pricesAt(tokens, amounts, flip, now(), config.HYDREX_PRICING, rd);
// The anchors' prices now, as gas needs ETH's: read at most once a minute.
export const anchorsNow = (): Promise<Prices | undefined> =>
  memo("anchors", () => pricesNow([]), 60_000).catch(() => undefined);

// What wei of ETH costs at the prices given, ETH's among them; gas in words, to the cent, or else in ETH.
export function ethCost(wei: bigint, prices: Prices | undefined): Money | undefined {
  const eth = prices?.of.get(key(config.WETH));
  return eth === undefined ? undefined : moneyAt((Number(wei) / 1e18) * eth, prices!);
}
export const gasWords = (wei: bigint, prices: Prices | undefined): string => {
  const cost = ethCost(wei, prices);
  return cost ? money(cost, true) : `${figure(wei, 18)} ETH`;
};
