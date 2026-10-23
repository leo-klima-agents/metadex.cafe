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
// `tip`, the most priority fee to ask for, where the wallet lets the page set it.
export type Tx = { to: Address; data: Hex; tip?: bigint };

type Announcement = { info: { name: string; icon: string; rdns: string }; provider: Provider };

const HEX_CHAIN_ID = `0x${CHAIN_ID.toString(16)}`;
const USER_REJECTED = 4001;
const UNSUPPORTED_METHOD = 4200;
const UNKNOWN_CHAIN = 4902;
// A wallet that does not support a method, or does not know it.
const UNKNOWN_METHOD = [UNSUPPORTED_METHOD, -32601];

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

const SAFE_ORIGIN = "https://app.safe.global";

export async function safeWallet(): Promise<Wallet | undefined> {
  if (window.parent === window) return undefined;
  const parent = location.ancestorOrigins?.[0] ?? (document.referrer && new URL(document.referrer).origin);
  if (parent && parent !== SAFE_ORIGIN) return undefined;
  const sdk = new SafeAppsSDK({ allowedDomains: [/^https:\/\/app\.safe\.global$/] });
  const timeout = new Promise<undefined>((resolve) => setTimeout(resolve, parent ? 10_000 : 1_000));
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
export const sendTransaction = async ({ provider, address }: Connection, { to, data, tip }: Tx): Promise<Hex> =>
  (await provider.request({
    method: "eth_sendTransaction",
    params: [
      {
        from: address,
        to,
        data,
        chainId: HEX_CHAIN_ID,
        ...(tip !== undefined && { maxPriorityFeePerGas: `0x${tip.toString(16)}` }),
      },
    ],
  })) as Hex;

// What a wallet can do beyond one transaction at a time, from EIP-5792's wallet_getCapabilities: send several calls in
// one prompt, all or nothing (`atomic`), and list the tokens it holds (ERC-7811's `assets`). Asked once per wallet and
// address: a wallet that does not know the method can do neither. One that failed otherwise, as while it was locked,
// can do neither for now, and is asked again the next time.
export type Capabilities = { batch: boolean; atomic: boolean; assets: boolean };
const NONE: Capabilities = { batch: false, atomic: false, assets: false };
const asked = new WeakMap<Provider, Map<string, Promise<Capabilities>>>();

export function capabilities({ wallet, provider, address }: Connection): Promise<Capabilities> {
  // Safe{Wallet} proposes every call as one Safe transaction already.
  if (wallet.propose) return Promise.resolve(NONE);
  const byAddress = asked.get(provider) ?? new Map<string, Promise<Capabilities>>();
  asked.set(provider, byAddress);
  const key = address.toLowerCase();
  let found = byAddress.get(key);
  if (!found) {
    found = provider
      .request({ method: "wallet_getCapabilities", params: [address, [HEX_CHAIN_ID]] })
      .then((reply) => {
        const all = (reply ?? {}) as Record<string, Record<string, { status?: string; supported?: boolean }>>;
        const base = { ...all["0x0"], ...all[HEX_CHAIN_ID], ...all[String(CHAIN_ID)] };
        const status = base.atomic?.status;
        const atomic = status === "supported" || status === "ready" || base.atomicBatch?.supported === true;
        // A wallet that answers sends calls together, even if not all or nothing.
        return { batch: true, atomic, assets: base.assetDiscovery?.supported === true };
      })
      .catch((error: unknown) => {
        if (!UNKNOWN_METHOD.includes(code(error) ?? 0) && byAddress.get(key) === found) byAddress.delete(key);
        return NONE;
      });
    byAddress.set(key, found);
  }
  return found;
}

// Sends the calls in one prompt, with EIP-5792's wallet_sendCalls, and gives the batch's id.
export async function sendCalls({ provider, address }: Connection, txs: Tx[], atomic: boolean): Promise<string> {
  const reply = await provider.request({
    method: "wallet_sendCalls",
    params: [
      {
        version: "2.0.0",
        from: address,
        chainId: HEX_CHAIN_ID,
        atomicRequired: atomic,
        calls: txs.map(({ to, data }) => ({ to, data, value: "0x0" })),
      },
    ],
  });
  return typeof reply === "string" ? reply : String((reply as { id: string }).id);
}

export type CallsReceipt = {
  transactionHash: Hex;
  status: Hex;
  logs: { address: Address; data: Hex; topics: Hex[] }[];
};
// A batch is pending, included (with each transaction's receipt), or failed. Wallets of the first drafts answer in words.
export type CallsStatus = { state: "pending" | "done" | "failed"; receipts: CallsReceipt[] };

export async function callsStatus({ provider }: Connection, id: string): Promise<CallsStatus> {
  const reply = (await provider.request({ method: "wallet_getCallsStatus", params: [id] })) as {
    status: number | string;
    receipts?: CallsReceipt[];
  };
  const { status, receipts = [] } = reply;
  const state =
    status === 100 || status === "PENDING"
      ? "pending"
      : status === 200 || status === "CONFIRMED"
        ? receipts.every((receipt) => receipt.status === "0x1")
          ? "done"
          : "failed"
        : "failed";
  return { state, receipts };
}

// The ERC-20 tokens the wallet says it holds on Base, from ERC-7811's wallet_getAssets, where it offers it.
export async function walletAssets(connection: Connection): Promise<Address[]> {
  if (!(await capabilities(connection)).assets) return [];
  try {
    const reply = (await connection.provider.request({
      method: "wallet_getAssets",
      params: [{ account: connection.address, chainFilter: [HEX_CHAIN_ID] }],
    })) as Record<string, { address?: string; type?: string }[]>;
    return (reply[HEX_CHAIN_ID] ?? []).flatMap(({ address, type }) =>
      type === "erc20" && address && /^0x[0-9a-fA-F]{40}$/.test(address) ? [getAddress(address)] : [],
    );
  } catch {
    return [];
  }
}
