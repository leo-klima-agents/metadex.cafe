import { getAddress, type Address } from "viem";
import "./views.ts";
import { now, same, sawBlock } from "./chain.ts";
import {
  onChanges,
  readPayoutChanges,
  settingsChanged,
  showPayoutChanges,
  watchChanges,
  whatChanged,
} from "./change-watch.ts";
import type { Change, PayoutChange } from "./changes.ts";
import { closeChoose, openChoose, refreshChoose } from "./choose.ts";
import { CHAIN_ID } from "./config.ts";
import { clone, fill, fillAddress, fillPlural, fillTime, groupAllHex, show } from "./dom.ts";
import { feeFacts, showFeeFacts } from "./fee-facts.ts";
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
  callsFor,
  canJoin,
  canLeave,
  canLeaveOther,
  failedChecks,
  groupOf,
  hasStopped,
  needsOf,
  readAccounts,
  readAutomations,
  readCarbonImpact,
  statusOf,
  type Account,
  type Automation,
  type CarbonImpact,
  type Choice,
  type Group,
  type Holdings,
  type Need,
  type Status,
} from "./hydrex.ts";
import { earnedByAccount, earningsDue, lastPerThousand, loadEarnings, loadShares } from "./last-epoch.ts";
import { checkPayout, forgetPayout, showPayout } from "./last-payout.ts";
import { closeReview, openReview, refreshReview, type Hooks } from "./review.ts";
import {
  NoWallet,
  canBatch,
  connect,
  declined,
  findWallets,
  safeWallet,
  switchToBase,
  type Connection,
  type Provider,
  type Wallet,
} from "./wallet.ts";

// The order of the positions: what needs the owner first.
const GROUPS: Group[] = ["stopped", "attention", "in", "joining", "leaving", "open", "closed"];
// Statuses whose accounts Carbon Impact looks after, or still holds the approvals of.
const LOOKED_AFTER: Status["kind"][] = ["in", "joined", "partly", "left"];

const positions = document.getElementById("accounts")!;
const bar = positions.querySelector<HTMLElement>(".bar")!;
const choosePicked = bar.querySelector<HTMLButtonElement>("button")!;
const listening = new WeakSet<Provider>();

let connection: Connection | undefined;
let shown: Holdings | undefined;
// The accounts shown that the owner can change from here.
let able: Account[] = [];
let payoutChanges: { owner: Address; found: PayoutChange[] } | undefined;
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
    fee: bps(found.feeBps),
    "max-fee": bps(found.maxFeeBps),
    power: earningPower(votes),
    entity,
    beneficiary: beneficiary || "No name",
    message,
  });
  fillAddress(document, "beneficiary-address", beneficiaryAddress);
  show(".admin-moved", !found.admin);
  show(".keeper-moved", !found.keeper);
  fillTime(document, "week-start", epochStart);
  fillTime(document, "week-end", epochStart + WEEK);
  fillTime(document, "week-end-when", epochStart + WEEK, when);
  if (voted) fillTime(document, "impact-voted", voted, utc);
  fillTime(document, "vote-day", epochStart + WEEK - 1);
  const facts = document.querySelector("#fee-facts .facts-here")!;
  if (facts.firstElementChild) showFeeFacts(facts, found);
  else facts.replaceChildren(feeFacts(found));
  refreshChoose({ carbonImpact: found });
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
    if (!changed) return;
    showShares();
    refreshChoose();
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
  refreshChoose({ trusted });
  // A read of the accounts that is under way shows the result when it ends.
  if (!reading) showAccounts(true);
}

// Whether the owner can change anything for the account from here: join, or leave an automation.
const changeable = (account: Account): boolean =>
  (trusted && canJoin(account, now())) || canLeave(account) || canLeaveOther(account);

function accountKind({ lockType, end }: Account): string {
  if (lockType === LockType.permanent) return "Protocol Account";
  if (lockType === LockType.rolling) return "Flex Account, rolling lock";
  return end ? `Flex Account, lock ${end > now() ? "ends" : "ended"} ${date(end)}` : "Flex Account";
}

