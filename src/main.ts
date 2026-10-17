import { getAddress, isAddress, zeroAddress, type Address } from "viem";
import * as calls from "./calls.ts";
import { same } from "./chain.ts";
import { CHAIN_ID } from "./config.ts";
import { clone, fill, fillAddress, fillPlural, fillTime, show, showAll } from "./dom.ts";
import {
  WEEK,
  bps,
  count,
  countdown,
  date,
  day,
  dayTime,
  earningPower,
  list,
  shareOf,
  short,
  units,
  weekStart,
} from "./format.ts";
import {
  LockType,
  canJoin,
  canLeave,
  check,
  readAccounts,
  readRelay,
  status,
  type Account,
  type Relay,
} from "./hydrex.ts";
import { close, review, update, type Hooks } from "./review.ts";
import {
  NoWallet,
  SAFE,
  connect,
  declined,
  findWallets,
  proposes,
  safe,
  switchToBase,
  type Connection,
  type Provider,
  type Wallet,
} from "./wallet.ts";

const payoutForm = document.getElementById("payout-form") as HTMLFormElement;
const recipient = payoutForm.querySelector("input")!;
const joinButton = document.getElementById("join") as HTMLButtonElement;
const leaveButton = document.getElementById("leave") as HTMLButtonElement;

/** Base's time less the device's, from the latest block the page read: the page keeps Base's time, not the device's. */
let drift = 0;
/** The time by Base's clock, in seconds. */
const seconds = () => Math.floor(Date.now() / 1000) + drift;
/** Sets the page's clock to the time of a block just read. */
const setClock = (time: number) => (drift = time - Math.floor(Date.now() / 1000));

/** The connected wallet, if any. */
let connection: Connection | undefined;
/** The address whose accounts are shown, and what was read about them. */
let shown: { owner: Address; accounts: Account[]; payout: Address; epochStart: number } | undefined;
/** Whether the startup checks passed. Until they do, joining and changing the payout address stay off. */
let trusted = false;
/** The share of the kVCM the automation retires, as read last, for the review of a join. */
let retired = "…";
/** The epoch whose numbers the page shows, once read. */
let epoch: number | undefined;

function failed(error: unknown): void {
  console.error(error);
  show("error");
}

function showWeek(): void {
  const now = seconds();
  const next = weekStart(now) + WEEK;
  fillTime(document, "week-start", next - WEEK, day);
  fillTime(document, "week-end", next, day);
  fill(document, "countdown", countdown(next - now));
}

function showRelay(relay: Relay): void {
  const { time, epochStart: start, tonnes, retireBps, feeBps, votes, entity, lastVoted, pools } = relay;
  epoch = start;
  setClock(time);
  showWeek();
  fill(document, "tonnes", units(tonnes));
  retired = bps(retireBps);
  fill(document, "retired", retired);
  fill(document, "fee", bps(feeBps));
  showAll("no-fee", feeBps === 0n);
  showAll("with-fee", feeBps > 0n);
  fill(document, "power", earningPower(votes));
  fill(document, "entity", entity);
  fill(
    document,
    "voted",
    !lastVoted || !pools.length
      ? "None yet."
      : lastVoted >= start
        ? `Cast this epoch, on ${dayTime(lastVoted)} UTC. It can change until the epoch ends.`
        : lastVoted >= start - WEEK
          ? `Cast on ${dayTime(lastVoted)} UTC, ${countdown(start - lastVoted)} before the previous epoch ended.`
          : `Cast in the epoch that started ${day(weekStart(lastVoted))}.`,
  );
  const total = pools.reduce((sum, pool) => sum + pool.votes, 0n);
  const rows = document.querySelector<HTMLTableElement>(".shares")!.tBodies[0]!;
  rows.replaceChildren();
  for (const pool of pools) {
    const row = rows.insertRow();
    row.insertCell().textContent = pool.name;
    row.insertCell().textContent = total ? shareOf(pool.votes, total) : "–";
  }
  fill(document, "pools", count(pools.length, "pool", "pools"));
  show("split", pools.length > 0);
}

/** When the checks last ran, by the device's clock, in milliseconds. */
let checkedAt = 0;

async function showChecks(): Promise<void> {
  checkedAt = Date.now();
  const failing = await check();
  for (const item of document.querySelectorAll<HTMLElement>("#checks li")) item.hidden = !failing.includes(item.id);
  show("checks", failing.length > 0);
  trusted = !failing.length;
  // A read on its way shows its accounts with the checks' result when it ends.
  if (!reading) showAccounts(true);
}

function kind({ lockType, end }: Account): string {
  if (lockType === LockType.permanent) return "Protocol Account";
  if (lockType === LockType.rolling) return "Flex Account, rolling lock";
  return end ? `Flex Account, lock ${end > seconds() ? "ends" : "ended"} ${date(end)}` : "Flex Account";
}

