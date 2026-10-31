import type { Address } from "viem";
import { ABI, ANCHORS, FIAT_FEEDS, PRICING, USDC, WETH, type Exchange, type Token } from "./config.ts";
import { setRates, type Money, type Unit } from "./format.ts";
import { exchangeOf, pairKey, waysFor } from "./pools.ts";
import { call, read, rpc, type Call, type Read } from "./rpc.ts";
import { key, memo } from "./util.ts";

// Per whole token, by lower-case address: in dollars, or in USDC when no Chainlink feed answered.
export type Prices = { unit: Unit; of: Map<string, number> };

// A 30-minute average resists a pool pushed for one block: the swap's warnings compare quotes against it.
export const WINDOW = 1800;
// Classic pairs observe at most every half hour, as they trade; further apart, observations no longer tell.
export const SPAN = 4 * WINDOW;
// A pool prices a token only with $250 of each side, and ten times the value priced.
const FLOOR = 250;
const DEPTH = 10;

const whole = (amount: bigint, decimals: number): number => Number(amount) / 10 ** decimals;
export const worthOf = (amount: bigint, decimals: number, price: number): number => whole(amount, decimals) * price;
// Token0's price in token1 at a concentrated pool's tick.
export const tickPrice = (tick: number, decimals0: number, decimals1: number): number =>
  1.0001 ** tick * 10 ** (decimals0 - decimals1);
// Token0's price in token1 from reserves: x × y = k, or x³y + xy³ = k if stable.
export function pairPrice(x: number, y: number, stable: boolean): number {
  return stable ? (3 * x * x * y + y ** 3) / (x ** 3 + 3 * x * y * y) : y / x;
}

// Running sums of reserves: [timestamp, reserve0, reserve1].
type Observation = readonly [bigint, bigint, bigint];
// Token0's average price in token1 between two observations; undefined if too far apart, or the pool was empty.
export function observedPrice(first: Observation, last: Observation, d0: number, d1: number, stable: boolean) {
  const elapsed = last[0] - first[0];
  if (elapsed <= 0n || elapsed > BigInt(SPAN)) return undefined;
  const [x, y] = [whole((last[1] - first[1]) / elapsed, d0), whole((last[2] - first[2]) / elapsed, d1)];
  return x > 0 && y > 0 ? pairPrice(x, y, stable) : undefined;
}

type Pool = { address: Address; exchange: Exchange; stable: boolean; token: Token; anchor: Token };
type Measured = { pool: Pool; spot: number; depth: number; state: unknown[] };
// A pool's reads now, reserves first; token0's price in token1 now; and its 30-minute average.
type Kind = {
  state: string[];
  spot?(state: unknown[], decimals: [number, number]): number;
  history(measured: Measured): Call[];
  average(replies: unknown[], measured: Measured): number | undefined;
};
const tokenFirst = ({ token, anchor }: Pool) => key(token.address) < key(anchor.address);
const decimalsOf = (pool: Pool): [number, number] =>
  tokenFirst(pool) ? [pool.token.decimals, pool.anchor.decimals] : [pool.anchor.decimals, pool.token.decimals];

