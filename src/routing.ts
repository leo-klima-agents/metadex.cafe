import type { Address } from "viem";
import { rate } from "./chain.ts";
import type { Swapper } from "./config.ts";
import { pairKey, waysFor, type Hop, type Way } from "./pools.ts";
import {
  QUOTES_PER_REQUEST,
  candidatePaths,
  hopOf,
  quoteAll,
  routeGas,
  swapperFor,
  taxed,
  type Found,
  type Route,
} from "./swap.ts";

// Routes for several tokens sold together into one output. Each token's own route, as findRoute finds it, is priced as
// if it sold alone: two tokens whose routes meet in a pool both move it, and a token too large for one pool sells better
// in parts, through several. This picks routes for them together, in tenths, from a model of each pool they may use:
// what it pays for a few amounts, read through the swapper's quote(), and in proportion between them. A pool pays for
// two sales about what it pays for both at once, whatever their order, so the model runs the routes one after another,
// as the swap will. The model only picks the routes: what they fetch is what Base finds when it runs them.
//
// It reads only what it can afford: as many requests as the RPCs allow in a second, by what the page has learnt of their
// limits, and fewer pools and amounts per pool when they allow less. Too few, and the tokens keep their own routes.

export type Sale = { token: Address; amount: bigint; found: Found; hydrex: boolean };

// A sale moves its pools when its quote, against 100 times that of a hundredth of it, falls short by more than 0.1%.
const PROBE = 100n;
const IMPACT = 0.001;
// The most sales routed together, by what they fetch; the others keep their own routes.
const MAX_SALES = 8;
// A sale goes in tenths, along three routes at most.
const CHUNKS = 10;
const MAX_PARTS = 3;
// The routes considered for a sale, by what each fetches for all of it alone; and the moves made, at most.
const MAX_CANDIDATES = 24;
const MAX_MOVES = 80;
// How many pools of each pair of tokens, and how many amounts each is read at, by what the RPCs allow: the first that
// fits. Two of the amounts, all of what may reach a pool and an eighth of it, are read for every pool first.
const LADDER = [
  { pools: 3, amounts: 6 },
  { pools: 2, amounts: 5 },
  { pools: 2, amounts: 4 },
  { pools: 1, amounts: 4 },
];

const key = (address: string): string => address.toLowerCase();
const poolKey = (way: Way): string =>
  `${way.exchange} ${key(way.pool)} ${way.fee} ${way.tickSpacing} ${pairKey(way.tokenIn, way.tokenOut)}`;
// The pools of a sale's own route, each hop from what the one before paid.
const ownKeys = ({ token, found }: Sale): string[] =>
  found.route.hops.map((hop, h) => poolKey({ ...hop, tokenIn: h ? found.route.hops[h - 1]!.tokenOut : token }));

// What a pool pays, between the amounts it was read at, in proportion; past the last, at half its last rate, up to the
// least amount it refused, if any. Aero's classic pools pay 1% less, as their tax is not in the quote. All in numbers:
// the model compares, and needs no more than their precision.
export type Curve = { xs: number[]; ys: number[]; cap: number };

export function curveOf(read: [bigint, bigint | undefined][], haircut = false): Curve {
  const paid = read.filter((pair): pair is [bigint, bigint] => pair[1] !== undefined && pair[0] > 0n);
  paid.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const xs = [0];
  const ys = [0];
  for (const [x, y] of paid) {
    xs.push(Number(x));
    ys.push(Math.max(ys.at(-1)!, Number(y) * (haircut ? 0.99 : 1)));
  }
  const last = xs.at(-1)!;
  const refused = read.filter(([x, y]) => y === undefined && Number(x) > last).map(([x]) => Number(x));
  return { xs, ys, cap: refused.length ? Math.min(...refused) : paid.length ? Infinity : 0 };
}

