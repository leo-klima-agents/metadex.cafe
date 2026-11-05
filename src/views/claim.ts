import type { Address } from "viem";
import * as claim from "../claim.ts";
import { DEFAULT_OUTPUT, HYDX, SWAPPERS, swapperOf, type Swapper } from "../config.ts";
import { checksRead, swapsOff } from "../checks.ts";
import { count, figure, listWords, money, moneyAt } from "../format.ts";
import { summed, valueAt, type Overdue } from "../payouts.ts";
import { gasWords, key, pricesNow, quotesOf, type Prices, type Token } from "../prices.ts";
import { hrefOf } from "../routes.ts";
import { costsRead, now, same, simulate, type Costs, type Landed } from "../rpc.ts";
import { actions, render, state } from "../state.ts";
import * as swap from "../swap.ts";
import { describe, type Amount } from "../tokens.ts";
import { $, fill, frag, fromTemplate, list, type Value } from "../ui.ts";
import { capabilities, type Slip } from "../wallet.ts";
import { claimReceipt } from "./account.ts";
import { openReview } from "./review.ts";
import { reviewSwap, swapLink, swapReceipt } from "./swap.ts";

type Claiming = {
  // The calls. With `sending`, they are encoded to be sent, with a fresh deadline.
  steps: (sending?: boolean) => Slip[];
  outcome: (receipts: Landed[]) => Promise<Node | undefined>;
  into: Value;
  gasWithSwap?: bigint | undefined;
  planned: number;
  // Whether the swap is being routed. The review waits for it, because routing changes the calls.
  planning: boolean;
};
let claiming: Claiming | undefined;
const MARGIN = 50n;

