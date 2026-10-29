import type { Address } from "viem";
import { now } from "../chain.ts";
import { AUTOMATIONS, MATCHA_LATTE, byKind, type Automation } from "../config.ts";
import { PENDING, busy, clone, fill, fillAddress, fillOwn, fillPlural, fillTime, live, show } from "../dom.ts";
import { WEEK, bps, count, date, day, list, money, moneyAt, short, utc, voteWords, weekStart } from "../format.ts";
import {
  LockType,
  canJoin,
  canLeave,
  canLeaveOther,
  gasCosts,
  groupOf,
  join,
  leave,
  leaveOther,
  statusOf,
  type Account,
  type Group,
  type Status,
  type Step,
} from "../hydrex.ts";
import { earnedByAccount, lastEarnings, perThousandOf } from "../last-epoch.ts";
import { hrefOf } from "../routes.ts";
import { gasWords } from "../swap-calls.ts";
import { checks, matchaLatte, takesWords, traits } from "./automations.ts";
import { openClaim } from "./claim.ts";
import { failed, hooks, session, shown, views } from "./page.ts";
import { overdueEntry, owed } from "./payouts.ts";
import { openReview } from "./review.ts";

// The wallet's Hydrex accounts, in groups, on Hydrex's page and on each automation's: their statuses, what their votes
// earned, the boxes that pick them, and the reviews of what their buttons do.

// "self" leaves whichever automation holds an account, the page's or one of Hydrex's; "claim" claims its rewards
// through Double Espresso, while its payout is overdue.
export type Action = "join" | "leave" | "self" | "claim";
type Member = { account: Account; status: Status; group: Group };

const actionable = new WeakMap<HTMLElement, Account[]>();

// "Account" alone means an address in crypto, so the page says "Hydrex account": "Hydrex account #9540", or "Hydrex
// Main Protocol Account #26432" for one its owner named. An account's own page says "Account #9540", or the name its
// owner gave it, as is: its title already leads back through Hydrex. So do the bills, whose calls go to Hydrex.
export const accountName = (name: string): string =>
  !name ? "Hydrex account" : /^hydrex\b/i.test(name) ? name : `Hydrex ${name}`;

export const automationOf = (button: HTMLButtonElement): Automation | undefined =>
  button.dataset.automation ? byKind(button.dataset.automation) : undefined;

// Joining an automation needs its checks passed. Leaving always works.
export function joinable(account: Account, automation: Automation | undefined): boolean {
  if (!automation || !checks.value || checks.value.failed.get(automation.kind)!.length) return false;
  return canJoin(account, automation, now());
}
const leavable = (account: Account): boolean => AUTOMATIONS.some((automation) => canLeave(account, automation));
const can: Record<Action, (account: Account, automation?: Automation) => boolean> = {
  join: joinable,
  leave: leavable,
  self: (account) => leavable(account) || canLeaveOther(account),
  claim: (account) => !!overdueEntry(account.id),
};
export const groups = (): HTMLElement[] => [...document.querySelectorAll<HTMLElement>(".group")];
export const buttons = (section: HTMLElement) => [
  ...section.querySelectorAll<HTMLButtonElement>("button[data-action]"),
];
export const actionOf = (button: HTMLButtonElement) => button.dataset.action as Action;
export const allows = (button: HTMLButtonElement) => (account: Account) =>
  can[actionOf(button)](account, automationOf(button));

// The accounts a group shows: the App's groups by status; a product's page, the accounts that can join it.
function belongs(group: string, member: Member): boolean {
  const joins = group.startsWith("can:") ? byKind(group.slice(4)) : undefined;
  return joins ? joinable(member.account, joins) : member.group === group;
}

export function accountKind({ lockType, end }: Account): string {
  if (lockType === LockType.permanent) return "Protocol, permanent";
  if (lockType === LockType.rolling) return "Flex, rolling";
  return end ? `Flex, ${end > now() ? "ends" : "ended"} ${date(end)}` : "Flex";
}

// A day of this year, or a date with its year: an owner may not have voted for longer than a year.
export const inYear = (time: number): ((time: number) => string) =>
  new Date(time * 1000).getUTCFullYear() === new Date(now() * 1000).getUTCFullYear() ? day : date;

// An account's status, in one line, in words to its owner when `own`, and about its owner otherwise.
export function statusLine(status: Status, own: boolean): DocumentFragment {
  const line = clone(status.kind);
  fillOwn(line, own);
  if ("date" in status) fillTime(line, "date", status.date);
  if ("voted" in status && status.voted) fillTime(line, "voted", status.voted, inYear(status.voted));
  if (status.kind === "unvoted") {
    show(".unvoted-since", status.voted > 0, line);
    show(".unvoted-never", !status.voted, line);
  }
  if ("name" in status) fill(line, { automation: status.name });
  if ("automation" in status) {
    fill(line, { "automation-name": status.automation.name });
    line
      .querySelector("a.automation-link")
      ?.setAttribute("href", hrefOf({ view: "product", kind: status.automation.kind }));
  }
  if ("to" in status) fillAddress(line, "address", status.to, short(status.to));
  return line;
}

