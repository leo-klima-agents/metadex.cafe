import { getAddress, zeroAddress, type Address } from "viem";
import "./views.ts";
import { now, same, sawBlock } from "./chain.ts";
import {
  AUTOMATIONS,
  AUTOMAXI,
  AUTOMAXI_FEE_BPS,
  CARBON_IMPACT,
  CHAIN_ID,
  type Automation,
  type Kind,
} from "./config.ts";
import { FACTS, closeChoose, openChoose, type Fact, type Option } from "./choose.ts";
import { clone, fill, fillAddress, fillPlural, fillTime, groupAllHex, show } from "./dom.ts";
import {
  WEEK,
  bps,
  count,
  date,
  earningPower,
  list,
  share,
  short,
  toEarningPower,
  units,
  until,
  usd,
  utc,
  weekStart,
  when,
} from "./format.ts";
import {
  LockType,
  automationName,
  canJoin,
  canLeave,
  canLeaveOther,
  failedChecks,
  groupOf,
  hasStopped,
  join,
  leave,
  leaveOther,
  gasCost,
  paidBpsOf,
  readAccounts,
  readAutomations,
  readCarbonImpact,
  readFreshness,
  statusOf,
  type Account,
  type CarbonImpact,
  type Checks,
  type Freshness,
  type Group,
  type Holdings,
  type Other,
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
} from "./last-epoch.ts";
import { checkPayout, forgetPayout, showPayout } from "./last-payout.ts";
import { closeReview, openReview, refreshReview, type Hooks } from "./review.ts";
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

type Action = "join" | "leave" | "leave-other" | "choose";

const groups = [...document.querySelectorAll<HTMLElement>("#accounts .group")];
const listening = new WeakSet<Provider>();
const actionable = new WeakMap<HTMLElement, Account[]>();

let connection: Connection | undefined;
let shown: Holdings | undefined;
let carbonImpact: CarbonImpact | undefined;
let carbonImpactRead: Promise<void> | undefined;
// Until the checks have run, joining is off, and only Carbon Impact is shown.
let checks: Checks | undefined;
let reads = 0;
let reading = false;
// Wallet connections that finish are ignored up to this attempt: a later one connected, or the wallet was let go.
let attempts = 0;
let ignoredUpTo = 0;
let clicks = 0;

// The page's automations on Base. They decide what the page offers to join; an account's status is read against all.
const present = (): Automation[] => checks?.present ?? [CARBON_IMPACT];

// What differs between the page's automations, kind by kind.
type Traits = {
  // The start of its review's template ids. Carbon Impact's were the page's first, and have none.
  templates: string;
  // Whether joining it shows Carbon Impact's settings, and so waits for them.
  settings: boolean;
  // The share of what its votes earn that reaches the owner, or 0 until known.
  paid(): number;
};
const traits: Record<Kind, Traits> = {
  "carbon-impact": {
    templates: "",
    settings: true,
    paid: () => (carbonImpact ? Number(paidBpsOf(carbonImpact)) / 10_000 : 0),
  },
  automaxi: { templates: "automaxi-", settings: false, paid: () => Number(10_000n - AUTOMAXI_FEE_BPS) / 10_000 },
};

function failed(error: unknown): void {
  console.error(error);
  show("#error");
}

function showCarbonImpact(found: CarbonImpact): void {
  carbonImpact = found;
  sawBlock(found.time);
  const { epochStart, tonnes, retireBps, votes, entity, beneficiary, beneficiaryAddress, message, voted } = found;
  const { feeBps, maxFeeBps, treasury } = found;
  const stopped = hasStopped(voted, epochStart);
  for (const shape of document.querySelectorAll(".impact-shape")) {
    shape.classList.replace(stopped ? "running" : "stopped", stopped ? "stopped" : "running");
  }
  fill(document, {
    "impact-state": stopped ? "Stopped" : "Running",
    tonnes: units(tonnes),
    retired: bps(retireBps),
    "retired-share": share(retireBps),
    "paid-share": share(paidBpsOf(found)),
    fee: feeBps === undefined ? "…" : bps(feeBps),
    "max-fee": maxFeeBps === undefined ? "…" : bps(maxFeeBps),
    power: earningPower(votes),
    entity,
    beneficiary: beneficiary || "No name",
    message,
  });
  fillAddress(document, "beneficiary-address", beneficiaryAddress);
  if (treasury) fillAddress(document, "treasury", treasury);
  fillTime(document, "week-start", epochStart);
  fillTime(document, "week-end", epochStart + WEEK);
  fillTime(document, "week-end-when", epochStart + WEEK, when);
  if (voted) fillTime(document, "impact-voted", voted, utc);
  fillTime(document, "vote-day", epochStart + WEEK - 1);
  tick();
}

