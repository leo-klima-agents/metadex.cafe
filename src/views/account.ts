import type { Address } from "viem";
import { use, type Got } from "../cache.ts";
import { AUTOMATIONS, BASESCAN, KVCM, byKind } from "../config.ts";
import * as data from "../data.ts";
import {
  WEEK,
  amount,
  bps,
  count,
  day,
  listWith,
  money,
  moneyAt,
  short,
  utc,
  voteFigure,
  weekStart,
} from "../format.ts";
import * as hydrex from "../hydrex.ts";
import type { Holdings } from "../hydrex.ts";
import {
  automationOf,
  overdue,
  totals,
  underWay,
  valueAt,
  WALK_LIMIT,
  type Payouts,
  type Payout,
  type Standing,
  type Walk,
} from "../payouts.ts";
import { gasWords, key, noPrices, pricesAtFlip, pricesNow, type Prices, type Token } from "../prices.ts";
import { now, same, tagged } from "../rpc.ts";
import { state } from "../state.ts";
import { tokensOf, type Amount } from "../tokens.ts";
import { $, bill, code, fill, frag, fromTemplate, link, list, shown, stateOf, status, type Value } from "../ui.ts";
import { accountName, can, lockWords, statusNode } from "./hydrex.ts";
import { swapLink } from "./swap.ts";

const view = $('[data-view="account"]');

function waiting(found: Payouts): Got<{ tokens: Map<string, Token>; prices: Prices }> {
  const amounts = new Map<Address, bigint>();
  for (const { standing } of found.entries)
    for (const { token, amount } of standing?.waiting ?? [])
      amounts.set(key(token), (amounts.get(key(token)) ?? 0n) + amount);
  if (!amounts.size) return { value: { tokens: new Map(), prices: noPrices() } };
  return use(
    `waiting ${[...amounts].join()}`,
    async () => {
      const tokens = await tokensOf([...amounts.keys()], tagged("payouts"));
      return { tokens, prices: await pricesNow([...tokens.values()], amounts, tagged("payouts")) };
    },
    300_000,
  );
}
// Returns words such as "≈ $1.84 in 9 tokens", starting "at least " when the account is late, or when some tokens could
// not be read or priced. With nothing waiting in last epoch's pools, it says "from the epoch before last".
export function waitsWords(standing: Standing, found: Payouts): string {
  const priced = waiting(found).value;
  const tokens = new Set(standing.waiting.map(({ token }) => key(token)));
  if (!tokens.size) return "from the epoch before last";
  const worth = priced ? valueAt(standing.waiting, priced.tokens, priced.prices) : 0;
  const partial = [...tokens].some((token) => !priced?.prices.of.has(token));
  const words = count(tokens.size, "token", "tokens");
  return `${standing.unknown || standing.late || (worth && partial) ? "at least " : ""}${worth ? `${money(moneyAt(worth, priced!.prices))} in ${words}` : words}`;
}

export function drawAccount(): void {
  if (state.route.view !== "account") return;
  const id = state.route.id;
  const { holdings, own } = data.accountShown(id);
  const found = holdings.value;
  const account = found?.accounts[0];
  document.title = `${account ? accountName(account) : `Hydrex account #${id}`} · metaDEX Café`;
  fill(view, {
    name: account ? accountName(account) : `Hydrex account #${id}`,
    account: stateOf(holdings, !account),
  });
  if (!found || !account) return;
  const st = hydrex.statusOf(account, found.owner, now(), found.epochStart);
  const earned = own ? data.accountEarned(found, id) : { value: null };
  const payouts = data.payouts(found);
  const entry = payouts.value?.entries.find((each) => each.account.id === id);
  const late = own && payouts.value ? overdue(payouts.value).find((each) => each.account.id === id) : undefined;
  const stopped = st.kind === "stopped";
  fill(view, {
    status: statusNode(st, own),
    lock: account.amount === 0n ? "Empty" : lockWords(account),
    votes: voteFigure(account.votes),
    "earned-row": earned.value !== null || null,
    earned: shown(earned, (worth) => money(worth)),
    "owner-row": !own || null,
    owner: { address: found.owner, text: short(found.owner) },
    overdue:
      late && payouts.value
        ? frag(
            Object.assign(document.createElement("strong"), { textContent: "Payout overdue: " }),
            waitsWords(late.standing, payouts.value),
          )
        : null,
    stopped: stopped || null,
    since: stopped ? utc(st.since) : "",
    leftovers: own || null,
    underway:
      own && payouts.value && underWay(payouts.value)?.left.some((each) => each.account.id === id)
        ? "Payout under way."
        : null,
    payouts: automationOf(account) && (entry || !payouts.value) ? stateOf(payouts) : null,
  });
  drawActions(own ? found : undefined, st);
  if (payouts.value) drawStandings(payouts.value, found.owner, own);
}

