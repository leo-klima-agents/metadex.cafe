import { maxUint256 } from "viem";
import {
  CLAIM_CALL_GAS,
  MAX_CLAIM_GAS,
  SAFE_CLAIM_CALL_GAS,
  claimArgs,
  claimCalls,
  claimGas,
  claimTransactions,
  claimTx,
  claimedIn,
  owedOf,
  paidBy,
  type Claim,
} from "../claim.ts";
import { DOUBLE_ESPRESSO, HYDX, SWAPPERS, swapperOf, type Swapper, type Token } from "../config.ts";
import { between, count, figure, list as words, money, type Money } from "../format.ts";
import type { Entry } from "../payouts.ts";
import { costs, ethCost, gasWords, pricesNow, worthOf, type Prices } from "../prices.ts";
import { simulate, type Receipt } from "../rpc.ts";
import { MIDDLES, APPROVAL_GAS, findRoute, minimumOf, paidOf, partOf, routeResults } from "../swap.ts";
import { tokensOf } from "../tokens.ts";
import { key, same, sum, sumByToken, type Amount } from "../util.ts";
import { capabilities } from "../wallet.ts";
import { $, $$, busy, fill, list, type Value } from "./dom.ts";
import { openReview, type Slip } from "./review.ts";
import { hrefOf } from "./router.ts";
import { session, swapsOff } from "./session.ts";
import { openSwapReview, planSteps, prefill, receiptOf, swapReceipt, type Plan } from "./swap.ts";

const MARGIN = 50n;
const pages = $("#pages");
const select = $<HTMLSelectElement>("#claim-output");
const radios = $$<HTMLInputElement>("input[name=receive]", pages);
const into = () => radios.find(({ checked }) => checked)?.value === "into";

const amountWords = (amounts: Amount[], tokens: Map<string, Token>, sign = "") =>
  amounts.length
    ? sign +
      words(
        amounts.map(({ token, amount }) => {
          const known = tokens.get(key(token));
          return known ? `${figure(amount, known.decimals)} ${known.symbol}` : `${amount} of ${token}`;
        }),
      )
    : "Nothing";
const valueOf = (amounts: Amount[], tokens: Map<string, Token>, prices: Prices | undefined) =>
  sum(
    amounts.map(({ token, amount }) => {
      const known = tokens.get(key(token));
      const price = prices?.of.get(key(token));
      return known && price !== undefined ? worthOf(amount, known.decimals, price) : 0;
    }),
  );

function claimSlip(claim: Claim, tokens: Map<string, Token>, whole: boolean): Slip {
  const [id, fees, bribes, claimed] = claimArgs(claim);
  const from = whole ? "" : ` from ${count(fees.length + bribes.length, "reward contract", "reward contracts")}`;
  return {
    ...claimTx(claim),
    title: "Claim",
    says: `Claims account #${id}'s rewards${from} through Double Espresso, which pays them to you, less 1%.`,
    on: DOUBLE_ESPRESSO.contract,
    call: "claim",
    fields: [
      { label: "Account", code: `${id}` },
      { label: "Fees from", code: fees, description: "Pools' fees contracts that owe it" },
      { label: "Incentives from", code: bribes, description: "Pools' incentives contracts that owe it" },
      { label: "Tokens", code: claimed, tags: claimed.map((token) => tokens.get(key(token))?.symbol ?? "") },
    ],
  };
}

// The page's own claims, from their events: what came, the fee, what reached the owner.
function claimReceipts(
  receipts: Receipt[],
  ids: bigint[],
  tokens: Map<string, Token>,
  prices: Prices | undefined,
): HTMLElement[] {
  return claimedIn(
    receipts.flatMap(({ logs }) => logs),
    ids,
    session.connection!.address,
  ).map(({ id, received, fees, paid }) => {
    const value = valueOf(received, tokens, prices);
    return receiptOf(
      `Receipt · Account #${id} · Double Espresso`,
      "",
      [
        ["Claimed", value > 0 ? money({ value, unit: prices!.unit }, true) : "", amountWords(received, tokens)],
        ["Fee 1%", amountWords(fees, tokens, "−")],
      ],
      [["Paid to you", amountWords(paid, tokens)]],
      received.length ? "" : "Nothing came: someone else already claimed it for you.",
    );
  });
}

