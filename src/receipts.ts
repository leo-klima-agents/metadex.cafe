import { decodeEventLog, encodeEventTopics, numberToHex, parseAbi, type Address, type Hex } from "viem";
import { readLater, required, rpc } from "./chain.ts";
import { CONDUIT } from "./config.ts";
import { clean } from "./format.ts";
import { conduit } from "./hydrex.ts";

// Carbon Impact pays each account in a transaction of its own: it claims the account's rewards, swaps them to kVCM,
// retires a share, and sends the rest to the owner's payout address, with one event for the retirement and one for the
// payout. A run of payouts takes up to half a day, but the free RPCs give the logs of at most 100 blocks at a time. So
// the page finds a run by its effect: totalTonnesRetired only grows, so a search through past blocks finds the
// 100-block stretches where it changed, and their logs hold the run. A payout that retires nothing is found only if it
// falls in one of those stretches.

const eventsAbi = parseAbi([
  "event CarbonRetired(address indexed creditToken_, uint256 retireTonnes, uint256 kvcmSpent)",
  "event ClaimSwapAndDistributeCompleted(uint256 indexed tokenId, address indexed owner, address indexed recipient, address[] claimedTokens, uint256[] claimedAmounts, address[] distributedTokens, uint256[] distributedAmounts, uint256[] treasuryFees)",
]);

// Base makes a block every two seconds.
export const BLOCKS_PER_WEEK = 302_400;
const BLOCKS_PER_DAY = 43_200;
const WEEKS_BACK = 8;
// The most blocks of logs the free RPCs give at once.
const STRETCH = 100;
// The newest blocks are skipped: an RPC that is a little behind may not have them yet.
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
// A run of payouts, with the block and time of its last one.
export type Run = { block: number; time: number; payouts: Payout[] };
// Where a search for the last run stopped, the total retired there, and the run, if one was found within WEEKS_BACK weeks.
export type RunSearch = { total: bigint; top: number; run?: Run };
export type Log = { data: Hex; topics: [Hex, ...Hex[]]; transactionHash: Hex; logIndex: Hex; blockNumber: Hex };

type TotalAt = (block: number) => Promise<bigint>;
// The first and last block, both included.
type Stretch = [number, number];

// Narrows down where the total last changed: after `lower`, where it was `below`, and by `upper`, where it is `now`.
export async function lastChange(
  at: TotalAt,
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

// The stretches of at most `size` blocks, after `from` and up to `to`, in which the total changed.
export async function changes(
  at: TotalAt,
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

// The payouts in a run's logs. An account's retirement, if any, comes just before its payout, in the same transaction.
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

async function tonnesAt(block: number | "latest"): Promise<bigint> {
  const [total] = required(await readLater([conduit("totalTonnesRetired")], block)) as [bigint];
  return total;
}

// Once this has grown past a search's total, a new run has started.
export const totalRetired = (): Promise<bigint> => tonnesAt("latest");

const RETIRED = encodeEventTopics({ abi: eventsAbi, eventName: "CarbonRetired" })[0].toLowerCase();

// The total changed in each stretch, so its logs hold a retirement. An RPC that answers without one has lost them.
export const retires = (logs: unknown): boolean =>
  Array.isArray(logs) && logs.some((log: Partial<Log>) => log.topics?.[0]?.toLowerCase() === RETIRED);

async function logsOf(stretches: Stretch[]): Promise<Log[]> {
  const logs = await Promise.all(
    stretches.map(([first, last]) =>
      rpc<Log[]>("eth_getLogs", [{ address: CONDUIT, fromBlock: numberToHex(first), toBlock: numberToHex(last) }], {
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

// Carbon Impact's last run: some 20 reads to find it, and about 4 per payout. Given a search less than a day old, only
// newer blocks are searched: payouts within a day of that run's last one belong to it, later ones start a new run.
export async function lastRun(since?: RunSearch): Promise<RunSearch> {
  const top = Number(await rpc<Hex>("eth_blockNumber", [], { later: true })) - SETTLED;
  const now = await tonnesAt(top);
  if (since && top - since.top <= BLOCKS_PER_DAY && now >= since.total) {
    if (now === since.total) return { ...since, top };
    const found = payouts(await logsOf(await changes(tonnesAt, since.top, top, since.total, now, STRETCH)));
    const first = Math.min(...found.map((payout) => payout.block));
    const goesOn = since.run && first - since.run.block <= BLOCKS_PER_DAY;
    return { total: now, top, run: await runOf(goesOn ? [...since.run!.payouts, ...found] : found) };
  }
  // Go back a week at a time until the total is lower. The last change is between there and the week after.
  let [lower, below, upper] = [top, now, top];
  for (let week = 1; below === now; week++) {
    if (week > WEEKS_BACK || lower === 0) return { total: now, top };
    upper = lower;
    lower = Math.max(0, top - week * BLOCKS_PER_WEEK);
    below = await tonnesAt(lower);
  }
  const last = await lastChange(tonnesAt, lower, upper, below, now, STRETCH);
  // A run takes up to half a day, so the day before its last retirement holds the rest of it.
  const from = Math.max(0, last.lower - BLOCKS_PER_DAY);
  const stretches: Stretch[] = [
    ...(await changes(tonnesAt, from, last.lower, await tonnesAt(from), last.below, STRETCH)),
    [last.lower + 1, last.upper],
  ];
  return { total: now, top, run: await runOf(payouts(await logsOf(stretches))) };
}

// A block's time never changes, so each is read once.
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

// The name Carbon Impact retired in at each block. Its admin can change the name, so each receipt shows the one in use
// at its payout. Each is read once.
const names = new Map<number, string>();

export async function namesAt(blocks: number[]): Promise<Map<number, string>> {
  const missing = [...new Set(blocks)].filter((block) => !names.has(block));
  const found = await Promise.all(
    missing.map(async (block) => {
      const [name] = required(await readLater([conduit("retiringEntityName")], block)) as [string];
      return clean(name);
    }),
  );
  missing.forEach((block, i) => names.set(block, found[i]!));
  return new Map(blocks.map((block) => [block, names.get(block)!]));
}