function accountItem({ account, status }: Member, group: string, pickable: boolean): DocumentFragment {
  const item = clone("account");
  const name = accountName(account.name);
  fill(item, { name, id: `#${account.id}`, votes: voteWords(account.votes) });
  item.querySelector("a.account-link")!.setAttribute("href", hrefOf({ view: "position", id: account.id }));
  // A group of an automation needs not say its accounts are in it.
  if (status.kind === "in" && group === `in:${status.automation.kind}`) item.querySelector(".status-line")!.remove();
  else item.querySelector(".status")!.replaceWith(statusLine(status, true));
  // What its votes earned last epoch, its place kept while read.
  const earned = earnedByAccount(account);
  show(".earned", earned !== null, item);
  if (earned !== null) fill(item, { "earned-worth": earned === undefined ? PENDING : () => money(earned) });
  show(".late", owed.late.has(account.id), item);
  if (pickable) {
    const box = item.querySelector<HTMLInputElement>(".pick")!;
    // Only a box that can act shows: the template's is hidden and disabled, so that nothing, not even a keyboard or a
    // script, can tick an account whose group cannot act on it.
    box.hidden = box.disabled = false;
    box.value = String(account.id);
    box.ariaLabel = `Pick ${name} #${account.id}`;
  }
  return item;
}

// The boxes each group shows, by account number.
const boxesShown = new WeakMap<HTMLElement, Set<string>>();

// Each group lists its accounts. When its buttons can act on more than one, each gets a box to tick, so that one
// selection is always one action.
export function showAccounts(keepTicked = false): void {
  const holdings = shown();
  if (!holdings) return;
  const { owner, accounts, epochStart } = holdings;
  const time = now();
  const members = accounts.map((account): Member => {
    const status = statusOf(account, owner, time, epochStart);
    return { account, status, group: groupOf(account, status) };
  });
  for (const section of groups()) {
    const group = section.dataset.group!;
    const kept = new Set(
      keepTicked ? [...section.querySelectorAll<HTMLInputElement>(".pick:checked")].map(({ value }) => value) : [],
    );
    const these = members.filter((member) => belongs(group, member));
    const tests = buttons(section).map(allows);
    const able = these.map(({ account }) => account).filter((account) => tests.some((test) => test(account)));
    const items = section.querySelector(":scope > .accounts");
    items?.replaceChildren(
      ...these.map((member) => accountItem(member, group, able.length > 1 && able.includes(member.account))),
    );
    // What needs its owner starts ticked, as one remedy fits each of its groups; the other groups start with none. A box
    // starts ticked when it first shows, as when the checks pass after the accounts were drawn, and keeps what was
    // picked then.
    const before = (keepTicked && boxesShown.get(section)) || new Set<string>();
    const boxes = [...section.querySelectorAll<HTMLInputElement>(".pick:not([hidden])")];
    for (const box of boxes)
      box.checked = kept.has(box.value) || (group.startsWith("needs:") && !before.has(box.value));
    boxesShown.set(section, new Set(boxes.map(({ value }) => value)));
    // Those folded away are without votes, unless one has some but less than one. Among them, the locks that ended with
    // HYDX still in them, which their owner can withdraw.
    const some = these.some(({ account }) => account.votes > 0n);
    const ended = these.filter(({ status }) => status.kind === "ended").length;
    fill(section, {
      count: `· ${these.length}`,
      "nothing-count": [
        some
          ? count(these.length, "Hydrex account with less than one vote", "Hydrex accounts with less than one vote")
          : count(these.length, "Hydrex account without votes", "Hydrex accounts without votes"),
        ...(ended ? [`${ended} with HYDX to withdraw`] : []),
      ].join(" · "),
    });
    actionable.set(section, able);
    // Accounts their owner votes with, who did not vote, are voted with on Hydrex.
    show(
      ".vote-on-hydrex",
      these.some(({ status }) => status.kind === "unvoted"),
      section,
    );
    section.hidden = !these.length;
  }
  updateButtons();
  // On the menu, how many of the wallet's accounts each automation holds, as the App counts them.
  for (const automation of AUTOMATIONS) {
    const n = members.filter(
      ({ status }) => (status.kind === "in" || status.kind === "joined") && status.automation === automation,
    ).length;
    for (const line of document.querySelectorAll<HTMLElement>(
      `.choice[data-choice="${automation.kind}"] .yours-count`,
    )) {
      line.hidden = !n;
      line.textContent = `Yours: ${count(n, "Hydrex account", "Hydrex accounts")}`;
    }
  }
  const full = accounts.filter(({ amount }) => amount > 0n);
  show("#none", !full.length);
  show("#accounts, .mine");
  // An automation's page says when none of the wallet's accounts is in it or can join it, once joining it is on: until
  // then, its notices say why none can.
  for (const mine of document.querySelectorAll<HTMLElement>(".mine")) {
    const automation = byKind(mine.closest<HTMLElement>(".view")!.dataset.kind!)!;
    const open = !!checks.value && !checks.value.failed.get(automation.kind)!.length;
    show(".mine-none", open && !mine.querySelector(".group:not([hidden])"), mine);
  }
}

