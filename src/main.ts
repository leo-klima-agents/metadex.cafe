import { getAddress, type Address } from "viem";
import { onRoute, route } from "./views.ts";
import { now, same, sawBlock } from "./chain.ts";
import {
  AUTOMATIONS,
  AUTOMAXI,
  AUTOMAXI_FEE_BPS,
  CARBON_IMPACT,
  CHAIN_ID,
  byKind,
  type Automation,
  type Kind,
} from "./config.ts";
import { clone, fill, fillAddress, fillOwn, fillPlural, fillTime, groupAllHex, show } from "./dom.ts";
import {
  WEEK,
  bps,
  count,
  date,
  day,
  earningPower,
  list,
  short,
  toEarningPower,
  units,
  until,
  usd,
  weekStart,
  when,
} from "./format.ts";
import {
  FROM_START,
  LockType,
  automationName,
  canJoin,
  canLeave,
  canLeaveOther,
  failedChecks,
  gasCosts,
  groupOf,
  hasStopped,
  join,
  leave,
  leaveOther,
  paidBpsOf,
  readAccount,
  readAccounts,
  readCarbonImpact,
  readFreshness,
  statusOf,
  type Account,
  type CarbonImpact,
  type Checks,
  type Freshness,
  type Group,
  type Holdings,
  type Status,
  type Step,
} from "./hydrex.ts";
import {
  earnedByAccount,
  earningsDue,
  earningsFailed,
  earningsOf,
  lastEarnings,
  loadEarnings,
  loadShares,
  onEarnings,
  perThousandOf,
  showAbsent,
} from "./last-epoch.ts";
import { payouts, type UnderWay } from "./last-payout.ts";
import { closeReview, openReview, refreshReview, type Hooks } from "./review.ts";
import { hrefOf } from "./routes.ts";
import {
  NoWallet,
  connect,
  declined,
  findWallets,
  safeWallet,
  switchToBase,
  type Connection,
  type Provider,
  type Wallet,
} from "./wallet.ts";

// "self" leaves whichever automation holds an account, the page's or one of Hydrex's.
type Action = "join" | "leave" | "self";
type Member = { account: Account; status: Status; group: Group };

const listening = new WeakSet<Provider>();
const actionable = new WeakMap<HTMLElement, Account[]>();
const positionView = document.querySelector<HTMLElement>('.view[data-view="position"]')!;

let connection: Connection | undefined;
let shown: Holdings | undefined;
let carbonImpact: CarbonImpact | undefined;
let carbonImpactRead: Promise<void> | undefined;
// Until the checks have run, joining is off, and only the automations on Base from the start are shown.
let checks: Checks | undefined;
let reads = 0;
let reading = false;
// Wallet connections that finish are ignored up to this attempt: a later one connected, or the wallet was let go.
let attempts = 0;
let ignoredUpTo = 0;
let clicks = 0;
// The wallet's accounts paid late, and a payout under way, from their payouts.
let late = new Set<bigint>();
let under: UnderWay | undefined;
// The account whose page is shown: the wallet's own, or one read by its number. `folded` once its payout fold was
// opened or closed for it, which the page then leaves to the visitor; `tried`, when its last read began.
type Viewing = {
  id: bigint;
  holdings?: Holdings | undefined;
  none: boolean;
  failed: boolean;
  reading: boolean;
  folded: boolean;
  tried: number;
};
let viewing: Viewing | undefined;
const viewerOwns = (owner: Address): boolean => !!connection && same(owner, connection.address);

// The App reads the wallet's payouts only to mark those paid late; an account's page draws its own.
const appPayouts = payouts(undefined, (found, underWay) => {
  late = new Set(found.entries.flatMap(({ standing, account }) => (standing?.late ? [account.id] : [])));
  under = underWay;
  showUnderWay();
  showAccounts(true);
});
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
    const owner = target?.holdings?.owner;
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

// The page's automations on Base. They decide what the page offers to join; an account's status is read against all.
const present = (): Automation[] => checks?.present ?? FROM_START;

