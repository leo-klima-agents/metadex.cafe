import * as claim from "../claim.ts";
import { DEFAULT_OUTPUT, HYDX, SWAPPERS, swapperOf, type Swapper } from "../config.ts";
import { checksRead, swapsOff } from "../checks.ts";
import { count, figure, listWords, money, moneyAt, sumBig } from "../format.ts";
import { summed, valueAt, type Overdue } from "../payouts.ts";
import { gasWords, key, pricesNow, quotesOf, type Prices, type Token } from "../prices.ts";
import { hrefOf } from "../routes.ts";
import { costsRead, same, simulate, type Costs, type Landed } from "../rpc.ts";
import { actions, render, state } from "../state.ts";
import * as swap from "../swap.ts";
import { describe, type Amount } from "../tokens.ts";
import { $, fill, frag, fromTemplate, list, type Value } from "../ui.ts";
import { capabilities, deadlineFor, type Connection, type Slip } from "../wallet.ts";
import { claimReceipt } from "./account.ts";
import { openMessage, openReview } from "./review.ts";
import { reviewSwap, swapLink, swapReceipt } from "./swap.ts";

// What a claim reads and plans before its review opens. `gas` is the claim's total gas. `groups` says how many calls
// go in each transaction. `together` says whether a swap can go in the claim's transaction.
type ClaimPlan = {
  connection: Connection;
  ids: bigint[];
  tokens: Map<string, Token>;
  totals: ReturnType<typeof claim.paidBy>;
  paid: Amount[];
  calls: Slip[];
  gas: bigint;
  groups: number[];
  apart: boolean;
  together: boolean;
  gasCosts: Costs | undefined;
  unread: number;
};
// The open claim's review. `radio` is the choice to swap, and `select` the token to swap into. `settled` says whether
// the prices have been read, or failed.
type Claiming = ClaimPlan & {
  body: HTMLElement;
  radio: HTMLInputElement;
  select: HTMLSelectElement;
  prices?: Prices | undefined;
  settled: boolean;
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
  const plan = await planClaim(entries, connection);
  if (typeof plan === "string") return openMessage(name, plan, checkHref);
  const current = claimingOf(plan);
  claiming = current;
  drawChoices(current);
  actions.receive = () => choose(current);
  actions["receive-output"] = () => {
    current.radio.checked = true;
    choose(current);
  };
  readPrices(current);
  drawClaim(current);
  openReview({
    name,
    pages: [{ title: "Unclaimed rewards", body: current.body }, {}],
    steps: (sending) => current.steps(sending),
    atomic: true,
    groups: current.apart ? current.groups : undefined,
    waiting: () => (current.planning && current.radio.checked ? "Routing the swap…" : undefined),
    checkHref,
    outcome: (receipts) => current.outcome(receipts),
  });
}

// Reads what the accounts owe and plans the claim. Gives words instead when there is nothing to claim, or Base
// refuses the claim.
async function planClaim(entries: Overdue[], connection: Connection): Promise<ClaimPlan | string> {
  const unanswered = "Base did not return the unclaimed rewards: try again in a moment.";
  // `checksRead()` is awaited but its result is not used. Swaps must wait for the checks, which say whether the RPCs
  // serve Base.
  const [owed, gasCosts, caps, middles] = await Promise.all([
    claim.owedOf(entries).catch((error: unknown) => void console.error(error)),
    costsRead().catch(() => undefined),
    capabilities(connection),
    describe([...swap.MIDDLES, HYDX]).catch(() => new Map<string, Token>()),
    checksRead().catch(() => undefined),
  ]);
  if (!owed) return unanswered;
  const { claims, tokens, unread } = owed;
  for (const [address, token] of middles) if (!tokens.has(address)) tokens.set(address, token);
  const owing = claims.filter(({ owed }) => owed.length);
  if (!owing.length) return unread ? unanswered : "Nothing to claim: someone else may have just claimed it for you.";
  const { calls, estimates } = await callsOf(owing, tokens, connection);
  const simulated = await simulate(connection.address, calls).catch(() => undefined);
  if (simulated?.some(({ ok }) => !ok)) return "Base refused the claim. Someone else may be claiming now.";
  if (simulated?.some(({ gas }) => gas > claim.MAX_CLAIM_GAS)) return "This claim needs more gas than Base allows.";
  const gas = simulated?.map(({ gas }) => gas) ?? estimates;
  const groups = claim.claimTransactions(gas);
  const apart = groups.length > 1;
  const totals = claim.paidBy(owing.flatMap(({ owed }) => owed));
  return {
    connection,
    ids: owing.map(({ id }) => id),
    tokens,
    totals,
    paid: totals.map(({ token, paid }) => ({ token, amount: paid })),
    calls,
    gas: sumBig(gas),
    groups,
    apart,
    together: (caps.atomic || !!connection.wallet.propose) && !apart,
    gasCosts,
    unread,
  };
}

