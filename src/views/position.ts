import { now, same, sawBlock } from "../chain.ts";
import { AUTOMATIONS } from "../config.ts";
import { PENDING, fill, fillAddress, fillOwn, fillTime, live, setText, show } from "../dom.ts";
import { money, short, voteFigure, weekStart } from "../format.ts";
import {
  canLeave,
  gasCosts,
  join,
  readAccount,
  readAccounts,
  statusOf,
  type Account,
  type Holdings,
  type Status,
} from "../hydrex.ts";
import { earnedByAccount, loadShares } from "../last-epoch.ts";
import { payouts, type UnderWay } from "../last-payout.ts";
import { reader, type Reader } from "../read.ts";
import { gasWords } from "../swap-calls.ts";
import {
  accountKind,
  accountName,
  act,
  allows,
  automationOf,
  buttons,
  joinable,
  showAccounts,
  statusLine,
} from "./accounts.ts";
import { showRecords } from "./automations.ts";
import { session, shown, viewerOwns, views } from "./page.ts";
import { overdueEntry, owed, waitsLine } from "./payouts.ts";
import { onRoute, route } from "./router.ts";

// An account's page: the wallet's own, or any read by its number, with its status, its lock, what it earned, what its
// owner can do, and its payouts.

const positionView = document.querySelector<HTMLElement>('.view[data-view="position"]')!;

// The account whose page is shown: the wallet's own, or one read by its number, null if there is none, read each time
// its page shows, again in each new epoch, and five minutes after a read that failed; and what its page showed last.
type Viewing = { id: bigint; account: Reader<Holdings | null>; held?: Holdings | undefined };
let viewing: Viewing | undefined;

const pageName = (name: string): string => name || "Account";

// An account's page that is not the wallet's tells a payout under way from its owner's other accounts, which it reads
// once while the account awaits its payout.
let ownerUnder: UnderWay | undefined;
let ownerRead: string | undefined;
const ownerPayouts = payouts(undefined, (_, underWay) => {
  ownerUnder = underWay;
  showPosition();
});
const positionPayouts = payouts(
  positionView.querySelector<HTMLElement>(".position-payouts")!,
  ({ entries }) => {
    const target = onPage();
    const owner = target && holdingsOf(target)?.owner;
    const awaits = entries.some(
      ({ due, standing }) => due && standing && !standing.paid && (standing.waiting.length > 0 || standing.unknown),
    );
    if (!target || !owner || ownHoldings(target.id) || !awaits || ownerRead === owner.toLowerCase()) return;
    ownerRead = owner.toLowerCase();
    readAccounts(owner).then(
      (holdings) => onPage() === target && ownerPayouts.show(holdings),
      (error) => {
        // The payouts' next check tries again.
        ownerRead = undefined;
        console.error(error);
      },
    );
  },
  viewerOwns,
);

// What each account's votes earned last epoch: the wallet's, and that of the account whose page is shown, in an
// automation or through whoever voted with it, mostly its owner. Then the wallet's own votes beside Hydrex's average.
// Only the pages that show them read them: a holder that voted this epoch takes thousands of reads.
function showsShares(): boolean {
  return ["hydrex", "product", "position"].includes(route().view);
}
export async function showShares(): Promise<void> {
  if (!showsShares()) return;
  const page = onPage();
  const read = [shown(), page && holdingsOf(page)].flatMap((holdings) => (holdings ? [loadShares(holdings)] : []));
  if (!(await Promise.all(read)).includes(true)) return;
  showAccounts(true);
  showPosition();
  showRecords();
}

// The wallet's own account, as its holdings of that account alone.
export function ownHoldings(id: bigint): Holdings | undefined {
  const holdings = shown();
  const account = holdings?.accounts.find((each) => each.id === id);
  return holdings && account && { ...holdings, accounts: [account] };
}

// What an account's page shows: the wallet's own account, or what was read by its number.
const holdingsOf = (target: Viewing): Holdings | undefined =>
  ownHoldings(target.id) ?? target.account.value ?? undefined;

