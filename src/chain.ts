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
const CHUNK = 200;

// Unlike viem's isAddressEqual, it never throws, as on the undefined of a read that failed.
export const same = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase();

export const call = (address: Address, abi: Abi, functionName: string, ...args: unknown[]): Call => ({
  address,
  abi,
  functionName,
  args,
});

export const blockTime = call(MULTICALL3, multicall3Abi, "getCurrentBlockTimestamp");

const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));

// What each RPC is asked in any second, at most: mainnet.base.org allows a visitor 25 requests, of which 5 eth_getLogs,
// and says so when it refuses one. The other two publish no figure a second, and are held to the same.
const PER_SECOND = 25;
const LOGS_PER_SECOND = 5;
// An RPC that refuses for its limits is left alone for a second, mainnet.base.org's window, by every request of that
// kind: they go to the next RPC instead, or wait for it if none is free.
const REST = 1_000;
// Requests in flight at once. The page's own reads go first; reads in the background, such as the receipts' search or
// all of Hydrex, wait for them.
const AT_ONCE = 6;

type Kind = "all" | "logs";
const started = new Map<string, number[]>();
const resting = new Map<string, number>();

// When the RPC can take a request of this kind, at the earliest: once it has rested, and once the requests of the last
// second number fewer than its limits.
function freeAt(url: string, kind: Kind, now: number): number {
  const limits: [string, number][] = [[`${url} all`, PER_SECOND]];
  if (kind === "logs") limits.push([`${url} logs`, LOGS_PER_SECOND]);
  let at = Math.max(now, resting.get(`${url} all`) ?? 0, resting.get(`${url} ${kind}`) ?? 0);
  for (const [key, limit] of limits) {
    const times = (started.get(key) ?? []).filter((time) => time > now - 1_000);
    started.set(key, times);
    if (times.length >= limit) at = Math.max(at, times[times.length - limit]! + 1_000);
  }
  return at;
}

// For tests: what the RPCs were asked, and which rest.
export function forgetLimits(): void {
  started.clear();
  resting.clear();
}

function start(url: string, kind: Kind, now: number): void {
  for (const key of kind === "logs" ? [`${url} all`, `${url} logs`] : [`${url} all`])
    started.set(key, [...(started.get(key) ?? []), now]);
}

let running = 0;
const waiting = { now: [] as (() => void)[], later: [] as (() => void)[] };

async function take(later: boolean): Promise<void> {
  if (running < AT_ONCE) running++;
  else await new Promise<void>((go) => waiting[later ? "later" : "now"].push(go));
}

function give(): void {
  const next = waiting.now.shift() ?? waiting.later.shift();
  if (next) next();
  else running--;
}

// When no RPC answers and one of them was busy or out of reach, the request is asked again after a truncated exponential
// backoff with full jitter, as RPC providers advise: up to RETRIES times, at random within 250 ms, 500 ms, 1 s and 2 s.
// What an RPC would answer the same again, such as a call that reverts, a block it does not keep or a request too slow
// for it, goes to the next RPC but is not asked again.
const RETRIES = 4;
const BACKOFF = 250;
const BUSY_CODES = [429, -32005, -32007, -32011, -32090];
const BUSY = /request limit|rate limit|too many requests/i;

type Reply = { result?: unknown; error?: { code?: number; message?: string } } | null;
type Answer = { answered: true; result: unknown };
type Outcome = Answer | { answered: false; busy: boolean };
// What a caller takes as an answer. An RPC answers null for a block or a transaction it does not have yet: by default,
// the next RPC is asked.
type Accept = (result: unknown) => boolean;
const present: Accept = (result) => result !== null;
export type Options = { later?: boolean; accept?: Accept };

async function ask(url: string, body: string, accept: Accept): Promise<Outcome> {
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
    // Out of reach, or cut off, is asked again; too slow, or not JSON, is not.
    return { answered: false, busy: busy || error instanceof TypeError };
  }
}

// Each RPC at most once, the first free in order taking the request, without leaving its turn in the queue; while none
// is free, the turn goes to others. The RPCs that were busy are what to ask again.
async function round(
  urls: string[],
  method: string,
  body: string,
  { later = false, accept = present }: Options,
): Promise<Answer | { answered: false; busy: string[] }> {
  const kind: Kind = method === "eth_getLogs" ? "logs" : "all";
  const left = [...urls];
  const busy: string[] = [];
  await take(later);
  try {
    while (left.length) {
      const now = performance.now();
      const free = left.map((url) => freeAt(url, kind, now));
      const i = free.findIndex((at) => at <= now);
      if (i < 0) {
        give();
        await sleep(Math.min(...free) - now);
        await take(later);
        continue;
      }
      const [url] = left.splice(i, 1) as [string];
      start(url, kind, now);
      const outcome = await ask(url, body, accept);
      if (outcome.answered) return outcome;
      if (outcome.busy) {
        busy.push(url);
        resting.set(`${url} ${kind}`, performance.now() + REST);
      }
    }
  } finally {
    give();
  }
  return { answered: false, busy };
}

export async function rpc<T>(method: string, params: unknown[], options: Options = {}): Promise<T> {
  const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method, params });
  // Only the RPCs that were busy are asked again.
  let urls = RPCS;
  for (let attempt = 0; ; attempt++) {
    const outcome = await round(urls, method, body, options);
    if (outcome.answered) return outcome.result as T;
    const { busy } = outcome;
    if (!busy.length || attempt === RETRIES) throw new Error(`No Base RPC answered ${method}.`);
    urls = RPCS.filter((url) => busy.includes(url));
    await sleep(Math.random() * BACKOFF * 2 ** attempt);
  }
}

// At the newest block, or at an earlier one, which only the RPCs that keep Base's history can answer.
export async function read(calls: Call[], block: number | "latest" = "latest", later = false): Promise<unknown[]> {
  const chunks: Promise<unknown[]>[] = [];
  for (let i = 0; i < calls.length; i += CHUNK) chunks.push(aggregate(calls.slice(i, i + CHUNK), block, later));
  return (await Promise.all(chunks)).flat();
}

// The same, behind the page's own reads.
export const readLater: typeof read = (calls, block = "latest") => read(calls, block, true);

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

export async function included(hash: Hex): Promise<boolean | undefined> {
  const end = Date.now() + 10 * 60_000;
  while (Date.now() < end) {
    // Null until the transaction is in a block: an answer, asked again in two seconds rather than of the next RPC.
    const receipt = await rpc<{ status: Hex } | null>("eth_getTransactionReceipt", [hash], {
      accept: () => true,
    }).catch(() => null);
    if (receipt) return receipt.status === "0x1";
    await sleep(2_000);
  }
  return undefined;
}
