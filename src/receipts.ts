import { decodeEventLog, numberToHex, parseAbi, type Address, type Hex } from "viem";
import { blockTime, call, read, readLater, required, rpc, type Call } from "./chain.ts";
import { CARBON_IMPACT } from "./config.ts";
import { WEEK, clean } from "./format.ts";
import type { Reward } from "./earnings.ts";
import { carbonImpact } from "./hydrex.ts";
import { usdOf, type Token } from "./prices.ts";

// Hydrex's reward contracts record, for each account and token, the start of the epoch up to which they have paid the
// account. Every claim sets it to the start of the current epoch, even when nothing was owed, and it only grows. A claim
// can take any of the tokens, so one record says little: an epoch counts as paid once the records of more than half of
// what its rewards were worth have moved past its end. A search through past blocks then finds the block in which the
// payout's own record moved: the block of the last payout. Carbon Impact pays each account in one transaction: it
// claims the account's rewards, swaps them to kVCM, retires a share, and sends the rest to the owner's payout address,
// with one event for the retirement and one for the payout. The free RPCs give logs sparingly, so the page reads one
// block of logs per payout, and no more.

const eventsAbi = parseAbi([
  "event CarbonRetired(address indexed creditToken_, uint256 retireTonnes, uint256 kvcmSpent)",
  "event ClaimSwapAndDistributeCompleted(uint256 indexed tokenId, address indexed owner, address indexed recipient, address[] claimedTokens, uint256[] claimedAmounts, address[] distributedTokens, uint256[] distributedAmounts, uint256[] treasuryFees)",
]);
const rewardsAbi = parseAbi([
  "function tokenTimestamp(uint256 tokenId, address token) view returns (uint256)",
  "function earned(uint256 tokenId, address token) view returns (uint256)",
]);

// Base makes a block every two seconds, which places a block of a given time nearly at once. Each read of a block's own
// time then corrects the guess, so that what is found holds whatever the block time.
export const BLOCK_TIME = 2;
// The newest blocks are skipped: an RPC that is a little behind may not have them yet.
export const SETTLED = 5;

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
export type Log = { data: Hex; topics: [Hex, ...Hex[]]; transactionHash: Hex; logIndex: Hex; blockNumber: Hex };

// A log's place in the chain, to sort logs by.
export const order = (log: Log): bigint => BigInt(log.blockNumber) * 1_000_000n + BigInt(log.logIndex);

// The amounts above zero, token by token.
export const positive = (tokens: readonly Address[], values: readonly bigint[]): Amount[] =>
  tokens.map((token, i) => ({ token, amount: values[i] ?? 0n })).filter(({ amount }) => amount > 0n);

// Reads, at one block, whether each item has reached what it waits for.
export type Reached<T> = (block: number, items: T[]) => Promise<boolean[]>;

// The first block after `from`, and up to `to`, at which each item has reached what it waits for, if it has by `to`.
// Each item must not have reached it at `from`, and once reached, stays so. Each step reads every item of a group at
// the middle block, and the group splits by whether they have reached it, so items that reach it in the same block are
// read together to the end.
export async function firstReached<T>(
  reached: Reached<T>,
  items: T[],
  from: number,
  to: number,
): Promise<Map<T, number>> {
  const found = new Map<T, number>();
  const narrow = async (group: T[], lower: number, upper: number): Promise<void> => {
    if (!group.length) return;
    if (upper - lower <= 1) return void group.forEach((item) => found.set(item, upper));
    const middle = Math.floor((lower + upper) / 2);
    const now = await reached(middle, group);
    await Promise.all([
      narrow(
        group.filter((_, i) => now[i]),
        lower,
        middle,
      ),
      narrow(
        group.filter((_, i) => !now[i]),
        middle,
        upper,
      ),
    ]);
  };
  if (!items.length || to <= from) return found;
  const atEnd = await reached(to, items);
  await narrow(
    items.filter((_, i) => atEnd[i]),
    from,
    to,
  );
  return found;
}

