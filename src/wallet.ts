import {
  MethodNotFoundRpcError,
  SwitchChainError,
  UnsupportedProviderMethodError,
  UserRejectedRequestError,
  getAddress,
  isAddress,
  numberToHex,
  type Address,
  type ChainIdToCapabilities,
  type EIP1193Provider,
  type ExtractCapabilities,
  type Hex,
} from "viem";
import { BASESCAN, CHAIN_ID, RPCS } from "./config.ts";
import { clean } from "./format.ts";
import type { Landed } from "./rpc.ts";
import type {} from "viem/window";

export type Wallet = {
  name: string;
  icon?: string | undefined;
  provider: () => Promise<EIP1193Provider>;
  // Only Safe{Wallet} has this. It proposes all the calls as one Safe transaction, for the owners to sign in
  // Safe{Wallet}.
  propose?(txs: Tx[]): Promise<void>;
};
export type Connection = { wallet: Wallet; provider: EIP1193Provider; address: Address; chainId: number };
// `tip` is the highest priority fee per gas to ask for, in wei, where the wallet lets the page set one.
export type Tx = { to: Address; data: Hex; tip?: bigint | undefined };
// `after` is text shown after `code`. `calldata` marks `code` as a call's data, shown as a block.
export type Field = {
  label: string;
  code?: string | string[];
  tags?: string[];
  words?: string;
  description?: string;
  after?: string;
  calldata?: boolean;
};
// A call as the review shows it: `title` says what it is, `says` describes it in the page's own words, and `on` names
// the contract it goes to.
export type Slip = Tx & { title: string; says: string; on: string; call: string; fields: Field[] };

type Announcement = { info: { name: string; icon: string; rdns: string }; provider: EIP1193Provider };

const CHAIN = numberToHex(CHAIN_ID);
const UNKNOWN_METHOD: number[] = [UnsupportedProviderMethodError.code, MethodNotFoundRpcError.code];

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
      icon: info.icon?.startsWith("data:image/") ? info.icon : undefined,
      provider: async () => provider,
    });
    offer();
  });
  window.dispatchEvent(new Event("eip6963:requestProvider"));
  offer();
}

// Read when the wallet is picked, not at load, because some wallets set `window.ethereum` late.
async function injected(): Promise<EIP1193Provider> {
  const provider = window.ethereum;
  if (!provider) throw new NoWallet();
  return provider;
}

// Safe{Wallet}'s origin. The page sends questions only to it and accepts answers only from it.
export const SAFE_ORIGIN = "https://app.safe.global";
// The Safe Apps SDK version sent with each request, which Safe{Wallet} expects from a Safe App.
const SAFE_APPS_VERSION = "9.1.0";

// The origin of the page that frames this one, when the browser gives it. A sandboxed frame has the opaque origin
// "null", and without `ancestorOrigins` a frame loaded with no referrer has none at all; neither tells anything, so
// then only whether Safe{Wallet} answers decides. Without `ancestorOrigins`, a referrer from the page's own origin
// (`own`) tells nothing either: the frame navigated within itself.
export function parentOrigin(ancestor: string | undefined, referrer: string, own?: string): string | undefined {
  const origin = ancestor ?? (referrer ? new URL(referrer).origin : "");
  if (ancestor === undefined && origin === own) return undefined;
  return origin && origin !== "null" ? origin : undefined;
}

type SafeAnswer = { id: string; success: boolean; data?: unknown; error?: string };
// Asks Safe{Wallet} a question. `stop` stops listening for answers and drops the questions still waiting.
type AskSafe = ((method: string, params?: unknown) => Promise<unknown>) & { stop(): void };