// What waits for the wallet's overdue accounts, then how to receive it: as it is, by default, or swapped into one token.
export async function openClaim(entries: Entry[], button?: HTMLElement): Promise<void> {
  const { connection } = session;
  if (!connection || !entries.length || (button && button.getAttribute("aria-busy") === "true")) return;
  if (button) busy(button);
  try {
    await open(entries);
  } finally {
    if (button) busy(button, false);
  }
}

async function open(entries: Entry[]): Promise<void> {
  const connection = session.connection!;
  const [{ claims, tokens }, found, caps, middles] = await Promise.all([
    owedOf(entries),
    costs().catch(() => undefined),
    capabilities(connection),
    tokensOf([...MIDDLES, HYDX]).catch(() => new Map<string, Token>()),
  ]);
  for (const [address, token] of middles) if (!tokens.has(address)) tokens.set(address, token);
  const owing = claims.filter(({ owed }) => owed.length);
  const name = `Claim for ${entries.length === 1 ? "Hydrex account" : "Hydrex accounts"} ${words(entries.map(({ account }) => `#${account.id}`))}`;
  const checkHref = hrefOf({ view: "automation", kind: DOUBLE_ESPRESSO.kind, section: "check" });
  const nothing = (why: string) => openReview({ name, steps: [], checkHref, connection, outcome: why });
  if (!owing.length) return void nothing("Nothing to claim: someone else may have just claimed it for you.");
  const totals = paidBy(owing.flatMap(({ owed }) => owed));
  const paid = totals.map(({ token, paid }) => ({ token, amount: paid }));
  const earnedAmounts = totals.map(({ token, earned }) => ({ token, amount: earned }));
  // Each account's calls, the most valuable first, so that stopping halfway claims the most; small ones for a Safe.
  const weight = ({ owed }: Claim) => valueOf(owed, tokens, entries[0]!.earnings!.prices);
  const calls = owing.flatMap((claim) => {
    const parts = claimCalls(claim, connection.wallet.propose ? SAFE_CLAIM_CALL_GAS : CLAIM_CALL_GAS).sort(
      (a, b) => weight(b) - weight(a),
    );
    return parts.map((part) => ({ part, whole: parts.length === 1 }));
  });
  const claimSlips = calls.map(({ part, whole }) => claimSlip(part, tokens, whole));
  const simulated = await simulate(connection.address, claimSlips).catch(() => undefined);
  if (simulated?.some(({ ok }) => !ok))
    return void nothing("Base refused the claim. Someone else may be claiming now.");
  if (simulated?.some(({ gas }) => gas > MAX_CLAIM_GAS))
    return void nothing("This claim needs more gas than Base allows.");
  const gas = simulated?.map(({ gas }) => gas) ?? calls.map(({ part }) => claimGas(part.owed));
  const groups = claimTransactions(gas);
  const apart = groups.length > 1;
  let prices: Prices | undefined;
  let settled = false;
  let withSwap: bigint | undefined;
  const gasLine = (units: bigint): Value =>
    !settled ? undefined : found ? gasWords(units * found.gasPrice, prices) : `${units.toLocaleString("en-GB")} gas`;
  const draw = () => {
    const [earned, reaches] = [earnedAmounts, paid].map(
      (amounts) => prices && ({ value: valueOf(amounts, tokens, prices), unit: prices.unit } as Money),
    );
    const worth = (sum: Money | undefined): Value => (sum ? money(sum, true) : settled ? "Not read" : undefined);
    fill(pages, {
      "claim-earned": worth(earned),
      "claim-fee": earned && reaches ? money(between(earned, reaches), true) : worth(undefined),
      "claim-paid": worth(reaches),
      "claim-count": count(totals.length, "token", "tokens"),
      "claim-gas": gasLine(gas.reduce((a, b) => a + b, 0n)),
      "claim-gas-swap": withSwap === undefined ? "" : `, ${gasLine(withSwap) ?? "…"} with the swap`,
    });
    const value = (amount: Amount) => valueOf([amount], tokens, prices);
    list(
      $("#claim-tokens"),
      "line",
      [...earnedAmounts].sort((a, b) => value(b) - value(a)),
      ({ token }) => key(token),
      (row, amount) => {
        const known = tokens.get(key(amount.token));
        fill(row, {
          symbol: known?.symbol ?? amount.token,
          amount: known ? figure(amount.amount, known.decimals) : `${amount.amount}`,
          fetches: value(amount) > 0 ? money({ value: value(amount), unit: prices!.unit }, true) : "",
          worth: "",
          route: "",
          warning: "",
          button: "",
        });
        $("button", row).hidden = true;
      },
    );
  };
  draw();
  const priced = pricesNow(
    [
      ...paid.flatMap(({ token }) => tokens.get(key(token)) ?? []),
      ...SWAPPERS.map(({ token, decimals, symbol }) => ({ address: token, decimals, symbol })),
    ],
    new Map(paid.map(({ token, amount }) => [key(token), amount])),
  ).then(
    (read) => {
      [prices, settled] = [read, true];
      draw();
      return read;
    },
    (error: unknown) => {
      console.error(error);
      settled = true;
      draw();
      return undefined;
    },
  );
  const ids = owing.map(({ id }) => id);
  const brought = (receipts: Receipt[]) =>
    sumByToken(
      claimedIn(
        receipts.flatMap(({ logs }) => logs),
        ids,
        connection.address,
      ).flatMap(({ paid }) => paid),
    );
  const asTheyAre = async (receipts: Receipt[]) => {
    $("#receipts").append(...claimReceipts(receipts, ids, tokens, prices));
    const came = brought(receipts);
    const these = $("[data-action=swap-these]", $("#done"));
    these.hidden = !came.length;
    these.onclick = () => prefill(came);
  };
  const opened = openReview({
    name,
    intro: { kind: "claim", title: "What waits" },
    steps: claimSlips,
    checkHref,
    connection,
    finish: asTheyAre,
    ...(apart ? { groups } : {}),
  });
  // Swapped into one token: each claimed amount is approved exactly, and the swap sells "my balance, up to the
  // allowance". All in one prompt only where all or nothing, as a failed claim would leave the swap selling what was
  // held before; otherwise the claim first, then the swap's own review.
  const together = (caps.atomic || !!connection.wallet.propose) && !apart;
  let planned = 0;
  const say = (text: Value) => fill(pages, { "claim-into": text });
  const plan = async (swapper: Swapper, id: number): Promise<void> => {
    say(undefined);
    withSwap = undefined;
    draw();
    const [routes, current] = await Promise.all([
      Promise.all(
        paid.map(({ token, amount }) =>
          same(token, swapper.token) ? undefined : findRoute(token, amount, swapper, true).catch(() => undefined),
        ),
      ),
      priced,
    ]);
    if (id !== planned) return;
    const outputPrice = current?.of.get(key(swapper.token));
    const items: Plan["items"] = [];
    const left: string[] = [];
    paid.forEach(({ token, amount }, i) => {
      const route = routes[i];
      if (same(token, swapper.token)) return;
      const known = tokens.get(key(token));
      const price = current?.of.get(key(token));
      const worth = !route
        ? undefined
        : outputPrice !== undefined
          ? worthOf(route.out, swapper.decimals, outputPrice)
          : price !== undefined && known
            ? worthOf(amount, known.decimals, price)
            : undefined;
      const cost = found && route ? (ethCost((route.gas + APPROVAL_GAS) * found.gasPrice, current)?.value ?? 0) : 0;
      if (!route || worth === undefined || worth < 2 * cost) return void left.push(known?.symbol ?? token);
      items.push({
        token: known!,
        route: { ...route.route, amount: maxUint256, minPaid: minimumOf(route.out, MARGIN) },
        out: route.out,
        allowance: 0n,
        approve: amount,
      });
    });
    const kept = paid.find(({ token }) => same(token, swapper.token))?.amount ?? 0n;
    const sayInto = (these: Plan["items"]) => {
      const out = kept + these.reduce((total, { out }) => total + paidOf(out), 0n);
      const least = kept + these.reduce((total, { route }) => total + route.minPaid, 0n);
      say(
        these.length
          ? `${figure(out, swapper.decimals)} ${swapper.symbol}, at least ${figure(least, swapper.decimals)}, from ${words(these.map(({ token }) => token.symbol))}${left.length ? `; ${count(left.length, "token", "tokens")} kept` : ""}`
          : `None worth swapping into ${swapper.symbol}`,
      );
    };
    sayInto(items);
    if (!items.length || !into()) return void (into() && opened.replace(claimSlips, { finish: asTheyAre }));
    const swapPlan: Plan = { swapper, items, margin: MARGIN };
    if (!together)
      return opened.replace(claimSlips, {
        finish: async (receipts) => {
          $("#receipts").append(...claimReceipts(receipts, ids, tokens, current));
          // For what the claims brought, not what the page expected: someone may have claimed some first.
          const came = brought(receipts);
          const exact: Plan = {
            swapper,
            margin: MARGIN,
            items: items.flatMap(({ approve = 0n, ...item }) => {
              const amount = came.find(({ token }) => same(token, item.token.address))?.amount;
              return amount ? [partOf(item, amount, approve)] : [];
            }),
          };
          const next = $("[data-action=swap-next]", $("#done"));
          next.hidden = !exact.items.length;
          next.textContent = `Review the swap into ${swapper.symbol}`;
          next.onclick = () =>
            void openSwapReview(exact, connection, tokens, found, current).then(
              (reason) => reason && fill($("#done"), { done: reason }),
              console.error,
            );
        },
      });
    // With no minimums first, after the claims: each route's minimum is what Base finds it fetches; a route that would
    // not go through even so is kept.
    const zeroed = swapPlan.items.map((item) => ({ ...item, route: { ...item.route, minPaid: 0n } }));
    const tried = await planSteps({ ...swapPlan, items: zeroed }, connection, tokens, true);
    const trial =
      id === planned
        ? await simulate(connection.address, [...claimSlips, ...tried.slips]).catch(() => undefined)
        : undefined;
    if (id !== planned) return;
    const results = routeResults(trial, claimSlips.length + tried.approvals.length, tried.swaps);
    if (results && trial!.every(({ ok }) => ok)) {
      swapPlan.items = zeroed.flatMap((item) => {
        const result = results.get(item.route);
        if (result?.done && result.amountOut > 0n)
          return [
            { ...item, out: result.amountOut, route: { ...item.route, minPaid: minimumOf(result.amountOut, MARGIN) } },
          ];
        left.push(item.token.symbol);
        return [];
      });
      sayInto(swapPlan.items);
      if (!swapPlan.items.length) return opened.replace(claimSlips, { finish: asTheyAre });
    }
    const { slips } = await planSteps(swapPlan, connection, tokens, true);
    const all = [...claimSlips, ...slips];
    const run = id === planned ? await simulate(connection.address, all).catch(() => undefined) : undefined;
    if (id !== planned) return;
    if (run?.some(({ ok }) => !ok) || (run?.reduce((total, { gas }) => total + gas, 0n) ?? 0n) > MAX_CLAIM_GAS) {
      say("Base refused both together: they come as they are.");
      return opened.replace(claimSlips, { finish: asTheyAre });
    }
    if (!into()) return;
    if (run) withSwap = run.reduce((total, { gas }) => total + gas, 0n);
    draw();
    opened.replace(all, {
      atomic: true,
      finish: async (receipts) => {
        $("#receipts").append(
          ...claimReceipts(receipts, ids, tokens, current),
          swapReceipt(receipts, swapPlan, tokens, connection.address, current),
        );
      },
    });
  };
  const choose = () => {
    withSwap = undefined;
    draw();
    if (!into()) return opened.replace(claimSlips, { finish: asTheyAre });
    const id = ++planned;
    plan(swapperOf(select.value)!, id).catch((error: unknown) => {
      console.error(error);
      if (id !== planned) return;
      say("Not read: they come as they are.");
      opened.replace(claimSlips, { finish: asTheyAre });
    });
  };
  select.replaceChildren(
    ...(swapsOff() ? [] : SWAPPERS).map(({ output, symbol }) =>
      Object.assign(document.createElement("option"), { value: output, textContent: symbol }),
    ),
  );
  radios[0]!.checked = true;
  for (const radio of radios) radio.onchange = choose;
  select.onchange = () => {
    radios[1]!.checked = true;
    choose();
  };
  // Not from a Safe whose claim takes several Safe transactions: the swap follows the claim's receipts.
  const safeApart = apart && !!connection.wallet.propose;
  radios[1]!.disabled = select.disabled = !select.options.length || safeApart;
  if (radios[1]!.disabled) say(safeApart ? "Swap them once the claims go through." : "Swaps are off.");
  else {
    const id = ++planned;
    plan(swapperOf(select.value)!, id).catch(
      (error: unknown) => (console.error(error), id === planned && say("Not read: they come as they are.")),
    );
  }
}
