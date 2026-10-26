import {
  decodeErrorResult,
  decodeEventLog,
  decodeFunctionResult,
  encodeFunctionData,
  parseAbi,
  type Address,
  type Hex,
} from "viem";
import { call, now, read, rpc, same, type Call, type Receipt } from "./chain.ts";
import { CBBTC, CHAIN_ID, HYDX, SWAPPERS, SWAP_FEE_BPS, USDC, WETH, type Swapper } from "./config.ts";
import { exchangeOf, pairKey, waysFor, type Hop, type Way } from "./pools.ts";
import type { Tx } from "./wallet.ts";

// The swap: ImmutableSwapper sells the tokens its caller names for its output, each along the route its caller picks.
// It picks no route, sets no minimum and finds no tokens: the page does all three, in the browser, from the factories
// of the twelve exchanges it checks pools against, and its own quote().

export const swapperAbi = parseAbi([
  "struct Hop { uint8 exchange; address pool; address tokenOut; uint24 fee; int24 tickSpacing; }",
  "struct Route { address token; uint256 amount; uint256 minPaid; Hop[] hops; }",
  "struct Result { bool done; uint256 amountIn; uint256 amountOut; bytes reason; }",
  "function swap(Route[] routes, uint256 deadline, bool skipFailed) returns (Result[] results, uint256 paid, uint256 fee)",
  "function quote(Route[] routes) returns (Result[] results)",
  "event RouteSwapped(address indexed caller, uint256 index, address token, uint256 amountIn, uint256 amountOut)",
  "event RouteFailed(address indexed caller, uint256 index, address token, bytes reason)",
  "event Swapped(address indexed caller, uint256 paid, uint256 fee)",
  "error Expired()",
  "error BadHopCount(uint256 route)",
  "error BadPath(uint256 route, uint256 hop)",
  "error NotExchangePool(uint8 exchange, address pool)",
  "error NativeOutsideV4(uint256 route, uint256 hop)",
  "error NoOutput(uint256 route, uint256 hop)",
  "error PartialFill(address pool)",
  "error NotExpectedCaller(address caller)",
  "error TooLittle(uint256 route, uint256 paid, uint256 minPaid)",
  "error Quoted(uint256 amountOut)",
  "error TokenCallFailed(address token)",
  "error OnlySelf()",
  "error Reentrancy()",
  "error ZeroAddress()",
]);
export const erc20Abi = parseAbi([
  "function balanceOf(address owner) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
]);
export type Route = { token: Address; amount: bigint; minPaid: bigint; hops: Hop[] };
export type Result = { done: boolean; amountIn: bigint; amountOut: bigint; reason: Hex };

// The tokens a route may pass through: to the output straight, or through WETH, USDC or cbBTC, and HYDX too for
// Hydrex's tokens. A route has at most three hops.
export const MIDDLES: Address[] = [WETH, USDC, CBBTC];

export function candidatePaths(token: Address, output: Address, hydrex = false): Address[][] {
  if (same(token, output)) return [];
  const middles = [...MIDDLES, ...(hydrex ? [HYDX] : [])].filter(
    (middle) => !same(middle, token) && !same(middle, output),
  );
  const paths = [[token, output], ...middles.map((middle) => [token, middle, output])];
  // Hydrex's tokens often trade only against HYDX, which then trades against WETH or USDC.
  if (hydrex && !same(token, HYDX) && !same(output, HYDX)) {
    for (const middle of [WETH, USDC])
      if (!same(middle, output) && !same(middle, token)) paths.push([token, HYDX, middle, output]);
  }
  return paths;
}

// Aero's classic pools add an MEV tax above a tip of 1 gwei, which a quote does not see.
export const taxed = ({ exchange }: Hop): boolean => exchangeOf(exchange).kind === "solidly";
export const MAX_TIP = 1_000_000_000n;

// Who runs a hop's exchange, as a bill names it: "Aero", "Aerodrome", "Uniswap", "Hydrex". The first word of the
// exchange's name: Aero's own pools and Aerodrome's keep their names apart.
export const venueOf = ({ exchange }: Hop): string => exchangeOf(exchange).name.split(" ")[0]!;

