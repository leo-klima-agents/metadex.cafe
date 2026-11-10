import {
  decodeErrorResult,
  decodeFunctionResult,
  encodeFunctionData,
  erc20Abi,
  maxUint256,
  parseAbi,
  parseEventLogs,
  type Address,
  type Hex,
} from "viem";
import { CBBTC, FEE_BPS, HYDX, SWAPPERS, USDC, WETH, type Swapper } from "./config.ts";
import { figure, utc } from "./format.ts";
import {
  ethCost,
  exchangeOf,
  key,
  pairKey,
  waysFor,
  worthOf,
  type Hop,
  type Prices,
  type Token,
  type Way,
} from "./prices.ts";
import { call, logsIn, read, same, simulate, type Landed, type Read, type Tx } from "./rpc.ts";
import type { Amount } from "./tokens.ts";
import type { Slip } from "./wallet.ts";

// ImmutableSwapper sells the tokens its caller names for its output token, each along the route the caller gives, and
// takes 1% of each route's output. It picks no routes and sets no minimums: the page does, from the pools of the twelve
// exchanges the swapper accepts and the swapper's own `quote()`.

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
// An `amount` of `maxUint256` sells the whole balance, up to the approval, as after a claim.
export type Route = { token: Address; amount: bigint; minPaid: bigint; hops: Hop[] };
export type Result = { done: boolean; amountIn: bigint; amountOut: bigint; reason: Hex };
export const swapperFor = (token: Address): Swapper | undefined =>
  SWAPPERS.find((swapper) => same(swapper.token, token));
export const hopOf = ({ exchange, pool, tokenOut, fee, tickSpacing }: Hop): Hop => ({
  exchange,
  pool,
  tokenOut,
  fee,
  tickSpacing,
});

// The tokens a route may pass through: WETH, USDC and cbBTC, plus HYDX for Hydrex's tokens. Those often trade only
// against HYDX, which trades against WETH or USDC, so a route can take up to three hops.
export const MIDDLES: Address[] = [WETH, USDC, CBBTC];
export function candidatePaths(token: Address, output: Address, hydrex = false): Address[][] {
  if (same(token, output)) return [];
  const middles = [...MIDDLES, ...(hydrex ? [HYDX] : [])].filter(
    (middle) => !same(middle, token) && !same(middle, output),
  );
  const paths = [[token, output], ...middles.map((middle) => [token, middle, output])];
  if (hydrex && !same(token, HYDX) && !same(output, HYDX))
    for (const middle of [WETH, USDC])
      if (!same(middle, output) && !same(middle, token)) paths.push([token, HYDX, middle, output]);
  return paths;
}

// Aero's basic pools charge an MEV tax on tips above 1 gwei, which a quote does not see, so one of them wins a hop only
// when it pays over 1% more than the best other pool.
export const taxed = ({ exchange }: Hop): boolean => exchangeOf(exchange).kind === "solidly";
export const venueOf = ({ exchange }: Hop): string => exchangeOf(exchange).name.split(" ")[0]!;
const top = <T>(list: T[], by: (each: T) => bigint): T | undefined =>
  list.reduce<T | undefined>((found, each) => (!found || by(each) > by(found) ? each : found), undefined);
export function best<T extends { way: Hop; out: bigint }>(quotes: T[]): T | undefined {
  const paid = quotes.filter(({ out }) => out > 0n);
  const [plain, aero] = [false, true].map((tax) =>
    top(
      paid.filter(({ way }) => taxed(way) === tax),
      ({ out }) => out,
    ),
  );
  return !aero ? plain : !plain ? aero : aero.out * 100n > plain.out * 101n ? aero : plain;
}

// Gas figures come from the swapper's tests. Hydrex's Algebra pools look for an arbitrage after each swap, which costs
// about a million gas a hop. Base allows 16.7 million gas a transaction; the page keeps each swap under 15 million.
export const APPROVAL_GAS = 46_000n;
export const MAX_SWAP_GAS = 15_000_000n;
function hopGas({ exchange }: Hop): bigint {
  const { kind } = exchangeOf(exchange);
  return kind === "algebra" ? 1_000_000n : ["pair", "solidly", "aerodrome", "v2"].includes(kind) ? 50_000n : 110_000n;
}
export const routeGas = ({ hops }: { hops: Hop[] }): bigint => hops.reduce((sum, hop) => sum + hopGas(hop), 50_000n);
export const swapGas = (routes: { hops: Hop[] }[]): bigint =>
  routes.reduce((sum, route) => sum + routeGas(route), 150_000n);
