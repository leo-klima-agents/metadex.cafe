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
import { BLOCK_SCHEDULE, MULTICALL3, RPCS } from "./config.ts";

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
export const blockNumber = call(
  MULTICALL3,
  parseAbi(["function getBlockNumber() view returns (uint256 blockNumber)"]),
  "getBlockNumber",
);

// The newest block that every RPC should have: 10 seconds of blocks are skipped, since an RPC a little behind may not
// have them yet. That's 50 blocks since Denim and 5 before, as `schedule` paces them.
export function settledBelow(newest: number, schedule: Schedule = BLOCK_SCHEDULE): number {
  const ms = schedule.findLast((each) => each.block <= newest)?.ms ?? 2_000;
  return newest - Math.ceil(10_000 / ms);
}

export const timeAt = async (block: number, rd: Read = read): Promise<number> =>
  Number(required(await rd([blockTime], { block }))[0]);
// The newest block and its time, and the time of any other, each asked for once: what `firstBlockAt` searches with.
export async function blockClock(rd: Read = read) {
  const [newest, newestTime] = required(await rd([blockNumber, blockTime])).map(Number) as [number, number];
  const times = new Map<number, Promise<number>>();
  const timeOf = (block: number): Promise<number> => {
    const known = times.get(block) ?? timeAt(block, rd);
    times.set(block, known);
    return known;
  };
  return { newest, newestTime, timeOf };
}

// Blocks made on a fixed schedule, as `BLOCK_SCHEDULE` lists Base's.
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

// The first block whose time is at least `time`, at or below `top`, which must be at or after it. The block `schedule`
// gives and the one before are read together, and if they fit, that's the answer. Otherwise, the first five guesses
// interpolate between the closest blocks read so far or, until one before `time` is read, follow the pace of the last
// two read, starting from `top` and the newer `above`, if given. Later ones halve the range. Times are whole seconds,
// so with several blocks a second, guesses aim a second's blocks below `time` until one is before it, then as far
// above, and the range is halved once it holds two seconds' blocks or fewer.
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

// Base's time, from the newest block read, in case the device's clock is wrong.
let drift = 0;
let newest = 0;
export function sawBlock(time: number): void {
  if (time < newest) return;
  newest = time;
  drift = time - Math.floor(Date.now() / 1000);
}
export const now = (): number => Math.floor(Date.now() / 1000) + drift;

// What a read is for. Untagged reads, and those tagged for the shown page, go first. The rest hold at most `BEHIND` of
// the `MAX` slots, so the shown page, whose reads often wait on one another, always has the others.
export type Tag = "earnings" | "average" | "shares" | "payouts" | "swap" | "aero";
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

// 5 seconds, plus as long as `MAX` such requests take to send together at 1 Mbit/s, so that a slow upload is not given
// up and sent again.
export const timeoutFor = (bytes: number): number => 5_000 + Math.ceil((bytes * MAX) / 125);

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
// returns the last non-null answer, or throws if there is none. RPCs that were busy or out of reach are asked again a
// little later, up to three more times.
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
            signal: AbortSignal.timeout(timeoutFor(body.length)),
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
// Which addresses hold code, undefined where unread. Reads of Base have it (`codeAt`); a test's may not.
export type CodeAt = (addresses: readonly Address[]) => Promise<(boolean | undefined)[]>;
export type Read = (<const C extends readonly Call[]>(calls: C, options?: ReadOptions) => Promise<Results<C>>) & {
  codeAt?: CodeAt;
};
// Reads through Multicall3 in batches of at most `perBatch` calls, since each `eth_call` has its own gas limit, and
// `BATCH_BYTES` of calldata, so that none takes long to send. Multicall3 pads each call to 32 bytes and adds 160.
export const BATCH_BYTES = 100_000;
const CALL_BYTES = 160;
export const read: Read = async (calls, { block = "latest", tag, perBatch = 200 } = {}) => {
  const data = calls.map((each) => encodeFunctionData(each as never));
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
export function tagged(tag: Tag): Read {
  const rd: Read = (calls, options) => read(calls, { ...options, tag });
  rd.codeAt = (addresses) => codeAt(addresses, tag);
  return rd;
}

// Which addresses hold code, with no contract of the page's own: `eth_call` runs this program as a contract's
// creation, with the addresses appended, 20 bytes each, and the program returns one byte for each, 1 if it holds code
// and 0 if not. By offset:
//   00  PUSH1 0x2f DUP1 CODESIZE SUB DUP1 SWAP2 PUSH0 CODECOPY   the addresses, after the program's 0x2f bytes, to
//                                                                memory at 0
//   09  PUSH1 20 DUP2 DIV PUSH0                                  n = their length / 20; i = 0
//   0e  JUMPDEST DUP2 DUP2 LT ISZERO PUSH1 0x2b JUMPI            while i < n:
//   16  DUP1 PUSH1 20 MUL MLOAD PUSH1 96 SHR                       address i
//   1e  EXTCODESIZE ISZERO ISZERO DUP4 DUP3 ADD MSTORE8            1 if its code size is not 0, after the addresses
//   25  PUSH1 1 ADD PUSH1 0x0e JUMP                                i += 1
//   2b  JUMPDEST POP SWAP1 RETURN                                the n bytes
// A creation's code may not exceed 49,152 bytes, so a call asks about `CODE_BATCH` addresses at most, 2,600 gas each.
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
// the revert's data, which RPCs put in its error.
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
// The fields every receipt has, wherever it comes from: a wallet's receipt, from EIP-5792's `wallet_getCallsStatus`,
// has no more.
export type Landed = WalletCallReceipt;
// The receipts' logs, typed for `parseEventLogs`. A wallet's logs hold only address, data and topics, which is enough
// to decode their events, but not the block and index that an RPC's logs also hold.
export const logsIn = (receipts: Pick<Landed, "logs">[]): RpcLog[] => receipts.flatMap(({ logs }) => logs) as RpcLog[];
// Asks every 0.2 seconds, as often as Base makes a block, for 10 seconds, then every 2, for up to 10 minutes.
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