const KINDS: Partial<Record<Exchange["kind"], Kind>> = {
  // Aero's basic pools read back their running sums at any time.
  solidly: {
    state: ["getReserves"],
    history: ({ pool }) => [call(pool.address, ABI.pair, "observe", [WINDOW, 0])],
    average: ([found], { pool }) => {
      const [sums0, sums1] = (found as readonly (readonly bigint[])[] | undefined) ?? [];
      if (!sums0 || !sums1) return undefined;
      return observedPrice(
        [0n, sums0[0]!, sums1[0]!],
        [BigInt(WINDOW), sums0[1]!, sums1[1]!],
        ...decimalsOf(pool),
        pool.stable,
      );
    },
  },
  // Aerodrome's and Hydrex's classic pools: the newest of their last four observations before the window, to now.
  pair: {
    state: ["getReserves", "observationLength", "currentCumulativePrices"],
    history: ({ pool, state: [length] }) =>
      [1, 2, 3, 4].flatMap((back) =>
        Number(length) >= back ? [call(pool.address, ABI.pair, "observations", (length as bigint) - BigInt(back))] : [],
      ),
    average: (observations, { pool, state: [, current] }) => {
      const [sums0, sums1, time] = current as readonly bigint[];
      const first = (observations as (Observation | undefined)[]).find(
        (each) => each && each[0] <= time! - BigInt(WINDOW),
      );
      return first && observedPrice(first, [time!, sums0!, sums1!], ...decimalsOf(pool), pool.stable);
    },
  },
  // Hydrex Integral: the average tick, from the pool's plugin.
  algebra: {
    state: ["getReserves", "globalState", "plugin"],
    spot: ([globalState], decimals) => tickPrice((globalState as readonly [bigint, number])[1], ...decimals),
    history: ({ state: [, plugin] }) => [call(plugin as Address, ABI.algebraPool, "getTimepoints", [WINDOW, 0])],
    average: ([found], { pool }) => {
      const ticks = (found as readonly (readonly bigint[])[] | undefined)?.[0];
      return ticks && tickPrice(Number(ticks[1]! - ticks[0]!) / WINDOW, ...decimalsOf(pool));
    },
  },
};
KINDS.aerodrome = KINDS.pair!;
const kindOf = ({ kind }: Exchange): Kind => KINDS[kind]!;
const abiOf = ({ kind }: Exchange) => (kind === "algebra" ? ABI.algebraPool : ABI.pair);

// Chainlink's latest anchors and currencies, at most once a minute.
const FIATS = Object.entries(FIAT_FEEDS);
const feedsNow = memo(
  async (reader: Read) => {
    const rounds = (await reader(
      [...ANCHORS, ...FIATS.map(([, feed]) => ({ feed }))].map(({ feed }) => call(feed, ABI.feed, "latestRoundData")),
    )) as (readonly bigint[] | undefined)[];
    const answers = rounds.map((round) => round && Number(round[1]) / 1e8);
    setRates(
      Object.fromEntries(
        FIATS.flatMap(([currency], i) =>
          answers[ANCHORS.length + i] ? [[currency, answers[ANCHORS.length + i]]] : [],
        ),
      ),
    );
    return answers.slice(0, ANCHORS.length);
  },
  60_000,
  () => "",
);

// Prices now: anchors by their feed, at 1 USDC each if none answers; then others, unpriced anchors first, in their
// deepest pool against the anchors priced, the first in PRICING if two are as deep: its 30-minute average, or else its
// price now. `amounts` is how much will be priced, which the pool must be deep enough for.
export async function pricesNow(tokens: Token[], amounts: Map<string, bigint>, reader: Read = read): Promise<Prices> {
  const feeds = await feedsNow(reader);
  const fed = ANCHORS.flatMap(({ address }, i): [string, number][] =>
    feeds[i] === undefined ? [] : [[key(address), feeds[i]]],
  );
  const prices: Prices = fed.length
    ? { unit: "USD", of: new Map(fed) }
    : { unit: "USDC", of: new Map([[key(USDC), 1]]) };
  await inPools(
    ANCHORS.filter(({ address }) => !prices.of.has(key(address))),
    prices,
    amounts,
    reader,
  );
  await inPools(
    tokens.filter(({ address }) => !prices.of.has(key(address))),
    prices,
    amounts,
    reader,
  );
  return prices;
}