export function split<T extends { hops: Hop[] }>(routes: T[]): T[][] {
  const swaps: T[][] = [];
  for (const route of routes) {
    const last = swaps.at(-1);
    if (last && swapGas([...last, route]) <= MAX_SWAP_GAS) last.push(route);
    else swaps.push([route]);
  }
  return swaps;
}

// The swapper's fee on a route's output, rounded down as the swapper rounds it. `minimumOf` is the least a route may
// pay: its output less the fee, then less the slippage margin.
export const feeOf = (out: bigint): bigint => (out * FEE_BPS) / 10_000n;
export const paidOf = (out: bigint): bigint => out - feeOf(out);
export const minimumOf = (out: bigint, marginBps: bigint): bigint => (paidOf(out) * (10_000n - marginBps)) / 10_000n;
// Sets a route's amount to what a claim brought. When that is less than `expected`, its quote and minimum shrink in
// proportion; otherwise they stay as they were.
export function partOf<T extends { route: Route; out: bigint }>(item: T, amount: bigint, expected: bigint): T {
  if (amount >= expected) return { ...item, route: { ...item.route, amount } };
  const share = (value: bigint) => (value * amount) / expected;
  return { ...item, out: share(item.out), route: { ...item.route, amount, minPaid: share(item.route.minPaid) } };
}

// Quotes routes on each output's swapper, six routes a call and three calls a request: a hop through Hydrex's Algebra
// pools takes about a million gas, and an RPC allows an eth_call up to 50 million.
const ROUTES_PER_CALL = 6;
const CALLS_PER_READ = 3;
export const QUOTES_PER_REQUEST = ROUTES_PER_CALL * CALLS_PER_READ;
export async function quoteAll(
  items: { swapper: Swapper; route: Route }[],
  rd: Read = read,
): Promise<(Result | undefined)[]> {
  const quote = (swapper: Swapper, at: number[]) =>
    call(
      swapper.address,
      swapperAbi,
      "quote",
      at.map((index) => items[index]!.route),
    );
  const calls: { call: ReturnType<typeof quote>; at: number[] }[] = [];
  for (const swapper of new Set(items.map(({ swapper }) => swapper))) {
    const indexes = items.flatMap((item, i) => (item.swapper === swapper ? [i] : []));
    for (let i = 0; i < indexes.length; i += ROUTES_PER_CALL) {
      const at = indexes.slice(i, i + ROUTES_PER_CALL);
      calls.push({ call: quote(swapper, at), at });
    }
  }
  const replies = await rd(
    calls.map(({ call }) => call),
    { perBatch: CALLS_PER_READ },
  );
  const results: (Result | undefined)[] = items.map(() => undefined);
  calls.forEach(({ at }, i) => at.forEach((index, j) => (results[index] = replies[i]?.[j])));
  return results;
}

