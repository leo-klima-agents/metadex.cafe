import { maxUint256, type Address } from "viem";
import { use, type Got } from "../cache.ts";
import { AUTOMATIONS, SWAPPERS, swapperOf, type Swapper } from "../config.ts";
import * as data from "../data.ts";
import { fixed, figure, fraction, money, moneyAt, utc, type Money } from "../format.ts";
import { type Amount } from "../payouts.ts";
import { ethCost, gasWords, key, pricesNow, worthOf, type Prices, type Token } from "../prices.ts";
import { hrefOf } from "../routes.ts";
import { routeTogether, type Sale } from "../routing.ts";
import { costs, gasPaid, includedAt, now, same, tagged, type Costs, type Receipt } from "../rpc.ts";
import { actions, render, state } from "../state.ts";
import * as swap from "../swap.ts";
import type { Found, Item, Plan, Route } from "../swap.ts";
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
} from "../tokens.ts";
import { $, busy, code, fill, frag, list, shown, stateOf, type Value } from "../ui.ts";
import { walletAssets } from "../wallet.ts";
import { openReview } from "./review.ts";

// The swap: the wallet's tokens, each with what it fetches, those worth twice their gas ticked; then what the ticked
// ones fetch together, routed together and run through Base, line by line.
const view = $('[data-view="swap"]');
const rd = tagged("swap");
const ticks = new Map<string, boolean>();
let margin = 50n;
let prefilled: Map<string, bigint> | undefined;
let added = "";
let ticked = { key: "", at: 0 };
let reviewing = false;
let failedReview = "";

const swapperShown = (): Swapper => swapperOf(state.route.view === "swap" ? state.route.output : "usdc")!;
export const swapsOff = (): boolean | undefined => {
  const checks = data.checks().value;
  return checks && [...checks.values()].some((failed) => failed.includes("chain"));
};
export function prefill(amounts: Amount[]): void {
  prefilled = new Map(amounts.map(({ token, amount }) => [key(token), amount]));
  know(amounts.map(({ token }) => token));
  ticks.clear();
}

// What the scan reads: the wallet's tokens and their allowances to the swapper, their names, gas and prices now.
type Scan = { rows: Row[]; tokens: Map<string, Token>; prices: Prices; costs?: Costs | undefined; reading: boolean };
type Row = {
  token: Token;
  amount: bigint;
  allowance: bigint;
  found: Got<Found | null>;
  reason?: string | undefined;
  worth?: number | undefined;
  ticked: boolean;
};
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
  return data.then(held, (balances) => {
    const owned = all.filter((token) => (balances.get(key(token))?.balance ?? 0n) > 0n && !same(token, swapper.token));
    const names = [...owned, swapper.token, ...swap.MIDDLES];
    return data.then(
      use(`tokens ${names.join()}`, () => describe(names)),
      (tokens) => {
        const amounts = new Map(owned.map((token) => [key(token), balances.get(key(token))!.balance]));
        const prices = use(
          `prices ${connection.address} ${swapper.output} ${owned.join()}`,
          () => pricesNow([...tokens.values()], amounts, rd),
          60_000,
        );
        const gas = use("costs", costs, 60_000);
        if (prices.value === undefined && !prices.failed) return {};
        const pricing = prices.value ?? { unit: "USD", of: new Map(), standIns: new Map() };
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
          );
          const row: Row = { token, amount: capped, allowance, found, ticked: false };
          if (found.failed) row.reason = "Not read";
          else if (found.value === undefined) return [row];
          else if (!found.value) row.reason = "No route";
          else {
            const price = pricing.of.get(key(address));
            row.worth =
              value(found.value.out) ?? (price === undefined ? undefined : worthOf(capped, token.decimals, price));
            const units = found.value.gas + (allowance < capped ? swap.APPROVAL_GAS : 0n);
            const cost = gas.value ? (ethCost(units * gas.value.gasPrice, pricing)?.value ?? 0) : 0;
            row.reason = row.worth === undefined ? "No price" : row.worth < 2 * cost ? "Below gas" : undefined;
          }
          const auto = !!found.value && !row.reason && (!prefilled || prefilled.has(key(address)));
          row.ticked = !!found.value && (ticks.get(key(address)) ?? auto);
          return [row];
        });
        rows.sort((a, b) => (b.worth ?? -1) - (a.worth ?? -1));
        return {
          value: {
            rows,
            tokens,
            prices: pricing,
            costs: gas.value,
            reading: rows.some(({ found }) => !found.value && !found.failed),
          },
        };
      },
    );
  });
}

