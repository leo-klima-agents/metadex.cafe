import { decodeFunctionResult, encodeFunctionData, numberToHex, type Abi, type Address, type Hex } from "viem";
import { ABI, MULTICALL3, RPCS } from "./config.ts";
import { memo, same, sleep } from "./util.ts";

export type Call = { address: Address; abi: Abi; functionName: string; args: unknown[] };
export const call = (address: Address, abi: Abi, functionName: string, ...args: unknown[]): Call => ({
  address,
  abi,
  functionName,
  args,
});
export const blockTime = call(MULTICALL3, ABI.multicall3, "getCurrentBlockTimestamp");

export function required<T>(values: (T | undefined)[]): T[] {
  if (values.includes(undefined)) throw new Error("A read from Base failed.");
  return values as T[];
}

// Base's clock, from the newest block seen, in case the device's is off.
let drift = 0;
let newest = 0;
export function sawBlock(time: number): void {
  if (time < newest) return;
  newest = time;
  drift = time - Math.floor(Date.now() / 1000);
}
export const now = (): number => Math.floor(Date.now() / 1000) + drift;

// Each RPC gets 25 requests a second, 5 of them for logs; one that refuses gets half as many, then a quarter more back
// for each answer, so background work can plan by rate().
type Kind = "all" | "logs";
const MOST: Record<Kind, number> = { all: 25, logs: 5 };
const limits = new Map<string, { limit: number; starts: number[]; rest: number }>();
const limitOf = (url: string, kind: Kind) => {
  const name = `${url} ${kind}`;
  if (!limits.has(name)) limits.set(name, { limit: MOST[kind], starts: [], rest: 0 });
  return limits.get(name)!;
};
const kinds = (kind: Kind): Kind[] => (kind === "logs" ? ["all", "logs"] : ["all"]);

function freeAt(url: string, kind: Kind, time: number): number {
  let at = time;
  for (const each of kinds(kind)) {
    const limit = limitOf(url, each);
    limit.starts = limit.starts.filter((start) => start > time - 1_000);
    const whole = Math.max(1, Math.floor(limit.limit));
    at = Math.max(at, limit.rest, limit.starts.length >= whole ? limit.starts.at(-whole)! + 1_000 : 0);
  }
  return at;
}

export const rate = (): number =>
  RPCS.reduce((total, url) => {
    const limit = limitOf(url, "all");
    return total + (limit.rest > performance.now() ? 0 : Math.floor(limit.limit));
  }, 0);

// Once every RPC went unanswered three times in a row, for two requests or more, as offline, every request fails at once
// for ten seconds, so the page soon says reading Base failed.
const CUT_OFF = 10_000;
const unanswered = new Map<string, { count: number; bodies: Set<string> }>();
let reached = false;
let cutUntil = 0;
export class Unreachable extends Error {}

function heard(url: string, body: string, answered: boolean): void {
  if (answered) {
    reached = true;
    unanswered.clear();
    cutUntil = 0;
    return;
  }
  const run = unanswered.get(url) ?? { count: 0, bodies: new Set() };
  run.count++;
  run.bodies.add(body);
  unanswered.set(url, run);
  const out = RPCS.every((each) => (unanswered.get(each)?.count ?? 0) >= 3 && unanswered.get(each)!.bodies.size >= 2);
  if (out && (reached || navigator.onLine === false)) cutUntil = performance.now() + CUT_OFF;
}

// Reads for what the page shows go first: 6 in flight, at most 3 of them for other pages, so its own find slots free.
export type Topic = "earnings" | "shares" | "payouts" | "swap";
type For = Topic[] | undefined;
let shown = new Set<Topic>();
const first = (topics: For) => !topics || topics.some((topic) => shown.has(topic));
let running = 0;
let behind = 0;
const waiting: { topics: For; go: (behind: boolean) => void }[] = [];

function start(topics: For): boolean {
  const back = !first(topics);
  running++;
  if (back) behind++;
  return back;
}
const takeSlot = (topics: For): Promise<boolean> =>
  running < 6 && (first(topics) || behind < 3)
    ? Promise.resolve(start(topics))
    : new Promise((go) => waiting.push({ topics, go }));
