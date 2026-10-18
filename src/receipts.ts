import { decodeEventLog, parseAbi, type Address, type Hex } from "viem";
import { call, read, rpc } from "./chain.ts";
import { CONDUIT } from "./config.ts";
import type { Token } from "./prices.ts";

// Carbon Impact pays out by calling claimSwapAndDistribute once for each account: it claims the account's rewards,
// swaps them to kVCM, retires a share, and pays the rest to the owner's payout address, with an event for the
// retirement and one for the payout. Base's free RPCs give the logs of a few hundred blocks at a time at most, so a week
// of them is out of reach. The run is found by what it changes instead: totalTonnesRetired only grows, so a search
// through past blocks finds where it last changed, and the logs of those few blocks hold the run.

const conduitAbi = parseAbi(["function totalTonnesRetired() view returns (uint256)"]);
const eventsAbi = parseAbi([
  "event CarbonRetired(address indexed creditToken_, uint256 retireTonnes, uint256 kvcmSpent)",
  "event ClaimSwapAndDistributeCompleted(uint256 indexed tokenId, address indexed owner, address indexed recipient, address[] claimedTokens, uint256[] claimedAmounts, address[] distributedTokens, uint256[] distributedAmounts, uint256[] treasuryFees)",
]);
const tokenAbi = parseAbi(["function symbol() view returns (string)", "function decimals() view returns (uint8)"]);

// Base makes a block every two seconds.
export const BLOCKS_PER_WEEK = 302_400;
const BLOCKS_PER_DAY = 43_200;
// How far back the page looks for a payout.
export const WEEKS = 8;

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
};
export type Run = { block: number; time: number; payouts: Payout[] };
export type Log = { data: Hex; topics: [Hex, ...Hex[]]; transactionHash: Hex; logIndex: Hex; blockNumber: Hex };

// The total retired at a block.
export type Reader = (block: number) => Promise<bigint>;

// The first block at which the total is what it is now, after a block at which it was lower.
export async function lastChange(at: Reader, lower: number, upper: number, now: bigint): Promise<number> {
  while (upper - lower > 1) {
    const middle = Math.floor((lower + upper) / 2);
    if ((await at(middle)) === now) upper = middle;
    else lower = middle;
  }
  return upper;
}

// Every block after from, up to to, at which the total changed, from the totals at both ends.
export async function changes(at: Reader, from: number, to: number, before: bigint, after: bigint): Promise<number[]> {
  if (before === after) return [];
  if (to - from === 1) return [to];
  const middle = Math.floor((from + to) / 2);
  const between = await at(middle);
  return [...(await changes(at, from, middle, before, between)), ...(await changes(at, middle, to, between, after))];
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
    });
  }
  return found;
}

const hex = (n: number): Hex => `0x${n.toString(16)}`;

async function tonnesAt(block: number): Promise<bigint> {
  const [total] = await read([call(CONDUIT, conduitAbi, "totalTonnesRetired")], block);
  if (total === undefined) throw new Error("A read from Base failed.");
  return total as bigint;
}

// The automation's last payout, for all its accounts, or none if it made none in the last WEEKS weeks. About 30 reads.
export async function lastRun(): Promise<Run | undefined> {
  const head = Number(await rpc<Hex>("eth_blockNumber", []));
  const now = await tonnesAt(head);
  let lower = head;
  for (let week = 1; ; week++) {
    if (week > WEEKS || lower === 0) return undefined;
    lower = Math.max(0, head - week * BLOCKS_PER_WEEK);
    if ((await tonnesAt(lower)) < now) break;
  }
  const last = await lastChange(tonnesAt, lower, head, now);
  // A run may take more than one transaction: the day before its last holds the others.
  const from = Math.max(lower, last - BLOCKS_PER_DAY);
  const before =
    last - 1 > from ? await changes(tonnesAt, from, last - 1, await tonnesAt(from), await tonnesAt(last - 1)) : [];
  const blocks = [...before, last];
  const [logs, block] = await Promise.all([
    Promise.all(
      blocks.map((b) => rpc<Log[]>("eth_getLogs", [{ address: CONDUIT, fromBlock: hex(b), toBlock: hex(b) }])),
    ),
    rpc<{ timestamp: Hex }>("eth_getBlockByNumber", [hex(last), false]),
  ]);
  return { block: last, time: Number(block.timestamp), payouts: payouts(logs.flat()) };
}

// The symbol and decimals of each token, for those that answer.
export async function readTokens(addresses: Address[]): Promise<Token[]> {
  const found = await read(
    addresses.flatMap((address) => [call(address, tokenAbi, "symbol"), call(address, tokenAbi, "decimals")]),
  );
  return addresses.flatMap((address, i) => {
    const [symbol, decimals] = [found[2 * i], found[2 * i + 1]];
    return typeof symbol === "string" && typeof decimals === "number" ? [{ address, symbol, decimals }] : [];
  });
}
