import { AUTOMATIONS, KVCM, type Token } from "../config.ts";
import { totals } from "../claim.ts";
import { earnedByAccount, loadShares } from "../earnings.ts";
import { WEEK, amount, bps, count, day, list as words, money, short, utc, voteFigure, weekStart } from "../format.ts";
import {
  canJoin,
  canLeave,
  gasCost,
  join,
  readAccount,
  readAccounts,
  statusOf,
  type Account,
  type Holdings,
} from "../hydrex.ts";
import { WALK_LIMIT, overdue, payouts, underWay, type Entry, type Found } from "../payouts.ts";
import { gasWords, worthOf } from "../prices.ts";
import { now, sawBlock } from "../rpc.ts";
import { reader, update, type Reader } from "../state.ts";
import { key, memo, same, sum, type Amount } from "../util.ts";
import { $, $$, addressLink, fill, list, setState, status, time, txUrl, type Value } from "./dom.ts";
import { act, can, lockWords, statusWords } from "./hydrex.ts";
import { onRoute, route } from "./router.ts";
import { appPayouts, holdings, joinable, owns, session } from "./session.ts";
import { prefill } from "./swap.ts";

const view = $(".view[data-view=account]");
const box = $("#account");
const payoutBox = $("#payout");
// The account shown, read by its number unless the wallet holds it; its payouts; and, for someone else's awaiting a
// payout, its owner's other accounts once, to tell a payout under way.
let viewing: { id: bigint; account: Reader<Holdings | null> } | undefined;
const shownPayouts = payouts();
const ownerPayouts = payouts();
let ownerRead: string | undefined;

const own = (id: bigint): Holdings | undefined => {
  const found = holdings();
  const account = found?.accounts.find((each) => each.id === id);
  return found && account && { ...found, accounts: [account] };
};
const shown = (): Holdings | undefined => viewing && (own(viewing.id) ?? viewing.account.value ?? undefined);

const tokenWords = (amounts: Amount[], tokens: Map<string, Token> | undefined, sign = "", none = "0 kVCM") =>
  amounts.length
    ? sign +
      words(
        amounts.map(({ token, amount: value }) => {
          const known = tokens?.get(key(token));
          return known ? `${amount(value, known.decimals)} ${known.symbol}` : `${value} base units of ${short(token)}`;
        }),
      )
    : none;
const worthWords = (amounts: Amount[], found: Found | undefined): string => {
  const value = sum(
    amounts.map(({ token, amount: each }) => {
      const known = found?.tokens?.get(key(token));
      const price = found?.prices?.of.get(key(token));
      return known && price !== undefined ? worthOf(each, known.decimals, price) : 0;
    }),
  );
  return value > 0 ? money({ value, unit: found!.prices!.unit }, true) : "";
};

// What waits for an account, at prices now, or in tokens: "at least ≈ $1.84 in 9 tokens".
export function waitsWords({ standing }: Entry, found: Found | undefined): string {
  const { waiting = [], unknown = false, late = false } = standing ?? {};
  const tokens = new Set(waiting.map(({ token }) => key(token)));
  const worth = worthWords(waiting, found);
  const partial = [...tokens].some((token) => !found?.prices?.of.has(token));
  if (!tokens.size) return "from the epoch before last";
  return `${unknown || late || partial ? "at least " : ""}${worth ? `${worth} in ` : ""}${count(tokens.size, "token", "tokens")}`;
}

function standingWords(entry: Entry, mine: boolean): [string, string, string[]] {
  const { automation, voter, account, standing, earnings, early, note, time: at } = entry;
  const through = standing?.through ?? 0;
  const [shape, title] =
    !earnings && !early
      ? ["idle", "Not read yet"]
      : early
        ? ["idle", "Not final yet"]
        : !standing
          ? ["idle", "Nothing to pay"]
          : standing.late
            ? ["stopped", `Late · ${through ? `paid up to ${day(through)}` : "never paid"}`]
            : through
              ? ["running", `Paid up to ${day(through)}`]
              : ["idle", "Not paid yet"];
  const worth = standing && earnings && worthWords(standing.waiting, shownPayouts.found);
  const what =
    worth ||
    (standing?.waiting.length
      ? count(new Set(standing.waiting.map(({ token }) => key(token))).size, "token", "tokens")
      : "");
  const waiting =
    !standing || !earnings
      ? ""
      : (standing.unknown || (worth && what !== worth)) && what
        ? `At least ${what} waiting`
        : standing.unknown
          ? "Waiting: not read"
          : what
            ? `${what} waiting`
            : "Nothing waiting";
  const stranded =
    !!standing && (standing.waiting.length > 0 || standing.unknown) && !same(account.claimer, voter.address);
  return [
    shape,
    title,
    [
      waiting,
      stranded ? `${voter.name} no longer claims it: claim on Hydrex.` : "",
      note === "outside" && at !== undefined
        ? `Last claimed outside ${automation.name}: no receipt.`
        : note === "unclaimed"
          ? `Never claimed through ${automation.name}.`
          : "",
    ],
  ];
}