function tick(): void {
  catchUp();
  if (!carbonImpact) return;
  const time = now();
  const end = carbonImpact.epochStart + WEEK;
  if (time >= end) return;
  fill(document, { countdown: `in ${until(end - time)}` });
  fillTime(document, "today", time);
  for (const bar of document.querySelectorAll<HTMLProgressElement>("progress.elapsed")) {
    bar.value = time - carbonImpact.epochStart;
  }
}

// AutoMaxi's page, its card on the menu, and its column in the comparison, once it is on Base.
let autoMaxiFreshness: Freshness | undefined;

function showAutoMaxi(): void {
  const on = present().includes(AUTOMAXI);
  show('[data-kind="automaxi"]', on);
  show(".automaxi-absent", !!checks && !on);
  show(".automaxi-join", on && !checks?.failed.get(AUTOMAXI.kind)!.length);
  if (!on) return;
  const fresh = autoMaxiFreshness;
  const stopped = !!fresh && hasStopped(fresh.voted, fresh.epochStart);
  const state = !fresh ? "…" : !fresh.voted ? "Not voted yet" : stopped ? "Stopped" : "Running";
  for (const shape of document.querySelectorAll(".automaxi-shape")) {
    shape.classList.remove("idle", "running", "stopped");
    shape.classList.add(!fresh?.voted ? "idle" : stopped ? "stopped" : "running");
  }
  fill(document, { "automaxi-state": state });
  if (fresh?.voted) fillTime(document, "automaxi-voted", fresh.voted, utc);
  show(".automaxi-voted-line", !!fresh?.voted);
  // Undefined until read, or if the read failed; null if AutoMaxi had no votes last epoch.
  const per = perThousandOf(AUTOMAXI);
  const unread = per === undefined;
  const failedRead = unread && earningsFailed(AUTOMAXI);
  const paid = typeof per === "number" ? per * traits.automaxi.paid() : undefined;
  show(".automaxi-unread", unread);
  show(".automaxi-no-record", per === null);
  show(".automaxi-has-record", typeof per === "number");
  fill(document, {
    "automaxi-unread-why": failedRead
      ? "could not be read from Base. The page tries again every five minutes."
      : "are being read from Base.",
    "automaxi-record":
      paid !== undefined
        ? `${usd(per!)} earned, ${usd(paid)} paid to you`
        : failedRead
          ? "Not read"
          : unread
            ? "…"
            : "No record yet",
    "automaxi-per-power": paid !== undefined ? usd(per!) : "…",
    "automaxi-paid-per-power": paid === undefined ? "…" : usd(paid),
  });
  const found = earningsOf(AUTOMAXI);
  if (found) {
    fillTime(document, "automaxi-last-start", found.start);
    fillTime(document, "automaxi-last-end", found.start + WEEK);
  }
  const pools = found?.pools ?? [];
  document.querySelector("#automaxi .automaxi-pools")!.replaceChildren(
    ...pools.map(({ address, name }) => {
      const [item, link] = [document.createElement("li"), document.createElement("a")];
      link.className = "pool";
      link.translate = false;
      item.append(link);
      fillAddress(item, "pool", address, name);
      return item;
    }),
  );
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
  if (!carbonImpact || epoch > carbonImpact.epochStart) readCarbonImpactAgain().catch(console.error);
  if (earningsDue(epoch, present())) loadAllEarnings();
  if (!autoMaxiFreshness || epoch > autoMaxiFreshness.epochStart) readAutoMaxi();
  checkPayout();
}

// Each read of figures, whoever started it, shows on AutoMaxi's page and in the accounts' shares.
const loadAllEarnings = (): void => void loadEarnings(present()).catch(console.error);
onEarnings(() => {
  showShares();
  showAutoMaxi();
});