// Asks Safe{Wallet}, the parent frame, as a Safe App does. Each message goes to `SAFE_ORIGIN` only, and Safe{Wallet}
// answers it with the same `id`. Only answers from the parent, at that origin, to a question still waiting count. Ids
// are random, as in the SDK, so an answer to a question asked before a reload can't pass for one asked since.
export function askSafe(
  parent: { postMessage(message: unknown, targetOrigin: string): void },
  events: Pick<EventTarget, "addEventListener"> = window,
): AskSafe {
  const waiting = new Map<string, (answer: SafeAnswer) => void>();
  const listening = new AbortController();
  events.addEventListener(
    "message",
    (event) => {
      const { origin, source, data } = event as MessageEvent<SafeAnswer | undefined>;
      if (origin !== SAFE_ORIGIN || source !== parent || !data) return;
      const answered = waiting.get(data.id);
      if (!answered) return;
      waiting.delete(data.id);
      answered(data);
    },
    { signal: listening.signal },
  );
  const ask = (method: string, params?: unknown) =>
    new Promise((resolve, reject) => {
      const id = crypto.randomUUID();
      waiting.set(id, ({ success, data, error }) => (success ? resolve(data) : reject(new Error(error))));
      parent.postMessage({ id, method, params, env: { sdkVersion: SAFE_APPS_VERSION } }, SAFE_ORIGIN);
    });
  return Object.assign(ask, {
    stop() {
      listening.abort();
      waiting.clear();
    },
  });
}

export async function safeWallet(): Promise<Wallet | undefined> {
  if (window.parent === window) return undefined;
  const parent = parentOrigin(location.ancestorOrigins?.[0], document.referrer, location.origin);
  if (parent && parent !== SAFE_ORIGIN) return undefined;
  return safeFrom(askSafe(window.parent), parent ? 10_000 : 1_000);
}

// Safe{Wallet} as a `Wallet`, if it says which Safe it holds within `wait` milliseconds. If it doesn't, the page stops
// listening to it.
export async function safeFrom(ask: AskSafe, wait: number): Promise<Wallet | undefined> {
  const timeout = new Promise<undefined>((resolve) => setTimeout(resolve, wait));
  const info = (await Promise.race([ask("getSafeInfo"), timeout]).catch(() => undefined)) as
    { safeAddress: string; chainId: number } | undefined;
  if (!info) {
    ask.stop();
    return undefined;
  }
  const provider = {
    async request({ method }: { method: string }) {
      if (method === "eth_requestAccounts") return [info.safeAddress];
      if (method === "eth_chainId") return numberToHex(info.chainId);
      throw Object.assign(new Error(`Safe{Wallet} does not answer ${method} here.`), {
        code: UnsupportedProviderMethodError.code,
      });
    },
    on() {},
    removeListener() {},
  } as EIP1193Provider;
  return {
    name: "Safe{Wallet}",
    provider: async () => provider,
    async propose(txs) {
      // An empty list is refused before Safe{Wallet} is asked, as the Safe Apps SDK does.
      if (!txs.length) throw new Error("There is no transaction to propose.");
      // Safe{Wallet} answers "Transaction was rejected" when the user closes its window, so that counts as the user
      // declining.
      await ask("sendTransactions", { txs: txs.map(({ to, data }) => ({ to, data, value: "0" })) }).catch(
        (error: Error) => {
          throw Object.assign(error, /rejected/i.test(error.message) ? { code: UserRejectedRequestError.code } : {});
        },
      );
    },
  };
}

export async function connect(wallet: Wallet): Promise<Connection | undefined> {
  const provider = await wallet.provider();
  const [address] = await provider.request({ method: "eth_requestAccounts" });
  if (!address) return undefined;
  const chainId = Number(await provider.request({ method: "eth_chainId" }));
  return { wallet, provider, address: getAddress(address), chainId };
}

// Some wallets wrap the error code they pass on.
const code = (error: unknown): number | undefined => {
  const { code, data } = (error ?? {}) as { code?: number; data?: { originalError?: { code?: number } } };
  return data?.originalError?.code ?? code;
};

export const declined = (error: unknown): boolean => code(error) === UserRejectedRequestError.code;

export async function switchToBase(connection: Connection): Promise<void> {
  const { provider } = connection;
  try {
    await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: CHAIN }] });
  } catch (error) {
    if (code(error) !== SwitchChainError.code) throw error;
    await provider.request({
      method: "wallet_addEthereumChain",
      params: [
        {
          chainId: CHAIN,
          chainName: "Base",
          nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
          rpcUrls: RPCS.slice(0, 1),
          blockExplorerUrls: [BASESCAN],
        },
      ],
    });
  }
  connection.chainId = Number(await provider.request({ method: "eth_chainId" }));
}

