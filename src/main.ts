import { getAddress, type Address } from "viem";
import { onRoute, route } from "./views.ts";
import { now, same, sawBlock } from "./chain.ts";
import {
  AUTOMATIONS,
  AUTOMAXI,
  AUTOMAXI_FEE_BPS,
  CARBON_IMPACT,
  CHAIN_ID,
  SWAPPERS,
  byKind,
  type Automation,
  type Kind,
} from "./config.ts";
import {
  PENDING,
  busy,
  clone,
  fill,
  fillAddress,
  fillOwn,
  fillPlural,
  fillTime,
  groupAllHex,
  isOpen,
  live,
  pendAll,
  setText,
  show,
  type Text,
} from "./dom.ts";
import {
  WEEK,
  bps,
  count,
  date,
  day,
  earningPower,
  figure,
  fraction,
  list,
  money,
  moneyAt,
  setCurrency,
  short,
  toEarningPower,
  units,
  until,
  utc,
  weekStart,
  when,
  type Currency,
} from "./format.ts";
import {
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
  averagePerThousand,
  earnedByAccount,
  earningsDue,
  earningsFailed,
  lastEarnings,
  loadEarnings,
  loadAverage,
  loadShares,
  onEarnings,
  perThousandOf,
  automationVersus,
  ownPerThousand,
  ownVersus,
} from "./last-epoch.ts";
import { UNDER_WAY, payouts, type Entry, type Found, type UnderWay } from "./last-payout.ts";
import { waitingWords } from "./receipts.ts";
import { RETRY, reader, type Reader } from "./read.ts";
import { closeReview, openReview, refreshReview, type Hooks } from "./review.ts";
import { hrefOf } from "./routes.ts";
import { openClaim } from "./claim-view.ts";
import { gasWords } from "./swap-calls.ts";
import { allowancesLeft, initSwap, onSwapChange, resetReview, swapLine, walletChanged } from "./swap-view.ts";
import { describe } from "./tokens.ts";
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

// "self" leaves whichever automation holds an account, the page's or one of Hydrex's; "claim" claims its rewards
// through AutoMaxi, while its payout is overdue.
type Action = "join" | "leave" | "self" | "claim";
type Member = { account: Account; status: Status; group: Group };

const listening = new WeakSet<Provider>();
const actionable = new WeakMap<HTMLElement, Account[]>();
const positionView = document.querySelector<HTMLElement>('.view[data-view="position"]')!;

let connection: Connection | undefined;
// The wallet's Hydrex accounts, read anew for each wallet, again in each new epoch, after each review that sent
// something, and five minutes after a read that failed.
let owned: Reader<Holdings> | undefined;
const shown = (): Holdings | undefined => owned?.value;
// Carbon Impact's settings: read again in each new epoch, and five minutes after a read that left some unread. Until one
// succeeds, at each tick, its figures say they could not be read.
const impact: Reader<CarbonImpact> = reader(readCarbonImpact, {
  retry: 0,
  stale: (found, since) =>
    weekStart(now()) > found.epochStart ||
    ([found.voted, found.feeBps, found.maxFeeBps, found.treasury].includes(undefined) && since >= RETRY),
  settled: () => showCarbonImpact(),
});

// AutoMaxi's state, on the menu and its page: "Checking…" until read, and "Not read yet" while its reads fail, which
// each tick tries again. Read again in each new epoch.
const autoMaxi: Reader<Freshness> = reader(() => readFreshness(AUTOMAXI), {
  retry: 0,
  stale: (fresh) => weekStart(now()) > fresh.epochStart,
  settled: () => showAutoMaxi(),
});

// The checks of each automation, before anyone can join it: until they have run, joining is off. They run again each
// hour.
const checks: Reader<Checks> = reader(failedChecks, {
  stale: (_, since) => since >= 3_600_000,
  settled: () => showChecks(),
});

// Wallet connections that finish are ignored up to this attempt: a later one connected, or the wallet was let go.
let attempts = 0;
let ignoredUpTo = 0;
let clicks = 0;
// The wallet's accounts paid late, a payout under way, and what their payouts' last read found.
let late = new Set<bigint>();
let under: UnderWay | undefined;
let appFound: Found | undefined;
// How many times the payouts were read: an overdue line is of one read, and drawn again with the next.
let appReads = 0;
// The account whose page is shown: the wallet's own, or one read by its number, null if there is none, read each time
// its page shows, again in each new epoch, and five minutes after a read that failed; and what its page showed last.
type Viewing = { id: bigint; account: Reader<Holdings | null>; held?: Holdings | undefined };
let viewing: Viewing | undefined;
const viewerOwns = (owner: Address): boolean => !!connection && same(owner, connection.address);

// "Account" alone means an address in crypto, so the page says "Hydrex account": "Hydrex account #9540", or "Hydrex
// Main Protocol Account #26432" for one its owner named. An account's own page says "Account #9540", or the name its
// owner gave it, as is: its title already leads back through Hydrex. So do the bills, whose calls go to Hydrex.
const accountName = (name: string): string =>
  !name ? "Hydrex account" : /^hydrex\b/i.test(name) ? name : `Hydrex ${name}`;
const pageName = (name: string): string => name || "Account";

