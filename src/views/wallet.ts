import { getAddress } from "viem";
import { refresh } from "../cache.ts";
import { actions, render, state } from "../state.ts";
import { $, announce, fill, list } from "../ui.ts";
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
import { closeReview } from "./review.ts";

// Connecting a wallet: at once when the browser has one, else from the list in the header's popup.
let wallets: Wallet[] = [];
let message = "";
let missing = false;
let attempt = 0;
const popup = $("#connect");
const listening = new WeakSet<Provider>();

export function drawWallets(): void {
  list(
    $("[data-list=wallet]", popup),
    wallets,
    ({ name }) => name,
    (row, wallet) => {
      fill(row, { name: wallet.name });
      const icon = row.querySelector("img")!;
      icon.hidden = !wallet.icon;
      if (wallet.icon) icon.src = wallet.icon;
    },
  );
  fill(popup, { connecting: message, "no-wallet": missing });
}

export function startWallets(): void {
  findWallets((found) => {
    wallets = found;
    render();
  });
  void safeWallet().then((safe) => safe && connectTo(safe, false));
}

actions.connect = () => {
  if (wallets.length === 1 && !missing) void connectTo(wallets[0]!);
  else popup.showPopover();
};
actions["pick-wallet"] = (el) =>
  void connectTo(wallets.find(({ name }) => name === el.closest<HTMLElement>("[data-key]")!.dataset.key)!);
actions.switch = async () => {
  const connection = state.connection;
  if (!connection) return;
  await switchToBase(connection).catch(() => announce("Switch to Base in your wallet."));
  render();
};

async function connectTo(wallet: Wallet, picked = true): Promise<void> {
  const mine = ++attempt;
  const fromHome = ["home", "about"].includes(state.route.view);
  [message, missing] = [`Waiting for ${wallet.name}…`, false];
  render();
  try {
    const connected = await connect(wallet);
    if (mine !== attempt || !connected) return;
    message = "";
    listen(connected.provider);
    state.connection = connected;
    state.picks.clear();
    state.touched.clear();
    if (popup.matches(":popover-open")) popup.hidePopover();
    announce(`Connected to ${wallet.name}.`);
    if (picked && fromHome) location.hash = "#app";
  } catch (error) {
    if (mine !== attempt) return;
    missing = error instanceof NoWallet;
    message = declined(error) || missing ? "" : `${wallet.name} did not connect.`;
    if (picked && !popup.matches(":popover-open")) popup.showPopover();
  }
  render();
}

function letGo(): void {
  closeReview();
  state.connection = undefined;
  announce("Wallet disconnected.");
  render();
}

// A wallet's events: another account, another network, or locked.
function listen(provider: Provider): void {
  if (listening.has(provider)) return;
  listening.add(provider);
  const ours = () => (state.connection?.provider === provider ? state.connection : undefined);
  provider.on?.("accountsChanged", ([address]: string[]) => {
    const connection = ours();
    if (!connection || (address && getAddress(address) === connection.address)) return;
    if (!address) return letGo();
    closeReview();
    state.connection = { ...connection, address: getAddress(address) };
    state.picks.clear();
    render();
  });
  provider.on?.("chainChanged", (chainId: string) => {
    const connection = ours();
    if (!connection) return;
    connection.chainId = Number(chainId);
    refresh("accounts");
    render();
  });
  provider.on?.("disconnect", () => ours() && letGo());
}
