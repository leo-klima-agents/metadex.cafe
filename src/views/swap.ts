import { isAddress, maxUint256, type Address } from "viem";
import { andThen, use, type Got } from "../cache.ts";
import { swapsOff } from "../checks.ts";
import { AUTOMATIONS, DEFAULT_OUTPUT, SWAPPERS, swapperOf, type Swapper } from "../config.ts";
import * as data from "../data.ts";
import { count, fixed, figure, fraction, money, moneyAt, utc } from "../format.ts";
import { ethCost, gasWords, key, noPrices, pricesNow, worthOf, type Prices, type Token } from "../prices.ts";
import { hrefOf, parse } from "../routes.ts";
import { routeTogether, type Sale } from "../routing.ts";
import { costs, gasPaid, includedAt, now, same, tagged, type Costs, type Landed } from "../rpc.ts";
import { actions, render, state } from "../state.ts";
import * as swap from "../swap.ts";
import type { Routed, Item, Plan, Route } from "../swap.ts";
import {
  allowancesOf,
  describe,
  holdingsOf,
  isHydrex,
  know,
  known,
  lookalike,
  tokensOf,
  type Allowance,
  type Amount,
} from "../tokens.ts";
import {
  $,
  bill,
  busy,
  code,
  enable,
  fill,
  frag,
  fromTemplate,
  link,
  list,
  shown,
  stateOf,
  type Value,
} from "../ui.ts";
import { walletAssets } from "../wallet.ts";
import { openReview } from "./review.ts";

const view = $('[data-view="swap"]');
const rd = tagged("swap");
const ticks = new Map<string, boolean>();
let margin = 50n;
let prefilled: Map<string, bigint> | undefined;
let added = "";
let ticked = { key: "", at: 0 };
let failedReview = "";

const swapperShown = (): Swapper => swapperOf(state.route.view === "swap" ? state.route.output : "usdc")!;
export function swapLink(amounts: Amount[], className = ""): HTMLAnchorElement {
  const a = Object.assign(link(hrefOf({ view: "swap", output: DEFAULT_OUTPUT }), "Swap these"), { className });
  a.addEventListener("click", () => prefill(amounts));
  return a;
}
function prefill(amounts: Amount[]): void {
  prefilled = new Map(amounts.map(({ token, amount }) => [key(token), amount]));
  know(amounts.map(({ token }) => token));
  ticks.clear();
}
addEventListener("hashchange", () => {
  if (!prefilled || parse(location.hash).view === "swap") return;
  prefilled = undefined;
  ticks.clear();
});