// The account whose page is shown, if any. Its page reads and draws only while shown.
function onPage(): Viewing | undefined {
  const shownRoute = route();
  return viewing && shownRoute.view === "position" && shownRoute.id === viewing.id ? viewing : undefined;
}

// The wallet's accounts were read again. On its page, an account that the wallet held when read is read again by its
// number: it may have just left the wallet.
export function syncPosition(): void {
  const target = onPage();
  const held = target?.held;
  const holdings = shown();
  if (target && !ownHoldings(target.id) && held && holdings && same(held.owner, holdings.owner)) loadPosition();
  else showPosition();
}

// Reads the account shown, or joins the read under way. The wallet's own accounts are read already.
export function loadPosition(): void {
  const target = onPage();
  if (!target) return;
  if (!ownHoldings(target.id)) target.account.read().catch(() => {});
  showPosition();
}

// What the read of an account by its number found, once it ends.
function positionRead(target: Viewing): void {
  const found = target.account.value;
  if (found) sawBlock(found.time);
  // An account that is gone, as when it was merged, has no payouts to follow.
  if (found === null && onPage() === target) [positionPayouts, ownerPayouts].forEach((each) => each.forget());
  void showShares();
  showPosition();
}

// An account's page: its status, its lock, what it earned, what its owner can do, and its payouts.
export function showPosition(): void {
  const target = onPage();
  if (!target) return;
  const view = positionView;
  const own = ownHoldings(target.id);
  const read = target.account;
  // Not the wallet's, or no longer, as once it is let go or another is connected, and never read by its number: read
  // now, so that it never shows as read with no read under way.
  if (!own && read.value === undefined && !read.reading && !read.failed) read.read().catch(() => {});
  const holdings = holdingsOf(target);
  target.held = holdings;
  // A read under way shows as one, even after one that failed, as when Try again was clicked.
  const failed = !own && read.failed && !read.reading;
  const state = holdings ? "found" : !own && read.value === null ? "none" : failed ? "failed" : "reading";
  for (const name of ["reading", "none", "failed", "found"]) show(`.position-${name}`, name === state, view);
  // A read that failed says so, over what an earlier one found.
  if (failed) show(".position-failed", true, view);
  fill(view, { "position-id": `#${target.id}` });
  const mine = own?.accounts[0];
  showActions(mine, mine && statusOf(mine, own.owner, now(), own.epochStart));
  if (!holdings) {
    document.title = `Hydrex account #${target.id} · metaDEX Café`;
    return void fill(view, { "position-name": pageName("") });
  }
  const account = holdings.accounts[0]!;
  const { owner, epochStart } = holdings;
  const status = statusOf(account, owner, now(), epochStart);
  const name = accountName(account.name);
  const theirs = !viewerOwns(owner);
  document.title = `${name} #${account.id} · metaDEX Café`;
  fill(view, {
    "position-name": pageName(account.name),
    "position-kind": account.amount === 0n ? "Empty" : accountKind(account),
    "position-votes": voteFigure(account.votes),
  });
  view.querySelector(".position-status")!.replaceChildren(statusLine(status, !theirs));
  // What its votes earned last epoch, its place kept while read.
  const earned = earnedByAccount(account);
  show(".position-earned-row", earned !== null, view);
  if (earned !== null) fill(view, { "position-earned": earned === undefined ? PENDING : () => money(earned) });
  show(".position-owner-row", theirs, view);
  fillAddress(view, "position-owner", owner, short(owner));
  show(".position-stopped", status.kind === "stopped", view);
  // The wallet's own account in Double Espresso says when its payout is overdue, with Claim now among its actions.
  const owing = own ? overdueEntry(account.id) : undefined;
  show(".position-overdue", !!owing, view);
  if (owing) fill(view, { "overdue-waits": waitsLine(owing) });
  if (status.kind === "stopped") fillTime(view, "position-since", status.since);
  const underWay = own ? owed.under : ownerUnder;
  show(".position-underway", !!underWay?.left.some((entry) => entry.account.id === account.id), view);
  fillOwn(view, !theirs);
  positionPayouts.show(holdings);
}

