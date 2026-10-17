import { getAddress, type Address, type Hex } from "viem";
import { sleep } from "./chain.ts";
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
 * The wallets the browser announces (EIP-6963), else "Browser wallet", then Coinbase's SDK unless Coinbase's extension
 * announced itself: the SDK would use the extension.
 */
function wallets(): Wallet[] {
  const list: Wallet[] = [...announced.values()].map(({ info, provider }) => ({
    id: info.rdns,
    name: clean(info.name),
    ...(info.icon?.startsWith("data:image/") && { icon: info.icon }),
    provider: async () => provider,
  }));
  if (!list.length) list.push({ id: "injected", name: "Browser wallet", provider: injected });
  if (!announced.has(COINBASE_RDNS)) list.push({ id: "coinbase", name: "Coinbase Wallet", provider: coinbase });
  return list;
}

/** No wallet in this browser: none announced itself, and window.ethereum is empty. */
export class NoWallet extends Error {}

/** The wallet at window.ethereum, read when someone picks it: some wallets put it there late. */
async function injected(): Promise<Provider> {
  const provider = (window as { ethereum?: Provider }).ethereum;
  if (!provider) throw new NoWallet("No wallet in this browser.");
  return provider;
}

let sdk: Promise<Provider> | undefined;

/** Coinbase's SDK, loaded the first time someone picks it. */
export function coinbase(): Promise<Provider> {
  sdk ??= import("./coinbase.ts").then(({ provider }) => provider());
  sdk.catch(() => (sdk = undefined));
  return sdk;
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
 * account ("ready") sends them one by one instead, and so does one that does not answer.
 */
export async function batches(provider: Provider, address: Address): Promise<boolean> {
  try {
    const all = (await Promise.race([
      provider.request({ method: "wallet_getCapabilities", params: [address, [HEX_CHAIN_ID]] }),
      sleep(5_000).then(() => null),
    ])) as Record<string, { atomic?: { status?: string } }> | null;
    return (all?.[HEX_CHAIN_ID]?.atomic ?? all?.["0x0"]?.atomic)?.status === "supported";
  } catch {
    return false;
  }
}

export type Call = { to: Address; data: Hex };

/**
 * Sends calls as one transaction, then follows it while following says to, until Base includes it. The first await is
 * the wallet's request, so a wallet that opens a window, such as Coinbase's, opens it from the click. Returns the
 * transaction hashes, or undefined when the page stopped following or the wallet cannot say where the batch is.
 */
export async function sendBatch(
  provider: Provider,
  from: Address,
  calls: Call[],
  sent: () => void,
  following: () => boolean,
): Promise<Hex[] | undefined> {
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
  type Status = { status: number | string; receipts?: { transactionHash: Hex; status: Hex | number }[] };
  while (following()) {
    const answer = (await provider
      .request({ method: "wallet_getCallsStatus", params: [id] })
      .catch(() => undefined)) as Status | undefined;
    if (!answer) return undefined;
    const { status, receipts = [] } = answer;
    if (status === 100 || status === "PENDING") {
      await sleep(2_000);
      continue;
    }
    const hashes = receipts.map(({ transactionHash }) => transactionHash);
    const ok = (status === 200 || status === "CONFIRMED") && receipts.every((r) => Number(r.status) === 1);
    if (!ok) throw new Failed(hashes);
    return hashes;
  }
  return undefined;
}

/**
 * Sends one call as a transaction on Base: a wallet on another chain refuses it. The first await is the wallet's
 * request. Returns the transaction's hash.
 */
export const sendTransaction = async (provider: Provider, from: Address, { to, data }: Call): Promise<Hex> =>
  (await provider.request({
    method: "eth_sendTransaction",
    params: [{ from, to, data, chainId: HEX_CHAIN_ID }],
  })) as Hex;

/** A transaction that Base included but that reverted. */
export class Failed extends Error {
  hashes: Hex[];
  constructor(hashes: Hex[]) {
    super("A transaction failed on Base.");
    this.hashes = hashes;
  }
}