function accountItem(
  holdings: Holdings,
  account: Account,
  status: Status,
  pickable: boolean,
  change: Change | undefined,
): DocumentFragment {
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
  fill(item, { "earned-usd": earned === undefined ? "—" : usd(earned) });
  if (change && LOOKED_AFTER.includes(status.kind)) {
    fill(item, { "changed-what": whatChanged(change) });
    fillTime(item, "changed-on", change.time);
    show(".changed", true, item);
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

const which = (accounts: Account[]): string => list(accounts.map(({ id }) => `#${id}`));

function needItem(need: Need): DocumentFragment {
  const item = clone(`need-${need.kind}`);
  fill(item, { which: which(need.accounts) });
  fillPlural(item, need.accounts.length);
  if (need.kind === "stopped") fillTime(item, "since", need.since);
  if (need.kind === "unvoted") {
    show(".never", !need.voted, item);
    show(".last", !!need.voted, item);
    // It may be long ago, so with the year.
    if (need.voted) fillTime(item, "voted", need.voted, date);
  }
  item.querySelector("button")!.addEventListener("click", () => choose(need.accounts));
  return item;
}

// What needs the owner, first: accounts that earn nothing or are half in, a change to Carbon Impact's settings, and
// a payout address someone else changed.
function showNeeds(holdings: Holdings, change: Change | undefined, members: boolean): void {
  const items = needsOf(holdings, now()).map(needItem);
  if (change && members) {
    const item = clone("need-changed");
    fill(item, { "changed-what": whatChanged(change) });
    fillTime(item, "changed-on", change.time);
    items.push(item);
  }
  const payout = payoutChanges?.owner === holdings.owner ? payoutChanges.found[0] : undefined;
  if (payout?.by && !same(payout.by, holdings.owner)) {
    const item = clone("need-payout");
    fillTime(item, "changed-on", payout.time);
    items.push(item);
  }
  document.querySelector("#needs .needs")!.replaceChildren(...items);
  show("#needs", items.length > 0);
}

function showSummary(holdings: Holdings, sorted: { account: Account; status: Status; group: Group }[]): void {
  const { owner, payout } = holdings;
  const full = sorted.filter(({ account }) => account.amount > 0n);
  const inGroups = (...names: Group[]) => full.filter((member) => names.includes(member.group)).length;
  const [members, stopped] = [inGroups("in", "joining"), inGroups("stopped")];
  const power = full.reduce((sum, { account }) => sum + account.votes, 0n);
  const earned = full.flatMap(({ account }) => earnedByAccount(holdings, account.id) ?? []);
  fill(document, {
    "summary-line": [
      count(full.length, "account", "accounts"),
      ...(members ? [count(members, "in Carbon Impact", "in Carbon Impact")] : []),
      ...(stopped ? [count(stopped, "in an automation that stopped", "in automations that stopped")] : []),
      `${earningPower(power)} Earning Power`,
    ].join(" · "),
    "mine-earned": usd(earned.reduce((sum, value) => sum + value, 0)),
    "mine-in": earned.length === 1 ? "account" : count(earned.length, "account", "accounts"),
  });
  show(".summary-earned", earned.length > 0);
  show(".summary-next", members > 0);
  const own = same(payout, owner);
  show(".payout-own, #itself", own);
  show(".payout-other", !own);
  fillAddress(document, "payout-to", payout);
  fillAddress(document, "owner", owner);
  fillAddress(document, "payout", payout);
  show("#summary, #payout", full.length > 0);
  show("#none", !full.length);
}

// The positions, what needs the owner first. When the owner can change more than one, each gets a box to tick, and
// the bar below chooses for the ticked ones.
function showAccounts(keepTicked = false): void {
  const holdings = shown;
  if (!holdings) return;
  const { owner, accounts, epochStart } = holdings;
  const ticked = positions.querySelectorAll<HTMLInputElement>(".pick:checked");
  const kept = new Set(keepTicked ? [...ticked].map(({ value }) => value) : []);
  const time = now();
  const sorted = accounts
    .map((account) => {
      const status = statusOf(account, owner, time, epochStart);
      return { account, status, group: groupOf(account, status) };
    })
    .sort((a, b) => GROUPS.indexOf(a.group) - GROUPS.indexOf(b.group));
  able = sorted.map(({ account }) => account).filter(changeable);
  const change = settingsChanged()?.[0];
  const items = (listed: typeof sorted) =>
    listed.map(({ account, status }) =>
      accountItem(holdings, account, status, able.length > 1 && able.includes(account), change),
    );
  // Some wallets hold many empty accounts, which can do nothing: they go in a fold.
  const empty = sorted.filter(({ account, group }) => account.amount === 0n && group === "closed");
  positions.querySelector(".positions")!.replaceChildren(...items(sorted.filter((item) => !empty.includes(item))));
  const fold = positions.querySelector<HTMLDetailsElement>(".empty-accounts")!;
  fold.querySelector(".positions")!.replaceChildren(...items(empty));
  fill(fold, { "empty-count": count(empty.length, "empty account", "empty accounts") });
  fold.hidden = !empty.length;
  for (const box of positions.querySelectorAll<HTMLInputElement>(".pick:not([hidden])")) {
    box.checked = kept.has(box.value);
  }
  updateBar();
  // What changed matters to accounts Carbon Impact looks after, and to where their payouts go.
  const members = sorted.some(({ status }) => LOOKED_AFTER.includes(status.kind));
  if (members) {
    watchChanges();
    if (payoutChanges?.owner !== owner) loadPayoutChanges(owner);
  }
  showNeeds(holdings, change, members);
  showSummary(holdings, sorted);
  show("#accounts", sorted.length > 0);
}

async function loadAccounts(quietly = false): Promise<void> {
  if (!connection) return;
  const read = ++reads;
  reading = true;
  if (!quietly) {
    shown = undefined;
    forgetPayout();
    show("#reading");
    show("#accounts, #summary, #needs, #none, #payout", false);
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

// Where the owner's payouts go, and who changed it, in the last four epochs. The page works without it.
function loadPayoutChanges(owner: Address): void {
  payoutChanges = { owner, found: [] };
  showPayoutChanges(owner, []);
  readPayoutChanges(owner).then(
    (found) => {
      if (payoutChanges?.owner !== owner) return;
      payoutChanges.found = found;
      showPayoutChanges(owner, found);
      if (shown?.owner === owner) showAccounts(true);
    },
    // Not read again until another owner connects.
    console.error,
  );
}

// The ticked accounts, or the one account the owner can change, which has no box.
function picked(): Account[] {
  if (able.length <= 1) return able;
  const ids = new Set([...positions.querySelectorAll<HTMLInputElement>(".pick:checked")].map(({ value }) => value));
  return able.filter(({ id }) => ids.has(String(id)));
}

function updateBar(): void {
  const accounts = picked();
  choosePicked.disabled = !accounts.length;
  choosePicked.textContent =
    able.length === 1
      ? `Choose for ${which(able)}`
      : accounts.length
        ? `Choose for ${count(accounts.length, "account", "accounts")}`
        : "Choose";
  bar.hidden = !able.length;
  show(".pick-hint", able.length > 1 && !accounts.length, bar);
}

const hooks: Hooks = {
  closed: (submitted) => submitted && loadAccounts(true),
  switched: showConnection,
};

function choose(accounts: Account[]): void {
  if (!connection || !shown) return;
  // In a new epoch, the statuses and dates shown would be wrong: read the accounts again instead.
  if (weekStart(now()) > shown.epochStart) return void loadAccounts();
  openChoose({ holdings: shown, accounts, carbonImpact, trusted, proceed: review });
}

// The review of a choice's calls, for the accounts it changes.
function review(choice: Choice, picks: Account[]): void {
  if (!connection || !shown) return;
  if (weekStart(now()) > shown.epochStart) return void loadAccounts();
  // A join shows the share retired and the fee facts, so it waits for Carbon Impact's settings. Leaving never waits.
  if (choice === "join" && !carbonImpact) {
    return void readCarbonImpactAgain().then(() => review(choice, picks), failed);
  }
  if (choice === "join" && !trusted) return;
  const steps = callsFor(choice, picks, now());
  if (!steps.length) return;
  const accounts = picks.filter(({ id }) => steps.some((step) => step.id === id));
  const { owner, epochStart } = shown;
  const settings = carbonImpact;
  const prepare = (id: string, members = accounts): DocumentFragment => {
    const part = clone(id);
    fill(part, { which: which(members) });
    fillTime(part, "next", epochStart + WEEK, when);
    fillPlural(part, members.length);
    if (settings) fill(part, { "retired-share": share(settings.retireBps), entity: settings.entity });
    return part;
  };
  if (choice === "join") {
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
    const changes = prepare("join-changes");
    const per = lastPerThousand();
    if (per && settings) {
      const votes = accounts.reduce((sum, account) => sum + account.votes, 0n);
      const earned = (per.ours * Number(toEarningPower(votes))) / 1e21;
      const kept = (1 - Number(settings.retireBps) / 1e4) * (1 - Number(settings.feeBps) / 1e4);
      fill(changes, {
        "estimate-power": earningPower(votes),
        "estimate-earned": usd(earned),
        "estimate-yours": usd(earned * kept),
      });
      show(".estimate", true, changes);
    }
    if (settings) changes.querySelector(".facts-here")!.replaceChildren(feeFacts(settings));
    const pages = [
      { title: "Before you join", body: before },
      { title: "What changes", body: changes },
      { title: "What your wallet will ask" },
    ];
    return openReview("Join Carbon Impact", pages, steps, connection, hooks, prepare("join-done"));
  }
  // Voting yourself leaves Carbon Impact, other automations, or both.
  const fromImpact = accounts.filter((account) => steps.some((step) => step.id === account.id && !step.automation));
  const others = steps.filter(({ automation }) => automation);
  const names = [...new Set(others.flatMap(({ automation }) => automation ?? []))];
  const effects = document.createDocumentFragment();
  if (fromImpact.length) effects.append(prepare("leave-effects", fromImpact));
  if (others.length) {
    const part = prepare(
      "leave-other-effects",
      accounts.filter(({ id }) => others.some((step) => step.id === id)),
    );
    fill(part, { automations: list(names) });
    effects.append(part);
  }
  const title = `Leave ${list([...(fromImpact.length ? ["Carbon Impact"] : []), ...names])}`;
  openReview(title, [{ title, body: effects }], steps, connection, hooks);
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

// Whether the wallet can send several calls in one request, asked again whenever the account or chain changes.
function checkBatching(connected: Connection): void {
  if (connected.wallet.propose) return;
  canBatch(connected).then((batches) => {
    if (connection !== connected) return;
    connected.batches = batches;
    refreshReview();
  }, console.error);
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
  checkBatching(connected);
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
    delete connection.batches;
    showConnection();
    checkBatching(connection);
    loadAccounts();
  });
  provider.on?.("chainChanged", (chainId: string) => {
    if (connection?.provider !== provider) return;
    connection.chainId = Number(chainId);
    showConnection();
    checkBatching(connection);
  });
  provider.on?.("disconnect", () => {
    if (connection?.provider === provider) letGo();
  });
}

function letGo(): void {
  ignoredUpTo = attempts;
  reads++;
  reading = false;
  connection = shown = payoutChanges = undefined;
  forgetPayout();
  closeReview();
  closeChoose();
  showConnection();
  show("#reading, #accounts, #summary, #needs, #none, #payout", false);
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
positions.addEventListener("change", updateBar);
choosePicked.addEventListener("click", () => {
  const accounts = picked();
  if (accounts.length) choose(accounts);
});
document.querySelector("#wrong-chain .switch")!.addEventListener("click", () => {
  if (!connection) return;
  show("#switch-failed", false);
  switchToBase(connection).then(showConnection, (error) => {
    if (declined(error)) return;
    console.error(error);
    show("#switch-failed");
  });
});
onChanges(() => showAccounts(true));

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
