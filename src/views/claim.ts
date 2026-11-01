import { maxUint256 } from "viem";
import * as claim from "../claim.ts";
import { DEFAULT_OUTPUT, HYDX, SWAPPERS, swapperOf, type Swapper } from "../config.ts";
import * as data from "../data.ts";
import { count, figure, list as listWords, money, moneyAt } from "../format.ts";
import { summed, valueAt, type Amount, type Entry } from "../payouts.ts";
import { ethCost, gasWords, key, pricesNow, worthOf, type Prices, type Token } from "../prices.ts";
import { hrefOf } from "../routes.ts";
import { costs, now, same, simulate, type Costs, type Receipt } from "../rpc.ts";
import { actions, render, state } from "../state.ts";
import * as swap from "../swap.ts";
import { describe } from "../tokens.ts";
import { $, fill, frag, list, type Value } from "../ui.ts";
import { capabilities, type Slip } from "../wallet.ts";
import { openReview } from "./review.ts";
import { billNode, prefill, reviewSwap, swapReceipt, swapsOff } from "./swap.ts";

// Claiming an overdue payout through Double Espresso, as it is or swapped into one token: in one prompt, all or
// nothing, where the wallet can; else the claim first, then the swap of what it brought.
type Claiming = {
  // The calls; those `sending` are encoded then, with a fresh deadline.
  steps: (sending?: boolean) => Slip[];
  outcome: (receipts: Receipt[]) => Promise<Node | undefined>;
  into: Value;
  gasWithSwap?: bigint | undefined;
  planned: number;
};
let open: Claiming | undefined;
const MARGIN = 50n;