// The ticked tokens' routes, each its own, or found together, as Base runs them in order after their approvals:
// whichever fetches more, net of gas. Without Base's answer, each token's own quote.
type Together = {
  parts: Map<string, { route: Route; out?: bigint | undefined }[]>;
  gas?: bigint | undefined;
  swaps: number;
};
function together(found: Scan): Got<Together> {
  const connection = state.connection!;
  const swapper = swapperShown();
  const rows = found.rows.filter((row) => row.ticked && row.found.value);
  const id = `${swapper.output} ${rows.map(({ token, amount }) => `${token.address}:${amount}`).join()}`;
  if (id !== ticked.key) ticked = { key: id, at: performance.now() };
  // Ticks settle before they are routed.
  if (performance.now() - ticked.at < 400) {
    setTimeout(render, 400);
    return {};
  }
  return use(`together ${connection.address} ${id}`, async () => {
    const plan = (routes: Route[][]): Plan => ({
      swapper,
      margin,
      items: rows.flatMap((row, i) =>
        routes[i]!.map((route) => ({ token: row.token, route, out: 0n, allowance: row.allowance })),
      ),
    });
    const own = rows.map((row) => [{ ...row.found.value!.route, amount: row.amount }]);
    const sales: Sale[] = rows.map((row) => ({
      token: row.token.address,
      amount: row.amount,
      found: row.found.value!,
      hydrex: isHydrex(row.token.address),
    }));
    const deadline = BigInt(now() + 1800);
    const run = (routes: Route[][]) => swap.simulatePlan(connection.address, [], plan(routes), found.tokens, deadline);
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
    const outOf = (row: Row) => {
      const result = results?.[next++];
      return results ? (result?.done ? result.amountOut : undefined) : row.found.value!.out;
    };
    const parts = new Map(
      rows.map((row, i) => [key(row.token.address), routes[i]!.map((route) => ({ route, out: outOf(row) }))]),
    );
    return { parts, gas: results && simulated!.gas, swaps: swap.split(routes.flat()).length };
  });
}