function renderReceipts(entry: Entry | undefined, owner: Holdings["owner"], mine: boolean): void {
  const found = shownPayouts.found;
  const tokens = found?.tokens;
  const ml = $("#ml-receipt");
  const de = $("#de-receipt");
  ml.hidden = !entry?.payout || entry.time === undefined;
  de.hidden = !entry?.walk?.claims.length;
  if (entry?.payout && entry.time !== undefined) {
    const { payout } = entry;
    const kvcm = (amounts: Amount[]) => amounts.find(({ token }) => same(token, KVCM))?.amount ?? 0n;
    const all = kvcm(payout.paid) + kvcm(payout.fees) + payout.retiredKvcm;
    const swapped = all - kvcm(payout.earned);
    const share = (part: bigint) => (all ? bps((part * 10_000n + all / 2n) / all) : "");
    const then = !same(payout.owner, owner);
    fill(ml, {
      id: `Account #${payout.id}`,
      from: time(weekStart(entry.time) - WEEK),
      to: time(weekStart(entry.time)),
      "earned-worth": worthWords(payout.earned, found),
      earned: tokenWords(payout.earned, tokens),
      swapped: `${amount(swapped > 0n ? swapped : 0n, 18)} kVCM`,
      "retired-share": share(payout.retiredKvcm),
      retired: `${payout.retiredKvcm ? "−" : ""}${amount(payout.retiredKvcm, 18)} kVCM`,
      tonnes: payout.tonnes ? `${amount(payout.tonnes, 18)} t of carbon credits` : "",
      "fee-share": share(kvcm(payout.fees)),
      fee: tokenWords(payout.fees, tokens, payout.fees.length ? "−" : ""),
      "paid-to": then ? "Paid to its owner then" : mine ? "Paid to you" : "Paid to its owner",
      paid: tokenWords(payout.paid, tokens),
      "paid-worth": worthWords(payout.paid, found),
      recipient: then || !same(payout.recipient, payout.owner) ? addressLink(payout.recipient) : "",
      time: time(entry.time, utc),
      tx: { text: "Transaction", href: txUrl(payout.tx) },
    });
  }
  const walk = entry?.walk;
  if (entry && walk?.claims.length) {
    const { received, fees, paid } = totals(walk.claims);
    const flip = weekStart(entry.time ?? now());
    const elsewhere = walk.claims.some((claim) => !same(claim.owner, owner));
    fill(de, {
      id: `Account #${entry.account.id}`,
      from: time(flip - WEEK),
      to: time(flip),
      "claimed-worth": worthWords(received, found),
      claimed: tokenWords(received, tokens, "", "Nothing"),
      "fee-worth": worthWords(fees, found),
      fee: tokenWords(fees, tokens, fees.length ? "−" : "", "Nothing"),
      "paid-to": mine && !elsewhere ? "Paid to you" : "Paid to its owner",
      "paid-worth": worthWords(paid, found),
      paid: tokenWords(paid, tokens, "", "Nothing"),
      stopped: walk.stopped ? `Last ${WALK_LIMIT} blocks only` : "",
    });
    $("[data-action=swap-these]", de).onclick = () => prefill(paid);
    list(
      $(".claims", de),
      "need",
      walk.claims,
      ({ tx }) => tx,
      (row, { block, caller, owner: to, tx }) => {
        const by = same(caller, owner) ? (mine ? "sent by you" : "sent by its owner") : `sent by ${short(caller)}`;
        fill(row, {
          words: `Block ${block} · ${by}${same(to, owner) ? "" : `, to ${short(to)}`}`,
          link: { text: "Transaction", href: txUrl(tx) },
          button: "",
        });
        $("button", row).hidden = true;
      },
    );
  }
}

// A change's gas for an account that earns nothing, read at most once a minute.
const changeGas = memo(
  ([account, from]: [Account, Holdings["owner"]]) => {
    const automation = AUTOMATIONS.find((each) => joinable(each) && canJoin(account, each, now()))!;
    return gasCost(join([account], automation), from).then(({ wei, prices }) => gasWords(wei, prices));
  },
  60_000,
  ([account, from]) => `${account.id} ${from}`,
);
let changeGasShown: { id: bigint; text: string } | undefined;