// The App reads the wallet's payouts to mark those paid late and those overdue; an account's page draws its own.
const appPayouts = payouts(
  undefined,
  (found, underWay) => {
    late = new Set(found.entries.flatMap(({ standing, account }) => (standing?.late ? [account.id] : [])));
    under = underWay;
    appFound = found;
    appReads++;
    showUnderWay();
    showAccounts(true);
    showApp();
  },
  undefined,
  // An overdue payout says what waits in tokens, then at prices now, once read: rewrite() writes its lines again, in the
  // App and on the account's page, with nothing to draw anew.
  () => {},
);

// An account's payout through AutoMaxi is overdue when something waits for it and its keeper has not paid it: half a day
// after the flip, the time a payout takes, for the epoch that just ended, or once it is late for the one before. Only
// the wallet's own accounts, while AutoMaxi holds their claims: a claim pays the owner, whoever calls.
function overdueEntry(id: bigint): Entry | undefined {
  const entry = appFound?.entries.find(({ account }) => account.id === id);
  if (!entry || !appFound || entry.automation !== AUTOMAXI || !entry.standing || !entry.earnings) return undefined;
  if (!same(entry.account.claimer, AUTOMAXI.address) || !shown()?.accounts.some((account) => account.id === id)) return;
  const { standing } = entry;
  const waits = standing.waiting.length > 0 || standing.unknown;
  const missed = entry.due && !standing.paid && waits && now() - appFound.epochStart >= UNDER_WAY;
  return missed || standing.late ? entry : undefined;
}
const overdue = (): Entry[] =>
  (shown()?.accounts ?? []).flatMap((account) => {
    const entry = overdueEntry(account.id);
    return entry ? [entry] : [];
  });

// What waits for an overdue account, in words, at prices now, or else in tokens: "≈ $1.84 in 9 tokens".
function waitsLine({ standing }: Entry): () => string {
  const { waiting, unknown, late } = standing!;
  // The read it is of, whose prices may come after.
  const read = appFound;
  return () => {
    const { worth, partial, tokens } = waitingWords(waiting, read?.waiting);
    if (!tokens) return "from the epoch before last";
    return `${unknown || late || partial ? "at least " : ""}${worth ? `${worth} in ${tokens}` : tokens}`;
  };
}
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

