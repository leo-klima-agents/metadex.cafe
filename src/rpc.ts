import {
  decodeFunctionResult,
  encodeFunctionData,
  numberToHex,
  parseAbi,
  type Abi,
  type Address,
  type Hex,
} from "viem";
import { memo } from "./cache.ts";
import { MULTICALL3, RPCS } from "./config.ts";

export type Call = { address: Address; abi: Abi; functionName: string; args: unknown[] };
export const call = (address: Address, abi: Abi, functionName: string, ...args: unknown[]): Call => ({
  address,
  abi,
  functionName,
  args,
});
// Never throws, even on the undefined of a failed read.
export const same = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase();
export const sleep = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms));

const multicall3Abi = parseAbi([
  "function aggregate3((address target, bool allowFailure, bytes callData)[] calls) payable returns ((bool success, bytes returnData)[])",
  "function getCurrentBlockTimestamp() view returns (uint256 timestamp)",
]);
export const blockTime = call(MULTICALL3, multicall3Abi, "getCurrentBlockTimestamp");

// Base's time, from the newest block read, in case the device's clock is wrong.
let drift = 0;
let newest = 0;
export function sawBlock(time: number): void {
  if (time < newest) return;
  newest = time;
  drift = time - Math.floor(Date.now() / 1000);
}
export const now = (): number => Math.floor(Date.now() / 1000) + drift;

// What a read is for. Reads whose tag the page shown draws, or with no tag, go first; the others, which read ahead
// what other pages show, take at most BEHIND of the MAX slots.
export type Tag = "earnings" | "average" | "shares" | "payouts" | "swap";
const MAX = 6;
const BEHIND = 4;
let shown = new Set<Tag>();
let running = 0;
let behind = 0;
const queue: { tag: Tag | undefined; go: (back: boolean) => void }[] = [];
const ahead = (tag?: Tag): boolean => !tag || shown.has(tag);

export function showTags(tags: Tag[]): void {
  shown = new Set(tags);
  pump();
}
function pump(): void {
  while (running < MAX) {
    let i = queue.findIndex(({ tag }) => ahead(tag));
    if (i < 0 && queue.length && behind < BEHIND) i = 0;
    if (i < 0) return;
    const [next] = queue.splice(i, 1);
    const back = !ahead(next!.tag);
    running++;
    if (back) behind++;
    next!.go(back);
  }
}
async function inSlot<T>(tag: Tag | undefined, ask: () => Promise<T>): Promise<T> {
  const back = await new Promise<boolean>((go) => {
    queue.push({ tag, go });
    pump();
  });
  try {
    return await ask();
  } finally {
    running--;
    if (back) behind--;
    pump();
  }
}

// Each RPC gets at most 25 requests a second, 5 of them for logs; one that is busy or out of reach rests a second.
const nextFree = new Map<string, number>();
const restUntil = new Map<string, number>();
async function pace(url: string, logs: boolean): Promise<void> {
  const keys = logs ? [url, `${url} logs`] : [url];
  const at = Math.max(performance.now(), restUntil.get(url) ?? 0, ...keys.map((key) => nextFree.get(key) ?? 0));
  nextFree.set(url, at + 40);
  if (logs) nextFree.set(`${url} logs`, at + 200);
  await sleep(at - performance.now());
}

type Reply = { result?: unknown; error?: { code?: number; message?: string } };
const BUSY = /request limit|rate limit|too many requests/i;
type Options = { tag?: Tag | undefined; want?: (result: unknown) => boolean };

// Asks the RPCs in turn until one gives an answer it `want`s, by default not null. When none does, the last answer
// they gave is taken if not null. Those busy or out of reach are asked again, up to three more times, a little later.
export function rpc<T>(method: string, params: unknown[], { tag, want = (r) => r !== null }: Options = {}): Promise<T> {
  const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method, params });
  return inSlot(tag, async () => {
    if (globalThis.navigator?.onLine === false) throw new Error("Offline.");
    let urls = RPCS;
    let last: unknown = null;
    for (let attempt = 0; attempt < 4 && urls.length; attempt++) {
      const busy: string[] = [];
      for (const url of [...urls].sort((a, b) => (restUntil.get(a) ?? 0) - (restUntil.get(b) ?? 0))) {
        await pace(url, method === "eth_getLogs");
        let reply: Reply | undefined;
        try {
          const response = await fetch(url, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body,
            signal: AbortSignal.timeout(5_000),
          });
          if (response.status === 429 || response.status >= 500) throw new Error("Busy.");
          reply = (await response.json()) as Reply;
          if (typeof reply !== "object" || reply === null) throw new Error("Not JSON-RPC.");
        } catch {
          // Busy, out of reach, too slow, or answering other than JSON-RPC.
          busy.push(url);
          continue;
        }
        if ("result" in reply && want(reply.result)) return reply.result as T;
        if ("result" in reply) last = reply.result ?? last;
        else if (reply.error?.code === 429 || BUSY.test(reply.error?.message ?? "")) busy.push(url);
      }
      for (const url of busy) restUntil.set(url, performance.now() + 1_000);
      urls = busy;
      if (busy.length) await sleep(Math.random() * 250 * 2 ** attempt);
    }
    if (last !== null) return last as T;
    throw new Error(`No Base RPC answered ${method}.`);
  });
}