// What each account's votes earned last epoch.
async function showShares(): Promise<void> {
  const holdings = shown;
  if (holdings && (await loadShares(holdings, present())) && shown === holdings) showAccounts(true);
}

function showAutomations(found: Other[]): void {
  for (const row of document.querySelectorAll<HTMLElement>("tr[data-automation]")) {
    const other = found.find(({ address }) => same(address, row.dataset.automation ?? ""));
    if (!other) continue;
    if (other.voted) fillTime(row, "voted", other.voted);
    if (other.votes !== undefined) fill(row, { "still-in": earningPower(other.votes) });
  }
}

async function showChecks(): Promise<void> {
  const found = await failedChecks();
  const more = found.present.filter((automation) => !present().includes(automation));
  checks = found;
  const failing = found.present.flatMap(({ kind }) => found.failed.get(kind)!);
  for (const item of document.querySelectorAll<HTMLElement>("#checks li")) item.hidden = !failing.includes(item.id);
  const off = found.present.filter(({ kind }) => found.failed.get(kind)!.length);
  fill(document, { "checks-which": list(off.map(({ name }) => name)) });
  show("#checks", off.length > 0);
  // An automation newly on Base needs its figures.
  if (more.length) loadAllEarnings();
  if (more.includes(AUTOMAXI)) readAutoMaxi();
  showAutoMaxi();
  // A read of the accounts that is under way shows the result when it ends.
  if (!reading) showAccounts(true);
}

const automationOf = (button: HTMLButtonElement): Automation | undefined =>
  AUTOMATIONS.find(({ kind }) => kind === button.dataset.automation);

// Joining an automation needs it on Base and its checks passed. Leaving always works.
function joinable(account: Account, automation: Automation | undefined): boolean {
  if (!automation || !checks?.present.includes(automation) || checks.failed.get(automation.kind)!.length) return false;
  return canJoin(account, automation, now());
}
const leavable = (account: Account): boolean => AUTOMATIONS.some((automation) => canLeave(account, automation));
// Choose sets the page's automations beside voting yourself, once the checks have run.
const choosable = (account: Account): boolean =>
  !!checks &&
  (present().some((automation) => joinable(account, automation)) || leavable(account) || canLeaveOther(account));
const can: Record<Action, (account: Account, automation?: Automation) => boolean> = {
  join: joinable,
  leave: leavable,
  "leave-other": canLeaveOther,
  choose: choosable,
};
const buttons = (section: HTMLElement) => [...section.querySelectorAll<HTMLButtonElement>("button[data-action]")];
const actionOf = (button: HTMLButtonElement) => button.dataset.action as Action;
const allows = (button: HTMLButtonElement) => (account: Account) =>
  can[actionOf(button)](account, automationOf(button));

function accountKind({ lockType, end }: Account): string {
  if (lockType === LockType.permanent) return "Protocol Account";
  if (lockType === LockType.rolling) return "Flex Account, rolling lock";
  return end ? `Flex Account, lock ${end > now() ? "ends" : "ended"} ${date(end)}` : "Flex Account";
}

