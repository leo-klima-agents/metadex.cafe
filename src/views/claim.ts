import { maxUint256, type Address } from "viem";
import { same, type Receipt } from "../chain.ts";
import { DEFAULT_OUTPUT, HYDX, SWAPPERS, swapperOf, type Swapper } from "../config.ts";
import {
  CLAIM_CALL_GAS,
  MAX_CLAIM_GAS,
  SAFE_CLAIM_CALL_GAS,
  claimCalls,
  claimGas,
  claimSlip,
  claimTransactions,
  claimedIn,
  owedOf,
  paidBy,
  summed,
  type Claim,
} from "../claim.ts";
import { PENDING, clone, fill, live, rewrite, setText, show, type Text } from "../dom.ts";
import { between, count, figure, list, money, moneyAt, type Money } from "../format.ts";
import type { Entry } from "../last-payout.ts";
import { pricesNow, worthOf, type Prices, type Token } from "../prices.ts";
import { valueAt, weightAt, type Amount } from "../receipts.ts";
import { openReview, type Hooks } from "./review.ts";
import { hrefOf } from "../routes.ts";
import { APPROVAL_GAS, MIDDLES, findRoute, minimumOf, paidOf, partOf, routeResults, simulate } from "../swap.ts";
import { costs, gasCost, gasWords } from "../swap-calls.ts";
import { openSwapReview, planSteps, prefill, swapReceipt, swapsOff, type Plan } from "./swap.ts";
import { describe } from "../tokens.ts";
import { capabilities, type Connection } from "../wallet.ts";

// The review of a claim through Double Espresso, for the wallet's accounts whose payout is overdue: what waits, how to
// receive it, then the calls; and its receipt.

const key = (address: string): string => address.toLowerCase();
// The slippage of a swap after a claim: the swap's page's own default.
const MARGIN = 50n;

// What reached the owner in each claim of the page's own, from its Claimed events, at prices now once read: `prices`
// gives them, if read yet, and the line is written again when they are.
function claimReceipts(
  receipts: Receipt[],
  claims: Claim[],
  caller: Address,
  tokens: Map<string, Token>,
  prices: () => Prices | undefined,
): DocumentFragment {
  const fragment = document.createDocumentFragment();
  const words = (amounts: Amount[], sign = "") =>
    amounts.length
      ? sign +
        list(
          amounts.map(({ token, amount }) => {
            const known = tokens.get(key(token));
            return known ? `${figure(amount, known.decimals)} ${known.symbol}` : `${amount} of ${token}`;
          }),
        )
      : "Nothing";
  const found = claimedIn(
    receipts,
    claims.map(({ id }) => id),
    caller,
  );
  for (const { id, received, fees, paid } of found) {
    const receipt = clone("claim-receipt");
    fill(receipt, {
      "claim-receipt-id": `Account #${id}`,
      "claim-receipt-worth": () => {
        const read = prices();
        const value = read ? valueAt(received, tokens, read) : 0;
        return value > 0 ? money(moneyAt(value, read!), { cents: true }) : "";
      },
      "claim-receipt-claimed": words(received),
      "claim-receipt-fee": words(fees, "−"),
      "claim-receipt-paid": words(paid),
    });
    show(".claim-receipt-other", !received.length, receipt);
    fragment.append(receipt);
  }
  return fragment;
}

// A list of tokens, the largest at the prices first, if read: the first three, then the rest folded.
function tokenLines(
  list: Element,
  more: HTMLDetailsElement,
  amounts: { token: Address; amount: bigint }[],
  tokens: Map<string, Token>,
  prices: Prices | undefined,
): void {
  const value = (token: Address, amount: bigint) => (prices ? valueAt([{ token, amount }], tokens, prices) : 0);
  const sorted = [...amounts].sort((a, b) => value(b.token, b.amount) - value(a.token, a.amount));
  const line = ({ token, amount }: { token: Address; amount: bigint }) => {
    const item = clone("claim-token");
    const known = tokens.get(key(token));
    const worth = value(token, amount);
    fill(item, {
      "claim-symbol": known?.symbol ?? token,
      "claim-amount": known ? figure(amount, known.decimals) : String(amount),
      "claim-worth": worth > 0 ? () => money(moneyAt(worth, prices!), { cents: true }) : "",
    });
    return item;
  };
  list.replaceChildren(...sorted.slice(0, 3).map(line));
  const rest = sorted.slice(3);
  more.hidden = !rest.length;
  const restValue = rest.reduce((sum, { token, amount }) => sum + value(token, amount), 0);
  const summary = count(rest.length, "more token", "more tokens");
  fill(more, {
    "claim-more-summary": restValue > 0 ? () => `${summary}, ${money(moneyAt(restValue, prices!))}` : summary,
  });
  more.querySelector(".claim-rest")!.replaceChildren(...rest.map(line));
}