export function along({ xs, ys, cap }: Curve, x: number): number | undefined {
  if (x <= 0) return 0;
  if (x >= cap) return undefined;
  const n = xs.length;
  if (n < 2) return undefined;
  if (x >= xs[n - 1]!) {
    const slope = (ys[n - 1]! - ys[n - 2]!) / (xs[n - 1]! - xs[n - 2]!);
    return ys[n - 1]! + ((x - xs[n - 1]!) * slope) / 2;
  }
  let i = 1;
  while (xs[i]! < x) i++;
  return ys[i - 1]! + ((ys[i]! - ys[i - 1]!) * (x - xs[i - 1]!)) / (xs[i]! - xs[i - 1]!);
}

// A route a sale may take, by its pools' keys; and the model: each sale's amount, its routes, the first of which is its
// own, what each pool pays, and gas, in the output, per unit.
export type Candidate = { pools: string[]; hops: Hop[]; gas: number };
export type Model = { amounts: number[]; candidates: Candidate[][]; curves: Map<string, Curve>; gasPrice: number };

// What the routes fetch, less their gas, with each sale's tenths along its routes as `chunks` says, run in order: a sale,
// then the next, each route after the last. Undefined if a pool would be asked for more than it can take.
export function worth({ amounts, candidates, curves, gasPrice }: Model, chunks: number[][]): number | undefined {
  const used = new Map<string, number>();
  let total = 0;
  for (const [s, routes] of candidates.entries()) {
    for (const [c, route] of routes.entries()) {
      const n = chunks[s]![c]!;
      if (!n) continue;
      let x = (amounts[s]! * n) / CHUNKS;
      for (const pool of route.pools) {
        const curve = curves.get(pool);
        const before = used.get(pool) ?? 0;
        const [from, to] = curve ? [along(curve, before), along(curve, before + x)] : [];
        if (from === undefined || to === undefined) return undefined;
        used.set(pool, before + x);
        x = to - from;
      }
      total += x - route.gas * gasPrice;
    }
  }
  return total;
}

// Each sale's tenths, by route: all along its own at first. Then, a sale at a time, in turn, its best move of a tenth, or
// of all a route has, to another route, while one gains: for eight sales, in about a tenth of a second.
export function allocate(model: Model): number[][] {
  const chunks = model.candidates.map((routes) => routes.map((_, c): number => (c === 0 ? CHUNKS : 0)));
  let best = worth(model, chunks);
  if (best === undefined) return chunks;
  let still = 0;
  for (let moves = 0, s = 0; moves < MAX_MOVES && still < chunks.length; s = (s + 1) % chunks.length) {
    const row = chunks[s]!;
    const parts = row.filter(Boolean).length;
    let found: { from: number; to: number; n: number; value: number } | undefined;
    for (const [from, held] of row.entries()) {
      if (!held) continue;
      for (const to of row.keys()) {
        if (to === from) continue;
        for (const n of held > 1 ? [1, held] : [1]) {
          if (!row[to] && n < held && parts >= MAX_PARTS) continue;
          row[from] = held - n;
          row[to]! += n;
          const value = worth(model, chunks);
          row[to]! -= n;
          row[from] = held;
          const bar = found?.value ?? best;
          if (value !== undefined && value > bar + Math.abs(bar) * 1e-9) found = { from, to, n, value };
        }
      }
    }
    if (!found) {
      still++;
      continue;
    }
    row[found.from]! -= found.n;
    row[found.to]! += found.n;
    best = found.value;
    still = 0;
    moves++;
  }
  return chunks;
}

