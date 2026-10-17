import { getAddress, type Address, type Hex } from "viem";
import { CHAIN_ID, RPCS } from "./config.ts";
import { clean } from "./format.ts";

/** A wallet's EIP-1193 provider. */
export type Provider = {
  request(args: { method: string; params?: unknown }): Promise<unknown>;
  on?(event: string, listener: (value: any) => void): unknown;
};

export type Wallet = { id: string; name: string; icon?: string; provider: () => Promise<Provider> };

export type Connection = { wallet: Wallet; provider: Provider; address: Address; chainId: number };

type Announcement = { info: { name: string; icon: string; rdns: string }; provider: Provider };

const HEX_CHAIN_ID = `0x${CHAIN_ID.toString(16)}`;
const announced = new Map<string, Announcement>();

/** Calls back with the wallets to offer now, and again each time a wallet announces itself. */
export function findWallets(found: (wallets: Wallet[]) => void): void {
  window.addEventListener("eip6963:announceProvider", (event) => {
    const { info, provider } = (event as CustomEvent<Announcement>).detail;
    announced.set(info.rdns, { info, provider });
    found(wallets());
  });
  window.dispatchEvent(new Event("eip6963:requestProvider"));
  found(wallets());
}

/** The wallets the browser announces (EIP-6963), else "Browser wallet". */
function wallets(): Wallet[] {
  const list: Wallet[] = [...announced.values()].map(({ info, provider }) => ({
    id: info.rdns,
    name: clean(info.name),
    ...(info.icon?.startsWith("data:image/") && { icon: info.icon }),
    provider: async () => provider,
  }));
  return list.length ? list : [{ id: "injected", name: "Browser wallet", provider: injected }];
}

/** No wallet in this browser: none announced itself, and window.ethereum is empty. */
export class NoWallet extends Error {}

/** The wallet at window.ethereum, read when someone picks it: some wallets put it there late. */
async function injected(): Promise<Provider> {
  const provider = (window as { ethereum?: Provider }).ethereum;
  if (!provider) throw new NoWallet("No wallet in this browser.");
  return provider;
}

let safeSdk: Promise<Provider | undefined> | undefined;

/** Safe{Wallet}'s provider when the page runs in it as a Safe App, else undefined. Safe's code loads only in a frame. */
export function safe(): Promise<Provider | undefined> {
  if (window.parent === window) return Promise.resolve(undefined);
  safeSdk ??= import("./safe.ts").then(({ provider }) => provider()).catch(() => undefined);
  return safeSdk;
}

/** Safe{Wallet}, which the page connects to on its own when it runs in it. Its provider shares the Safe without asking. */
export const SAFE: Wallet = { id: "safe", name: "Safe{Wallet}", provider: async () => (await safe())! };

/** Whether the wallet is a Safe, which proposes calls for its owners to sign in Safe{Wallet} rather than sending them. */
export const proposes = ({ wallet }: Connection): boolean => wallet === SAFE;

/** Asks the wallet for its account. */
export async function connect(wallet: Wallet): Promise<Connection | undefined> {
  const provider = await wallet.provider();
  const [address] = (await provider.request({ method: "eth_requestAccounts" })) as string[];
  if (!address) return undefined;
  const chainId = Number(await provider.request({ method: "eth_chainId" }));
  return { wallet, provider, address: getAddress(address), chainId };
}

const code = (error: unknown): number | undefined => {
  const { code, data } = (error ?? {}) as { code?: number; data?: { originalError?: { code?: number } } };
  return data?.originalError?.code ?? code;
};

/** Whether the user said no in their wallet. */
export const declined = (error: unknown): boolean => code(error) === 4001;

/** Asks the wallet to switch to Base, adding Base first if the wallet does not know it, then reads its chain again. */
export async function switchToBase(connection: Connection): Promise<void> {
  const { provider } = connection;
  try {
    await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: HEX_CHAIN_ID }] });
  } catch (error) {
    if (code(error) !== 4902) throw error;
    await provider.request({
      method: "wallet_addEthereumChain",
      params: [
        {
          chainId: HEX_CHAIN_ID,
          chainName: "Base",
          nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
          rpcUrls: [RPCS[0]],
          blockExplorerUrls: ["https://basescan.org"],
        },
      ],
    });
  }
  connection.chainId = Number(await provider.request({ method: "eth_chainId" }));
}

export type Call = { to: Address; data: Hex };

/** Proposes calls as one Safe transaction, for the Safe's owners to sign in Safe{Wallet}. */
export const propose = async (provider: Provider, calls: Call[]): Promise<void> => {
  await provider.request({ method: "wallet_sendCalls", params: [{ calls }] });
};

/**
 * Sends one call as a transaction on Base: a wallet on another chain refuses it. The first await is the wallet's
 * request, so a wallet that opens a window opens it from the click. Returns the transaction's hash.
 */
export const sendTransaction = async (provider: Provider, from: Address, { to, data }: Call): Promise<Hex> =>
  (await provider.request({
    method: "eth_sendTransaction",
    params: [{ from, to, data, chainId: HEX_CHAIN_ID }],
  })) as Hex;