// The output's amounts, to as many places as a cent of it needs, with what they are worth.
function output(amount: bigint, prices: Prices | undefined): { exact: string; worth?: Money } {
  const swapper = swapperShown();
  const price = prices?.of.get(key(swapper.token));
  const places = Math.min(
    swapper.decimals,
    Math.max(2, price ? Math.ceil(Math.log10(price) + 2 - 0.05) : swapper.places),
  );
  return {
    exact: `${fixed(amount, swapper.decimals, places)} ${swapper.symbol}`,
    worth: price === undefined ? undefined : moneyAt(worthOf(amount, swapper.decimals, price), prices!),
  };
}
// How far a quote falls under the page's own price, where it falls more than 2% short.
function underPrice(token: Token, amount: bigint, out: bigint, prices: Prices | undefined): number | undefined {
  const swapper = swapperShown();
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
    (row, each) => fill(row, { name: `Swap ${each.symbol}`, address: { address: each.address } }),
  );
  drawAllowances($("[data-list=allowance]", view));
  const found = scan();
  const rows = found.value?.rows ?? [];
  const picked = rows.filter((row) => row.ticked);
  const routed = found.value && picked.length ? together(found.value) : {};
  const partsOf = (row: Row) =>
    routed.value?.parts.get(key(row.token.address)) ?? [{ route: row.found.value!.route, out: row.found.value!.out }];
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
      box.disabled = !row.found.value;
      box.setAttribute("aria-label", `Sell ${row.token.symbol}`);
      const out = !row.found.value
        ? undefined
        : row.ticked
          ? partsOf(row).reduce((sum, { out }) => (out === undefined ? sum : sum + out), 0n)
          : row.found.value.out;
      const skipped = row.ticked && !!routed.value && partsOf(row).every(({ out }) => out === undefined);
      const quote = out === undefined || skipped ? undefined : output(out, found.value!.prices);
      const like = lookalike(row.token);
      const under =
        quote && out !== undefined && !row.reason
          ? underPrice(row.token, row.amount, out, found.value!.prices)
          : undefined;
      fill(li, {
        symbol: row.token.symbol,
        amount: figure(row.amount, row.token.decimals),
        fetches: row.found.value ? (quote?.exact ?? "") : row.found.failed ? "" : undefined,
        worth: quote?.worth ? money(quote.worth) : "",
        note: row.reason ?? (skipped ? "Base would skip it" : null),
        warning: like
          ? `Not the usual ${like.symbol}`
          : under !== undefined
            ? `Quote ${fraction(under)} under price`
            : null,
      });
    },
  );
  // What the ticked ones fetch together, line by line.
  const parts = picked.flatMap(partsOf);
  const going = parts.flatMap(({ out }) => (out === undefined ? [] : [out]));
  const out = going.reduce((sum, each) => sum + each, 0n);
  const least = going.reduce((sum, each) => sum + swap.minimumOf(each, margin), 0n);
  const fee = going.reduce((sum, each) => sum + swap.feeOf(each), 0n);
  const gas =
    routed.value?.gas ??
    BigInt(picked.filter((row) => row.allowance < row.amount).length) * swap.APPROVAL_GAS +
      swap.swapGas(parts.map(({ route }) => route));
  const prices = found.value?.prices;
  const line = (amount: bigint) => {
    const shown = output(amount, prices);
    return `${shown.exact}${shown.worth ? `  ${money(shown.worth, true)}` : ""}`;
  };
  const waiting = !picked.length && found.value?.reading;
  const button = $<HTMLButtonElement>("[data-action=review-swap]", view);
  button.disabled = !picked.length || off !== false || reviewing;
  fill(view, {
    pick: picked.length || waiting ? null : "Pick tokens to sell",
    summary: !!picked.length || !!waiting,
    quote: picked.length ? line(out) : undefined,
    fee: picked.length ? line(-fee) : undefined,
    paid: picked.length ? line(out - fee) : undefined,
    least: picked.length ? line(least) : undefined,
    gas:
      picked.length && found.value?.costs
        ? gasWords(gas * found.value.costs.gasPrice, prices)
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
  location.hash = hrefOf({ view: "swap", output: (el as HTMLInputElement).value as Swapper["output"] });
  ticks.clear();
};
actions.tick = (el) => {
  ticks.set(el.closest<HTMLElement>("[data-key]")!.dataset.key!.toLowerCase(), (el as HTMLInputElement).checked);
  render();
};
actions.margin = (el) => {
  margin = BigInt((el as HTMLSelectElement).value);
  render();
};
actions.add = async (el) => {
  const address = ((el as HTMLFormElement).elements.namedItem("address") as HTMLInputElement).value.trim();
  const input = (el as HTMLFormElement).elements.namedItem("address") as HTMLInputElement;
  added = /^0x[0-9a-fA-F]{40}$/.test(address) ? "" : "That's not a token's address.";
  if (!added) {
    const found = await tokensOf([address as Address]).catch(() => new Map());
    added = found.size ? "" : "No token at that address.";
    if (!added) {
      know([address as Address]);
      input.value = "";
    }
  }
  input.setAttribute("aria-invalid", String(!!added));
  render();
};

// The review: run through Base with no minimums, each route then sets its own, under what it fetched; a route that
// would not go through even so is left out.
actions["review-swap"] = async (el) => {
  const connection = state.connection;
  const found = scan().value;
  if (!connection || !found || reviewing) return;
  reviewing = true;
  failedReview = "";
  busy(el as HTMLButtonElement);
  const swapper = swapperShown();
  const routed = together(found).value;
  const items: Item[] = found.rows
    .filter((row) => row.ticked && row.found.value)
    .flatMap((row) =>
      (routed?.parts.get(key(row.token.address)) ?? [{ route: row.found.value!.route, out: row.found.value!.out }]).map(
        ({ route, out }) => ({
          token: row.token,
          route: { ...route, minPaid: swap.minimumOf(out ?? row.found.value!.out, margin) },
          out: out ?? (row.found.value!.out * route.amount) / row.amount,
          allowance: row.allowance,
        }),
      ),
    );
  failedReview = (await reviewSwap({ swapper, items, margin }, found.tokens, found.prices, found.costs)) ?? "";
  reviewing = false;
  busy(el as HTMLButtonElement, false);
  render();
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
  const value = (amount: bigint) => output(amount, prices);
  const body = billNode(
    frag("Quote · swap into ", code(plan.swapper.symbol)),
    gasCosts ? `Estimated gas ${gasWords(gas * gasCosts.gasPrice, prices)}` : "",
    lines.map(({ item, reason }) => {
      const under = reason ? undefined : underPrice(item.token, item.route.amount, item.out, prices);
      return {
        symbol: item.token.symbol,
        amount: figure(item.route.amount, item.token.decimals),
        value: reason ? "Skipped" : value(item.out).exact,
        worth: reason ? "" : (value(item.out).worth && money(value(item.out).worth!, true)) || "",
        route: swap.hopsWords(item.route, tokens),
        note: reason ? `Skipped: ${reason}` : under !== undefined ? `${fraction(under)} under price` : null,
      };
    }),
    [
      ["Quote", value(out).exact, value(out).worth && money(value(out).worth!, true)],
      ["Swap fee", value(-fee).exact],
      ["Reaches you", value(out - fee).exact, value(out - fee).worth && money(value(out - fee).worth!, true)],
    ],
    [
      `Minimum at ${Number(plan.margin) / 100}% slippage`,
      value(least).exact,
      value(least).worth ? money(value(least).worth!, true) : "",
    ],
  );
  if (!simulated)
    body.append(
      Object.assign(document.createElement("p"), {
        className: "notice",
        textContent: "Not simulated: these are quotes.",
      }),
    );
  let at = deadline();
  const quoted = new Map<string, bigint>();
  for (const { token, out } of going.items)
    quoted.set(key(token.address), (quoted.get(key(token.address)) ?? 0n) + out);
  openReview({
    name: `Swap into ${plan.swapper.symbol}`,
    pages: [{ title: "Quote", body }],
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
      return swapReceipt(receipts, going, tokens, prices, quoted, paidGas, time);
    },
  });
}