// The claim's calls, each account's most valuable first, and each call's estimated gas.
async function callsOf(
  owing: claim.Claim[],
  tokens: Map<string, Token>,
  connection: Connection,
): Promise<{ calls: Slip[]; estimates: bigint[] }> {
  const owedTokens = owing.flatMap(({ owed }) => owed.flatMap(({ token }) => tokens.get(key(token)) ?? []));
  const quotes = await quotesOf(owedTokens);
  const weight = ({ owed }: claim.Claim) => valueAt(owed, tokens, quotes);
  const budget = connection.wallet.propose ? claim.SAFE_CLAIM_CALL_GAS : claim.CLAIM_CALL_GAS;
  const parts = owing.flatMap((each) => {
    const split = claim.claimCalls(each, budget).sort((a, b) => weight(b) - weight(a));
    return split.map((part) => ({ part, whole: split.length === 1 }));
  });
  return {
    calls: parts.map(({ part, whole }) => claim.claimSlip(part, tokens, whole)),
    estimates: parts.map(({ part }) => claim.claimGas(part.owed)),
  };
}

function claimingOf(plan: ClaimPlan): Claiming {
  const body = fromTemplate("claim-review");
  if (plan.unread)
    body.prepend(
      Object.assign(document.createElement("p"), {
        className: "Notice",
        textContent: `Base did not say what ${count(plan.unread, "reward contract owes", "reward contracts owe")}: it is left out, to claim later.`,
      }),
    );
  const current: Claiming = {
    ...plan,
    body,
    radio: body.querySelector<HTMLInputElement>('input[value="into"]')!,
    select: body.querySelector<HTMLSelectElement>("select")!,
    settled: false,
    steps: () => plan.calls,
    outcome: (receipts) => unswapped(current, receipts),
    into: "",
    planned: 0,
    planning: false,
  };
  return current;
}

function drawClaim(current: Claiming): void {
  if (claiming !== current) return;
  const { body, tokens, totals, prices, settled, gasCosts } = current;
  const value = (amounts: Amount[]) =>
    prices ? money(moneyAt(valueAt(amounts, tokens, prices), prices), true) : settled ? "Not read" : undefined;
  const earned = totals.map(({ token, earned }) => ({ token, amount: earned }));
  const fees = totals.map(({ token, fee }) => ({ token, amount: fee }));
  const gasOf = (units: bigint) =>
    gasCosts ? gasWords(units * gasCosts.gasPrice, prices) : `${units.toLocaleString("en-GB")} gas`;
  drawLines($("[data-list=line]", body), earned, tokens, prices);
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
    paid: value(current.paid),
    count: count(totals.length, "token", "tokens"),
    into: current.into,
    gas: `Gas ${gasOf(current.gas)}${current.gasWithSwap === undefined ? "" : `, ${gasOf(current.gasWithSwap)} with the swap`}`,
  });
  render();
}