// A group's ticked accounts, or the one account it can act on, which has no box.
export function picked(section: HTMLElement): Account[] {
  const accounts = actionable.get(section) ?? [];
  if (accounts.length <= 1) return accounts;
  const ids = new Set([...section.querySelectorAll<HTMLInputElement>(".pick:checked")].map(({ value }) => value));
  return accounts.filter(({ id }) => ids.has(String(id)));
}

export function updateButtons(): void {
  for (const section of groups()) {
    const able = actionable.get(section) ?? [];
    const accounts = picked(section);
    for (const button of buttons(section)) {
      const allowed = allows(button);
      const verb = (button.dataset.verb ??= button.textContent?.trim() ?? "");
      button.hidden = !able.some(allowed);
      // How many are ticked is said once, beside the box that ticks them all.
      button.disabled = !accounts.some(allowed);
      button.textContent = verb;
    }
    // The link to vote on Hydrex shows even when none of its group's accounts can join, as before the checks.
    const vote = section.querySelector<HTMLElement>(".vote-on-hydrex");
    show(".buttons", able.length > 0 || (!!vote && !vote.hidden), section);
    // With boxes to tick: one that ticks them all, and what is ticked.
    const all = section.querySelector<HTMLLabelElement>(".pick-all");
    const tickedAll = all?.querySelector("input");
    if (!all || !tickedAll) continue;
    all.hidden = able.length <= 1;
    tickedAll.checked = accounts.length === able.length;
    tickedAll.indeterminate = accounts.length > 0 && accounts.length < able.length;
    const summary = section.querySelector<HTMLElement>(".picked")!;
    summary.hidden = able.length <= 1 || !accounts.length;
    const votes = accounts.reduce((sum, account) => sum + account.votes, 0n);
    summary.textContent = `${accounts.length} of ${able.length} · ${voteWords(votes)}`;
  }
}

// A button's review of the accounts it can act on: a group's picked accounts, or an account's page's own. `redraw`
// shows them again when none can be acted on any more.
export function act(button: HTMLButtonElement, accountsOf: () => Account[], redraw: () => void): void {
  const holdings = shown();
  if (!session.connection || !holdings) return;
  // In a new epoch, the statuses and dates shown would be wrong: read the accounts again instead.
  if (weekStart(now()) > holdings.epochStart) return void views.loadAccounts();
  const action = actionOf(button);
  const automation = automationOf(button);
  if (action === "claim") return claim(accountsOf().filter(allows(button)), redraw, button);
  // A join of Matcha Latte shows its settings, so it waits for them. Leaving never waits.
  if (action === "join" && automation && traits[automation.kind].settings && !matchaLatte.value) {
    return void matchaLatte.read().then(() => act(button, accountsOf, redraw), failed);
  }
  const accounts = accountsOf().filter(allows(button));
  if (!accounts.length) return redraw();
  review(accounts, action, automation);
}

// The review of a claim through Double Espresso for the accounts whose payout is overdue.
// What waits can take a while to read, for an account not claimed for in two epochs: the button spins meanwhile, and
// takes no second click.
let claiming = false;

export function claim(accounts: Account[], redraw: () => void, button?: HTMLButtonElement): void {
  const entries = accounts.flatMap((account) => overdueEntry(account.id) ?? []);
  const { connection } = session;
  if (!connection || !entries.length) return redraw();
  if (claiming) return;
  claiming = true;
  if (button) busy(button);
  openClaim(entries, connection, hooks)
    .catch(failed)
    .finally(() => {
      claiming = false;
      if (button) busy(button, false);
      redraw();
    });
}

