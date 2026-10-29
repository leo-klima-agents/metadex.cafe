import {
  decodeFunctionResult,
  encodeFunctionData,
  numberToHex,
  parseAbi,
  type Abi,
  type Address,
  type Hex,
} from "viem";
import { MULTICALL3, RPCS } from "./config.ts";

export type Call = { address: Address; abi: Abi; functionName: string; args: unknown[] };

export const multicall3Abi = parseAbi([
  "function aggregate3((address target, bool allowFailure, bytes callData)[] calls) payable returns ((bool success, bytes returnData)[])",
  "function getCurrentBlockTimestamp() view returns (uint256 timestamp)",
]);
export const EIP1967_IMPLEMENTATION_SLOT = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";
const CALLS_PER_BATCH = 200;

// Unlike viem's isAddressEqual, this never throws, even on the undefined of a failed read.
export const same = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase();

export const call = (address: Address, abi: Abi, functionName: string, ...args: unknown[]): Call => ({
  address,
  abi,
  functionName,
  args,
});

export const blockTime = call(MULTICALL3, multicall3Abi, "getCurrentBlockTimestamp");

export function required<T>(values: (T | undefined)[]): T[] {
  if (values.includes(undefined)) throw new Error("A read from Base failed.");
  return values as T[];
}

// Base's time, from the newest block read, in case the device's clock is wrong.
let drift = 0;
let newest = 0;

export function sawBlock(time: number): void {
  if (time < newest) return;
  newest = time;
  drift = time - Math.floor(Date.now() / 1000);
}

export const now = (): number => Math.floor(Date.now() / 1000) + drift;

const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));

// mainnet.base.org allows 25 requests a second, 5 of them for logs. The other RPCs get the same limits at first. One
// that says it is over its limit gets half as many a second from then on, and a quarter of one more back for each
// request it answers, up to those: so the page learns how much each allows, and work in the background can plan for it.
const PER_SECOND = 25;
const LOGS_PER_SECOND = 5;
const REGAIN = 0.25;
// An RPC that says it is over its limit is left alone for this long.
const REST = 1_000;
const MAX_IN_FLIGHT = 6;

type Kind = "all" | "logs";
const started = new Map<string, number[]>();
const restingUntil = new Map<string, number>();
const learnt = new Map<string, number>();
const most = (kind: Kind): number => (kind === "logs" ? LOGS_PER_SECOND : PER_SECOND);
const limitOf = (url: string, kind: Kind): number => learnt.get(`${url} ${kind}`) ?? most(kind);

function freeAt(url: string, kind: Kind, time: number): number {
  const limits: [string, number][] = [[`${url} all`, limitOf(url, "all")]];
  if (kind === "logs") limits.push([`${url} logs`, limitOf(url, "logs")]);
  let at = Math.max(time, restingUntil.get(`${url} all`) ?? 0, restingUntil.get(`${url} ${kind}`) ?? 0);
  for (const [key, limit] of limits) {
    const whole = Math.max(1, Math.floor(limit));
    const lastSecond = (started.get(key) ?? []).filter((start) => start > time - 1_000);
    started.set(key, lastSecond);
    if (lastSecond.length >= whole) at = Math.max(at, lastSecond[lastSecond.length - whole]! + 1_000);
  }
  return at;
}

function refused(url: string, kind: Kind): void {
  restingUntil.set(`${url} ${kind}`, performance.now() + REST);
  learnt.set(`${url} ${kind}`, Math.max(1, limitOf(url, kind) / 2));
}

// A request for logs counts against both limits, and so gives back to both.
function answered(url: string, kind: Kind): void {
  for (const each of kind === "logs" ? (["all", "logs"] as const) : (["all"] as const)) {
    const limit = limitOf(url, each);
    if (limit < most(each)) learnt.set(`${url} ${each}`, Math.min(most(each), limit + REGAIN));
  }
}

// How many requests a second the RPCs allow between them now, as far as the page has learnt, leaving out those resting:
// what work in the background may plan for.
export function rate(): number {
  const time = performance.now();
  return RPCS.reduce(
    (sum, url) => sum + ((restingUntil.get(`${url} all`) ?? 0) > time ? 0 : Math.floor(limitOf(url, "all"))),
    0,
  );
}

function recordStart(url: string, kind: Kind, time: number): void {
  for (const key of kind === "logs" ? [`${url} all`, `${url} logs`] : [`${url} all`])
    started.set(key, [...(started.get(key) ?? []), time]);
}

