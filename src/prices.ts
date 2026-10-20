import { parseAbi, zeroAddress, type Address } from "viem";
import { call, read, same, type Call } from "./chain.ts";
import { ALGEBRA_FACTORY, ANCHORS, PAIR_FACTORY, type Anchor } from "./config.ts";

export type Token = { address: Address; decimals: number; symbol: string };

// Prices are averaged over the half hour before the flip: rewards become final at the flip, and Carbon Impact swaps
// them right after.
export const WINDOW = 1800;
// A pool can price a token only if it holds at least $250 of each of its two tokens, and ten times the value it
// prices. A thin pool can show any price.
const FLOOR = 250;
const DEPTH = 10;
// A classic pair records an observation at most every half hour, and only when it trades. Observations further apart
// than this no longer give the price at the flip.
export const SPAN = 4 * WINDOW;
const POINTS_PER_ROUND = 16;

const algebraFactoryAbi = parseAbi(["function poolByPair(address tokenA, address tokenB) view returns (address)"]);
const pairFactoryAbi = parseAbi([
  "function getPair(address tokenA, address tokenB, bool stable) view returns (address)",
]);
const algebraPoolAbi = parseAbi([
  "function getReserves() view returns (uint128 reserve0, uint128 reserve1)",
  "function globalState() view returns (uint160 price, int24 tick, uint16 lastFee, uint8 pluginConfig, uint16 communityFee, bool unlocked)",
  "function plugin() view returns (address)",
]);
const pluginAbi = parseAbi([
  "function getTimepoints(uint32[] secondsAgos) view returns (int56[] tickCumulatives, uint88[] volatilityCumulatives)",
]);
const pairAbi = parseAbi([
  "function getReserves() view returns (uint256 reserve0, uint256 reserve1, uint256 blockTimestampLast)",
  "function observationLength() view returns (uint256)",
  "function observations(uint256 index) view returns (uint256 timestamp, uint256 reserve0Cumulative, uint256 reserve1Cumulative)",
  "function currentCumulativePrices() view returns (uint256 reserve0Cumulative, uint256 reserve1Cumulative, uint256 blockTimestamp)",
]);
const feedAbi = parseAbi([
  "function decimals() view returns (uint8)",
  "function latestRoundData() view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)",
  "function getRoundData(uint80 roundId) view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)",
]);

type Round = readonly [bigint, bigint, bigint, bigint, bigint];
// A classic pair's running sums of its reserves over time: [timestamp, reserve0, reserve1].
type Observation = readonly [bigint, bigint, bigint];
type Kind = "algebra" | "volatile" | "stable";
type Pool = { address: Address; kind: Kind; token: Token; anchor: Anchor };
// A pool as it is now: its price for the token in dollars, its depth, and where to read its history.
type Measured = { pool: Pool; usd: number; depth: number; plugin?: Address; length?: number; now?: Observation };

const key = (address: string): string => address.toLowerCase();
const whole = (amount: bigint, decimals: number): number => Number(amount) / 10 ** decimals;

export const usdOf = (amount: bigint, decimals: number, price: number): number => whole(amount, decimals) * price;

// A concentrated pool's price of token0 in token1 is 1.0001^tick, in their smallest units.
export const tickPrice = (tick: number, decimals0: number, decimals1: number): number =>
  1.0001 ** tick * 10 ** (decimals0 - decimals1);

// Token0's price in token1, from reserves in whole tokens: x × y = k for a volatile pair, x³y + xy³ = k for a stable one.
export function pairPrice(reserve0: number, reserve1: number, stable: boolean): number {
  if (!stable) return reserve1 / reserve0;
  const [x, y] = [reserve0, reserve1];
  return (3 * x * x * y + y ** 3) / (x ** 3 + 3 * x * y * y);
}

// Token0's average price in token1 between two observations, or undefined if they are too far apart or the pair held
// nothing between them.
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

// A search for the first index in [lo, hi) whose read passes, where every index after one that passes also passes.
// When it ends, hi is that index, or where hi started if none passes. `seen` keeps the reads, including those at hi
// and hi - 1 once hi has moved.
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

// Runs every search at once, with one batch of reads per round. A failed read ends its search.
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