function startWaiting(): void {
  while (running < 6) {
    const own = waiting.findIndex(({ topics }) => first(topics));
    const i = own >= 0 ? own : behind < 3 && waiting.length ? 0 : -1;
    if (i < 0) return;
    const [next] = waiting.splice(i, 1);
    next!.go(start(next!.topics));
  }
}
function freeSlot(back: boolean): void {
  running--;
  if (back) behind--;
  startWaiting();
}
export function showTopics(topics: Topic[]): void {
  shown = new Set(topics);
  startWaiting();
}

const BUSY = /request limit|rate limit|too many requests/i;
const BUSY_CODES = [429, -32005, -32007, -32011, -32090];
type Accept = (result: unknown) => boolean;
// `accept` rejects an answer, and the next RPC is asked; a `doubt`ful one is taken only if no RPC answers otherwise.
export type Options = { topics?: Topic[]; accept?: Accept; doubt?: Accept };
type Outcome = { result: unknown } | { busy: boolean; reached: boolean };

async function askOne(url: string, body: string, accept: Accept): Promise<Outcome> {
  let busy = false;
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
      signal: AbortSignal.timeout(5_000),
    });
    busy = response.status === 429 || response.status >= 500;
    const reply = (await response.json()) as { result?: unknown; error?: { code?: number; message?: string } } | null;
    if (reply?.result !== undefined)
      return accept(reply.result) ? { result: reply.result } : { busy: false, reached: true };
    const { code = 0, message = "" } = reply?.error ?? {};
    return { busy: busy || BUSY_CODES.includes(code) || BUSY.test(message), reached: true };
  } catch (error) {
    // A network error is retried, and leaves the RPC unreached; a timeout or a reply that is not JSON is neither.
    const network = error instanceof TypeError;
    return { busy: busy || network, reached: busy || !network };
  }
}

// Each RPC at most once, the first free first; while none is, the slot goes to others.
async function askEach(urls: string[], kind: Kind, body: string, options: Options) {
  const { topics, accept = (result) => result !== null, doubt } = options;
  const left = [...urls];
  const busy: string[] = [];
  let doubted: { result: unknown } | undefined;
  let back = await takeSlot(topics);
  try {
    while (left.length) {
      if (performance.now() < cutUntil) throw new Unreachable("No Base RPC can be reached.");
      const time = performance.now();
      const free = left.map((url) => freeAt(url, kind, time));
      const i = free.findIndex((at) => at <= time);
      if (i < 0) {
        freeSlot(back);
        await sleep(Math.min(...free) - time);
        back = await takeSlot(topics);
        continue;
      }
      const [url] = left.splice(i, 1) as [string];
      for (const each of kinds(kind)) limitOf(url, each).starts.push(time);
      const outcome = await askOne(url, body, accept);
      heard(url, body, "result" in outcome || outcome.reached);
      if ("result" in outcome) {
        for (const each of kinds(kind)) {
          const limit = limitOf(url, each);
          limit.limit = Math.min(MOST[each], limit.limit + 0.25);
        }
        if (!doubt?.(outcome.result)) return { answer: outcome };
        doubted ??= outcome;
      } else if (outcome.busy) {
        busy.push(url);
        const limit = limitOf(url, kind);
        limit.rest = performance.now() + 1_000;
        limit.limit = Math.max(1, limit.limit / 2);
      }
    }
  } finally {
    freeSlot(back);
  }
  return { busy, doubted };
}

// Busy RPCs are asked again up to 4 times, after a random wait that doubles each time.
export async function rpc<T>(method: string, params: unknown[], options: Options = {}): Promise<T> {
  const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method, params });
  const kind: Kind = method === "eth_getLogs" ? "logs" : "all";
  let urls = RPCS;
  let doubted: { result: unknown } | undefined;
  for (let attempt = 0; ; attempt++) {
    const outcome = await askEach(urls, kind, body, options);
    if ("answer" in outcome) return outcome.answer.result as T;
    doubted ??= outcome.doubted;
    if (!outcome.busy.length || attempt === 4) {
      if (doubted) return doubted.result as T;
      throw new Error(`No Base RPC answered ${method}.`);
    }
    urls = outcome.busy;
    await sleep(Math.random() * 250 * 2 ** attempt);
  }
}

