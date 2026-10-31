import { getAddress, type Address, type Hex } from "viem";
import { BASESCAN, CHAIN_ID, RPCS } from "./config.ts";
import { clean } from "./format.ts";
import { key } from "./util.ts";

export type Provider = {
  request(args: { method: string; params?: unknown }): Promise<unknown>;
  on?(event: string, listener: (value: any) => void): unknown;
};
// `propose`: Safe{Wallet} proposes all the calls as one Safe transaction, for its owners to sign there.
export type Wallet = {
  name: string;
  icon?: string;
  provider: () => Promise<Provider>;
  propose?(txs: Tx[]): Promise<void>;
};
export type Connection = { wallet: Wallet; provider: Provider; address: Address; chainId: number };
// `tip`: the most priority fee to ask for.
export type Tx = { to: Address; data: Hex; tip?: bigint };

const HEX_CHAIN_ID = `0x${CHAIN_ID.toString(16)}`;
const REJECTED = 4001;
const UNSUPPORTED = 4200;
export class NoWallet extends Error {}

// Wallets that announce themselves (EIP-6963), or else window.ethereum, read once picked as some set it late.
export function findWallets(found: (wallets: Wallet[]) => void): void {
  const announced = new Map<string, Wallet>();
  const offer = () =>
    found(
      announced.size
        ? [...announced.values()]
        : [
            {
              name: "Browser wallet",
              provider: async () => {
                const provider = (window as { ethereum?: Provider }).ethereum;
                if (!provider) throw new NoWallet();
                return provider;
              },
            },
          ],
    );
  window.addEventListener("eip6963:announceProvider", (event) => {
    const { info, provider } = (
      event as CustomEvent<{ info: { name: string; icon: string; rdns: string }; provider: Provider }>
    ).detail;
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

export const SAFE_ORIGIN = "https://app.safe.global";

// The framing page's origin, as far as the browser says: not an opaque one, nor the page's own, as after navigating.
export function parentOrigin(ancestor: string | undefined, referrer: string, own?: string): string | undefined {
  const origin = ancestor ?? (referrer ? new URL(referrer).origin : "");
  if (ancestor === undefined && origin === own) return undefined;
  return origin && origin !== "null" ? origin : undefined;
}

export type AskSafe = ((method: string, params?: unknown) => Promise<unknown>) & { stop(): void };

// Asks Safe{Wallet}, the parent frame, as the Safe Apps SDK does: random ids, its origin only, answers from it only.
export function askSafe(
  parent: { postMessage(message: unknown, targetOrigin: string): void },
  events: Pick<EventTarget, "addEventListener"> = window,
): AskSafe {
  type Answer = { id: string; success: boolean; data?: unknown; error?: string };
  const waiting = new Map<string, (answer: Answer) => void>();
  const listening = new AbortController();
  events.addEventListener(
    "message",
    (event) => {
      const { origin, source, data } = event as MessageEvent<Answer | undefined>;
      if (origin !== SAFE_ORIGIN || source !== parent || !data) return;
      waiting.get(data.id)?.(data);
      waiting.delete(data.id);
    },
    { signal: listening.signal },
  );
  const ask = (method: string, params?: unknown) =>
    new Promise((resolve, reject) => {
      const id = crypto.randomUUID();
      waiting.set(id, ({ success, data, error }) => (success ? resolve(data) : reject(new Error(error))));
      parent.postMessage({ id, method, params, env: { sdkVersion: "9.1.0" } }, SAFE_ORIGIN);
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

// Safe{Wallet} as a wallet, once it names its Safe within `wait` ms.
export async function safeFrom(ask: AskSafe, wait: number): Promise<Wallet | undefined> {
  const timeout = new Promise<undefined>((resolve) => setTimeout(resolve, wait));
  const info = (await Promise.race([ask("getSafeInfo"), timeout]).catch(() => undefined)) as
    { safeAddress: string; chainId: number } | undefined;
  if (!info) return void ask.stop();
  const provider: Provider = {
    async request({ method }) {
      if (method === "eth_requestAccounts") return [info.safeAddress];
      if (method === "eth_chainId") return `0x${info.chainId.toString(16)}`;
      throw Object.assign(new Error(`Safe{Wallet} does not answer ${method} here.`), { code: UNSUPPORTED });
    },
  };
  return {
    name: "Safe{Wallet}",
    provider: async () => provider,
    async propose(txs) {
      if (!txs.length) throw new Error("There is no transaction to propose.");
      // A closed window says "Transaction was rejected".
      await ask("sendTransactions", { txs: txs.map(({ to, data }) => ({ to, data, value: "0" })) }).catch(
        (error: Error) => {
          throw Object.assign(error, /rejected/i.test(error.message) ? { code: REJECTED } : {});
        },
      );
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

// Some wallets wrap the code they pass on.
const code = (error: unknown): number | undefined => {
  const { code, data } = (error ?? {}) as { code?: number; data?: { originalError?: { code?: number } } };
  return data?.originalError?.code ?? code;
};
export const declined = (error: unknown): boolean => code(error) === REJECTED;

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
          blockExplorerUrls: [BASESCAN],
        },
      ],
    });
  }
  connection.chainId = Number(await provider.request({ method: "eth_chainId" }));
}

// The chain id makes a wallet on another chain refuse.
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

// EIP-5792: several calls in one prompt, all or nothing where `atomic`; ERC-7811 `assets`. Asked once per address; a
// failure other than an unknown method is asked again next time.
export type Capabilities = { batch: boolean; atomic: boolean; assets: boolean };
const NONE: Capabilities = { batch: false, atomic: false, assets: false };
const asked = new WeakMap<Provider, Map<string, Promise<Capabilities>>>();

export function capabilities({ wallet, provider, address }: Connection): Promise<Capabilities> {
  if (wallet.propose) return Promise.resolve(NONE);
  const byAddress = asked.get(provider) ?? new Map<string, Promise<Capabilities>>();
  asked.set(provider, byAddress);
  let found = byAddress.get(key(address));
  if (!found) {
    found = provider
      .request({ method: "wallet_getCapabilities", params: [address, [HEX_CHAIN_ID]] })
      .then((reply) => {
        const all = (reply ?? {}) as Record<string, Record<string, { status?: string; supported?: boolean }>>;
        const base = { ...all["0x0"], ...all[HEX_CHAIN_ID], ...all[String(CHAIN_ID)] };
        const status = base.atomic?.status;
        const atomic = status === "supported" || status === "ready" || base.atomicBatch?.supported === true;
        return { batch: true, atomic, assets: base.assetDiscovery?.supported === true };
      })
      .catch((error: unknown) => {
        if (![UNSUPPORTED, -32601].includes(code(error) ?? 0) && byAddress.get(key(address)) === found)
          byAddress.delete(key(address));
        return NONE;
      });
    byAddress.set(key(address), found);
  }
  return found;
}

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
export type CallsStatus = { state: "pending" | "done" | "failed"; receipts: CallsReceipt[] };

// Early drafts of EIP-5792 answer in words.
export async function callsStatus({ provider }: Connection, id: string): Promise<CallsStatus> {
  const { status, receipts = [] } = (await provider.request({ method: "wallet_getCallsStatus", params: [id] })) as {
    status: number | string;
    receipts?: CallsReceipt[];
  };
  if (status === 100 || status === "PENDING") return { state: "pending", receipts };
  const done = (status === 200 || status === "CONFIRMED") && receipts.every(({ status }) => status === "0x1");
  return { state: done ? "done" : "failed", receipts };
}

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
