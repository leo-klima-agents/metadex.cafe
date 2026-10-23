import type { Address } from "viem";
import { read, rpc } from "./chain.ts";
import { ANCHORS, WETH, type Swapper } from "./config.ts";
import { figure, utc } from "./format.ts";
import { feedAt, type Token } from "./prices.ts";
import type { Field, Slip } from "./review.ts";
import { MAX_TIP, approve, hopName, poolName, poolless, swapCall, type Route } from "./swap.ts";

// The calls of a swap, as the review shows them, and what gas costs.

// `tip` is unknown when the RPC suggests none: the wallet then picks its own.
export type Costs = { gasPrice: bigint; tip: bigint | undefined; ethUsd: number | undefined };
let costsRead: { at: number; costs: Promise<Costs> } | undefined;

// The gas price, the tip the page asks for, and ETH's price, read at most once a minute.
export function costs(): Promise<Costs> {
  if (costsRead && Date.now() - costsRead.at < 60_000) return costsRead.costs;
  const { feed } = ANCHORS.find(({ address }) => address === WETH)!;
  const found = Promise.all([
    rpc<string>("eth_gasPrice", []),
    rpc<string>("eth_maxPriorityFeePerGas", []).catch(() => undefined),
    feedAt(feed, Infinity, read).catch(() => undefined),
  ]).then(([gasPrice, tip, ethUsd]) => {
    const suggested = tip === undefined ? undefined : BigInt(tip);
    const capped = suggested === undefined ? undefined : suggested < MAX_TIP ? suggested : MAX_TIP;
    return { gasPrice: BigInt(gasPrice), tip: capped, ethUsd };
  });
  costsRead = { at: Date.now(), costs: found };
  found.catch(() => (costsRead = undefined));
  return found;
}

export const gasUsd = (gas: bigint, { gasPrice, ethUsd }: Costs): number | undefined =>
  ethUsd === undefined ? undefined : (Number(gas * gasPrice) / 1e18) * ethUsd;

const symbolOf = (tokens: Map<string, Token>, address: Address): string =>
  tokens.get(address.toLowerCase())?.symbol ?? address;

// A route's hops in words, around the addresses of their pools: "Hydrex Integral 0x… to WETH, Uniswap v3 0.05%
// 0x… to USDC". Uniswap v4's pools have no address of their own.
export function pathWords(route: Route, tokens: Map<string, Token>): NonNullable<Field["words"]> {
  return route.hops.flatMap((hop, i) => [
    `${i ? ", " : ""}${poolName(hop)} `,
    ...(poolless(hop) ? ["pool"] : [{ code: hop.pool }]),
    ` to ${symbolOf(tokens, hop.tokenOut)}`,
  ]);
}

// A route's hops by their tokens and pools, without addresses, as a bill shows them: "→ WETH via Hydrex Integral → USDC
// via Uniswap v3 0.05%".
export const hopsWords = (route: Route, tokens: Map<string, Token>): string =>
  route.hops.map((hop) => `→ ${symbolOf(tokens, hop.tokenOut)} via ${hopName(hop)}`).join(" ");

// A route in words: "41.2 AVNT, Hydrex Integral 0x… to WETH, Uniswap v3 0.05% 0x… to USDC, at least 0.60 USDC". A
// swap of a whole balance, as after a claim, says so instead of an amount.
export function routeWords(
  route: Route,
  tokens: Map<string, Token>,
  output: Swapper,
  amountWords?: string,
): NonNullable<Field["words"]> {
  const token = tokens.get(route.token.toLowerCase());
  const amount = amountWords ?? (token ? `${figure(route.amount, token.decimals)} ${token.symbol}` : `${route.amount}`);
  return [
    `${amount}, `,
    ...pathWords(route, tokens),
    `, at least ${figure(route.minPaid, output.decimals)} ${output.symbol}`,
  ];
}

export function approveSlip(token: Token, swapper: Swapper, amount: bigint): Slip {
  const words = `${figure(amount, token.decimals)} ${token.symbol}`;
  return {
    ...approve(token.address, swapper.address, amount),
    says: amount
      ? `Lets the ${swapper.symbol} swapper take ${words} from you.`
      : `Resets ${token.symbol}'s approval of the ${swapper.symbol} swapper to nothing.`,
    on: `The ${token.symbol} token`,
    call: "approve",
    fields: [
      { label: "Spender", name: "spender", code: swapper.address, under: `The ${swapper.symbol} swapper` },
      { label: "Amount", name: "amount", code: String(amount), under: amount ? words : "Nothing" },
    ],
    note: `The selector, then each 32-byte word on two lines: the swapper, and ${amount} as ${amount.toString(16)}.`,
  };
}

// The swap, with a deadline, and skip-failed: a route under its minimum is skipped, and its token stays in the wallet.
// It asks for a tip of at most 1 gwei, where the wallet lets the page set it.
export function swapSlip(
  swapper: Swapper,
  routes: Route[],
  deadline: bigint,
  tokens: Map<string, Token>,
  tip: bigint | undefined,
  whole = false,
): Slip {
  const least = routes.reduce((sum, { minPaid }) => sum + minPaid, 0n);
  const n = routes.length;
  return {
    ...swapCall(swapper, routes, deadline),
    ...(tip !== undefined && { tip }),
    says: `Sells ${n === 1 ? "1 token" : `${n} tokens`} for at least ${figure(least, swapper.decimals)} ${swapper.symbol}, less any token skipped.`,
    on: `The ${swapper.symbol} swapper`,
    call: "swap",
    fields: [
      ...routes.map((route, i) => ({
        label: n === 1 ? "Route" : `Route ${i + 1}`,
        name: "route",
        words: routeWords(
          route,
          tokens,
          swapper,
          whole ? `All your ${symbolOf(tokens, route.token)}, up to what this approves` : undefined,
        ),
      })),
      { label: "Deadline", name: "deadline", code: String(deadline), under: utc(Number(deadline)) },
      {
        label: "Skip failed",
        name: "skip",
        code: "true",
        under: "A route under its minimum is skipped, and its token stays in your wallet.",
      },
    ],
    note: "The selector, then each 32-byte word on two lines: where the routes start, the deadline, true as 1, then each route.",
  };
}