type Scan = { rows: Row[]; tokens: Map<string, Token>; prices: Prices; costs?: Costs | undefined; reading: boolean };
type Row = {
  token: Token;
  amount: bigint;
  allowance: bigint;
  route?: Routed | undefined;
  reading: boolean;
  reason?: string | undefined;
  worth?: number | undefined;
  ticked: boolean;
};
type Ticked = Row & { route: Routed };
const isTicked = (row: Row): row is Ticked => row.ticked && !!row.route;
function scan(): Got<Scan> {
  const connection = state.connection;
  if (!connection) return {};
  const swapper = swapperShown();
  for (const automation of AUTOMATIONS)
    know(data.earnings(automation).value?.rewards.map(({ token }) => token.address) ?? [], true);
  const assets = use(`assets ${connection.address}`, () => walletAssets(connection)).value;
  if (assets) know(assets);
  const all = known();
  const held = use(`held ${connection.address} ${swapper.output} ${all.length}`, () =>
    holdingsOf(connection.address, all, swapper.address, rd),
  );
  return andThen(held, (balances) => {
    const owned = all.filter((token) => (balances.get(key(token))?.balance ?? 0n) > 0n && !same(token, swapper.token));
    const names = [...owned, swapper.token, ...swap.MIDDLES];
    return andThen(
      use(`tokens ${names.join()}`, () => describe(names)),
      (tokens) => {
        const amounts = new Map(owned.map((token) => [key(token), balances.get(key(token))!.balance]));
        const prices = use(
          `prices ${connection.address} ${swapper.output} ${owned.join()}`,
          () => pricesNow([...tokens.values()], amounts, rd),
          60_000,
        );
        const gas = costs();
        if (prices.value === undefined && !prices.failed) return {};
        const pricing = prices.value ?? noPrices();
        const value = (amount: bigint) => {
          const price = pricing.of.get(key(swapper.token));
          return price === undefined ? undefined : worthOf(amount, swapper.decimals, price);
        };
        const gasValue = (units: bigint) => {
          const cost = gas.value && ethCost(units * gas.value.gasPrice, pricing);
          const price = pricing.of.get(key(swapper.token));
          return cost && price ? BigInt(Math.floor((cost.value / price) * 10 ** swapper.decimals)) : 0n;
        };
        const rows = owned.flatMap((address): Row[] => {
          const token = tokens.get(key(address));
          if (!token) return [];
          const { balance, allowance } = balances.get(key(address))!;
          const amount = prefilled?.get(key(address)) ?? balance;
          const capped = amount < balance ? amount : balance;
          const found = use(
            `route ${address} ${capped} ${swapper.output}`,
            async () => (await swap.findRoute(address, capped, swapper, isHydrex(address), gasValue, rd)) ?? null,
            5 * 60_000,
          );
          const route = found.value ?? undefined;
          const reading = found.value === undefined && !found.failed;
          const row: Row = { token, amount: capped, allowance, route, reading, ticked: false };
          if (found.failed) row.reason = "Not read";
          else if (reading) return [row];
          else if (!route) row.reason = "No route";
          else {
            const price = pricing.of.get(key(address));
            row.worth = value(route.out) ?? (price === undefined ? undefined : worthOf(capped, token.decimals, price));
            const units = route.gas + (allowance < capped ? swap.APPROVAL_GAS : 0n);
            const cost = gas.value ? (ethCost(units * gas.value.gasPrice, pricing)?.value ?? 0) : 0;
            row.reason = row.worth === undefined ? "No price" : row.worth < 2 * cost ? "Below gas" : undefined;
          }
          const auto = !!route && !row.reason && (!prefilled || prefilled.has(key(address)));
          row.ticked = !!route && (ticks.get(key(address)) ?? auto);
          return [row];
        });
        rows.sort((a, b) => (b.worth ?? -1) - (a.worth ?? -1));
        return {
          value: {
            rows,
            tokens,
            prices: pricing,
            costs: gas.value,
            reading: rows.some(({ reading }) => reading),
          },
        };
      },
    );
  });
}

// The ticked tokens' routes: each token's own, or the routes found for them together, whichever fetches more when Base
// runs them in order after their approvals. Without an answer from Base, each token keeps its own quote.
type Together = {
  parts: Map<string, { route: Route; out?: bigint | undefined }[]>;
  gas?: bigint | undefined;
  swaps: number;
};
function together(found: Scan): Got<Together> {
  const connection = state.connection!;
  const swapper = swapperShown();
  const rows = found.rows.filter(isTicked);
  const id = `${swapper.output} ${rows.map(({ token, amount }) => `${token.address}:${amount}`).join()}`;
  // Route only once the ticks have stopped changing for 400 ms.
  if (id !== ticked.key) {
    ticked = { key: id, at: performance.now() };
    setTimeout(render, 400);
  }
  if (performance.now() - ticked.at < 400) return {};
  return use(
    `together ${connection.address} ${id}`,
    async () => {
      const plan = (routes: Route[][]): Plan => ({
        swapper,
        margin,
        items: rows.flatMap((row, i) =>
          routes[i]!.map((route) => ({ token: row.token, route, out: 0n, allowance: row.allowance })),
        ),
      });
      const own = rows.map((row) => [{ ...row.route.route, amount: row.amount }]);
      const sales: Sale[] = rows.map((row) => ({
        token: row.token.address,
        amount: row.amount,
        found: row.route,
        hydrex: isHydrex(row.token.address),
      }));
      const deadline = BigInt(now() + 1800);
      const run = (routes: Route[][]) =>
        swap.simulatePlan(connection.address, [], plan(routes), found.tokens, deadline);
      const [ownRun, parted] = await Promise.all([
        run(own),
        routeTogether(sales, swapper, () => 0n).catch(() => undefined),
      ]);
      const partedRun = parted && (await run(parted));
      const net = (simulated: swap.Simulated | undefined) =>
        simulated && simulated.refused === undefined
          ? simulated.results.reduce((sum, r) => sum + (r?.done ? r.amountOut : 0n), 0n)
          : undefined;
      const better = net(partedRun) !== undefined && (net(ownRun) === undefined || net(partedRun)! > net(ownRun)!);
      const [routes, simulated] = better ? [parted!, partedRun] : [own, ownRun];
      let next = 0;
      const results = simulated?.refused === undefined ? simulated?.results : undefined;
      const outOf = (row: Ticked) => {
        const result = results?.[next++];
        return results ? (result?.done ? result.amountOut : undefined) : row.route.out;
      };
      const parts = new Map(
        rows.map((row, i) => [key(row.token.address), routes[i]!.map((route) => ({ route, out: outOf(row) }))]),
      );
      return { parts, gas: results && simulated!.gas, swaps: swap.split(routes.flat()).length };
    },
    60_000,
  );
}