// A token's best route to the output, net of gas valued in the output. Each hop takes its best pool for what the hop
// before paid; routes of several hops are then quoted whole, since their hops may affect one another's pools.
export type Routed = { route: Route; out: bigint; gas: bigint };
export async function findRoute(
  token: Address,
  amount: bigint,
  output: Swapper,
  hydrex: boolean,
  gasValue: (gas: bigint) => bigint = () => 0n,
  rd: Read = read,
): Promise<Routed | undefined> {
  type Partway = { path: Address[]; hops: Hop[]; amount: bigint };
  let open: Partway[] = candidatePaths(token, output.token, hydrex).map((path) => ({ path, hops: [], amount }));
  const complete: Partway[] = [];
  while (open.length) {
    const legs = open.map(({ path, hops }) => [path[hops.length]!, path[hops.length + 1]!] as const);
    const ways = await waysFor(legs, undefined, rd);
    const asked = new Map<string, { way: Way; index: number }[]>();
    const items: { swapper: Swapper; route: Route }[] = [];
    open.forEach((partial, i) => {
      const [a, b] = legs[i]!;
      const id = `${pairKey(a, b)} ${partial.amount}`;
      if (asked.has(id)) return;
      asked.set(
        id,
        (ways.get(pairKey(a, b)) ?? []).map((way) => ({
          way,
          index:
            items.push({
              swapper: swapperFor(b)!,
              route: { token: a, amount: partial.amount, minPaid: 0n, hops: [hopOf(way)] },
            }) - 1,
        })),
      );
    });
    const results = await quoteAll(items, rd);
    const next: Partway[] = [];
    open.forEach((partial, i) => {
      const [a, b] = legs[i]!;
      const quoted = asked
        .get(`${pairKey(a, b)} ${partial.amount}`)!
        .map(({ way, index }) => ({ way: hopOf(way), out: results[index]?.done ? results[index].amountOut : 0n }));
      const chosen = best(quoted);
      if (!chosen) return;
      const moved = { path: partial.path, hops: [...partial.hops, chosen.way], amount: chosen.out };
      (moved.hops.length === partial.path.length - 1 ? complete : next).push(moved);
    });
    open = next;
  }
  const longer = complete.filter(({ hops }) => hops.length > 1);
  const whole = longer.length
    ? await quoteAll(
        longer.map(({ hops }) => ({ swapper: output, route: { token, amount, minPaid: 0n, hops } })),
        rd,
      )
    : [];
  const options = complete.flatMap((partial) => {
    const route = { token, amount, minPaid: 0n, hops: partial.hops };
    const i = longer.indexOf(partial);
    const out = i < 0 ? partial.amount : whole[i]?.done ? whole[i].amountOut : 0n;
    const gas = routeGas(route);
    return out ? [{ route, out, gas, net: out - gasValue(gas) }] : [];
  });
  const chosen = top(options, ({ net }) => net);
  return chosen && { route: chosen.route, out: chosen.out, gas: chosen.gas };
}

// Plans the sale of what a claim brings into `swapper`: each token whole along its best route, approving exactly what
// the claim brings. Only tokens whose quote is worth at least twice their gas are sold; the rest go in `left`, by
// symbol.
export async function saleOf(
  amounts: Amount[],
  swapper: Swapper,
  tokens: Map<string, Token>,
  prices: Prices | undefined,
  gasPrice: bigint | undefined,
  margin: bigint,
): Promise<{ plan: Plan; left: string[] }> {
  const sold = amounts.filter(({ token }) => !same(token, swapper.token));
  const routes = await Promise.all(
    sold.map(({ token, amount }) => findRoute(token, amount, swapper, true).catch(() => undefined)),
  );
  const items: Item[] = [];
  const left: string[] = [];
  sold.forEach(({ token, amount }, i) => {
    const [route, known] = [routes[i], tokens.get(key(token))];
    const [outputPrice, price] = [prices?.of.get(key(swapper.token)), prices?.of.get(key(token))];
    const worth = !route
      ? undefined
      : outputPrice !== undefined
        ? worthOf(route.out, swapper.decimals, outputPrice)
        : price !== undefined && known
          ? worthOf(amount, known.decimals, price)
          : undefined;
    const cost =
      gasPrice !== undefined && route ? (ethCost((route.gas + APPROVAL_GAS) * gasPrice, prices)?.value ?? 0) : 0;
    if (!route || !known || worth === undefined || worth < 2 * cost) return void left.push(known?.symbol ?? token);
    items.push({
      token: known,
      route: { ...route.route, amount: maxUint256, minPaid: minimumOf(route.out, margin) },
      out: route.out,
      allowance: 0n,
      approve: amount,
    });
  });
  return { plan: { swapper, items, margin }, left };
}

const symbolOf = (tokens: Map<string, Token>, address: Address): string => tokens.get(key(address))?.symbol ?? address;
// For example "ZORA → WETH → USDC via Aerodrome, Uniswap". It names no pool addresses, since the wallet shows none.
const pathWords = (steps: string[], { hops }: Route): string =>
  `${steps.join(" → ")} via ${[...new Set(hops.map(venueOf))].join(", ")}`;