// Chainlink's price at the flip, or today's if the round in effect then cannot be found. At no flip, Infinity, it is
// today's.
export async function feedAt(feed: Address, flip: number, reader: typeof read): Promise<number | undefined> {
  const [decimals, latest] = (await reader([
    call(feed, feedAbi, "decimals"),
    call(feed, feedAbi, "latestRoundData"),
  ])) as [number | undefined, Round | undefined];
  if (decimals === undefined || !latest) return undefined;
  const usd = (round: Round) => Number(round[1]) / 10 ** decimals;
  if (Number(latest[3]) <= flip) return usd(latest);
  // A round id holds its phase above the lowest 64 bits, and the round's number within the phase in those bits.
  const phase = (latest[0] >> 64n) << 64n;
  const search: Search = {
    lo: 1,
    hi: Number(latest[0] - phase),
    probe: (index) => call(feed, feedAbi, "getRoundData", phase + BigInt(index)),
    passes: (round) => Number((round as Round)[3]) > flip,
    seen: new Map(),
  };
  await narrow([search], reader);
  const before = search.seen.get(search.hi - 1) as Round | undefined;
  return !search.failed && before ? usd(before) : usd(latest);
}

// The pools of Hydrex's two factories that pair a token with an anchor.
async function candidates(tokens: Token[], anchors: Anchor[], reader: typeof read): Promise<Pool[]> {
  const options = tokens.flatMap((token) =>
    anchors.flatMap((anchor) => (["algebra", "volatile", "stable"] as const).map((kind) => ({ token, anchor, kind }))),
  );
  const found = (await reader(
    options.map(({ token, anchor, kind }) =>
      kind === "algebra"
        ? call(ALGEBRA_FACTORY, algebraFactoryAbi, "poolByPair", token.address, anchor.address)
        : call(PAIR_FACTORY, pairFactoryAbi, "getPair", token.address, anchor.address, kind === "stable"),
    ),
  )) as (Address | undefined)[];
  return options.flatMap((option, i) => {
    const address = found[i];
    return address && !same(address, zeroAddress) ? [{ ...option, address }] : [];
  });
}

// Both kinds of pool sort their two tokens by address.
const tokenFirst = ({ token, anchor }: Pool): boolean => key(token.address) < key(anchor.address);
const decimalsOf = (pool: Pool): [number, number] =>
  tokenFirst(pool) ? [pool.token.decimals, pool.anchor.decimals] : [pool.anchor.decimals, pool.token.decimals];
// The token's price in the anchor, from token0's price in token1.
const inAnchor = (pool: Pool, price0: number): number => (tokenFirst(pool) ? price0 : 1 / price0);

// Each pool's price and depth now, and where its history is. Pools too thin for the amount to price are dropped.
async function measure(
  pools: Pool[],
  prices: Map<string, number>,
  amounts: Map<string, bigint>,
  reader: typeof read,
): Promise<Measured[]> {
  const state = await reader(
    pools.flatMap(({ address, kind }) =>
      kind === "algebra"
        ? ["getReserves", "globalState", "plugin"].map((name) => call(address, algebraPoolAbi, name))
        : ["getReserves", "observationLength", "currentCumulativePrices"].map((name) => call(address, pairAbi, name)),
    ),
  );
  return pools.flatMap((pool, i): Measured[] => {
    const [reserves, second, third] = state.slice(3 * i, 3 * i + 3) as [
      readonly bigint[] | undefined,
      unknown,
      unknown,
    ];
    if (!reserves || second === undefined || third === undefined) return [];
    const [decimals0, decimals1] = decimalsOf(pool);
    const [reserve0, reserve1] = [whole(reserves[0]!, decimals0), whole(reserves[1]!, decimals1)];
    if (!(reserve0 > 0 && reserve1 > 0)) return [];
    const price0 =
      pool.kind === "algebra"
        ? tickPrice((second as readonly [bigint, number])[1], decimals0, decimals1)
        : pairPrice(reserve0, reserve1, pool.kind === "stable");
    const anchorUsd = prices.get(key(pool.anchor.address))!;
    const usd = inAnchor(pool, price0) * anchorUsd;
    const [tokenReserve, anchorReserve] = tokenFirst(pool) ? [reserve0, reserve1] : [reserve1, reserve0];
    const depth = Math.min(tokenReserve * usd, anchorReserve * anchorUsd);
    const value = whole(amounts.get(key(pool.token.address)) ?? 0n, pool.token.decimals) * usd;
    if (!Number.isFinite(usd) || !(depth >= Math.max(FLOOR, DEPTH * value))) return [];
    if (pool.kind === "algebra") return [{ pool, usd, depth, plugin: third as Address }];
    const [cumulative0, cumulative1, time] = third as readonly bigint[];
    return [{ pool, usd, depth, length: Number(second as bigint), now: [time!, cumulative0!, cumulative1!] }];
  });
}

