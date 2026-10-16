import { getAddress, type Address, type Hex } from "viem";
import { included, sleep } from "./chain.ts";
import { CHAIN_ID, RPCS } from "./config.ts";
import { clean } from "./format.ts";

/** A wallet's EIP-1193 provider. */
export type Provider = {
  request(args: { method: string; params?: unknown }): Promise<unknown>;
  on?(event: string, listener: (value: any) => void): unknown;
  disconnect?(): Promise<void>;
};

export type Wallet = { id: string; name: string; icon?: string; provider: () => Promise<Provider> };

export type Connection = { wallet: Wallet; provider: Provider; address: Address; chainId: number };

type Announcement = { info: { name: string; icon: string; rdns: string }; provider: Provider };

const HEX_CHAIN_ID = `0x${CHAIN_ID.toString(16)}`;
const COINBASE_RDNS = "com.coinbase.wallet";
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

/**
 * The wallets the browser announces (EIP-6963), else the one at window.ethereum, then Coinbase's SDK unless Coinbase's
 * extension announced itself: the SDK would use the extension.
 */
function wallets(): Wallet[] {
  const list: Wallet[] = [...announced.values()].map(({ info, provider }) => ({
    id: info.rdns,
    name: clean(info.name),
    ...(info.icon?.startsWith("data:image/") && { icon: info.icon }),
    provider: async () => provider,
  }));
  const injected = (window as { ethereum?: Provider }).ethereum;
  if (!list.length && injected) list.push({ id: "injected", name: "Browser wallet", provider: async () => injected });
  if (!announced.has(COINBASE_RDNS)) list.push({ id: "coinbase", name: "Coinbase Wallet", provider: coinbase });
  return list;
}

let sdk: Promise<Provider> | undefined;

/** Coinbase's SDK, loaded the first time someone picks it. */
export function coinbase(): Promise<Provider> {
  sdk ??= import("./coinbase.ts").then(({ provider }) => provider());
  sdk.catch(() => (sdk = undefined));
  return sdk;
}

/** Asks the wallet for its account; with ask false, only reads an account it already shares. */
export async function connect(wallet: Wallet, ask = true): Promise<Connection | undefined> {
  const provider = await wallet.provider();
  const [address] = (await provider.request({ method: ask ? "eth_requestAccounts" : "eth_accounts" })) as string[];
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

/**
 * Whether the wallet sends several calls as one transaction (EIP-5792). A wallet that would first ask to upgrade the
 * account ("ready") sends them one by one instead, and so does one that does not answer. Safe's provider answers in an
 * older shape.
 */
export async function batches(provider: Provider, address: Address): Promise<boolean> {
  try {
    type Capabilities = { atomic?: { status?: string }; atomicBatch?: { supported?: boolean } };
    const all = (await Promise.race([
      provider.request({ method: "wallet_getCapabilities", params: [address, [HEX_CHAIN_ID]] }),
      sleep(5_000).then(() => null),
    ])) as Record<string, Capabilities> | null;
    const capabilities = { ...all?.["0x0"], ...all?.[HEX_CHAIN_ID] };
    return capabilities.atomic?.status === "supported" || capabilities.atomicBatch?.supported === true;
  } catch {
    return false;
  }
}

export type Call = { to: Address; data: Hex };

/**
 * Sends calls as one transaction, and waits until it is included. The first await is the wallet's request, so a wallet
 * that opens a window, such as Coinbase's, opens it from the click. Returns the transaction hashes.
 */
export async function sendBatch(provider: Provider, from: Address, calls: Call[], sent: () => void): Promise<Hex[]> {
  const reply = (await provider.request({
    method: "wallet_sendCalls",
    params: [
      {
        version: "2.0.0",
        chainId: HEX_CHAIN_ID,
        from,
        atomicRequired: true,
        calls: calls.map(({ to, data }) => ({ to, data, value: "0x0" })),
      },
    ],
  })) as string | { id: string };
  sent();
  const id = typeof reply === "string" ? reply : reply.id;
  for (;;) {
    type Status = { status: number | string; receipts?: { transactionHash: Hex; status: Hex | number }[] };
    const { status, receipts = [] } = (await provider.request({
      method: "wallet_getCallsStatus",
      params: [id],
    })) as Status;
    if (status === 100 || status === "PENDING") {
      await sleep(2_000);
      continue;
    }
    const hashes = receipts.map(({ transactionHash }) => transactionHash);
    const ok = (status === 200 || status === "CONFIRMED") && receipts.every((r) => Number(r.status) === 1);
    if (!ok) throw new Failed(hashes);
    return hashes;
  }
}

/**
 * Sends calls one transaction at a time, each once the one before is included, while asking says to go on. Returns the
 * hashes of the transactions sent.
 */
export async function sendEach(
  provider: Provider,
  from: Address,
  calls: Call[],
  asking: (index: number) => boolean,
  sent: (hash: Hex, index: number) => void,
): Promise<Hex[]> {
  const hashes: Hex[] = [];
  for (const [index, { to, data }] of calls.entries()) {
    if (!asking(index)) break;
    const hash = (await provider.request({ method: "eth_sendTransaction", params: [{ from, to, data }] })) as Hex;
    hashes.push(hash);
    sent(hash, index);
    if (!(await included(hash))) throw new Failed(hashes);
  }
  return hashes;
}

/** A transaction that Base included but that reverted. */
export class Failed extends Error {
  hashes: Hex[];
  constructor(hashes: Hex[]) {
    super("A transaction failed on Base.");
    this.hashes = hashes;
  }
}
