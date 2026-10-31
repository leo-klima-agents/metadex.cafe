import { getAddress } from "viem";
import { CHAIN_ID } from "../config.ts";
import { short } from "../format.ts";
import { sawBlock } from "../rpc.ts";
import { update } from "../state.ts";
import { same } from "../util.ts";
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
import { $, $$, fill, list } from "./dom.ts";
import { closeReview, refreshReview } from "./review.ts";
import { route } from "./router.ts";
import { appPayouts, failed, session, useWallet } from "./session.ts";
import { walletChanged } from "./swap.ts";

const html = document.documentElement;
const pop = $("#connect");
const listening = new WeakSet<Provider>();
let wallets: Wallet[] = [];
// Connections that finish after a later one, or after the wallet was let go, are dropped.
let attempts = 0;
let ignoredUpTo = 0;
let switchFailed = "";

// The wallet's Hydrex accounts, and then their payouts.
async function loadAccounts(): Promise<void> {
  const reader = session.accounts;
  update();
  const found = await reader
    ?.read()
    .catch((error: unknown) => (session.accounts === reader && failed(error), undefined));
  if (!found || session.accounts !== reader) return;
  sawBlock(found.time);
  void appPayouts.load(found);
}

function use(connection: Parameters<typeof useWallet>[0]): void {
  closeReview();
  useWallet(connection);
  void loadAccounts();
  walletChanged();
  update();
}

export function renderConnection(): void {
  const { connection } = session;
  html.toggleAttribute("data-wallet", !!connection);
  if (connection && connection.chainId !== CHAIN_ID)
    html.dataset.chain = connection.wallet.propose ? "wrong-safe" : "wrong";
  else delete html.dataset.chain;
  fill(document, {
    wallet: connection ? short(connection.address) : "",
    "switch-failed": connection && connection.chainId !== CHAIN_ID ? switchFailed : "",
  });
  if (connection && pop.matches(":popover-open")) pop.hidePopover();
  refreshReview();
}

// From Home or About, a wallet picked leads on to the App; the Safe the page is in, which nobody picked, does not.
async function connectTo(wallet: Wallet, picked = true): Promise<void> {
  const attempt = ++attempts;
  const fromOwn = picked && ["home", "about"].includes(route().view);
  const connected = await connect(wallet);
  if (!connected || attempt <= ignoredUpTo) return;
  ignoredUpTo = attempt;
  $("#no-wallet").hidden = true;
  listen(connected.provider);
  use(connected);
  if (fromOwn && ["home", "about"].includes(route().view)) location.hash = "#app";
}

function listen(provider: Provider): void {
  if (listening.has(provider)) return;
  listening.add(provider);
  provider.on?.("accountsChanged", ([account]: string[]) => {
    const { connection } = session;
    // Wallets also send it when they unlock, the account the same; a wallet that locks shares none.
    if (connection?.provider !== provider || (account && same(account, connection.address))) return;
    if (!account) return letGo();
    use({ ...connection, address: getAddress(account) });
  });
  provider.on?.("chainChanged", (chainId: string) => {
    if (session.connection?.provider !== provider) return;
    session.connection.chainId = Number(chainId);
    update();
  });
  provider.on?.("disconnect", () => session.connection?.provider === provider && letGo());
}

function letGo(): void {
  ignoredUpTo = attempts;
  use(undefined);
}

function pick(wallet: Wallet, fromButton = false): void {
  $("#no-wallet").hidden = true;
  fill(pop, { connecting: `Waiting for ${wallet.name}…` });
  connectTo(wallet).then(
    () => fill(pop, { connecting: "" }),
    (error: unknown) => {
      if (declined(error)) return fill(pop, { connecting: "" });
      if (fromButton && !pop.matches(":popover-open")) pop.showPopover();
      if (error instanceof NoWallet) {
        fill(pop, { connecting: "" });
        $("#no-wallet").hidden = false;
        return;
      }
      console.error(error);
      fill(pop, { connecting: `${wallet.name} did not connect.` });
    },
  );
}

// One wallet in the browser connects at once; several, or none, are listed in the popup.
export function initConnection(): void {
  for (const button of $$(".connect"))
    button.addEventListener("click", () => (wallets.length === 1 ? pick(wallets[0]!, true) : pop.showPopover()));
  $("#switch").addEventListener("click", () => {
    const { connection } = session;
    if (!connection) return;
    switchFailed = "";
    switchToBase(connection).then(update, (error: unknown) => {
      if (declined(error)) return;
      console.error(error);
      switchFailed = "Switch in your wallet.";
      update();
    });
  });
  findWallets((found) => {
    wallets = found;
    list(
      $("#wallets"),
      "wallet-button",
      found,
      ({ name }) => name,
      (button, wallet) => {
        fill(button, { name: wallet.name });
        const icon = $<HTMLImageElement>("img", button);
        if (wallet.icon) [icon.src, icon.hidden] = [wallet.icon, false];
        button.onclick = () => pick(wallet);
      },
    );
  });
  safeWallet().then((wallet) => wallet && connectTo(wallet, false), console.error);
}
