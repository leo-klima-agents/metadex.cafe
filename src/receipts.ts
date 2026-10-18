import { decodeEventLog, encodeEventTopics, numberToHex, parseAbi, type Address, type Hex } from "viem";
import { call, read, rpc } from "./chain.ts";
import { CONDUIT } from "./config.ts";

// Carbon Impact pays out by calling claimSwapAndDistribute once for each account, in a transaction of its own: it
// claims the account's rewards, swaps them to kVCM, retires a share, and pays the rest to the owner's payout address,
// with an event for the retirement and one for the payout. A run takes up to half a day, and Base's free RPCs give the
// logs of 100 blocks at a time at most, so its logs are out of reach as a whole. The run is found by what it changes
// instead: totalTonnesRetired only grows, so a search through past blocks finds the stretches of 100 blocks in which
// it changed, and their logs hold the run. A payout that retires nothing, as one that pays nothing does, is found only
// if it falls in one of those stretches.

const conduitAbi = parseAbi(["function totalTonnesRetired() view returns (uint256)"]);
const eventsAbi = parseAbi([
  "event CarbonRetired(address indexed creditToken_, uint256 retireTonnes, uint256 kvcmSpent)",
  "event ClaimSwapAndDistributeCompleted(uint256 indexed tokenId, address indexed owner, address indexed recipient, address[] claimedTokens, uint256[] claimedAmounts, address[] distributedTokens, uint256[] distributedAmounts, uint256[] treasuryFees)",
]);

// Base makes a block every two seconds.
export const BLOCKS_PER_WEEK = 302_400;
const BLOCKS_PER_DAY = 43_200;
// How far back the page looks for a payout.
export const WEEKS = 8;
// The most blocks of logs the free RPCs give at once.
export const STRETCH = 100;
// The newest blocks are left out: an RPC behind its peers may not have them yet.
const SETTLED = 5;

export type Amount = { token: Address; amount: bigint };
export type Payout = {
  id: bigint;
  owner: Address;
  recipient: Address;
  earned: Amount[];
  paid: Amount[];
  fees: Amount[];
  tonnes: bigint;
  retiredKvcm: bigint;
  tx: Hex;
  block: number;
};
// The block and time of the run's last payout.
export type Run = { block: number; time: number; payouts: Payout[] };
// The last run, if there was one in the last WEEKS weeks, and the block and total retired that the search went by.
export type Search = { total: bigint; top: number; run?: Run };
export type Log = { data: Hex; topics: [Hex, ...Hex[]]; transactionHash: Hex; logIndex: Hex; blockNumber: Hex };

// The total retired at a block.
export type Reader = (block: number) => Promise<bigint>;
// Blocks from, to, both included.
export type Stretch = [number, number];

// Where the total last changed: after lower, where it was below now, and by upper, where it is now, at most size blocks
// apart.
export async function lastChange(
  at: Reader,
  lower: number,
  upper: number,
  below: bigint,
  now: bigint,
  size: number,
): Promise<{ lower: number; upper: number; below: bigint }> {
  while (upper - lower > size) {
    const middle = Math.floor((lower + upper) / 2);
    const total = await at(middle);
    if (total === now) upper = middle;
    else [lower, below] = [middle, total];
  }
  return { lower, upper, below };
}

// The stretches of at most size blocks, after from and up to to, in which the total changed, from the totals at both
// ends.
export async function changes(
  at: Reader,
  from: number,
  to: number,
  before: bigint,
  after: bigint,
  size: number,
): Promise<Stretch[]> {
  if (before === after) return [];
  if (to - from <= size) return [[from + 1, to]];
  const middle = Math.floor((from + to) / 2);
  const between = await at(middle);
  const [left, right] = await Promise.all([
    changes(at, from, middle, before, between, size),
    changes(at, middle, to, between, after, size),
  ]);
  return [...left, ...right];
}

const positive = (tokens: readonly Address[], values: readonly bigint[]): Amount[] =>
  tokens.map((token, i) => ({ token, amount: values[i] ?? 0n })).filter(({ amount }) => amount > 0n);

const order = (log: Log): bigint => BigInt(log.blockNumber) * 1_000_000n + BigInt(log.logIndex);