function accountItem(holdings: Holdings, account: Account, status: Status, pickable: boolean): DocumentFragment {
  const item = clone("account");
  const name = account.name || "Account";
  fill(item, { name, id: `#${account.id}`, kind: accountKind(account), votes: earningPower(account.votes) });
  const line = clone(status.kind);
  if ("date" in status) fillTime(line, "date", status.date);
  if ("voted" in status) {
    fillTime(line, "voted", status.voted);
    fillTime(line, "since", status.since);
  }
  if ("name" in status) fill(line, { automation: status.name });
  if ("automation" in status) fill(line, { "automation-name": status.automation.name });
  if ("to" in status) fillAddress(line, "address", status.to);
  item.querySelector(".status")!.replaceWith(line);
  const earned = earnedByAccount(holdings, account.id);
  if (earned !== undefined) {
    fill(item, { "earned-usd": usd(earned) });
    show(".earned", true, item);
  }
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
  const { owner, accounts, payout, epochStart } = holdings;
  const ticked = document.querySelectorAll<HTMLInputElement>("#accounts .pick:checked");
  const kept = new Set(keepTicked ? [...ticked].map(({ value }) => value) : []);
  const time = now();
  const sorted = accounts.map((account) => {
    const status = statusOf(account, owner, time, epochStart);
    return { account, status, group: groupOf(account, status) };
  });
  for (const section of groups) {
    const members = sorted.filter((member) => member.group === section.dataset.group);
    // Some wallets hold many empty accounts, which can do nothing: they go in a fold.
    const folded = section.dataset.group === "closed" ? members.filter(({ account }) => account.amount === 0n) : [];
    const tests = buttons(section).map(allows);
    const able = members.map(({ account }) => account).filter((account) => tests.some((test) => test(account)));
    const items = (listed: typeof members) =>
      listed.map(({ account, status }) =>
        accountItem(holdings, account, status, able.length > 1 && able.includes(account)),
      );
    section.querySelector(".accounts")!.replaceChildren(...items(members.filter((member) => !folded.includes(member))));
    const fold = section.querySelector<HTMLDetailsElement>(".empty-accounts");
    if (fold) {
      fold.querySelector(".accounts")!.replaceChildren(...items(folded));
      fill(fold, { "empty-count": count(folded.length, "empty account", "empty accounts") });
      fold.hidden = !folded.length;
    }
    actionable.set(section, able);
    section.hidden = !members.length;
  }
  for (const box of document.querySelectorAll<HTMLInputElement>("#accounts .pick:not([hidden])")) {
    box.checked = kept.has(box.value);
  }
  updateButtons();
  const full = sorted.filter(({ account }) => account.amount > 0n);
  const inGroups = (...names: Group[]) => full.filter((member) => names.includes(member.group)).length;
  const stopped = inGroups("stopped");
  const memberships = AUTOMATIONS.flatMap(({ kind, name }) => {
    const n = full.filter(
      ({ status }) => (status.kind === "in" || status.kind === "joined") && status.automation.kind === kind,
    ).length;
    return n ? [count(n, `in ${name}`, `in ${name}`)] : [];
  });
  const power = full.reduce((sum, { account }) => sum + account.votes, 0n);
  fill(document, {
    "summary-line": [
      count(full.length, "account", "accounts"),
      ...memberships,
      ...(stopped ? [count(stopped, "in an automation that stopped", "in automations that stopped")] : []),
      `${earningPower(power)} Earning Power`,
    ].join(" · "),
  });
  const own = same(payout, owner);
  show(".payout-own, #itself", own);
  show(".payout-other", !own);
  fillAddress(document, "payout-to", payout);
  fillAddress(document, "owner", owner);
  fillAddress(document, "payout", payout);
  show("#summary, #payout", full.length > 0);
  show("#none", !full.length);
  show("#accounts");
}