function drawActions(own: Holdings | undefined, st: hydrex.Status): void {
  const account = own?.accounts[0];
  const section = $("[data-text=actions]", view);
  let any = false;
  for (const button of section.querySelectorAll<HTMLButtonElement>("button[data-action]")) {
    const { action, arg } = button.dataset;
    const automation = byKind(arg ?? "");
    if (automation) {
      const moves = !!account && AUTOMATIONS.some((other) => other !== automation && hydrex.canLeave(account, other));
      button.textContent = `${moves ? "Move to" : "Join"} ${automation.name}`;
      button.classList.toggle("Button--secondary", moves);
    }
    // Leaving one of Hydrex's other automations uses the "self" action, which also leaves the page's own.
    if (action === "leave" || action === "self") {
      button.textContent = st.kind === "stopped" ? "Leave automation" : "Leave";
      button.dataset.action = account && hydrex.canLeaveOther(account) ? "self" : "leave";
    }
    const allowed = !!own && !!account && can(button.dataset.action ?? "", account, arg, own);
    button.hidden = !allowed;
    any ||= allowed;
  }
  const join = account && AUTOMATIONS.find((each) => hydrex.canJoin(account, each, now()));
  const gas =
    account && join && state.connection && (st.kind === "stopped" || st.kind === "unvoted")
      ? use(
          `gas ${account.id} ${join.kind}`,
          () => hydrex.gasEstimate(hydrex.join([account], join), state.connection!.address),
          60_000,
        )
      : undefined;
  fill(section, {
    actions: any || (!!own && st.kind === "unvoted") || null,
    vote: (!!own && st.kind === "unvoted") || null,
    gas: !gas || gas.failed ? null : gas.value && `A change costs ${gasWords(gas.value.wei, gas.value.prices)} in gas.`,
  });
}

function drawStandings(found: Payouts, owner: Address, own: boolean): void {
  list(
    $("[data-list=standing]", view),
    found.entries,
    ({ account }) => String(account.id),
    (article, entry) => {
      const { automation, voter, account, standing, earnings, early, note, time } = entry;
      const through = standing?.paidUpTo?.through ?? 0;
      const waits = standing && earnings ? waitingLine(standing, found) : undefined;
      const states = [
        !earnings && !early && status("idle", "Not read yet"),
        early && status("idle", "Not final yet"),
        !!earnings && !standing && status("idle", "Nothing to pay"),
        !!standing &&
          !standing.late &&
          (through ? status("running", `Paid up to ${utc(through)}`) : status("idle", "Not paid yet")),
        !!standing?.late && status("stopped", "Late", ` · ${through ? `paid up to ${utc(through)}` : "never paid"}`),
        waits,
        !!standing &&
          (standing.waiting.length > 0 || standing.unknown) &&
          !same(account.claimer, voter.address) &&
          `${voter.name} no longer claims it: claim on Hydrex.`,
        note === "outside" &&
          time !== undefined &&
          `Last claimed outside ${automation.name} on ${day(time)}: no receipt.`,
        note === "unclaimed" && `Never claimed through ${automation.name}.`,
      ].filter((each) => each !== false && each !== undefined);
      list(
        $("[data-list=state]", article),
        states,
        (_, i) => String(i),
        (li, words) => fill(li, { words }),
      );
      const receipt =
        entry.payout && time !== undefined
          ? payoutReceipt(entry.payout, account.id, owner, time, own)
          : entry.walk?.claims.length
            ? claimsReceipt(entry.walk, account.id, owner, own)
            : null;
      fill(article, { receipt });
    },
  );
}
function waitingLine(standing: Standing, found: Payouts): string {
  const { waiting: owed, unknown } = standing;
  if (!owed.length) return unknown ? "Waiting: not read" : "Nothing waiting";
  return `${unknown ? "At least " : ""}${waitsWords(standing, found).replace(/^at least /, "")} waiting`;
}

