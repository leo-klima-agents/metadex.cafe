import type { Address } from "viem";
import { rpc } from "./chain.ts";
import { WETH, type Swapper } from "./config.ts";
import { figure, money, moneyAt, utc, type Money } from "./format.ts";
import type { Prices, Token } from "./prices.ts";
import type { Slip } from "./views/review.ts";
import { MAX_TIP, approve, swapCall, venueOf, type Route } from "./swap.ts";

// The calls of a swap, as the review shows them, and what gas costs.

// `tip` is unknown when the RPC suggests none: the wallet then picks its own.
export type Costs = { gasPrice: bigint; tip: bigint | undefined };
let costsRead: { at: number; costs: Promise<Costs> } | undefined;

// The gas price and the tip the page asks for, read at most once a minute.
export function costs(): Promise<Costs> {
  if (costsRead && Date.now() - costsRead.at < 60_000) return costsRead.costs;
  const found = Promise.all([
    rpc<string>("eth_gasPrice", []),
    rpc<string>("eth_maxPriorityFeePerGas", []).catch(() => undefined),
  ]).then(([gasPrice, tip]) => {
    const suggested = tip === undefined ? undefined : BigInt(tip);
    const capped = suggested === undefined ? undefined : suggested < MAX_TIP ? suggested : MAX_TIP;
    return { gasPrice: BigInt(gasPrice), tip: capped };
  });
  costsRead = { at: Date.now(), costs: found };
  found.catch(() => (costsRead = undefined));
  return found;
}

// What wei of ETH cost at the prices given, ETH's among them, so that it compares with what they value: undefined
// without one.
export function ethCost(wei: bigint, prices: Prices | undefined): Money | undefined {
  const eth = prices?.of.get(WETH.toLowerCase());
  return eth === undefined ? undefined : moneyAt((Number(wei) / 1e18) * eth, prices!);
}

export const gasCost = (gas: bigint, { gasPrice }: Costs, prices: Prices | undefined): Money | undefined =>
  ethCost(gas * gasPrice, prices);

// What gas costs, in words: at the prices given, to the cent, as the swap's bill shows it, or else in the ETH that pays
// it.
export function gasWords(wei: bigint, prices: Prices | undefined): string {
  const cost = ethCost(wei, prices);
  return cost ? money(cost, { cents: true }) : `${figure(wei, 18)} ETH`;
}

const symbolOf = (tokens: Map<string, Token>, address: Address): string =>
  tokens.get(address.toLowerCase())?.symbol ?? address;

// A route as the page shows it: its tokens, then who runs its pools, each once, without addresses or fee tiers:
// "ZORA → WETH → USDC via Aerodrome, Uniswap". The wallet shows none of the pools' addresses, so neither does the page.
export function hopsWords(route: Route, tokens: Map<string, Token>): string {
  const path = [route.token, ...route.hops.map(({ tokenOut }) => tokenOut)].map((token) => symbolOf(tokens, token));
  return `${path.join(" → ")} via ${[...new Set(route.hops.map(venueOf))].join(", ")}`;
}

// A route in words, from what it sells, through the tokens between, to the least it fetches, then who runs its pools:
// "41.2 AVNT → WETH → 0.60+ USDC via Hydrex, Uniswap". A line breaks only after an arrow, or before "via": an amount,
// the least, and "via" with who runs the pools keep together. A swap of a whole balance, as after a claim, says so
// instead of an amount.
export function routeWords(route: Route, tokens: Map<string, Token>, output: Swapper, amountWords?: string): string {
  const whole = (words: string) => words.replaceAll(" ", "\u00a0");
  const token = tokens.get(route.token.toLowerCase());
  const amount =
    amountWords ?? whole(token ? `${figure(route.amount, token.decimals)} ${token.symbol}` : `${route.amount}`);
  const between = route.hops.slice(0, -1).map(({ tokenOut }) => symbolOf(tokens, tokenOut));
  const least = whole(`${figure(route.minPaid, output.decimals)}+ ${output.symbol}`);
  const pools = [...new Set(route.hops.map(venueOf))].join(",\u00a0");
  return `${[amount, ...between, least].join("\u00a0→ ")} via\u00a0${pools}`;
}

export function approveSlip(token: Token, swapper: Swapper, amount: bigint): Slip {
  const words = `${figure(amount, token.decimals)} ${token.symbol}`;
  return {
    ...approve(token.address, swapper.address, amount),
    title: amount ? "Token approval" : "Token approval reset",
    says: amount
      ? `Let the ${swapper.symbol} swapper take ${words} from you`
      : `Reset ${token.symbol}'s approval of the ${swapper.symbol} swapper`,
    on: `The ${token.symbol} token contract`,
    call: "approve",
    fields: [
      { label: "Spender", name: "spender", code: swapper.address, description: `The ${swapper.symbol} swapper` },
      { label: "Amount", name: "amount", code: String(amount), description: amount ? words : "Nothing" },
    ],
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
  // A token in parts is sold once: each part is a route.
  const sold = new Set(routes.map(({ token }) => token.toLowerCase())).size;
  const n = routes.length;
  return {
    ...swapCall(swapper, routes, deadline),
    ...(tip !== undefined && { tip }),
    title: `Swap into ${swapper.symbol}`,
    says: `Sell ${sold === 1 ? "1 token" : `${sold} tokens`} for at least ${figure(least, swapper.decimals)} ${swapper.symbol}`,
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
          whole ? `All your ${symbolOf(tokens, route.token)} (up to what this approves)` : undefined,
        ),
      })),
      { label: "Deadline", name: "deadline", code: String(deadline), description: utc(Number(deadline)) },
      {
        label: "Skip failed",
        name: "skip",
        code: "true",
        description: "A route under its minimum is skipped.",
      },
    ],
  };
}