export const hopsWords = (route: Route, tokens: Map<string, Token>): string =>
  pathWords(
    [route.token, ...route.hops.map(({ tokenOut }) => tokenOut)].map((token) => symbolOf(tokens, token)),
    route,
  );
export function approveSlip(token: Token, swapper: Swapper, amount: bigint): Slip {
  const words = `${figure(amount, token.decimals)} ${token.symbol}`;
  return {
    to: token.address,
    data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [swapper.address, amount] }),
    title: amount ? "Token approval" : "Token approval reset",
    says: amount
      ? `Let the contract for ${swapper.symbol} swaps take ${words} from you`
      : `Reset ${token.symbol}'s approval of the contract for ${swapper.symbol} swaps`,
    on: `The ${token.symbol} token contract`,
    call: "approve",
    fields: [
      { label: "Spender", code: swapper.address, description: `The contract for ${swapper.symbol} swaps` },
      { label: "Amount", code: String(amount), description: amount ? words : "Nothing" },
    ],
  };
}
// Calls `swap` with `skipFailed`, so a route that fails, as one under its minimum does, is skipped and its token stays
// in the wallet.
export function swapSlip(
  swapper: Swapper,
  routes: Route[],
  deadline: bigint,
  tokens: Map<string, Token>,
  tip?: bigint,
  whole = false,
): Slip {
  const least = routes.reduce((sum, { minPaid }) => sum + minPaid, 0n);
  const sold = new Set(routes.map(({ token }) => key(token))).size;
  const amountOf = (route: Route) =>
    whole
      ? `All your ${symbolOf(tokens, route.token)} (up to what this approves)`
      : `${figure(route.amount, tokens.get(key(route.token))?.decimals ?? 0)} ${symbolOf(tokens, route.token)}`;
  return {
    to: swapper.address,
    data: encodeFunctionData({ abi: swapperAbi, functionName: "swap", args: [routes, deadline, true] }),
    tip,
    title: `Swap into ${swapper.symbol}`,
    says: `Sell ${sold === 1 ? "1 token" : `${sold} tokens`} for at least ${figure(least, swapper.decimals)} ${swapper.symbol}`,
    on: `The contract for ${swapper.symbol} swaps`,
    call: "swap",
    fields: [
      ...routes.map((route, i) => ({
        label: routes.length === 1 ? "Route" : `Route ${i + 1}`,
        words: pathWords(
          [
            amountOf(route),
            ...route.hops.slice(0, -1).map(({ tokenOut }) => symbolOf(tokens, tokenOut)),
            `${figure(route.minPaid, swapper.decimals)}+ ${swapper.symbol}`,
          ],
          route,
        ),
      })),
      { label: "Deadline", code: String(deadline), description: utc(Number(deadline)) },
      {
        label: "Skip failed",
        code: "true",
        description: "A route that fails, as one under its minimum does, is skipped.",
      },
    ],
  };
}

// A swap to review. Each item is a route, or one part of a token's route. A token whose allowance falls short of all
// its parts gets one exact approval for them; `approve` sets that amount, and forces the approval, when the allowance
// is not yet known, as after a claim.
export type Item = { token: Token; route: Route; out: bigint; allowance: bigint; approve?: bigint | undefined };
export type Plan = { swapper: Swapper; items: Item[]; margin: bigint };
type Steps = { approvals: Slip[]; swaps: Route[][]; slips: Slip[] };
export function planSteps(
  { swapper, items }: Plan,
  tokens: Map<string, Token>,
  deadline: bigint,
  tip?: bigint,
  whole = false,
): Steps {
  const sold = new Map<string, { item: Item; total: bigint }>();
  for (const item of items) {
    const each = sold.get(key(item.token.address));
    if (each) each.total += item.route.amount;
    else sold.set(key(item.token.address), { item, total: item.route.amount });
  }
  const approvals = [...sold.values()]
    .filter(({ item, total }) => item.approve !== undefined || item.allowance < total)
    .map(({ item, total }) => approveSlip(item.token, swapper, item.approve ?? total));
  const swaps = split(items.map(({ route }) => route));
  return {
    approvals,
    swaps,
    slips: [...approvals, ...swaps.map((group) => swapSlip(swapper, group, deadline, tokens, tip, whole))],
  };
}

