import {
  concat,
  decodeFunctionResult,
  encodeFunctionData,
  multicall3Abi,
  numberToHex,
  parseAbi,
  size,
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
import { BLOCK_SCHEDULE, GZIP_RPCS, MULTICALL3, RPCS } from "./config.ts";

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
// Compares addresses, ignoring case. Unlike viem's `isAddressEqual`, it never throws on a string that isn't an address.
export const same = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase();
const sleep = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms));

// Gives the page a turn to draw and to answer the user, by waiting for a message to itself. A timer would add at least
// 4 ms each time, and is slowed down in a hidden tab. Chrome's `scheduler.yield` lets the page answer, but puts off
// drawing for up to 100 ms.
function breathe(): Promise<void> {
  return new Promise((done) => {
    const { port1, port2 } = new MessageChannel();
    port1.onmessage = () => {
      port1.close();
      done();
    };
    port2.postMessage(null);
  });
}
// `items.map(each)`, with a turn for the page every `SLICE` milliseconds, so that long work doesn't freeze it.
const SLICE = 10;
export async function sliced<T, U>(items: readonly T[], each: (item: T, i: number) => U): Promise<U[]> {
  const out: U[] = [];
  let start = performance.now();
  for (const [i, item] of items.entries()) {
    if (performance.now() - start > SLICE) {
      await breathe();
      start = performance.now();
    }
    out.push(each(item, i));
  }
  return out;
}

export const blockTime = call(MULTICALL3, multicall3Abi, "getCurrentBlockTimestamp");
export const blockNumber = call(
  MULTICALL3,
  parseAbi(["function getBlockNumber() view returns (uint256 blockNumber)"]),
  "getBlockNumber",
);

// The newest block that every RPC should have. It is 10 seconds of blocks below `newest`, since an RPC that is a little
// behind may not have those yet. At the pace `schedule` gives, that is 50 blocks since Denim and 5 before it.
export function settledBelow(newest: number, schedule: Schedule = BLOCK_SCHEDULE): number {
  const ms = schedule.findLast((each) => each.block <= newest)?.ms ?? 2_000;
  return newest - Math.ceil(10_000 / ms);
}

export const timeAt = async (block: number, rd: Read = read): Promise<number> =>
  Number(required(await rd([blockTime], { block }))[0]);
// Reads the newest block and its time. `timeOf` gives any other block's time, and reads each block only once.
// `firstAt` is `firstBlockAt` with these: the first block whose time is at least `time`, at or below `top`.
export async function blockClock(rd: Read = read) {
  const [newest, newestTime] = required(await rd([blockNumber, blockTime])).map(Number) as [number, number];
  const times = new Map<number, Promise<number>>();
  const timeOf = (block: number): Promise<number> => {
    const known = times.get(block) ?? timeAt(block, rd);
    times.set(block, known);
    return known;
  };
  const firstAt = async (time: number, top = newest): Promise<number> =>
    firstBlockAt(time, top, top === newest ? newestTime : await timeOf(top), timeOf, [newest, newestTime]);
  return { newest, newestTime, timeOf, firstAt };
}

// A fixed block schedule, such as Base's `BLOCK_SCHEDULE`.
export type Schedule = readonly { block: number; time: number; ms: number }[];
// The first block whose time, in whole seconds, is at least `time`, if every block kept to `schedule`.
export function scheduled(time: number, schedule: Schedule): number | undefined {
  const i = schedule.findLastIndex((each) => each.time <= time);
  const from = schedule[Math.max(i, 0)];
  if (!from) return undefined;
  const block = from.block + Math.max(0, Math.ceil(((time - from.time) * 1000) / from.ms));
  const next = schedule[i + 1];
  return next && block > next.block ? next.block : block;
}