// Leaving the page's automations that hold the accounts' approvals, and, when `listed`, those on Hydrex's list.
function leaveAll(accounts: Account[], listed = true): { steps: Step[]; from: Automation[]; names: string[] } {
  const from = AUTOMATIONS.filter((automation) => accounts.some((account) => canLeave(account, automation)));
  const steps = accounts.flatMap((account) =>
    from.flatMap((automation) => (canLeave(account, automation) ? leave([account], automation) : [])),
  );
  const others = listed ? leaveOther(accounts.filter(canLeaveOther)) : [];
  const names = [...from.map(({ name }) => name), ...new Set(others.flatMap(({ automation }) => automation ?? []))];
  return { steps: [...steps, ...others], from, names };
}

// What the accounts would have been paid in a week at last epoch's rate, and the gas of the change. Each shows once
// read: last epoch's figures can take long to read the first time.
function estimate(element: Element, accounts: Account[], automation: Automation, owner: Address): void {
  const votes = accounts.reduce((sum, account) => sum + account.votes, 0n);
  const thousands = Number(votes) / 1e21;
  const [week, gas] = [".estimate-week", ".estimate-gas"].map((part) => element.querySelector(part)!) as [
    Element,
    Element,
  ];
  const noEstimate = "Not read";
  lastEarnings(automation)
    .then(() => perThousandOf(automation))
    .then(
      (per) => {
        const paid = traits[automation.kind].paid();
        if (per && paid !== undefined) live(week, () => money(moneyAt(per.value * thousands * paid, per)));
        else fill(element, { "estimate-week": per === null ? "No record yet" : noEstimate });
      },
      () => fill(element, { "estimate-week": noEstimate }),
    );
  // Without ETH's price, in the ETH that pays it.
  gasCosts()(join(accounts, automation), owner).then(
    ({ wei, prices }) => live(gas, () => gasWords(wei, prices)),
    (error) => {
      console.error(error);
      fill(element, { "estimate-gas": "Not read" });
    },
  );
}

// The review of a join, or of leaving: "leave" leaves the page's automations, and "self" also Hydrex's others.
export function review(accounts: Account[], action: Action, automation?: Automation): void {
  const holdings = shown();
  const { connection } = session;
  if (!connection || !holdings) return;
  const { owner, epochStart } = holdings;
  const settings = matchaLatte.value;
  const prepare = (id: string): DocumentFragment => {
    const part = clone(id);
    fillTime(part, "next", epochStart + WEEK, utc);
    fillPlural(part, accounts.length);
    if (settings) {
      // What Matcha Latte keeps of the rewards not claimed yet: the share retired, and its fee unless it is none, or
      // any fee while it is not read.
      const { retireBps, feeBps } = settings;
      const fee = feeBps === 0n ? "" : feeBps === undefined ? " and any fee" : ` and the ${bps(feeBps)} fee`;
      fill(part, { takes: takesWords(retireBps, feeBps), "takes-fee": fee });
    }
    return part;
  };
  const checkOf = ({ kind }: Automation) => hrefOf({ view: "product", kind, section: "check" });
  if (action === "join" && automation) {
    const prefix = traits[automation.kind].templates;
    // Which automation each account leaves, if any, its call says on the next page.
    const before = prepare(`${prefix}join-before`);
    estimate(before.querySelector(".estimate")!, accounts, automation, owner);
    const pages = [{ title: "Before you join", body: before }, {}];
    const steps = join(accounts, automation);
    const done = prepare(`${prefix}join-done`);
    return void openReview({
      name: `Join ${automation.name}`,
      pages,
      steps,
      checkHref: checkOf(automation),
      connection,
      hooks,
      outcome: done,
    });
  }
  const { steps, from, names } = leaveAll(accounts, action === "self");
  const title = `Leave ${list(names)}`;
  const effects = prepare(from.length ? "leave-effects" : "leave-other-effects");
  // Once left, the votes are the owner's, to vote with on Hydrex each week.
  openReview({
    name: title,
    pages: [{ title, body: effects }],
    steps,
    checkHref: checkOf(from[0] ?? MATCHA_LATTE),
    connection,
    hooks,
    outcome: prepare("leave-done"),
  });
}

// Each group's boxes and buttons, and how the groups are drawn again.
export function initAccounts(): void {
  views.accounts = showAccounts;
  document.addEventListener("change", (event) => {
    const target = event.target as HTMLInputElement;
    if (target.matches(".pick-all input")) {
      for (const box of target.closest(".group")!.querySelectorAll<HTMLInputElement>(".pick:not([hidden])"))
        box.checked = target.checked;
    }
    if (target.matches(".group :is(.pick, .pick-all input)")) updateButtons();
  });
  for (const section of groups()) {
    for (const button of buttons(section))
      button.addEventListener("click", () => act(button, () => picked(section), updateButtons));
  }
}