/** An account, with a box to tick when the connected wallet owns it and can join or leave with it. */
function accountItem(account: Account, owner: Address, epochStart: number, mine: boolean): DocumentFragment {
  const item = clone("account");
  if (account.name) fill(item, "name", account.name);
  fill(item, "id", `#${account.id}`);
  fill(item, "kind", kind(account));
  fill(item, "votes", earningPower(account.votes));
  const state = status(account, owner, seconds(), epochStart);
  const line = clone(state.kind);
  if ("date" in state) fillTime(line, "date", state.date, day);
  if ("name" in state) fill(line, "automation", state.name);
  if ("to" in state) fillAddress(line, "address", state.to, short(state.to));
  item.querySelector(".status")!.replaceWith(line);
  if (mine && (joinable(account) || canLeave(account))) {
    const box = item.querySelector<HTMLInputElement>(".pick")!;
    // A hidden box stays disabled, so that a click on its row's label cannot tick it.
    box.hidden = box.disabled = false;
    box.value = String(account.id);
    box.ariaLabel = `Pick ${account.name || "Account"} #${account.id}`;
  }
  return item;
}

/**
 * Shows the accounts read last, with controls when the connected wallet owns them. To show the same accounts again, as
 * when the checks end or a wallet connects, keep says to keep the boxes ticked.
 */
function showAccounts(keep = false): void {
  if (!shown) return;
  const { owner, accounts, payout, epochStart } = shown;
  const kept = keep ? new Set(ticked().map(({ id }) => String(id))) : new Set<string>();
  const mine = !!connection && same(connection.address, owner);
  const full = accounts.filter(({ amount }) => amount > 0n);
  const empty = accounts.filter(({ amount }) => amount === 0n);
  const items = (list: Account[]) => list.map((account) => accountItem(account, owner, epochStart, mine));
  document.getElementById("full")!.replaceChildren(...items(full));
  document.querySelector("#empty-accounts ul")!.replaceChildren(...items(empty));
  for (const box of document.querySelectorAll<HTMLInputElement>("#accounts .pick:not([hidden])")) {
    box.checked = kept.has(box.value);
  }
  fill(document, "empty-count", count(empty.length, "empty account", "empty accounts"));
  show("empty-accounts", empty.length > 0);
  show("none", !full.length);
  joinButton.hidden = !accounts.some(joinable);
  leaveButton.hidden = !accounts.some(canLeave);
  show("pick-bar", mine && !(joinButton.hidden && leaveButton.hidden));
  updateButtons();
  fillAddress(document, "owner", owner, short(owner));
  fillAddress(document, "payout", payout, payout);
  show("itself", same(payout, owner));
  show("payout-form", mine && trusted);
  show("accounts");
  // Payouts matter to an owner with HYDX in an account.
  show("payout", full.length > 0);
}

let reads = 0;
/** Whether a read of accounts is on its way. */
let reading = false;
/** The address whose accounts are shown, or on their way. */
let wanted: Address | undefined;

/**
 * Reads and shows the accounts of the connected address. A read started later wins: an earlier one that ends after it
 * shows nothing. Quietly keeps the accounts on the page while they are read again, and keep keeps the boxes ticked.
 */
function readAccountsOf(owner: Address, quietly = false, keep = false): void {
  const read = ++reads;
  wanted = owner;
  reading = true;
  if (!quietly) {
    show("reading");
    show("accounts", false);
    show("payout", false);
  }
  readAccounts(owner)
    .then((found) => {
      if (read !== reads) return;
      setClock(found.time);
      shown = { owner, ...found };
      showAccounts(keep);
    })
    .catch((error) => {
      if (read === reads) failed(error);
    })
    .finally(() => {
      if (read !== reads) return;
      reading = false;
      show("reading", false);
    });
}

/** Checks an address typed in a field: its format, its checksum when in mixed case, and not the zero address. */
function typed(field: HTMLInputElement): Address | undefined {
  const text = field.value.trim();
  const problem = !isAddress(text) ? field.dataset.typo : same(text, zeroAddress) ? field.dataset.zero : undefined;
  field.setCustomValidity(problem ?? "");
  if (problem) {
    field.reportValidity();
    return undefined;
  }
  return getAddress(text);
}

recipient.addEventListener("input", () => recipient.setCustomValidity(""));

// Joining, leaving and the payout address

/** Whether the account can join now: joining stays off until the startup checks pass. */
const joinable = (account: Account) => trusted && canJoin(account, seconds());