async function loadAccounts(quietly = false): Promise<void> {
  if (!connection) return;
  const read = ++reads;
  reading = true;
  if (!quietly) {
    shown = undefined;
    forgetPayout();
    closeChoose();
    show("#reading");
    show("#accounts, #summary, #none, #payout", false);
  }
  try {
    const found = await readAccounts(connection.address);
    if (read !== reads) return;
    sawBlock(found.time);
    shown = found;
    showAccounts();
    showPayout(found);
    catchUp();
    showShares();
  } catch (error) {
    if (read === reads) failed(error);
  } finally {
    if (read === reads) {
      reading = false;
      show("#reading", false);
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

// A Join names its automation once there is more than one to join.
function updateButtons(): void {
  for (const section of groups) {
    const able = actionable.get(section) ?? [];
    const accounts = picked(section);
    for (const button of buttons(section)) {
      const allowed = allows(button);
      const named = button.dataset.named !== undefined && present().length > 1;
      const base = (button.dataset.verb ??= button.textContent?.trim() ?? "");
      const verb = named ? `${base} ${automationOf(button)!.name}` : base;
      const n = accounts.filter(allowed).length;
      button.hidden = !able.some(allowed);
      button.disabled = !n;
      const which = actionOf(button) === "choose" ? "for" : "with";
      button.textContent = able.length > 1 && n ? `${verb} ${which} ${count(n, "account", "accounts")}` : verb;
    }
    show(".buttons", able.length > 0, section);
    show(".pick-hint", able.length > 1 && !accounts.length, section);
  }
}

const hooks: Hooks = {
  closed: (submitted) => submitted && loadAccounts(true),
  switched: showConnection,
};

function reviewPicked(section: HTMLElement, button: HTMLButtonElement): void {
  if (!connection || !shown) return;
  // In a new epoch, the statuses and dates shown would be wrong: read the accounts again instead.
  if (weekStart(now()) > shown.epochStart) return void loadAccounts();
  const action = actionOf(button);
  const automation = automationOf(button);
  // A join of Carbon Impact, and Choose, show the share retired, so they wait for its settings. Leaving never waits.
  if (((action === "join" && automation && traits[automation.kind].settings) || action === "choose") && !carbonImpact) {
    return void readCarbonImpactAgain().then(() => reviewPicked(section, button), failed);
  }
  const accounts = picked(section).filter(allows(button));
  if (!accounts.length) return updateButtons();
  if (action === "choose") return choose(accounts);
  review(accounts, action, automation);
}

// Leaving the automations that hold the accounts' approvals: the page's own, those on Hydrex's list, or both.
function leaveAll(accounts: Account[], own = true, listed = true): { steps: Step[]; names: string[] } {
  const from = own ? AUTOMATIONS.filter((automation) => accounts.some((account) => canLeave(account, automation))) : [];
  const steps = accounts.flatMap((account) =>
    from.flatMap((automation) => (canLeave(account, automation) ? leave([account], automation) : [])),
  );
  const others = listed ? leaveOther(accounts.filter(canLeaveOther)) : [];
  const names = [...from.map(({ name }) => name), ...new Set(others.flatMap(({ automation }) => automation ?? []))];
  return { steps: [...steps, ...others], names };
}

// The review of a join, or of leaving: "leave" leaves the page's automations, "leave-other" Hydrex's others, and
// "self" both.
function review(accounts: Account[], action: Action | "self", automation?: Automation): void {
  if (!connection || !shown) return;
  const { owner, epochStart } = shown;
  const settings = carbonImpact;
  const which = list(accounts.map(({ id }) => `#${id}`));
  const prepare = (id: string): DocumentFragment => {
    const part = clone(id);
    fill(part, { which });
    fillTime(part, "next", epochStart + WEEK, when);
    fillPlural(part, accounts.length);
    if (settings) fill(part, { "retired-share": share(settings.retireBps), entity: settings.entity });
    return part;
  };
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
    const changes = prepare(`${prefix}join-changes`);
    // The fee facts on the automation's own page.
    changes
      .querySelector(".fee-facts-copy")
      ?.replaceWith(document.querySelector(`#${automation.kind} .fee-facts`)!.cloneNode(true));
    const pages = [
      { title: "Before you join", body: before },
      { title: "What changes", body: changes },
      { title: "What your wallet will ask" },
    ];
    const steps = join(accounts, automation);
    return openReview(`Join ${automation.name}`, pages, steps, connection, hooks, prepare(`${prefix}join-done`));
  }
  const { steps, names } = leaveAll(accounts, action !== "leave-other", action !== "leave");
  const title = `Leave ${list(names)}`;
  const effects = prepare(action === "leave-other" ? "leave-other-effects" : "leave-effects");
  fill(effects, { automations: list(names) });
  openReview(title, [{ title, body: effects }], steps, connection, hooks);
}

// A choice's facts as the page states them: on its card in Home's menu, or else in the fee facts of its own page. Live
// figures in them, such as the share retired, keep updating.
const factsOf = (choice: Kind | "self"): Record<Fact, Node[]> =>
  Object.fromEntries(
    FACTS.map((fact) => {
      const selector = `[data-fact~="${fact}"]`;
      const source =
        document.querySelector(`.choice[data-choice="${choice}"] ${selector}`) ??
        document.querySelector(`#${choice} .fee-facts ${selector}`)!;
      return [fact, [...source.childNodes].map((node) => node.cloneNode(true))];
    }),
  ) as Record<Fact, Node[]>;

// A pick in Choose acts on the accounts as they are when it is clicked. The dialog may have stayed open: in a new epoch,
// the page reads the accounts again instead, and only those that can still make the change take part.
function act(ids: bigint[], owner: Address, can: (account: Account) => boolean, go: (accounts: Account[]) => void) {
  return () => {
    if (!shown || !same(shown.owner, owner)) return;
    if (weekStart(now()) > shown.epochStart) return void loadAccounts();
    const accounts = shown.accounts.filter((account) => ids.includes(account.id) && can(account));
    if (accounts.length) go(accounts);
  };
}

// Choose: each of the page's automations on Base, and voting yourself, for the accounts picked.
function choose(accounts: Account[]): void {
  if (!shown) return;
  const { owner } = shown;
  const ids = accounts.map(({ id }) => id);
  const power = accounts.reduce((sum, { votes }) => sum + toEarningPower(votes), 0n);
  const options: Option[] = present().map((automation) => {
    const can = (account: Account) => joinable(account, automation);
    const able = accounts.filter(can);
    return {
      name: automation.name,
      perThousand: lastEarnings(automation).then(() => perThousandOf(automation) ?? null),
      paidShare: traits[automation.kind].paid(),
      facts: factsOf(automation.kind),
      now: accounts.every((account) => !canJoin(account, automation, now()) && canLeave(account, automation)),
      ...(able.length && {
        pick: {
          label: `Join ${automation.name}`,
          gas: gasCost(join(able, automation), owner),
          go: act(ids, owner, can, (picked) => review(picked, "join", automation)),
        },
      }),
    };
  });
  const canLeaveAll = (account: Account) => leavable(account) || canLeaveOther(account);
  const leaving = accounts.filter(canLeaveAll);
  // An account whose votes someone else holds is not voting itself, though the page has nothing for it to leave.
  const ownVotes = (account: Account) => same(account.delegate, owner) || same(account.delegate, zeroAddress);
  options.push({
    name: "Vote yourself",
    perThousand: undefined,
    paidShare: 1,
    facts: factsOf("self"),
    now: !leaving.length && accounts.every(ownVotes),
    ...(leaving.length && {
      pick: {
        label: "Vote yourself",
        gas: gasCost(leaveAll(leaving).steps, owner),
        go: act(ids, owner, canLeaveAll, (picked) => review(picked, "self")),
      },
    }),
  });
  openChoose(list(accounts.map(({ id }) => `#${id}`)), accounts.length, power, options);
}

function showConnection(): void {
  show("#wallets", !connection);
  show("#connected", !!connection);
  show(".to-app .open", !connection);
  show(".to-app .wallet-state", !!connection);
  if (connection) {
    const { wallet, address, chainId } = connection;
    fill(document, { wallet: wallet.name, "wallet-short": short(address) });
    fillAddress(document, "me", address);
    show("#wrong-chain", chainId !== CHAIN_ID);
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
  show("#wallet-failed, #no-wallet", false);
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
    closeChoose();
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
  connection = shown = undefined;
  forgetPayout();
  closeReview();
  closeChoose();
  showConnection();
  show("#reading, #accounts, #summary, #none, #payout", false);
}

function walletButton(wallet: Wallet): DocumentFragment {
  const item = clone("wallet");
  fill(item, { name: wallet.name });
  if (wallet.icon) Object.assign(item.querySelector("img")!, { src: wallet.icon, hidden: false });
  item.querySelector("button")!.addEventListener("click", () => {
    const click = ++clicks;
    show("#wallet-failed, #no-wallet", false);
    fill(document, { "connecting-wallet": wallet.name });
    show("#connecting");
    connectTo(wallet)
      .catch((error) => {
        if (click !== clicks || declined(error)) return;
        if (error instanceof NoWallet) return show("#no-wallet");
        console.error(error);
        fill(document, { "failed-wallet": wallet.name });
        show("#wallet-failed");
      })
      .finally(() => {
        if (click === clicks) show("#connecting", false);
      });
  });
  return item;
}

show(".needs-script", false);
groupAllHex(document);
// A reload keeps the hash, and so the view.
document.querySelector("#error .again")!.addEventListener("click", () => location.reload());
document.getElementById("accounts")!.addEventListener("change", updateButtons);
for (const section of groups) {
  for (const button of buttons(section)) {
    button.addEventListener("click", () => reviewPicked(section, button));
  }
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

findWallets((wallets) => document.querySelector("#wallets .buttons")!.replaceChildren(...wallets.map(walletButton)));
safeWallet()
  .then((wallet) => wallet && connectTo(wallet))
  .catch(console.error);
readCarbonImpactAgain().catch(failed);
showChecks().catch(failed);
loadAllEarnings();
readAutomations().then(showAutomations, console.error);
setInterval(() => showChecks().catch(console.error), 3_600_000);
setInterval(tick, 30_000);