// Once every RPC got no answer at all three times in a row, for two requests or more, over two seconds or more, as when
// the device is offline: the requests under way, those waiting their turn, and those that follow fail at once for a
// while, rather than each asking again for seconds, so that the page soon says that reading Base failed. A short loss of
// the network does not, nor one request that the RPCs, or a proxy before them, cut off: it fails alone, as any other.
// Then the next request is asked as usual, and any answer ends it. An RPC that is busy, or slow, can be reached. So can
// one that answered within the while: a browser tells a refusal sent without the headers that let the page read it, as
// some RPCs send when too many requests come at once, from no network at all. Before any RPC answered, as the page
// opens with a burst of reads, only the browser's word that it is offline cuts them off.
const CUT_OFF = 10_000;
const UNANSWERED = 3;
const UNANSWERED_FOR = 2_000;
// Each RPC's run of requests with no answer: how many, since when, and which, up to two; and when it last answered.
const unanswered = new Map<string, { count: number; since: number; bodies: Set<string> }>();
const reachedAt = new Map<string, number>();
let cutUntil = 0;
const cutOff = (): boolean => performance.now() < cutUntil;
const offline = (): boolean => globalThis.navigator?.onLine === false;

function reachedOrNot(url: string, body: string, reached: boolean): void {
  const time = performance.now();
  if (reached) {
    reachedAt.set(url, time);
    unanswered.clear();
    cutUntil = 0;
    return;
  }
  if (time - (reachedAt.get(url) ?? -Infinity) < CUT_OFF) return;
  const run = unanswered.get(url) ?? { count: 0, since: time, bodies: new Set() };
  run.count++;
  if (run.bodies.size < 2) run.bodies.add(body);
  unanswered.set(url, run);
  const out = (each: string) => {
    const { count = 0, since = time, bodies = new Set() } = unanswered.get(each) ?? {};
    return count >= UNANSWERED && bodies.size >= 2 && time - since >= UNANSWERED_FOR;
  };
  if (RPCS.every(out) && (reachedAt.size > 0 || offline())) cutUntil = time + CUT_OFF;
}
export class Unreachable extends Error {
  constructor() {
    super("No Base RPC can be reached.");
  }
}

// For tests.
export function resetRateLimits(): void {
  started.clear();
  restingUntil.clear();
  learnt.clear();
  unanswered.clear();
  reachedAt.clear();
  cutUntil = 0;
}

let running = 0;
const waiting = { now: [] as (() => void)[], later: [] as (() => void)[] };

async function takeSlot(later: boolean): Promise<void> {
  if (running < MAX_IN_FLIGHT) running++;
  else await new Promise<void>((go) => waiting[later ? "later" : "now"].push(go));
}

function freeSlot(): void {
  const next = waiting.now.shift() ?? waiting.later.shift();
  if (next) next();
  else running--;
}

// When no RPC answers, those that were busy or out of reach are asked again, up to RETRIES times, after a random wait
// that doubles each time. Errors that would come back the same, such as a revert or a timeout, are not retried.
const RETRIES = 4;
const BACKOFF = 250;
const BUSY_CODES = [429, -32005, -32007, -32011, -32090];
const BUSY = /request limit|rate limit|too many requests/i;

type Reply = { result?: unknown; error?: { code?: number; message?: string } } | null;
type Answer = { answered: true; result: unknown };
// By default, null is not an answer: the RPC may not have the block or transaction yet, so the next one is asked.
type Accept = (result: unknown) => boolean;
const notNull: Accept = (result) => result !== null;
// A doubtful answer, such as no logs where some are expected but not certain, is taken only once no RPC answers
// otherwise: an RPC that is behind, or that lost some logs, answers the same.
type Options = { later?: boolean; accept?: Accept; doubt?: Accept };
type Doubted = { result: unknown } | undefined;

type Unanswered = { answered: false; busy: boolean; reached: boolean };
async function askOne(url: string, body: string, accept: Accept): Promise<Answer | Unanswered> {
  let busy = false;
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
      signal: AbortSignal.timeout(5_000),
    });
    busy = response.status === 429 || response.status >= 500;
    const reply = (await response.json()) as Reply;
    const result = reply?.result;
    if (result !== undefined)
      return accept(result) ? { answered: true, result } : { answered: false, busy: false, reached: true };
    const { code = 0, message = "" } = reply?.error ?? {};
    return { answered: false, busy: busy || BUSY_CODES.includes(code) || BUSY.test(message), reached: true };
  } catch (error) {
    // A network error is retried. A timeout, or a reply that is not JSON, is not. Only a network error with no answer
    // at all leaves the RPC unreached.
    const unreached = !busy && error instanceof TypeError;
    return { answered: false, busy: busy || error instanceof TypeError, reached: !unreached };
  }
}