// The best of a hop's pools by what each pays, unless it is one of Aero's classic pools, which wins only by more than
// 1%: its MEV tax can take up to 10% that a quote does not see.
export function best<T extends { way: Hop; out: bigint }>(quotes: T[]): T | undefined {
  const paid = quotes.filter(({ out }) => out > 0n);
  const top = (list: T[]) =>
    list.reduce<T | undefined>((found, each) => (!found || each.out > found.out ? each : found), undefined);
  const plain = top(paid.filter(({ way }) => !taxed(way)));
  const aero = top(paid.filter(({ way }) => taxed(way)));
  if (!aero) return plain;
  if (!plain) return aero;
  return aero.out * 100n > plain.out * 101n ? aero : plain;
}

// Gas, as the swapper's own tests measure it: Hydrex's Algebra pools look for an arbitrage after each swap, which costs
// about a million a hop. A transaction may use 16.7 million on Base; the page keeps each swap under 15 million.
export const APPROVAL_GAS = 46_000n;
const SWAP_GAS = 150_000n;
const ROUTE_GAS = 50_000n;
export const MAX_SWAP_GAS = 15_000_000n;

export function hopGas({ exchange }: Hop): bigint {
  const { kind } = exchangeOf(exchange);
  if (kind === "algebra") return 1_000_000n;
  if (kind === "pair" || kind === "solidly" || kind === "aerodrome" || kind === "v2") return 50_000n;
  return 110_000n;
}

export const routeGas = ({ hops }: { hops: Hop[] }): bigint => hops.reduce((sum, hop) => sum + hopGas(hop), ROUTE_GAS);
export const swapGas = (routes: { hops: Hop[] }[]): bigint =>
  routes.reduce((sum, route) => sum + routeGas(route), SWAP_GAS);

// The routes, in their order, in as few swaps as keep each under MAX_SWAP_GAS.
export function split<T extends { hops: Hop[] }>(routes: T[], limit = MAX_SWAP_GAS): T[][] {
  const swaps: T[][] = [];
  for (const route of routes) {
    const last = swaps.at(-1);
    if (last && swapGas([...last, route]) <= limit) last.push(route);
    else swaps.push([route]);
  }
  return swaps;
}

// The swap's 1% of a route's output, rounded down as its code rounds it, and the least it may pay after the fee: the
// quote, less the fee, less the minimum's margin.
export const feeOf = (out: bigint): bigint => (out * SWAP_FEE_BPS) / 10_000n;
export const paidOf = (out: bigint): bigint => out - feeOf(out);
export const minimumOf = (out: bigint, marginBps: bigint): bigint => (paidOf(out) * (10_000n - marginBps)) / 10_000n;

// A route for `amount` of a token quoted for `expected`, as when a claim brings part of what the page expected: its quote
// and its minimum shrink in proportion, so that it is not skipped for missing a minimum set for the whole. Selling less
// moves the price less, so the share stays within reach. For as much or more, they stay as they were.
export function partOf<T extends { route: Route; out: bigint }>(item: T, amount: bigint, expected: bigint): T {
  if (amount >= expected) return { ...item, route: { ...item.route, amount } };
  const share = (value: bigint) => (value * amount) / expected;
  return { ...item, out: share(item.out), route: { ...item.route, amount, minPaid: share(item.route.minPaid) } };
}

const quoteCall = (swapper: Swapper, routes: Route[]): Call =>
  call(swapper.address, swapperAbi as never, "quote", routes);

// Quotes routes on each output's swapper: several routes a call, and a few calls a read, as a hop through Hydrex's
// Algebra pools needs about a million gas, and an RPC gives an eth_call up to 50 million. A route that fails quotes
// nothing; a read that fails throws, so that a token whose routes could not be read is not taken for one without any.
const ROUTES_PER_QUOTE = 6;
const QUOTES_PER_READ = 3;
export const QUOTES_PER_REQUEST = ROUTES_PER_QUOTE * QUOTES_PER_READ;

