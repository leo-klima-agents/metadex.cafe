import { getAddress, isAddress, type Address } from "viem";
import * as calls from "./calls.ts";
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
import { LockType, canJoin, canLeave, check, readAccounts, readRelay, status, type Account } from "./hydrex.ts";
import { close, review, update } from "./review.ts";
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
  type Wallet,
} from "./wallet.ts";

const payoutForm = document.getElementById("payout-form") as HTMLFormElement;
const recipient = payoutForm.querySelector("input")!;
const joinButton = document.getElementById("join") as HTMLButtonElement;
const leaveButton = document.getElementById("leave") as HTMLButtonElement;

const seconds = () => Math.floor(Date.now() / 1000);
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/** The connected wallet, if any. */
let connection: Connection | undefined;
/** The address whose accounts are shown, and what was read about them. */
let shown: { owner: Address; accounts: Account[]; payout: Address; epochStart: number } | undefined;
/** Whether the startup checks passed. Until they do, joining and changing the payout address stay off. */
let trusted = false;

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

async function showRelay(): Promise<void> {
  const { tonnes, retireBps, feeBps, votes, entity, lastVoted, pools } = await readRelay();
  fill(document, "tonnes", units(tonnes));
  fill(document, "retired", bps(retireBps));
  fill(document, "fee", bps(feeBps));
  showAll("no-fee", feeBps === 0n);
  showAll("with-fee", feeBps > 0n);
  fill(document, "power", earningPower(votes));
  fill(document, "entity", entity);
  const start = weekStart(seconds());
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
  for (const pool of pools) {
    const row = rows.insertRow();
    row.insertCell().textContent = pool.name;
    row.insertCell().textContent = total ? shareOf(pool.votes, total) : "–";
  }
  fill(document, "pools", count(pools.length, "pool", "pools"));
  show("split", pools.length > 0);
}

async function showChecks(): Promise<void> {
  const failing = await check();
  for (const id of failing) show(id);
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
    box.hidden = false;
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
  show("payout");
}

let reads = 0;
/** Whether a read of accounts is on its way. */
let reading = false;
/** The address whose accounts are shown, or on their way. */
let wanted: Address | undefined;

/**
 * Reads and shows the accounts of the connected address. A read started later wins: an earlier one that ends after it
 * shows nothing. Quietly keeps the accounts on the page while they are read again.
 */
function readAccountsOf(owner: Address, quietly = false): void {
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
      shown = { owner, ...found };
      showAccounts();
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
  const problem = !isAddress(text) ? field.dataset.typo : /^0x0{40}$/.test(text) ? field.dataset.zero : undefined;
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

/** Reads an owner's accounts again once a review that sent something closes, unless another address is wanted now. */
const rereadFor = (owner: Address) => (submitted: boolean) => {
  if (submitted && wanted && same(wanted, owner)) readAccountsOf(owner, true);
};

/** Reviews joining or leaving with the ticked accounts it applies to. */
function reviewTicked(leaving: boolean): void {
  if (!connection || !shown) return;
  const accounts = ticked().filter(leaving ? canLeave : joinable);
  const changes = clone(leaving ? "leave-effects" : "join-effects");
  fill(changes, "which", ids(accounts));
  fillTime(changes, "next", shown.epochStart + WEEK, day);
  fillPlural(changes, accounts.length);
  const [title, steps] = leaving
    ? ["Leave the Carbon Impact automation", calls.leave(accounts)]
    : ["Join the Carbon Impact automation", calls.join(accounts)];
  review(title, changes, steps, connection, rereadFor(shown.owner));
}

joinButton.addEventListener("click", () => reviewTicked(false));
leaveButton.addEventListener("click", () => reviewTicked(true));

payoutForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const to = typed(recipient);
  if (!to || !connection) return;
  const changes = clone("payout-effects");
  fillAddress(changes, "recipient", to, to);
  review("Change the payout address", changes, [calls.payout(to)], connection, rereadFor(connection.address));
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
    showAll("to-switch", !inSafe);
    showAll("safe-elsewhere", inSafe);
  }
  update();
}

async function connectTo(wallet: Wallet, ask = true): Promise<void> {
  const connected = await connect(wallet, ask);
  if (!connected) {
    // A wallet that no longer shares an account is not tried again on the next visit.
    if (!ask && wallet !== SAFE) remember(undefined);
    return;
  }
  connection = connected;
  if (wallet !== SAFE) remember(wallet.id);
  listen(connected);
  showConnection();
  readAccountsOf(connected.address);
}

/** Follows the wallet's changes of account and chain. */
function listen({ provider }: Connection): void {
  if (listening.has(provider)) return;
  listening.add(provider);
  provider.on?.("accountsChanged", (accounts: string[]) => {
    if (connection?.provider !== provider) return;
    // Wallets also say so when the account stays the same, as when they unlock.
    if (accounts[0] && same(accounts[0], connection.address)) return;
    close();
    if (!accounts[0]) return disconnect();
    connection.address = getAddress(accounts[0]);
    showConnection();
    readAccountsOf(connection.address);
  });
  provider.on?.("chainChanged", (chainId: string) => {
    if (connection?.provider !== provider) return;
    connection.chainId = Number(chainId);
    showConnection();
  });
  provider.on?.("disconnect", () => {
    if (connection?.provider === provider) disconnect();
  });
}

function disconnect(): void {
  const provider = connection?.provider;
  connection = undefined;
  remember(undefined);
  close();
  showConnection();
  // Without a wallet, no accounts: a read on its way shows nothing when it ends.
  shown = wanted = undefined;
  reads++;
  reading = false;
  for (const id of ["reading", "accounts", "payout"]) show(id, false);
  if (provider?.disconnect) provider.disconnect().catch(() => {});
  else provider?.request({ method: "wallet_revokePermissions", params: [{ eth_accounts: {} }] }).catch(() => {});
}

document.getElementById("disconnect")!.addEventListener("click", disconnect);

document.querySelector("#wrong-chain .switch")!.addEventListener("click", () => {
  if (connection) switchToBase(connection).then(showConnection, console.error);
});

// Inside Safe{Wallet}, the page connects to the Safe on its own: it is the only wallet there.
const inSafe = safe().then(async (provider) => {
  if (provider) await connectTo(SAFE, false);
  return !!provider;
});
let reconnecting = false;

findWallets((wallets) => {
  const buttons = wallets.map((wallet) => {
    const item = clone("wallet");
    const button = item.querySelector("button")!;
    fill(item, "name", wallet.name);
    if (wallet.icon) Object.assign(item.querySelector("img")!, { src: wallet.icon, hidden: false });
    // Coinbase's code loads when the pointer goes down, so that its window opens closer to the click.
    for (const name of ["pointerdown", "focus"]) button.addEventListener(name, () => wallet.provider().catch(() => {}));
    button.addEventListener("click", () => {
      show("wallet-failed", false);
      show("no-wallet", false);
      connectTo(wallet).catch((error) => {
        if (declined(error)) return;
        if (error instanceof NoWallet) return show("no-wallet");
        console.error(error);
        fill(document, "failed-wallet", wallet.name);
        show("wallet-failed");
      });
    });
    return item;
  });
  document.querySelector("#wallets .wallets")!.replaceChildren(...buttons);
  const last = wallets.find(({ id }) => id === remembered());
  if (last && !connection && !reconnecting) {
    reconnecting = true;
    inSafe
      .then((found) => (found ? undefined : connectTo(last, false)))
      .catch((error) => {
        console.error(error);
        remember(undefined);
      });
  }
});

showWeek();
showRelay().catch(failed);
showChecks().catch(failed);