// What differs between the page's automations, kind by kind.
type Traits = {
  // The start of its review's template ids. Carbon Impact's were the page's first, and have none.
  templates: string;
  // Whether joining it shows Carbon Impact's settings, and so waits for them.
  settings: boolean;
  // The share of what its votes earn that reaches the owner, once known.
  paid(): number | undefined;
};
const traits: Record<Kind, Traits> = {
  "carbon-impact": {
    templates: "",
    settings: true,
    paid: () => (carbonImpact ? Number(paidBpsOf(carbonImpact)) / 10_000 : undefined),
  },
  automaxi: { templates: "automaxi-", settings: false, paid: () => Number(10_000n - AUTOMAXI_FEE_BPS) / 10_000 },
};

// Where an automation shows: its row on the menu, and its page.
const placesOf = ({ kind }: Automation): HTMLElement[] => [
  ...document.querySelectorAll<HTMLElement>(`.choice[data-choice="${kind}"], .view[data-kind="${kind}"]`),
];

function failed(error: unknown): void {
  console.error(error);
  show("#error");
}

function showCarbonImpact(found: CarbonImpact): void {
  carbonImpact = found;
  sawBlock(found.time);
  const { epochStart, tonnes, retireBps, entity, beneficiary, beneficiaryAddress, message, voted } = found;
  const { feeBps, maxFeeBps, treasury } = found;
  const stopped = hasStopped(voted, epochStart);
  for (const shape of document.querySelectorAll(".impact-shape")) {
    shape.classList.replace(stopped ? "running" : "stopped", stopped ? "stopped" : "running");
  }
  fill(document, {
    "impact-state": stopped ? "Stopped" : "Running",
    tonnes: units(tonnes),
    retired: bps(retireBps),
    fee: feeBps === undefined ? "…" : bps(feeBps),
    "max-fee": maxFeeBps === undefined ? "…" : bps(maxFeeBps),
    entity,
    beneficiary: beneficiary || "No name",
    message,
  });
  fillAddress(document, "beneficiary-address", beneficiaryAddress);
  if (treasury) {
    fillAddress(document, "treasury", treasury);
    fillAddress(document, "treasury-named", treasury, "its treasury");
  }
  fillTime(document, "next-epoch", epochStart + WEEK, when);
  if (voted) fillTime(document, "impact-voted", voted);
  showRecords();
  tick();
}

function tick(): void {
  catchUp();
  if (!carbonImpact) return;
  const time = now();
  const end = carbonImpact.epochStart + WEEK;
  if (time >= end) return;
  fill(document, { countdown: `in ${until(end - time)}` });
}

// Each automation's line for last epoch, on the menu and on its page: what 1,000 Earning Power earned, and what
// reached the owner.
function showRecords(): void {
  for (const automation of AUTOMATIONS) {
    const per = perThousandOf(automation);
    const paid = traits[automation.kind].paid();
    const absent = !!checks && !present().includes(automation);
    const record = absent
      ? "No record yet"
      : per === undefined
        ? earningsFailed(automation)
          ? "Not read from Base yet. The page tries again in a few minutes."
          : "…"
        : per === null
          ? "No record yet"
          : `${usd(per)} earned per 1,000 Earning Power, ${paid === undefined ? "…" : usd(per * paid)} paid to you`;
    const found = earningsOf(automation);
    for (const place of placesOf(automation)) {
      fill(place, {
        record,
        "record-when": found && typeof per === "number" ? `${day(found.start)} to ${day(found.start + WEEK)}: ` : "",
      });
    }
  }
}

// AutoMaxi's row on the menu, its page and its group, once it is on Base.
let autoMaxiFreshness: Freshness | undefined;

function showAutoMaxi(): void {
  const on = present().includes(AUTOMAXI);
  show('[data-needs="automaxi"]', on);
  show(".automaxi-absent", !!checks && !on);
  if (checks && !on) showAbsent(AUTOMAXI);
  if (!on) return;
  const fresh = autoMaxiFreshness;
  const stopped = !!fresh && hasStopped(fresh.voted, fresh.epochStart);
  const state = !fresh ? "…" : !fresh.voted ? "Not voted yet" : stopped ? "Stopped" : "Running";
  for (const shape of document.querySelectorAll(".automaxi-shape")) {
    shape.classList.remove("idle", "running", "stopped");
    shape.classList.add(!fresh?.voted ? "idle" : stopped ? "stopped" : "running");
  }
  fill(document, { "automaxi-state": state });
  if (fresh?.voted) fillTime(document, "automaxi-voted", fresh.voted);
  show(".automaxi-voted-line", !!fresh?.voted);
}