export async function quoteAll(items: { swapper: Swapper; route: Route }[]): Promise<(Result | undefined)[]> {
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
  const replies = await read(
    calls.map(({ call }) => call),
    "latest",
    true,
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

// A token's best route to the output, net of the gas each costs in the output, `gasValue` of gas. Each hop takes the
// best of its pools for what the hop before paid; then each route of several hops is quoted whole, as its hops' pools
// may meet.
export type Found = { route: Route; out: bigint; gas: bigint };

export async function findRoute(
  token: Address,
  amount: bigint,
  output: Swapper,
  hydrex: boolean,
  gasValue: (gas: bigint) => bigint = () => 0n,
): Promise<Found | undefined> {
  const paths = candidatePaths(token, output.token, hydrex);
  type Partial = { path: Address[]; hops: Hop[]; amount: bigint };
  let open: Partial[] = paths.map((path) => ({ path, hops: [], amount }));
  const complete: Partial[] = [];
  while (open.length) {
    const legs = open.map(({ path, hops }) => [path[hops.length]!, path[hops.length + 1]!] as [Address, Address]);
    const ways = await waysFor(legs);
    // One quote per pool of each leg, for what the hop before paid. Legs that share their pair and amount share quotes.
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
    const results = await quoteAll(items);
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
  // A route of one hop was quoted whole already, as its hop. Longer ones are quoted again, as their hops' pools may meet.
  const longer = complete.filter(({ hops }) => hops.length > 1);
  const whole = longer.length
    ? await quoteAll(longer.map(({ hops }) => ({ swapper: output, route: { token, amount, minPaid: 0n, hops } })))
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
  const chosen = options.reduce<(typeof options)[number] | undefined>(
    (found, each) => (!found || each.net > found.net ? each : found),
    undefined,
  );
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
  data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [spender, amount] }),
});

export const swapCall = (swapper: Swapper, routes: Route[], deadline: bigint): Tx => ({
  to: swapper.address,
  data: encodeFunctionData({ abi: swapperAbi, functionName: "swap", args: [routes, deadline, true] }),
});

// What Base would do with the calls from `from`, one after the other, as if sent now: whether each went through, what
// it returned, and its gas. eth_simulateV1 runs approvals and swap together, which a quote cannot.
export type Simulated = { ok: boolean; returnData: Hex; gas: bigint }[];

export async function simulate(from: Address, txs: Tx[]): Promise<Simulated> {
  const [block] = await rpc<{ calls: { status: Hex; returnData: Hex; gasUsed: Hex }[] }[]>(
    "eth_simulateV1",
    [
      {
        blockStateCalls: [{ calls: txs.map(({ to, data }) => ({ from, to, data })) }],
        validation: false,
      },
      "latest",
    ],
    { later: false },
  );
  return (block?.calls ?? []).map(({ status, returnData, gasUsed }) => ({
    ok: status === "0x1",
    returnData,
    gas: BigInt(gasUsed),
  }));
}

// What each token's routes sell between them, each token once, in the order it first comes: what to approve of it.
export function soldOf<T extends { route: Route }>(items: T[]): (T & { total: bigint })[] {
  const found = new Map<string, T & { total: bigint }>();
  for (const item of items) {
    const each = found.get(item.route.token.toLowerCase());
    if (each) each.total += item.route.amount;
    else found.set(item.route.token.toLowerCase(), { ...item, total: item.route.amount });
  }
  return [...found.values()];
}

// What each route fetched in a run through Base of calls whose swaps, `swaps`, follow `first` others: undefined unless
// Base answered for every call and ran each of those first ones. A route whose swap Base refused has no result.
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
      } catch {
        // A reply that is not the swap's: no results.
      }
      return group.map((route, i) => [route, found[i]] as const);
    }),
  );
}

// What each route fetches when Base runs them now, in their order, after the approvals they need, each with no minimum:
// so a route's pools are as those before it left them. `gas` is that of all the calls. Undefined when Base cannot say,
// or refuses an approval; a route whose swap Base refuses has no result.
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

// Whether a route failed as one whose token refused the transfer does: as when an RPC has not yet seen its approval.
export function refusedTransfer(reason: Hex): boolean {
  try {
    return decodeErrorResult({ abi: swapperAbi, data: reason }).errorName === "TokenCallFailed";
  } catch {
    return false;
  }
}

export function swapReturns(returnData: Hex): { results: Result[]; paid: bigint; fee: bigint } {
  const [results, paid, fee] = decodeFunctionResult({ abi: swapperAbi, functionName: "swap", data: returnData });
  return { results: [...results], paid, fee };
}

// Why a route failed, in words.
export function reasonOf(reason: Hex): string {
  try {
    const { errorName } = decodeErrorResult({ abi: swapperAbi, data: reason });
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

// What a swap did for `caller`, from its receipt's logs: each route that went through or failed, what reached the
// caller, and the fee.
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
        event = decodeEventLog({ abi: swapperAbi, data: log.data, topics: log.topics as [Hex, ...Hex[]] });
      } catch {
        continue;
      }
      // A batch's receipt may hold others' swaps through the same swapper.
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

// Whether the page's RPCs serve Base. The swappers are immutable, so nothing else about them can change: until this is
// read, and unless it holds, no swap is offered.
export async function onBase(): Promise<boolean> {
  return Number(await rpc<string>("eth_chainId", [])) === CHAIN_ID;
}
