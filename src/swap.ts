import {
  decodeErrorResult,
  decodeEventLog,
  decodeFunctionResult,
  encodeFunctionData,
  type Address,
  type Hex,
} from "viem";
import { ABI, CBBTC, FEE_BPS, HYDX, SWAPPERS, USDC, WETH, type Swapper } from "./config.ts";
import { exchangeOf, pairKey, waysFor, type Hop, type Way } from "./pools.ts";
import { call, now, read, simulate, type Call, type Read, type Receipt, type Simulated } from "./rpc.ts";
import { key, maxBy, packInOrder, same } from "./util.ts";
import type { Tx } from "./wallet.ts";

// ImmutableSwapper sells the tokens named for its output, each along the route given: the page finds the tokens, routes
// and minimums, from the twelve exchanges' factories and the swapper's own quote().
export type Route = { token: Address; amount: bigint; minPaid: bigint; hops: Hop[] };
export type Result = { done: boolean; amountIn: bigint; amountOut: bigint; reason: Hex };

// A route goes straight, or through WETH, USDC or cbBTC, or HYDX for Hydrex's tokens; at most three hops.
export const MIDDLES: Address[] = [WETH, USDC, CBBTC];

export function candidatePaths(token: Address, output: Address, hydrex = false): Address[][] {
  if (same(token, output)) return [];
  const middles = [...MIDDLES, ...(hydrex ? [HYDX] : [])].filter(
    (middle) => !same(middle, token) && !same(middle, output),
  );
  const paths = [[token, output], ...middles.map((middle) => [token, middle, output])];
  // Hydrex's tokens often trade only against HYDX.
  if (hydrex && !same(token, HYDX) && !same(output, HYDX)) {
    for (const middle of [WETH, USDC])
      if (!same(middle, output) && !same(middle, token)) paths.push([token, HYDX, middle, output]);
  }
  return paths;
}

// Aero's classic pools add an MEV tax above a tip of 1 gwei, which a quote does not see.
export const taxed = ({ exchange }: Hop): boolean => exchangeOf(exchange).kind === "solidly";
// "Aero", "Aerodrome", "Uniswap", "Hydrex".
export const venueOf = ({ exchange }: Hop): string => exchangeOf(exchange).name.split(" ")[0]!;

// The pool that pays most; one of Aero's classic pools only by more than 1%, as its tax can take up to 10%.
export function best<T extends { way: Hop; out: bigint }>(quotes: T[]): T | undefined {
  const paid = quotes.filter(({ out }) => out > 0n);
  const plain = maxBy(
    paid.filter(({ way }) => !taxed(way)),
    ({ out }) => out,
  );
  const aero = maxBy(
    paid.filter(({ way }) => taxed(way)),
    ({ out }) => out,
  );
  if (!aero) return plain;
  if (!plain) return aero;
  return aero.out * 100n > plain.out * 101n ? aero : plain;
}

// Gas, as the swapper's tests measure it: Hydrex's Algebra pools look for an arbitrage after each swap, about a million
// a hop. A transaction may use 16.7 million on Base; each swap stays under 15.
export const APPROVAL_GAS = 46_000n;
const SWAP_GAS = 150_000n;
const ROUTE_GAS = 50_000n;
export const MAX_SWAP_GAS = 15_000_000n;

function hopGas({ exchange }: Hop): bigint {
  const { kind } = exchangeOf(exchange);
  if (kind === "algebra") return 1_000_000n;
  if (kind === "pair" || kind === "solidly" || kind === "aerodrome" || kind === "v2") return 50_000n;
  return 110_000n;
}

export const routeGas = ({ hops }: { hops: Hop[] }): bigint => hops.reduce((sum, hop) => sum + hopGas(hop), ROUTE_GAS);
export const swapGas = (routes: { hops: Hop[] }[]): bigint =>
  routes.reduce((sum, route) => sum + routeGas(route), SWAP_GAS);

export const split = <T extends { hops: Hop[] }>(routes: T[]): T[][] => packInOrder(routes, swapGas, MAX_SWAP_GAS);

// The 1% of a route's output, rounded down as the swapper does; and the least it may pay, less a margin.
export const feeOf = (out: bigint): bigint => (out * FEE_BPS) / 10_000n;
export const paidOf = (out: bigint): bigint => out - feeOf(out);
export const minimumOf = (out: bigint, marginBps: bigint): bigint => (paidOf(out) * (10_000n - marginBps)) / 10_000n;

// A route for `amount` of what was quoted for `expected`, as when a claim brings less: quote and minimum shrink with it.
export function partOf<T extends { route: Route; out: bigint }>(item: T, amount: bigint, expected: bigint): T {
  if (amount >= expected) return { ...item, route: { ...item.route, amount } };
  const share = (value: bigint) => (value * amount) / expected;
  return { ...item, out: share(item.out), route: { ...item.route, amount, minPaid: share(item.route.minPaid) } };
}

const quoteCall = (swapper: Swapper, routes: Route[]): Call => call(swapper.address, ABI.swapper, "quote", routes);