// One read at a time. Until one succeeds, each tick tries again.
let autoMaxiRead: Promise<void> | undefined;

function readAutoMaxi(): void {
  if (!present().includes(AUTOMAXI)) return;
  autoMaxiRead ??= readFreshness(AUTOMAXI)
    .then((found) => {
      autoMaxiFreshness = found;
      showAutoMaxi();
    }, console.error)
    .finally(() => (autoMaxiRead = undefined));
}

// One read at a time.
const readCarbonImpactAgain = (): Promise<void> =>
  (carbonImpactRead ??= readCarbonImpact()
    .then(showCarbonImpact)
    .finally(() => (carbonImpactRead = undefined)));

// Reads again whatever is missing or from an epoch that has ended, so that the page moves on by itself.
function catchUp(): void {
  const epoch = weekStart(now());
  if (shown && !reading && epoch > shown.epochStart) loadAccounts(true);
  // The wallet's own account moves on with the wallet's accounts. After a failed read, the next waits five minutes.
  const page = onPage();
  const ready = !!page && (!page.failed || Date.now() - page.tried >= 300_000);
  if (ready && page.holdings && epoch > page.holdings.epochStart && !ownHoldings(page.id)) void loadPosition();
  if (!carbonImpact || epoch > carbonImpact.epochStart) readCarbonImpactAgain().catch(console.error);
  if (earningsDue(epoch, present())) loadAllEarnings();
  if (!autoMaxiFreshness || epoch > autoMaxiFreshness.epochStart) readAutoMaxi();
  appPayouts.check();
  if (page) positionPayouts.check();
  if (page) ownerPayouts.check();
}

// Each read of figures, whoever started it, shows on the menu, on the automations' pages and in the accounts' shares.
const loadAllEarnings = (): void => void loadEarnings(present()).catch(console.error);
onEarnings(() => {
  void showShares();
  showAutoMaxi();
  showRecords();
});

// What each account's votes earned last epoch: the wallet's, and that of the account whose page is shown.
async function showShares(): Promise<void> {
  const read = [shown, onPage()?.holdings].flatMap((holdings) => (holdings ? [loadShares(holdings, present())] : []));
  if (!(await Promise.all(read)).includes(true)) return;
  showAccounts(true);
  showPosition();
}

// Each automation whose checks failed: joining it is off, its rows and pages say so, and its page marks the checks.
async function showChecks(): Promise<void> {
  const found = await failedChecks();
  const more = found.present.filter((automation) => !present().includes(automation));
  checks = found;
  for (const automation of AUTOMATIONS) {
    // An automation not on Base has no checks to fail.
    const failing = found.present.includes(automation) ? found.failed.get(automation.kind)! : [];
    const off = failing.length > 0;
    show(`.checks-failed[data-kind="${automation.kind}"]`, off);
    for (const place of placesOf(automation)) {
      show(".state-normal", !off, place);
      show(".state-failed", off, place);
      for (const item of place.querySelectorAll<HTMLElement>("[data-check]")) markCheck(item, failing);
    }
  }
  // An automation newly on Base needs its figures.
  if (more.length) loadAllEarnings();
  if (more.includes(AUTOMAXI)) readAutoMaxi();
  showAutoMaxi();
  showRecords();
  // A read of the accounts that is under way shows the result when it ends.
  if (!reading) showAccounts(true);
  showPosition();
}

// A check that failed says so, with the square and words, before what it checks.
function markCheck(item: HTMLElement, failing: string[]): void {
  item.querySelector(".check-failed")?.remove();
  if (failing.includes(item.dataset.check!)) item.prepend(clone("check-failed"));
}

const automationOf = (button: HTMLButtonElement): Automation | undefined =>
  button.dataset.automation ? byKind(button.dataset.automation) : undefined;