/** The accounts ticked, in the order shown. */
function ticked(): Account[] {
  const boxes = document.querySelectorAll<HTMLInputElement>("#accounts .pick:checked");
  const ids = new Set([...boxes].map(({ value }) => value));
  return shown?.accounts.filter(({ id }) => ids.has(String(id))) ?? [];
}

function updateButtons(): void {
  const [joining, leaving] = [ticked().filter(joinable).length, ticked().filter(canLeave).length];
  joinButton.disabled = !joining;
  joinButton.textContent = joining ? `Join with ${count(joining, "account", "accounts")}` : "Join";
  leaveButton.disabled = !leaving;
  leaveButton.textContent = leaving ? `Leave with ${count(leaving, "account", "accounts")}` : "Leave";
}

document.getElementById("accounts")!.addEventListener("change", updateButtons);

const ids = (accounts: Account[]) => list(accounts.map(({ id }) => `#${id}`));

/**
 * What a review of an owner's calls tells the page. Once it closes having sent something, the page reads the accounts
 * again, unless another address is wanted now. When the page stopped following what was sent before Base included it,
 * it reads them again every 15 seconds for five minutes, keeping the boxes ticked. A switch to Base shows on the page.
 */
const after = (owner: Address): Hooks => ({
  closed(submitted, unsure) {
    const again = (left: number, keep: boolean) => {
      if (!wanted || !same(wanted, owner)) return;
      readAccountsOf(owner, true, keep);
      if (left) setTimeout(() => again(left - 1, true), 15_000);
    };
    if (submitted) again(unsure ? 20 : 0, false);
  },
  switched: showConnection,
});

/** Reviews joining or leaving with the ticked accounts it applies to. */
function reviewTicked(leaving: boolean): void {
  if (!connection || !shown) return;
  const accounts = ticked().filter(leaving ? canLeave : joinable);
  // A lock that ended since its box was ticked can no longer join.
  if (!accounts.length) return updateButtons();
  const changes = clone(leaving ? "leave-effects" : "join-effects");
  fill(changes, "which", ids(accounts));
  fill(changes, "retired", retired);
  fillTime(changes, "next", shown.epochStart + WEEK, day);
  fillPlural(changes, accounts.length);
  const [title, steps] = leaving
    ? ["Leave the Carbon Impact automation", calls.leave(accounts)]
    : ["Join the Carbon Impact automation", calls.join(accounts)];
  review(title, changes, steps, connection, after(shown.owner));
}

joinButton.addEventListener("click", () => reviewTicked(false));
leaveButton.addEventListener("click", () => reviewTicked(true));

payoutForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const to = typed(recipient);
  if (!to || !connection) return;
  const changes = clone("payout-effects");
  fillAddress(changes, "recipient", to, to);
  review("Change the payout address", changes, [calls.payout(to)], connection, after(connection.address));
});

// Wallets

const STORAGE_KEY = "wallet";
const listening = new WeakSet<object>();