// Runs `before`, then the plan's approvals and swaps, in order through Base, with every minimum at zero, so each route
// fetches what the pools pay once the routes before it have moved them. Undefined if Base cannot say; otherwise the
// index of the call it refused, if any, or what each item fetched, and the total gas.
export type Simulated = { refused?: number; results: (Result | undefined)[]; gas: bigint; steps: Steps };
export async function simulatePlan(
  from: Address,
  before: Tx[],
  plan: Plan,
  tokens: Map<string, Token>,
  deadline: bigint,
  whole = false,
): Promise<Simulated | undefined> {
  const steps = planSteps(
    { ...plan, items: plan.items.map((item) => ({ ...item, route: { ...item.route, minPaid: 0n } })) },
    tokens,
    deadline,
    undefined,
    whole,
  );
  const run = await simulate(from, [...before, ...steps.slips]).catch(() => undefined);
  if (!run || run.length !== before.length + steps.slips.length) return undefined;
  const gas = run.reduce((sum, { gas }) => sum + gas, 0n);
  const refused = run.findIndex(({ ok }) => !ok);
  if (refused >= 0) return { refused, results: [], gas, steps };
  const first = before.length + steps.approvals.length;
  const results = steps.swaps.flatMap((group, g) => {
    try {
      return [
        ...decodeFunctionResult({ abi: swapperAbi, functionName: "swap", data: run[first + g]!.returnData })[0],
      ].slice(0, group.length);
    } catch {
      return group.map(() => undefined);
    }
  });
  return { results, gas, steps };
}
// Each item with its quote and minimum taken from Base's results, or left as quoted without them, and the reason when
// it would fetch nothing.
export function withMinimums(
  plan: Plan,
  results?: (Result | undefined)[],
): { item: Item; reason?: string | undefined }[] {
  return plan.items.map((item, i) => {
    const result = results?.[i];
    if (!result) return { item };
    const out = result.done ? result.amountOut : 0n;
    const reason = out ? undefined : result.done ? "a pool gave nothing for it" : reasonOf(result.reason);
    return { item: { ...item, out, route: { ...item.route, minPaid: minimumOf(out, plan.margin) } }, reason };
  });
}

export function reasonOf(reason: Hex): string {
  try {
    const name = decodeErrorResult({ abi: swapperAbi, data: reason }).errorName;
    const words: Record<string, string> = {
      TooLittle: "it would have fetched less than its minimum",
      NoOutput: "a pool gave nothing for it",
      TokenCallFailed: "its token refused the transfer",
      PartialFill: "a pool could not take all of it",
      Expired: "the swap's deadline had passed",
    };
    return words[name] ?? "a pool refused it";
  } catch {
    return "a pool or its token refused it";
  }
}

// What a swap did for `caller`, from its receipts' logs. Only `caller`'s events count, since a batch's receipts may
// hold others' swaps.
type Swapped = {
  swapped: { index: number; token: Address; amountIn: bigint; amountOut: bigint }[];
  failed: { index: number; token: Address; reason: Hex }[];
  paid: bigint;
  fee: bigint;
};
export function swappedIn(receipts: Pick<Landed, "logs">[], swapper: Swapper, caller: Address): Swapped {
  const outcome: Swapped = { swapped: [], failed: [], paid: 0n, fee: 0n };
  const logs = logsIn(receipts).filter((log) => same(log.address, swapper.address));
  for (const { eventName, args } of parseEventLogs({ abi: swapperAbi, logs, args: { caller } })) {
    if (eventName === "RouteSwapped") outcome.swapped.push({ ...args, index: Number(args.index) });
    if (eventName === "RouteFailed") outcome.failed.push({ ...args, index: Number(args.index) });
    if (eventName === "Swapped") [outcome.paid, outcome.fee] = [outcome.paid + args.paid, outcome.fee + args.fee];
  }
  return outcome;
}