// The payouts in a run's logs. An account's retirement, if it had one, comes just before its payout, in the same
// transaction.
export function payouts(logs: Log[]): Payout[] {
  const found: Payout[] = [];
  const retired = new Map<Hex, { tonnes: bigint; kvcm: bigint }>();
  for (const log of [...logs].sort((a, b) => Number(order(a) - order(b)))) {
    let event;
    try {
      event = decodeEventLog({ abi: eventsAbi, data: log.data, topics: log.topics });
    } catch {
      continue;
    }
    if (event.eventName === "CarbonRetired") {
      retired.set(log.transactionHash, { tonnes: event.args.retireTonnes, kvcm: event.args.kvcmSpent });
      continue;
    }
    const { tokenId, owner, recipient, claimedTokens, claimedAmounts } = event.args;
    const { distributedTokens, distributedAmounts, treasuryFees } = event.args;
    const retirement = retired.get(log.transactionHash);
    retired.delete(log.transactionHash);
    found.push({
      id: tokenId,
      owner,
      recipient,
      earned: positive(claimedTokens, claimedAmounts),
      paid: positive(distributedTokens, distributedAmounts),
      fees: positive(distributedTokens, treasuryFees),
      tonnes: retirement?.tonnes ?? 0n,
      retiredKvcm: retirement?.kvcm ?? 0n,
      tx: log.transactionHash,
      block: Number(log.blockNumber),
    });
  }
  return found;
}

// Every read of the search is in the background, behind the page's own.
async function tonnesAt(block: number | "latest"): Promise<bigint> {
  const [total] = await read([call(CONDUIT, conduitAbi, "totalTonnesRetired")], block, true);
  if (total === undefined) throw new Error("A read from Base failed.");
  return total as bigint;
}

// The total retired now: when it has grown since a run was read, a later run has started.
export const totalRetired = (): Promise<bigint> => tonnesAt("latest");

const RETIRED = encodeEventTopics({ abi: eventsAbi, eventName: "CarbonRetired" })[0].toLowerCase();

// The total changed in a stretch, so its logs hold a retirement: an RPC that answers without one has lost them, and the
// next is asked.
export const retires = (logs: unknown): boolean =>
  Array.isArray(logs) && logs.some((log: Partial<Log>) => log.topics?.[0]?.toLowerCase() === RETIRED);

async function logsOf(stretches: Stretch[]): Promise<Log[]> {
  const logs = await Promise.all(
    stretches.map(([first, end]) =>
      rpc<Log[]>("eth_getLogs", [{ address: CONDUIT, fromBlock: numberToHex(first), toBlock: numberToHex(end) }], {
        later: true,
        accept: retires,
      }),
    ),
  );
  return logs.flat();
}

async function runOf(found: Payout[]): Promise<Run> {
  if (!found.length) throw new Error("The run's logs are missing.");
  const block = Math.max(...found.map((payout) => payout.block));
  return { block, time: (await blockTimes([block])).get(block)!, payouts: found };
}

// The automation's last payout, for all its accounts. Some 20 reads to find the run, and about 4 more for each of its
// transactions: 17 to 118 for the six runs from Aug to Sept 2026. Since a search less than a day old, only the blocks
// after it: new payouts within a day of its run's last are more of the same run, others a new one.
export async function lastRun(since?: Search): Promise<Search> {
  const top = Number(await rpc<Hex>("eth_blockNumber", [], { later: true })) - SETTLED;
  const now = await tonnesAt(top);
  if (since && top - since.top <= BLOCKS_PER_DAY && now >= since.total) {
    if (now === since.total) return { ...since, top };
    const found = payouts(await logsOf(await changes(tonnesAt, since.top, top, since.total, now, STRETCH)));
    const first = Math.min(...found.map((payout) => payout.block));
    const goesOn = since.run && first - since.run.block <= BLOCKS_PER_DAY;
    return { total: now, top, run: await runOf(goesOn ? [...since.run!.payouts, ...found] : found) };
  }
  // Back a week at a time to a total lower than now; the change is after it, and by the week boundary before it.
  let [lower, below, upper] = [top, now, top];
  for (let week = 1; below === now; week++) {
    if (week > WEEKS || lower === 0) return { total: now, top };
    upper = lower;
    lower = Math.max(0, top - week * BLOCKS_PER_WEEK);
    below = await tonnesAt(lower);
  }
  const last = await lastChange(tonnesAt, lower, upper, below, now, STRETCH);
  // A run takes up to half a day: the day before its last retirement holds the others.
  const from = Math.max(0, last.lower - BLOCKS_PER_DAY);
  const stretches: Stretch[] = [
    ...(await changes(tonnesAt, from, last.lower, await tonnesAt(from), last.below, STRETCH)),
    [last.lower + 1, last.upper],
  ];
  return { total: now, top, run: await runOf(payouts(await logsOf(stretches))) };
}

// The time of each block. A block's time never changes: each is read once.
const times = new Map<number, number>();

export async function blockTimes(blocks: number[]): Promise<Map<number, number>> {
  const missing = [...new Set(blocks)].filter((block) => !times.has(block));
  const found = await Promise.all(
    missing.map((block) =>
      rpc<{ timestamp: Hex }>("eth_getBlockByNumber", [numberToHex(block), false], { later: true }).then(
        ({ timestamp }) => Number(timestamp),
      ),
    ),
  );
  missing.forEach((block, i) => times.set(block, found[i]!));
  return new Map(blocks.map((block) => [block, times.get(block)!]));
}