export function renderAccount(): void {
  if (!viewing || route().view !== "account") return;
  const found = shown();
  const mineHoldings = own(viewing.id);
  const read = viewing.account;
  if (!mineHoldings && read.value === undefined && !read.reading && !read.failed) read.read().catch(() => {});
  setState(box, found ? "ready" : read.value === null ? "empty" : read.failed && !read.reading ? "failed" : "loading");
  fill(view, { id: `#${viewing.id}`, name: found?.accounts[0]!.name || "Account" });
  if (!found) return;
  const account = found.accounts[0]!;
  const mine = owns(found.owner);
  view.toggleAttribute("data-own", mine && !!mineHoldings);
  const accountStatus = statusOf(account, found.owner, now(), found.epochStart);
  status($("[data-v=status]", view), ...statusWords(accountStatus, mine));
  const earned = earnedByAccount(account);
  const entry = (mineHoldings ? appPayouts : shownPayouts).found?.entries.find(
    (each) => each.account.id === account.id,
  );
  const under = mineHoldings
    ? appPayouts.found && underWay(appPayouts.found)
    : ownerPayouts.found && underWay(ownerPayouts.found);
  const isOverdue = !!mineHoldings && overdue(appPayouts.found, entry);
  const gasShown =
    mineHoldings &&
    ["stopped", "unvoted"].includes(accountStatus.kind) &&
    AUTOMATIONS.some((each) => joinable(each) && canJoin(account, each, now()));
  if (gasShown && session.connection) {
    const id = account.id;
    const shownNow = (text: string) => {
      if (changeGasShown?.id === id && changeGasShown.text === text) return;
      changeGasShown = { id, text };
      update();
    };
    void changeGas([account, session.connection.address]).then(shownNow, () => shownNow(""));
  }
  fill(view, {
    lock: account.amount === 0n ? "Empty" : lockWords(account),
    votes: voteFigure(account.votes),
    earned: earned === null ? "" : earned === undefined ? undefined : money(earned),
    owner: mine ? "" : addressLink(found.owner),
    overdue: isOverdue && entry ? waitsWords(entry, appPayouts.found) : "",
    "earns-nothing": accountStatus.kind === "stopped" ? "yes" : "",
    since: accountStatus.kind === "stopped" ? time(accountStatus.since) : "",
    "change-gas": !gasShown ? "" : changeGasShown?.id === account.id ? changeGasShown.text || "" : undefined,
  });
  for (const element of $$(".underway", view))
    element.hidden = !under?.left.some((each) => each.account.id === account.id);
  for (const button of $$<HTMLElement>("button[data-action]", view)) {
    const [action, kind] = button.dataset.action!.split(":");
    const automation = AUTOMATIONS.find((each) => each.kind === kind);
    button.hidden = !mineHoldings || !(action === "claim" ? isOverdue : can(button, account));
    if (automation) {
      const moves = AUTOMATIONS.some((other) => other !== automation && canLeave(account, other));
      button.textContent = `${moves ? "Move to" : "Join"} ${automation.name}`;
      button.classList.toggle("secondary", moves);
    }
    if (action === "leave") button.textContent = accountStatus.kind === "stopped" ? "Leave automation" : "Leave";
  }
  $("[data-action=vote]", view).hidden = !mineHoldings || accountStatus.kind !== "unvoted";
  // Payouts: the wallet's own in the App's read; anyone else's read here.
  const payoutsOf = mineHoldings ? appPayouts : shownPayouts;
  if (!mineHoldings) void shownPayouts.load(found);
  const member = !!AUTOMATIONS.find((each) => canLeave(account, each) || same(account.delegateAtStart, each.address));
  payoutBox.hidden = !member;
  setState(payoutBox, payoutsOf.found ? "ready" : payoutsOf.failed ? "failed" : "loading");
  if (entry) {
    const [shape, title, lines] = standingWords(entry, mine);
    status($(".states li", payoutBox), shape, title);
    fill(payoutBox, { standing: title, waiting: lines[0]!, moved: lines[1]!, note: lines[2]! });
    // Someone else's account awaiting its payout: its owner's other accounts tell whether one is under way.
    const awaits =
      entry.due &&
      entry.standing &&
      !entry.standing.paid &&
      (entry.standing.waiting.length > 0 || entry.standing.unknown);
    if (!mineHoldings && awaits && ownerRead !== key(found.owner)) {
      ownerRead = key(found.owner);
      readAccounts(found.owner).then(
        (all) => ownerPayouts.load(all),
        (error: unknown) => ((ownerRead = undefined), console.error(error)),
      );
    }
  }
  renderReceipts(entry, found.owner, mine);
  void loadShares(found);
}

export function checkAccount(): void {
  if (!viewing || route().view !== "account") return;
  if (!own(viewing.id) && viewing.account.due()) viewing.account.check();
  shownPayouts.check();
  ownerPayouts.check();
}

export function initAccount(): void {
  onRoute((next) => {
    if (next.view !== "account" || viewing?.id === next.id) return;
    const id = next.id!;
    viewing = {
      id,
      account: reader(
        async () => {
          const found = (await readAccount(id)) ?? null;
          if (found) sawBlock(found.time);
          return found;
        },
        { stale: (found) => !!found && weekStart(now()) > found.epochStart },
      ),
    };
    shownPayouts.forget();
    ownerPayouts.forget();
    ownerRead = undefined;
  });
  for (const button of $$<HTMLElement>("button[data-action]", view))
    button.addEventListener("click", () => {
      const found = viewing && own(viewing.id);
      if (found) act(button, found.accounts);
    });
  $(".again", box).onclick = () => void viewing?.account.refresh().catch(() => {});
  $(".again", payoutBox).onclick = () => (viewing && own(viewing.id) ? appPayouts : shownPayouts).again();
}
