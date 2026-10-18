import { getAddress } from "viem";
import "./views.ts";
import { readLater, same } from "./chain.ts";
import { CHAIN_ID, CONDUIT, KVCM } from "./config.ts";
import { clone, fill, fillAddress, fillPlural, fillTime, groupHex, show, showHex } from "./dom.ts";
import { readAllEarnings, readEarnings, sharesOf, tokensOf, valueOf, type Earnings } from "./earnings.ts";
import {
  WEEK,
  amount,
  bps,
  compact,
  count,
  date,
  earningPower,
  fraction,
  list,
  listWith,
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
  stopped,
  type Account,
  type Automation,
  type Group,
  type Holdings,
  type Relay,
  type Status,
} from "./hydrex.ts";
import { pricesAt, usdOf, type Price, type Token } from "./prices.ts";
import {
  blockTimes,
  lastRun,
  namesAt,
  totalRetired,
  type Amount,
  type Payout,
  type Run,
  type Search,
} from "./receipts.ts";
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
// Carbon Impact's last payout, read again once the total retired has grown, when it was last checked, and the accounts
// whose receipts are shown.
let search: Promise<Search> | undefined;
let searchChecked = 0;
let receiptsFor: Holdings | undefined;
// The owner whose last payout the section shows, and whether as receipts.
let showing: { owner: string; drawn: boolean } | undefined;

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
  const { epochStart, tonnes, retireBps, votes, entity, beneficiary, beneficiaryAddress, message, voted } = found;
  // On Home, running while it votes each epoch.
  const halted = stopped(voted, epochStart);
  document
    .querySelector(".relay-shape")!
    .classList.replace(halted ? "running" : "stopped", halted ? "stopped" : "running");
  fill(document, {
    "relay-state": halted ? "Stopped" : "Running",
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
  if (voted) fillTime(document, "relay-voted", voted, utc);
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
  checkSearch();
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

const receipts = document.getElementById("receipts")!;

const RECEIPT_STATES = ["reading", "none", "other", "underway", "failed", "found"] as const;

function receiptsState(state: (typeof RECEIPT_STATES)[number]): void {
  for (const name of RECEIPT_STATES) show(`.receipts-${name}`, name === state, receipts);
}

const tokenOf = (tokens: Map<string, Token>, address: string) => tokens.get(address.toLowerCase());

// A line's tokens, by name; one without decimals by its address, in its smallest units.
function showAmounts(element: Element, found: Amount[], tokens: Map<string, Token>, sign = ""): void {
  if (!found.length) return void element.replaceChildren("0 kVCM");
  const items = found.map(({ token, amount: value }) => {
    const known = tokenOf(tokens, token);
    if (known) return `${amount(value, known.decimals)} ${known.symbol}`;
    const address = document.createElement("code");
    address.translate = false;
    showHex(address, token);
    const unknown = document.createElement("span");
    unknown.append(`${value} base units of `, address);
    return unknown;
  });
  element.replaceChildren(sign, ...listWith<Node | string>(items));
}

function worth(found: Amount[], tokens: Map<string, Token>, prices: Map<string, Price> | undefined): string {
  if (!prices) return "";
  const usdValue = found.reduce((sum, { token, amount: value }) => {
    const [known, price] = [tokenOf(tokens, token), prices.get(token.toLowerCase())];
    return known && price ? sum + usdOf(value, known, price) : sum;
  }, 0);
  return usdValue > 0 ? usd(usdValue) : "";
}

const kvcm = (found: Amount[]): bigint => found.find(({ token }) => same(token, KVCM))?.amount ?? 0n;

// Its fields have names of their own: the automation's figures, such as the tonnes it retired, are filled by name
// across the whole page.
function receipt(payout: Payout, time: number, name: string, tokens: Map<string, Token>, prices?: Map<string, Price>) {
  const item = clone("receipt");
  // What was claimed as kVCM was not swapped. Its shares are of all the kVCM, as the automation retires up to its share,
  // and pays the rest.
  const all = kvcm(payout.paid) + kvcm(payout.fees) + payout.retiredKvcm;
  const swapped = all - kvcm(payout.earned);
  const of = (part: bigint) => (all ? bps((part * 10_000n + all / 2n) / all) : "");
  fill(item, {
    "receipt-id": `#${payout.id}`,
    "receipt-earned-usd": worth(payout.earned, tokens, prices),
    "receipt-swapped": `${amount(swapped > 0n ? swapped : 0n, 18)} kVCM`,
    "receipt-retired-share": of(payout.retiredKvcm),
    "receipt-retired": `${payout.retiredKvcm ? "−" : ""}${amount(payout.retiredKvcm, 18)} kVCM`,
    "receipt-tonnes": `${amount(payout.tonnes, 18)} t of carbon credits`,
    "receipt-entity": name,
    "receipt-fee-share": of(kvcm(payout.fees)),
    "receipt-paid-usd": worth(payout.paid, tokens, prices),
  });
  showAmounts(item.querySelector(".receipt-earned")!, payout.earned, tokens);
  showAmounts(item.querySelector(".receipt-fee")!, payout.fees, tokens, payout.fees.length ? "−" : "");
  showAmounts(item.querySelector(".receipt-paid")!, payout.paid, tokens);
  show(".receipt-carbon, .through", payout.tonnes > 0n, item);
  // The epoch whose rewards it paid, which ended at the flip before it.
  fillTime(item, "receipt-from", weekStart(time) - WEEK);
  fillTime(item, "receipt-to", weekStart(time));
  fillTime(item, "receipt-time", time, utc);
  // The owner may have a payout address of their own.
  show(".receipt-elsewhere", !same(payout.recipient, payout.owner), item);
  fillAddress(item, "receipt-recipient", payout.recipient);
  item.querySelector<HTMLAnchorElement>(".receipt-tx")!.href = `https://basescan.org/tx/${payout.tx}`;
  return item;
}

// A run takes up to half a day: one whose last payout is more recent may still be under way.
const UNDER_WAY = 12 * 3600;

// A receipt for each of the owner's accounts in Carbon Impact's last payout. Only for an owner with an account that is
// in it, or was at the start of this epoch: finding the payout takes some 20 to 120 reads. Read again quietly, what is
// shown stays until there is something new to show: a run under way that has not reached the owner's accounts leaves
// the receipts of the last one, and a read that fails leaves them all.
async function loadReceipts(quietly = false): Promise<void> {
  const holdings = shown;
  if (!holdings || receiptsFor?.owner === holdings.owner) return;
  const member = holdings.accounts.some(({ delegate, claimer, delegateAtStart }) =>
    [delegate, claimer, delegateAtStart].some((address) => same(address, CONDUIT)),
  );
  receipts.hidden = !member;
  if (!member) return;
  receiptsFor = holdings;
  const owner = holdings.owner.toLowerCase();
  const kept = quietly && showing?.owner === owner;
  if (!kept) receiptsState("reading");
  // Another owner, or a read started since, takes over.
  const current = () => receiptsFor === holdings && shown?.owner === holdings.owner;
  const fail = (error: unknown) => {
    console.error(error);
    if (!current() || kept) return;
    receiptsFor = undefined;
    receiptsState("failed");
  };
  const settle = (state: "none" | "other" | "underway") => {
    showing = { owner, drawn: false };
    receiptsState(state);
  };
  if (!search) searchChecked = Date.now();
  const reading = (search ??= lastRun());
  let found: Run | undefined;
  try {
    ({ run: found } = await reading);
  } catch (error) {
    // Only a search that failed is dropped: the receipts' other reads failing keeps it.
    if (search === reading) search = undefined;
    return fail(error);
  }
  if (!current()) return;
  if (!found) return settle("none");
  const underway = now() - found.time < UNDER_WAY;
  const mine = found.payouts.filter((payout) => same(payout.owner, owner));
  if (!mine.length) {
    if (underway && kept && showing?.drawn) {
      fillTime(receipts, "run-next", found.time);
      show(".receipts-more", false, receipts);
      show(".receipts-next", true, receipts);
      return;
    }
    fillTime(receipts, "run-day", found.time);
    return settle(underway ? "underway" : "other");
  }
  const all = mine.flatMap(({ earned, paid, fees }) => [...earned, ...paid, ...fees]);
  let tokens: Map<string, Token>;
  let times: Map<number, number>;
  let names: Map<number, string>;
  try {
    [tokens, times, names] = await Promise.all([
      tokensOf(
        all.map(({ token }) => token),
        readLater,
      ),
      blockTimes(mine.map(({ block }) => block)),
      namesAt(mine.map(({ block }) => block)),
    ]);
  } catch (error) {
    return fail(error);
  }
  if (!current()) return;
  // Each token is priced for the largest amount of it a receipt shows in dollars, earned or paid.
  const amounts = new Map<string, bigint>();
  for (const { token, amount: value } of mine.flatMap(({ earned, paid }) => [...earned, ...paid]))
    if (value > (amounts.get(token.toLowerCase()) ?? 0n)) amounts.set(token.toLowerCase(), value);
  const shelf = receipts.querySelector(".receipt-list")!;
  const draw = (prices?: Map<string, Price>) =>
    shelf.replaceChildren(
      ...mine.map((payout) => receipt(payout, times.get(payout.block)!, names.get(payout.block)!, tokens, prices)),
    );
  draw();
  fill(receipts, { "receipt-which": list(mine.map(({ id }) => `#${id}`)) });
  fillTime(receipts, "run-day", found.time);
  fillTime(receipts, "run-flip", weekStart(found.time));
  show(".receipts-more", underway, receipts);
  show(".receipts-next", false, receipts);
  showing = { owner, drawn: true };
  receiptsState("found");
  // The dollars follow, from many more reads; without them, the receipts show the tokens alone.
  const prices = await pricesAt([...tokens.values()], amounts, weekStart(found.time), now(), readLater).catch(
    (error) => {
      console.error(error);
      return undefined;
    },
  );
  if (prices && current()) draw(prices);
}

// A run takes hours after each flip, and the page may have read one half done: once the total retired has grown, the
// search goes on from where it stopped, and the receipts are read again. A search that failed is done again. One read
// every five minutes.
async function checkSearch(): Promise<void> {
  if (!receiptsFor || Date.now() - searchChecked < 300_000) return;
  searchChecked = Date.now();
  const reading = search;
  let previous: Search | undefined;
  if (reading) {
    try {
      const [done, latest] = await Promise.all([reading, totalRetired()]);
      if (latest <= done.total || search !== reading) return;
      previous = done;
    } catch (error) {
      return void console.error(error);
    }
  }
  search = lastRun(previous);
  receiptsFor = undefined;
  loadReceipts(true);
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
    shown = receiptsFor = showing = undefined;
    show("#reading");
    show("#accounts, #summary, #none, #payout, #receipts", false);
  }
  try {
    const found = await readAccounts(connection.address);
    if (read !== reads) return;
    sawBlock(found.time);
    shown = found;
    showAccounts();
    catchUp();
    loadShares();
    loadReceipts();
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
  shown = receiptsFor = showing = undefined;
  close();
  showConnection();
  show("#reading, #accounts, #summary, #none, #payout, #receipts", false);
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
groupHex(document);
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
receipts.querySelector(".receipts-again")!.addEventListener("click", () => loadReceipts());
setInterval(() => showChecks().catch(console.error), 3_600_000);
setInterval(tick, 30_000);
