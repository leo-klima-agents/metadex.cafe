import {
  decodeFunctionResult,
  encodeFunctionData,
  keccak256,
  numberToHex,
  parseAbi,
  type Abi,
  type Address,
  type Hex,
} from "viem";
import { MULTICALL3, RPCS } from "./config.ts";

export type Call = { address: Address; abi: Abi; functionName: string; args: unknown[] };

const multicall3Abi = parseAbi([
  "function aggregate3((address target, bool allowFailure, bytes callData)[] calls) payable returns ((bool success, bytes returnData)[])",
  "function getCurrentBlockTimestamp() view returns (uint256 timestamp)",
]);
const EIP1967_IMPLEMENTATION_SLOT = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";
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

// mainnet.base.org allows 25 requests a second, 5 of them for logs. The other RPCs get the same limits.
const PER_SECOND = 25;
const LOGS_PER_SECOND = 5;
// An RPC that says it is over its limit is left alone for this long.
const REST = 1_000;
const MAX_IN_FLIGHT = 6;

type Kind = "all" | "logs";
const started = new Map<string, number[]>();
const restingUntil = new Map<string, number>();

function freeAt(url: string, kind: Kind, time: number): number {
  const limits: [string, number][] = [[`${url} all`, PER_SECOND]];
  if (kind === "logs") limits.push([`${url} logs`, LOGS_PER_SECOND]);
  let at = Math.max(time, restingUntil.get(`${url} all`) ?? 0, restingUntil.get(`${url} ${kind}`) ?? 0);
  for (const [key, limit] of limits) {
    const lastSecond = (started.get(key) ?? []).filter((start) => start > time - 1_000);
    started.set(key, lastSecond);
    if (lastSecond.length >= limit) at = Math.max(at, lastSecond[lastSecond.length - limit]! + 1_000);
  }
  return at;
}

function recordStart(url: string, kind: Kind, time: number): void {
  for (const key of kind === "logs" ? [`${url} all`, `${url} logs`] : [`${url} all`])
    started.set(key, [...(started.get(key) ?? []), time]);
}

// For tests.
export function resetRateLimits(): void {
  started.clear();
  restingUntil.clear();
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

async function askOne(url: string, body: string, accept: Accept): Promise<Answer | { answered: false; busy: boolean }> {
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
    if (result !== undefined) return accept(result) ? { answered: true, result } : { answered: false, busy: false };
    const { code = 0, message = "" } = reply?.error ?? {};
    return { answered: false, busy: busy || BUSY_CODES.includes(code) || BUSY.test(message) };
  } catch (error) {
    // A network error is retried. A timeout, or a reply that is not JSON, is not.
    return { answered: false, busy: busy || error instanceof TypeError };
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
      if (outcome.answered && doubt?.(outcome.result)) doubted ??= { result: outcome.result };
      else if (outcome.answered) return outcome;
      else if (outcome.busy) {
        busy.push(url);
        restingUntil.set(`${url} ${kind}`, performance.now() + REST);
      }
    }
  } finally {
    freeSlot();
  }
  return { answered: false, busy, doubted };
}

export async function rpc<T>(method: string, params: unknown[], options: Options = {}): Promise<T> {
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

export const codeHash = async (address: Address): Promise<Hex> =>
  keccak256(await rpc<Hex>("eth_getCode", [address, "latest"]));

export const implementation = async (proxy: Address): Promise<Address> =>
  `0x${(await rpc<Hex>("eth_getStorageAt", [proxy, EIP1967_IMPLEMENTATION_SLOT, "latest"])).slice(-40)}`;

// Whether the transaction succeeded, or undefined if Base has not included it within ten minutes.
export async function waitForTransaction(hash: Hex): Promise<boolean | undefined> {
  const end = Date.now() + 10 * 60_000;
  while (Date.now() < end) {
    // A null receipt means "not included yet": ask again later, not another RPC.
    const receipt = await rpc<{ status: Hex } | null>("eth_getTransactionReceipt", [hash], {
      accept: () => true,
    }).catch(() => null);
    if (receipt) return receipt.status === "0x1";
    await sleep(2_000);
  }
  return undefined;
}