// Asks each RPC at most once, the first free one first. While none is free, the slot goes to other requests.
async function askEach(
  urls: string[],
  method: string,
  body: string,
  { later = false, accept = notNull, doubt }: Options,
): Promise<Answer | { answered: false; busy: string[]; doubted: Doubted }> {
  const kind: Kind = method === "eth_getLogs" ? "logs" : "all";
  const left = [...urls];
  const busy: string[] = [];
  let doubted: Doubted;
  await takeSlot(later);
  try {
    while (left.length) {
      if (cutOff()) throw new Unreachable();
      const time = performance.now();
      const free = left.map((url) => freeAt(url, kind, time));
      const i = free.findIndex((at) => at <= time);
      if (i < 0) {
        freeSlot();
        await sleep(Math.min(...free) - time);
        await takeSlot(later);
        continue;
      }
      const [url] = left.splice(i, 1) as [string];
      recordStart(url, kind, time);
      const outcome = await askOne(url, body, accept);
      reachedOrNot(url, body, outcome.answered || outcome.reached);
      if (outcome.answered) answered(url, kind);
      if (outcome.answered && doubt?.(outcome.result)) doubted ??= { result: outcome.result };
      else if (outcome.answered) return outcome;
      else if (outcome.busy) {
        busy.push(url);
        refused(url, kind);
      }
    }
  } finally {
    freeSlot();
  }
  return { answered: false, busy, doubted };
}

export async function rpc<T>(method: string, params: unknown[], options: Options = {}): Promise<T> {
  if (cutOff()) throw new Unreachable();
  const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method, params });
  let urls = RPCS;
  let doubted: Doubted;
  for (let attempt = 0; ; attempt++) {
    const outcome = await askEach(urls, method, body, options);
    if (outcome.answered) return outcome.result as T;
    const { busy } = outcome;
    doubted ??= outcome.doubted;
    if (!busy.length || attempt === RETRIES) {
      if (doubted) return doubted.result as T;
      throw new Error(`No Base RPC answered ${method}.`);
    }
    urls = RPCS.filter((url) => busy.includes(url));
    await sleep(Math.random() * BACKOFF * 2 ** attempt);
  }
}

// Reads contracts through Multicall3. A call that fails reads as undefined. Calls that each need much gas go in smaller
// batches, `perBatch`, as an RPC runs each batch within its own gas limit for eth_call.
export async function read(
  calls: Call[],
  block: number | "latest" = "latest",
  later = false,
  perBatch = CALLS_PER_BATCH,
): Promise<unknown[]> {
  const batches: Promise<unknown[]>[] = [];
  for (let i = 0; i < calls.length; i += perBatch) {
    batches.push(aggregate(calls.slice(i, i + perBatch), block, later));
  }
  return (await Promise.all(batches)).flat();
}

// The same, after the page's own reads.
export const readLater: typeof read = (calls, block = "latest", _later, perBatch) => read(calls, block, true, perBatch);

async function aggregate(calls: Call[], block: number | "latest", later: boolean): Promise<unknown[]> {
  const data = encodeFunctionData({
    abi: multicall3Abi,
    functionName: "aggregate3",
    args: [calls.map((c) => ({ target: c.address, allowFailure: true, callData: encodeFunctionData(c as never) }))],
  });
  const tag = block === "latest" ? block : numberToHex(block);
  const reply = await rpc<Hex>("eth_call", [{ to: MULTICALL3, data }, tag], { later });
  const results = decodeFunctionResult({ abi: multicall3Abi, functionName: "aggregate3", data: reply });
  return results.map(({ success, returnData }, i) => {
    if (!success || returnData === "0x") return undefined;
    try {
      return decodeFunctionResult({ ...calls[i]!, data: returnData } as never);
    } catch {
      return undefined;
    }
  });
}

export const implementation = async (proxy: Address): Promise<Address> =>
  `0x${(await rpc<Hex>("eth_getStorageAt", [proxy, EIP1967_IMPLEMENTATION_SLOT, "latest"])).slice(-40)}`;

// A transaction's receipt: whether it succeeded, its logs, and the block that included it.
export type Receipt = {
  transactionHash: Hex;
  status: Hex;
  logs: { address: Address; data: Hex; topics: Hex[] }[];
  blockNumber?: Hex;
};

// The transaction's receipt, or undefined if Base has not included it within ten minutes.
export async function waitForReceipt(hash: Hex): Promise<Receipt | undefined> {
  const end = Date.now() + 10 * 60_000;
  while (Date.now() < end) {
    // A null receipt means "not included yet": ask again later, not another RPC.
    const receipt = await rpc<Receipt | null>("eth_getTransactionReceipt", [hash], {
      accept: () => true,
    }).catch(() => null);
    if (receipt) return receipt;
    await sleep(2_000);
  }
  return undefined;
}

// When Base included the last of the transactions: its block's time, or undefined if it cannot be read.
export async function includedAt(receipts: Receipt[]): Promise<number | undefined> {
  const block = receipts.at(-1)?.blockNumber;
  if (!block) return undefined;
  const found = await rpc<{ timestamp: Hex } | null>("eth_getBlockByNumber", [block, false]).catch(() => null);
  return found?.timestamp ? Number(found.timestamp) : undefined;
}

// What the transactions cost in ETH, Base's L1 fee included, if `from` sent and paid for each of them: undefined when
// one cannot be read, or another sent it, as the bundler of a smart account's batch, or a sponsor.
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