// Each token's price at the flip, in dollars per whole token, by lower-case address. USDC is a dollar, and WETH and
// cbBTC take Chainlink's price. Other tokens take the deepest of Hydrex's pools that pairs them with one of those
// three: its average over the half hour before the flip, or its price now if its history is too short. A token without
// a deep enough pool gets no price. `amounts` is how much of each token will be priced.
export async function pricesAt(
  tokens: Token[],
  amounts: Map<string, bigint>,
  flip: number,
  now: number,
  reader: typeof read = read,
): Promise<Map<string, number>> {
  const prices = new Map<string, number>();
  const found = await Promise.all(ANCHORS.map(({ feed }) => (feed ? feedAt(feed, flip, reader) : 1)));
  ANCHORS.forEach(({ address }, i) => {
    const price = found[i];
    if (price !== undefined) prices.set(key(address), price);
  });
  const anchors = ANCHORS.filter(({ address }) => prices.has(key(address)));
  const others = tokens.filter(({ address }) => !ANCHORS.some((anchor) => same(anchor.address, address)));
  const measured = await measure(await candidates(others, anchors, reader), prices, amounts, reader);
  const deepest = new Map<string, Measured>();
  for (const entry of measured) {
    const held = deepest.get(key(entry.pool.token.address));
    if (!held || entry.depth > held.depth) deepest.set(key(entry.pool.token.address), entry);
  }
  const chosen = [...deepest.values()];
  const ago = Math.max(0, now - flip);

  // Concentrated pools: the average tick over the window, from their plugin's history.
  const algebra = chosen.filter(({ plugin }) => plugin);
  const timepoints = reader(
    algebra.map(({ plugin }) => call(plugin!, pluginAbi, "getTimepoints", [ago + WINDOW, ago])),
  );
  // Classic pairs: the observations on either side of the window. A pair records one at most every half hour, which
  // limits how far back from its last one the window can be.
  const classic = chosen.filter(({ length }) => length !== undefined);
  const searches = classic.flatMap(({ pool, length }): Search[] => {
    const probe = (index: number) => call(pool.address, pairAbi, "observations", BigInt(index));
    const from = (time: number) => (observation: unknown) => Number((observation as Observation)[0]) >= time;
    const lo = Math.max(0, length! - Math.ceil((ago + WINDOW) / WINDOW) - 3);
    return [
      { lo, hi: length!, probe, passes: from(flip - WINDOW + 1), seen: new Map() },
      { lo, hi: length!, probe, passes: from(flip), seen: new Map() },
    ];
  });
  const [ticks] = await Promise.all([timepoints, narrow(searches, reader)]);

  // A pool whose history gives no price above zero, as one nearly empty at the flip, gives its price now.
  const set = ({ pool, usd }: Measured, price0: number | undefined) => {
    const atFlip = price0 === undefined ? undefined : inAnchor(pool, price0) * prices.get(key(pool.anchor.address))!;
    prices.set(key(pool.token.address), atFlip !== undefined && Number.isFinite(atFlip) && atFlip > 0 ? atFlip : usd);
  };
  algebra.forEach((entry, i) => {
    const cumulatives = (ticks[i] as readonly [readonly bigint[]] | undefined)?.[0];
    const [decimals0, decimals1] = decimalsOf(entry.pool);
    set(entry, cumulatives && tickPrice(Number(cumulatives[1]! - cumulatives[0]!) / WINDOW, decimals0, decimals1));
  });
  classic.forEach((entry, i) => {
    const [start, end] = [searches[2 * i]!, searches[2 * i + 1]!];
    // The last observation before the window, and the first after it, or now if there is none yet.
    const first = start.seen.get(start.hi - 1) as Observation | undefined;
    const last = end.hi < entry.length! ? (end.seen.get(end.hi) as Observation | undefined) : entry.now;
    if (start.failed || end.failed || !first || !last) return set(entry, undefined);
    const [decimals0, decimals1] = decimalsOf(entry.pool);
    set(entry, observedPrice(first, last, decimals0, decimals1, entry.pool.kind === "stable"));
  });
  return prices;
}