// Joining an automation needs it on Base and its checks passed. Leaving always works.
function joinable(account: Account, automation: Automation | undefined): boolean {
  if (!automation || !checks?.present.includes(automation) || checks.failed.get(automation.kind)!.length) return false;
  return canJoin(account, automation, now());
}
const leavable = (account: Account): boolean => AUTOMATIONS.some((automation) => canLeave(account, automation));
const can: Record<Action, (account: Account, automation?: Automation) => boolean> = {
  join: joinable,
  leave: leavable,
  self: (account) => leavable(account) || canLeaveOther(account),
};
const groups = (): HTMLElement[] => [...document.querySelectorAll<HTMLElement>(".group")];
const buttons = (section: HTMLElement) => [...section.querySelectorAll<HTMLButtonElement>("button[data-action]")];
const actionOf = (button: HTMLButtonElement) => button.dataset.action as Action;
const allows = (button: HTMLButtonElement) => (account: Account) =>
  can[actionOf(button)](account, automationOf(button));

// The accounts a group shows: the App's groups by status; a product's page, the accounts that can join it.
function belongs(group: string, member: Member): boolean {
  const joins = group.startsWith("can:") ? byKind(group.slice(4)) : undefined;
  return joins ? joinable(member.account, joins) : member.group === group;
}

function accountKind({ lockType, end }: Account): string {
  if (lockType === LockType.permanent) return "Protocol Account, locked for good";
  if (lockType === LockType.rolling) return "Flex Account, rolling lock";
  return end ? `Flex Account, lock ${end > now() ? "ends" : "ended"} ${date(end)}` : "Flex Account";
}

// An account's status, in one line, in words to its owner when `own`, and about its owner otherwise.
function statusLine(status: Status, own: boolean): DocumentFragment {
  const line = clone(status.kind);
  fillOwn(line, own);
  if ("date" in status) fillTime(line, "date", status.date);
  if ("voted" in status) fillTime(line, "voted", status.voted);
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
  const name = account.name || "Account";
  fill(item, { name, id: `#${account.id}`, votes: earningPower(account.votes) });
  item.querySelector("a.account-link")!.setAttribute("href", hrefOf({ view: "position", id: account.id }));
  // A group of an automation needs not say its accounts are in it.
  if (status.kind === "in" && group === `in:${status.automation.kind}`) item.querySelector(".status-line")!.remove();
  else item.querySelector(".status")!.replaceWith(statusLine(status, true));
  const earned = earnedByAccount(account.id);
  if (earned !== undefined) {
    fill(item, { "earned-usd": usd(earned) });
    show(".earned", true, item);
  }
  show(".late", late.has(account.id), item);
  if (pickable) {
    const box = item.querySelector<HTMLInputElement>(".pick")!;
    // A hidden box stays disabled, so that a click on its row cannot tick it.
    box.hidden = box.disabled = false;
    box.value = String(account.id);
    box.ariaLabel = `Pick ${name} #${account.id}`;
  }
  return item;
}

// Each group lists its accounts. When its buttons can act on more than one, each gets a box to tick, so that one
// selection is always one action.
function showAccounts(keepTicked = false): void {
  const holdings = shown;
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
    for (const box of section.querySelectorAll<HTMLInputElement>(".pick:not([hidden])"))
      box.checked = kept.has(box.value);
    fill(section, {
      count: `· ${these.length}`,
      "nothing-count": count(these.length, "account with nothing to vote with", "accounts with nothing to vote with"),
    });
    actionable.set(section, able);
    section.hidden = !these.length;
  }
  updateButtons();
  const full = accounts.filter(({ amount }) => amount > 0n);
  show("#none", !full.length);
  show("#accounts, .mine");
  // An automation's page says when none of the wallet's accounts is in it or can join it, once joining it is on: until
  // then, its notices say why none can.
  for (const mine of document.querySelectorAll<HTMLElement>(".mine")) {
    const automation = byKind(mine.closest<HTMLElement>(".view")!.dataset.kind!)!;
    const open = !!checks?.present.includes(automation) && !checks.failed.get(automation.kind)!.length;
    show(".mine-none", open && !mine.querySelector(".group:not([hidden])"), mine);
  }
}