// Formats an amount of the output token to as many places as a cent of it needs, with its worth.
function output(amount: bigint, swapper: Swapper, prices: Prices | undefined): { exact: string; worthText: string } {
  const price = prices?.of.get(key(swapper.token));
  const places = Math.min(
    swapper.decimals,
    Math.max(2, price ? Math.ceil(Math.log10(price) + 2 - 0.05) : swapper.places),
  );
  const worth = prices && price !== undefined ? moneyAt(worthOf(amount, swapper.decimals, price), prices) : undefined;
  return {
    exact: `${fixed(amount, swapper.decimals, places)} ${swapper.symbol}`,
    worthText: worth ? money(worth, true) : "",
  };
}
function worthUnder(text: string, worth: string): Node {
  const under = Object.assign(document.createElement("small"), { className: "u-worth", textContent: worth });
  return worth ? frag(text, under) : frag(text);
}
// Gas is paid apart, in ETH, so it shows in ETH first.
function gasUnder(wei: bigint, prices: Prices | undefined): Node {
  const cost = ethCost(wei, prices);
  return worthUnder(`${figure(wei, 18)} ETH`, cost ? money(cost, true) : "");
}
function underPrice(
  token: Token,
  amount: bigint,
  out: bigint,
  swapper: Swapper,
  prices: Prices | undefined,
): number | undefined {
  const [price, outputPrice] = [prices?.of.get(key(token.address)), prices?.of.get(key(swapper.token))];
  if (price === undefined || outputPrice === undefined || amount === maxUint256) return undefined;
  const [sold, fetched] = [worthOf(amount, token.decimals, price), worthOf(out, swapper.decimals, outputPrice)];
  return sold > 0 && fetched < sold * 0.98 ? 1 - fetched / sold : undefined;
}

export function drawSwap(): void {
  const swapper = swapperShown();
  const off = swapsOff();
  list(
    $("[data-list=output]", view),
    SWAPPERS,
    ({ output }) => output,
    (label, each) => {
      const radio = label.querySelector("input")!;
      radio.value = each.output;
      radio.checked = each === swapper;
      radio.disabled = !!off;
      fill(label, { symbol: each.symbol, off: off ? " (off)" : null });
    },
  );
  list(
    $("[data-list=contract]", view),
    SWAPPERS,
    ({ output }) => output,
    (row, each) => fill(row, { name: `${each.symbol} swaps`, address: { address: each.address } }),
  );
  drawAllowances($("[data-list=allowance]", view));
  const found = scan();
  const rows = found.value?.rows ?? [];
  const prices = found.value?.prices;
  const picked = rows.filter(isTicked);
  const routed = found.value && picked.length ? together(found.value) : {};
  const partsOf = (row: Ticked) =>
    routed.value?.parts.get(key(row.token.address)) ?? [{ route: row.route.route, out: row.route.out }];
  fill(view, {
    off: off ? "Swaps are off." : null,
    tokens: stateOf(found, !rows.length && !found.value?.reading),
    ticked: rows.length ? `${picked.length} of ${rows.length}` : "",
    "add-error": added || null,
  });
  list(
    $("[data-list=token]", view),
    rows,
    ({ token }) => token.address,
    (li, row) => {
      const box = li.querySelector("input")!;
      box.checked = row.ticked;
      box.disabled = !row.route;
      box.setAttribute("aria-label", `Sell ${row.token.symbol}`);
      const out = isTicked(row)
        ? partsOf(row).reduce((sum, { out }) => (out === undefined ? sum : sum + out), 0n)
        : row.route?.out;
      const skipped = isTicked(row) && !!routed.value && partsOf(row).every(({ out }) => out === undefined);
      const quote = out === undefined || skipped ? undefined : output(out, swapper, prices);
      const like = lookalike(row.token);
      const under =
        quote && out !== undefined && !row.reason ? underPrice(row.token, row.amount, out, swapper, prices) : undefined;
      fill(li, {
        symbol: row.token.symbol,
        amount: figure(row.amount, row.token.decimals),
        fetches: row.reading ? undefined : (quote?.exact ?? ""),
        worth: quote?.worthText ?? "",
        note: row.reason ?? (skipped ? "Base would skip it" : null),
        warning: like
          ? `Not the usual ${like.symbol}`
          : under !== undefined
            ? `Quote ${fraction(under)} under price`
            : null,
      });
    },
  );
  const parts = picked.flatMap(partsOf);
  const going = parts.flatMap(({ out }) => (out === undefined ? [] : [out]));
  const out = going.reduce((sum, each) => sum + each, 0n);
  const least = going.reduce((sum, each) => sum + swap.minimumOf(each, margin), 0n);
  const fee = going.reduce((sum, each) => sum + swap.feeOf(each), 0n);
  const gas =
    routed.value?.gas ??
    BigInt(picked.filter((row) => row.allowance < row.amount).length) * swap.APPROVAL_GAS +
      swap.swapGas(parts.map(({ route }) => route));
  const line = (amount: bigint) => {
    const shown = output(amount, swapper, prices);
    return worthUnder(shown.exact, shown.worthText);
  };
  const waiting = !picked.length && found.value?.reading;
  const button = $<HTMLButtonElement>("[data-action=review-swap]", view);
  enable(button, !!picked.length && off === false);
  fill(view, {
    pick: picked.length || waiting ? null : "Pick tokens to sell",
    summary: !!picked.length || !!waiting || null,
    quote: picked.length ? line(out) : undefined,
    fee: picked.length ? line(-fee) : undefined,
    paid: picked.length ? line(out - fee) : undefined,
    least: picked.length ? line(least) : undefined,
    gas:
      picked.length && found.value?.costs
        ? gasUnder(gas * found.value.costs.gasPrice, prices)
        : picked.length
          ? ""
          : undefined,
    routing:
      off === undefined && picked.length
        ? "Checking Base…"
        : picked.length && !routed.value && !routed.failed
          ? "Routing them together…"
          : (routed.value?.swaps ?? 1) > 1
            ? `${routed.value!.swaps} swaps`
            : "",
    "review-failed": failedReview || null,
  });
}

