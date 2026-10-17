import { getAddress } from "viem";
import "./views.ts";
import { same } from "./chain.ts";
import { CHAIN_ID } from "./config.ts";
import { clone, fill, fillAddress, fillPlural, fillTime, show } from "./dom.ts";
import { readAllEarnings, readEarnings, sharesOf, valueOf, type Earnings } from "./earnings.ts";
import {
  WEEK,
  bps,
  compact,
  count,
  date,
  earningPower,
  fraction,
  list,
  share,
  short,
  units,
  until,
  usd,
  weekStart,
  when,
} from "./format.ts";
import {
  LockType,
  automation,
  canJoin,
  canLeave,
  canRelease,
  check,
  group,
  join,
  leave,
  readAccounts,
  readAutomations,
  readRelay,
  release,
  status,
  type Account,
  type Automation,
  type Group,
  type Holdings,
  type Relay,
  type Status,
} from "./hydrex.ts";
import { close, review, update, type Hooks } from "./review.ts";
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

// What a group's buttons do: join Carbon Impact, leave it, or leave another automation.
type Action = "join" | "leave" | "release";

const groups = [...document.querySelectorAll<HTMLElement>("#accounts .group")];
const listening = new WeakSet<Provider>();
// The accounts of each group that its buttons can act on.
const actionable = new WeakMap<HTMLElement, Account[]>();

let connection: Connection | undefined;
let shown: Holdings | undefined;
let relay: Relay | undefined;
let trusted = false;
let reads = 0;
let reading = false;
let relayRead: Promise<void> | undefined;
let attempts = 0;
let stale = 0;
let clicks = 0;
// Base's time less the device's, from the newest block read: a read that started earlier may answer from an older one.
let drift = 0;
let newest = 0;
// What the automation's votes earned in the last epoch that has ended, and when the page last tried to read it.
let earned: { found: Earnings; value: Value } | undefined;
let earningsTried = 0;
let earningsRead: Promise<void> | undefined;
// Each shown account's share of the automation's votes in that epoch.
let shares: { holdings: Holdings; start: number; of: Map<bigint, number> } | undefined;
// The epoch the comparison with all of Hydrex is read for, and whether its table is on the screen.
let compared: number | undefined;
let onScreen = false;

type Value = ReturnType<typeof valueOf>;

const now = () => Math.floor(Date.now() / 1000) + drift;

function sawBlock(time: number): void {
  if (time < newest) return;
  newest = time;
  drift = time - Math.floor(Date.now() / 1000);
}

function failed(error: unknown): void {
  console.error(error);
  show("#error");
}