// `chainId` makes a wallet on another chain refuse the transaction.
export const sendTransaction = ({ provider, address }: Connection, { to, data, tip }: Tx): Promise<Hex> =>
  provider.request({
    method: "eth_sendTransaction",
    params: [
      {
        from: address,
        to,
        data,
        chainId: CHAIN,
        maxPriorityFeePerGas: tip === undefined ? undefined : numberToHex(tip),
      },
    ],
  });

// What a wallet can do beyond one transaction at a time, from EIP-5792's `wallet_getCapabilities`: send several calls
// in one prompt (`batch`), all or nothing (`atomic`), and list the tokens it holds (ERC-7811's `assets`). Asked once
// per wallet and address. A wallet that doesn't know the method can do none of these. One that fails for another
// reason, such as being locked, can do none of them for now and is asked again next time.
export type Capabilities = { batch: boolean; atomic: boolean; assets: boolean };
const NONE: Capabilities = { batch: false, atomic: false, assets: false };
const asked = new WeakMap<EIP1193Provider, Map<string, Promise<Capabilities>>>();

export function capabilities({ wallet, provider, address }: Connection): Promise<Capabilities> {
  // Safe{Wallet} proposes every call as one Safe transaction already.
  if (wallet.propose) return Promise.resolve(NONE);
  const byAddress = asked.get(provider) ?? new Map<string, Promise<Capabilities>>();
  asked.set(provider, byAddress);
  const key = address.toLowerCase();
  let found = byAddress.get(key);
  if (!found) {
    found = provider
      .request({ method: "wallet_getCapabilities", params: [address, [CHAIN]] })
      .then((all: ChainIdToCapabilities<ExtractCapabilities<"getCapabilities", "ReturnType">>) => {
        const base = { ...all["0x0"], ...all[CHAIN] };
        const atomic = base.atomic?.status === "supported" || base.atomic?.status === "ready";
        // Any wallet that answers can send calls together, even if not atomically.
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

// Sends all the calls in one prompt with EIP-5792's `wallet_sendCalls`, and returns the batch id.
export async function sendCalls({ provider, address }: Connection, txs: Tx[], atomic: boolean): Promise<string> {
  const { id } = await provider.request({
    method: "wallet_sendCalls",
    params: [
      {
        version: "2.0.0",
        from: address,
        chainId: CHAIN,
        atomicRequired: atomic,
        calls: txs.map(({ to, data }) => ({ to, data, value: "0x0" })),
      },
    ],
  });
  return id;
}

// EIP-5792 status 100 means pending and 200 means included, with each transaction's receipt; anything else means
// failed. A 200 without receipts yet still counts as pending, since the receipts decide the outcome.
type CallsStatus = { state: "pending" | "done" | "failed"; receipts: Landed[] };

export async function callsStatus({ provider }: Connection, id: string): Promise<CallsStatus> {
  const { status, receipts = [] } = await provider.request({ method: "wallet_getCallsStatus", params: [id] });
  const state =
    status === 100
      ? "pending"
      : status === 200
        ? !receipts.length
          ? "pending"
          : receipts.every((receipt) => receipt.status === "0x1")
            ? "done"
            : "failed"
        : "failed";
  return { state, receipts };
}

// The ERC-20 tokens the wallet says it holds on Base, from ERC-7811's `wallet_getAssets`, if the wallet supports it.
export async function walletAssets(connection: Connection): Promise<Address[]> {
  if (!(await capabilities(connection)).assets) return [];
  try {
    const assets = await connection.provider.request({
      method: "wallet_getAssets",
      params: [{ account: connection.address, chainFilter: [CHAIN] }],
    });
    return (assets[CHAIN] ?? []).flatMap(({ address, type }) =>
      type === "erc20" && isAddress(address, { strict: false }) ? [getAddress(address)] : [],
    );
  } catch {
    return [];
  }
}
