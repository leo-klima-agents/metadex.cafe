import { getAddress } from "viem";
import { now, same, sawBlock } from "../chain.ts";
import { CHAIN_ID } from "../config.ts";
import { clone, fill, isOpen, show } from "../dom.ts";
import { short, weekStart } from "../format.ts";
import { readAccounts } from "../hydrex.ts";
import { reader } from "../read.ts";
import {
  NoWallet,
  connect,
  declined,
  findWallets,
  safeWallet,
  switchToBase,
  type Provider,
  type Wallet,
} from "../wallet.ts";
import { showAccounts } from "./accounts.ts";
import { showApp } from "./app.ts";
import { showRecords } from "./automations.ts";
import { failed, session, views } from "./page.ts";
import { appPayouts, forgetPayouts } from "./payouts.ts";
import { showPosition, showShares, syncPosition } from "./position.ts";
import { closeReview, refreshReview } from "./review.ts";
import { route } from "./router.ts";
import { walletChanged } from "./swap.ts";

// Connecting a wallet: the header's button, or the wallet's chip, which leads to the App; the wallets in the page; what a
// wallet's events change; and reading its Hydrex accounts.

const listening = new WeakSet<Provider>();

// Wallet connections that finish are ignored up to this attempt: a later one connected, or the wallet was let go.
let attempts = 0;
let ignoredUpTo = 0;
let clicks = 0;

// Reads the wallet's accounts. Unless `quietly`, as for another wallet, what was shown goes first; a quiet read keeps it
// until the new one ends, and drops a read under way, which may not see a transaction just sent.
export async function loadAccounts(quietly = false): Promise<void> {
  const { connection } = session;
  if (!connection) return;
  if (!quietly || !session.accounts) {
    const { address } = connection;
    session.accounts?.forget();
    session.accounts = reader(() => readAccounts(address), { stale: (found) => weekStart(now()) > found.epochStart });
    forgetPayouts();
    closeReview();
    show(".accounts-reading");
    show("#accounts, #none, .mine, #underway, .yours-count", false);
    // An account's page drops the actions of the wallet's accounts read before.
    showPosition();
    showApp();
    showRecords();
  }
  const these = session.accounts;
  const current = () => session.accounts === these;
  try {
    const found = await these.refresh();
    if (!current() || these.value !== found) return;
    sawBlock(found.time);
    showAccounts();
    appPayouts.show(found);
    showApp();
    views.catchUp();
    void showShares();
    syncPosition();
  } catch (error) {
    if (current() && !these.reading) failed(error);
  } finally {
    // The wallet's own votes beside Hydrex's average wait for its accounts, read or not, even with no epoch read.
    if (current() && !these.reading) {
      show(".accounts-reading", false);
      showApp();
      showRecords();
    }
  }
}

// The header: a button to connect a wallet, or the wallet's chip, which leads to the App. The header's popup holds the
// wallet buttons, as do the App, under its products, and the lists of what a wallet holds: its Hydrex accounts, and the
// tokens it can sell.
const header = document.querySelector<HTMLElement>("header.site")!;
const connectButton = header.querySelector<HTMLButtonElement>(".connect")!;
const connectPop = document.getElementById("connect")!;
// Older browsers refuse to show a popup already shown, or to hide one already hidden.
const showConnectPop = (shown: boolean): void => {
  if (isOpen(connectPop) !== shown) (shown ? connectPop.showPopover : connectPop.hidePopover)?.call(connectPop);
};

export function showConnection(): void {
  const { connection } = session;
  show(".wallet-slot, header.site .connect", !connection);
  show("header.site .to-app", !!connection);
  if (connection) showConnectPop(false);
  show("#epoch", !!connection);
  show(".wrong-chain", !!connection && connection.chainId !== CHAIN_ID);
  if (connection) {
    const { wallet, address, chainId } = connection;
    fill(header, { "wallet-short": short(address) });
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
  session.connection = connected;
  showConnection();
  loadAccounts();
  walletChanged();
  if (fromOwn && leadsToApp()) location.hash = "#app";
}

function listen(provider: Provider): void {
  if (listening.has(provider)) return;
  listening.add(provider);
  provider.on?.("accountsChanged", ([account]: string[]) => {
    const { connection } = session;
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
    const { connection } = session;
    if (connection?.provider !== provider) return;
    connection.chainId = Number(chainId);
    showConnection();
  });
  provider.on?.("disconnect", () => {
    if (session.connection?.provider === provider) letGo();
  });
}

function letGo(): void {
  ignoredUpTo = attempts;
  session.accounts?.forget();
  session.connection = session.accounts = undefined;
  forgetPayouts();
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
  // In every list of wallets, on each view that has one, and in the header's popup.
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

// The header's button, the wallets in the page, and the Safe the page may be in.
export function initConnection(): void {
  views.connection = showConnection;
  views.loadAccounts = loadAccounts;
  connectButton.addEventListener("click", () => {
    if (wallets.length === 1) pickWallet(wallets[0]!, true);
    else if ("showPopover" in connectPop) showConnectPop(true);
    else location.hash = "#app";
  });
  for (const slot of document.querySelectorAll(".wallet-slot")) slot.append(clone("wallet-picker"));
  for (const button of document.querySelectorAll(".wrong-chain .switch"))
    button.addEventListener("click", () => {
      const { connection } = session;
      if (!connection) return;
      show(".switch-failed", false);
      switchToBase(connection).then(showConnection, (error) => {
        if (declined(error)) return;
        console.error(error);
        show(".switch-failed");
      });
    });
  findWallets((found) => {
    wallets = found;
    for (const place of document.querySelectorAll(".wallet-buttons")) place.replaceChildren(...found.map(walletButton));
  });
  safeWallet()
    .then((wallet) => wallet && connectTo(wallet, false))
    .catch(console.error);
}
