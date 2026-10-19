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
// `batches` is whether the wallet can send several calls in one request on Base (EIP-5792).
export type Connection = { wallet: Wallet; provider: Provider; address: Address; chainId: number; batches?: boolean };
export type Tx = { to: Address; data: Hex };

type Announcement = { info: { name: string; icon: string; rdns: string }; provider: Provider };

const HEX_CHAIN_ID = `0x${CHAIN_ID.toString(16)}`;
const USER_REJECTED = 4001;
const UNSUPPORTED_METHOD = 4200;
const UNKNOWN_CHAIN = 4902;
// A wallet that answers these to wallet_sendCalls cannot send the calls in one request, but may one by one: the method
// is unknown, a capability, the chain, the size or atomicity unsupported.
const CANNOT_BATCH = [UNSUPPORTED_METHOD, -32601, 5700, 5710, 5740, 5760];

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

// EIP-5792: a wallet that can send several calls in one request on a chain lists the atomic capability for it, or
// for every chain under 0x0. A wallet that does not answer within two seconds is taken not to.
export async function canBatch({ provider, address }: Connection): Promise<boolean> {
  const asking = provider.request({ method: "wallet_getCapabilities", params: [address, [HEX_CHAIN_ID]] });
  const timeout = new Promise<undefined>((resolve) => setTimeout(resolve, 2_000));
  const found = await Promise.race([asking, timeout]).catch(() => undefined);
  if (!found || typeof found !== "object") return false;
  return Object.entries(found as Record<string, { atomic?: unknown } | undefined>).some(
    ([chain, capabilities]) => [CHAIN_ID, 0].includes(Number(chain)) && !!capabilities?.atomic,
  );
}

export const cannotBatch = (error: unknown): boolean => CANNOT_BATCH.includes(code(error) ?? 0);

// Asks for all the calls at once. The wallet may send them in one transaction or in several.
export async function sendCalls({ provider, address }: Connection, txs: Tx[]): Promise<string> {
  const sent = await provider.request({
    method: "wallet_sendCalls",
    params: [
      {
        version: "2.0.0",
        from: address,
        chainId: HEX_CHAIN_ID,
        atomicRequired: false,
        calls: txs.map(({ to, data }) => ({ to, data, value: "0x0" })),
      },
    ],
  });
  // Wallets that followed EIP-5792's drafts answer with the id alone.
  return typeof sent === "string" ? sent : (sent as { id: string }).id;
}

// 100 while pending, 200 once included, 400 if the wallet gave up, 500 if all reverted, 600 if some did. Drafts of
// EIP-5792 said PENDING and CONFIRMED.
export type CallsStatus = { status: number; receipts: { status: Hex; transactionHash: Hex }[] };

export async function callsStatus({ provider }: Connection, id: string): Promise<CallsStatus> {
  const found = (await provider.request({ method: "wallet_getCallsStatus", params: [id] })) as {
    status: number | string;
    receipts?: CallsStatus["receipts"];
  };
  const named: Record<string, number> = { PENDING: 100, CONFIRMED: 200 };
  const status = typeof found.status === "string" ? (named[found.status] ?? 100) : found.status;
  return { status, receipts: found.receipts ?? [] };
}

// The batch's status once the wallet has an outcome, or undefined if it has none within ten minutes, or cannot say.
export async function waitForCalls(connection: Connection, id: string): Promise<CallsStatus | undefined> {
  const end = Date.now() + 10 * 60_000;
  for (let failures = 0; Date.now() < end && failures < 3;) {
    const found = await callsStatus(connection, id).catch(() => undefined);
    if (found && found.status >= 200) return found;
    failures = found ? 0 : failures + 1;
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
  return undefined;
}

// The chain ID makes a wallet that is on another chain refuse the transaction.
export const sendTransaction = async ({ provider, address }: Connection, { to, data }: Tx): Promise<Hex> =>
  (await provider.request({
    method: "eth_sendTransaction",
    params: [{ from: address, to, data, chainId: HEX_CHAIN_ID }],
  })) as Hex;
