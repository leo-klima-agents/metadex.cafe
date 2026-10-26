import { parseAbi, type Abi, type Address } from "viem";
import { call, now, read, same, type Call } from "./chain.ts";
import {
  ANCHORS,
  FIAT_FEEDS,
  HYDREX_PRICING,
  SWAP_PRICING,
  USDC,
  type Anchor,
  type Exchange,
  type ExchangeKind,
  type Feed,
} from "./config.ts";
import type { Basis, Fiat, Rates, Unit } from "./format.ts";
import { exchangeOf, pairKey, waysFor } from "./pools.ts";

export type Token = { address: Address; decimals: number; symbol: string };
// Prices at a time: in dollars, or in USDC when none of Chainlink's dollar prices for the time could be found; with
// Chainlink's EUR / USD then, the euro's price in dollars, if found.
export type Prices = Basis & {
  // Per whole token, by lower-case address.
  of: Map<string, number>;
  // At a past time, today's price of each token none of whose pools kept a history then: only to weigh rewards against
  // one another, never shown.
  standIns: Map<string, number>;
};

export const pricesIn = (unit: Unit, entries: [string, number][] = [], rates: Rates = {}): Prices => ({
  unit,
  rates,
  of: new Map(entries),
  standIns: new Map(),
});

// Prices now of the anchors alone, as gas needs ETH's, read at most once a minute. A failed read is not kept, unless a
// newer one took its place meanwhile.
let anchorsRead: { at: number; prices: Promise<Prices | undefined> } | undefined;
export function anchorsNow(): Promise<Prices | undefined> {
  if (anchorsRead && Date.now() - anchorsRead.at < 60_000) return anchorsRead.prices;
  const entry = {
    at: Date.now(),
    prices: pricesNow([], new Map()).catch((error: unknown) => {
      console.error(error);
      if (anchorsRead === entry) anchorsRead = undefined;
      return undefined;
    }),
  };
  anchorsRead = entry;
  return entry.prices;
}

// The feeds' latest rounds, which every price now starts from: read at most once a minute for each reader, and shared.
// A failed read is not kept.
const FEEDS_NOW = 60_000;
const feedsRead = new WeakMap<typeof read, { at: number; feeds: Promise<(number | undefined)[]> }>();
function feedsNow(feeds: Feed[], reader: typeof read): Promise<(number | undefined)[]> {
  const kept = feedsRead.get(reader);
  if (kept && Date.now() - kept.at < FEEDS_NOW) return kept.feeds;
  const entry = {
    at: Date.now(),
    feeds: feedsAt(feeds, Infinity, reader).catch((error: unknown) => {
      if (feedsRead.get(reader) === entry) feedsRead.delete(reader);
      throw error;
    }),
  };
  feedsRead.set(reader, entry);
  return entry.feeds;
}

// Pools are averaged over the half hour before the flip, when rewards become final.
export const WINDOW = 1800;
// A pool prices a token only if it holds at least $250 of each side, and ten times the value priced.
const FLOOR = 250;
const DEPTH = 10;
// Classic pairs observe at most every half hour, when they trade; observations further apart no longer price the flip.
export const SPAN = 4 * WINDOW;
const POINTS_PER_ROUND = 16;