// The first block whose time is at least `time`. It looks at or below `top`, whose time must be at least `time`.
// It first reads the block that `schedule` gives and the block before it, together. If they fit, that block is the
// answer. If not, the first five guesses estimate where `time` falls, from the nearest blocks read on each side of it.
// Until a block before `time` has been read, they follow the pace of the last two blocks read instead, starting with
// `top` and the newer `above`, if given. Later guesses halve the range. Times are whole seconds, so several blocks can
// share one time. When they do, a guess aims one second's worth of blocks below its estimate until a block before
// `time` has been read. After that, it aims as far towards the middle of the range. The range is halved once it holds
// two seconds' worth of blocks or fewer.
export async function firstBlockAt(
  time: number,
  top: number,
  topTime: number,
  timeOf: (block: number) => Promise<number>,
  [above, aboveTime]: readonly [number, number] = [top, topTime],
  schedule: Schedule = BLOCK_SCHEDULE,
): Promise<number> {
  let [lo, loTime, hi, hiTime] = [-1, 0, top, topTime];
  const expected = scheduled(time, schedule);
  if (expected !== undefined && expected > 0 && expected <= top) {
    const [at, before] = await Promise.all([timeOf(expected), timeOf(expected - 1)]);
    if (at >= time && before < time) return expected;
    if (at < time) [lo, loTime] = [expected, at];
    else [hi, hiTime] = [expected - 1, before];
  }
  let pace = 0;
  for (let step = 0; hi - lo > 1; step++) {
    const gap =
      (lo >= 0 ? (hiTime - loTime) / (hi - lo) : above > hi ? (aboveTime - hiTime) / (above - hi) : 0) || pace;
    pace = gap;
    // How many blocks may share one time.
    const spread = gap > 0 && gap < 1 ? Math.ceil(1 / gap) : 0;
    let placed = gap ? hi - Math.ceil((hiTime - time) / gap) : hi - 1;
    if (spread) placed += lo < 0 || placed - lo > hi - placed ? -spread : spread;
    const guess =
      step < 5 && hi - lo > 2 * spread + 1 ? Math.min(hi - 1, Math.max(lo + 1, placed)) : Math.floor((lo + hi) / 2);
    const at = await timeOf(guess);
    if (at >= time) [above, aboveTime, hi, hiTime] = [hi, hiTime, guess, at];
    else [lo, loTime] = [guess, at];
  }
  return hi;
}

// Base's time in seconds, from the newest block read, in case the device's clock is wrong.
let drift = 0;
let newest = 0;
export function sawBlock(time: number): void {
  if (time < newest) return;
  newest = time;
  drift = time - Math.floor(Date.now() / 1000);
}
export const now = (): number => Math.floor(Date.now() / 1000) + drift;

// What a read is for. Reads with no tag, or with a tag of the page on show, go first. The others take at most `BEHIND`
// of the `MAX` slots. So the page on show, whose reads often wait on one another, always has the rest.
export type Tag = "aero" | "earnings" | "average" | "shares" | "payouts" | "swap";
const MAX = 6;
const BEHIND = 2;
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

// In milliseconds: 5 seconds, plus the time that `MAX` requests of this size take to send together at 1 Mbit/s. This
// way a slow upload is not given up and sent again.
export const timeoutFor = (bytes: number): number => 5_000 + Math.ceil((bytes * MAX) / 125);

// Each RPC gets at most 25 requests a second, 5 of them for logs. One that is busy or out of reach rests: for a second,
// then twice as long each time it is busy again before it answers, up to `REST_MAX`. If it says how long to wait, with
// `Retry-After` in seconds, it rests that long instead, up to `REST_MAX`. Several requests in flight are often turned
// down together, so a request counts towards the doubling only if it started after the last one that did.
const nextFree = new Map<string, number>();
const restUntil = new Map<string, number>();
const strikes = new Map<string, { count: number; at: number }>();
export const REST_MAX = 8_000;
export const restFor = (count: number, retryAfter: string | null = null): number => {
  const asked = retryAfter === null || retryAfter.trim() === "" ? NaN : Number(retryAfter) * 1_000;
  return Math.min(REST_MAX, asked >= 0 ? asked : 1_000 * 2 ** Math.max(0, count - 1));
};
function rest(url: string, started: number, retryAfter: string | null): void {
  const strike = strikes.get(url) ?? { count: 0, at: -Infinity };
  if (started > strike.at) strikes.set(url, { count: strike.count + 1, at: performance.now() });
  const until = performance.now() + restFor(strikes.get(url)!.count, retryAfter);
  restUntil.set(url, Math.max(restUntil.get(url) ?? 0, until));
}
function answered(url: string, started: number): void {
  if (started > (strikes.get(url)?.at ?? -Infinity)) strikes.delete(url);
}
async function pace(url: string, logs: boolean): Promise<void> {
  const keys = logs ? [url, `${url} logs`] : [url];
  const at = Math.max(performance.now(), restUntil.get(url) ?? 0, ...keys.map((key) => nextFree.get(key) ?? 0));
  nextFree.set(url, at + 40);
  if (logs) nextFree.set(`${url} logs`, at + 200);
  await sleep(at - performance.now());
}