/** The wallet picked last, to reconnect to on the next visit without asking. */
function remembered(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function remember(id: string | undefined): void {
  try {
    if (id) localStorage.setItem(STORAGE_KEY, id);
    else localStorage.removeItem(STORAGE_KEY);
  } catch {}
}

function showConnection(): void {
  show("wallets", !connection);
  show("connected", !!connection);
  if (connection) {
    const inSafe = proposes(connection);
    fill(document, "wallet", connection.wallet.name);
    fillAddress(document, "me", connection.address, short(connection.address));
    show("disconnect", !inSafe);
    show("wrong-chain", connection.chainId !== CHAIN_ID);
    if (connection.chainId === CHAIN_ID) show("switch-failed", false);
    showAll("to-switch", !inSafe);
    showAll("safe-elsewhere", inSafe);
  }
  update();
}

/** Each attempt to connect, and each time the page lets go of a wallet, takes the next number. */
let attempts = 0;
/** Whether a wallet the user clicked has yet to answer. */
let asking = false;

/**
 * Connects to a wallet, asking for its account, or with ask false only reading one it already shares. An attempt that
 * ends after a later one, or after the page let go of the wallet, changes nothing.
 */
async function connectTo(wallet: Wallet, ask = true): Promise<void> {
  const attempt = ++attempts;
  const connected = await connect(wallet, ask);
  // A remembered wallet that shares no account now, as when it is locked, connects once it shares one again.
  listen(wallet, connected?.provider ?? (await wallet.provider()));
  if (!connected || attempt !== attempts) return;
  connection = connected;
  if (wallet !== SAFE) remember(wallet.id);
  showConnection();
  readAccountsOf(connected.address);
}

/** Follows the wallet's changes of account and chain. */
function listen(wallet: Wallet, provider: Provider): void {
  if (listening.has(provider)) return;
  listening.add(provider);
  provider.on?.("accountsChanged", (accounts: string[]) => {
    const [account] = accounts;
    if (!connection) {
      if (account && !asking && remembered() === wallet.id) connectTo(wallet, false).catch(console.error);
      return;
    }
    if (connection.provider !== provider) return;
    // Wallets also say so when the account stays the same, as when they unlock.
    if (account && same(account, connection.address)) return;
    close();
    // A wallet that locks shares no account. The page lets go of it, and connects again once it is unlocked.
    if (!account) return letGo();
    connection.address = getAddress(account);
    showConnection();
    readAccountsOf(connection.address);
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

/** Lets go of the wallet on the page only, as when it locks: it stays remembered, and keeps the page's permission. */
function letGo(): void {
  attempts++;
  connection = undefined;
  close();
  showConnection();
  // Without a wallet, no accounts: a read on its way shows nothing when it ends.
  shown = wanted = undefined;
  reads++;
  reading = false;
  for (const id of ["reading", "accounts", "payout"]) show(id, false);
}

/** Disconnects at the user's request: the page forgets the wallet, and asks it to end the session or the permission. */
function disconnect(): void {
  const provider = connection?.provider;
  letGo();
  remember(undefined);
  if (!provider) return;
  // disconnect() may not return a promise, and may throw.
  const ending = provider.disconnect
    ? Promise.resolve().then(() => provider.disconnect!())
    : provider.request({ method: "wallet_revokePermissions", params: [{ eth_accounts: {} }] });
  ending.catch(() => {});
}

document.getElementById("disconnect")!.addEventListener("click", disconnect);

document.querySelector("#wrong-chain .switch")!.addEventListener("click", () => {
  if (!connection) return;
  show("switch-failed", false);
  switchToBase(connection).then(showConnection, (error) => {
    if (declined(error)) return;
    console.error(error);
    show("switch-failed");
  });
});

// Inside Safe{Wallet}, the page connects to the Safe on its own: it is the only wallet there.
const inSafe = safe().then(async (provider) => {
  if (provider) await connectTo(SAFE, false);
  return !!provider;
});
let reconnecting = false;
/** The wallet clicked last: only its request says when it ends. */
let clicks = 0;

findWallets((wallets) => {
  const buttons = wallets.map((wallet) => {
    const item = clone("wallet");
    const button = item.querySelector("button")!;
    fill(item, "name", wallet.name);
    if (wallet.icon) Object.assign(item.querySelector("img")!, { src: wallet.icon, hidden: false });
    // Coinbase's code loads when the pointer goes down, so that its window opens closer to the click.
    for (const name of ["pointerdown", "focus"]) button.addEventListener(name, () => wallet.provider().catch(() => {}));
    button.addEventListener("click", () => {
      const click = ++clicks;
      asking = true;
      show("wallet-failed", false);
      show("no-wallet", false);
      fill(document, "connecting-wallet", wallet.name);
      show("connecting");
      connectTo(wallet)
        .catch((error) => {
          if (click !== clicks || declined(error)) return;
          if (error instanceof NoWallet) return show("no-wallet");
          console.error(error);
          fill(document, "failed-wallet", wallet.name);
          show("wallet-failed");
        })
        .finally(() => {
          if (click !== clicks) return;
          asking = false;
          show("connecting", false);
        });
    });
    return item;
  });
  document.querySelector("#wallets .wallets")!.replaceChildren(...buttons);
  const last = wallets.find(({ id }) => id === remembered());
  if (last && !connection && !reconnecting) {
    reconnecting = true;
    inSafe
      .then((found) => (found || connection ? undefined : connectTo(last, false)))
      .catch((error) => {
        console.error(error);
        remember(undefined);
      });
  }
});

/** Whether the page is reading a new epoch's numbers. */
let moving = false;

// Every half minute, the countdown moves, and the checks run again once an hour. A minute into a new epoch by Base's
// clock, when every RPC has its blocks, the page reads the automation, the checks and the accounts again. A read that
// fails, or that an RPC still in the old epoch answers, is tried again half a minute later.
setInterval(() => {
  showWeek();
  if (Date.now() - checkedAt > 3_600_000) showChecks().catch(console.error);
  const now = seconds();
  if (epoch === undefined || moving || weekStart(now) <= epoch || now - weekStart(now) < 60) return;
  moving = true;
  readRelay()
    .then((relay) => {
      if (relay.epochStart <= epoch!) return;
      showRelay(relay);
      showChecks().catch(console.error);
      if (wanted) readAccountsOf(wanted, true, true);
    })
    .catch(console.error)
    .finally(() => (moving = false));
}, 30_000);

showWeek();
readRelay().then(showRelay).catch(failed);
showChecks().catch(failed);