type ReadOptions = { block?: number | "latest"; tag?: Tag | undefined; perBatch?: number };
export type Read = (calls: Call[], options?: ReadOptions) => Promise<unknown[]>;
// Reads contracts through Multicall3, in batches of `perBatch`, as each eth_call runs within its own gas limit. A call
// that fails reads as undefined.
export async function read(
  calls: Call[],
  { block = "latest", tag, perBatch = 200 }: ReadOptions = {},
): Promise<unknown[]> {
  const batches: Promise<unknown[]>[] = [];
  for (let i = 0; i < calls.length; i += perBatch) batches.push(aggregate(calls.slice(i, i + perBatch), block, tag));
  return (await Promise.all(batches)).flat();
}
async function aggregate(calls: Call[], block: number | "latest", tag: Tag | undefined): Promise<unknown[]> {
  const data = encodeFunctionData({
    abi: multicall3Abi,
    functionName: "aggregate3",
    args: [calls.map((c) => ({ target: c.address, allowFailure: true, callData: encodeFunctionData(c as never) }))],
  });
  const at = block === "latest" ? block : numberToHex(block);
  const reply = await rpc<Hex>("eth_call", [{ to: MULTICALL3, data }, at], { tag });
  return decodeFunctionResult({ abi: multicall3Abi, functionName: "aggregate3", data: reply }).map(
    ({ success, returnData }, i) => {
      if (!success || returnData === "0x") return undefined;
      try {
        return decodeFunctionResult({ ...calls[i]!, data: returnData } as never);
      } catch {
        return undefined;
      }
    },
  );
}
export const tagged =
  (tag: Tag): Read =>
  (calls, options) =>
    read(calls, { ...options, tag });
// Throws unless every call was read.
export function required<T>(values: (T | undefined)[]): T[] {
  if (values.includes(undefined)) throw new Error("A read from Base failed.");
  return values as T[];
}

export const implementation = async (proxy: Address): Promise<Address> =>
  `0x${(await rpc<Hex>("eth_getStorageAt", [proxy, "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc", "latest"])).slice(-40)}`;

export type Tx = { to: Address; data: Hex };
// Runs the calls in order on the latest block, without checks such as gas or balance.
export async function simulate(from: Address, txs: Tx[]): Promise<{ ok: boolean; returnData: Hex; gas: bigint }[]> {
  type Simulated = { calls: { status: Hex; returnData: Hex; gasUsed: Hex }[] }[];
  const calls = txs.map(({ to, data }) => ({ from, to, data }));
  const [block] = await rpc<Simulated>("eth_simulateV1", [
    { blockStateCalls: [{ calls }], validation: false },
    "latest",
  ]);
  return block!.calls.map(({ status, returnData, gasUsed }) => ({
    ok: status === "0x1",
    returnData,
    gas: BigInt(gasUsed),
  }));
}

export type Receipt = {
  transactionHash: Hex;
  status: Hex;
  from: Address;
  logs: { address: Address; data: Hex; topics: Hex[] }[];
  blockNumber: Hex;
  gasUsed: Hex;
  effectiveGasPrice?: Hex;
  l1Fee?: Hex;
};
// The receipt, or undefined if Base has not included the transaction within ten minutes.
export async function waitForReceipt(hash: Hex): Promise<Receipt | undefined> {
  for (const end = Date.now() + 600_000; Date.now() < end; await sleep(2_000)) {
    const receipt = await rpc<Receipt | null>("eth_getTransactionReceipt", [hash], { want: () => true }).catch(
      () => null,
    );
    if (receipt) return receipt;
  }
}
// When Base included the last of the receipts.
export async function includedAt(receipts: Receipt[]): Promise<number | undefined> {
  const block = receipts.at(-1)?.blockNumber;
  const found = block && (await rpc<{ timestamp: Hex }>("eth_getBlockByNumber", [block, false]).catch(() => undefined));
  return found ? Number(found.timestamp) : undefined;
}
// What the transactions cost, L1 fee included, if `from` sent and paid for each: not a bundler or a sponsor.
export async function gasPaid(hashes: Hex[], from: Address): Promise<bigint | undefined> {
  const receipts = await Promise.all(
    [...new Set(hashes)].map((hash) => rpc<Receipt>("eth_getTransactionReceipt", [hash]).catch(() => undefined)),
  );
  let wei = 0n;
  for (const receipt of receipts) {
    if (!receipt?.effectiveGasPrice || !same(receipt.from, from)) return undefined;
    wei += BigInt(receipt.gasUsed) * BigInt(receipt.effectiveGasPrice) + BigInt(receipt.l1Fee ?? 0);
  }
  return receipts.length ? wei : undefined;
}

// The gas price, and the tip the page asks for, at most 1 gwei: above it, Aero's classic pools tax a swap.
const MAX_TIP = 1_000_000_000n;
export type Costs = { gasPrice: bigint; tip?: bigint | undefined };
export async function readCosts(): Promise<Costs> {
  const [gasPrice, tip] = await Promise.all([
    rpc<Hex>("eth_gasPrice", []),
    rpc<Hex>("eth_maxPriorityFeePerGas", []).catch(() => undefined),
  ]);
  return {
    gasPrice: BigInt(gasPrice),
    tip: tip === undefined ? undefined : BigInt(tip) < MAX_TIP ? BigInt(tip) : MAX_TIP,
  };
}
export const costs = (): Promise<Costs> => memo("costs", readCosts, 60_000);