export async function openClaim(entries: Entry[]): Promise<void> {
  const connection = state.connection!;
  // Swaps wait for the checks, which say whether the RPCs serve Base.
  const [{ claims, tokens }, gasCosts, caps, middles] = await Promise.all([
    claim.owedOf(entries),
    costs().catch(() => undefined),
    capabilities(connection),
    describe([...swap.MIDDLES, HYDX]).catch(() => new Map<string, Token>()),
    data.checksRead().catch(() => undefined),
  ]);
  const deadline = () => BigInt(now() + (connection.wallet.propose ? 86_400 : 1_800));
  for (const [address, token] of middles) if (!tokens.has(address)) tokens.set(address, token);
  const owing = claims.filter(({ owed }) => owed.length);
  const name = `Claim for ${entries.length === 1 ? "Hydrex account" : "Hydrex accounts"} ${listWords(entries.map(({ account }) => `#${account.id}`))}`;
  const checkHref = hrefOf({ view: "product", kind: "double-espresso", section: "check" });
  const nothing = (words: string) =>
    openReview({
      name,
      pages: [{ title: name, body: Object.assign(document.createElement("p"), { textContent: words }) }],
      steps: () => [],
      checkHref,
    });
  if (!owing.length) return nothing("Nothing to claim: someone else may have just claimed it for you.");

  const totals = claim.paidBy(owing.flatMap(({ owed }) => owed));
  const paid = totals.map(({ token, paid }) => ({ token, amount: paid }));
  const weight = ({ owed }: claim.Claim) => valueAt(owed, tokens, entries[0]!.earnings!.prices, true);
  const budget = connection.wallet.propose ? claim.SAFE_CLAIM_CALL_GAS : claim.CLAIM_CALL_GAS;
  const calls = owing.flatMap((each) => {
    const parts = claim.claimCalls(each, budget).sort((a, b) => weight(b) - weight(a));
    return parts.map((part) => claim.claimSlip(part, tokens, parts.length === 1));
  });
  const simulated = await simulate(connection.address, calls).catch(() => undefined);
  if (simulated?.some(({ ok }) => !ok)) return nothing("Base refused the claim. Someone else may be claiming now.");
  if (simulated?.some(({ gas }) => gas > claim.MAX_CLAIM_GAS))
    return nothing("This claim needs more gas than Base allows.");
  const gas =
    simulated?.map(({ gas }) => gas) ??
    owing.flatMap((each) => claim.claimCalls(each, budget).map(({ owed }) => claim.claimGas(owed)));
  const groups = claim.claimTransactions(gas);
  const apart = groups.length > 1;
  const together = (caps.atomic || !!connection.wallet.propose) && !apart;
  const totalGas = gas.reduce((sum, one) => sum + one, 0n);

  const body = $<HTMLTemplateElement>("#claim-review").content.firstElementChild!.cloneNode(true) as HTMLElement;
  let prices: Prices | undefined;
  let settled = false;
  const ids = owing.map(({ id }) => id);
  const brought = (receipts: Receipt[]): Amount[] =>
    summed(claim.claimedIn(receipts, ids, connection.address).flatMap(({ paid }) => paid));
  const asTheyAre = async (receipts: Receipt[]) =>
    frag(...claimReceipts(receipts, ids, tokens, prices), swapThese(brought(receipts)));
  const current: Claiming = { steps: () => calls, outcome: asTheyAre, into: "", planned: 0 };
  open = current;

  const draw = () => {
    if (open !== current) return;
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
      ] as [string, Value][],
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
  // While swaps are off, no swap; nor from a Safe whose claim takes several Safe transactions, as the swap follows
  // the claim's receipts, which come once its owners sign.
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

  // Plans the swap into `swapper`: only tokens whose quote clears their gas twice over; the others stay as they are.
  const plan = async (swapper: Swapper) => {
    const id = ++current.planned;
    current.into = undefined;
    current.gasWithSwap = undefined;
    draw();
    const routes = await Promise.all(
      paid.map(({ token, amount }) =>
        same(token, swapper.token) ? undefined : swap.findRoute(token, amount, swapper, true).catch(() => undefined),
      ),
    );
    if (id !== current.planned) return;
    const items: swap.Item[] = [];
    const left: string[] = [];
    paid.forEach(({ token, amount }, i) => {
      const route = routes[i];
      if (same(token, swapper.token)) return;
      const outputPrice = prices?.of.get(key(swapper.token));
      const known = tokens.get(key(token));
      const worth = !route
        ? undefined
        : outputPrice !== undefined
          ? worthOf(route.out, swapper.decimals, outputPrice)
          : prices?.of.get(key(token)) !== undefined && known
            ? worthOf(amount, known.decimals, prices.of.get(key(token))!)
            : undefined;
      const cost =
        gasCosts && route ? (ethCost((route.gas + swap.APPROVAL_GAS) * gasCosts.gasPrice, prices)?.value ?? 0) : 0;
      if (!route || !known || worth === undefined || worth < 2 * cost) return void left.push(known?.symbol ?? token);
      items.push({
        token: known,
        route: { ...route.route, amount: maxUint256, minPaid: swap.minimumOf(route.out, MARGIN) },
        out: route.out,
        allowance: 0n,
        approve: amount,
      });
    });
    const kept = paid.find(({ token }) => same(token, swapper.token))?.amount ?? 0n;
    const sayInto = (these: swap.Item[]) => {
      const out = kept + these.reduce((sum, { out }) => sum + swap.paidOf(out), 0n);
      const least = kept + these.reduce((sum, { route }) => sum + route.minPaid, 0n);
      current.into = these.length
        ? `${figure(out, swapper.decimals)} ${swapper.symbol}, at least ${figure(least, swapper.decimals)}, from ${listWords(these.map(({ token }) => token.symbol))}${left.length ? `; ${count(left.length, "token", "tokens")} kept` : ""}`
        : `None worth swapping into ${swapper.symbol}`;
    };
    sayInto(items);
    const swapPlan: swap.Plan = { swapper, items, margin: MARGIN };
    if (!items.length) return draw();
    // Apart, the claim goes first; once it has, its Done page offers the swap of what it brought, if asked.
    if (!together) {
      if (into.checked)
        current.outcome = async (receipts) => {
          const came = brought(receipts);
          const exact = {
            ...swapPlan,
            items: items.flatMap(({ approve = 0n, ...item }) => {
              const amount = came.find(({ token }) => same(token, item.token.address))?.amount;
              return amount ? [swap.partOf(item, amount, approve)] : [];
            }),
          };
          const next = Object.assign(document.createElement("p"), { className: "row" });
          if (exact.items.length) {
            const button = Object.assign(document.createElement("button"), {
              type: "button",
              textContent: `Review the swap into ${swapper.symbol}`,
            });
            button.addEventListener(
              "click",
              () =>
                void reviewSwap(exact, tokens, prices, gasCosts as Costs | undefined).then(
                  (reason) => reason && (next.textContent = reason),
                ),
            );
            next.append(button);
          }
          return frag(...claimReceipts(receipts, ids, tokens, prices), next);
        };
      return draw();
    }
    // Run through Base after the claims, with no minimums: each route then sets its own.
    let at = deadline();
    const run = await swap.simulatePlan(connection.address, calls, swapPlan, tokens, at, true);
    if (id !== current.planned) return;
    if (!run || run.refused !== undefined || run.gas > claim.MAX_CLAIM_GAS) {
      current.into = "Base refused both together: they come as they are.";
      current.steps = () => calls;
      current.outcome = asTheyAre;
      return draw();
    }
    const going = {
      ...swapPlan,
      items: swap
        .withMinimums(swapPlan, run.results)
        .flatMap(({ item, reason }) => (reason ? (left.push(item.token.symbol), []) : [item])),
    };
    sayInto(going.items);
    if (!going.items.length) return draw();
    if (body.querySelector<HTMLInputElement>('input[value="into"]')!.checked) {
      current.steps = (sending) => [
        ...calls,
        ...swap.planSteps(going, tokens, sending ? (at = deadline()) : at, undefined, true).slips,
      ];
      current.gasWithSwap = run.gas;
      current.outcome = async (receipts) =>
        frag(...claimReceipts(receipts, ids, tokens, prices), swapReceipt(receipts, going, tokens, prices, new Map()));
    }
    draw();
  };
  const choose = () => {
    if (open !== current) return;
    const chosen = body.querySelector<HTMLInputElement>('input[value="into"]')!.checked;
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
    checkHref,
    outcome: (receipts) => current.outcome(receipts),
  });
}

