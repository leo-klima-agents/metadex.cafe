import { getAddress, type EIP1193Provider } from "viem";
import { refresh } from "../cache.ts";
import { actions, render, state } from "../state.ts";
import { $, announce, fill, list } from "../ui.ts";
import { NoWallet, connect, declined, findWallets, safeWallet, switchToBase, type Wallet } from "../wallet.ts";
import { closeReview } from "./review.ts";

let wallets: Wallet[] = [];
let message = "";
let missing = false;
let attempt = 0;
let switchFailed = false;
const popup = $("#connect");
const listening = new WeakSet<EIP1193Provider>();

export function drawWallets(): void {
  for (const el of document.querySelectorAll<HTMLElement>("[data-list=wallet]"))
    list(
      el,
      wallets,
      ({ name }) => name,
      (row, wallet) => {
        fill(row, { name: wallet.name });
        const icon = row.querySelector("img")!;
        icon.hidden = !wallet.icon;
        if (wallet.icon) icon.src = wallet.icon;
      },
    );
  fill(popup, { "no-wallet": missing || null });
  fill(document.body, { connecting: message, "switch-failed": switchFailed || null });
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
  switchFailed = !(await switchToBase(connection).then(
    () => true,
    () => false,
  ));
  if (switchFailed) announce("Switch to Base in your wallet.");
  render();
};

async function connectTo(wallet: Wallet, picked = true): Promise<void> {
  const mine = ++attempt;
  const fromHome = ["home", "about"].includes(state.route.view);
  [message, missing] = [`Waiting for ${wallet.name}…`, false];
  render();
  try {
    const connected = await connect(wallet);
    if (mine !== attempt) return;
    if (!connected) throw new Error("No account.");
    message = "";
    listen(connected.provider);
    state.connection = connected;
    state.picks.clear();
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

// Follows the wallet's account and network changes. An `accountsChanged` with no account means the wallet locked, so
// the page lets it go.
function listen(provider: EIP1193Provider): void {
  if (listening.has(provider)) return;
  listening.add(provider);
  const ours = () => (state.connection?.provider === provider ? state.connection : undefined);
  provider.on("accountsChanged", ([address]) => {
    const connection = ours();
    if (!connection || (address && getAddress(address) === connection.address)) return;
    if (!address) return letGo();
    closeReview();
    state.connection = { ...connection, address: getAddress(address) };
    state.picks.clear();
    render();
  });
  provider.on("chainChanged", (chainId) => {
    const connection = ours();
    if (!connection) return;
    connection.chainId = Number(chainId);
    switchFailed = false;
    refresh("accounts");
    render();
  });
  provider.on("disconnect", () => ours() && letGo());
}