function priced(amounts: Amount[], flip: number): { tokens?: Map<string, Token>; prices?: Prices } {
  const addresses = [...new Set(amounts.map(({ token }) => key(token)))];
  const tokens = use(`tokens ${addresses.join()}`, () => tokensOf(addresses, tagged("payouts"))).value;
  if (!tokens) return {};
  const most = new Map<string, bigint>();
  for (const { token, amount: value } of amounts) if (value > (most.get(key(token)) ?? 0n)) most.set(key(token), value);
  const prices = use(`flip prices ${flip} ${addresses.join()}`, () =>
    pricesAtFlip([...tokens.values()], most, flip, tagged("payouts")),
  ).value;
  return { tokens, prices };
}
function amounts(found: Amount[], tokens: Map<string, Token> | undefined, sign = "", none = "Nothing"): Value {
  if (!found.length) return none;
  return frag(
    sign,
    ...listWith<Node | string>(
      found.map(({ token, amount: value }) => {
        const known = tokens?.get(key(token));
        return known
          ? `${amount(value, known.decimals)} ${known.symbol}`
          : frag(`${value} base units of `, code(token));
      }),
    ),
  );
}
const worth = (found: Amount[], { tokens, prices }: ReturnType<typeof priced>): Value => {
  const total = tokens && prices ? valueAt(found, tokens, prices) : 0;
  return total > 0 ? money(moneyAt(total, prices!), true) : "";
};
function payoutReceipt(payout: Payout, id: bigint, owner: Address, time: number, own: boolean): Node {
  const p = priced([...payout.earned, ...payout.paid], weekStart(time));
  const kvcm = (list: Amount[]) => list.find(({ token }) => same(token, KVCM))?.amount ?? 0n;
  const all = kvcm(payout.paid) + kvcm(payout.fees) + payout.retiredKvcm;
  const swapped = all - kvcm(payout.earned);
  const share = (part: bigint) => (all ? bps((part * 10_000n + all / 2n) / all) : "");
  const then = !same(payout.owner, owner);
  const recipient = link(`${BASESCAN}/address/${payout.recipient}`, short(payout.recipient), true);
  return bill(
    `Receipt · Account #${id} · Matcha Latte`,
    `${day(weekStart(time) - WEEK)} to ${day(weekStart(time))}`,
    [],
    [
      ["Earned", worth(payout.earned, p), amounts(payout.earned, p.tokens)],
      ["Swapped", `${amount(swapped > 0n ? swapped : 0n, 18)} kVCM`],
      [
        `Retired ${share(payout.retiredKvcm)}`,
        `${payout.retiredKvcm ? "−" : ""}${amount(payout.retiredKvcm, 18)} kVCM`,
        payout.tonnes ? frag(`${amount(payout.tonnes, 18)} t of carbon credits`, fromTemplate("klima")) : null,
      ],
      [`Fee ${share(kvcm(payout.fees))}`, amounts(payout.fees, p.tokens, payout.fees.length ? "−" : "", "0 kVCM")],
    ],
    [
      then ? "Paid to its owner then" : own ? "Paid to you" : "Paid to its owner",
      amounts(payout.paid, p.tokens, "", "0 kVCM"),
      worth(payout.paid, p),
      then || !same(payout.recipient, payout.owner) ? frag(`${then ? "To its owner then," : "To"} `, recipient) : null,
    ],
    frag(
      utc(time),
      " · ",
      Object.assign(link(`${BASESCAN}/tx/${payout.tx}`, "Transaction", true), { className: "u-sans" }),
    ),
  );
}

export function claimReceipt(
  id: bigint,
  { received, fees, paid }: { received: Amount[]; fees: Amount[]; paid: Amount[] },
  p: ReturnType<typeof priced>,
  dates: string,
  paidTo: string,
  foot: Value = null,
  after: Value = null,
): HTMLElement {
  return bill(
    `Receipt · Account #${id} · Double Espresso`,
    dates,
    [],
    [
      ["Claimed", worth(received, p), amounts(received, p.tokens)],
      [`Fee ${bps(100n)}`, worth(fees, p), amounts(fees, p.tokens, fees.length ? "−" : "")],
    ],
    [paidTo, amounts(paid, p.tokens), worth(paid, p)],
    foot,
    after,
  );
}

// Double Espresso's receipt on an account's page: the claims in the last claim's epoch, with who sent each.
function claimsReceipt({ claims, stopped }: Walk, id: bigint, owner: Address, own: boolean): Node {
  const { received, fees, paid } = totals(claims);
  const timeOf = (block: number) => data.timeOfBlock(block).value;
  const first = claims[0] && timeOf(claims[0].block);
  const flip = first === undefined ? undefined : weekStart(first);
  const p = flip === undefined ? {} : priced(received, flip);
  const you = (address: Address) => own && same(address, owner);
  const node = claimReceipt(
    id,
    { received, fees, paid },
    p,
    flip === undefined ? "" : `${day(flip - WEEK)} to ${day(flip)}`,
    claims.every((claim) => you(claim.owner)) ? "Paid to you" : "Paid to its owner",
    stopped ? `Last ${WALK_LIMIT} blocks only` : null,
    own ? swapLink(paid) : null,
  );
  list(
    $("[data-list=claim]", node),
    claims,
    ({ tx }) => tx,
    (row, { caller, owner: to, tx, block }) => {
      const time = timeOf(block);
      const words = `${time === undefined ? "" : utc(time)} · ${you(caller) ? "sent by you" : `sent by ${short(caller)}`}${same(to, owner) ? "" : `, to ${short(to)}`}`;
      fill(row, { words, tx: { href: `${BASESCAN}/tx/${tx}`, text: "Transaction", external: true } });
    },
  );
  return node;
}
