import { parseAbi, type Abi, type Address } from "viem";
import { call, now, read, same, type Call } from "./chain.ts";
import {
  ANCHORS,
  HYDREX_PRICING,
  SWAP_PRICING,
  type Anchor,
  type Exchange,
  type ExchangeKind,
  type Feed,
} from "./config.ts";
import { exchangeOf, pairKey, waysFor } from "./pools.ts";

export type Token = { address: Address; decimals: number; symbol: string };

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
// A pool now: the token's price in dollars, its depth, and its reads past the reserves.
type Measured = { pool: Pool; usd: number; depth: number; state: unknown[] };

const key = (address: string): string => address.toLowerCase();
const whole = (amount: bigint, decimals: number): number => Number(amount) / 10 ** decimals;

export const usdOf = (amount: bigint, decimals: number, price: number): number => whole(amount, decimals) * price;

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

// Chainlink's prices at the flip, or today's if the round then cannot be found; Infinity is today. One read for the
// latest rounds, then one search for the feeds updated since the flip. A feed that does not answer has no price.
export async function feedsAt(
  feeds: Feed[],
  flip: number,
  reader: typeof read = read,
): Promise<(number | undefined)[]> {
  const latest = (await reader(feeds.map(({ address }) => call(address, feedAbi, "latestRoundData")))) as (
    Round | undefined
  )[];
  const searches = feeds.map(({ address }, i): Search | undefined => {
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
  });
  await narrow(
    searches.filter((search): search is Search => !!search),
    reader,
  );
  return feeds.map(({ decimals }, i) => {
    const search = searches[i];
    const before = search && !search.failed ? (search.seen.get(search.hi - 1) as Round | undefined) : undefined;
    const round = before ?? latest[i];
    return round && Number(round[1]) / 10 ** decimals;
  });
}

export const feedAt = async (feed: Feed, flip: number, reader: typeof read = read): Promise<number | undefined> =>
  (await feedsAt([feed], flip, reader))[0];

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
  prices: Map<string, number>,
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
    const anchorUsd = prices.get(key(pool.anchor.address))!;
    const usd = inAnchor(pool, kind.spot(reserve0, reserve1, state, pool)) * anchorUsd;
    const [tokenReserve, anchorReserve] = tokenFirst(pool) ? [reserve0, reserve1] : [reserve1, reserve0];
    const depth = Math.min(tokenReserve * usd, anchorReserve * anchorUsd);
    const value = whole(amounts.get(key(pool.token.address)) ?? 0n, pool.token.decimals) * usd;
    return Number.isFinite(usd) && depth >= Math.max(FLOOR, DEPTH * value) ? [{ pool, usd, depth, state }] : [];
  });
}

// Dollars per whole token at the flip, by lower-case address. Anchors take their feed. Other tokens, and an anchor whose
// feed fails, take the deepest pool against a priced anchor, the first in `exchanges` order if two are as deep: its
// average over the window, or its price now if its history falls short. `amounts` is how much will be priced.
export async function pricesAt(
  tokens: Token[],
  amounts: Map<string, bigint>,
  flip: number,
  time: number,
  exchanges: Exchange[],
  reader: typeof read = read,
): Promise<Map<string, number>> {
  exchanges.forEach(kindOf);
  const prices = new Map<string, number>();
  const feeds = await feedsAt(
    ANCHORS.map(({ feed }) => feed),
    flip,
    reader,
  );
  ANCHORS.forEach(({ address }, i) => {
    const price = feeds[i];
    if (price !== undefined) prices.set(key(address), price);
  });
  const anchors = ANCHORS.filter(({ address }) => prices.has(key(address)));
  const others = tokens.filter(({ address }) => !prices.has(key(address)));
  const measured = await measure(await candidates(others, anchors, exchanges, reader), prices, amounts, reader);
  const deepest = new Map<string, Measured>();
  for (const entry of measured) {
    const held = deepest.get(key(entry.pool.token.address));
    if (!held || entry.depth > held.depth) deepest.set(key(entry.pool.token.address), entry);
  }
  const chosen = [...deepest.values()];
  const ago = Math.max(0, time - flip);
  const histories = chosen.map((entry) => kindOf(entry.pool.exchange).history(entry, flip, ago));
  const [replies] = await Promise.all([
    reader(histories.flatMap(({ calls }) => calls)),
    narrow(
      histories.flatMap(({ searches }) => searches),
      reader,
    ),
  ]);
  let next = 0;
  chosen.forEach(({ pool, usd }, i) => {
    const { calls, price } = histories[i]!;
    const price0 = price(replies.slice(next, (next += calls.length)));
    // No history, or none above zero: the price now.
    const atFlip = price0 === undefined ? undefined : inAnchor(pool, price0) * prices.get(key(pool.anchor.address))!;
    prices.set(key(pool.token.address), atFlip !== undefined && Number.isFinite(atFlip) && atFlip > 0 ? atFlip : usd);
  });
  return prices;
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