export async function openClaim(entries: Overdue[]): Promise<void> {
  const connection = state.connection!;
  const name = `Claim for ${entries.length === 1 ? "Hydrex account" : "Hydrex accounts"} ${listWords(entries.map(({ account }) => `#${account.id}`))}`;
  const checkHref = hrefOf({ view: "product", kind: "double-espresso", section: "check" });
  const nothing = (words: string) =>
    openReview({
      name,
      pages: [{ title: name, body: Object.assign(document.createElement("p"), { textContent: words }) }],
      steps: () => [],
      checkHref,
    });
  const unanswered = "Base did not say what waits: try again in a moment.";
  // `checksRead()` is awaited though its result is unused: swaps wait for the checks, which say whether the RPCs serve
  // Base.
  const [owed, gasCosts, caps, middles] = await Promise.all([
    claim.owedOf(entries).catch((error: unknown) => void console.error(error)),
    costsRead().catch(() => undefined),
    capabilities(connection),
    describe([...swap.MIDDLES, HYDX]).catch(() => new Map<string, Token>()),
    checksRead().catch(() => undefined),
  ]);
  if (!owed) return nothing(unanswered);
  const { claims, tokens, unread } = owed;
  const deadline = () => BigInt(now() + (connection.wallet.propose ? 86_400 : 1_800));
  for (const [address, token] of middles) if (!tokens.has(address)) tokens.set(address, token);
  const owing = claims.filter(({ owed }) => owed.length);
  if (!owing.length)
    return nothing(unread ? unanswered : "Nothing to claim: someone else may have just claimed it for you.");

  const totals = claim.paidBy(owing.flatMap(({ owed }) => owed));
  const paid = totals.map(({ token, paid }) => ({ token, amount: paid }));
  const owedTokens = owing.flatMap(({ owed }) => owed.flatMap(({ token }) => tokens.get(key(token)) ?? []));
  const quotes = await quotesOf(owedTokens);
  const weight = ({ owed }: claim.Claim) => valueAt(owed, tokens, quotes);
  const budget = connection.wallet.propose ? claim.SAFE_CLAIM_CALL_GAS : claim.CLAIM_CALL_GAS;
  const parts = owing.flatMap((each) => {
    const split = claim.claimCalls(each, budget).sort((a, b) => weight(b) - weight(a));
    return split.map((part) => ({ part, whole: split.length === 1 }));
  });
  const calls = parts.map(({ part, whole }) => claim.claimSlip(part, tokens, whole));
  const simulated = await simulate(connection.address, calls).catch(() => undefined);
  if (simulated?.some(({ ok }) => !ok)) return nothing("Base refused the claim. Someone else may be claiming now.");
  if (simulated?.some(({ gas }) => gas > claim.MAX_CLAIM_GAS))
    return nothing("This claim needs more gas than Base allows.");
  const gas = simulated?.map(({ gas }) => gas) ?? parts.map(({ part }) => claim.claimGas(part.owed));
  const groups = claim.claimTransactions(gas);
  const apart = groups.length > 1;
  const together = (caps.atomic || !!connection.wallet.propose) && !apart;
  const totalGas = gas.reduce((sum, one) => sum + one, 0n);

  const body = fromTemplate("claim-review");
  if (unread)
    body.prepend(
      Object.assign(document.createElement("p"), {
        className: "Notice",
        textContent: `Base did not say what ${count(unread, "reward contract owes", "reward contracts owe")}: it is left out, to claim later.`,
      }),
    );
  let prices: Prices | undefined;
  let settled = false;
  const ids = owing.map(({ id }) => id);
  const brought = (receipts: Landed[]): Amount[] =>
    summed(claim.claimedIn(receipts, ids, connection.address).flatMap(({ paid }) => paid));
  const asTheyAre = async (receipts: Landed[]) =>
    frag(...claimReceipts(receipts, ids, tokens, prices, connection.address), swapThese(brought(receipts)));
  const current: Claiming = { steps: () => calls, outcome: asTheyAre, into: "", planned: 0, planning: false };
  claiming = current;

  const draw = () => {
    if (claiming !== current) return;
    const value = (amounts: Amount[]) =>
      prices ? money(moneyAt(valueAt(amounts, tokens, prices), prices), true) : settled ? "Not read" : undefined;
    const earned = totals.map(({ token, earned }) => ({ token, amount: earned }));
    const fees = totals.map(({ token, fee }) => ({ token, amount: fee }));
    const gasOf = (units: bigint) =>
      gasCosts ? gasWords(units * gasCosts.gasPrice, prices) : `${units.toLocaleString("en-GB")} gas`;
    const lines = [...earned].sort((a, b) =>
      prices ? valueAt([b], tokens, prices) - valueAt([a], tokens, prices) : 0,
    );
    list(
      $("[data-list=line]", body),
      lines,
      ({ token }) => token,
      (li, { token, amount }) => {
        const known = tokens.get(key(token));
        const worth = prices ? valueAt([{ token, amount }], tokens, prices) : 0;
        fill(li, {
          symbol: known?.symbol ?? token,
          amount: known ? figure(amount, known.decimals) : String(amount),
          value: worth > 0 ? money(moneyAt(worth, prices!), true) : "",
          worth: null,
          route: null,
          note: null,
        });
      },
    );
    list(
      $("[data-list=sum]", body),
      [
        ["Earned", value(earned)],
        ["Fee 1%", value(fees)],
      ] satisfies [string, Value][],
      ([label]) => label,
      (row, [label, worth]) => fill(row, { label, value: worth, detail: null }),
    );
    fill(body, {
      paid: value(paid),
      count: count(totals.length, "token", "tokens"),
      into: current.into,
      gas: `Gas ${gasOf(totalGas)}${current.gasWithSwap === undefined ? "" : `, ${gasOf(current.gasWithSwap)} with the swap`}`,
    });
    render();
  };
  // No swap while swaps are off, nor from a Safe whose claim takes several transactions: the swap needs the claim's
  // receipts, which come only once the owners sign.
  const options = swapsOff() !== false ? [] : SWAPPERS;
  list(
    $("[data-list=option]", body),
    options,
    ({ output }) => output,
    (option, swapper) => {
      (option as HTMLOptionElement).value = swapper.output;
      (option as HTMLOptionElement).selected = swapper.output === DEFAULT_OUTPUT;
      fill(option, { symbol: swapper.symbol });
    },
  );
  const into = body.querySelector<HTMLInputElement>('input[value="into"]')!;
  const select = body.querySelector<HTMLSelectElement>("select")!;
  const safeApart = apart && !!connection.wallet.propose;
  into.disabled = select.disabled = !options.length || safeApart;
  if (into.disabled) current.into = safeApart ? "Swap them once the claims go through." : "Swaps are off.";

  const planInto = async (swapper: Swapper, id: number) => {
    current.into = undefined;
    current.gasWithSwap = undefined;
    draw();
    const { plan: sale, left } = await swap.saleOf(paid, swapper, tokens, prices, gasCosts?.gasPrice, MARGIN);
    if (id !== current.planned) return;
    const kept = paid.find(({ token }) => same(token, swapper.token))?.amount ?? 0n;
    const sayInto = (these: swap.Item[]) => {
      const out = kept + these.reduce((sum, { out }) => sum + swap.paidOf(out), 0n);
      const least = kept + these.reduce((sum, { route }) => sum + route.minPaid, 0n);
      current.into = these.length
        ? `${figure(out, swapper.decimals)} ${swapper.symbol}, at least ${figure(least, swapper.decimals)}, from ${listWords(these.map(({ token }) => token.symbol))}${left.length ? `; ${count(left.length, "token", "tokens")} kept` : ""}`
        : `None worth swapping into ${swapper.symbol}`;
    };
    sayInto(sale.items);
    if (!sale.items.length) return draw();
    // When the claim and swap can't go together, the claim goes first, and its Done page then offers to swap what it
    // brought, if the visitor chose a swap.
    if (!together) {
      if (into.checked)
        current.outcome = async (receipts) =>
          frag(
            ...claimReceipts(receipts, ids, tokens, prices, connection.address),
            swapLater(brought(receipts), sale, tokens, prices, gasCosts),
          );
      return draw();
    }
    let at = deadline();
    const run = await swap.simulatePlan(connection.address, calls, sale, tokens, at, true);
    if (id !== current.planned) return;
    if (!run || run.refused !== undefined || run.gas > claim.MAX_CLAIM_GAS) {
      current.into = "Base refused both together: they come as they are.";
      current.steps = () => calls;
      current.outcome = asTheyAre;
      return draw();
    }
    const going = {
      ...sale,
      items: swap
        .withMinimums(sale, run.results)
        .flatMap(({ item, reason }) => (reason ? (left.push(item.token.symbol), []) : [item])),
    };
    sayInto(going.items);
    if (!going.items.length) return draw();
    if (into.checked) {
      current.steps = (sending) => [
        ...calls,
        ...swap.planSteps(going, tokens, sending ? (at = deadline()) : at, undefined, true).slips,
      ];
      current.gasWithSwap = run.gas;
      current.outcome = async (receipts) =>
        frag(
          ...claimReceipts(receipts, ids, tokens, prices, connection.address),
          swapReceipt(receipts, going, tokens, prices, new Map(), connection.address),
        );
    }
    draw();
  };
  const plan = async (swapper: Swapper) => {
    const id = ++current.planned;
    current.planning = true;
    try {
      await planInto(swapper, id);
    } finally {
      if (id === current.planned) {
        current.planning = false;
        draw();
      }
    }
  };
  const choose = () => {
    if (claiming !== current) return;
    const chosen = into.checked;
    current.steps = () => calls;
    current.outcome = asTheyAre;
    current.gasWithSwap = undefined;
    if (chosen && !into.disabled)
      void plan(swapperOf(select.value)!).catch((error: unknown) => {
        console.error(error);
        current.into = "Not read: they come as they are.";
        draw();
      });
    else draw();
  };
  actions.receive = choose;
  actions["receive-output"] = () => {
    into.checked = true;
    choose();
  };
  void pricesNow(
    [
      ...paid.flatMap(({ token }) => tokens.get(key(token)) ?? []),
      ...SWAPPERS.map(({ token, decimals, symbol }) => ({ address: token, decimals, symbol })),
    ],
    new Map(paid.map(({ token, amount }) => [key(token), amount])),
  )
    .then(
      (found) => ([prices, settled] = [found, true]),
      () => (settled = true),
    )
    .finally(() => {
      draw();
      if (!into.disabled) void plan(swapperOf(select.value)!).catch(console.error);
    });
  draw();
  openReview({
    name,
    pages: [{ title: "What waits", body }, {}],
    steps: (sending) => current.steps(sending),
    atomic: true,
    groups: apart ? groups : undefined,
    waiting: () => (current.planning && into.checked ? "Routing the swap…" : undefined),
    checkHref,
    outcome: (receipts) => current.outcome(receipts),
  });
}