// The tokens claimed. Once prices are read, the ones worth the most go first.
function drawLines(el: HTMLElement, earned: Amount[], tokens: Map<string, Token>, prices: Prices | undefined): void {
  const lines = [...earned].sort((a, b) => (prices ? valueAt([b], tokens, prices) - valueAt([a], tokens, prices) : 0));
  list(
    el,
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
}

// No swap while swaps are off. No swap either from a Safe whose claim takes several transactions: the swap needs the
// claim's receipts, which come only once the owners sign.
function drawChoices(current: Claiming): void {
  const options = swapsOff() !== false ? [] : SWAPPERS;
  list(
    $("[data-list=option]", current.body),
    options,
    ({ output }) => output,
    (option, swapper) => {
      (option as HTMLOptionElement).value = swapper.output;
      (option as HTMLOptionElement).selected = swapper.output === DEFAULT_OUTPUT;
      fill(option, { symbol: swapper.symbol });
    },
  );
  const safeApart = current.apart && !!current.connection.wallet.propose;
  current.radio.disabled = current.select.disabled = !options.length || safeApart;
  if (current.radio.disabled) current.into = safeApart ? "Swap them once the claims go through." : "Swaps are off.";
}

// Reads the prices, then draws them and plans the swap.
function readPrices(current: Claiming): void {
  const { paid, tokens } = current;
  void pricesNow(
    [
      ...paid.flatMap(({ token }) => tokens.get(key(token)) ?? []),
      ...SWAPPERS.map(({ token, decimals, symbol }) => ({ address: token, decimals, symbol })),
    ],
    new Map(paid.map(({ token, amount }) => [key(token), amount])),
  )
    .then(
      (found) => {
        current.prices = found;
        current.settled = true;
      },
      () => {
        current.settled = true;
      },
    )
    .finally(() => {
      drawClaim(current);
      if (!current.radio.disabled) void planSwap(current, swapperOf(current.select.value)!).catch(console.error);
    });
}

// Each choice starts from the claim alone. A chosen swap then replaces it, once planned.
function choose(current: Claiming): void {
  if (claiming !== current) return;
  const chosen = current.radio.checked;
  current.steps = () => current.calls;
  current.outcome = (receipts) => unswapped(current, receipts);
  current.gasWithSwap = undefined;
  if (chosen && !current.radio.disabled)
    void planSwap(current, swapperOf(current.select.value)!).catch((error: unknown) => {
      console.error(error);
      current.into = "Not read: they are claimed unswapped.";
      drawClaim(current);
    });
  else drawClaim(current);
}

// Each plan gets an id. A plan stops when a newer one has started.
async function planSwap(current: Claiming, swapper: Swapper): Promise<void> {
  const id = ++current.planned;
  current.planning = true;
  try {
    await routeSwap(current, swapper, id);
  } finally {
    if (id === current.planned) {
      current.planning = false;
      drawClaim(current);
    }
  }
}

async function routeSwap(current: Claiming, swapper: Swapper, id: number): Promise<void> {
  current.into = undefined;
  current.gasWithSwap = undefined;
  drawClaim(current);
  const { paid, tokens, prices, gasCosts } = current;
  const { plan: sale, left } = await swap.saleOf(paid, swapper, tokens, prices, gasCosts?.gasPrice, MARGIN);
  if (id !== current.planned) return;
  const kept = paid.find(({ token }) => same(token, swapper.token))?.amount ?? 0n;
  current.into = intoWords(sale.items, kept, swapper, left);
  if (!sale.items.length) return drawClaim(current);
  // When the claim and the swap can't go together, the claim goes first. If the visitor chose a swap, the claim's
  // Done page then offers to swap what it brought.
  if (!current.together) {
    if (current.radio.checked)
      current.outcome = async (receipts) =>
        frag(
          ...claimReceipts(current, receipts),
          swapLater(brought(current, receipts), sale, tokens, current.prices, gasCosts),
        );
    return drawClaim(current);
  }
  await swapWithClaim(current, sale, left, kept, id);
}

// Runs the claim and the swap together through Base. The swap then takes its minimums from what Base returned, and
// leaves out the tokens Base would skip.
async function swapWithClaim(
  current: Claiming,
  sale: swap.Plan,
  left: string[],
  kept: bigint,
  id: number,
): Promise<void> {
  const { connection, calls, tokens } = current;
  let at = deadlineFor(connection);
  const run = await swap.simulatePlan(connection.address, calls, sale, tokens, at, true);
  if (id !== current.planned) return;
  if (!run || run.refused !== undefined || run.gas > claim.MAX_CLAIM_GAS) {
    current.into = "Base refused the claim and the swap together: they are claimed unswapped.";
    current.steps = () => calls;
    current.outcome = (receipts) => unswapped(current, receipts);
    return drawClaim(current);
  }
  const going = {
    ...sale,
    items: swap
      .withMinimums(sale, run.results)
      .flatMap(({ item, reason }) => (reason ? (left.push(item.token.symbol), []) : [item])),
  };
  current.into = intoWords(going.items, kept, sale.swapper, left);
  if (!going.items.length) return drawClaim(current);
  if (current.radio.checked) {
    current.steps = (sending) => {
      if (sending) at = deadlineFor(connection);
      return [...calls, ...swap.planSteps(going, tokens, at, undefined, true).slips];
    };
    current.gasWithSwap = run.gas;
    current.outcome = async (receipts) =>
      frag(
        ...claimReceipts(current, receipts),
        swapReceipt(receipts, going, tokens, current.prices, new Map(), connection.address),
      );
  }
  drawClaim(current);
}

// What the swap pays into `swapper`, in words. `kept` is what the claim already pays in that token.
function intoWords(items: swap.Item[], kept: bigint, swapper: Swapper, left: string[]): string {
  if (!items.length) return `None worth swapping into ${swapper.symbol}`;
  const { out, fee, least } = swap.totalsOf(items, ({ route }) => route.minPaid);
  return `${figure(kept + out - fee, swapper.decimals)} ${swapper.symbol}, at least ${figure(kept + least, swapper.decimals)}, from ${listWords(items.map(({ token }) => token.symbol))}${left.length ? `; ${count(left.length, "token", "tokens")} kept` : ""}`;
}

const brought = ({ ids, connection }: Claiming, receipts: Landed[]): Amount[] =>
  summed(claim.claimedIn(receipts, ids, connection.address).flatMap(({ paid }) => paid));
const unswapped = async (current: Claiming, receipts: Landed[]): Promise<Node> =>
  frag(...claimReceipts(current, receipts), swapThese(brought(current, receipts)));

// Takes the review, not its prices, since the prices may be read only after the review opens.
function claimReceipts({ ids, tokens, prices, connection }: Claiming, receipts: Landed[]): Node[] {
  return claim
    .claimedIn(receipts, ids, connection.address)
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