// A token that one of Hydrex's reward contracts pays.
export type Pair = { contract: Address; token: Address };
// An amount of a token that a reward contract owes.
export type Owed = Amount & { contract: Address };
// A pair among an epoch's rewards, with what it paid the automation's votes in dollars, or 0 if that is unknown. An
// account's share is the same in each, so this weighs the pairs for every account.
export type Weighed = Pair & { usd: number };
// An automation's rewards in the epoch from `start`.
export type Rewards = { start: number; pairs: Weighed[] };
export type Standing = {
  id: bigint;
  // The start of the epoch up to which the account has been paid, or 0 if it never has, and a pair whose record
  // reached it in its last payout.
  through: number;
  pair?: Pair;
  // Whether it voted with the automation last epoch and has been paid for it, and whether it voted with it in the
  // epoch before and has not been paid for that yet, a week after it ended.
  paid: boolean;
  late: boolean;
  // What it can claim now from each of last epoch's pairs, looking back at most 50 epochs.
  waiting: Owed[];
  // Whether what it can claim from some pairs could not be read, so that there is at least `waiting`.
  unknown: boolean;
};
// What the page reads of an account: its record in each of last epoch's pairs, and what it can claim from each, and its
// record in each of the epoch before's, if it voted with the automation then.
export type Records = { last: number[]; earned: (bigint | undefined)[]; before: number[] };

// Each of an epoch's rewards, weighed at the given prices: last epoch's, for the epoch before's too.
export const weighed = (rewards: Reward[], prices: Map<string, number>): Weighed[] =>
  rewards.map(({ contract, token, amount }) => {
    const price = prices.get(token.address.toLowerCase());
    return { contract, token: token.address, usd: price === undefined ? 0 : usdOf(amount, token.decimals, price) };
  });

// The read of an account's record in a pair.
export const stampOf = (id: bigint, { contract, token }: Pair): Call =>
  call(contract, rewardsAbi, "tokenTimestamp", id, token);

// Each pair's weight: its dollars, or the same for each when none has a price.
function weights(pairs: Weighed[]): number[] {
  const priced = pairs.some(({ usd }) => usd > 0);
  return pairs.map(({ usd }) => (priced ? usd : 1));
}

const sum = (values: number[]): number => values.reduce((total, value) => total + value, 0);

// Whether claims since an epoch ended, at `end`, took more than half of what its rewards were worth: that is a payout
// for the epoch. A claim of a few of the rewards is not, such as anyone may make through AutoMaxi; nor do the tokens a
// keeper leaves out, such as those it cannot swap, keep a payout from counting. `stamps` are the account's records.
export function paidFor(pairs: Weighed[], stamps: number[], end: number): boolean {
  if (!pairs.length) return true;
  const weight = weights(pairs);
  return 2 * sum(weight.filter((_, i) => stamps[i]! >= end)) > sum(weight);
}

// The fewest pairs worth at least half of all: a payout, which takes more than half, claims one of them, so their
// records show when it has come.
export function watchedOf(pairs: Weighed[]): Weighed[] {
  const weight = weights(pairs);
  const total = sum(weight);
  const watched: Weighed[] = [];
  let taken = 0;
  for (const i of pairs.map((_, i) => i).sort((a, b) => weight[b]! - weight[a]!)) {
    if (watched.length && 2 * taken >= total) break;
    watched.push(pairs[i]!);
    taken += weight[i]!;
  }
  return watched;
}

