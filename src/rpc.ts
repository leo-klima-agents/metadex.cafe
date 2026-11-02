import {
  decodeFunctionResult,
  encodeFunctionData,
  multicall3Abi,
  numberToHex,
  type Abi,
  type Address,
  type ContractFunctionArgs,
  type ContractFunctionName,
  type ContractFunctionReturnType,
  type Hex,
  type RpcBlock,
  type RpcLog,
  type WalletCallReceipt,
} from "viem";
import type { OpStackRpcTransactionReceipt } from "viem/chains";
import { memo, use, type Got } from "./cache.ts";
import { MULTICALL3, RPCS } from "./config.ts";

export type Call<A extends Abi = Abi, N extends string = string> = {
  address: Address;
  abi: A;
  functionName: N;
  args: readonly unknown[];
};
// `eth_call` can run any function, not only views, so reads accept every mutability.
type Mutability = "pure" | "view" | "nonpayable" | "payable";
type Args<A extends Abi, N extends ContractFunctionName<A>> =
  ContractFunctionArgs<A, Mutability, N> extends infer T extends readonly unknown[] ? T : never;
type Result<C> =
  C extends Call<infer A, infer N>
    ? N extends ContractFunctionName<A>
      ? ContractFunctionReturnType<A, Mutability, N>
      : unknown
    : unknown;
export const call = <const A extends Abi, N extends ContractFunctionName<A>>(
  address: Address,
  abi: A,
  functionName: N,
  ...args: Args<A, N>
): Call<A, N> => ({ address, abi, functionName, args });
export const contract =
  <const A extends Abi>(address: Address, abi: A) =>
  <N extends ContractFunctionName<A>>(functionName: N, ...args: Args<A, N>): Call<A, N> =>
    call(address, abi, functionName, ...args);
// Compares addresses in any case. Unlike viem's `isAddressEqual`, it never throws on a string that isn't an address.
export const same = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase();
const sleep = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms));

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

// What a read is for. Reads with no tag, or with a tag the shown page draws, go first. The rest read ahead for other
// pages and take at most `BEHIND` of the `MAX` slots.
export type Tag = "earnings" | "average" | "shares" | "payouts" | "swap";
const MAX = 6;
const BEHIND = 4;
let shown = new Set<Tag>();
let running = 0;
let behind = 0;
const queue: { tag: Tag | undefined; go: (back: boolean) => void }[] = [];
const first = (tag?: Tag): boolean => !tag || shown.has(tag);

export function showTags(tags: Tag[]): void {
  shown = new Set(tags);
  pump();
}
function pump(): void {
  while (running < MAX) {
    let i = queue.findIndex(({ tag }) => first(tag));
    if (i < 0 && queue.length && behind < BEHIND) i = 0;
    if (i < 0) return;
    const [next] = queue.splice(i, 1);
    const back = !first(next!.tag);
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

// Each RPC gets at most 25 requests a second, 5 of them for logs. One that is busy or out of reach rests for a second.
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
type Options<T> = { tag?: Tag | undefined; want?: (result: T) => boolean };

// Asks the RPCs in turn until one gives an answer that passes `want` (by default, any answer but null). If none does,
// returns the last non-null answer. RPCs that were busy or out of reach are asked again a little later, up to three
// more times.
export function rpc<T>(
  method: string,
  params: unknown[],
  { tag, want = (r) => r !== null }: Options<T> = {},
): Promise<T> {
  const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method, params });
  return inSlot(tag, async () => {
    if (globalThis.navigator?.onLine === false) throw new Error("Offline.");
    let urls = RPCS;
    let last: T | null = null;
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
          busy.push(url);
          continue;
        }
        if ("result" in reply) {
          const result = reply.result as T;
          if (want(result)) return result;
          last = result ?? last;
        } else if (reply.error?.code === 429 || BUSY.test(reply.error?.message ?? "")) busy.push(url);
      }
      for (const url of busy) restUntil.set(url, performance.now() + 1_000);
      urls = busy;
      if (busy.length) await sleep(Math.random() * 250 * 2 ** attempt);
    }
    if (last !== null) return last;
    throw new Error(`No Base RPC answered ${method}.`);
  });
}