async function inPools(tokens: Token[], prices: Prices, amounts: Map<string, bigint>, reader: Read): Promise<void> {
  if (!tokens.length) return;
  const anchors = ANCHORS.filter(({ address }) => prices.of.has(key(address)));
  const pairs = tokens.flatMap((token) => anchors.map((anchor) => ({ token, anchor })));
  const ways = await waysFor(
    pairs.map(({ token, anchor }) => [token.address, anchor.address]),
    PRICING,
    reader,
  );
  const rank = (pool: Pool) => PRICING.indexOf(pool.exchange);
  const pools = pairs
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
  const states = await reader(
    pools.flatMap(({ address, exchange }) =>
      kindOf(exchange).state.map((name) => call(address, abiOf(exchange), name)),
    ),
  );
  const deepest = new Map<string, Measured>();
  let next = 0;
  for (const pool of pools) {
    const kind = kindOf(pool.exchange);
    const [reserves, ...state] = states.slice(next, (next += kind.state.length)) as [
      readonly bigint[] | undefined,
      ...unknown[],
    ];
    if (!reserves || state.includes(undefined)) continue;
    const decimals = decimalsOf(pool);
    const [r0, r1] = [whole(reserves[0]!, decimals[0]), whole(reserves[1]!, decimals[1])];
    if (!(r0 > 0 && r1 > 0)) continue;
    const price0 = kind.spot?.(state, decimals) ?? pairPrice(r0, r1, pool.stable);
    const anchorPrice = prices.of.get(key(pool.anchor.address))!;
    const spot = (tokenFirst(pool) ? price0 : 1 / price0) * anchorPrice;
    const [tokenReserve, anchorReserve] = tokenFirst(pool) ? [r0, r1] : [r1, r0];
    const depth = Math.min(tokenReserve * spot, anchorReserve * anchorPrice);
    const value = whole(amounts.get(key(pool.token.address)) ?? 0n, pool.token.decimals) * spot;
    const best = deepest.get(key(pool.token.address));
    if (Number.isFinite(spot) && depth >= Math.max(FLOOR, DEPTH * value) && (!best || depth > best.depth))
      deepest.set(key(pool.token.address), { pool, spot, depth, state });
  }
  const chosen = [...deepest.values()];
  const histories = chosen.map((measured) => kindOf(measured.pool.exchange).history(measured));
  const replies = await reader(histories.flat()).catch(() => []);
  next = 0;
  for (const [i, measured] of chosen.entries()) {
    const { pool, spot } = measured;
    const price0 = kindOf(pool.exchange).average(replies.slice(next, (next += histories[i]!.length)), measured);
    const average = price0 && (tokenFirst(pool) ? price0 : 1 / price0) * prices.of.get(key(pool.anchor.address))!;
    prices.of.set(key(pool.token.address), average && Number.isFinite(average) ? average : spot);
  }
}

// The anchors alone, as gas needs ETH's, at most once a minute.
export const anchorsNow = memo<void, Prices | undefined>(
  () =>
    pricesNow([], new Map()).catch((error: unknown) => {
      console.error(error);
      return undefined;
    }),
  60_000,
  () => "",
);

// The gas price, and the tip the page asks for, capped at 1 gwei, above which Aero's classic pools add a tax.
export const MAX_TIP = 1_000_000_000n;
export type Costs = { gasPrice: bigint; tip: bigint | undefined };
export const costs = memo<void, Costs>(
  async (): Promise<Costs> => {
    const [gasPrice, tip] = await Promise.all([
      rpc<string>("eth_gasPrice", []),
      rpc<string>("eth_maxPriorityFeePerGas", []).catch(() => undefined),
    ]);
    return {
      gasPrice: BigInt(gasPrice),
      tip: tip === undefined ? undefined : BigInt(tip) < MAX_TIP ? BigInt(tip) : MAX_TIP,
    };
  },
  60_000,
  () => "",
);

export function ethCost(wei: bigint, prices: Prices | undefined): Money | undefined {
  const eth = prices?.of.get(key(WETH));
  return eth === undefined ? undefined : { value: (Number(wei) / 1e18) * eth, unit: prices!.unit };
}