async function loadAccounts(quietly = false): Promise<void> {
  if (!connection) return;
  const read = ++reads;
  reading = true;
  if (!quietly) {
    shown = undefined;
    late = new Set();
    under = undefined;
    appPayouts.forget();
    closeReview();
    show(".accounts-reading");
    show("#accounts, #none, .mine, #underway", false);
    // An account's page drops the actions of the wallet's accounts read before.
    showPosition();
  }
  try {
    const found = await readAccounts(connection.address);
    if (read !== reads) return;
    sawBlock(found.time);
    shown = found;
    showAccounts();
    appPayouts.show(found);
    catchUp();
    void showShares();
    syncPosition();
  } catch (error) {
    if (read === reads) failed(error);
  } finally {
    if (read === reads) {
      reading = false;
      show(".accounts-reading", false);
    }
  }
}

// A group's ticked accounts, or the one account it can act on, which has no box.
function picked(section: HTMLElement): Account[] {
  const accounts = actionable.get(section) ?? [];
  if (accounts.length <= 1) return accounts;
  const ids = new Set([...section.querySelectorAll<HTMLInputElement>(".pick:checked")].map(({ value }) => value));
  return accounts.filter(({ id }) => ids.has(String(id)));
}

function updateButtons(): void {
  for (const section of groups()) {
    const able = actionable.get(section) ?? [];
    const accounts = picked(section);
    for (const button of buttons(section)) {
      const allowed = allows(button);
      const verb = (button.dataset.verb ??= button.textContent?.trim() ?? "");
      const n = accounts.filter(allowed).length;
      button.hidden = !able.some(allowed);
      button.disabled = !n;
      button.textContent = able.length > 1 && n ? `${verb} with ${count(n, "account", "accounts")}` : verb;
    }
    show(".buttons", able.length > 0, section);
    show(".pick-hint", able.length > 1 && !accounts.length, section);
  }
}

const hooks: Hooks = {
  closed: (submitted) => submitted && loadAccounts(true),
  switched: showConnection,
};

// A button's review of the accounts it can act on: a group's picked accounts, or an account's page's own. `redraw`
// shows them again when none can be acted on any more.
function act(button: HTMLButtonElement, accountsOf: () => Account[], redraw: () => void): void {
  if (!connection || !shown) return;
  // In a new epoch, the statuses and dates shown would be wrong: read the accounts again instead.
  if (weekStart(now()) > shown.epochStart) return void loadAccounts();
  const action = actionOf(button);
  const automation = automationOf(button);
  // A join of Carbon Impact shows its settings, so it waits for them. Leaving never waits.
  if (action === "join" && automation && traits[automation.kind].settings && !carbonImpact) {
    return void readCarbonImpactAgain().then(() => act(button, accountsOf, redraw), failed);
  }
  const accounts = accountsOf().filter(allows(button));
  if (!accounts.length) return redraw();
  review(accounts, action, automation);
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
  const power = accounts.reduce((sum, { votes }) => sum + toEarningPower(votes), 0n);
  const thousands = Number(power) / 1e21;
  const [week, gas] = [".estimate-week", ".estimate-gas"].map((part) => element.querySelector(part)!) as [
    Element,
    Element,
  ];
  const noEstimate = "Last epoch's figures could not be read, so the page gives no estimate.";
  lastEarnings(automation)
    .then(() => perThousandOf(automation))
    .then(
      (per) => {
        const paid = traits[automation.kind].paid();
        week.textContent =
          per === null
            ? `${automation.name} has no record yet, so the page gives no estimate.`
            : per === undefined || paid === undefined
              ? noEstimate
              : `At last epoch's rate, ${usd(per * thousands * paid)} a week would reach you: an estimate, not a promise.`;
      },
      () => (week.textContent = noEstimate),
    );
  gasCosts()(join(accounts, automation), owner).then(
    (dollars) => (gas.textContent = dollars === undefined ? "" : `The change costs ${usd(dollars)} in gas.`),
    console.error,
  );
}