// Each account's claim receipt, from its Claimed events.
function claimReceipts(
  receipts: Receipt[],
  ids: bigint[],
  tokens: Map<string, Token>,
  prices: Prices | undefined,
): Node[] {
  const words = (amounts: Amount[], sign = "") =>
    amounts.length
      ? sign +
        listWords(
          amounts.map(({ token, amount }) =>
            tokens.get(key(token))
              ? `${figure(amount, tokens.get(key(token))!.decimals)} ${tokens.get(key(token))!.symbol}`
              : `${amount} of ${token}`,
          ),
        )
      : "Nothing";
  return claim.claimedIn(receipts, ids, state.connection!.address).map(({ id, received, fees, paid }) => {
    const worth = prices ? valueAt(received, tokens, prices) : 0;
    const node = billNode(
      `Receipt · Account #${id} · Double Espresso`,
      "",
      [],
      [
        ["Claimed", worth > 0 ? money(moneyAt(worth, prices!), true) : "", words(received)],
        ["Fee 1%", words(fees, "−")],
      ],
      ["Paid to you", words(paid), ""],
    );
    if (!received.length)
      node.append(
        Object.assign(document.createElement("p"), {
          className: "small",
          textContent: "Nothing came: someone else already claimed it for you.",
        }),
      );
    return node;
  });
}
// After a claim as it is: a link to swap what it brought.
function swapThese(came: Amount[]): Node {
  const p = document.createElement("p");
  if (!came.length) return p;
  const link = Object.assign(document.createElement("a"), {
    className: "button secondary",
    href: "#swap",
    textContent: "Swap these",
  });
  link.addEventListener("click", () => prefill(came));
  p.append(link);
  return p;
}