// Requests of at least `GZIP_FROM` bytes go gzipped to the RPCs in `GZIP_RPCS`. Smaller ones gain little. An RPC that
// can't read gzip says so with 415, or with JSON-RPC's parse error. The request is then sent again plain at once, and
// so are all later ones. A CORS error looks like a dropped connection, so it is told apart by repetition. Plain
// requests are sent from then on once `MISSES` gzipped requests failed to reach the RPC with none reaching it in
// between, and with a plain request reaching it before each. So the gzipped requests that a dropped connection, or an
// error page without CORS headers, fails together count as one, and so do those that fail while the RPC is down. A
// timeout doesn't count: the RPC is slow, not unable to read gzip. A gzipped request that doesn't get through is
// handled as any other: the RPCs are asked in turn, and this one again later.
export const GZIP_FROM = 1_024;
const MISSES = 3;
// For each RPC that may read gzip: gzipped requests in a row that failed to reach it, and whether a plain request has
// reached it since the last one.
const gzips = new Map(GZIP_RPCS.map((url) => [url, { misses: 0, reached: false }]));
export const gzipping = (url: string): boolean => (gzips.get(url)?.misses ?? MISSES) < MISSES;
const gzip = (text: string): Promise<ArrayBuffer> =>
  new Response(new Blob([text]).stream().pipeThrough(new CompressionStream("gzip"))).arrayBuffer();
// The timeout is the same whether the body is gzipped or not, since the answer can be as large as the request.
const post = (url: string, body: string, zipped?: ArrayBuffer): Promise<Response> =>
  fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...(zipped && { "content-encoding": "gzip" }) },
    body: zipped ?? body,
    signal: AbortSignal.timeout(timeoutFor(body.length)),
  });
const timedOut = (error: unknown): boolean => (error as Error | undefined)?.name === "TimeoutError";
const PARSE_ERROR = -32700;
async function unreadable(response: Response): Promise<boolean> {
  if (response.status === 415) return true;
  if (response.status < 400 || response.status >= 500) return false;
  const reply = (await response
    .clone()
    .json()
    .catch(() => undefined)) as Reply | undefined;
  return reply?.error?.code === PARSE_ERROR;
}

type Reply = { result?: unknown; error?: { code?: number; message?: string } };
const BUSY = /request limit|rate limit|too many requests/i;
type Options<T> = { tag?: Tag | undefined; want?: (result: T) => boolean };

// Asks the RPCs in turn until one gives an answer that passes `want`. By default, any answer but null passes. If none
// does, it returns the last non-null answer, or throws if there is none. RPCs that were busy or out of reach are asked
// again a little later, up to three more times.
export function rpc<T>(
  method: string,
  params: unknown[],
  { tag, want = (r) => r !== null }: Options<T> = {},
): Promise<T> {
  const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method, params });
  let zipped: Promise<ArrayBuffer> | undefined;
  const send = async (url: string): Promise<Response> => {
    const state = gzips.get(url);
    if (!state || state.misses >= MISSES || body.length < GZIP_FROM || typeof CompressionStream === "undefined") {
      const response = await post(url, body);
      if (state) state.reached = true;
      return response;
    }
    let response: Response;
    try {
      response = await post(url, body, await (zipped ??= gzip(body)));
    } catch (error) {
      if (!timedOut(error) && state.reached) Object.assign(state, { misses: state.misses + 1, reached: false });
      throw error;
    }
    if (!(await unreadable(response))) {
      state.misses = 0;
      return response;
    }
    state.misses = MISSES;
    return post(url, body);
  };
  return inSlot(tag, async () => {
    if (globalThis.navigator?.onLine === false) throw new Error("Offline.");
    let urls = RPCS;
    let last: T | null = null;
    for (let attempt = 0; attempt < 4 && urls.length; attempt++) {
      const busy: string[] = [];
      // RPCs that are resting go last, the one that rests longest at the end. The others keep their order, so an RPC
      // whose rest is over is asked first again.
      const now = performance.now();
      const resting = (url: string): number => Math.max(0, (restUntil.get(url) ?? 0) - now);
      for (const url of [...urls].sort((a, b) => resting(a) - resting(b))) {
        await pace(url, method === "eth_getLogs");
        const started = performance.now();
        let reply: Reply | undefined;
        let retryAfter: string | null = null;
        try {
          const response = await send(url);
          retryAfter = response.headers.get("retry-after");
          if (response.status === 429 || response.status >= 500) throw new Error("Busy.");
          reply = (await response.json()) as Reply;
          if (typeof reply !== "object" || reply === null) throw new Error("Not JSON-RPC.");
        } catch {
          rest(url, started, retryAfter);
          busy.push(url);
          continue;
        }
        if (reply.error?.code === 429 || BUSY.test(reply.error?.message ?? "")) {
          rest(url, started, retryAfter);
          busy.push(url);
          continue;
        }
        answered(url, started);
        if ("result" in reply) {
          const result = reply.result as T;
          if (want(result)) return result;
          last = result ?? last;
        }
      }
      urls = busy;
      if (busy.length) await sleep(Math.random() * 250 * 2 ** attempt);
    }
    if (last !== null) return last;
    throw new Error(`No Base RPC answered ${method}.`);
  });
}

