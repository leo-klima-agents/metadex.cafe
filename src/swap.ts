import {
  decodeErrorResult,
  decodeEventLog,
  decodeFunctionResult,
  encodeFunctionData,
  parseAbi,
  type Address,
  type Hex,
} from "viem";
import { call, codeHash, read, rpc, same, type Call, type Receipt } from "./chain.ts";
import {
  CHAIN_ID,
  EXCHANGES,
  HYDX,
  SWAPPERS,
  SWAP_FEE_BPS,
  SWAP_TREASURY,
  WETH,
  type Output,
  type Swapper,
} from "./config.ts";
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
  "function exchanges() view returns (address[] list)",
  "function outputToken() view returns (address)",
  "function TREASURY() view returns (address)",
  "function FEE_BPS() view returns (uint256)",
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
const USDC: Address = SWAPPERS[0]!.token;
const CBBTC: Address = SWAPPERS.find(({ output }) => output === "cbbtc")!.token;
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
// Uniswap v4's pools live in its PoolManager, and have no address of their own.
export const poolless = ({ exchange }: Hop): boolean => exchangeOf(exchange).kind === "v4";
export const MAX_TIP = 1_000_000_000n;

// A hop's pool in words: "Uniswap v3 0.05%", "Aero Slipstream, tick spacing 100".
export function poolName({ exchange, fee, tickSpacing }: Hop): string {
  const { name, kind } = exchangeOf(exchange);
  if (kind === "v3" || kind === "v4") return `${name} ${fee / 10_000}%`;
  if (kind === "slipstream") return `${name}, tick spacing ${tickSpacing}`;
  return name;
}

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

const quoteCall = (swapper: Swapper, routes: Route[]): Call =>
  call(swapper.address, swapperAbi as never, "quote", routes);

// Quotes routes on each output's swapper: several routes a call, and a few calls a read, as a hop through Hydrex's
// Algebra pools needs about a million gas, and an RPC gives an eth_call up to 50 million. A route that fails quotes
// nothing; a read that fails throws, so that a token whose routes could not be read is not taken for one without any.
const ROUTES_PER_QUOTE = 6;
const QUOTES_PER_READ = 3;

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

const swapperFor = (token: Address): Swapper | undefined => SWAPPERS.find((swapper) => same(swapper.token, token));

// A token's best route to the output, net of the gas each costs in the output, `gasValue` of gas. Each hop takes the
// best of its pools for what the hop before paid; then each whole route is quoted, as its hops' pools may meet.
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
  const routes = complete.map(({ hops }) => ({ token, amount, minPaid: 0n, hops }));
  const whole = await quoteAll(routes.map((route) => ({ swapper: output, route })));
  const options = routes.flatMap((route, i) => {
    const result = whole[i];
    if (!result?.done || result.amountOut === 0n) return [];
    const gas = routeGas(route);
    return [{ route, out: result.amountOut, gas, net: result.amountOut - gasValue(gas) }];
  });
  const chosen = options.reduce<(typeof options)[number] | undefined>(
    (found, each) => (!found || each.net > found.net ? each : found),
    undefined,
  );
  return chosen && { route: chosen.route, out: chosen.out, gas: chosen.gas };
}

const hopOf = ({ exchange, pool, tokenOut, fee, tickSpacing }: Hop): Hop => ({
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

// Each swapper's checks, as AutoMaxi's: its code, its output, where its fee goes, the fee, and the twelve factories, in
// the page's order.
// A failed check turns that output off. Each is named by the id of its line on the page.
export async function swapChecks(): Promise<Map<Output, string[]>> {
  const reads = SWAPPERS.flatMap(({ address }) =>
    ["outputToken", "TREASURY", "FEE_BPS", "exchanges"].map((name) => call(address, swapperAbi as never, name)),
  );
  const [chainId, hashes, replies] = await Promise.all([
    rpc<string>("eth_chainId", []),
    Promise.all(SWAPPERS.map(({ address }) => codeHash(address))),
    read(reads),
  ]);
  return new Map(
    SWAPPERS.map((swapper, i) => {
      const [output, treasury, fee, factories] = replies.slice(4 * i, 4 * i + 4) as [
        Address | undefined,
        Address | undefined,
        bigint | undefined,
        readonly Address[] | undefined,
      ];
      const checks: Record<string, boolean> = {
        chain: Number(chainId) !== CHAIN_ID,
        "swap-code": hashes[i] !== swapper.codeHash,
        "swap-output": !same(String(output), swapper.token),
        "swap-treasury": !same(String(treasury), SWAP_TREASURY),
        "swap-fee": fee !== SWAP_FEE_BPS,
        "swap-exchanges":
          factories?.length !== EXCHANGES.length || EXCHANGES.some(({ id, factory }) => !same(factories[id]!, factory)),
      };
      return [swapper.output, Object.entries(checks).flatMap(([id, fails]) => (fails ? [id] : []))];
    }),
  );
}