// Six routes a call, three calls a request, as an Algebra hop takes a million gas and an eth_call gets 50. A route that
// fails quotes nothing; a read that fails throws, so a token is not taken for one without routes.
const ROUTES_PER_QUOTE = 6;
const QUOTES_PER_READ = 3;
export const QUOTES_PER_REQUEST = ROUTES_PER_QUOTE * QUOTES_PER_READ;

export async function quoteAll(
  items: { swapper: Swapper; route: Route }[],
  reader: Read = read,
): Promise<(Result | undefined)[]> {
  const calls: { call: Call; at: number[] }[] = [];
  const bySwapper = new Map<Swapper, number[]>();
  items.forEach(({ swapper }, i) => bySwapper.set(swapper, [...(bySwapper.get(swapper) ?? []), i]));
  for (const [swapper, indexes] of bySwapper) {
    for (let i = 0; i < indexes.length; i += ROUTES_PER_QUOTE) {
      const at = indexes.slice(i, i + ROUTES_PER_QUOTE);
      calls.push({
        call: quoteCall(
          swapper,
          at.map((index) => items[index]!.route),
        ),
        at,
      });
    }
  }
  const replies = await reader(
    calls.map(({ call }) => call),
    "latest",
    QUOTES_PER_READ,
  );
  const results: (Result | undefined)[] = items.map(() => undefined);
  calls.forEach(({ at }, i) => {
    const found = replies[i] as readonly Result[] | undefined;
    at.forEach((index, j) => (results[index] = found?.[j]));
  });
  return results;
}

export const swapperFor = (token: Address): Swapper | undefined =>
  SWAPPERS.find((swapper) => same(swapper.token, token));

// A token's best route, net of gas valued in the output by `gasValue`: each hop takes its best pool for what the one
// before paid, then longer routes are quoted whole, as their pools may meet.
export type Found = { route: Route; out: bigint; gas: bigint };

export async function findRoute(
  token: Address,
  amount: bigint,
  output: Swapper,
  hydrex: boolean,
  gasValue: (gas: bigint) => bigint = () => 0n,
  reader: Read = read,
): Promise<Found | undefined> {
  const paths = candidatePaths(token, output.token, hydrex);
  type Partial = { path: Address[]; hops: Hop[]; amount: bigint };
  let open: Partial[] = paths.map((path) => ({ path, hops: [], amount }));
  const complete: Partial[] = [];
  while (open.length) {
    const legs = open.map(({ path, hops }) => [path[hops.length]!, path[hops.length + 1]!] as [Address, Address]);
    const ways = await waysFor(legs, undefined, reader);
    const asked = new Map<string, { way: Way; index: number }[]>();
    const items: { swapper: Swapper; route: Route }[] = [];
    open.forEach((partial, i) => {
      const [a, b] = legs[i]!;
      const id = `${pairKey(a, b)} ${partial.amount}`;
      if (asked.has(id)) return;
      const these = (ways.get(pairKey(a, b)) ?? []).map((way) => {
        items.push({
          swapper: swapperFor(b)!,
          route: { token: a, amount: partial.amount, minPaid: 0n, hops: [hopOf(way)] },
        });
        return { way, index: items.length - 1 };
      });
      asked.set(id, these);
    });
    const results = await quoteAll(items, reader);
    const next: Partial[] = [];
    open.forEach((partial, i) => {
      const [a, b] = legs[i]!;
      const quoted = asked.get(`${pairKey(a, b)} ${partial.amount}`)!.map(({ way, index }) => {
        const result = results[index];
        return { way: hopOf(way), out: result?.done ? result.amountOut : 0n };
      });
      const chosen = best(quoted);
      if (!chosen) return;
      const moved = { path: partial.path, hops: [...partial.hops, chosen.way], amount: chosen.out };
      (moved.hops.length === partial.path.length - 1 ? complete : next).push(moved);
    });
    open = next;
  }
  if (!complete.length) return undefined;
  const longer = complete.filter(({ hops }) => hops.length > 1);
  const whole = longer.length
    ? await quoteAll(
        longer.map(({ hops }) => ({ swapper: output, route: { token, amount, minPaid: 0n, hops } })),
        reader,
      )
    : [];
  const options = complete.flatMap((partial) => {
    const route = { token, amount, minPaid: 0n, hops: partial.hops };
    const i = longer.indexOf(partial);
    const result = whole[i];
    const out = i < 0 ? partial.amount : result?.done ? result.amountOut : 0n;
    if (out === 0n) return [];
    const gas = routeGas(route);
    return [{ route, out, gas, net: out - gasValue(gas) }];
  });
  const chosen = maxBy(options, ({ net }) => net);
  return chosen && { route: chosen.route, out: chosen.out, gas: chosen.gas };
}

export const hopOf = ({ exchange, pool, tokenOut, fee, tickSpacing }: Hop): Hop => ({
  exchange,
  pool,
  tokenOut,
  fee,
  tickSpacing,
});

export const approve = (token: Address, spender: Address, amount: bigint): Tx => ({
  to: token,
  data: encodeFunctionData({ abi: ABI.erc20, functionName: "approve", args: [spender, amount] }),
});