// What the wallet can do with its own account, on its page. A join from one of the page's automations is a move.
const actions = positionView.querySelector<HTMLElement>(".position-actions")!;

// The gas of a change for an account that earns nothing: what moving it would cost, without projecting what it would
// earn. Read again after a minute, as the gas price is, found or failed, or for another automation or wallet. Pending
// until read for the account shown, rather than another account's.
const changeGas = new Map<string, { at: number; words: Promise<() => string> }>();
let changeGasShown: string | undefined;

function showChangeGas(account: Account | undefined, status: Status | undefined): void {
  const { connection } = session;
  const line = actions.querySelector<HTMLElement>(".position-gas")!;
  const automation = account && AUTOMATIONS.find((each) => joinable(account, each));
  line.hidden = !connection || !automation || !status || !["stopped", "unvoted"].includes(status.kind);
  if (line.hidden || !account || !automation || !connection) return;
  const from = connection.address;
  const key = `${account.id} ${automation.kind} ${from}`;
  let found = changeGas.get(key);
  if (!found || Date.now() - found.at >= 60_000) {
    const words = gasCosts()(join([account], automation), from).then(
      ({ wei, prices }) =>
        () =>
          gasWords(wei, prices),
    );
    changeGas.set(key, (found = { at: Date.now(), words }));
    words.catch((error) => console.error(error));
  }
  const { words } = found;
  const id = account.id;
  const cost = line.querySelector(".change-gas")!;
  if (changeGasShown !== key) setText(cost, PENDING);
  words.then(
    (text) => {
      if (onPage()?.id !== id) return;
      changeGasShown = key;
      live(cost, text);
    },
    () => onPage()?.id === id && (line.hidden = true),
  );
}

function showActions(account: Account | undefined, status?: Status): void {
  const { connection } = session;
  let any = false;
  showChangeGas(account, status);
  const vote = actions.querySelector<HTMLElement>(".vote-on-hydrex")!;
  vote.hidden = !connection || status?.kind !== "unvoted";
  any ||= !vote.hidden;
  for (const button of buttons(actions)) {
    const allowed = !!connection && !!account && allows(button)(account);
    const automation = automationOf(button);
    if (automation) {
      const moves = !!account && AUTOMATIONS.some((other) => other !== automation && canLeave(account, other));
      button.textContent = `${moves ? "Move to" : "Join"} ${automation.name}`;
      // A move is a secondary action, as in the groups of Hydrex's page.
      button.classList.toggle("secondary", moves);
    }
    // Leaving an automation that stopped says so, as in its group on Hydrex's page.
    if (button.dataset.action === "self")
      button.textContent = status?.kind === "stopped" ? "Leave automation" : "Leave";
    button.hidden = !allowed;
    any ||= allowed;
  }
  actions.hidden = !any;
}

// Reads again what an account's page shows, when due: the account, as each new epoch, and its payouts.
export function catchUpPosition(): void {
  const page = onPage();
  if (!page) return;
  if (!ownHoldings(page.id) && page.account.due()) loadPosition();
  positionPayouts.check();
  ownerPayouts.check();
}

// An account's page: read each time it shows, its buttons, and how it is drawn again.
export function initPosition(): void {
  views.position = showPosition;
  // An account's page reads the account each time it shows, unless the wallet holds it.
  onRoute((next) => {
    if (next.view !== "position") return;
    if (viewing?.id !== next.id) {
      const { id } = next;
      const target: Viewing = {
        id,
        account: reader(async () => (await readAccount(id)) ?? null, {
          stale: (found) => !!found && weekStart(now()) > found.epochStart,
          settled: () => positionRead(target),
        }),
      };
      viewing = target;
      [positionPayouts, ownerPayouts].forEach((each) => each.forget());
      ownerUnder = ownerRead = undefined;
    }
    loadPosition();
  });
  for (const button of buttons(actions)) {
    button.addEventListener("click", () =>
      act(button, () => (viewing && ownHoldings(viewing.id)?.accounts) ?? [], showPosition),
    );
  }
  positionView.querySelector(".position-again")!.addEventListener("click", loadPosition);
}