actions.output = (el) => {
  const swapper = swapperOf((el as HTMLInputElement).value);
  if (swapper) location.hash = hrefOf({ view: "swap", output: swapper.output });
  ticks.clear();
};
actions.tick = (el) => {
  ticks.set(key(el.closest<HTMLElement>("[data-key]")!.dataset.key!), (el as HTMLInputElement).checked);
  render();
};
actions.margin = (el) => {
  margin = BigInt((el as HTMLSelectElement).value);
  render();
};
actions.add = async (el) => {
  const input = (el as HTMLFormElement).elements.namedItem("address") as HTMLInputElement;
  const address = input.value.trim();
  if (!isAddress(address, { strict: false })) added = "That's not a token's address.";
  else {
    const found = await tokensOf([address]).catch(() => new Map());
    added = found.size ? "" : "No token at that address.";
    if (!added) {
      know([address]);
      input.value = "";
    }
  }
  input.setAttribute("aria-invalid", String(!!added));
  render();
};

// Base runs the plan with no minimums, then each route's minimum is set under what it fetched. A route that fails even
// without a minimum is left out.
actions["review-swap"] = async (el) => {
  const connection = state.connection;
  const found = scan().value;
  if (!connection || !found) return;
  failedReview = "";
  busy(el as HTMLButtonElement);
  const swapper = swapperShown();
  const routed = together(found).value;
  const items: Item[] = found.rows.filter(isTicked).flatMap((row) =>
    (routed?.parts.get(key(row.token.address)) ?? [{ route: row.route.route, out: row.route.out }]).map(
      ({ route, out }) => {
        // A part without its own quote takes its share of the token's.
        const quote = out ?? (row.route.out * route.amount) / row.amount;
        return {
          token: row.token,
          route: { ...route, minPaid: swap.minimumOf(quote, margin) },
          out: quote,
          allowance: row.allowance,
        };
      },
    ),
  );
  try {
    failedReview = (await reviewSwap({ swapper, items, margin }, found.tokens, found.prices, found.costs)) ?? "";
  } catch (error) {
    console.error(error);
    failedReview = "The review could not open. Nothing was sent.";
  } finally {
    busy(el as HTMLButtonElement, false);
    render();
  }
};

