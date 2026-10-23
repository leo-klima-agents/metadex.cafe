import { parseAbi, zeroAddress, type Address } from "viem";
import { call, read, same, type Call } from "./chain.ts";
import { ANCHORS, PRICE_EXCHANGES, type Anchor, type Exchange } from "./config.ts";
import { V3_FEES, spacings } from "./swap.ts";

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

// The factories, by the kind of exchange: Slipstream's, Aero's basic pools', Aerodrome's basic pools', Uniswap v3's,
// Hydrex's classic pools' and Hydrex Integral's.
const slipstreamFactoryAbi = parseAbi([
  "function getPool(address tokenA, address tokenB, int24 tickSpacing) view returns (address)",
]);
const solidlyFactoryAbi = parseAbi(["function getPool(address tokenA, address tokenB) view returns (address)"]);
const aerodromeFactoryAbi = parseAbi([
  "function getPool(address tokenA, address tokenB, bool stable) view returns (address)",
]);
const v3FactoryAbi = parseAbi(["function getPool(address tokenA, address tokenB, uint24 fee) view returns (address)"]);
const pairFactoryAbi = parseAbi([
  "function getPair(address tokenA, address tokenB, bool stable) view returns (address)",
]);
const algebraFactoryAbi = parseAbi(["function poolByPair(address tokenA, address tokenB) view returns (address)"]);
// The pools, in the same order. Slipstream's, Aero's basic pools and Uniswap v3's give their average tick, or reserves,
// over any span their history covers. Aerodrome's and Hydrex's classic pools keep observations that the page searches.
// Hydrex Integral's keep their history in their plugin.
const slipstreamPoolAbi = parseAbi([
  "function slot0() view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, bool unlocked)",
  "function observe(uint32[] secondsAgos) view returns (int56[] tickCumulatives, uint160[] secondsPerLiquidityCumulativeX128s)",
]);
const solidlyPoolAbi = parseAbi([
  "function getReserves() view returns (uint256 reserve0, uint256 reserve1, uint256 blockTimestampLast)",
  "function observe(uint32[] secondsAgos) view returns (uint256[] reserve0Cumulatives, uint256[] reserve1Cumulatives)",
]);
const v3PoolAbi = parseAbi([
  "function slot0() view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked)",
  "function observe(uint32[] secondsAgos) view returns (int56[] tickCumulatives, uint160[] secondsPerLiquidityCumulativeX128s)",
]);
const pairAbi = parseAbi([
  "function getReserves() view returns (uint256 reserve0, uint256 reserve1, uint256 blockTimestampLast)",
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
const balanceAbi = parseAbi(["function balanceOf(address owner) view returns (uint256)"]);
const feedAbi = parseAbi([
  "function decimals() view returns (uint8)",
  "function latestRoundData() view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)",
  "function getRoundData(uint80 roundId) view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)",
]);

type Round = readonly [bigint, bigint, bigint, bigint, bigint];
// A classic pair's running sums of its reserves over time: [timestamp, reserve0, reserve1].
type Observation = readonly [bigint, bigint, bigint];
type Pool = { address: Address; exchange: Exchange; stable: boolean; token: Token; anchor: Anchor };
// A pool as it is now: its price for the token in dollars, its depth, and where to read its history: its plugin for
// Hydrex Integral, how many observations it holds for a classic pool that keeps them, and its own observe() otherwise.
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

// The pools that pair a token with an anchor, exchange by exchange, in the order of PRICE_EXCHANGES: every tick spacing
// of Slipstream, both kinds of classic pool, and every fee tier of Uniswap v3.
async function candidates(tokens: Token[], anchors: Anchor[], reader: typeof read): Promise<Pool[]> {
  const known = await spacings(reader);
  const lookups = (exchange: Exchange, a: Address, b: Address): { call: Call; stable: boolean }[] => {
    const { factory, kind } = exchange;
    switch (kind) {
      case "slipstream":
        return (known.get(exchange.id) ?? []).map((spacing) => ({
          call: call(factory, slipstreamFactoryAbi, "getPool", a, b, spacing),
          stable: false,
        }));
      case "solidly":
        return [{ call: call(factory, solidlyFactoryAbi, "getPool", a, b), stable: !!exchange.stable }];
      case "aerodrome":
        return [false, true].map((stable) => ({
          call: call(factory, aerodromeFactoryAbi, "getPool", a, b, stable),
          stable,
        }));
      case "v3":
        return V3_FEES.map((fee) => ({ call: call(factory, v3FactoryAbi, "getPool", a, b, fee), stable: false }));
      case "pair":
        return [false, true].map((stable) => ({
          call: call(factory, pairFactoryAbi, "getPair", a, b, stable),
          stable,
        }));
      case "algebra":
        return [{ call: call(factory, algebraFactoryAbi, "poolByPair", a, b), stable: false }];
      default:
        return [];
    }
  };
  const options = tokens.flatMap((token) =>
    anchors.flatMap((anchor) =>
      PRICE_EXCHANGES.flatMap((exchange) =>
        lookups(exchange, token.address, anchor.address).map((lookup) => ({ token, anchor, exchange, ...lookup })),
      ),
    ),
  );
  const found = (await reader(options.map(({ call }) => call))) as (Address | undefined)[];
  return options.flatMap(({ token, anchor, exchange, stable }, i) => {
    const address = found[i];
    return address && !same(address, zeroAddress) ? [{ address, exchange, stable, token, anchor }] : [];
  });
}

// Every kind of pool sorts its two tokens by address.
const tokenFirst = ({ token, anchor }: Pool): boolean => key(token.address) < key(anchor.address);
const decimalsOf = (pool: Pool): [number, number] =>
  tokenFirst(pool) ? [pool.token.decimals, pool.anchor.decimals] : [pool.anchor.decimals, pool.token.decimals];
// The token's price in the anchor, from token0's price in token1.
const inAnchor = (pool: Pool, price0: number): number => (tokenFirst(pool) ? price0 : 1 / price0);
const concentrated = ({ exchange: { kind } }: Pool): boolean => kind === "slipstream" || kind === "v3";

// What a pool is asked for its price and depth now. Slipstream's and Uniswap v3's concentrated pools record no
// reserves, so their depth is what they hold of each token.
function stateOf(pool: Pool): Call[] {
  const { address, exchange } = pool;
  switch (exchange.kind) {
    case "slipstream":
    case "v3": {
      const [token0, token1] = tokenFirst(pool) ? [pool.token, pool.anchor] : [pool.anchor, pool.token];
      return [
        call(token0.address, balanceAbi, "balanceOf", address),
        call(token1.address, balanceAbi, "balanceOf", address),
        call(address, exchange.kind === "v3" ? v3PoolAbi : slipstreamPoolAbi, "slot0"),
      ];
    }
    case "solidly":
      return [call(address, solidlyPoolAbi, "getReserves")];
    case "aerodrome":
    case "pair":
      return ["getReserves", "observationLength", "currentCumulativePrices"].map((name) =>
        call(address, pairAbi, name),
      );
    default:
      return ["getReserves", "globalState", "plugin"].map((name) => call(address, algebraPoolAbi, name));
  }
}

// Each pool's price and depth now, and where its history is. Pools too thin for the amount to price are dropped.
async function measure(
  pools: Pool[],
  prices: Map<string, number>,
  amounts: Map<string, bigint>,
  reader: typeof read,
): Promise<Measured[]> {
  const calls = pools.map(stateOf);
  const state = await reader(calls.flat());
  let at = 0;
  return pools.flatMap((pool, i): Measured[] => {
    const values = state.slice(at, (at += calls[i]!.length));
    if (values.some((value) => value === undefined)) return [];
    const reserves = concentrated(pool) ? (values.slice(0, 2) as bigint[]) : (values[0] as readonly bigint[]);
    const [second, third] = concentrated(pool) ? [values[2], undefined] : [values[1], values[2]];
    const [decimals0, decimals1] = decimalsOf(pool);
    const [reserve0, reserve1] = [whole(reserves[0]!, decimals0), whole(reserves[1]!, decimals1)];
    if (!(reserve0 > 0 && reserve1 > 0)) return [];
    const { kind } = pool.exchange;
    const tick = concentrated(pool) || kind === "algebra" ? (second as readonly [bigint, number])[1] : undefined;
    const price0 =
      tick !== undefined ? tickPrice(tick, decimals0, decimals1) : pairPrice(reserve0, reserve1, pool.stable);
    const anchorUsd = prices.get(key(pool.anchor.address))!;
    const usd = inAnchor(pool, price0) * anchorUsd;
    const [tokenReserve, anchorReserve] = tokenFirst(pool) ? [reserve0, reserve1] : [reserve1, reserve0];
    const depth = Math.min(tokenReserve * usd, anchorReserve * anchorUsd);
    const value = whole(amounts.get(key(pool.token.address)) ?? 0n, pool.token.decimals) * usd;
    if (!Number.isFinite(usd) || !(depth >= Math.max(FLOOR, DEPTH * value))) return [];
    if (kind === "algebra") return [{ pool, usd, depth, plugin: third as Address }];
    if (kind !== "aerodrome" && kind !== "pair") return [{ pool, usd, depth }];
    const [cumulative0, cumulative1, time] = third as readonly bigint[];
    return [{ pool, usd, depth, length: Number(second as bigint), now: [time!, cumulative0!, cumulative1!] }];
  });
}

// Token0's average price in token1 over the half hour before the flip, by each pool's history, `ago` seconds back from
// now. Undefined for a pool whose history does not reach that far, or gives no price above zero, as one nearly empty
// at the flip.
async function averages(
  chosen: Measured[],
  flip: number,
  ago: number,
  reader: typeof read,
): Promise<(number | undefined)[]> {
  // Pools that give their history over the window at once: Aero's Slipstream and basic pools, Aerodrome's Slipstream
  // pools and Uniswap v3's from their observe(), and Hydrex Integral's from their plugin.
  const direct = chosen.filter(({ length }) => length === undefined);
  const span = [ago + WINDOW, ago];
  const asked = reader(
    direct.map(({ pool, plugin }) => {
      const { kind } = pool.exchange;
      if (kind === "algebra") return call(plugin!, pluginAbi, "getTimepoints", span);
      return call(
        pool.address,
        kind === "v3" ? v3PoolAbi : kind === "solidly" ? solidlyPoolAbi : slipstreamPoolAbi,
        "observe",
        span,
      );
    }),
  );
  // Aerodrome's and Hydrex's classic pools: the observations on either side of the window. A pool records one at most
  // every half hour, which limits how far back from its last one the window can be.
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
  const [histories] = await Promise.all([asked, narrow(searches, reader)]);

  const found = new Map<Measured, number | undefined>();
  direct.forEach((entry, i) => {
    const [cumulatives, others] = (histories[i] as readonly [readonly bigint[], readonly bigint[]] | undefined) ?? [];
    const [decimals0, decimals1] = decimalsOf(entry.pool);
    if (!cumulatives || !others) return;
    // Aero's basic pools give the running sums of their reserves, the others that of their tick.
    if (entry.pool.exchange.kind !== "solidly") {
      found.set(entry, tickPrice(Number(cumulatives[1]! - cumulatives[0]!) / WINDOW, decimals0, decimals1));
      return;
    }
    const first: Observation = [0n, cumulatives[0]!, others[0]!];
    const last: Observation = [BigInt(WINDOW), cumulatives[1]!, others[1]!];
    found.set(entry, observedPrice(first, last, decimals0, decimals1, entry.pool.stable));
  });
  classic.forEach((entry, i) => {
    const [start, end] = [searches[2 * i]!, searches[2 * i + 1]!];
    // The last observation before the window, and the first after it, or now if there is none yet.
    const first = start.seen.get(start.hi - 1) as Observation | undefined;
    const last = end.hi < entry.length! ? (end.seen.get(end.hi) as Observation | undefined) : entry.now;
    if (start.failed || end.failed || !first || !last) return;
    const [decimals0, decimals1] = decimalsOf(entry.pool);
    found.set(entry, observedPrice(first, last, decimals0, decimals1, entry.pool.stable));
  });
  return chosen.map((entry) => {
    const price0 = found.get(entry);
    return price0 !== undefined && Number.isFinite(price0) && price0 > 0 ? price0 : undefined;
  });
}

// Each token's price at the flip, in dollars per whole token, by lower-case address. USDC is a dollar, and WETH and
// cbBTC take Chainlink's price. Other tokens take the deepest pool that pairs them with one of those three, in Aero
// Slipstream, Aero Basic Pools, Aerodrome Slipstream, Aerodrome Basic Pools, Uniswap v3, Hydrex Classic Pools or Hydrex
// Integral, whose history gives its average over the half hour before the flip. A concentrated pool keeps a short
// history, so a deeper one may not reach a flip that a classic pool does. A token whose pools all lack that history
// takes its deepest pool's price now, and a token without a deep enough pool gets no price. `amounts` is how much of
// each token will be priced.
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
  // Each token's pools, deepest first.
  const ranked = new Map<string, Measured[]>();
  for (const entry of measured) {
    const token = key(entry.pool.token.address);
    ranked.set(token, [...(ranked.get(token) ?? []), entry]);
  }
  for (const pools of ranked.values()) pools.sort((a, b) => b.depth - a.depth);
  const ago = Math.max(0, now - flip);
  // A round a pool: each token's deepest pool first, then the next for each token whose history fell short.
  for (let round = 0; ; round++) {
    const chosen = [...ranked].flatMap(([token, pools]) => {
      const next = pools[round];
      return next && !prices.has(token) ? [next] : [];
    });
    if (!chosen.length) break;
    const averaged = await averages(chosen, flip, ago, reader);
    chosen.forEach(({ pool }, i) => {
      const price0 = averaged[i];
      if (price0 === undefined) return;
      const usd = inAnchor(pool, price0) * prices.get(key(pool.anchor.address))!;
      if (Number.isFinite(usd) && usd > 0) prices.set(key(pool.token.address), usd);
    });
  }
  for (const [token, pools] of ranked) if (!prices.has(token)) prices.set(token, pools[0]!.usd);
  return prices;
}
