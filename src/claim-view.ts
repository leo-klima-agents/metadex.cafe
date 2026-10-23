import { maxUint256, type Address } from "viem";
import { same, type Receipt } from "./chain.ts";
import { DEFAULT_OUTPUT, HYDX, SWAPPERS, swapperOf, type Swapper } from "./config.ts";
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
  type Claim,
} from "./claim.ts";
import { clone, fill, show } from "./dom.ts";
import { count, figure, list, usd } from "./format.ts";
import type { Entry } from "./last-payout.ts";
import { pricesNow, usdOf, type Token } from "./prices.ts";
import { dollars, type Amount } from "./receipts.ts";
import { openReview, type Hooks } from "./review.ts";
import { hrefOf } from "./routes.ts";
import { APPROVAL_GAS, MIDDLES, findRoute, minimumOf, paidOf, simulate } from "./swap.ts";
import { costs, gasUsd } from "./swap-calls.ts";
import { openSwapReview, outputOff, planSteps, prefill, swapReceipt, swappersChecked, type Plan } from "./swap-view.ts";
import { describe } from "./tokens.ts";
import { capabilities, type Connection } from "./wallet.ts";

// The review of a claim through AutoMaxi, for the wallet's accounts whose payout is overdue: what waits, how to receive
// it, then the calls; and its receipt.

const key = (address: string): string => address.toLowerCase();

// What reached the owner in each claim of the page's own, from its Claimed events.
function claimReceipts(
  receipts: Receipt[],
  claims: Claim[],
  caller: Address,
  tokens: Map<string, Token>,
  prices: Map<string, number>,
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
    const value = dollars(received, tokens, prices);
    fill(receipt, {
      "claim-receipt-id": `#${id}`,
      "claim-receipt-usd": value > 0 ? usd(value) : "",
      "claim-receipt-claimed": words(received),
      "claim-receipt-fee": words(fees, "−"),
      "claim-receipt-paid": words(paid),
    });
    show(".claim-receipt-keeper", !received.length, receipt);
    fragment.append(receipt);
  }
  return fragment;
}

// A list of tokens, the largest in dollars first: the first three, then the rest folded.
function tokenLines(
  body: DocumentFragment,
  amounts: { token: Address; amount: bigint }[],
  tokens: Map<string, Token>,
  prices: Map<string, number>,
): void {
  const value = (token: Address, amount: bigint) => dollars([{ token, amount }], tokens, prices);
  const sorted = [...amounts].sort((a, b) => value(b.token, b.amount) - value(a.token, a.amount));
  const line = ({ token, amount }: { token: Address; amount: bigint }) => {
    const item = clone("claim-token");
    const known = tokens.get(key(token));
    const dollars = value(token, amount);
    fill(item, {
      "claim-symbol": known?.symbol ?? token,
      "claim-amount": known ? figure(amount, known.decimals) : String(amount),
      "claim-usd": dollars > 0 ? usd(dollars) : "",
    });
    return item;
  };
  body.querySelector(".claim-tokens")!.replaceChildren(...sorted.slice(0, 3).map(line));
  const rest = sorted.slice(3);
  const more = body.querySelector<HTMLDetailsElement>(".claim-more")!;
  more.hidden = !rest.length;
  const restValue = rest.reduce((sum, { token, amount }) => sum + value(token, amount), 0);
  fill(more, {
    "claim-more-summary": `${count(rest.length, "more token", "more tokens")}${restValue > 0 ? `, ${usd(restValue)}` : ""}`,
  });
  more.querySelector(".claim-rest")!.replaceChildren(...rest.map(line));
}