export async function reviewSwap(
  plan: Plan,
  tokens: Map<string, Token>,
  prices?: Prices,
  gasCosts?: Costs,
): Promise<string | undefined> {
  const connection = state.connection!;
  const safe = !!connection.wallet.propose;
  const deadline = () => BigInt(now() + (safe ? 86_400 : 1_800));
  const simulated = await swap.simulatePlan(connection.address, [], plan, tokens, deadline());
  if (simulated?.refused !== undefined)
    return simulated.refused < simulated.steps.approvals.length
      ? `Base refused “${simulated.steps.slips[simulated.refused]!.says}” Nothing was sent.`
      : "Base refused the swap: the quotes may have moved. Nothing was sent.";
  const lines = swap.withMinimums(plan, simulated?.results);
  const going = { ...plan, items: lines.flatMap(({ item, reason }) => (reason ? [] : [item])) };
  if (!going.items.length) return "Base would skip every token: none can be swapped now. Nothing was sent.";
  const out = going.items.reduce((sum, { out }) => sum + out, 0n);
  const fee = going.items.reduce((sum, { out }) => sum + swap.feeOf(out), 0n);
  const least = going.items.reduce((sum, { route }) => sum + route.minPaid, 0n);
  const gas =
    simulated?.gas ??
    BigInt(simulated?.steps.approvals.length ?? 0) * swap.APPROVAL_GAS +
      swap.swapGas(going.items.map(({ route }) => route));
  const value = (amount: bigint) => output(amount, plan.swapper, prices);
  const body = bill(
    frag("Quote · swap into ", code(plan.swapper.symbol)),
    gasCosts ? frag("Estimated gas ", gasUnder(gas * gasCosts.gasPrice, prices)) : "",
    lines.map(({ item, reason }) => {
      const under = reason ? undefined : underPrice(item.token, item.route.amount, item.out, plan.swapper, prices);
      return {
        symbol: item.token.symbol,
        amount: figure(item.route.amount, item.token.decimals),
        value: reason ? "Skipped" : value(item.out).exact,
        worth: reason ? "" : value(item.out).worthText,
        route: swap.hopsWords(item.route, tokens),
        note: reason ? `Skipped: ${reason}` : under !== undefined ? `${fraction(under)} under price` : null,
      };
    }),
    [
      ["Quote", value(out).exact, value(out).worthText],
      ["Swap fee", value(-fee).exact, value(-fee).worthText],
      ["Reaches you", value(out - fee).exact, value(out - fee).worthText],
    ],
    [`Minimum at ${Number(plan.margin) / 100}% slippage`, value(least).exact, value(least).worthText],
  );
  if (!simulated) body.append(fromTemplate("not-simulated"));
  let at = deadline();
  const quoted = new Map<string, bigint>();
  for (const { token, out } of going.items)
    quoted.set(key(token.address), (quoted.get(key(token.address)) ?? 0n) + out);
  openReview({
    name: `Swap into ${plan.swapper.symbol}`,
    pages: [{ title: "Quote", body }, {}],
    steps: (sending) =>
      swap.planSteps(going, tokens, sending ? (at = deadline()) : at, safe ? undefined : gasCosts?.tip).slips,
    atomic: true,
    checkHref: hrefOf({ view: "swap", output: plan.swapper.output, section: "check" }),
    outcome: async (receipts) => {
      const [paidGas, time] = await Promise.all([
        gasPaid(
          receipts.map(({ transactionHash }) => transactionHash),
          connection.address,
        ),
        includedAt(receipts),
      ]);
      return swapReceipt(receipts, going, tokens, prices, quoted, connection.address, paidGas, time);
    },
  });
}