// A bill: its lines, then its sums, then its total.
type Line = { symbol: string; amount: string; value: string; worth: string; route: string; note: Value };
export function billNode(
  label: Value,
  day: Value,
  lines: Line[],
  sums: [string, Value, Value?][],
  total: [Value, Value, Value],
): HTMLElement {
  const node = $<HTMLTemplateElement>("#bill").content.firstElementChild!.cloneNode(true) as HTMLElement;
  fill(node, {
    label,
    day,
    total: total[0],
    "total-value": total[1],
    "total-worth": total[2],
    "total-detail": null,
    foot: null,
    after: null,
  });
  list(
    $("[data-list=line]", node),
    lines,
    (_, i) => String(i),
    (li, line) => fill(li, { ...line }),
  );
  list(
    $("[data-list=sum]", node),
    sums,
    (_, i) => String(i),
    (row, [label, value, detail]) => fill(row, { label, value, detail: detail || null }),
  );
  list($("[data-list=claim]", node), [], String, () => {});
  return node;
}

// The receipt: what each token fetched against its quote, the fee, what reached the wallet, and those skipped, which
// stay in the wallet with their approval, which it offers to reset.
export function swapReceipt(
  receipts: Receipt[],
  plan: Plan,
  tokens: Map<string, Token>,
  prices: Prices | undefined,
  quoted: Map<string, bigint>,
  gas?: bigint,
  time = now(),
): HTMLElement {
  const { swapper } = plan;
  const { swapped, failed, paid } = swap.swappedIn(receipts, swapper, state.connection!.address);
  const sold = new Map<string, { token: Address; amountIn: bigint; amountOut: bigint }>();
  for (const { token, amountIn, amountOut } of swapped) {
    const each = sold.get(key(token)) ?? { token, amountIn: 0n, amountOut: 0n };
    [each.amountIn, each.amountOut] = [each.amountIn + amountIn, each.amountOut + amountOut];
    sold.set(key(token), each);
  }
  const fetched = swapped.reduce((sum, { amountOut }) => sum + amountOut, 0n);
  const value = (amount: bigint) => output(amount, prices);
  const node = billNode(
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
        worth: value(amountOut).worth ? money(value(amountOut).worth!, true) : "",
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
    ["Paid to you", value(paid).exact, value(paid).worth ? money(value(paid).worth!, true) : ""],
  );
  const skipped = [...new Map(failed.map((each) => [key(each.token), each])).values()];
  if (skipped.length)
    node.append(
      ...skipped.map(({ token, reason }) => {
        const p = Object.assign(document.createElement("p"), { className: "spread" });
        const reset = Object.assign(document.createElement("button"), {
          type: "button",
          className: "secondary compact",
          textContent: "Reset its approval",
        });
        reset.addEventListener("click", () => openReset([{ token, spender: swapper.address, amount: 1n }]));
        p.append(frag(code(tokens.get(key(token))?.symbol ?? token), ` kept: ${swap.reasonOf(reason)}`), reset);
        return p;
      }),
    );
  return node;
}

