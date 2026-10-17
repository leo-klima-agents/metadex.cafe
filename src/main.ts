import { getAddress, type Address } from "viem";
import * as calls from "./calls.ts";
import { same } from "./chain.ts";
import { CHAIN_ID } from "./config.ts";
import { clone, fill, fillAddress, fillPlural, fillTime, show, showAll } from "./dom.ts";
import { WEEK, bps, count, date, day, earningPower, list, short, units } from "./format.ts";
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

const joinButton = document.getElementById("join") as HTMLButtonElement;
const leaveButton = document.getElementById("leave") as HTMLButtonElement;

/** The address whose accounts are shown, what was read about them, and the time of Base's block they were read at. */
type Shown = { owner: Address; accounts: Account[]; payout: Address; time: number; epochStart: number };

/** The connected wallet, if any. */
let connection: Connection | undefined;
let shown: Shown | undefined;
/** Whether the startup checks passed. Until they do, joining stays off. */
let trusted = false;
/** The share of the kVCM the automation retires, as read last, for the review of a join. */
let retired = "…";

function failed(error: unknown): void {
  console.error(error);
  show("error");
}

function showRelay({ epochStart, tonnes, retireBps, feeBps, votes, entity }: Relay): void {
  fillTime(document, "week-start", epochStart, day);
  fillTime(document, "week-end", epochStart + WEEK, day);
  fill(document, "tonnes", units(tonnes));
  retired = bps(retireBps);
  fill(document, "retired", retired);
  fill(document, "fee", bps(feeBps));
  showAll("no-fee", feeBps === 0n);
  showAll("with-fee", feeBps > 0n);
  fill(document, "power", earningPower(votes));
  fill(document, "entity", entity);
}

async function showChecks(): Promise<void> {
  const failing = await check();
  for (const item of document.querySelectorAll<HTMLElement>("#checks li")) item.hidden = !failing.includes(item.id);
  show("checks", failing.length > 0);
  trusted = !failing.length;
  // A read on its way shows its accounts with the checks' result when it ends.
  if (!reading) showAccounts(true);
}

function kind({ lockType, end }: Account, now: number): string {
  if (lockType === LockType.permanent) return "Protocol Account";
  if (lockType === LockType.rolling) return "Flex Account, rolling lock";
  return end ? `Flex Account, lock ${end > now ? "ends" : "ended"} ${date(end)}` : "Flex Account";
}

/** An account, with a box to tick when the connected wallet owns it and can join or leave with it. */
function accountItem(account: Account, { owner, time, epochStart }: Shown, mine: boolean): DocumentFragment {
  const item = clone("account");
  if (account.name) fill(item, "name", account.name);
  fill(item, "id", `#${account.id}`);
  fill(item, "kind", kind(account, time));
  fill(item, "votes", earningPower(account.votes));
  const state = status(account, owner, time, epochStart);
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
 * when the checks end, keep says to keep the boxes ticked.
 */
function showAccounts(keep = false): void {
  const last = shown;
  if (!last) return;
  const { owner, accounts, payout } = last;
  const kept = keep ? new Set(ticked().map(({ id }) => String(id))) : new Set<string>();
  const mine = !!connection && same(connection.address, owner);
  const full = accounts.filter(({ amount }) => amount > 0n);
  const empty = accounts.filter(({ amount }) => amount === 0n);
  const items = (list: Account[]) => list.map((account) => accountItem(account, last, mine));
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

// Joining and leaving

/** Whether the account can join now: joining stays off until the startup checks pass. */
const joinable = (account: Account) => trusted && !!shown && canJoin(account, shown.time);

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
 * again, unless another address is wanted now. A switch to Base shows on the page.
 */
const after = (owner: Address): Hooks => ({
  closed(submitted) {
    if (submitted && wanted && same(wanted, owner)) readAccountsOf(owner, true);
  },
  switched: showConnection,
});

/** Reviews joining or leaving with the ticked accounts it applies to. */
function reviewTicked(leaving: boolean): void {
  if (!connection || !shown) return;
  const accounts = ticked().filter(leaving ? canLeave : joinable);
  if (!accounts.length) return;
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

// Wallets

const listening = new WeakSet<object>();

function showConnection(): void {
  show("wallets", !connection);
  show("connected", !!connection);
  if (connection) {
    const inSafe = proposes(connection);
    fill(document, "wallet", connection.wallet.name);
    fillAddress(document, "me", connection.address, short(connection.address));
    show("wrong-chain", connection.chainId !== CHAIN_ID);
    if (connection.chainId === CHAIN_ID) show("switch-failed", false);
    showAll("to-switch", !inSafe);
    showAll("safe-elsewhere", inSafe);
  }
  update();
}

/** Each attempt to connect, and each time the page lets go of a wallet, takes the next number. */
let attempts = 0;

/**
 * Connects to a wallet, asking for its account. An attempt that ends after a later one, or after the page let go of the
 * wallet, changes nothing.
 */
async function connectTo(wallet: Wallet): Promise<void> {
  const attempt = ++attempts;
  const connected = await connect(wallet);
  if (!connected || attempt !== attempts) return;
  listen(connected.provider);
  connection = connected;
  showConnection();
  readAccountsOf(connected.address);
}

/** Follows the connected wallet's changes of account and chain. */
function listen(provider: Provider): void {
  if (listening.has(provider)) return;
  listening.add(provider);
  provider.on?.("accountsChanged", (accounts: string[]) => {
    if (connection?.provider !== provider) return;
    const [account] = accounts;
    // Wallets also say so when the account stays the same, as when they unlock.
    if (account && same(account, connection.address)) return;
    close();
    // A wallet that locks shares no account: the page lets go of it.
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

/** Lets go of the wallet, as when it locks. */
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
safe()
  .then((provider) => provider && connectTo(SAFE))
  .catch(console.error);

/** The wallet clicked last: only its request says when it ends. */
let clicks = 0;

findWallets((wallets) => {
  const buttons = wallets.map((wallet) => {
    const item = clone("wallet");
    fill(item, "name", wallet.name);
    if (wallet.icon) Object.assign(item.querySelector("img")!, { src: wallet.icon, hidden: false });
    item.querySelector("button")!.addEventListener("click", () => {
      const click = ++clicks;
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
          if (click === clicks) show("connecting", false);
        });
    });
    return item;
  });
  document.querySelector("#wallets .wallets")!.replaceChildren(...buttons);
});

// The checks run again every hour, so that a page left open does not join an automation that changed.
setInterval(() => showChecks().catch(console.error), 3_600_000);

readRelay().then(showRelay).catch(failed);
showChecks().catch(failed);