// The review of a join, or of leaving: "leave" leaves the page's automations, and "self" also Hydrex's others.
function review(accounts: Account[], action: Action, automation?: Automation): void {
  if (!connection || !shown) return;
  const { owner, epochStart } = shown;
  const settings = carbonImpact;
  const which = list(accounts.map(({ id }) => `#${id}`));
  const prepare = (id: string): DocumentFragment => {
    const part = clone(id);
    fill(part, { which });
    fillTime(part, "next", epochStart + WEEK, when);
    fillPlural(part, accounts.length);
    if (settings) {
      fill(part, {
        retired: bps(settings.retireBps),
        fee: settings.feeBps === undefined ? "…" : bps(settings.feeBps),
        "max-fee": settings.maxFeeBps === undefined ? "…" : bps(settings.maxFeeBps),
        entity: settings.entity,
      });
    }
    return part;
  };
  const checkOf = ({ kind }: Automation) => hrefOf({ view: "product", kind, section: "check" });
  if (action === "join" && automation) {
    const prefix = traits[automation.kind].templates;
    const before = prepare(`${prefix}join-before`);
    const statuses = accounts.map((account) => ({ account, status: statusOf(account, owner, now(), epochStart) }));
    const stopped = statuses.flatMap(({ account, status }) => (status.kind === "stopped" ? [account] : []));
    // Accounts in a running automation, the page's other one included, move out of it.
    const running = statuses.flatMap(({ account, status }) => {
      if (status.kind === "other") return [`#${account.id} out of ${status.name}`];
      const elsewhere = "automation" in status && status.kind !== "left" && status.automation !== automation;
      return elsewhere ? [`#${account.id} out of ${status.automation.name}`] : [];
    });
    fill(before, {
      "stopped-which": list(stopped.map(({ id, delegate }) => `#${id} is in ${automationName(delegate)}`)),
      "running-which": list(running),
    });
    show(".from-stopped", stopped.length > 0, before);
    show(".from-running", running.length > 0, before);
    estimate(before.querySelector(".estimate")!, accounts, automation, owner);
    const pages = [{ title: "Before you join", body: before }, { title: "What your wallet will ask" }];
    const steps = join(accounts, automation);
    const done = prepare(`${prefix}join-done`);
    return openReview(`Join ${automation.name}`, pages, steps, checkOf(automation), connection, hooks, done);
  }
  const { steps, from, names } = leaveAll(accounts, action === "self");
  const title = `Leave ${list(names)}`;
  const effects = prepare(from.length ? "leave-effects" : "leave-other-effects");
  fill(effects, { automations: list(names) });
  if (from[0]) {
    const more = hrefOf({ view: "product", kind: from[0].kind, section: "joining" });
    effects.querySelector(".more-leaving")!.setAttribute("href", more);
  }
  openReview(title, [{ title, body: effects }], steps, checkOf(from[0] ?? CARBON_IMPACT), connection, hooks);
}

// A payout under way: a line in the App, and on the page of each account it has not reached yet.
function showUnderWay(): void {
  const notice = document.getElementById("underway")!;
  notice.hidden = !under;
  if (under) {
    fill(notice, {
      "underway-paid": list(under.paid.map(({ account }) => `#${account.id}`)),
      "underway-left": list(under.left.map(({ account }) => `#${account.id}`)),
    });
    fillTime(notice, "underway-day", under.first);
  }
  showPosition();
}

// The wallet's own account, as its holdings of that account alone.
function ownHoldings(id: bigint): Holdings | undefined {
  const account = shown?.accounts.find((each) => each.id === id);
  return shown && account && { ...shown, accounts: [account] };
}

// The account whose page is shown, if any. Its page reads and draws only while shown.
function onPage(): Viewing | undefined {
  const shownRoute = route();
  return viewing && shownRoute.view === "position" && shownRoute.id === viewing.id ? viewing : undefined;
}

// The wallet's accounts were read again. On its page, an account that the wallet held when read is read again by its
// number: it may have just left the wallet.
function syncPosition(): void {
  const target = onPage();
  const held = target?.holdings;
  if (target && !ownHoldings(target.id) && held && shown && same(held.owner, shown.owner)) void loadPosition();
  else showPosition();
}

// One read at a time. The wallet's own accounts are read already.
async function loadPosition(): Promise<void> {
  const target = onPage();
  if (!target) return;
  if (target.reading || ownHoldings(target.id)) return showPosition();
  Object.assign(target, { reading: true, failed: false, tried: Date.now() });
  showPosition();
  try {
    const found = await readAccount(target.id);
    if (found) sawBlock(found.time);
    Object.assign(target, { holdings: found, none: !found });
    // An account that is gone, as when it was merged, has no payouts to follow.
    if (!found) [positionPayouts, ownerPayouts].forEach((each) => each.forget());
    void showShares();
  } catch (error) {
    console.error(error);
    target.failed = true;
  } finally {
    target.reading = false;
  }
  showPosition();
}