function claimReceipts(
  receipts: Landed[],
  ids: bigint[],
  tokens: Map<string, Token>,
  prices: Prices | undefined,
  caller: Address,
): Node[] {
  return claim
    .claimedIn(receipts, ids, caller)
    .map((claimed) =>
      claimReceipt(
        claimed.id,
        claimed,
        { tokens, prices },
        "",
        "Paid to you",
        claimed.received.length ? null : "Nothing came: someone else already claimed it for you.",
      ),
    );
}
function swapLater(
  came: Amount[],
  sale: swap.Plan,
  tokens: Map<string, Token>,
  prices: Prices | undefined,
  gasCosts: Costs | undefined,
): Node {
  const exact = {
    ...sale,
    items: sale.items.flatMap(({ approve = 0n, ...item }) => {
      const amount = came.find(({ token }) => same(token, item.token.address))?.amount;
      return amount ? [swap.partOf(item, amount, approve)] : [];
    }),
  };
  const next = Object.assign(document.createElement("p"), { className: "u-row" });
  if (!exact.items.length) return next;
  const button = Object.assign(document.createElement("button"), {
    type: "button",
    textContent: `Review the swap into ${sale.swapper.symbol}`,
  });
  button.addEventListener(
    "click",
    () => void reviewSwap(exact, tokens, prices, gasCosts).then((reason) => reason && (next.textContent = reason)),
  );
  next.append(button);
  return next;
}
function swapThese(came: Amount[]): Node {
  const p = document.createElement("p");
  if (came.length) p.append(swapLink(came, "Button Button--secondary"));
  return p;
}
