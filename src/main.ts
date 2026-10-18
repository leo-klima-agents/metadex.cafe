import { getAddress } from "viem";
import "./views.ts";
import { now, same, sawBlock } from "./chain.ts";
import { CHAIN_ID } from "./config.ts";
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
  readAccounts,
  readAutomations,
  readCarbonImpact,
  statusOf,
  type Account,
  type Automation,
  type CarbonImpact,
  type Group,
  type Holdings,
  type Status,
} from "./hydrex.ts";
import { earnedByAccount, earningsDue, loadEarnings, loadShares } from "./last-epoch.ts";
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

type Action = "join" | "leave" | "leave-other";

const groups = [...document.querySelectorAll<HTMLElement>("#accounts .group")];
const listening = new WeakSet<Provider>();
const actionable = new WeakMap<HTMLElement, Account[]>();

let connection: Connection | undefined;
let shown: Holdings | undefined;
let carbonImpact: CarbonImpact | undefined;
let carbonImpactRead: Promise<void> | undefined;
let trusted = false;
let reads = 0;
let reading = false;
// Wallet connections that finish are ignored up to this attempt: a later one connected, or the wallet was let go.
let attempts = 0;
let ignoredUpTo = 0;
let clicks = 0;

function failed(error: unknown): void {
  console.error(error);
  show("#error");
}

function showCarbonImpact(found: CarbonImpact): void {
  carbonImpact = found;
  sawBlock(found.time);
  const { epochStart, tonnes, retireBps, votes, entity, beneficiary, beneficiaryAddress, message, voted } = found;
  const stopped = hasStopped(voted, epochStart);
  document
    .querySelector(".impact-shape")!
    .classList.replace(stopped ? "running" : "stopped", stopped ? "stopped" : "running");
  fill(document, {
    "impact-state": stopped ? "Stopped" : "Running",
    tonnes: units(tonnes),
    retired: bps(retireBps),
    "retired-share": share(retireBps),
    "paid-share": share(10_000n - retireBps),
    power: earningPower(votes),
    entity,
    beneficiary: beneficiary || "No name",
    message,
  });
  fillAddress(document, "beneficiary-address", beneficiaryAddress);
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
  if (earningsDue(epoch)) loadEarningsAndShares();
  checkPayout();
}

function loadEarningsAndShares(): void {
  loadEarnings().then((changed) => {
    if (changed) showShares();
  });
}

// What each account's votes earned last epoch.
async function showShares(): Promise<void> {
  const holdings = shown;
  if (holdings && (await loadShares(holdings)) && shown === holdings) showAccounts(true);
}

function showAutomations(found: Automation[]): void {
  for (const row of document.querySelectorAll<HTMLElement>("tr[data-automation]")) {
    const other = found.find(({ address }) => same(address, row.dataset.automation ?? ""));
    if (!other) continue;
    if (other.voted) fillTime(row, "voted", other.voted);
    if (other.votes !== undefined) fill(row, { "still-in": earningPower(other.votes) });
  }
}

async function showChecks(): Promise<void> {
  const failing = await failedChecks();
  for (const item of document.querySelectorAll<HTMLElement>("#checks li")) item.hidden = !failing.includes(item.id);
  show("#checks", failing.length > 0);
  trusted = !failing.length;
  // A read of the accounts that is under way shows the result when it ends.
  if (!reading) showAccounts(true);
}

const joinable = (account: Account): boolean => trusted && canJoin(account, now());
const can: Record<Action, (account: Account) => boolean> = {
  join: joinable,
  leave: canLeave,
  "leave-other": canLeaveOther,
};
const buttons = (section: HTMLElement) => [...section.querySelectorAll<HTMLButtonElement>("button[data-action]")];
const actionOf = (button: HTMLButtonElement) => button.dataset.action as Action;

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
    const actions = buttons(section).map(actionOf);
    const able = members
      .map(({ account }) => account)
      .filter((account) => actions.some((action) => can[action](account)));
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
  const [members, stopped] = [inGroups("in", "joining"), inGroups("stopped")];
  const power = full.reduce((sum, { account }) => sum + account.votes, 0n);
  fill(document, {
    "summary-line": [
      count(full.length, "account", "accounts"),
      ...(members ? [count(members, "in Carbon Impact", "in Carbon Impact")] : []),
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

function updateButtons(): void {
  for (const section of groups) {
    const able = actionable.get(section) ?? [];
    const accounts = picked(section);
    for (const button of buttons(section)) {
      const allowed = can[actionOf(button)];
      const verb = (button.dataset.verb ??= button.textContent ?? "");
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

function reviewPicked(section: HTMLElement, action: Action): void {
  if (!connection || !shown) return;
  // In a new epoch, the statuses and dates shown would be wrong: read the accounts again instead.
  if (weekStart(now()) > shown.epochStart) return void loadAccounts();
  // A join shows the share retired, so it waits for Carbon Impact's settings. Leaving never waits.
  if (action === "join" && !carbonImpact) {
    return void readCarbonImpactAgain().then(() => reviewPicked(section, action), failed);
  }
  const accounts = picked(section).filter(can[action]);
  if (!accounts.length) return updateButtons();
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
  if (action === "join") {
    const before = prepare("join-before");
    const from = (kind: Status["kind"]) =>
      accounts.filter((account) => statusOf(account, owner, now(), epochStart).kind === kind);
    const [stopped, running] = [from("stopped"), from("other")];
    fill(before, {
      "stopped-which": list(stopped.map(({ id, delegate }) => `#${id} is in ${automationName(delegate)}`)),
      "running-which": list(running.map(({ id, delegate }) => `#${id} out of ${automationName(delegate)}`)),
    });
    show(".from-stopped", stopped.length > 0, before);
    show(".from-running", running.length > 0, before);
    const pages = [
      { title: "Before you join", body: before },
      { title: "What changes", body: prepare("join-changes") },
      { title: "What your wallet will ask" },
    ];
    return openReview("Join Carbon Impact", pages, join(accounts), connection, hooks, prepare("join-done"));
  }
  if (action === "leave") {
    const title = "Leave Carbon Impact";
    return openReview(title, [{ title, body: prepare("leave-effects") }], leave(accounts), connection, hooks);
  }
  const steps = leaveOther(accounts);
  const names = list([...new Set(steps.flatMap(({ automation }) => automation ?? []))]);
  const effects = prepare("leave-other-effects");
  fill(effects, { automations: names });
  openReview(`Leave ${names}`, [{ title: `Leave ${names}`, body: effects }], steps, connection, hooks);
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
    button.addEventListener("click", () => reviewPicked(section, actionOf(button)));
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
loadEarningsAndShares();
readAutomations().then(showAutomations, console.error);
setInterval(() => showChecks().catch(console.error), 3_600_000);
setInterval(tick, 30_000);
