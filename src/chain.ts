import { decodeFunctionResult, encodeFunctionData, keccak256, parseAbi, type Abi, type Address, type Hex } from "viem";
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

// Every request to Base goes through one queue: at most AT_ONCE at a time, started SPACING ms apart at least, which keeps
// under the 25 a second that mainnet.base.org allows (it says so when it refuses one).
const AT_ONCE = 6;
const SPACING = 50;
let running = 0;
const waiting: (() => void)[] = [];
// Each start waits for the one before it, and then for SPACING after it, as it happened rather than as planned.
let turns = Promise.resolve();
let started = -Infinity;

function turn(): Promise<void> {
  turns = turns.then(async () => {
    await sleep(started + SPACING - performance.now());
    started = performance.now();
  });
  return turns;
}

async function queued<T>(task: () => Promise<T>): Promise<T> {
  if (running < AT_ONCE) running++;
  else await new Promise<void>((go) => waiting.push(go));
  try {
    await turn();
    return await task();
  } finally {
    const next = waiting.shift();
    if (next) next();
    else running--;
  }
}

// When no RPC answers and one of them was busy or out of reach, the request is asked again after a truncated exponential
// backoff with full jitter, as RPC providers advise: up to RETRIES times, at random within 250 ms, 500 ms, 1 s and 2 s,
// and never sooner than an RPC's Retry-After, up to MAX_WAIT. What an RPC would answer the same again, such as a call
// that reverts or a block it does not keep, is not asked again.
const RETRIES = 4;
const BACKOFF = 250;
const MAX_WAIT = 10_000;
const BUSY_CODES = [429, -32005, -32007, -32011, -32090];
const BUSY =
  /request limit|rate limit|limit reached|too many requests|busy|timeout|timed out|try again|header not found/i;

type Reply = { result?: unknown; error?: { code?: number; message?: string } };
type Outcome = { answered: true; result: unknown } | { answered: false; busy: boolean; wait: number };

// Seconds, or a date.
function retryAfter(header: string | null): number {
  if (!header) return 0;
  const ms = /^\d+$/.test(header) ? Number(header) * 1000 : Date.parse(header) - Date.now();
  return Number.isFinite(ms) ? Math.min(Math.max(ms, 0), MAX_WAIT) : 0;
}

const ask = (url: string, body: string): Promise<Outcome> =>
  queued(async () => {
    let response: Response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body,
        signal: AbortSignal.timeout(5_000),
      });
    } catch {
      return { answered: false, busy: true, wait: 0 };
    }
    const wait = retryAfter(response.headers.get("retry-after"));
    const busy = response.status === 408 || response.status === 429 || response.status >= 500;
    let reply: Reply;
    try {
      reply = (await response.json()) as Reply;
    } catch {
      return { answered: false, busy, wait };
    }
    if (reply.result !== undefined) return { answered: true, result: reply.result };
    const { code = 0, message = "" } = reply.error ?? {};
    return { answered: false, busy: busy || BUSY_CODES.includes(code) || BUSY.test(message), wait };
  });

export async function rpc<T>(method: string, params: unknown[]): Promise<T> {
  const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method, params });
  // Only the RPCs that were busy are asked again.
  let urls = RPCS;
  for (let attempt = 0; ; attempt++) {
    const busy: string[] = [];
    let wait = 0;
    for (const url of urls) {
      const outcome = await ask(url, body);
      if (outcome.answered) return outcome.result as T;
      if (outcome.busy) busy.push(url);
      wait = Math.max(wait, outcome.wait);
    }
    if (!busy.length || attempt === RETRIES) throw new Error(`No Base RPC answered ${method}.`);
    urls = busy;
    await sleep(Math.max(wait, Math.random() * BACKOFF * 2 ** attempt));
  }
}

// At the newest block, or at an earlier one, which only the RPCs that keep Base's history can answer.
export async function read(calls: Call[], block: number | "latest" = "latest"): Promise<unknown[]> {
  const chunks: Promise<unknown[]>[] = [];
  for (let i = 0; i < calls.length; i += CHUNK) chunks.push(aggregate(calls.slice(i, i + CHUNK), block));
  return (await Promise.all(chunks)).flat();
}

async function aggregate(calls: Call[], block: number | "latest"): Promise<unknown[]> {
  const data = encodeFunctionData({
    abi: multicall3Abi,
    functionName: "aggregate3",
    args: [calls.map((c) => ({ target: c.address, allowFailure: true, callData: encodeFunctionData(c as never) }))],
  });
  const tag = block === "latest" ? block : `0x${block.toString(16)}`;
  const reply = await rpc<Hex>("eth_call", [{ to: MULTICALL3, data }, tag]);
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
    const receipt = await rpc<{ status: Hex } | null>("eth_getTransactionReceipt", [hash]).catch(() => null);
    if (receipt) return receipt.status === "0x1";
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
  return undefined;
}