type ReadOptions = { block?: number | "latest"; tag?: Tag | undefined; perBatch?: number };
// Each call's result, as its ABI types it, or undefined if it failed.
type Results<C extends readonly Call[]> = { -readonly [K in keyof C]: Result<C[K]> | undefined };
export type Read = <const C extends readonly Call[]>(calls: C, options?: ReadOptions) => Promise<Results<C>>;
// Reads through Multicall3 in batches of `perBatch`, because each `eth_call` has its own gas limit.
export const read: Read = async (calls, { block = "latest", tag, perBatch = 200 } = {}) => {
  const batches: Promise<unknown[]>[] = [];
  for (let i = 0; i < calls.length; i += perBatch) batches.push(aggregate(calls.slice(i, i + perBatch), block, tag));
  return (await Promise.all(batches)).flat() as never;
};
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
// What one of an item's calls returned, or undefined if it failed or was not asked.
type Field<F> = F extends (item: never) => infer C ? Result<C> | undefined : undefined;
// Reads some calls of every item together. Each item comes back with its calls' results by field name, so nothing is
// matched up by index. A field set to `undefined` is not read.
export async function readEach<T, F extends Record<string, ((item: T) => Call) | undefined>>(
  items: readonly T[],
  fields: F,
  rd: Read = read,
  options?: ReadOptions,
): Promise<({ item: T } & { [K in keyof F]: Field<F[K]> })[]> {
  const asked = Object.entries(fields).flatMap(([name, of]) => (of ? [[name, of] as const] : []));
  const all: unknown[] = await rd(
    asked.flatMap(([, of]) => items.map((item) => of(item))),
    options,
  );
  return items.map((item, i) => ({
    item,
    ...Object.fromEntries(asked.map(([name], n) => [name, all[n * items.length + i]])),
  })) as never;
}
// Throws unless every call was read.
export function required<const T extends readonly unknown[]>(
  values: T,
): { -readonly [K in keyof T]: Exclude<T[K], undefined> } {
  if (values.includes(undefined)) throw new Error("A read from Base failed.");
  return values as never;
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

type Receipt = OpStackRpcTransactionReceipt;
// The fields every receipt has, wherever it comes from: a wallet's receipt, from EIP-5792's `wallet_getCallsStatus`,
// has no more.
export type Landed = WalletCallReceipt;
// The receipts' logs, typed for `parseEventLogs`. A wallet's logs hold only address, data and topics, which is enough
// to decode their events, but not the block and index that an RPC's logs also hold.
export const logsIn = (receipts: Pick<Landed, "logs">[]): RpcLog[] => receipts.flatMap(({ logs }) => logs) as RpcLog[];
export async function poll<T>(ask: () => Promise<T | undefined>): Promise<T | undefined> {
  for (const end = Date.now() + 600_000; Date.now() < end; await sleep(2_000)) {
    const answer = await ask();
    if (answer !== undefined) return answer;
  }
}
// The receipt, or undefined if Base has not included the transaction within ten minutes.
export const waitForReceipt = (hash: Hex): Promise<Receipt | undefined> =>
  poll(() =>
    rpc<Receipt | null>("eth_getTransactionReceipt", [hash], { want: () => true }).then(
      (receipt) => receipt ?? undefined,
      () => undefined,
    ),
  );
export async function includedAt(receipts: Landed[]): Promise<number | undefined> {
  const block = receipts.at(-1)?.blockNumber;
  const found = block && (await rpc<RpcBlock>("eth_getBlockByNumber", [block, false]).catch(() => undefined));
  return found ? Number(found.timestamp) : undefined;
}
// What the transactions cost in wei, L1 fee included, or `undefined` unless `from` sent and paid for every one, rather
// than a bundler or a sponsor.
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

// The gas price and the tip to ask for. The tip is capped at 1 gwei because Aero's basic pools tax a swap that tips more.
const MAX_TIP = 1_000_000_000n;
export type Costs = { gasPrice: bigint; tip?: bigint | undefined };
async function readCosts(): Promise<Costs> {
  const [gasPrice, tip] = await Promise.all([
    rpc<Hex>("eth_gasPrice", []),
    rpc<Hex>("eth_maxPriorityFeePerGas", []).catch(() => undefined),
  ]);
  return {
    gasPrice: BigInt(gasPrice),
    tip: tip === undefined ? undefined : BigInt(tip) < MAX_TIP ? BigInt(tip) : MAX_TIP,
  };
}
export const costs = (): Got<Costs> => use("costs", readCosts, 60_000);
export const costsRead = (): Promise<Costs> => memo("costs", readCosts, 60_000);