// An account's page: its status, its lock, what it earned, what its owner can do, and its payouts.
function showPosition(): void {
  const target = onPage();
  if (!target) return;
  const view = positionView;
  const own = ownHoldings(target.id);
  if (own) Object.assign(target, { holdings: own, none: false, failed: false });
  const { holdings } = target;
  const state = holdings ? "found" : target.none ? "none" : target.failed ? "failed" : "reading";
  for (const name of ["reading", "none", "failed", "found"]) show(`.position-${name}`, name === state, view);
  // A read that failed says so, over what an earlier one found.
  if (target.failed) show(".position-failed", true, view);
  fill(view, { "position-id": `#${target.id}` });
  showActions(own?.accounts[0]);
  if (!holdings) {
    document.title = `Account #${target.id} · metaDEX Café`;
    return void fill(view, { "position-name": "Account" });
  }
  const account = holdings.accounts[0]!;
  const { owner, epochStart, payout } = holdings;
  const status = statusOf(account, owner, now(), epochStart);
  const name = account.name || "Account";
  const theirs = !viewerOwns(owner);
  document.title = `${name} #${account.id} · metaDEX Café`;
  fill(view, {
    "position-name": name,
    "position-kind": account.amount === 0n ? "Empty" : accountKind(account),
    "position-votes": earningPower(account.votes),
  });
  view.querySelector(".position-status")!.replaceChildren(statusLine(status, !theirs));
  const earned = earnedByAccount(account.id);
  if (earned !== undefined) fill(view, { "position-earned": usd(earned) });
  show(".position-earned-row", earned !== undefined, view);
  show(".position-owner-row", theirs, view);
  fillAddress(view, "position-owner", owner, short(owner));
  show(".position-stopped", status.kind === "stopped", view);
  if (status.kind === "stopped") fillTime(view, "position-since", status.since);
  const underWay = own ? under : ownerUnder;
  show(".position-underway", !!underWay?.left.some((entry) => entry.account.id === account.id), view);
  // Carbon Impact pays an owner's accounts to one address, once read, which shows where it is not the owner's own. The
  // fold opens by itself once: then it stays as the visitor leaves it.
  const inImpact = [account.delegate, account.claimer, account.delegateAtStart].some((address) =>
    same(address, CARBON_IMPACT.address),
  );
  const paidTo = inImpact ? payout : undefined;
  const fold = view.querySelector<HTMLDetailsElement>(".position-payout")!;
  fold.hidden = !paidTo;
  if (paidTo) {
    if (!target.folded) fold.open = !same(paidTo, owner);
    target.folded = true;
    fillAddress(view, "payout-owner", owner);
    fillAddress(view, "payout-to", paidTo);
    show(".payout-itself", same(paidTo, owner), view);
  }
  fillOwn(view, !theirs);
  positionPayouts.show(holdings);
}

// What the wallet can do with its own account, on its page. A join from one of the page's automations is a move.
const actions = positionView.querySelector<HTMLElement>(".position-actions")!;

function showActions(account: Account | undefined): void {
  let any = false;
  for (const button of buttons(actions)) {
    const allowed = !!connection && !!account && allows(button)(account);
    const automation = automationOf(button);
    if (automation) {
      const moves = !!account && AUTOMATIONS.some((other) => other !== automation && canLeave(account, other));
      button.textContent = `${moves ? "Move to" : "Join"} ${automation.name}`;
    }
    button.hidden = !allowed;
    any ||= allowed;
  }
  actions.hidden = !any;
}

// An account's page reads the account each time it shows, unless the wallet holds it.
onRoute((next) => {
  if (next.view !== "position") return;
  if (viewing?.id !== next.id) {
    viewing = { id: next.id, none: false, failed: false, reading: false, folded: false, tried: 0 };
    [positionPayouts, ownerPayouts].forEach((each) => each.forget());
    ownerUnder = ownerRead = undefined;
  }
  void loadPosition();
});