// The review of a claim for the wallet's overdue accounts in AutoMaxi: what waits, then how to receive it, as it is or
// swapped into one token, then the calls. "As they are" is the default, so that nothing is sold unasked.
export async function openClaim(entries: Entry[], connection: Connection, hooks: Hooks): Promise<void> {
  const [{ claims, tokens }, found, caps, middles] = await Promise.all([
    owedOf(entries),
    costs().catch(() => undefined),
    capabilities(connection),
    // The tokens swaps pass through, which their routes name.
    describe([...MIDDLES, HYDX]).catch(() => new Map<string, Token>()),
  ]);
  for (const [address, token] of middles) if (!tokens.has(address)) tokens.set(address, token);
  const prices = entries[0]!.earnings!.prices;
  const owing = claims.filter(({ owed }) => owed.length);
  const which = list(entries.map(({ account }) => `#${account.id}`));
  const name = `Claim for ${which}`;
  const checkHref = hrefOf({ view: "product", kind: "automaxi", section: "check" });
  // Nothing to send: the review says why, and asks nothing.
  const nothing = (words: string) => {
    const body = document.createElement("p");
    body.textContent = words;
    const fragment = document.createDocumentFragment();
    fragment.append(body);
    openReview({ name, pages: [{ title: name, body: fragment }], steps: [], checkHref, connection, hooks });
  };
  if (!owing.length) return nothing("Nothing to claim: the keeper may have just claimed it.");
  // Each account's claim, in calls that fit a transaction, or small ones for a Safe to pack together, the most valuable
  // first, so that stopping halfway still claims the most.
  const worth = ({ owed }: Claim) =>
    dollars(
      owed.map(({ token, amount }) => ({ token, amount })),
      tokens,
      prices,
    );
  const budget = connection.wallet.propose ? SAFE_CLAIM_CALL_GAS : CLAIM_CALL_GAS;
  const calls = owing.flatMap((claim) => {
    const parts = claimCalls(claim, budget).sort((a, b) => worth(b) - worth(a));
    return parts.map((part) => ({ part, whole: parts.length === 1 }));
  });
  const claimSlips = calls.map(({ part, whole }) => claimSlip(part, tokens, whole));
  const simulated = await simulate(connection.address, claimSlips).catch(() => undefined);
  if (simulated?.some(({ ok }) => !ok)) return nothing("Base refused the claim. The keeper may be claiming now.");
  if (simulated?.some(({ gas }) => gas > MAX_CLAIM_GAS)) return nothing("This claim needs more gas than Base allows.");
  // More gas together than one transaction may use: the calls go one at a time, and a Safe proposes them in as few
  // Safe transactions as hold them, by the gas each used in the simulation, or else by its estimate.
  const gas = simulated?.map(({ gas }) => gas) ?? calls.map(({ part }) => claimGas(part.owed));
  const totalGas = gas.reduce((sum, one) => sum + one, 0n);
  const groups = claimTransactions(gas);
  const apart = groups.length > 1;
  const totals = paidBy(owing.flatMap(({ owed }) => owed));
  const paid = totals.map(({ token, paid }) => ({ token, amount: paid }));
  // A swap is judged at prices now, as on the swap's page; what waits, at last epoch's.
  let pricedNow: Promise<Map<string, number>> | undefined;
  const currentPrices = () =>
    (pricedNow ??= pricesNow(
      [
        ...paid.flatMap(({ token }) => tokens.get(key(token)) ?? []),
        ...SWAPPERS.map(({ token, decimals, symbol }) => ({ address: token, decimals, symbol })),
      ],
      new Map(paid.map(({ token, amount }) => [key(token), amount])),
    ).catch(() => new Map<string, number>()));
  const body = clone("claim-before");
  fill(body, {
    "claim-earned": usd(
      dollars(
        totals.map(({ token, earned }) => ({ token, amount: earned })),
        tokens,
        prices,
      ),
    ),
    "claim-fee": `−${usd(
      dollars(
        totals.map(({ token, fee }) => ({ token, amount: fee })),
        tokens,
        prices,
      ),
    )}`,
    "claim-paid": usd(dollars(paid, tokens, prices)),
    "claim-count": count(totals.length, "token", "tokens"),
  });
  tokenLines(
    body,
    totals.map(({ token, earned }) => ({ token, amount: earned })),
    tokens,
    prices,
  );
  const claimUsd = simulated && found ? gasUsd(totalGas, found) : undefined;
  const gasLine = body.querySelector(".claim-gas")!;
  const sayGas = (withSwap?: number) =>
    (gasLine.textContent = `Gas ${claimUsd === undefined ? "…" : usd(claimUsd)}${withSwap === undefined ? "" : `, ${usd(withSwap)} with the swap`}`);
  sayGas();
  // The outputs whose checks passed, in a list to pick from.
  const select = body.querySelector<HTMLSelectElement>(".claim-output")!;
  select.replaceChildren(
    ...SWAPPERS.filter((swapper) => !outputOff(swapper)).map((swapper) => {
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
  const brought = (receipts: Receipt[]): Amount[] => {
    const all = new Map<string, Amount>();
    const ids = owing.map(({ id }) => id);
    for (const { token, amount } of claimedIn(receipts, ids, connection.address).flatMap(({ paid }) => paid)) {
      all.set(key(token), { token, amount: (all.get(key(token))?.amount ?? 0n) + amount });
    }
    return [...all.values()];
  };
  const asTheyAre = (receipts: Receipt[]) => {
    const fragment = claimReceipts(receipts, owing, connection.address, tokens, prices);
    const next = clone("claim-next");
    next.querySelector(".claim-swap-next")!.remove();
    next.querySelector(".claim-swap-failed")!.remove();
    const came = brought(receipts);
    const these = next.querySelector<HTMLElement>(".claim-swap-these")!;
    if (!came.length) these.remove();
    else these.addEventListener("click", () => prefill(came));
    fragment.append(next);
    return Promise.resolve(fragment);
  };
  const opened = openReview({
    name,
    pages: [{ title: "What waits", body }, { title: "What your wallet will ask" }],
    steps: claimSlips,
    checkHref,
    connection,
    hooks,
    outcomeOf: asTheyAre,
    ...(apart ? { groups } : {}),
  });
  // Swapped into one token: the claim brings exact amounts, known before, so the page approves each for exactly that,
  // and the swap sells "my balance, up to the allowance". With batching, or from a Safe, all in one prompt; otherwise
  // the claim first, then the swap's own review.
  // Only all or nothing: should the claim fail, a swap of "my balance" would sell tokens the wallet held before. And only
  // if the claim leaves room in the transaction for the swap.
  const together = (caps.atomic || !!connection.wallet.propose) && !apart;
  let planned = 0;
  const plan = async (swapper: Swapper): Promise<void> => {
    const id = ++planned;
    into.textContent = "…";
    const gasValue = () => 0n;
    const [current, routes] = await Promise.all([
      currentPrices(),
      Promise.all(
        paid.map(async ({ token, amount }) =>
          same(token, swapper.token)
            ? undefined
            : findRoute(token, amount, swapper, true, gasValue).catch(() => undefined),
        ),
      ),
    ]);
    if (id !== planned) return;
    const outputPrice = current.get(key(swapper.token));
    // Only tokens whose quote clears their gas twice over are swapped; the others stay as they are.
    const items: Plan["items"] = [];
    const left: string[] = [];
    paid.forEach(({ token, amount }, i) => {
      const route = routes[i];
      if (same(token, swapper.token)) return;
      // In dollars now: what the quote fetches, or else the token itself.
      const price = current.get(key(token));
      const known = tokens.get(key(token));
      const worth = !route
        ? undefined
        : outputPrice !== undefined
          ? usdOf(route.out, swapper.decimals, outputPrice)
          : price !== undefined && known
            ? usdOf(amount, known.decimals, price)
            : undefined;
      const cost = found ? (gasUsd(route ? route.gas + APPROVAL_GAS : 0n, found) ?? 0) : 0;
      if (!route || worth === undefined || worth < 2 * cost)
        return void left.push(tokens.get(key(token))?.symbol ?? token);
      items.push({
        token: tokens.get(key(token))!,
        route: { ...route.route, amount: maxUint256, minPaid: minimumOf(route.out, 50n) },
        out: route.out,
        allowance: 0n,
        approve: amount,
      });
    });
    const kept = paid.find(({ token }) => same(token, swapper.token))?.amount ?? 0n;
    const out = kept + items.reduce((sum, { out }) => sum + paidOf(out), 0n);
    const least = kept + items.reduce((sum, { route }) => sum + route.minPaid, 0n);
    const swappedNames = items.map(({ token }) => token.symbol);
    into.textContent = items.length
      ? `≈ ${figure(out, swapper.decimals)} ${swapper.symbol}, at least ${figure(least, swapper.decimals)}, from ${list(swappedNames)}${left.length ? `; ${count(left.length, "token", "tokens")} kept` : ""}`
      : `None worth swapping into ${swapper.symbol}`;
    const chosen = radios.find(({ checked }) => checked)?.value === "into";
    if (!items.length || !chosen) {
      if (chosen) opened.replace(claimSlips, { outcomeOf: asTheyAre });
      return;
    }
    const swapPlan: Plan = { swapper, items };
    if (!together) {
      // The claim first; its receipt then opens the swap's own review, for the amounts it brought.
      opened.replace(claimSlips, {
        outcomeOf: (receipts) => {
          const fragment = claimReceipts(receipts, owing, connection.address, tokens, prices);
          const next = clone("claim-next");
          next.querySelector(".claim-swap-these")!.remove();
          const button = next.querySelector<HTMLButtonElement>(".claim-swap-next")!;
          const refused = next.querySelector<HTMLElement>(".claim-swap-failed")!;
          button.textContent = `Review the swap into ${swapper.symbol}`;
          // For what the claims brought, as their events say, not what the page expected: the keeper may have
          // claimed some first.
          const came = brought(receipts);
          const exact: Plan = {
            swapper,
            items: items.flatMap(({ approve: _, route, ...item }) => {
              const amount = came.find(({ token }) => same(token, item.token.address))?.amount;
              return amount ? [{ ...item, route: { ...route, amount } }] : [];
            }),
          };
          if (!exact.items.length) button.remove();
          button.addEventListener("click", () => {
            refused.hidden = true;
            void openSwapReview(exact, connection, tokens, found).then((reason) => {
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
    const { slips } = await planSteps(swapPlan, connection, tokens, true);
    if (id !== planned) return;
    const all = [...claimSlips, ...slips];
    const run = await simulate(connection.address, all).catch(() => undefined);
    if (id !== planned) return;
    if (run?.some(({ ok }) => !ok) || (run?.reduce((sum, { gas }) => sum + gas, 0n) ?? 0n) > MAX_CLAIM_GAS) {
      into.textContent = "Base refused both together: they come as they are.";
      return opened.replace(claimSlips, { outcomeOf: asTheyAre });
    }
    if (run && found)
      sayGas(
        gasUsd(
          run.reduce((sum, { gas }) => sum + gas, 0n),
          found,
        ),
      );
    opened.replace(all, {
      atomic: true,
      outcomeOf: (receipts) => {
        const fragment = claimReceipts(receipts, owing, connection.address, tokens, prices);
        fragment.append(swapReceipt(receipts, swapPlan, tokens, connection.address));
        return Promise.resolve(fragment);
      },
    });
  };
  const choose = () => {
    const chosen = radios.find(({ checked }) => checked)?.value;
    if (chosen === "into") void plan(swapperOf(select.value)!);
    else {
      planned++;
      opened.replace(claimSlips, { outcomeOf: asTheyAre });
    }
  };
  for (const radio of radios) radio.addEventListener("change", choose);
  select.addEventListener("change", () => {
    radios.find(({ value }) => value === "into")!.checked = true;
    choose();
  });
  // Without an output whose checks passed, the swap is not offered; nor from a Safe whose claim takes several Safe
  // transactions, as the swap follows the claim's receipts, which the Safe's owners bring once they sign.
  const safeApart = apart && !!connection.wallet.propose;
  if (!select.options.length || safeApart) {
    radios.find(({ value }) => value === "into")!.disabled = select.disabled = true;
    into.textContent = safeApart
      ? "Swap them once the claims go through."
      : swappersChecked()
        ? "Swaps are off."
        : "Swappers not checked yet.";
  } else void plan(swapperOf(select.value)!);
}
