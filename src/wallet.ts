import SafeAppsSDK from "@safe-global/safe-apps-sdk";
import { getAddress, type Address, type Hex } from "viem";
import { CHAIN_ID, RPCS } from "./config.ts";
import { clean } from "./format.ts";

export type Provider = {
  request(args: { method: string; params?: unknown }): Promise<unknown>;
  on?(event: string, listener: (value: any) => void): unknown;
};

export type Wallet = {
  name: string;
  icon?: string;
  provider: () => Promise<Provider>;
  // Only Safe{Wallet} has it: it proposes all the calls as one Safe transaction, for the owners to sign there.
  propose?(txs: Tx[]): Promise<void>;
};
export type Connection = { wallet: Wallet; provider: Provider; address: Address; chainId: number };
export type Tx = { to: Address; data: Hex };

type Announcement = { info: { name: string; icon: string; rdns: string }; provider: Provider };

const HEX_CHAIN_ID = `0x${CHAIN_ID.toString(16)}`;
const USER_REJECTED = 4001;
const UNSUPPORTED_METHOD = 4200;
const UNKNOWN_CHAIN = 4902;

export class NoWallet extends Error {}

// Wallets that announce themselves (EIP-6963), or window.ethereum if none does.
export function findWallets(found: (wallets: Wallet[]) => void): void {
  const announced = new Map<string, Wallet>();
  const offer = () =>
    found(announced.size ? [...announced.values()] : [{ name: "Browser wallet", provider: injected }]);
  window.addEventListener("eip6963:announceProvider", (event) => {
    const { info, provider } = (event as CustomEvent<Announcement>).detail;
    announced.set(info.rdns, {
      name: clean(info.name),
      ...(info.icon?.startsWith("data:image/") && { icon: info.icon }),
      provider: async () => provider,
    });
    offer();
  });
  window.dispatchEvent(new Event("eip6963:requestProvider"));
  offer();
}

// Read only once picked: some wallets set window.ethereum late.
async function injected(): Promise<Provider> {
  const provider = (window as { ethereum?: Provider }).ethereum;
  if (!provider) throw new NoWallet();
  return provider;
}

export async function safeWallet(): Promise<Wallet | undefined> {
  if (window.parent === window) return undefined;
  const sdk = new SafeAppsSDK({ allowedDomains: [/^https:\/\/app\.safe\.global$/] });
  // In any other frame, nothing answers.
  const timeout = new Promise<undefined>((resolve) => setTimeout(resolve, 1_000));
  const info = await Promise.race([sdk.safe.getInfo(), timeout]).catch(() => undefined);
  if (!info) return undefined;
  const provider: Provider = {
    async request({ method }) {
      if (method === "eth_requestAccounts") return [info.safeAddress];
      if (method === "eth_chainId") return `0x${info.chainId.toString(16)}`;
      throw Object.assign(new Error(`Safe{Wallet} does not answer ${method} here.`), { code: UNSUPPORTED_METHOD });
    },
  };
  return {
    name: "Safe{Wallet}",
    provider: async () => provider,
    async propose(txs) {
      // Safe{Wallet} says "Transaction was rejected" when its window is closed.
      await sdk.txs.send({ txs: txs.map(({ to, data }) => ({ to, data, value: "0" })) }).catch((error: Error) => {
        throw Object.assign(error, /rejected/i.test(error.message) ? { code: USER_REJECTED } : {});
      });
    },
  };
}

export async function connect(wallet: Wallet): Promise<Connection | undefined> {
  const provider = await wallet.provider();
  const [address] = (await provider.request({ method: "eth_requestAccounts" })) as string[];
  if (!address) return undefined;
  const chainId = Number(await provider.request({ method: "eth_chainId" }));
  return { wallet, provider, address: getAddress(address), chainId };
}

// Some wallets wrap the error code they pass on.
const code = (error: unknown): number | undefined => {
  const { code, data } = (error ?? {}) as { code?: number; data?: { originalError?: { code?: number } } };
  return data?.originalError?.code ?? code;
};

export const declined = (error: unknown): boolean => code(error) === USER_REJECTED;

export async function switchToBase(connection: Connection): Promise<void> {
  const { provider } = connection;
  try {
    await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: HEX_CHAIN_ID }] });
  } catch (error) {
    if (code(error) !== UNKNOWN_CHAIN) throw error;
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

// The chain ID makes a wallet that is on another chain refuse the transaction.
export const sendTransaction = async ({ provider, address }: Connection, { to, data }: Tx): Promise<Hex> =>
  (await provider.request({
    method: "eth_sendTransaction",
    params: [{ from: address, to, data, chainId: HEX_CHAIN_ID }],
  })) as Hex;