// The routes for `sales`, in their order, each in its parts, if routing them together gains on their own routes:
// undefined otherwise, or when the RPCs allow too little to find out. Gas is valued in the output by `gasValue`.
export async function routeTogether(
  sales: Sale[],
  output: Swapper,
  gasValue: (gas: bigint) => bigint,
): Promise<Route[][] | undefined> {
  const budget = rate();
  if (budget < 4) return undefined;
  // Which sales move their pools: the others are too small to matter, and keep their own routes.
  const probes = await quoteAll(
    sales.map(({ found, amount }) => ({
      swapper: output,
      route: { ...found.route, amount: amount / PROBE, minPaid: 0n },
    })),
  );
  const heavy = sales
    .map((sale, i) => ({ sale, i, probe: probes[i] }))
    .filter(({ sale, probe }) => {
      if (!probe?.done || !probe.amountOut || sale.amount < PROBE) return false;
      return Number(sale.found.out) < Number(probe.amountOut * PROBE) * (1 - IMPACT);
    })
    .sort((a, b) => (a.sale.found.out > b.sale.found.out ? -1 : 1))
    .slice(0, MAX_SALES);
  if (!heavy.length) return undefined;
  const paths = heavy.map(({ sale }) => candidatePaths(sale.token, output.token, sale.hydrex));
  const pairs = [
    ...new Map(
      paths.flat().flatMap((path) => path.slice(1).map((b, i) => [pairKey(path[i]!, b), [path[i]!, b]] as const)),
    ).values(),
  ] as [Address, Address][];
  const ways = await waysFor(pairs);
  const poolsOf = (a: Address, b: Address) => ways.get(pairKey(a, b)) ?? [];
  const all = pairs.reduce((sum, [a, b]) => sum + poolsOf(a, b).length, 0);
  // Two requests left for running both plans through Base.
  const requests = (quotes: number) => Math.ceil(quotes / QUOTES_PER_REQUEST);
  const step = LADDER.find(
    ({ pools, amounts }) =>
      requests(2 * all) +
        requests(pairs.reduce((sum, [a, b]) => sum + Math.min(pools, poolsOf(a, b).length) * (amounts - 2), 0)) +
        2 <=
      budget,
  );
  if (!step) return undefined;

  // What each pool paid for each amount read.
  const read = new Map<string, Map<bigint, bigint | undefined>>();
  const readAll = async (asks: { way: Way; amounts: bigint[] }[]) => {
    const items = asks.flatMap(({ way, amounts }) => {
      const known = read.get(poolKey(way));
      return [...new Set(amounts)]
        .filter((amount) => amount > 0n && !known?.has(amount))
        .map((amount) => ({ way, amount }));
    });
    const results = await quoteAll(
      items.map(({ way, amount }) => ({
        swapper: swapperFor(way.tokenOut)!,
        route: { token: way.tokenIn, amount, minPaid: 0n, hops: [hopOf(way)] },
      })),
    );
    items.forEach(({ way, amount }, i) => {
      const at = read.get(poolKey(way)) ?? new Map();
      at.set(amount, results[i]?.done ? results[i]!.amountOut : undefined);
      read.set(poolKey(way), at);
    });
  };

  // What may reach each token: the sale's own, if it is one, and the most each pair into it may pay. Each pair's pools
  // are read at all of that and an eighth, in up to three rounds, as a route has up to three hops; again when it grew
  // by more than a tenth.
  const own = new Map(heavy.map(({ sale }) => [key(sale.token), sale.amount]));
  const most = new Map<string, bigint>();
  const reach = new Map<string, bigint>();
  const into = (token: Address) =>
    pairs.reduce(
      (sum, [a, b]) => (key(b) === key(token) ? sum + (most.get(pairKey(a, b)) ?? 0n) : sum),
      own.get(key(token)) ?? 0n,
    );
  for (let round = 0; round < 3; round++) {
    const due = pairs
      .map(([a, b]) => ({ a, b, range: into(a) }))
      .filter(({ a, b, range }) => {
        const was = reach.get(pairKey(a, b));
        return range > 0n && (was === undefined || range * 10n > was * 11n);
      });
    if (!due.length) break;
    await readAll(
      due.flatMap(({ a, b, range }) => poolsOf(a, b).map((way) => ({ way, amounts: [range, range / 8n] }))),
    );
    for (const { a, b, range } of due) {
      reach.set(pairKey(a, b), range);
      const paid = poolsOf(a, b).map((way) => {
        const at = read.get(poolKey(way))!;
        return at.get(range) ?? (at.get(range / 8n) ?? 0n) * 8n;
      });
      most.set(
        pairKey(a, b),
        paid.reduce((max, each) => (each > max ? each : max), 0n),
      );
    }
  }

  // The pools kept for each pair: the best for an eighth of what may reach them, and those of the sales' own routes. Each
  // is read at more amounts, halving from all of it.
  const ownPools = new Set(heavy.flatMap(({ sale }) => ownKeys(sale)));
  const kept = new Map<string, Way[]>();
  for (const [a, b] of pairs) {
    const range = reach.get(pairKey(a, b));
    if (range === undefined) continue;
    const eighth = (way: Way) => read.get(poolKey(way))?.get(range / 8n) ?? 0n;
    const ranked = poolsOf(a, b)
      .filter((way) => eighth(way) > 0n)
      .sort((x, y) => (eighth(x) > eighth(y) ? -1 : eighth(x) < eighth(y) ? 1 : 0));
    const chosen = ranked.slice(0, step.pools);
    for (const way of poolsOf(a, b)) if (ownPools.has(poolKey(way)) && !chosen.includes(way)) chosen.push(way);
    kept.set(pairKey(a, b), chosen);
  }
  await readAll(
    pairs.flatMap(([a, b]) => {
      const range = reach.get(pairKey(a, b));
      if (range === undefined) return [];
      const amounts = Array.from({ length: step.amounts }, (_, k) => range >> BigInt(k));
      return (kept.get(pairKey(a, b)) ?? []).map((way) => ({ way, amounts }));
    }),
  );
  const curves = new Map(
    [...kept.values()].flat().map((way) => [poolKey(way), curveOf([...read.get(poolKey(way))!], taxed(way))] as const),
  );

  // Each sale's routes: every path, through every pool kept for each of its hops; its own route first.
  const candidates = heavy.map(({ sale }, s) => {
    const routes: Candidate[] = [];
    for (const path of paths[s]!) {
      let partial: Way[][] = [[]];
      for (let h = 0; h + 1 < path.length; h++) {
        const options = kept.get(pairKey(path[h]!, path[h + 1]!)) ?? [];
        partial = partial.flatMap((ways) => options.map((way) => [...ways, way]));
      }
      for (const ways of partial) {
        const hops = ways.map(hopOf);
        routes.push({ pools: ways.map(poolKey), hops, gas: Number(routeGas({ hops })) });
      }
    }
    const mine = ownKeys(sale);
    const own: Candidate = { pools: mine, hops: sale.found.route.hops, gas: Number(sale.found.gas) };
    const others = routes.filter(({ pools }) => pools.join() !== mine.join());
    // The best alone, if there are too many.
    const alone = (route: Candidate) =>
      worth({ amounts: [Number(sale.amount)], candidates: [[route]], curves, gasPrice: 0 }, [[CHUNKS]]) ?? -Infinity;
    const best = others
      .map((route) => ({ route, value: alone(route) }))
      .filter(({ value }) => value > 0)
      .sort((a, b) => b.value - a.value)
      .slice(0, MAX_CANDIDATES - 1)
      .map(({ route }) => route);
    return [own, ...best];
  });
  const gasPrice = Number(gasValue(1_000_000n)) / 1e6;
  const model: Model = { amounts: heavy.map(({ sale }) => Number(sale.amount)), candidates, curves, gasPrice };
  const chunks = allocate(model);
  if (chunks.every((row) => row[0] === CHUNKS)) return undefined;

  // Each sale's parts, largest first; the last takes what the tenths leave, so that they add up to the sale.
  const routes: Route[][] = sales.map(({ found, amount }) => [{ ...found.route, amount, minPaid: 0n }]);
  heavy.forEach(({ sale, i }, s) => {
    const parts = candidates[s]!.map((route, c) => ({ route, n: chunks[s]![c]! }))
      .filter(({ n }) => n)
      .sort((a, b) => b.n - a.n);
    let left = sale.amount;
    routes[i] = parts.map(({ route, n }, p) => {
      const amount = p === parts.length - 1 ? left : (sale.amount * BigInt(n)) / BigInt(CHUNKS);
      left -= amount;
      return { token: sale.token, amount, minPaid: 0n, hops: route.hops };
    });
  });
  return routes;
}