// What the wallet allows the swappers to take, with the calls that reset it.
export const allowances = (): Got<Allowance[]> => {
  const owner = data.owner();
  return owner ? use(`allowances ${owner} ${known().length}`, () => allowancesOf(owner, known(), rd)) : {};
};
export function drawAllowances(el: HTMLElement): void {
  const found = allowances();
  const tokens =
    found.value &&
    use(`tokens ${found.value.map(({ token }) => token).join()}`, () =>
      describe(found.value!.map(({ token }) => token)),
    ).value;
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
  fill(view, { "reset-all": (found.value?.length ?? 0) > 1 });
}
actions.reset = (el) => {
  const all = allowances().value ?? [];
  const row = el.closest<HTMLElement>("[data-key]");
  void openReset(
    el.dataset.arg === "all" ? all : all.filter(({ token, spender }) => `${token} ${spender}` === row?.dataset.key),
  );
};
export async function openReset(these: Allowance[]): Promise<void> {
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

// The App's line: how many tokens the wallet could swap, and what they are worth.
export function swapLine(): Value {
  const found = scan();
  return shown(found, ({ rows, reading }) => {
    const worth = rows.reduce((sum, { worth = 0 }) => sum + worth, 0);
    if (!rows.length) return reading ? undefined : "Nothing to swap";
    const prices = scan().value!.prices;
    return `${rows.length} token${rows.length === 1 ? "" : "s"} · ${money(moneyAt(worth, prices))}${reading ? " so far" : ""}`;
  });
}
export const preloadSwap = (): void => void scan();