function showConnection(): void {
  show(".wallet-slot", !connection);
  show(".to-app .open", !connection);
  show(".to-app .wallet-state", !!connection);
  show("#epoch", !!connection);
  show("#wrong-chain", !!connection && connection.chainId !== CHAIN_ID);
  if (connection) {
    const { wallet, address, chainId } = connection;
    fill(document, { "wallet-short": short(address) });
    if (chainId === CHAIN_ID) show("#switch-failed", false);
    show(".to-switch", !wallet.propose);
    show(".safe-elsewhere", !!wallet.propose);
  }
  refreshReview();
}

async function connectTo(wallet: Wallet): Promise<void> {
  const attempt = ++attempts;
  const connected = await connect(wallet);
  if (!connected || attempt <= ignoredUpTo) return;
  ignoredUpTo = attempt;
  show(".wallet-failed, .no-wallet", false);
  listen(connected.provider);
  connection = connected;
  showConnection();
  loadAccounts();
}

function listen(provider: Provider): void {
  if (listening.has(provider)) return;
  listening.add(provider);
  provider.on?.("accountsChanged", ([account]: string[]) => {
    if (connection?.provider !== provider) return;
    // Wallets also send this when the account stays the same, as when they unlock.
    if (account && same(account, connection.address)) return;
    closeReview();
    // A wallet that locks shares no account.
    if (!account) return letGo();
    connection.address = getAddress(account);
    showConnection();
    loadAccounts();
  });
  provider.on?.("chainChanged", (chainId: string) => {
    if (connection?.provider !== provider) return;
    connection.chainId = Number(chainId);
    showConnection();
  });
  provider.on?.("disconnect", () => {
    if (connection?.provider === provider) letGo();
  });
}

function letGo(): void {
  ignoredUpTo = attempts;
  reads++;
  reading = false;
  connection = shown = under = undefined;
  late = new Set();
  appPayouts.forget();
  closeReview();
  showConnection();
  show(".accounts-reading, #accounts, #none, .mine, #underway", false);
  showPosition();
}

function walletButton(wallet: Wallet): DocumentFragment {
  const item = clone("wallet");
  fill(item, { name: wallet.name });
  if (wallet.icon) Object.assign(item.querySelector("img")!, { src: wallet.icon, hidden: false });
  item.querySelector("button")!.addEventListener("click", () => {
    const click = ++clicks;
    show(".wallet-failed, .no-wallet", false);
    fill(document, { "connecting-wallet": wallet.name });
    show(".connecting");
    connectTo(wallet)
      .catch((error) => {
        if (click !== clicks || declined(error)) return;
        if (error instanceof NoWallet) return show(".no-wallet");
        console.error(error);
        fill(document, { "failed-wallet": wallet.name });
        show(".wallet-failed");
      })
      .finally(() => {
        if (click === clicks) show(".connecting", false);
      });
  });
  return item;
}

for (const slot of document.querySelectorAll(".wallet-slot")) slot.append(clone("wallet-picker"));
groupAllHex(document);
// A reload keeps the hash, and so the view.
document.querySelector("#error .again")!.addEventListener("click", () => location.reload());
document.addEventListener("change", (event) => {
  if ((event.target as Element).matches(".group .pick")) updateButtons();
});
for (const section of groups()) {
  for (const button of buttons(section))
    button.addEventListener("click", () => act(button, () => picked(section), updateButtons));
}
for (const button of buttons(actions)) {
  button.addEventListener("click", () =>
    act(button, () => (viewing && ownHoldings(viewing.id)?.accounts) ?? [], showPosition),
  );
}
document.querySelector("#wrong-chain .switch")!.addEventListener("click", () => {
  if (!connection) return;
  show("#switch-failed", false);
  switchToBase(connection).then(showConnection, (error) => {
    if (declined(error)) return;
    console.error(error);
    show("#switch-failed");
  });
});
positionView.querySelector(".position-again")!.addEventListener("click", () => void loadPosition());

findWallets((wallets) => {
  for (const place of document.querySelectorAll(".wallet-buttons")) place.replaceChildren(...wallets.map(walletButton));
});
safeWallet()
  .then((wallet) => wallet && connectTo(wallet))
  .catch(console.error);
readCarbonImpactAgain().catch(failed);
showChecks().catch(failed);
loadAllEarnings();
setInterval(() => showChecks().catch(console.error), 3_600_000);
setInterval(tick, 30_000);