type ReadOptions = { block?: number | "latest"; tag?: Tag | undefined; perBatch?: number };
// Each call's result, typed by its ABI. Undefined when the call failed.
type Results<C extends readonly Call[]> = { -readonly [K in keyof C]: Result<C[K]> | undefined };
// Says which addresses hold code. Undefined for an address that could not be read. The reads of Base have this, as
// `codeAt`; a test's reads may not.
export type CodeAt = (addresses: readonly Address[]) => Promise<(boolean | undefined)[]>;
export type Read = (<const C extends readonly Call[]>(calls: C, options?: ReadOptions) => Promise<Results<C>>) & {
  codeAt?: CodeAt;
};
// Reads through Multicall3, in batches. A batch has at most `perBatch` calls, since each `eth_call` has its own gas
// limit. It also has at most `BATCH_BYTES` of calldata, so that it is quick to send. In a batch, each call takes its
// calldata padded to a multiple of 32 bytes, plus 160 bytes.
export const BATCH_BYTES = 100_000;
const CALL_BYTES = 160;
export const read: Read = async (calls, { block = "latest", tag, perBatch = 200 } = {}) => {
  const data = await sliced(calls, (each) => encodeFunctionData(each as never));
  const batches: Promise<unknown[]>[] = [];
  for (let start = 0; start < calls.length;) {
    let [end, bytes] = [start, 0];
    for (; end < calls.length && end - start < perBatch; end++) {
      bytes += Math.ceil(size(data[end]!) / 32) * 32 + CALL_BYTES;
      if (end > start && bytes > BATCH_BYTES) break;
    }
    batches.push(aggregate(calls.slice(start, end), data.slice(start, end), block, tag));
    start = end;
  }
  return (await Promise.all(batches)).flat() as never;
};
read.codeAt = (addresses) => codeAt(addresses);
async function aggregate(
  calls: Call[],
  callData: Hex[],
  block: number | "latest",
  tag: Tag | undefined,
): Promise<unknown[]> {
  const data = encodeFunctionData({
    abi: multicall3Abi,
    functionName: "aggregate3",
    args: [calls.map((c, i) => ({ target: c.address, allowFailure: true, callData: callData[i]! }))],
  });
  const at = block === "latest" ? block : numberToHex(block);
  const reply = await rpc<Hex>("eth_call", [{ to: MULTICALL3, data }, at], { tag });
  return sliced(
    decodeFunctionResult({ abi: multicall3Abi, functionName: "aggregate3", data: reply }),
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
export function tagged(tag: Tag): Read {
  const rd: Read = (calls, options) => read(calls, { ...options, tag });
  rd.codeAt = (addresses) => codeAt(addresses, tag);
  return rd;
}

// Says which addresses hold code, without a contract of the page's own. `eth_call` runs this program as the creation
// code of a contract, with the addresses appended, 20 bytes each. The program returns one byte for each address: 1 if
// it holds code, 0 if not. By offset:
//   00  PUSH1 0x2f DUP1 CODESIZE SUB DUP1 SWAP2 PUSH0 CODECOPY   the addresses, after the program's 0x2f bytes, to
//                                                                memory at 0
//   09  PUSH1 20 DUP2 DIV PUSH0                                  n = their length / 20; i = 0
//   0e  JUMPDEST DUP2 DUP2 LT ISZERO PUSH1 0x2b JUMPI            while i < n:
//   16  DUP1 PUSH1 20 MUL MLOAD PUSH1 96 SHR                       address i
//   1e  EXTCODESIZE ISZERO ISZERO DUP4 DUP3 ADD MSTORE8            1 if its code size is not 0, after the addresses
//   25  PUSH1 1 ADD PUSH1 0x0e JUMP                                i += 1
//   2b  JUMPDEST POP SWAP1 RETURN                                the n bytes
// Creation code can't be over 49,152 bytes, so one call asks about `CODE_BATCH` addresses at most, at 2,600 gas each.
const CODE_AT: Hex = "0x602f80380380915f39601481045f5b81811015602b57806014025160601c3b151583820153600101600e565b5090f3";
const CODE_BATCH = 2_000;
const FLAGS: Record<string, boolean> = { "00": false, "01": true };
export async function codeAt(addresses: readonly Address[], tag?: Tag): Promise<(boolean | undefined)[]> {
  const batches: Promise<(boolean | undefined)[]>[] = [];
  for (let i = 0; i < addresses.length; i += CODE_BATCH) {
    const part = addresses.slice(i, i + CODE_BATCH);
    const whole = (reply: Hex) => typeof reply === "string" && reply.length === 2 + 2 * part.length;
    batches.push(
      rpc<Hex>("eth_call", [{ data: concat([CODE_AT, ...part]) }, "latest"], { tag, want: whole }).then(
        (reply) => part.map((_, j) => (whole(reply) ? FLAGS[reply.slice(2 + 2 * j, 4 + 2 * j)] : undefined)),
        () => part.map(() => undefined),
      ),
    );
  }
  return (await Promise.all(batches)).flat();
}
// What one of an item's calls returned. Undefined when the call failed or was not made.
type Field<F> = F extends (item: never) => infer C ? Result<C> | undefined : undefined;
// Reads some calls for every item, together. Each item comes back with its calls' results by field name, so nothing
// needs matching up by index. A field set to `undefined` is not read.
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
// Splits `replies`, the results of every group's calls read together, back into one list per group.
export function regroup<T>(groups: readonly (readonly unknown[])[], replies: readonly T[]): T[][] {
  let next = 0;
  return groups.map(({ length }) => replies.slice(next, (next += length)));
}
export function required<const T extends readonly unknown[]>(
  values: T,
): { -readonly [K in keyof T]: Exclude<T[K], undefined> } {
  if (values.includes(undefined)) throw new Error("A read from Base failed.");
  return values as never;
}

export const implementation = async (proxy: Address): Promise<Address> =>
  `0x${(await rpc<Hex>("eth_getStorageAt", [proxy, "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc", "latest"])).slice(-40)}`;

export type Tx = { to: Address; data: Hex };
// Runs the calls in order on the latest block, without checks such as gas or balance. A call that reverted returns
// the revert data, which RPCs put in its error.
export async function simulate(from: Address, txs: Tx[]): Promise<{ ok: boolean; returnData: Hex; gas: bigint }[]> {
  type Simulated = { calls: { status: Hex; returnData: Hex; gasUsed: Hex; error?: { data?: Hex } }[] }[];
  const calls = txs.map(({ to, data }) => ({ from, to, data }));
  const [block] = await rpc<Simulated>("eth_simulateV1", [
    { blockStateCalls: [{ calls }], validation: false },
    "latest",
  ]);
  return block!.calls.map(({ status, returnData, gasUsed, error }) => ({
    ok: status === "0x1",
    returnData: status === "0x1" ? returnData : (error?.data ?? returnData),
    gas: BigInt(gasUsed),
  }));
}

type Receipt = OpStackRpcTransactionReceipt;
// The fields that every receipt has, wherever it comes from. A wallet's receipt, from EIP-5792's
// `wallet_getCallsStatus`, has only these.
export type Landed = WalletCallReceipt;
// The receipts' logs, typed for `parseEventLogs`. A wallet's logs hold only address, data and topics. That is enough to
// decode their events, but they lack the block and index that an RPC's logs also hold.
export const logsIn = (receipts: Pick<Landed, "logs">[]): RpcLog[] => receipts.flatMap(({ logs }) => logs) as RpcLog[];
// Asks every 0.2 seconds, as often as Base makes a block, for 10 seconds. Then asks every 2 seconds, for up to 10
// minutes in all.
export async function poll<T>(ask: () => Promise<T | undefined>): Promise<T | undefined> {
  const start = Date.now();
  for (const end = start + 600_000; Date.now() < end; await sleep(Date.now() - start < 10_000 ? 200 : 2_000)) {
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
// What the transactions cost in wei, L1 fee included. `undefined` unless `from` itself sent and paid for every one,
// rather than a bundler or a sponsor. Also `undefined` when a receipt could not be read.
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

// The gas price and the tip to ask for, in wei. The tip is capped at 1 gwei because Aero's basic pools tax a swap that
// tips more.
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