// Skipped tokens stay in the wallet with their approval to the swapper still set, so the receipt offers to reset it.
export function swapReceipt(
  receipts: Landed[],
  plan: Plan,
  tokens: Map<string, Token>,
  prices: Prices | undefined,
  quoted: Map<string, bigint>,
  caller: Address,
  gas?: bigint,
  time = now(),
): HTMLElement {
  const { swapper } = plan;
  const { swapped, failed, paid } = swap.swappedIn(receipts, swapper, caller);
  const sold = new Map<string, { token: Address; amountIn: bigint; amountOut: bigint }>();
  for (const { token, amountIn, amountOut } of swapped) {
    const each = sold.get(key(token)) ?? { token, amountIn: 0n, amountOut: 0n };
    [each.amountIn, each.amountOut] = [each.amountIn + amountIn, each.amountOut + amountOut];
    sold.set(key(token), each);
  }
  const fetched = swapped.reduce((sum, { amountOut }) => sum + amountOut, 0n);
  const value = (amount: bigint) => output(amount, swapper, prices);
  const node = bill(
    frag("Receipt · swap into ", code(swapper.symbol)),
    `${utc(time)}${gas === undefined ? "" : ` · gas ${gasWords(gas, prices)}`}`,
    [...sold.values()].map(({ token, amountIn, amountOut }) => {
      const planned = plan.items
        .filter((each) => same(each.token.address, token))
        .reduce((sum, { route }) => sum + route.amount, 0n);
      const quote = quoted.get(key(token));
      const tenths = quote && planned === amountIn ? Number(((amountOut - quote) * 1000n) / quote) : undefined;
      return {
        symbol: tokens.get(key(token))?.symbol ?? token,
        amount: figure(amountIn, tokens.get(key(token))?.decimals ?? 0),
        value: value(amountOut).exact,
        worth: value(amountOut).worthText,
        route:
          tenths === undefined
            ? ""
            : tenths
              ? `${tenths > 0 ? "+" : "−"}${(Math.abs(tenths) / 10).toFixed(1)}% vs quote`
              : "As quoted",
        note: null,
      };
    }),
    [
      ["Fetched", value(fetched).exact],
      ["Swap fee", value(paid - fetched).exact],
    ],
    ["Paid to you", value(paid).exact, value(paid).worthText],
  );
  const skipped = [...new Map(failed.map((each) => [key(each.token), each])).values()];
  if (skipped.length)
    node.append(
      ...skipped.map(({ token, reason }) => {
        const p = Object.assign(document.createElement("p"), { className: "u-spread" });
        const reset = Object.assign(document.createElement("button"), {
          type: "button",
          className: "Button--secondary Button--compact",
          textContent: "Reset its approval",
        });
        reset.addEventListener("click", () => openReset([{ token, spender: swapper.address, amount: 1n }]));
        const kept = sold.has(key(token)) ? " partly kept" : " kept";
        p.append(frag(code(tokens.get(key(token))?.symbol ?? token), `${kept}: ${swap.reasonOf(reason)}`), reset);
        return p;
      }),
    );
  return node;
}

export const allowances = (): Got<Allowance[]> => {
  const owner = data.owner();
  return owner ? use(`allowances ${owner} ${known().length}`, () => allowancesOf(owner, known(), rd)) : {};
};
export function drawAllowances(el: HTMLElement): void {
  const found = allowances();
  const addresses = found.value?.map(({ token }) => token);
  const tokens = addresses && use(`tokens ${addresses.join()}`, () => describe(addresses)).value;
  list(
    el,
    found.value ?? [],
    ({ token, spender }) => `${token} ${spender}`,
    (li, allowance) => {
      const token = tokens?.get(key(allowance.token));
      fill(li, {
        symbol: token?.symbol ?? allowance.token,
        amount: token ? figure(allowance.amount, token.decimals) : String(allowance.amount),
        swapper: SWAPPERS.find(({ address }) => same(address, allowance.spender))!.symbol,
      });
    },
  );
  fill(view, { "reset-all": (found.value?.length ?? 0) > 1 || null });
}
actions.reset = (el) => {
  const all = allowances().value ?? [];
  const row = el.closest<HTMLElement>("[data-key]");
  void openReset(
    el.dataset.arg === "all" ? all : all.filter(({ token, spender }) => `${token} ${spender}` === row?.dataset.key),
  );
};
async function openReset(these: Allowance[]): Promise<void> {
  if (!these.length) return;
  const tokens = await describe(these.map(({ token }) => token));
  const slips = these.map(({ token, spender }) =>
    swap.approveSlip(
      tokens.get(key(token)) ?? { address: token, decimals: 0, symbol: token },
      SWAPPERS.find(({ address }) => same(address, spender))!,
      0n,
    ),
  );
  openReview({
    name: these.length === 1 ? "Reset an approval" : `Reset ${these.length} approvals`,
    pages: [],
    steps: () => slips,
    checkHref: hrefOf({ view: "swap", output: "usdc", section: "check" }),
  });
}

export function swapLine(): Value {
  const found = scan();
  return shown(found, ({ rows, reading, prices }) => {
    const swappable = rows.filter(({ route, reason }) => route && !reason);
    const worth = swappable.reduce((sum, { worth = 0 }) => sum + worth, 0);
    if (!swappable.length) return reading ? undefined : "Nothing to swap";
    return `${count(swappable.length, "token", "tokens")} · ${money(moneyAt(worth, prices))}${reading ? " so far" : ""}`;
  });
}
export const preloadSwap = (): void => void scan();