export const swapCall = (swapper: Swapper, routes: Route[], deadline: bigint): Tx => ({
  to: swapper.address,
  data: encodeFunctionData({ abi: ABI.swapper, functionName: "swap", args: [routes, deadline, true] }),
});

// Each token once, in order, with what its routes sell between them: what to approve.
export function soldOf<T extends { route: Route }>(items: T[]): (T & { total: bigint })[] {
  const found = new Map<string, T & { total: bigint }>();
  for (const item of items) {
    const each = found.get(item.route.token.toLowerCase());
    if (each) each.total += item.route.amount;
    else found.set(item.route.token.toLowerCase(), { ...item, total: item.route.amount });
  }
  return [...found.values()];
}

// What each route fetched in a run of `first` calls, then the swaps; undefined unless every call ran and those first went
// through.
export function routeResults(
  run: Simulated | undefined,
  first: number,
  swaps: Route[][],
): Map<Route, Result | undefined> | undefined {
  if (!run || run.length !== first + swaps.length || run.slice(0, first).some(({ ok }) => !ok)) return undefined;
  return new Map(
    swaps.flatMap((group, g) => {
      const { ok, returnData } = run[first + g]!;
      let found: Result[] = [];
      try {
        if (ok) found = swapReturns(returnData).results;
      } catch {}
      return group.map((route, i) => [route, found[i]] as const);
    }),
  );
}

// What each route fetches when Base runs them now, in order, after their approvals, with no minimum: each finds its
// pools as those before left them. `gas` is that of all the calls.
export type InOrder = { results: (Result | undefined)[]; gas: bigint };

export async function runInOrder(
  from: Address,
  swapper: Swapper,
  routes: Route[],
  allowance: (token: Address) => bigint,
): Promise<InOrder | undefined> {
  const zeroed = routes.map((route) => ({ ...route, minPaid: 0n }));
  const approvals = soldOf(zeroed.map((route) => ({ route })))
    .filter(({ route, total }) => allowance(route.token) < total)
    .map(({ route, total }) => approve(route.token, swapper.address, total));
  const groups = split(zeroed);
  const deadline = BigInt(now() + 1_800);
  const txs = [...approvals, ...groups.map((group) => swapCall(swapper, group, deadline))];
  const run = await simulate(from, txs).catch(() => undefined);
  const results = routeResults(run, approvals.length, groups);
  return (
    results && { results: zeroed.map((route) => results.get(route)), gas: run!.reduce((sum, { gas }) => sum + gas, 0n) }
  );
}

// As when an RPC has not yet seen the token's approval.
export function refusedTransfer(reason: Hex): boolean {
  try {
    return decodeErrorResult({ abi: ABI.swapper, data: reason }).errorName === "TokenCallFailed";
  } catch {
    return false;
  }
}

function swapReturns(returnData: Hex): { results: Result[]; paid: bigint; fee: bigint } {
  const [results, paid, fee] = decodeFunctionResult({ abi: ABI.swapper, functionName: "swap", data: returnData });
  return { results: [...results], paid, fee };
}

// Why a route failed, in words.
export function reasonOf(reason: Hex): string {
  try {
    const { errorName } = decodeErrorResult({ abi: ABI.swapper, data: reason });
    switch (errorName) {
      case "TooLittle":
        return "it would have fetched less than its minimum";
      case "NoOutput":
        return "a pool gave nothing for it";
      case "TokenCallFailed":
        return "its token refused the transfer";
      case "PartialFill":
        return "a pool could not take all of it";
      case "Expired":
        return "the swap's deadline had passed";
      default:
        return "a pool refused it";
    }
  } catch {
    return "a pool or its token refused it";
  }
}

// What a swap did for `caller`, from its receipts.
export type Swapped = {
  swapped: { index: number; token: Address; amountIn: bigint; amountOut: bigint }[];
  failed: { index: number; token: Address; reason: Hex }[];
  paid: bigint;
  fee: bigint;
};

export function swappedIn(receipts: Receipt[], swapper: Swapper, caller: Address): Swapped {
  const outcome: Swapped = { swapped: [], failed: [], paid: 0n, fee: 0n };
  for (const { logs } of receipts) {
    for (const log of logs) {
      if (!same(log.address, swapper.address)) continue;
      let event;
      try {
        event = decodeEventLog({ abi: ABI.swapper, data: log.data, topics: log.topics as [Hex, ...Hex[]] });
      } catch {
        continue;
      }
      // A batch may hold others' swaps.
      if (!same(event.args.caller, caller)) continue;
      if (event.eventName === "RouteSwapped") {
        const { index, token, amountIn, amountOut } = event.args;
        outcome.swapped.push({ index: Number(index), token, amountIn, amountOut });
      } else if (event.eventName === "RouteFailed") {
        const { index, token, reason } = event.args;
        outcome.failed.push({ index: Number(index), token, reason });
      } else if (event.eventName === "Swapped") {
        outcome.paid += event.args.paid;
        outcome.fee += event.args.fee;
      }
    }
  }
  return outcome;
}