// The review of a claim for the wallet's overdue accounts in Double Espresso: what waits, then how to receive it, as it
// is or swapped into one token, then the calls. "As they are" is the default, so that nothing is sold unasked.
export async function openClaim(entries: Entry[], connection: Connection, hooks: Hooks): Promise<void> {
  const [{ claims, tokens }, found, caps, middles] = await Promise.all([
    owedOf(entries),
    costs().catch(() => undefined),
    capabilities(connection),
    // The tokens swaps pass through, which their routes name.
    describe([...MIDDLES, HYDX]).catch(() => new Map<string, Token>()),
  ]);
  for (const [address, token] of middles) if (!tokens.has(address)) tokens.set(address, token);
  const owing = claims.filter(({ owed }) => owed.length);
  const which = list(entries.map(({ account }) => `#${account.id}`));
  const name = `Claim for ${entries.length === 1 ? "Hydrex account" : "Hydrex accounts"} ${which}`;
  const checkHref = hrefOf({ view: "product", kind: "double-espresso", section: "check" });
  // Nothing to send: the review says why, and asks nothing.
  const nothing = (words: string) => {
    const body = document.createElement("p");
    body.textContent = words;
    const fragment = document.createDocumentFragment();
    fragment.append(body);
    openReview({ name, pages: [{ title: name, body: fragment }], steps: [], checkHref, connection, hooks });
  };
  if (!owing.length) return nothing("Nothing to claim: someone else may have just claimed it for you.");
  const totals = paidBy(owing.flatMap(({ owed }) => owed));
  const paid = totals.map(({ token, paid }) => ({ token, amount: paid }));
  // Each account's claim, in calls that fit a transaction, or small ones for a Safe to pack together, the most valuable
  // at last epoch's prices first, or at a stand-in's for a token without one, so that stopping halfway still claims the
  // most.
  const worth = ({ owed }: Claim) =>
    weightAt(
      owed.map(({ token, amount }) => ({ token, amount })),
      tokens,
      entries[0]!.earnings!.prices,
    );
  const budget = connection.wallet.propose ? SAFE_CLAIM_CALL_GAS : CLAIM_CALL_GAS;
  const calls = owing.flatMap((claim) => {
    const parts = claimCalls(claim, budget).sort((a, b) => worth(b) - worth(a));
    return parts.map((part) => ({ part, whole: parts.length === 1 }));
  });
  const claimSlips = calls.map(({ part, whole }) => claimSlip(part, tokens, whole));
  const simulated = await simulate(connection.address, claimSlips).catch(() => undefined);
  if (simulated?.some(({ ok }) => !ok)) return nothing("Base refused the claim. Someone else may be claiming now.");
  if (simulated?.some(({ gas }) => gas > MAX_CLAIM_GAS)) return nothing("This claim needs more gas than Base allows.");
  // More gas together than one transaction may use: the calls go one at a time, and a Safe proposes them in as few
  // Safe transactions as hold them, by the gas each used in the simulation, or else by its estimate.
  const gas = simulated?.map(({ gas }) => gas) ?? calls.map(({ part }) => claimGas(part.owed));
  const totalGas = gas.reduce((sum, one) => sum + one, 0n);
  const groups = claimTransactions(gas);
  const apart = groups.length > 1;
  const body = clone("claim-before");
  fill(body, { "claim-count": count(totals.length, "token", "tokens") });
  // What waits, and a swap of it, at prices now, as on the swap's page. The review opens at once, in tokens, and shows
  // them in money once read; without them, it stays in tokens, and swaps none.
  // Each found now: the review moves them out of `body` once it opens.
  const [earnedLine, feeLine, paidLine, gasLine, swapGasLine, swapGasRow] = [
    ".claim-earned",
    ".claim-fee",
    ".claim-paid",
    ".claim-gas",
    ".claim-gas-swap",
    ".claim-gas-swap-line",
  ].map((name) => body.querySelector<HTMLElement>(name)!) as [
    HTMLElement,
    HTMLElement,
    HTMLElement,
    HTMLElement,
    HTMLElement,
    HTMLElement,
  ];
  const [tokenList, more] = [
    body.querySelector(".claim-tokens")!,
    body.querySelector<HTMLDetailsElement>(".claim-more")!,
  ];
  // The prices, once read or failed; and the gas of the claim with the swap picked, while one is.
  let prices: Prices | undefined;
  let settled = false;
  let withSwap: bigint | undefined;
  // The claim's gas, as simulated or else as estimated, and with the swap: pending until the prices are read or failed;
  // without them, in the ETH that pays it, and without the gas price, in gas.
  const sayGas = () => {
    const of = (gas: bigint) => (): Text =>
      !settled ? PENDING : found ? gasWords(gas * found.gasPrice, prices) : `${gas.toLocaleString("en-GB")} gas`;
    live(gasLine, of(totalGas));
    swapGasRow.hidden = withSwap === undefined;
    if (withSwap !== undefined) live(swapGasLine, of(withSwap));
  };
  const drawPrices = () => {
    // To the cent, so that the bill lines up at the point; the fee as what lies between the two around it, as they
    // show, so that the bill adds up as it reads.
    const [earned, reaches] = [totals.map(({ token, earned }) => ({ token, amount: earned })), paid].map(
      (amounts) => prices && moneyAt(valueAt(amounts, tokens, prices), prices),
    );
    const worth = (sum: () => Money) => (): Text =>
      prices ? money(sum(), { cents: true }) : settled ? "Not read" : PENDING;
    live(
      earnedLine,
      worth(() => earned!),
    );
    live(
      feeLine,
      worth(() => between(earned!, reaches!)),
    );
    live(
      paidLine,
      worth(() => reaches!),
    );
    tokenLines(
      tokenList,
      more,
      totals.map(({ token, earned }) => ({ token, amount: earned })),
      tokens,
      prices,
    );
    sayGas();
  };
  drawPrices();
  const priced = pricesNow(
    [
      ...paid.flatMap(({ token }) => tokens.get(key(token)) ?? []),
      ...SWAPPERS.map(({ token, decimals, symbol }) => ({ address: token, decimals, symbol })),
    ],
    new Map(paid.map(({ token, amount }) => [key(token), amount])),
  ).then(
    (read) => {
      [prices, settled] = [read, true];
      drawPrices();
      // A claim's receipt drawn before they came.
      rewrite();
      return read;
    },
    (error: unknown) => {
      console.error(error);
      settled = true;
      drawPrices();
      return undefined;
    },
  );
  // The outputs, in a list to pick from, once swaps are on.
  const select = body.querySelector<HTMLSelectElement>(".claim-output")!;
  select.replaceChildren(
    ...(swapsOff() ? [] : SWAPPERS).map((swapper) => {
      const option = document.createElement("option");
      option.value = swapper.output;
      option.textContent = swapper.symbol;
      option.selected = swapper.output === DEFAULT_OUTPUT;
      return option;
    }),
  );
  const into = body.querySelector<HTMLElement>(".claim-into")!;
  const radios = [...body.querySelectorAll<HTMLInputElement>('input[name="receive"]')];
  // What the claims paid, from their events, token by token: what a swap after them may sell.
  const brought = (receipts: Receipt[]): Amount[] =>
    summed(
      claimedIn(
        receipts,
        owing.map(({ id }) => id),
        connection.address,
      ).flatMap(({ paid }) => paid),
    );
  const asTheyAre = async (receipts: Receipt[]) => {
    // At once, in tokens, then in money once the prices come.
    const fragment = claimReceipts(receipts, owing, connection.address, tokens, () => prices);
    const next = clone("claim-next");
    next.querySelector(".claim-swap-next")!.remove();
    next.querySelector(".claim-swap-failed")!.remove();
    const came = brought(receipts);
    const these = next.querySelector<HTMLElement>(".claim-swap-these")!;
    if (!came.length) these.remove();
    else these.addEventListener("click", () => prefill(came));
    fragment.append(next);
    return fragment;
  };
  const opened = openReview({
    name,
    pages: [{ title: "What waits", body }, {}],
    steps: claimSlips,
    checkHref,
    connection,
    hooks,
    outcomeOf: asTheyAre,
    ...(apart ? { groups } : {}),
  });
  // Swapped into one token: the claim brings exact amounts, known before, so the page approves each for exactly that,
  // and the swap sells "my balance, up to the allowance". With batching, or from a Safe, all in one prompt; otherwise
  // the claim first, then the swap's own review. Only all or nothing: should the claim fail, a swap of "my balance"
  // would sell tokens the wallet held before. And only if the claim leaves room in the transaction for the swap.
  const together = (caps.atomic || !!connection.wallet.propose) && !apart;
  let planned = 0;
  const intoChosen = () => radios.find(({ checked }) => checked)?.value === "into";
  // A swap into one token, planned anew for each token picked: pending until planned. One that fails says so, and the
  // claim comes as it is.
  const plan = (swapper: Swapper): void => {
    const id = ++planned;
    planInto(swapper, id).catch((error: unknown) => {
      console.error(error);
      if (id !== planned) return;
      setText(into, "Not read: they come as they are.");
      withSwap = undefined;
      sayGas();
      opened.replace(claimSlips, { outcomeOf: asTheyAre });
    });
  };
  const planInto = async (swapper: Swapper, id: number): Promise<void> => {
    setText(into, PENDING);
    withSwap = undefined;
    sayGas();
    const gasValue = () => 0n;
    const [routes, current] = await Promise.all([
      Promise.all(
        paid.map(async ({ token, amount }) =>
          same(token, swapper.token)
            ? undefined
            : findRoute(token, amount, swapper, true, gasValue).catch(() => undefined),
        ),
      ),
      priced,
    ]);
    if (id !== planned) return;
    const outputPrice = current?.of.get(key(swapper.token));
    // Only tokens whose quote clears their gas twice over are swapped; the others stay as they are.
    const items: Plan["items"] = [];
    const left: string[] = [];
    paid.forEach(({ token, amount }, i) => {
      const route = routes[i];
      if (same(token, swapper.token)) return;
      // At prices now: what the quote fetches, or else the token itself.
      const price = current?.of.get(key(token));
      const known = tokens.get(key(token));
      const worth = !route
        ? undefined
        : outputPrice !== undefined
          ? worthOf(route.out, swapper.decimals, outputPrice)
          : price !== undefined && known
            ? worthOf(amount, known.decimals, price)
            : undefined;
      const cost = found ? (gasCost(route ? route.gas + APPROVAL_GAS : 0n, found, current)?.value ?? 0) : 0;
      if (!route || worth === undefined || worth < 2 * cost)
        return void left.push(tokens.get(key(token))?.symbol ?? token);
      items.push({
        token: tokens.get(key(token))!,
        route: { ...route.route, amount: maxUint256, minPaid: minimumOf(route.out, MARGIN) },
        out: route.out,
        allowance: 0n,
        approve: amount,
      });
    });
    const kept = paid.find(({ token }) => same(token, swapper.token))?.amount ?? 0n;
    const sayInto = (these: Plan["items"]) => {
      const out = kept + these.reduce((sum, { out }) => sum + paidOf(out), 0n);
      const least = kept + these.reduce((sum, { route }) => sum + route.minPaid, 0n);
      const swappedNames = these.map(({ token }) => token.symbol);
      setText(
        into,
        these.length
          ? `${figure(out, swapper.decimals)} ${swapper.symbol}, at least ${figure(least, swapper.decimals)}, from ${list(swappedNames)}${left.length ? `; ${count(left.length, "token", "tokens")} kept` : ""}`
          : `None worth swapping into ${swapper.symbol}`,
      );
    };
    sayInto(items);
    const chosen = intoChosen();
    if (!items.length || !chosen) {
      if (chosen) opened.replace(claimSlips, { outcomeOf: asTheyAre });
      return;
    }
    const swapPlan: Plan = { swapper, items, margin: MARGIN };
    if (!together) {
      // The claim first; its receipt then opens the swap's own review, for the amounts it brought.
      opened.replace(claimSlips, {
        outcomeOf: (receipts) => {
          const fragment = claimReceipts(receipts, owing, connection.address, tokens, () => current);
          const next = clone("claim-next");
          next.querySelector(".claim-swap-these")!.remove();
          const button = next.querySelector<HTMLButtonElement>(".claim-swap-next")!;
          const refused = next.querySelector<HTMLElement>(".claim-swap-failed")!;
          button.textContent = `Review the swap into ${swapper.symbol}`;
          // For what the claims brought, as their events say, not what the page expected: someone else may have
          // claimed some first, of a token from some of its reward contracts and not others.
          const came = brought(receipts);
          const exact: Plan = {
            swapper,
            margin: MARGIN,
            items: items.flatMap(({ approve = 0n, ...item }) => {
              const amount = came.find(({ token }) => same(token, item.token.address))?.amount;
              return amount ? [partOf(item, amount, approve)] : [];
            }),
          };
          if (!exact.items.length) button.remove();
          button.addEventListener("click", () => {
            refused.hidden = true;
            void openSwapReview(exact, connection, tokens, found, current).then((reason) => {
              if (!reason) return;
              refused.textContent = reason;
              refused.hidden = false;
            }, console.error);
          });
          fragment.append(next);
          return Promise.resolve(fragment);
        },
      });
      return;
    }
    // Run through Base first with no minimums, after the claims: each route then fetches what the pools those before it
    // moved pay, which sets its minimum. A token whose route would not go through even so is kept.
    const zeroed = swapPlan.items.map((item) => ({ ...item, route: { ...item.route, minPaid: 0n } }));
    const tried = await planSteps({ ...swapPlan, items: zeroed }, connection, tokens, true);
    if (id !== planned) return;
    const trial = await simulate(connection.address, [...claimSlips, ...tried.slips]).catch(() => undefined);
    if (id !== planned) return;
    // Only once Base answered for every call and ran them all: otherwise the check below says whether both go together.
    const results = routeResults(trial, claimSlips.length + tried.approvals.length, tried.swaps);
    if (results && trial!.every(({ ok }) => ok)) {
      const going = zeroed.flatMap((item) => {
        const result = results.get(item.route);
        if (result?.done && result.amountOut > 0n)
          return [
            { ...item, out: result.amountOut, route: { ...item.route, minPaid: minimumOf(result.amountOut, MARGIN) } },
          ];
        left.push(item.token.symbol);
        return [];
      });
      swapPlan.items = going;
      sayInto(going);
      if (!going.length) return opened.replace(claimSlips, { outcomeOf: asTheyAre });
    }
    const { slips } = await planSteps(swapPlan, connection, tokens, true);
    if (id !== planned) return;
    const all = [...claimSlips, ...slips];
    const run = await simulate(connection.address, all).catch(() => undefined);
    if (id !== planned) return;
    if (run?.some(({ ok }) => !ok) || (run?.reduce((sum, { gas }) => sum + gas, 0n) ?? 0n) > MAX_CLAIM_GAS) {
      setText(into, "Base refused both together: they come as they are.");
      return opened.replace(claimSlips, { outcomeOf: asTheyAre });
    }
    // Picked "As they are" meanwhile: the line says what the swap would fetch, and the claim stays as it is.
    if (!intoChosen()) return;
    if (run) {
      withSwap = run.reduce((sum, { gas }) => sum + gas, 0n);
      sayGas();
    }
    opened.replace(all, {
      atomic: true,
      outcomeOf: (receipts) => {
        const fragment = claimReceipts(receipts, owing, connection.address, tokens, () => current);
        fragment.append(swapReceipt(receipts, swapPlan, tokens, connection.address, current));
        return Promise.resolve(fragment);
      },
    });
  };
  // "As they are" leaves a plan under way to say what the swap would fetch, without taking it.
  const choose = () => {
    if (intoChosen()) plan(swapperOf(select.value)!);
    else {
      withSwap = undefined;
      sayGas();
      opened.replace(claimSlips, { outcomeOf: asTheyAre });
    }
  };
  for (const radio of radios) radio.addEventListener("change", choose);
  select.addEventListener("change", () => {
    radios.find(({ value }) => value === "into")!.checked = true;
    choose();
  });
  // While swaps are off, the swap is not offered; nor from a Safe whose claim takes several Safe transactions, as the
  // swap follows the claim's receipts, which the Safe's owners bring once they sign.
  const safeApart = apart && !!connection.wallet.propose;
  if (!select.options.length || safeApart) {
    radios.find(({ value }) => value === "into")!.disabled = select.disabled = true;
    setText(into, safeApart ? "Swap them once the claims go through." : "Swaps are off.");
  } else plan(swapperOf(select.value)!);
}