// What differs between the page's automations, kind by kind.
type Traits = {
  // The start of its review's template ids. Carbon Impact's were the page's first, and have none.
  templates: string;
  // Whether joining it shows Carbon Impact's settings, and so waits for them.
  settings: boolean;
  // The share of what its votes earn that reaches the owner, once known: Carbon Impact's needs its fee read.
  paid(): number | undefined;
};
const traits: Record<Kind, Traits> = {
  "carbon-impact": {
    templates: "",
    settings: true,
    paid: () => {
      const paid = impact.value && paidBpsOf(impact.value);
      return paid === undefined ? undefined : Number(paid) / 10_000;
    },
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

// A status, on the menu and on an automation's page: its shape and its words. Until read, "Checking…", in a quiet ring.
function showState(shapes: string, words: string, shape: string, state: string): void {
  for (const each of document.querySelectorAll(`.${shapes}`)) {
    each.classList.remove("checking", "idle", "running", "stopped");
    each.classList.add(shape);
  }
  fill(document, { [words]: state });
}

// What Carbon Impact takes: "33.33% retired, 1% fee", the fee said to be unread when its read failed. The page says
// "Not read yet" of what it reads again by itself, and "Not read" of what it does not.
const feeWords = (feeBps: bigint | undefined): string =>
  feeBps === undefined ? "fee not read yet" : `${bps(feeBps)} fee`;

function showCarbonImpact(): void {
  const found = impact.value;
  if (!found) return carbonImpactFailed();
  sawBlock(found.time);
  const { epochStart, tonnes, retireBps, entity, beneficiary, beneficiaryAddress, message, voted } = found;
  const { feeBps, maxFeeBps, treasury } = found;
  // Whether it runs depends on when it last voted: unread, the status says so rather than guess.
  const stopped = voted !== undefined && hasStopped(voted, epochStart);
  const [shape, state]: [string, string] =
    voted === undefined ? ["idle", "Not read yet"] : stopped ? ["stopped", "Stopped"] : ["running", "Running"];
  showState("impact-shape", "impact-state", shape, state);
  fill(document, {
    "impact-voted-words": stopped ? " since " : " · voted ",
    tonnes: `${units(tonnes)} t`,
    retired: bps(retireBps),
    takes: `${bps(retireBps)} retired, ${feeWords(feeBps)}`,
    "takes-sub": `retired, ${feeWords(feeBps)}`,
    "max-takes": `100% retired, ${feeWords(maxFeeBps)}`,
    entity,
    beneficiary: beneficiary || "No name",
    message,
  });
  fillAddress(document, "beneficiary-address", beneficiaryAddress);
  if (treasury) {
    fillAddress(document, "treasury", treasury);
    fillAddress(document, "treasury-named", treasury, "its treasury");
  } else {
    // Not a link to where an earlier read found it.
    for (const link of document.querySelectorAll("a.treasury, a.treasury-named")) link.removeAttribute("href");
    fill(document, { treasury: "Not read yet" });
  }
  fillTime(document, "next-epoch", epochStart + WEEK, when);
  fillTime(document, "epoch-end", epochStart + WEEK, utc);
  if (voted) fillTime(document, "impact-voted", voted);
  show(".impact-voted-line", !!voted);
  show(".countdown-line");
  showRecords();
  tick();
}

// Carbon Impact's settings could not be read, and none were before: its figures say so, rather than stay pending, until
// a read succeeds.
function carbonImpactFailed(): void {
  showState("impact-shape", "impact-state", "idle", "Not read yet");
  for (const name of ["tonnes", "retired", "takes", "max-takes", "treasury"])
    fill(document, { [name]: "Not read yet" });
  fill(document, { "takes-sub": "" });
  // Without the block's time, the epoch's end is only Thursday's.
  show(".countdown-line", false);
  showRecords();
}

function tick(): void {
  catchUp();
  showApp();
  if (!impact.value) return;
  const time = now();
  const end = impact.value.epochStart + WEEK;
  if (time >= end) return;
  fill(document, { countdown: `in ${until(end - time)}` });
}

// Each automation's figures for last epoch, on the menu and on its page, for each 1,000 Earning Power: what its votes
// earned, beside Hydrex's average, then what reached the owner after its cut.
function showRecords(): void {
  for (const automation of AUTOMATIONS) {
    const per = perThousandOf(automation);
    const paid = traits[automation.kind].paid();
    const record =
      per === undefined
        ? earningsFailed(automation)
          ? "Not read yet"
          : PENDING
        : per === null
          ? "No record yet"
          : () => money(per);
    // What reached the owner, once what the automation takes is read too; without it, the line hides.
    const waits = automation === CARBON_IMPACT && !impact.value && !impact.failed;
    const toYou: Text | (() => Text) =
      per && paid !== undefined ? () => `${money(moneyAt(per.value * paid, per))} to you` : per && waits ? PENDING : "";
    // On the menu, how it compares with the average, as voting yourself does; what it takes is on the same row.
    const versus = automationVersus(automation);
    for (const row of document.querySelectorAll<HTMLElement>(`.choice[data-choice="${automation.kind}"]`)) {
      show(".record-versus", versus !== undefined, row);
      if (versus !== undefined) fill(row, { "record-versus": versusWords(versus) });
    }
    for (const place of placesOf(automation)) {
      // The menu compares what the votes earned, and leaves what reached the owner to the automation's page.
      const menu = place.classList.contains("choice");
      const unit = menu ? "/ 1k Earning Power" : "earned, per 1,000 Earning Power";
      fill(place, { record, "record-unit": per ? unit : "", ...(!menu && { "record-paid": toYou }) });
    }
  }
  // Beside them, what voting yourself earned: Hydrex's average, and, with a wallet, its own votes, and how they compare.
  const average = averagePerThousand();
  fill(document, {
    average: average === undefined ? PENDING : average === null ? "Not read yet" : () => money(average),
  });
  show(".average-unit", average !== null);
  const holdings = connection ? shown() : undefined;
  const yours = holdings && ownPerThousand(holdings);
  show("#vote-yourself .yours", !!holdings);
  fill(document, {
    "yours-average":
      yours === undefined
        ? PENDING
        : yours === null
          ? "Not read yet"
          : yours === "none"
            ? "No votes of your own"
            : yours === "unvoted"
              ? "Didn't vote"
              : () => money(yours),
  });
  const known = !!yours && typeof yours === "object";
  show(".yours-unit", yours === undefined || known);
  const ratio = holdings && known ? ownVersus(holdings) : undefined;
  show(".yours-versus", ratio !== undefined);
  if (ratio !== undefined) fill(document, { "yours-versus": versusWords(ratio) });
}

// How some votes compare with Hydrex's average, in words and ink, not colour: "44.7% below the average".
const versusWords = (ratio: number): string =>
  Math.abs(ratio - 1) < 0.005
    ? "About the average"
    : `${fraction(Math.abs(ratio - 1))} ${ratio > 1 ? "above" : "below"} the average`;

// All of Hydrex is thousands of reads: only the pages that show its average read it.
const showsAverage = (): boolean => ["hydrex", "product"].includes(route().view);
const readAverage = (): void => {
  if (showsAverage()) void loadAverage().then((changed) => changed && showRecords());
};
onRoute(() => {
  readAverage();
  void showShares();
});

// AutoMaxi's state, on the menu and its page.
function showAutoMaxi(): void {
  const fresh = autoMaxi.value;
  const stopped = !!fresh && hasStopped(fresh.voted, fresh.epochStart);
  const [shape, state]: [string, string] = !fresh
    ? autoMaxi.failed
      ? ["idle", "Not read yet"]
      : ["checking", "Checking…"]
    : !fresh.voted
      ? ["idle", "Not voted yet"]
      : stopped
        ? ["stopped", "Stopped"]
        : ["running", "Running"];
  showState("automaxi-shape", "automaxi-state", shape, state);
  fill(document, { "automaxi-voted-words": stopped ? " since " : " · voted " });
  if (fresh?.voted) fillTime(document, "automaxi-voted", fresh.voted);
  show(".automaxi-voted-line", !!fresh?.voted);
}

// Reads again whatever is missing or from an epoch that has ended, so that the page moves on by itself.
function catchUp(): void {
  if (owned?.due()) void loadAccounts(true);
  // The wallet's own account moves on with the wallet's accounts.
  const page = onPage();
  if (page && !ownHoldings(page.id) && page.account.due()) loadPosition();
  impact.check();
  checks.check();
  if (earningsDue(AUTOMATIONS)) loadAllEarnings();
  readAverage();
  // Reads what the accounts' votes earned that failed before, once due again.
  void showShares();
  autoMaxi.check();
  appPayouts.check();
  if (page) positionPayouts.check();
  if (page) ownerPayouts.check();
}

// Each read of figures, whoever started it, shows on the menu, on the automations' pages and in the accounts' shares.
const loadAllEarnings = (): void => void loadEarnings(AUTOMATIONS).catch(console.error);
onEarnings(() => {
  void showShares();
  readAverage();
  showAutoMaxi();
  showRecords();
});

// What each account's votes earned last epoch: the wallet's, and that of the account whose page is shown, in an
// automation or through whoever voted with it, mostly its owner. Then the wallet's own votes beside Hydrex's average.
// Only the pages that show them read them: a holder that voted this epoch takes thousands of reads.
function showsShares(): boolean {
  return ["hydrex", "product", "position"].includes(route().view);
}
async function showShares(): Promise<void> {
  if (!showsShares()) return;
  const page = onPage();
  const read = [shown(), page && holdingsOf(page)].flatMap((holdings) => (holdings ? [loadShares(holdings)] : []));
  if (!(await Promise.all(read)).includes(true)) return;
  showAccounts(true);
  showPosition();
  showRecords();
}

// Each automation whose checks failed: joining it is off, its rows and pages say so, and its page marks the checks.
function showChecks(): void {
  const found = checks.value;
  if (!found) return;
  for (const automation of AUTOMATIONS) {
    const failing = found.failed.get(automation.kind)!;
    const off = failing.length > 0;
    show(`.checks-failed[data-kind="${automation.kind}"]`, off);
    for (const place of placesOf(automation)) {
      show(".state-normal", !off, place);
      show(".state-failed", off, place);
      for (const item of place.querySelectorAll<HTMLElement>("[data-check]")) markCheck(item, failing);
    }
  }
  showAutoMaxi();
  showRecords();
  // A read of the accounts that is under way shows the result when it ends.
  if (!owned?.reading) showAccounts(true);
  showPosition();
}

// A check that failed says so, with the square and words, before what it checks.
function markCheck(item: HTMLElement, failing: string[]): void {
  item.querySelector(".check-failed")?.remove();
  if (failing.includes(item.dataset.check!)) item.prepend(clone("check-failed"));
}

const automationOf = (button: HTMLButtonElement): Automation | undefined =>
  button.dataset.automation ? byKind(button.dataset.automation) : undefined;

// Joining an automation needs its checks passed. Leaving always works.
function joinable(account: Account, automation: Automation | undefined): boolean {
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
  if (lockType === LockType.permanent) return "Protocol, permanent";
  if (lockType === LockType.rolling) return "Flex, rolling";
  return end ? `Flex, ${end > now() ? "ends" : "ended"} ${date(end)}` : "Flex";
}

// A day of this year, or a date with its year: an owner may not have voted for longer than a year.
const inYear = (time: number): ((time: number) => string) =>
  new Date(time * 1000).getUTCFullYear() === new Date(now() * 1000).getUTCFullYear() ? day : date;

// An account's status, in one line, in words to its owner when `own`, and about its owner otherwise.
function statusLine(status: Status, own: boolean): DocumentFragment {
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
  fill(item, { name, id: `#${account.id}`, votes: earningPower(account.votes) });
  item.querySelector("a.account-link")!.setAttribute("href", hrefOf({ view: "position", id: account.id }));
  // A group of an automation needs not say its accounts are in it.
  if (status.kind === "in" && group === `in:${status.automation.kind}`) item.querySelector(".status-line")!.remove();
  else item.querySelector(".status")!.replaceWith(statusLine(status, true));
  const earned = earnedByAccount(account.id);
  if (earned !== undefined) {
    fill(item, { "earned-worth": () => money(earned) });
    show(".earned", true, item);
  }
  show(".late", late.has(account.id), item);
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
function showAccounts(keepTicked = false): void {
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
    // What needs its owner starts ticked, as one action fits it all; the other groups start with none. A box starts
    // ticked when it first shows, as when the checks pass after the accounts were drawn, and keeps what was picked then.
    const before = (keepTicked && boxesShown.get(section)) || new Set<string>();
    const boxes = [...section.querySelectorAll<HTMLInputElement>(".pick:not([hidden])")];
    for (const box of boxes) box.checked = kept.has(box.value) || (group === "needs" && !before.has(box.value));
    boxesShown.set(section, new Set(boxes.map(({ value }) => value)));
    // Among those without votes, the locks that ended with HYDX still in them, which their owner can withdraw.
    const ended = these.filter(({ status }) => status.kind === "ended").length;
    fill(section, {
      count: `· ${these.length}`,
      "nothing-count": [
        count(these.length, "Hydrex account without votes", "Hydrex accounts without votes"),
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

// Reads the wallet's accounts. Unless `quietly`, as for another wallet, what was shown goes first; a quiet read keeps it
// until the new one ends, and drops a read under way, which may not see a transaction just sent.
async function loadAccounts(quietly = false): Promise<void> {
  if (!connection) return;
  if (!quietly || !owned) {
    const { address } = connection;
    owned?.forget();
    owned = reader(() => readAccounts(address), { stale: (found) => weekStart(now()) > found.epochStart });
    appFound = undefined;
    late = new Set();
    under = undefined;
    appPayouts.forget();
    closeReview();
    show(".accounts-reading");
    show("#accounts, #none, .mine, #underway, .yours-count", false);
    // An account's page drops the actions of the wallet's accounts read before.
    showPosition();
    showApp();
  }
  const these = owned;
  const current = () => owned === these;
  try {
    const found = await these.refresh();
    if (!current() || these.value !== found) return;
    sawBlock(found.time);
    showAccounts();
    showApp();
    appPayouts.show(found);
    catchUp();
    void showShares();
    syncPosition();
  } catch (error) {
    if (current() && !these.reading) failed(error);
  } finally {
    if (current() && !these.reading) {
      show(".accounts-reading", false);
      showApp();
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
      button.hidden = !able.some(allowed);
      // How many are ticked is said once, beside the box that ticks them all.
      button.disabled = !accounts.some(allowed);
      button.textContent = verb;
    }
    // Needs you's link to vote on Hydrex shows even when none of its accounts can join or leave, as before the checks.
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
    const power = accounts.reduce((sum, { votes }) => sum + votes, 0n);
    summary.textContent = `${accounts.length} of ${able.length} · ${earningPower(power)} Earning Power`;
  }
}

const hooks: Hooks = {
  closed: (submitted) => submitted && loadAccounts(true),
  switched: showConnection,
};

// A button's review of the accounts it can act on: a group's picked accounts, or an account's page's own. `redraw`
// shows them again when none can be acted on any more.
function act(button: HTMLButtonElement, accountsOf: () => Account[], redraw: () => void): void {
  const holdings = shown();
  if (!connection || !holdings) return;
  // In a new epoch, the statuses and dates shown would be wrong: read the accounts again instead.
  if (weekStart(now()) > holdings.epochStart) return void loadAccounts();
  const action = actionOf(button);
  const automation = automationOf(button);
  if (action === "claim") return claim(accountsOf().filter(allows(button)), redraw, button);
  // A join of Carbon Impact shows its settings, so it waits for them. Leaving never waits.
  if (action === "join" && automation && traits[automation.kind].settings && !impact.value) {
    return void impact.read().then(() => act(button, accountsOf, redraw), failed);
  }
  const accounts = accountsOf().filter(allows(button));
  if (!accounts.length) return redraw();
  review(accounts, action, automation);
}

// The review of a claim through AutoMaxi for the accounts whose payout is overdue.
// What waits can take a while to read, for an account whose keeper missed two epochs: the button spins meanwhile, and
// takes no second click.
let claiming = false;

function claim(accounts: Account[], redraw: () => void, button?: HTMLButtonElement): void {
  const entries = accounts.flatMap((account) => overdueEntry(account.id) ?? []);
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
  const power = accounts.reduce((sum, { votes }) => sum + toEarningPower(votes), 0n);
  const thousands = Number(power) / 1e21;
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
function review(accounts: Account[], action: Action, automation?: Automation): void {
  const holdings = shown();
  if (!connection || !holdings) return;
  const { owner, epochStart } = holdings;
  const settings = impact.value;
  const prepare = (id: string): DocumentFragment => {
    const part = clone(id);
    fillTime(part, "next", epochStart + WEEK, utc);
    fillPlural(part, accounts.length);
    if (settings) fill(part, { takes: `${bps(settings.retireBps)} retired, ${feeWords(settings.feeBps)}` });
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
  openReview({
    name: title,
    pages: [{ title, body: effects }],
    steps,
    checkHref: checkOf(from[0] ?? CARBON_IMPACT),
    connection,
    hooks,
  });
}

// The App: what needs you across the products, each with one action, then the products, each with what you hold in it,
// and what this wallet allows the café's contracts to do.
const appView = document.querySelector<HTMLElement>('.view[data-view="app"]')!;

function need(
  shape: string,
  words: string | (() => string),
  act: { link?: string; button?: (event: MouseEvent) => void; label: string },
): DocumentFragment {
  const item = clone("need");
  item.querySelector(".shape")!.classList.add(shape);
  fill(item, { "need-words": words });
  const link = item.querySelector<HTMLAnchorElement>(".need-link")!;
  const button = item.querySelector<HTMLButtonElement>(".need-button")!;
  if (act.link) Object.assign(link, { href: act.link, textContent: act.label, hidden: false });
  if (act.button) {
    Object.assign(button, { textContent: act.label, hidden: false });
    button.addEventListener("click", act.button);
  }
  return item;
}

let overdueShown = "";
let needsShown: string | undefined;
let allowsShown: string | undefined;

function showApp(): void {
  const items: DocumentFragment[] = [];
  // What each line is keyed on: its words, or, for a line whose words change as prices come, what it is of.
  const keys: string[] = [];
  const add = (item: DocumentFragment, key = item.textContent ?? ""): void => void (items.push(item), keys.push(key));
  const holdings = connection ? shown() : undefined;
  if (holdings) {
    const { owner, accounts, epochStart } = holdings;
    // Accounts their owner votes with, who did not vote last epoch, in one line: they share one remedy.
    let unvoted = 0;
    for (const account of accounts) {
      const status = statusOf(account, owner, now(), epochStart);
      const change = { link: hrefOf({ view: "position", id: account.id }), label: "Change" };
      const named = `Hydrex account #${account.id}`;
      if (status.kind === "stopped") {
        const since = inYear(status.voted)(status.voted);
        add(need("stopped", `${named} earns nothing: ${status.name} stopped since ${since}`, change));
      }
      if (status.kind === "partly") add(need("stopped", `${named} is partly in ${status.automation.name}`, change));
      if (status.kind === "unvoted") unvoted++;
    }
    if (unvoted) {
      const which = count(unvoted, "Hydrex account", "Hydrex accounts");
      add(need("stopped", `${which} didn't vote last epoch`, { link: hrefOf({ view: "hydrex" }), label: "Change" }));
    }
    for (const entry of overdue()) {
      const waits = waitsLine(entry);
      add(
        need("stopped", () => `Hydrex account #${entry.account.id}: payout overdue, ${waits()}`, {
          label: "Claim now",
          button: (event) => claim([entry.account], showApp, event.currentTarget as HTMLButtonElement),
        }),
        `overdue ${entry.account.id} ${appReads}`,
      );
    }
  }
  const left = connection ? allowancesLeft() : undefined;
  if (left?.length) {
    add(
      need("idle", `${count(left.length, "token approval hasn't", "token approvals haven't")} been used`, {
        label: "Reset",
        // The approvals left when clicked, which a later read may have changed.
        button: () => void resetReview(allowancesLeft() ?? []),
      }),
    );
  }
  // Drawn again only when its lines change, so that a button keeps its focus between ticks.
  const needs = document.getElementById("needs")!;
  // Keyed on what each line acts on, not only its words.
  const drawnNeeds = [...keys, ...(left ?? []).map(({ token, spender }) => `${token} ${spender}`)].join("\n");
  if (drawnNeeds !== needsShown) {
    needsShown = drawnNeeds;
    needs.hidden = !items.length;
    fill(needs, { count: `· ${items.length}` });
    needs.querySelector(".needs-list")!.replaceChildren(...items);
  }
  // What you hold in each product, once connected: pending while read.
  const hydrexYours = appView.querySelector<HTMLElement>(".hydrex-yours")!;
  hydrexYours.hidden = !holdings && !(connection && owned?.reading);
  if (!holdings) setText(hydrexYours, PENDING);
  else {
    const full = holdings.accounts.filter(({ amount }) => amount > 0n);
    const counts = AUTOMATIONS.flatMap((automation) => {
      const n = full.filter((account) => {
        const status = statusOf(account, holdings.owner, now(), holdings.epochStart);
        return (
          "automation" in status &&
          status.automation === automation &&
          (status.kind === "in" || status.kind === "joined")
        );
      }).length;
      return n ? [`${n} in ${automation.name}`] : [];
    });
    setText(hydrexYours, [count(full.length, "Hydrex account", "Hydrex accounts"), ...counts].join(" · "));
  }
  const swapYours = appView.querySelector<HTMLElement>(".swap-yours")!;
  const line = connection ? swapLine() : undefined;
  swapYours.hidden = !line;
  // What is found so far, while the wallet's tokens are quoted.
  if (line) {
    live(swapYours, () =>
      line.failed
        ? "Not read"
        : line.reading && !line.count
          ? PENDING
          : line.count
            ? `${count(line.count, "token", "tokens")} · ${money(line.worth)}${line.reading ? " so far" : ""}`
            : "Nothing to swap",
    );
  }
  void showAllows(holdings, left);
  // A payout becomes overdue as time passes: the groups' Claim follows.
  const key = overdue()
    .map(({ account }) => account.id)
    .join();
  if (key !== overdueShown) {
    overdueShown = key;
    showAccounts(true);
    showPosition();
  }
}

// What this wallet allows: the automations that vote or claim for its accounts, and what the swappers may take.
async function showAllows(
  holdings: Holdings | undefined,
  left: { token: Address; spender: Address; amount: bigint }[] | undefined,
): Promise<void> {
  show(".allows-open", !!connection, appView);
  if (!connection) return appView.querySelector<HTMLElement>(".allows")!.hidePopover?.();
  const lines = (holdings?.accounts ?? []).flatMap((account) => {
    const theirs = AUTOMATIONS.filter((automation) => canLeave(account, automation)).map((automation) => {
      const votes = same(account.delegate, automation.address);
      const claims = same(account.claimer, automation.address);
      const what = votes && claims ? "votes and claims" : votes ? "votes" : "claims";
      return { words: `Hydrex account #${account.id} · ${automation.name}: ${what}`, action: "leave" as Action };
    });
    const other = automationName(account.delegate);
    if (other) theirs.push({ words: `Hydrex account #${account.id} · ${other}: votes`, action: "self" });
    return theirs.map((line) => ({ ...line, account }));
  });
  const drawn = [
    ...lines.map(({ words }) => words),
    ...(left ?? []).map(({ token, spender, amount }) => `${token} ${spender} ${amount}`),
  ].join("\n");
  if (drawn === allowsShown) return;
  allowsShown = drawn;
  appView.querySelector(".allows-accounts")!.replaceChildren(
    ...lines.map(({ words, action, account }) => {
      const item = clone("allows-account");
      fill(item, { "allows-words": words });
      item.querySelector(".allows-undo")!.addEventListener("click", () => review([account], action));
      return item;
    }),
  );
  show(".allows-none", !lines.length, appView);
  const tokens = left?.length ? await describe(left.map(({ token }) => token)).catch(() => new Map()) : new Map();
  // A later call, with newer approvals, may have drawn them meanwhile.
  if (allowsShown !== drawn) return;
  appView.querySelector(".allows-tokens")!.replaceChildren(
    ...(left ?? []).map((allowance) => {
      const item = clone("allowance");
      const token = tokens.get(allowance.token.toLowerCase());
      const swapper = SWAPPERS.find(({ address }) => same(address, allowance.spender))!;
      fill(item, {
        "allowance-symbol": token?.symbol ?? allowance.token,
        "allowance-amount": token ? figure(allowance.amount, token.decimals) : String(allowance.amount),
        "allowance-swapper": swapper.symbol,
      });
      item.querySelector(".reset")!.addEventListener("click", () => void resetReview([allowance]));
      return item;
    }),
  );
  show(".allows-tokens-none", !left?.length, appView);
}

// A payout under way: a line on Hydrex's page, and on the page of each account it has not reached yet.
function showUnderWay(): void {
  document.getElementById("underway")!.hidden = !under;
  showPosition();
}

// The wallet's own account, as its holdings of that account alone.
function ownHoldings(id: bigint): Holdings | undefined {
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
function syncPosition(): void {
  const target = onPage();
  const held = target?.held;
  const holdings = shown();
  if (target && !ownHoldings(target.id) && held && holdings && same(held.owner, holdings.owner)) loadPosition();
  else showPosition();
}

// Reads the account shown, or joins the read under way. The wallet's own accounts are read already.
function loadPosition(): void {
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
function showPosition(): void {
  const target = onPage();
  if (!target) return;
  const view = positionView;
  const own = ownHoldings(target.id);
  const read = target.account;
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
  const { owner, epochStart, payout } = holdings;
  const status = statusOf(account, owner, now(), epochStart);
  const name = accountName(account.name);
  const theirs = !viewerOwns(owner);
  document.title = `${name} #${account.id} · metaDEX Café`;
  fill(view, {
    "position-name": pageName(account.name),
    "position-kind": account.amount === 0n ? "Empty" : accountKind(account),
    "position-votes": earningPower(account.votes),
  });
  view.querySelector(".position-status")!.replaceChildren(statusLine(status, !theirs));
  const earned = earnedByAccount(account.id);
  if (earned !== undefined) fill(view, { "position-earned": () => money(earned) });
  show(".position-earned-row", earned !== undefined, view);
  show(".position-owner-row", theirs, view);
  fillAddress(view, "position-owner", owner, short(owner));
  show(".position-stopped", status.kind === "stopped", view);
  // The wallet's own account in AutoMaxi says when its payout is overdue, with Claim now among its actions.
  const owing = own ? overdueEntry(account.id) : undefined;
  show(".position-overdue", !!owing, view);
  if (owing) fill(view, { "overdue-waits": waitsLine(owing) });
  if (status.kind === "stopped") fillTime(view, "position-since", status.since);
  const underWay = own ? under : ownerUnder;
  show(".position-underway", !!underWay?.left.some((entry) => entry.account.id === account.id), view);
  // Carbon Impact pays an owner's accounts to one address, once read.
  const inImpact = [account.delegate, account.claimer, account.delegateAtStart].some((address) =>
    same(address, CARBON_IMPACT.address),
  );
  const paidTo = inImpact ? payout : undefined;
  show(".position-payout-open", !!paidTo, view);
  if (paidTo) {
    fillAddress(view, "payout-to", paidTo);
    show(".payout-itself", same(paidTo, owner), view);
  }
  fillOwn(view, !theirs);
  positionPayouts.show(holdings);
}

// What the wallet can do with its own account, on its page. A join from one of the page's automations is a move.
const actions = positionView.querySelector<HTMLElement>(".position-actions")!;

// The gas of a change for an account that earns nothing: what moving it would cost, without projecting what it would
// earn. Read again after a minute, as the gas price is, or for another automation or wallet. Pending until read for the
// account shown, rather than another account's.
const changeGas = new Map<string, { at: number; words: Promise<() => string> }>();
let changeGasShown: string | undefined;

function showChangeGas(account: Account | undefined, status: Status | undefined): void {
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
    words.catch((error) => {
      console.error(error);
      changeGas.delete(key);
    });
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
    // Leaving one of the page's automations, or one of Hydrex's to vote yourself.
    if (actionOf(button) === "self") {
      const ours = !!account && AUTOMATIONS.some((automation) => canLeave(account, automation));
      button.textContent = ours ? "Leave" : "Vote yourself";
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

// The header: a button to connect a wallet, or the wallet's chip, which leads to the App. The header's popup holds the
// wallet buttons, as do the App, under its products, and the lists of what a wallet holds: its Hydrex accounts, and the
// tokens it can sell.
const connectButton = document.querySelector<HTMLButtonElement>("header.site .connect")!;
const connectPop = document.getElementById("connect")!;
// Older browsers refuse to show a popup already shown, or to hide one already hidden.
const showConnectPop = (shown: boolean): void => {
  if (isOpen(connectPop) !== shown) (shown ? connectPop.showPopover : connectPop.hidePopover)?.call(connectPop);
};

function showConnection(): void {
  show(".wallet-slot, header.site .connect", !connection);
  show("header.site .to-app", !!connection);
  if (connection) showConnectPop(false);
  show("#epoch", !!connection);
  show(".wrong-chain", !!connection && connection.chainId !== CHAIN_ID);
  if (connection) {
    const { wallet, address, chainId } = connection;
    fill(document, { "wallet-short": short(address) });
    if (chainId === CHAIN_ID) show(".switch-failed", false);
    show(".to-switch, .wrong-chain .switch", !wallet.propose);
    show(".safe-elsewhere", !!wallet.propose);
  }
  refreshReview();
}

// Home and About are the page's own; a wallet picked there leads on to the App.
const leadsToApp = (): boolean => ["home", "about"].includes(route().view);

// A wallet connected from Home or About leads on to the App, unless its owner went to another page meanwhile. The Safe
// the page finds itself in, which nobody `picked`, leaves its reader where they are.
async function connectTo(wallet: Wallet, picked = true): Promise<void> {
  const attempt = ++attempts;
  const fromOwn = picked && leadsToApp();
  const connected = await connect(wallet);
  if (!connected || attempt <= ignoredUpTo) return;
  ignoredUpTo = attempt;
  show(".wallet-failed, .no-wallet", false);
  listen(connected.provider);
  connection = connected;
  showConnection();
  loadAccounts();
  walletChanged();
  if (fromOwn && leadsToApp()) location.hash = "#app";
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
    walletChanged();
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
  owned?.forget();
  connection = owned = under = appFound = undefined;
  late = new Set();
  appPayouts.forget();
  closeReview();
  showConnection();
  show(".accounts-reading, #accounts, #none, .mine, #underway, .yours-count", false);
  showPosition();
  walletChanged();
  showApp();
  showRecords();
}

// Connects a wallet picked from a list, or from the header's button. What goes wrong shows where the wallets are listed:
// from the header, in its popup.
function pickWallet(wallet: Wallet, fromHeader = false): void {
  const click = ++clicks;
  show(".wallet-failed, .no-wallet", false);
  fill(document, { "connecting-wallet": wallet.name });
  show(".connecting");
  connectButton.disabled = true;
  connectTo(wallet)
    .catch((error) => {
      if (click !== clicks || declined(error)) return;
      if (fromHeader) showConnectPop(true);
      if (error instanceof NoWallet) return show(".no-wallet");
      console.error(error);
      fill(document, { "failed-wallet": wallet.name });
      show(".wallet-failed");
    })
    .finally(() => {
      if (click !== clicks) return;
      show(".connecting", false);
      connectButton.disabled = false;
    });
}

function walletButton(wallet: Wallet): DocumentFragment {
  const item = clone("wallet");
  fill(item, { name: wallet.name });
  if (wallet.icon) Object.assign(item.querySelector("img")!, { src: wallet.icon, hidden: false });
  item.querySelector("button")!.addEventListener("click", () => pickWallet(wallet));
  return item;
}

// With one wallet in the browser, the header's button connects it at once; with several, it lists them, or a browser
// without popups finds them on the App.
let wallets: Wallet[] = [];
connectButton.addEventListener("click", () => {
  if (wallets.length === 1) pickWallet(wallets[0]!, true);
  else if ("showPopover" in connectPop) showConnectPop(true);
  else location.hash = "#app";
});

for (const slot of document.querySelectorAll(".wallet-slot")) slot.append(clone("wallet-picker"));
// Where a list or a page is read, cards of bars where its items will show, three, or as many as the slot says, or the
// tiles of a page's key figures.
for (const slot of document.querySelectorAll<HTMLElement>(".loading-slot")) {
  const loading = clone("loading");
  const cards = loading.querySelector(".skeleton")!;
  cards.classList.toggle("tiles", "tiles" in slot.dataset);
  cards.append(...Array.from({ length: Number(slot.dataset.cards ?? 3) }, () => document.createElement("li")));
  slot.append(loading);
}
pendAll(document);
initSwap({ connection: () => connection, hooks });
onSwapChange(showApp);
// The footer's currency, for the visit: every figure in money is drawn again in it.
const currencySelect = document.querySelector<HTMLSelectElement>("footer .currency")!;
currencySelect.addEventListener("change", () => setCurrency(currencySelect.value as Currency));

groupAllHex(document);
// A reload keeps the hash, and so the view.
document.querySelector("#error .again")!.addEventListener("click", () => location.reload());
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
for (const button of buttons(actions)) {
  button.addEventListener("click", () =>
    act(button, () => (viewing && ownHoldings(viewing.id)?.accounts) ?? [], showPosition),
  );
}
for (const button of document.querySelectorAll(".wrong-chain .switch"))
  button.addEventListener("click", () => {
    if (!connection) return;
    show(".switch-failed", false);
    switchToBase(connection).then(showConnection, (error) => {
      if (declined(error)) return;
      console.error(error);
      show(".switch-failed");
    });
  });
positionView.querySelector(".position-again")!.addEventListener("click", loadPosition);

findWallets((found) => {
  wallets = found;
  for (const place of document.querySelectorAll(".wallet-buttons")) place.replaceChildren(...found.map(walletButton));
});
safeWallet()
  .then((wallet) => wallet && connectTo(wallet, false))
  .catch(console.error);
impact.read().catch(failed);
checks.read().catch(failed);
autoMaxi.check();
loadAllEarnings();
setInterval(tick, 30_000);