// Contracts through Multicall3, 200 calls a request, or fewer when each needs much gas; a failed call reads undefined.
export type Read = (calls: Call[], block?: number | "latest", perBatch?: number) => Promise<unknown[]>;
export const readFor =
  (...topics: Topic[]): Read =>
  async (calls, block = "latest", perBatch = 200) => {
    const batches = [];
    for (let i = 0; i < calls.length; i += perBatch)
      batches.push(aggregate(calls.slice(i, i + perBatch), block, topics));
    return (await Promise.all(batches)).flat();
  };
export const read: Read = readFor();

async function aggregate(calls: Call[], block: number | "latest", topics: Topic[]): Promise<unknown[]> {
  const data = encodeFunctionData({
    abi: ABI.multicall3,
    functionName: "aggregate3",
    args: [calls.map((c) => ({ target: c.address, allowFailure: true, callData: encodeFunctionData(c as never) }))],
  });
  const tag = block === "latest" ? block : numberToHex(block);
  const reply = await rpc<Hex>("eth_call", [{ to: MULTICALL3, data }, tag], topics.length ? { topics } : {});
  return decodeFunctionResult({ abi: ABI.multicall3, functionName: "aggregate3", data: reply }).map(
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

const EIP1967_SLOT = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";
export const implementation = async (proxy: Address): Promise<Address> =>
  `0x${(await rpc<Hex>("eth_getStorageAt", [proxy, EIP1967_SLOT, "latest"])).slice(-40)}`;

export type Log = { address: Address; data: Hex; topics: Hex[]; transactionHash: Hex; logIndex: Hex; blockNumber: Hex };
export type Receipt = { transactionHash: Hex; status: Hex; logs: Log[]; blockNumber?: Hex };

// Undefined if Base has not included it within ten minutes. Null means "not yet": ask again later, not another RPC.
export async function waitForReceipt(hash: Hex): Promise<Receipt | undefined> {
  for (const end = Date.now() + 600_000; Date.now() < end; await sleep(2_000)) {
    const receipt = await rpc<Receipt | null>("eth_getTransactionReceipt", [hash], { accept: () => true }).catch(
      () => null,
    );
    if (receipt) return receipt;
  }
  return undefined;
}

// What `from` paid in ETH for the transactions, L1 fee included; undefined if another paid, as a bundler or a sponsor.
export async function gasPaid(hashes: Hex[], from: Address): Promise<bigint | undefined> {
  type Paid = { from: Address; gasUsed: Hex; effectiveGasPrice?: Hex; l1Fee?: Hex };
  const found = await Promise.all(
    [...new Set(hashes)].map((hash) => rpc<Paid | null>("eth_getTransactionReceipt", [hash]).catch(() => null)),
  );
  let wei = 0n;
  for (const receipt of found) {
    if (!receipt?.effectiveGasPrice || !same(receipt.from, from)) return undefined;
    wei += BigInt(receipt.gasUsed) * BigInt(receipt.effectiveGasPrice) + BigInt(receipt.l1Fee ?? 0);
  }
  return found.length ? wei : undefined;
}

export const timeOf = memo(async (block: number) =>
  Number((await rpc<{ timestamp: Hex }>("eth_getBlockByNumber", [numberToHex(block), false])).timestamp),
);

export const logsAt = (address: Address, block: number, topics: (Hex | Hex[] | null)[], options: Options) =>
  rpc<Log[]>("eth_getLogs", [{ address, fromBlock: numberToHex(block), toBlock: numberToHex(block), topics }], options);

// What Base would do with the calls from `from`, one after another, now.
export type Simulated = { ok: boolean; returnData: Hex; gas: bigint }[];
export async function simulate(from: Address, txs: { to: Address; data: Hex }[]): Promise<Simulated> {
  const [block] = await rpc<{ calls: { status: Hex; returnData: Hex; gasUsed: Hex }[] }[]>("eth_simulateV1", [
    { blockStateCalls: [{ calls: txs.map(({ to, data }) => ({ from, to, data })) }], validation: false },
    "latest",
  ]);
  return (block?.calls ?? []).map(({ status, returnData, gasUsed }) => ({
    ok: status === "0x1",
    returnData,
    gas: BigInt(gasUsed),
  }));
}

// For tests.
export function resetRpc(): void {
  limits.clear();
  unanswered.clear();
  [reached, cutUntil, shown] = [false, 0, new Set()];
}