// An account's standing in an automation's reward contracts, from its records, in the rewards of last epoch and of the
// one before, and whether it voted with the automation in each. Up to when it has been paid goes by payouts, not by
// any claim:
// - late, the newest record from before the epoch it is late for;
// - paid for last epoch, its start;
// - paid for the epoch before, the start of last epoch;
// - in neither, the newest record from before last epoch, if it voted with the automation then; or else the newest.
export function standingOf(
  id: bigint,
  last: Rewards,
  before: Rewards,
  records: Records,
  voted: { last: boolean; before: boolean },
): Standing {
  const waiting: Owed[] = [];
  let unknown = false;
  last.pairs.forEach(({ contract, token }, i) => {
    const amount = records.earned[i];
    if (amount === undefined) unknown = true;
    else if (amount > 0n) waiting.push({ contract, token, amount });
  });
  const paid = voted.last && paidFor(last.pairs, records.last, last.start + WEEK);
  const paidBefore = voted.before && paidFor(before.pairs, records.before, before.start + WEEK);
  const late = voted.before && !paidBefore;
  const held = [
    { rewards: last, stamps: records.last },
    ...(voted.before ? [{ rewards: before, stamps: records.before }] : []),
  ].flatMap(({ rewards, stamps }) => {
    const weight = weights(rewards.pairs);
    return rewards.pairs.map(({ contract, token }, i) => ({
      rewards,
      pair: { contract, token },
      stamp: stamps[i]!,
      weight: weight[i]!,
    }));
  });
  // The newest record up to `cap`.
  const newest = (cap: number) =>
    held.reduce<{ through: number; pair?: Pair }>(
      (found, { pair, stamp }) => (stamp > found.through && stamp <= cap ? { through: stamp, pair } : found),
      { through: 0 },
    );
  // The payout for an epoch, through the pair worth the most among those claimed since it ended.
  const payout = (rewards: Rewards) => {
    const claimed = held.filter((item) => item.rewards === rewards && item.stamp >= rewards.start + WEEK);
    const best = claimed.reduce<(typeof claimed)[number] | undefined>(
      (found, item) => (!found || item.weight > found.weight ? item : found),
      undefined,
    );
    return best && { through: rewards.start + WEEK, pair: best.pair };
  };
  const standing =
    (late && newest(before.start)) ||
    (paid && payout(last)) ||
    (paidBefore && payout(before)) ||
    newest(voted.last ? last.start : Infinity);
  return { id, ...standing, paid, late, waiting, unknown };
}

// earned() adds up to 50 epochs one by one, so a call can take about a million gas: 20 fit well within the 50 million
// that RPCs allow an eth_call.
const EARNED_PER_BATCH = 20;

const reads = (ids: bigint[], pairs: Pair[], name: "tokenTimestamp" | "earned") =>
  ids.flatMap((id) => pairs.map(({ contract, token }) => call(contract, rewardsAbi, name, id, token)));
const byAccount = <T>(values: T[], ids: bigint[], pairs: Pair[]): T[][] =>
  ids.map((_, a) => values.slice(a * pairs.length, (a + 1) * pairs.length));

// Each account's record in each pair, at a block.
export async function readStamps(
  ids: bigint[],
  pairs: Pair[],
  block: number,
  reader: typeof read = readLater,
): Promise<number[][]> {
  const values = required(await reader(reads(ids, pairs, "tokenTimestamp"), block)) as bigint[];
  return byAccount(values.map(Number), ids, pairs);
}

// What each account can claim from each pair, at a block, or undefined where it could not be read.
export async function readEarned(
  ids: bigint[],
  pairs: Pair[],
  block: number,
  reader: typeof read = readLater,
): Promise<(bigint | undefined)[][]> {
  const values = await reader(reads(ids, pairs, "earned"), block, true, EARNED_PER_BATCH);
  return byAccount(values as (bigint | undefined)[], ids, pairs);
}

// Dollars at the given prices. A token without a price, or whose decimals are unknown, counts for nothing.
export function dollars(found: Amount[], tokens: Map<string, Token>, prices: Map<string, number>): number {
  return found.reduce((sum, { token, amount }) => {
    const [known, price] = [tokens.get(token.toLowerCase()), prices.get(token.toLowerCase())];
    return known && price !== undefined ? sum + usdOf(amount, known.decimals, price) : sum;
  }, 0);
}

// The first block whose time is at least `time`, from a block `top` of time `topTime` at or after it. Each guess places
// the block by the time between the closest blocks known on either side; after a few, the rest halve the range.
export async function firstBlockAt(
  time: number,
  top: number,
  topTime: number,
  reader: typeof read = readLater,
): Promise<number> {
  let [lo, loTime] = [-1, 0];
  let [hi, hiTime] = [top, topTime];
  for (let step = 0; hi - lo > 1; step++) {
    const gap = lo < 0 ? BLOCK_TIME : (hiTime - loTime) / (hi - lo);
    const placed = hi - Math.ceil((hiTime - time) / gap);
    const guess = step < 4 ? Math.min(hi - 1, Math.max(lo + 1, placed)) : Math.floor((lo + hi) / 2);
    const [at] = required(await reader([blockTime], guess)) as [bigint];
    if (Number(at) >= time) [hi, hiTime] = [guess, Number(at)];
    else [lo, loTime] = [guess, Number(at)];
  }
  return hi;
}