// Pools of reserves: Aero's basic pools answer getReserves and observe, Aerodrome's and Hydrex's classic pools all but
// observe.
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
]);
const pluginAbi = parseAbi([
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
// A pool now: the token's price, its depth, both in the prices' unit, and its reads past the reserves.
type Measured = { pool: Pool; spot: number; depth: number; state: unknown[] };

const key = (address: string): string => address.toLowerCase();
const whole = (amount: bigint, decimals: number): number => Number(amount) / 10 ** decimals;

// What an amount of a token is worth at a price per whole token, in the price's unit.
export const worthOf = (amount: bigint, decimals: number, price: number): number => whole(amount, decimals) * price;

// Token0's price in token1, in whole tokens, at a concentrated pool's tick.
export const tickPrice = (tick: number, decimals0: number, decimals1: number): number =>
  1.0001 ** tick * 10 ** (decimals0 - decimals1);

// Token0's price in token1 from whole-token reserves: x × y = k, or x³y + xy³ = k if stable.
export function pairPrice(reserve0: number, reserve1: number, stable: boolean): number {
  if (!stable) return reserve1 / reserve0;
  const [x, y] = [reserve0, reserve1];
  return (3 * x * x * y + y ** 3) / (x ** 3 + 3 * x * y * y);
}

// Token0's average price in token1 between two observations; undefined if they are too far apart, or the pool was
// empty.
export function observedPrice(
  first: Observation,
  last: Observation,
  decimals0: number,
  decimals1: number,
  stable: boolean,
): number | undefined {
  const elapsed = last[0] - first[0];
  if (elapsed <= 0n || elapsed > BigInt(SPAN)) return undefined;
  const reserve0 = whole((last[1] - first[1]) / elapsed, decimals0);
  const reserve1 = whole((last[2] - first[2]) / elapsed, decimals1);
  return reserve0 > 0 && reserve1 > 0 ? pairPrice(reserve0, reserve1, stable) : undefined;
}

// A search for the first index in [lo, hi) whose read passes, every later one passing too. It ends with hi there, or
// unmoved if none passes; `seen` keeps the reads, those at hi - 1 and hi included.
export type Search = {
  lo: number;
  hi: number;
  probe(index: number): Call;
  passes(value: unknown): boolean;
  seen: Map<number, unknown>;
  failed?: boolean;
};

export function points(lo: number, hi: number, width = POINTS_PER_ROUND): number[] {
  const n = hi - lo;
  if (n <= width) return Array.from({ length: n }, (_, i) => lo + i);
  return Array.from({ length: width }, (_, i) => lo + Math.floor((i * n) / width));
}

// Runs the searches together, one read a round. A failed read ends its search.
export async function narrow(searches: Search[], reader: typeof read = read): Promise<void> {
  for (;;) {
    const open = searches.filter((search) => search.lo < search.hi && !search.failed);
    if (!open.length) return;
    const probes = open.map(({ lo, hi }) => points(lo, hi));
    const values = await reader(open.flatMap((search, i) => probes[i]!.map((index) => search.probe(index))));
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

// Chainlink's prices at the flip; Infinity is now. One read for the latest rounds, then one search for the feeds updated
// since the flip. A feed that does not answer has no price, nor one whose round then cannot be found, as when the feed
// moved to a new aggregator since: a price from another time would pass for the flip's.
export async function feedsAt(
  feeds: Feed[],
  flip: number,
  reader: typeof read = read,
): Promise<(number | undefined)[]> {
  const latest = (await reader(feeds.map(({ address }) => call(address, feedAbi, "latestRoundData")))) as (
    Round | undefined
  )[];
  const searchOf = (i: number): Search | undefined => {
    const address = feeds[i]!.address;
    const round = latest[i];
    if (!round || Number(round[3]) <= flip) return undefined;
    // A round id holds its phase above its lowest 64 bits, and its number within the phase in them.
    const phase = (round[0] >> 64n) << 64n;
    return {
      lo: 1,
      hi: Number(round[0] - phase),
      probe: (index) => call(address, feedAbi, "getRoundData", phase + BigInt(index)),
      passes: (found) => Number((found as Round)[3]) > flip,
      seen: new Map(),
    };
  };
  const searches = feeds.map((_, i) => searchOf(i));
  const run = (these: (Search | undefined)[]) =>
    narrow(
      these.filter((search): search is Search => !!search),
      reader,
    );
  await run(searches);
  // A search that a failed read ended runs once more, so that one failed batch does not take every feed's price.
  const again = searches.map((search, i) => (search?.failed ? searchOf(i) : search));
  await run(again.filter((search, i) => search !== searches[i]));
  return feeds.map(({ decimals }, i) => {
    const search = again[i];
    const round = search
      ? search.failed
        ? undefined
        : (search.seen.get(search.hi - 1) as Round | undefined)
      : latest[i];
    return round && Number(round[1]) / 10 ** decimals;
  });
}

// Every kind of pool sorts its two tokens by address.
const tokenFirst = ({ token, anchor }: Pool): boolean => key(token.address) < key(anchor.address);
const decimalsOf = (pool: Pool): [number, number] =>
  tokenFirst(pool) ? [pool.token.decimals, pool.anchor.decimals] : [pool.anchor.decimals, pool.token.decimals];
// The token's price in the anchor, from token0's price in token1.
const inAnchor = (pool: Pool, price0: number): number => (tokenFirst(pool) ? price0 : 1 / price0);

// How a kind of pool prices: its reads now, reserves first; token0's price in token1 now; and the reads or searches for
// its average over the window, with the average they give.
type History = { calls: Call[]; searches: Search[]; price(replies: unknown[]): number | undefined };
type Kind = {
  abi: Abi;
  state: string[];
  spot(reserve0: number, reserve1: number, state: unknown[], pool: Pool): number;
  history(entry: Measured, flip: number, ago: number): History;
};

const reservesSpot: Kind["spot"] = (reserve0, reserve1, _, pool) => pairPrice(reserve0, reserve1, pool.stable);

// Aero's basic pools read back their reserves' running sums at any time in their history.
const aero: Kind = {
  abi: pairAbi,
  state: ["getReserves"],
  spot: reservesSpot,
  history: ({ pool }, _, ago) => ({
    calls: [call(pool.address, pairAbi, "observe", [ago + WINDOW, ago])],
    searches: [],
    price: ([found]) => {
      const [sums0, sums1] = (found as readonly [readonly bigint[], readonly bigint[]] | undefined) ?? [];
      if (!sums0 || !sums1) return undefined;
      const first: Observation = [0n, sums0[0]!, sums1[0]!];
      const last: Observation = [BigInt(WINDOW), sums0[1]!, sums1[1]!];
      return observedPrice(first, last, ...decimalsOf(pool), pool.stable);
    },
  }),
};

// Aerodrome's and Hydrex's classic pools: the last observation before the window, and the first after it, or now.
const classic: Kind = {
  abi: pairAbi,
  state: ["getReserves", "observationLength", "currentCumulativePrices"],
  spot: reservesSpot,
  history: ({ pool, state: [length, current] }, flip, ago) => {
    const count = Number(length as bigint);
    const probe = (index: number) => call(pool.address, pairAbi, "observations", BigInt(index));
    const lo = Math.max(0, count - Math.ceil((ago + WINDOW) / WINDOW) - 3);
    const [start, end] = [flip - WINDOW + 1, flip].map((time): Search => ({
      lo,
      hi: count,
      probe,
      passes: (observation) => Number((observation as Observation)[0]) >= time,
      seen: new Map(),
    })) as [Search, Search];
    return {
      calls: [],
      searches: [start, end],
      price: () => {
        const [sums0, sums1, time] = current as readonly bigint[];
        const first = start.seen.get(start.hi - 1) as Observation | undefined;
        const last: Observation | undefined =
          end.hi < count ? (end.seen.get(end.hi) as Observation | undefined) : [time!, sums0!, sums1!];
        if (start.failed || end.failed || !first || !last) return undefined;
        return observedPrice(first, last, ...decimalsOf(pool), pool.stable);
      },
    };
  },
};

// Hydrex Integral's concentrated pools: the average tick, from their plugin.
const algebra: Kind = {
  abi: algebraPoolAbi,
  state: ["getReserves", "globalState", "plugin"],
  spot: (_, __, [globalState], pool) => tickPrice((globalState as readonly [bigint, number])[1], ...decimalsOf(pool)),
  history: ({ pool, state: [, plugin] }, _, ago) => ({
    calls: [call(plugin as Address, pluginAbi, "getTimepoints", [ago + WINDOW, ago])],
    searches: [],
    price: ([found]) => {
      const ticks = (found as readonly [readonly bigint[]] | undefined)?.[0];
      return ticks && tickPrice(Number(ticks[1]! - ticks[0]!) / WINDOW, ...decimalsOf(pool));
    },
  }),
};

const KINDS: Partial<Record<ExchangeKind, Kind>> = { solidly: aero, aerodrome: classic, pair: classic, algebra };

function kindOf({ kind, name }: Exchange): Kind {
  const found = KINDS[kind];
  if (!found) throw new Error(`${name} cannot price tokens.`);
  return found;
}

// Each token's pools against each anchor, by exchange in the order given, then by anchor.
async function candidates(
  tokens: Token[],
  anchors: Anchor[],
  exchanges: Exchange[],
  reader: typeof read,
): Promise<Pool[]> {
  const pairs = tokens.flatMap((token) => anchors.map((anchor) => ({ token, anchor })));
  const ways = await waysFor(
    pairs.map(({ token, anchor }) => [token.address, anchor.address]),
    exchanges,
    reader,
  );
  const rank = (pool: Pool) => exchanges.findIndex(({ id }) => id === pool.exchange.id);
  return pairs
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
}

// Each pool's price and depth now. Pools too thin for the amount priced are dropped.
async function measure(
  pools: Pool[],
  prices: Prices,
  amounts: Map<string, bigint>,
  reader: typeof read,
): Promise<Measured[]> {
  const kinds = pools.map(({ exchange }) => kindOf(exchange));
  const replies = await reader(
    pools.flatMap(({ address }, i) => kinds[i]!.state.map((name) => call(address, kinds[i]!.abi, name))),
  );
  let next = 0;
  return pools.flatMap((pool, i): Measured[] => {
    const kind = kinds[i]!;
    const [reserves, ...state] = replies.slice(next, (next += kind.state.length)) as [readonly bigint[], ...unknown[]];
    if (!reserves || state.includes(undefined)) return [];
    const [decimals0, decimals1] = decimalsOf(pool);
    const [reserve0, reserve1] = [whole(reserves[0]!, decimals0), whole(reserves[1]!, decimals1)];
    if (!(reserve0 > 0 && reserve1 > 0)) return [];
    const anchorPrice = prices.of.get(key(pool.anchor.address))!;
    const spot = inAnchor(pool, kind.spot(reserve0, reserve1, state, pool)) * anchorPrice;
    const [tokenReserve, anchorReserve] = tokenFirst(pool) ? [reserve0, reserve1] : [reserve1, reserve0];
    const depth = Math.min(tokenReserve * spot, anchorReserve * anchorPrice);
    const value = whole(amounts.get(key(pool.token.address)) ?? 0n, pool.token.decimals) * spot;
    return Number.isFinite(spot) && depth >= Math.max(FLOOR, DEPTH * value) ? [{ pool, spot, depth, state }] : [];
  });
}

// Prices per whole token at the flip. Anchors take their feed, in dollars; if none answers for the flip, the prices are
// in USDC, at 1 USDC each. Each currency's rate at the flip goes with dollar prices, to show them in it. Then, each
// against the anchors priced by then, first the anchors without a price, then the other tokens, take their deepest
// pool, the first in `exchanges` order if two are as deep: its average over the window. For prices now, a pool whose history falls short
// gives its price now. For a past flip, the next deepest pool is tried, until one has a history then; a token none of
// whose pools has one has no price, so that every price is of the flip, and its price now only stands in to weigh it.
// `amounts` is how much will be priced.
export async function pricesAt(
  tokens: Token[],
  amounts: Map<string, bigint>,
  flip: number,
  time: number,
  exchanges: Exchange[],
  reader: typeof read = read,
): Promise<Prices> {
  exchanges.forEach(kindOf);
  const ago = Math.max(0, time - flip);
  const fiat = Object.entries(FIAT_FEEDS) as [Fiat, Feed][];
  const all = [...ANCHORS.map(({ feed }) => feed), ...fiat.map(([, feed]) => feed)];
  // Now, the feeds' latest rounds, shared: the visitor's clock may run behind the chain's.
  const feeds = ago ? await feedsAt(all, flip, reader) : await feedsNow(all, reader);
  const fed = ANCHORS.flatMap(({ address }, i): [string, number][] =>
    feeds[i] === undefined ? [] : [[key(address), feeds[i]]],
  );
  const rates: Rates = Object.fromEntries(
    fiat.flatMap(([currency], i) => {
      const rate = feeds[ANCHORS.length + i];
      return rate === undefined ? [] : [[currency, rate]];
    }),
  );
  const prices = fed.length ? pricesIn("USD", fed, rates) : pricesIn("USDC", [[key(USDC), 1]]);
  const unpriced = ANCHORS.filter(({ address }) => !prices.of.has(key(address)));
  await inPools(
    unpriced.map(({ address, decimals }) => ({ address, decimals, symbol: "" })),
    prices,
    amounts,
    flip,
    ago,
    exchanges,
    reader,
  );
  const others = tokens.filter(({ address }) => !prices.of.has(key(address)));
  await inPools(others, prices, amounts, flip, ago, exchanges, reader);
  return prices;
}

// Prices the tokens in their pools against the anchors priced, `ago` seconds after the flip, the deepest first.
async function inPools(
  tokens: Token[],
  prices: Prices,
  amounts: Map<string, bigint>,
  flip: number,
  ago: number,
  exchanges: Exchange[],
  reader: typeof read,
): Promise<void> {
  if (!tokens.length) return;
  const anchors = ANCHORS.filter(({ address }) => prices.of.has(key(address)));
  const measured = await measure(await candidates(tokens, anchors, exchanges, reader), prices, amounts, reader);
  // Each token's pools, the deepest first; of two as deep, the first in `exchanges` order, as the sort keeps it.
  const ranked = new Map<string, Measured[]>();
  for (const entry of measured) {
    const token = key(entry.pool.token.address);
    const pools = ranked.get(token);
    if (pools) pools.push(entry);
    else ranked.set(token, [entry]);
  }
  for (const pools of ranked.values()) pools.sort((a, b) => b.depth - a.depth);
  // Now, the deepest pool's price now. At a flip, the deepest pool's history; then, only for a token whose deepest pool
  // has none, every other pool's history, in one more read: the deepest that has one prices the token, and without any,
  // the deepest's price now stands in to weigh it.
  const found = await atFlipIn(
    [...ranked.values()].map((pools) => pools[0]!),
    prices,
    flip,
    ago,
    reader,
  );
  if (ago) {
    const rest = [...ranked.values()]
      .filter((pools) => found.get(pools[0]!) === undefined)
      .flatMap((pools) => pools.slice(1));
    for (const [entry, price] of await atFlipIn(rest, prices, flip, ago, reader)) found.set(entry, price);
  }
  for (const [token, pools] of ranked) {
    const price = pools.map((entry) => found.get(entry)).find((each) => each !== undefined);
    if (price !== undefined) prices.of.set(token, price);
    else if (!ago) prices.of.set(token, pools[0]!.spot);
    else prices.standIns.set(token, pools[0]!.spot);
  }
  for (const token of prices.of.keys()) prices.standIns.delete(token);
}

// Each pool's price at the flip, from its history, in one read: undefined where it has none.
async function atFlipIn(
  entries: Measured[],
  prices: Prices,
  flip: number,
  ago: number,
  reader: typeof read,
): Promise<Map<Measured, number | undefined>> {
  const found = new Map<Measured, number | undefined>();
  if (!entries.length) return found;
  const histories = entries.map((entry) => kindOf(entry.pool.exchange).history(entry, flip, ago));
  const [replies] = await Promise.all([
    reader(histories.flatMap(({ calls }) => calls)),
    narrow(
      histories.flatMap(({ searches }) => searches),
      reader,
    ),
  ]);
  let next = 0;
  entries.forEach((entry, i) => {
    const { calls, price } = histories[i]!;
    const price0 = price(replies.slice(next, (next += calls.length)));
    const atFlip =
      price0 === undefined ? undefined : inAnchor(entry.pool, price0) * prices.of.get(key(entry.pool.anchor.address))!;
    found.set(entry, atFlip !== undefined && Number.isFinite(atFlip) && atFlip > 0 ? atFlip : undefined);
  });
  return found;
}

// Prices now, for the swap and anything else current: in SWAP_PRICING's pools.
export function pricesNow(tokens: Token[], amounts: Map<string, bigint>, reader: typeof read = read) {
  const time = now();
  return pricesAt(tokens, amounts, time, time, SWAP_PRICING, reader);
}

// Prices at a past flip, for what claims earned and paid: in HYDREX_PRICING's pools.
export const pricesAtFlip = (
  tokens: Token[],
  amounts: Map<string, bigint>,
  flip: number,
  time: number,
  reader: typeof read = read,
) => pricesAt(tokens, amounts, flip, time, HYDREX_PRICING, reader);
