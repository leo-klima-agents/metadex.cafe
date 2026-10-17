import { getAddress } from "viem";
import { same } from "./chain.ts";
import { CHAIN_ID } from "./config.ts";
import { clone, fill, fillAddress, fillPlural, fillTime, show } from "./dom.ts";
import { WEEK, bps, count, date, earningPower, list, units } from "./format.ts";
import {
  LockType,
  canJoin,
  canLeave,
  check,
  join,
  leave,
  readAccounts,
  readRelay,
  status,
  type Account,
  type Holdings,
  type Relay,
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

const joinButton = document.getElementById("join") as HTMLButtonElement;
const leaveButton = document.getElementById("leave") as HTMLButtonElement;
const listening = new WeakSet<Provider>();

let connection: Connection | undefined;
let shown: Holdings | undefined;
let trusted = false;
let retired = "…";
let reads = 0;
let reading = false;
let attempts = 0;
let clicks = 0;

function failed(error: unknown): void {
  console.error(error);
  show("#error");
}

function showRelay({ epochStart, tonnes, retireBps, feeBps, votes, entity }: Relay): void {
  retired = bps(retireBps);
  fill(document, { tonnes: units(tonnes), retired, fee: bps(feeBps), power: earningPower(votes), entity });
  fillTime(document, "week-start", epochStart);
  fillTime(document, "week-end", epochStart + WEEK);
  show(".no-fee", feeBps === 0n);
  show(".with-fee", feeBps > 0n);
}

async function showChecks(): Promise<void> {
  const failing = await check();
  for (const item of document.querySelectorAll<HTMLElement>("#checks li")) item.hidden = !failing.includes(item.id);
  show("#checks", failing.length > 0);
  trusted = !failing.length;
  // A read on its way shows the result when it ends.
  if (!reading) showAccounts(true);
}

const joinable = (account: Account): boolean => trusted && !!shown && canJoin(account, shown.time);

function kind({ lockType, end }: Account, now: number): string {
  if (lockType === LockType.permanent) return "Protocol Account";
  if (lockType === LockType.rolling) return "Flex Account, rolling lock";
  return end ? `Flex Account, lock ${end > now ? "ends" : "ended"} ${date(end)}` : "Flex Account";
}

function accountItem(account: Account, { owner, time, epochStart }: Holdings): DocumentFragment {
  const item = clone("account");
  const name = account.name || "Account";
  fill(item, { name, id: `#${account.id}`, kind: kind(account, time), votes: earningPower(account.votes) });
  const state = status(account, owner, time, epochStart);
  const line = clone(state.kind);
  if ("date" in state) fillTime(line, "date", state.date);
  if ("name" in state) fill(line, { automation: state.name });
  if ("to" in state) fillAddress(line, "address", state.to);
  item.querySelector(".status")!.replaceWith(line);
  if (joinable(account) || canLeave(account)) {
    const box = item.querySelector<HTMLInputElement>(".pick")!;
    // A hidden box stays disabled, so that a click on its row's label cannot tick it.
    box.hidden = box.disabled = false;
    box.value = String(account.id);
    box.ariaLabel = `Pick ${name} #${account.id}`;
  }
  return item;
}

function showAccounts(keepTicked = false): void {
  const holdings = shown;
  if (!holdings) return;
  const { owner, accounts, payout } = holdings;
  const kept = new Set(keepTicked ? ticked().map(({ id }) => String(id)) : []);
  const full = accounts.filter(({ amount }) => amount > 0n);
  const empty = accounts.filter(({ amount }) => amount === 0n);
  const items = (accounts: Account[]) => accounts.map((account) => accountItem(account, holdings));
  document.getElementById("full")!.replaceChildren(...items(full));
  document.querySelector("#empty-accounts ul")!.replaceChildren(...items(empty));
  for (const box of document.querySelectorAll<HTMLInputElement>("#accounts .pick:not([hidden])")) {
    box.checked = kept.has(box.value);
  }
  fill(document, { "empty-count": count(empty.length, "empty account", "empty accounts") });
  show("#empty-accounts", empty.length > 0);
  show("#none", !full.length);
  joinButton.hidden = !accounts.some(joinable);
  leaveButton.hidden = !accounts.some(canLeave);
  show("#pick-bar", !(joinButton.hidden && leaveButton.hidden));
  updateButtons();
  fillAddress(document, "owner", owner);
  fillAddress(document, "payout", payout, payout);
  show("#itself", same(payout, owner));
  show("#accounts");
  show("#payout", full.length > 0);
}

async function loadAccounts(quietly = false): Promise<void> {
  if (!connection) return;
  const read = ++reads;
  reading = true;
  if (!quietly) {
    shown = undefined;
    show("#reading");
    show("#accounts, #payout", false);
  }
  const [result] = await Promise.allSettled([readAccounts(connection.address)]);
  if (read !== reads) return;
  reading = false;
  show("#reading", false);
  if (result.status === "rejected") return failed(result.reason);
  shown = result.value;
  showAccounts();
}

function ticked(): Account[] {
  const boxes = document.querySelectorAll<HTMLInputElement>("#accounts .pick:checked");
  const ids = new Set([...boxes].map(({ value }) => value));
  return shown?.accounts.filter(({ id }) => ids.has(String(id))) ?? [];
}

function label(button: HTMLButtonElement, verb: string, n: number): void {
  button.disabled = !n;
  button.textContent = n ? `${verb} with ${count(n, "account", "accounts")}` : verb;
}

function updateButtons(): void {
  const picked = ticked();
  label(joinButton, "Join", picked.filter(joinable).length);
  label(leaveButton, "Leave", picked.filter(canLeave).length);
}

const hooks: Hooks = {
  closed: (submitted) => submitted && loadAccounts(true),
  switched: showConnection,
};

function reviewTicked(leaving: boolean): void {
  const accounts = ticked().filter(leaving ? canLeave : joinable);
  if (!connection || !shown || !accounts.length) return;
  const changes = clone(leaving ? "leave-effects" : "join-effects");
  fill(changes, { which: list(accounts.map(({ id }) => `#${id}`)), retired });
  fillTime(changes, "next", shown.epochStart + WEEK);
  fillPlural(changes, accounts.length);
  const title = `${leaving ? "Leave" : "Join"} the Carbon Impact automation`;
  review(title, changes, leaving ? leave(accounts) : join(accounts), connection, hooks);
}

function showConnection(): void {
  show("#wallets", !connection);
  show("#connected", !!connection);
  if (connection) {
    const { wallet, address, chainId } = connection;
    fill(document, { wallet: wallet.name });
    fillAddress(document, "me", address);
    show("#wrong-chain", chainId !== CHAIN_ID);
    if (chainId === CHAIN_ID) show("#switch-failed", false);
    show(".to-switch", !wallet.safe);
    show(".safe-elsewhere", !!wallet.safe);
  }
  update();
}

async function connectTo(wallet: Wallet): Promise<void> {
  const attempt = ++attempts;
  const connected = await connect(wallet);
  if (!connected || attempt !== attempts) return;
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
  attempts++;
  reads++;
  reading = false;
  connection = undefined;
  shown = undefined;
  close();
  showConnection();
  show("#reading, #accounts, #payout", false);
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

document.getElementById("accounts")!.addEventListener("change", updateButtons);
joinButton.addEventListener("click", () => reviewTicked(false));
leaveButton.addEventListener("click", () => reviewTicked(true));
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
readRelay().then(showRelay).catch(failed);
showChecks().catch(failed);
setInterval(() => showChecks().catch(console.error), 3_600_000);