// An epoch's first block never changes, so each is found once.
const firsts = new Map<number, Promise<number>>();

// The first block of the epoch that starts at `epoch`, from a block `top` of time `topTime` in it or after it.
export function epochBlock(
  epoch: number,
  top: number,
  topTime: number,
  reader: typeof read = readLater,
): Promise<number> {
  const kept = firsts.get(epoch);
  if (kept) return kept;
  const found = firstBlockAt(epoch, top, topTime, reader);
  firsts.set(epoch, found);
  found.catch(() => firsts.get(epoch) === found && firsts.delete(epoch));
  return found;
}

// A search's result never changes once found, so each account's last payout block is kept with its epoch.
const searched = new Map<string, number>();

// The block of each account's last payout: the first block, from the one in which its paid-through epoch began, in
// which the pair that records that epoch reached it. No claim can record an epoch before it begins, which the search
// needs. Accounts paid through the same epoch are searched together. `top` is the block the standings were read at,
// and `time` its time.
export async function payoutBlocks(
  standings: Standing[],
  top: number,
  time: number,
  reader: typeof read = readLater,
): Promise<Map<bigint, number>> {
  const blocks = new Map<bigint, number>();
  const key = ({ id, through, pair }: Standing) => `${id} ${through} ${pair?.contract} ${pair?.token}`;
  const left = standings.filter((standing) => {
    const found = searched.get(key(standing));
    if (found !== undefined && found <= top) blocks.set(standing.id, found);
    return standing.pair && !blocks.has(standing.id);
  });
  const epochs = [...new Set(left.map(({ through }) => through))];
  await Promise.all(
    epochs.map(async (epoch) => {
      const reached: Reached<Standing> = async (block, items) => {
        const values = required(
          await reader(
            items.map(({ id, pair }) => stampOf(id, pair!)),
            block,
          ),
        ) as bigint[];
        return values.map((value) => value >= BigInt(epoch));
      };
      const from = (await epochBlock(epoch, top, time, reader)) - 1;
      const found = await firstReached(
        reached,
        left.filter(({ through }) => through === epoch),
        from,
        top,
      );
      for (const [standing, block] of found) {
        searched.set(key(standing), block);
        blocks.set(standing.id, block);
      }
    }),
  );
  return blocks;
}

// The payouts in some blocks' logs. An account's retirement, if any, comes just before its payout, in the same
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

// Carbon Impact's payouts in each block, from one read of the block's logs. Each block holds an account's last claim,
// but the claim may have been made elsewhere, with no log of Carbon Impact's, and Hydrex's reward contracts log nothing
// when they pay nothing. So no logs is taken only once no RPC has any, and is read again next time, in case the RPCs that
// had them did not answer. A block with logs is read once.
const logsOf = new Map<number, Payout[]>();

export async function payoutsIn(blocks: number[]): Promise<Payout[]> {
  const all = [...new Set(blocks)];
  const found = await Promise.all(
    all.map(async (block) => {
      const kept = logsOf.get(block);
      if (kept) return kept;
      const logs = await rpc<Log[]>(
        "eth_getLogs",
        [{ address: CARBON_IMPACT.address, fromBlock: numberToHex(block), toBlock: numberToHex(block) }],
        { later: true, doubt: (logs) => Array.isArray(logs) && !logs.length },
      );
      const paid = payouts(logs);
      if (logs.length) logsOf.set(block, paid);
      return paid;
    }),
  );
  return found.flat();
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
      const [name] = required(await readLater([carbonImpact("retiringEntityName")], block)) as [string];
      return clean(name);
    }),
  );
  missing.forEach((block, i) => names.set(block, found[i]!));
  return new Map(blocks.map((block) => [block, names.get(block)!]));
}

// For tests: what the reads above found is kept for the rest of the session.
export function forgetReads(): void {
  for (const kept of [searched, firsts, logsOf, times, names]) kept.clear();
}