function showRelay(found: Relay): void {
  relay = found;
  sawBlock(found.time);
  const { epochStart, tonnes, retireBps, votes, entity, beneficiary, beneficiaryAddress, message } = found;
  fill(document, {
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
  fillTime(document, "vote-day", epochStart + WEEK - 1);
  tick();
}

function tick(): void {
  catchUp();
  if (!relay) return;
  const time = now();
  const end = relay.epochStart + WEEK;
  if (time >= end) return;
  fill(document, { countdown: `in ${until(end - time)}` });
  fillTime(document, "today", time);
  for (const bar of document.querySelectorAll<HTMLProgressElement>("progress.elapsed")) {
    bar.value = time - relay.epochStart;
  }
}

// One read of the automation at a time.
const readRelayAgain = (): Promise<void> =>
  (relayRead ??= readRelay()
    .then(showRelay)
    .finally(() => (relayRead = undefined)));

// Reads again what is missing or from an epoch that has ended: the page moves on by itself. What the votes earned is
// tried at most every five minutes: until Hydrex's own epoch has moved on, each try is one read.
function catchUp(): void {
  const epoch = weekStart(now());
  if (shown && !reading && epoch > shown.epochStart) loadAccounts(true);
  if (!relay || epoch > relay.epochStart) readRelayAgain().catch(console.error);
  const stale = !earned || earned.found.start < epoch - WEEK;
  if (stale && Date.now() - earningsTried > 300_000) loadEarnings();
}

function loadEarnings(): void {
  if (earningsRead) return;
  earningsTried = Date.now();
  earningsRead = readEarnings(earned?.found.start)
    .then(
      (found) => found && showEarnings(found),
      (error) => {
        // Like the other automations' votes, it only adds to the page: it says so where the figures go, and keeps those
        // of an earlier epoch.
        console.error(error);
        show(".earnings-failed", !earned);
        show(".earnings-read", !!earned);
      },
    )
    .finally(() => (earningsRead = undefined));
}

const earningsTable = document.querySelector<HTMLElement>("#last-epoch .earnings")!;
const comparison = {
  status: document.querySelector<HTMLElement>("#last-epoch .all-status")!,
  failed: document.querySelector<HTMLElement>("#last-epoch .all-failed")!,
  versus: document.querySelector<HTMLElement>("#last-epoch .versus")!,
};
// Dollars per 1,000 Earning Power, from votes with 18 decimals: Hydrex shows 1.3 times the votes.
const perThousand = (value: number, votes: bigint): number => (votes > 0n ? value / ((Number(votes) * 1.3) / 1e21) : 0);

function showColumn(column: "ours" | "all", { votes, pools }: Earnings, value: Value | undefined): void {
  const per = value && perThousand(value.usd, votes);
  const texts = {
    "earning-power": compact((votes * 13n) / 10n),
    pools: count(pools.length, "pool", "pools"),
    earned: value ? usd(value.usd) : "…",
    fees: value ? usd(value.fees) : "…",
    incentives: value ? usd(value.incentives) : "…",
    "per-power": per === undefined ? "…" : usd(per),
  };
  for (const [name, text] of Object.entries(texts)) {
    for (const cell of earningsTable.querySelectorAll(`.${column}.${name}`)) cell.textContent = text;
  }
}

function showPools({ pools, votes }: Earnings, value: Value): void {
  const poolRows = pools.map((pool) => {
    const row = clone("earned-pool");
    fillAddress(row, "pool", pool.address, pool.name);
    const earnedThere = value.byPool.get(pool.address.toLowerCase()) ?? 0;
    fill(row, { share: fraction(Number(pool.votes) / Number(votes)), usd: usd(earnedThere) });
    return row;
  });
  document.querySelector("#last-epoch .earned-pools tbody")!.replaceChildren(...poolRows);
}

function showEarnings(found: Earnings): void {
  const value = valueOf(found);
  earned = { found, value };
  show(".earnings-failed", false);
  show(".earnings-read");
  const per = perThousand(value.usd, found.votes);
  fillTime(document, "last-start", found.start);
  fillTime(document, "last-end", found.start + WEEK);
  fill(document, { "last-per-power": usd(per) });
  showColumn("ours", found, value);
  showPools(found, value);
  comparison.status.textContent = comparison.status.dataset.text ?? "";
  comparison.status.hidden = false;
  comparison.failed.hidden = comparison.versus.hidden = true;
  for (const cell of earningsTable.querySelectorAll(".all")) cell.textContent = "…";
  if (onScreen) compare();
  loadShares();
}

// All of Hydrex is ten times the reads, so it waits until its table is on the screen. Both columns then take the same
// prices, so that they compare on the same footing.
function compare(): void {
  const mine = earned?.found;
  if (!mine || compared === mine.start) return;
  compared = mine.start;
  comparison.failed.hidden = true;
  comparison.status.hidden = false;
  comparison.status.textContent = "Reading every pool's rewards…";
  readAllEarnings(mine.start).then(
    (all) => {
      if (earned?.found !== mine) return;
      const ours = valueOf({ ...mine, prices: all.prices });
      const average = valueOf(all);
      showColumn("ours", mine, ours);
      showColumn("all", all, average);
      const ratio = perThousand(ours.usd, mine.votes) / perThousand(average.usd, all.votes);
      comparison.versus.textContent =
        Math.abs(ratio - 1) < 0.005
          ? "Last epoch, Carbon Impact earned about as much per 1,000 Earning Power as the average on Hydrex, at the same prices."
          : `Last epoch, Carbon Impact earned ${fraction(Math.abs(ratio - 1))} ${ratio > 1 ? "more" : "less"} per 1,000 Earning Power than the average on Hydrex, at the same prices. Tokens left unpriced count for nothing in either.`;
      comparison.status.hidden = true;
      comparison.versus.hidden = !Number.isFinite(ratio);
    },
    (error) => {
      console.error(error);
      if (earned?.found !== mine) return;
      compared = undefined;
      comparison.status.hidden = true;
      comparison.failed.hidden = false;
    },
  );
}

// What each account's votes earned with Carbon Impact last epoch: its share of the automation's votes.
async function loadShares(): Promise<void> {
  const [holdings, found] = [shown, earned?.found];
  if (!holdings || !found || (shares?.holdings === holdings && shares.start === found.start)) return;
  const ids = holdings.accounts.filter(({ amount }) => amount > 0n).map(({ id }) => id);
  const of = await sharesOf(ids, found.start, found.votes).catch((error) => void console.error(error));
  if (!of || shown !== holdings || earned?.found !== found) return;
  shares = { holdings, start: found.start, of };
  showAccounts(true);
}

function showAutomations(found: Automation[]): void {
  for (const row of document.querySelectorAll<HTMLElement>("tr[data-automation]")) {
    const automation = found.find(({ address }) => same(address, row.dataset.automation ?? ""));
    if (!automation) continue;
    if (automation.voted) fillTime(row, "voted", automation.voted);
    if (automation.votes !== undefined) fill(row, { "still-in": earningPower(automation.votes) });
  }
}

async function showChecks(): Promise<void> {
  const failing = await check();
  for (const item of document.querySelectorAll<HTMLElement>("#checks li")) item.hidden = !failing.includes(item.id);
  show("#checks", failing.length > 0);
  trusted = !failing.length;
  // A read on its way shows the result when it ends.
  if (!reading) showAccounts(true);
}

const joinable = (account: Account): boolean => trusted && canJoin(account, now());
const can: Record<Action, (account: Account) => boolean> = { join: joinable, leave: canLeave, release: canRelease };
const buttons = (section: HTMLElement) => [...section.querySelectorAll<HTMLButtonElement>("button[data-action]")];
const actionOf = (button: HTMLButtonElement) => button.dataset.action as Action;

function kind({ lockType, end }: Account): string {
  if (lockType === LockType.permanent) return "Protocol Account";
  if (lockType === LockType.rolling) return "Flex Account, rolling lock";
  return end ? `Flex Account, lock ${end > now() ? "ends" : "ended"} ${date(end)}` : "Flex Account";
}

function accountItem(account: Account, state: Status, pickable: boolean): DocumentFragment {
  const item = clone("account");
  const name = account.name || "Account";
  fill(item, { name, id: `#${account.id}`, kind: kind(account), votes: earningPower(account.votes) });
  const line = clone(state.kind);
  if ("date" in state) fillTime(line, "date", state.date);
  if ("voted" in state) {
    fillTime(line, "voted", state.voted);
    fillTime(line, "since", state.since);
  }
  if ("name" in state) fill(line, { automation: state.name });
  if ("to" in state) fillAddress(line, "address", state.to);
  item.querySelector(".status")!.replaceWith(line);
  // Shares of the epoch shown, for the accounts shown: a share from another epoch, or for another read of the accounts,
  // would be multiplied by the wrong total.
  const part =
    shares && shares.holdings === shown && shares.start === earned?.found.start ? shares.of.get(account.id) : undefined;
  if (part !== undefined && earned) {
    fill(item, { "earned-usd": usd(part * earned.value.usd) });
    show(".earned", true, item);
  }
  if (pickable) {
    const box = item.querySelector<HTMLInputElement>(".pick")!;
    // A hidden box stays disabled, so that a click on its row's label cannot tick it.
    box.hidden = box.disabled = false;
    box.value = String(account.id);
    box.ariaLabel = `Pick ${name} #${account.id}`;
  }
  return item;
}

// Each group lists its accounts, with ticks when its buttons could act on more than one, so that one selection is
// always one action.
function showAccounts(keepTicked = false): void {
  const holdings = shown;
  if (!holdings) return;
  const { owner, accounts, payout, epochStart } = holdings;
  const ticked = document.querySelectorAll<HTMLInputElement>("#accounts .pick:checked");
  const kept = new Set(keepTicked ? [...ticked].map(({ value }) => value) : []);
  const time = now();
  const sorted = accounts.map((account) => {
    const state = status(account, owner, time, epochStart);
    return { account, state, group: group(account, state) };
  });
  for (const section of groups) {
    const members = sorted.filter((member) => member.group === section.dataset.group);
    // Some wallets hold many empty accounts, which can do nothing.
    const folded = section.dataset.group === "closed" ? members.filter(({ account }) => account.amount === 0n) : [];
    const able = members
      .map(({ account }) => account)
      .filter((account) => buttons(section).some((button) => can[actionOf(button)](account)));
    const items = (listed: typeof members) =>
      listed.map(({ account, state }) => accountItem(account, state, able.length > 1 && able.includes(account)));
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
  fillAddress(document, "payout-short", payout);
  fillAddress(document, "owner", owner);
  fillAddress(document, "payout", payout, payout);
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
    show("#reading");
    show("#accounts, #summary, #none, #payout", false);
  }
  try {
    const found = await readAccounts(connection.address);
    if (read !== reads) return;
    sawBlock(found.time);
    shown = found;
    showAccounts();
    catchUp();
    loadShares();
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
  // In a new epoch, the statuses and the review's dates would be last epoch's.
  if (weekStart(now()) > shown.epochStart) return void loadAccounts();
  // A join says what share is retired, from the automation's settings. Leaving never waits for them.
  if (action === "join" && !relay) return void readRelayAgain().then(() => reviewPicked(section, action), failed);
  const accounts = picked(section).filter(can[action]);
  if (!accounts.length) return updateButtons();
  const { owner, epochStart } = shown;
  const settings = relay;
  const which = list(accounts.map(({ id }) => `#${id}`));
  const prepare = (id: string): DocumentFragment => {
    const part = clone(id);
    fill(part, { which });
    fillTime(part, "next", epochStart + WEEK, when);
    fillPlural(part, accounts.length);
    if (settings) {
      const { retireBps, entity } = settings;
      fill(part, { "retired-share": share(retireBps), entity });
    }
    return part;
  };
  if (action === "join") {
    const before = prepare("join-before");
    const from = (kind: Status["kind"]) =>
      accounts.filter((account) => status(account, owner, now(), epochStart).kind === kind);
    const [stopped, running] = [from("stopped"), from("other")];
    fill(before, {
      "stopped-which": list(stopped.map(({ id, delegate }) => `#${id} is in ${automation(delegate)}`)),
      "running-which": list(running.map(({ id, delegate }) => `#${id} out of ${automation(delegate)}`)),
    });
    show(".from-stopped", stopped.length > 0, before);
    show(".from-running", running.length > 0, before);
    const pages = [
      { title: "Before you join", body: before },
      { title: "What changes", body: prepare("join-changes") },
      { title: "What your wallet will ask" },
    ];
    return review("Join Carbon Impact", pages, join(accounts), connection, hooks, prepare("join-done"));
  }
  if (action === "leave") {
    const title = "Leave Carbon Impact";
    return review(title, [{ title, body: prepare("leave-effects") }], leave(accounts), connection, hooks);
  }
  const steps = release(accounts);
  const names = list([...new Set(steps.flatMap(({ automation }) => automation ?? []))]);
  const effects = prepare("release-effects");
  fill(effects, { automations: names });
  review(`Leave ${names}`, [{ title: `Leave ${names}`, body: effects }], steps, connection, hooks);
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
  update();
}

// A later attempt that fails, as when the wallet still asks about an earlier one, does not cancel it.
async function connectTo(wallet: Wallet): Promise<void> {
  const attempt = ++attempts;
  const connected = await connect(wallet);
  if (!connected || attempt <= stale) return;
  stale = attempt;
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
    close();
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
  stale = attempts;
  reads++;
  reading = false;
  connection = undefined;
  shown = undefined;
  close();
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
// A reload keeps the address, and so the view.
document.querySelector("#error .again")!.addEventListener("click", () => location.reload());
document.getElementById("accounts")!.addEventListener("change", updateButtons);
for (const section of groups) {
  for (const button of buttons(section))
    button.addEventListener("click", () => reviewPicked(section, actionOf(button)));
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
readRelayAgain().catch(failed);
showChecks().catch(failed);
comparison.status.dataset.text = comparison.status.textContent ?? "";
loadEarnings();
readAutomations().then(showAutomations, console.error);
new IntersectionObserver((entries) => {
  onScreen = entries.some(({ isIntersecting }) => isIntersecting);
  if (onScreen) compare();
}).observe(earningsTable);
document.querySelector("#last-epoch .compare-again")!.addEventListener("click", compare);
setInterval(() => showChecks().catch(console.error), 3_600_000);
setInterval(tick, 30_000);
