import { encodeEventTopics, numberToHex, parseEventLogs, type Address, type Hex, type RpcLog } from "viem";
import { doubleEspressoAbi, matchaLatteAbi, rewardsAbi } from "./abi.ts";
import type { Amount } from "./tokens.ts";
import { memo } from "./cache.ts";
import { AUTOMATIONS, DOUBLE_ESPRESSO, MATCHA_LATTE, type Automation } from "./config.ts";
import { WEEK, moneyAt, weekStart, type Money } from "./format.ts";
import { escrow, type Account, type Holdings } from "./hydrex.ts";
import { key, quotesOf, worthOf, type Prices } from "./prices.ts";
import { rewardsFor, tokensIn, type Earnings, type Reward } from "./rewards.ts";
import {
  blockNumber,
  blockTime,
  call,
  firstBlockAt,
  now,
  read,
  readEach,
  required,
  rpc,
  same,
  settledBelow,
  tagged,
  timeAt,
} from "./rpc.ts";

// For each account and token, Hydrex's reward contracts record the start of the epoch they have paid it up to; every
// claim, even of nothing, sets it to the current epoch. An epoch counts as paid once the records holding more than half
// its rewards' worth, at today's quotes, have moved past its end. A search through past blocks then finds the last
// payout's block, whose logs make its receipt: Matcha Latte pays each account in one transaction that logs both the
// payout and the retirement; Double Espresso records each account's last claim block, and each claim logs the one
// before.

// A payout takes up to half a day after each flip.
const UNDER_WAY = 12 * 3600;
// Caps the blocks of Double Espresso claims read per account, since anyone can claim dust for an account as often as
// they like.
export const WALK_LIMIT = 10;

export type Pair = { contract: Address; token: Address };
export type Owed = Amount & { contract: Address };
// One of an epoch's reward pairs, with `value` the worth of what it paid the automation's votes at today's quotes, or 0
// if unknown.
type Weighed = Pair & { value: number };
type Rewards = { start: number; pairs: Weighed[] };
export type Standing = {
  id: bigint;
  // `through` is the start of the epoch it has been paid up to, and `pair` one whose record reached it in the last
  // payout. Undefined if never paid.
  paidUpTo?: { through: number; pair: Pair } | undefined;
  // `paid`: it voted with the automation last epoch and has been paid for it. `late`: it voted with the automation the
  // epoch before and has not been paid for that one.
  paid: boolean;
  late: boolean;
  // What it can claim now from each of last epoch's pairs; `unknown` if some could not be read.
  waiting: Owed[];
  unknown: boolean;
};
export type Records = { last: number[]; earned: (bigint | undefined)[]; before: number[] };

const sum = (values: number[]): number => values.reduce((total, value) => total + value, 0);
const positive = (tokens: readonly Address[], values: readonly bigint[]): Amount[] =>
  tokens.map((token, i) => ({ token, amount: values[i] ?? 0n })).filter(({ amount }) => amount > 0n);
export function summed(amounts: Amount[]): Amount[] {
  const all = new Map<string, Amount>();
  for (const { token, amount } of amounts)
    all.set(key(token), { token, amount: (all.get(key(token))?.amount ?? 0n) + amount });
  return [...all.values()];
}
const less = (amounts: Amount[], taken: Amount[]): Amount[] =>
  amounts
    .map(({ token, amount }) => ({
      token,
      amount: amount - (taken.find((each) => same(each.token, token))?.amount ?? 0n),
    }))
    .filter(({ amount }) => amount > 0n);
// A token without a price or decimals counts for nothing.
type Decimals = Map<string, { decimals: number }>;
export function valueAt(amounts: Amount[], decimals: Decimals, prices: Pick<Prices, "of">): number {
  return sum(
    amounts.map(({ token, amount }) => {
      const price = prices.of.get(key(token));
      const known = decimals.get(key(token));
      return known && price !== undefined ? worthOf(amount, known.decimals, price) : 0;
    }),
  );
}

// What amounts were worth, "at least" if one had no price or decimals; undefined if none counted.
export function worthAt(amounts: Amount[], decimals: Decimals, prices: Prices): Money | undefined {
  const total = valueAt(amounts, decimals, prices);
  const partial = amounts.some(({ token }) => !prices.of.has(key(token)) || !decimals.has(key(token)));
  return total > 0 ? moneyAt(total, prices, partial) : undefined;
}

const pairsOf = (rewards: Reward[]): Pair[] =>
  rewards.map(({ contract, token }) => ({ contract, token: token.address }));
export const weighed = (rewards: Reward[], quotes: Pick<Prices, "of">): Weighed[] =>
  rewards.map(({ contract, token, amount }) => ({
    contract,
    token: token.address,
    value: valueAt([{ token: token.address, amount }], new Map([[key(token.address), token]]), quotes),
  }));
const quotesFor = (rewards: Reward[]) => quotesOf(tokensIn(rewards), tagged("payouts"));
const weights = (pairs: Weighed[]): number[] =>
  pairs.some(({ value }) => value > 0) ? pairs.map(({ value }) => value) : pairs.map(() => 1);

// Whether claims since the epoch ended at `end` took more than half of what its rewards were worth, or more than half
// its pairs if none has a known worth; an epoch without rewards counts as paid. Half tells a payout from a claim of a
// few small rewards, and still counts a payout that leaves some tokens out.
export function paidFor(pairs: Weighed[], stamps: number[], end: number): boolean {
  if (!pairs.length) return true;
  const weight = weights(pairs);
  return 2 * sum(weight.filter((_, i) => stamps[i]! >= end)) > sum(weight);
}

// An account's standing from its records in last epoch's rewards and the epoch before's. `paidUpTo` follows payouts,
// not any claim: if late, it is the newest record up to the start of the epoch it is late for; if paid for last epoch
// or the one before, that epoch's end; otherwise the newest record, no later than last epoch's start if it voted then.
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
  const newest = (cap: number) =>
    held.reduce<{ through: number; pair: Pair } | undefined>(
      (found, { pair, stamp }) => (stamp > (found?.through ?? 0) && stamp <= cap ? { through: stamp, pair } : found),
      undefined,
    );
  const payout = (rewards: Rewards) => {
    const claimed = held.filter((item) => item.rewards === rewards && item.stamp >= rewards.start + WEEK);
    const best = claimed.reduce<(typeof claimed)[number] | undefined>(
      (found, item) => (!found || item.weight > found.weight ? item : found),
      undefined,
    );
    return best && { through: rewards.start + WEEK, pair: best.pair };
  };
  const paidUpTo = late
    ? newest(before.start)
    : ((paid ? payout(last) : undefined) ??
      (paidBefore ? payout(before) : undefined) ??
      newest(voted.last ? last.start : Infinity));
  return { id, paidUpTo, paid, late, waiting, unknown };
}

const cellsOf = <P extends Pair>(ids: bigint[], pairs: P[]) => ids.flatMap((id) => pairs.map((pair) => ({ id, pair })));
const stampOf = ({ id, pair }: { id: bigint; pair: Pair }) =>
  call(pair.contract, rewardsAbi, "tokenTimestamp", id, pair.token);
export async function readStamps(ids: bigint[], pairs: Pair[], block: number): Promise<Map<bigint, number[]>> {
  const found = await readEach(cellsOf(ids, pairs), { stamp: stampOf }, read, { block, tag: "payouts" });
  return new Map(
    ids.map((id) => [id, required(found.flatMap(({ item, stamp }) => (item.id === id ? [stamp] : []))).map(Number)]),
  );
}
// `earned()` reads at most 50 epochs from the account's last claim from the contract or, if it never claimed there,
// from the account's creation if that came after the contract's first incentives, or else from the week before them, as
// the contract does. Each claim moves this window on by up to 50 epochs.
const WINDOW = 50 * WEEK;
export const windowStart = (stamp: number, first: number, created: number): number =>
  stamp >= first ? stamp : created > first ? created : first - WEEK;
// How many times a claim must ask a contract to reach `epoch`, given where `earned()` starts.
export const passesTo = (start: number, epoch: number): number =>
  epoch < start ? 1 : Math.floor((epoch - start) / WINDOW) + 1;

// What each account can claim from each pair: `earned()`, plus `earnedTokenId` for each of `epochs` beyond its 50-epoch
// window, or only `earned()` if the window's start cannot be read. Each `earned()` sums up to 50 epochs and costs about
// a million gas, so calls go 20 to a batch.
type Owing<P> = { pair: P; amount: bigint | undefined; passes: number; stamp: number | undefined };
export async function readOwed<P extends Pair>(
  ids: bigint[],
  pairs: P[],
  block: number | "latest",
  epochs: number[],
): Promise<{ id: bigint; owing: Owing<P>[] }[]> {
  const cells = cellsOf(ids, pairs);
  const contracts = [...new Map(pairs.map(({ contract }) => [key(contract), contract])).values()];
  const at = { block, tag: "payouts" } as const;
  const [earned, stamps, firsts, points] = await Promise.all([
    readEach(cells, { amount: ({ id, pair }) => call(pair.contract, rewardsAbi, "earned", id, pair.token) }, read, {
      ...at,
      perBatch: 20,
    }),
    readEach(cells, { stamp: stampOf }, read, at),
    readEach(contracts, { first: (contract) => call(contract, rewardsAbi, "firstBribeTimestamp") }, read, at),
    readEach(ids, { point: (id) => escrow("getFirstEscrowPoint", id) }, read, at),
  ]);
  const stampOfCell = new Map(stamps.map(({ item, stamp }) => [item, stamp]));
  const firstOf = new Map(firsts.map(({ item, first }) => [key(item), first]));
  const createdOf = new Map(points.map(({ item, point }) => [item, point?.[1]]));
  const rows = earned.map(({ item: cell, amount }) => {
    const [stamp, first, created] = [
      stampOfCell.get(cell),
      firstOf.get(key(cell.pair.contract)),
      createdOf.get(cell.id),
    ];
    const start =
      stamp === undefined || first === undefined || (stamp < first && created === undefined)
        ? undefined
        : windowStart(Number(stamp), Number(first), weekStart(created ?? 0));
    return { ...cell, amount, passes: 1, stamp: stamp === undefined ? undefined : Number(stamp), start };
  });
  const past = await readEach(
    rows.flatMap((row) => {
      const start = row.start;
      return start === undefined
        ? []
        : epochs.filter((epoch) => epoch >= start + WINDOW).map((epoch) => ({ row, start, epoch }));
    }),
    { hidden: ({ row, epoch }) => call(row.pair.contract, rewardsAbi, "earnedTokenId", row.id, row.pair.token, epoch) },
    read,
    at,
  );
  for (const { item, hidden } of past) {
    const { row, start, epoch } = item;
    row.amount = row.amount === undefined || hidden === undefined ? undefined : row.amount + hidden;
    if (hidden) row.passes = Math.max(row.passes, passesTo(start, epoch));
  }
  return ids.map((id) => ({
    id,
    owing: rows.flatMap(({ id: of, pair, amount, passes, stamp }) =>
      of === id ? [{ pair, amount, passes, stamp }] : [],
    ),
  }));
}

// For each item that has reached its goal by block `to`, the first block after `from` where it has. Each step reads a
// whole group at its middle block and splits the group by the answer.
export async function firstReached<T>(
  reached: (block: number, items: T[]) => Promise<boolean[]>,
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
  if (items.length && to > from) {
    const atEnd = await reached(to, items);
    await narrow(
      items.filter((_, i) => atEnd[i]),
      from,
      to,
    );
  }
  return found;
}

const blockTimeAt = (block: number): Promise<number> => timeAt(block, tagged("payouts"));
const epochBlock = (epoch: number, top: number, time: number, above?: readonly [number, number]): Promise<number> =>
  memo(`first ${epoch}`, () => firstBlockAt(epoch, top, time, blockTimeAt, above));
export const readTime = async (block: number): Promise<number> =>
  Number(
    (await rpc<{ timestamp: Hex }>("eth_getBlockByNumber", [numberToHex(block), false], { tag: "payouts" })).timestamp,
  );
const timeOf = (block: number): Promise<number> => memo(`time ${block}`, () => readTime(block));

// Each account's last payout is the first block, from the start of epoch `paidUpTo.through`, in which `paidUpTo.pair`'s
// record reaches that epoch. Accounts paid up to the same epoch are searched together.
async function payoutBlocks(
  standings: Standing[],
  top: number,
  time: number,
  newest: readonly [number, number],
): Promise<Map<bigint, number>> {
  const blocks = new Map<bigint, number>();
  const paid = standings.flatMap(({ id, paidUpTo }) => (paidUpTo ? [{ id, ...paidUpTo }] : []));
  await Promise.all(
    [...new Set(paid.map(({ through }) => through))].map(async (epoch) => {
      const reached = async (block: number, items: typeof paid) =>
        required(await read(items.map(stampOf), { block, tag: "payouts" })).map((value) => value >= BigInt(epoch));
      const these = paid.filter(({ through }) => through === epoch);
      const found = await firstReached(reached, these, (await epochBlock(epoch, top, time, newest)) - 1, top);
      for (const [{ id }, block] of found) blocks.set(id, block);
    }),
  );
  return blocks;
}

type Placed = { blockNumber: bigint; logIndex: number };
const inOrder = (a: Placed, b: Placed): number => Number(a.blockNumber - b.blockNumber) || a.logIndex - b.logIndex;

// A Matcha Latte payout, from its logs. An account's `CarbonRetired` log, if any, comes just before its payout log in
// the same transaction.
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
export function payoutsOf(logs: RpcLog[]): Payout[] {
  const found: Payout[] = [];
  const retired = new Map<Hex, { tonnes: bigint; kvcm: bigint }>();
  for (const log of parseEventLogs({ abi: matchaLatteAbi, logs }).sort(inOrder)) {
    if (log.eventName === "CarbonRetired")
      retired.set(log.transactionHash, { tonnes: log.args.retireTonnes, kvcm: log.args.kvcmSpent });
    if (log.eventName !== "ClaimSwapAndDistributeCompleted") continue;
    const {
      tokenId,
      owner,
      recipient,
      claimedTokens,
      claimedAmounts,
      distributedTokens,
      distributedAmounts,
      treasuryFees,
    } = log.args;
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
// A block's payouts, from one read of its logs. The last claim may have been made by someone else, leaving no Matcha
// Latte log, so an empty answer is accepted only once no RPC has any logs, and is not cached.
const logsOf = new Map<number, Payout[]>();
async function payoutsIn(block: number): Promise<Payout[]> {
  const known = logsOf.get(block);
  if (known) return known;
  const logs = await rpc<RpcLog[]>(
    "eth_getLogs",
    [{ address: MATCHA_LATTE.address, fromBlock: numberToHex(block), toBlock: numberToHex(block) }],
    {
      tag: "payouts",
      want: (found) => found.length > 0,
    },
  );
  const payouts = payoutsOf(logs);
  if (logs.length) logsOf.set(block, payouts);
  return payouts;
}

// A Double Espresso claim, from its `Claimed` log; `claimsOf` lists them newest first. `previous` is the claim block
// recorded before this one.
export type ClaimLog = {
  id: bigint;
  owner: Address;
  caller: Address;
  received: Amount[];
  fees: Amount[];
  previous: number;
  tx: Hex;
  block: number;
};
export type Walk = { claims: ClaimLog[]; stopped: boolean };
export const claimed = (logs: RpcLog[]) =>
  parseEventLogs({ abi: doubleEspressoAbi, eventName: "Claimed", logs }).map((log) => ({
    log,
    id: log.args.tokenId,
    owner: log.args.owner,
    caller: log.args.caller,
    received: positive(log.args.tokens, log.args.amounts),
    fees: positive(log.args.tokens, log.args.fees),
    previous: Number(log.args.previousClaimBlock),
  }));
export const claimsOf = (logs: RpcLog[]): ClaimLog[] =>
  claimed(logs)
    .sort((a, b) => inOrder(b.log, a.log))
    .map(({ log, ...claim }) => ({ ...claim, tx: log.transactionHash, block: Number(log.blockNumber) }));
export function totals(claims: Pick<ClaimLog, "received" | "fees">[]) {
  const received = summed(claims.flatMap((claim) => claim.received));
  const fees = summed(claims.flatMap((claim) => claim.fees));
  return { received, fees, paid: less(received, fees) };
}

// Walks each account's claims back from its last claim block `from` to `since`, the first block of that claim's epoch.
// A block can hold several claims of one account: the first points back to an earlier block, the later ones to the
// block itself.
export async function walkClaims(
  starts: Map<bigint, { from: number; since: number }>,
  claimsAt: (block: number, ids: bigint[]) => Promise<ClaimLog[]>,
  limit = WALK_LIMIT,
): Promise<Map<bigint, Walk>> {
  const walks = new Map<bigint, Walk>([...starts.keys()].map((id) => [id, { claims: [], stopped: false }]));
  let at = new Map([...starts].flatMap(([id, { from }]) => (from > 0 ? [[id, from] as const] : [])));
  for (let round = 1; at.size; round++) {
    const found = new Map(
      await Promise.all(
        [...new Set(at.values())].map(
          async (block) =>
            [
              block,
              await claimsAt(
                block,
                [...at].flatMap(([id, current]) => (current === block ? [id] : [])),
              ),
            ] as const,
        ),
      ),
    );
    const next = new Map<bigint, number>();
    for (const [id, current] of at) {
      const walk = walks.get(id)!;
      const mine = (found.get(current) ?? []).filter((claim) => claim.id === id && claim.block === current);
      // A claim that received nothing paid nothing, so the receipt leaves it out; the walk still follows it back.
      walk.claims.push(...mine.filter(({ received }) => received.length));
      const before = Math.min(...mine.map(({ previous }) => previous).filter((previous) => previous < current));
      if (!Number.isFinite(before) || before === 0 || before < starts.get(id)!.since) continue;
      if (round >= limit) walk.stopped = true;
      else next.set(id, before);
    }
    at = next;
  }
  return walks;
}
// Some accounts' claims in a block, cached once found. An RPC whose logs lack one of them is behind, so the next is
// asked; if none has it, it is not cached and is read again next time.
const claimsIn = new Map<string, ClaimLog[]>();
async function claimsAt(block: number, ids: bigint[]): Promise<ClaimLog[]> {
  const missing = ids.filter((id) => !claimsIn.has(`${block} ${id}`));
  let found: ClaimLog[] = [];
  if (missing.length) {
    const filter = {
      address: DOUBLE_ESPRESSO.address,
      fromBlock: numberToHex(block),
      toBlock: numberToHex(block),
      topics: encodeEventTopics({ abi: doubleEspressoAbi, eventName: "Claimed", args: { tokenId: missing } }),
    };
    const logs = await rpc<RpcLog[]>("eth_getLogs", [filter], {
      tag: "payouts",
      want: (found) => missing.every((id) => claimsOf(found).some((claim) => claim.id === id)),
    });
    found = claimsOf(logs);
    for (const id of missing) {
      const mine = found.filter((claim) => claim.id === id);
      if (mine.length) claimsIn.set(`${block} ${id}`, mine);
    }
  }
  return ids.flatMap((id) => claimsIn.get(`${block} ${id}`) ?? found.filter((claim) => claim.id === id));
}

// An account in one of the page's automations, as `automation`, which it may be joining or leaving. `voter` is the
// automation it voted with last epoch, or else `automation`, whose pools hold its rewards and set its `standing`. Its
// last payout's receipt is `payout` or `walk`; `note`, if set, says why there is none.
type Entry = {
  automation: Automation;
  voter: Automation;
  account: Account;
  standing?: Standing | undefined;
  // Undefined when the voter's figures or the automation's payouts could not be read, or the figures are not final yet,
  // which `early` marks.
  earnings?: Earnings | undefined;
  early: boolean;
  // It voted with the automation last epoch and the automation still holds its claims, so a payout is due.
  due: boolean;
  block?: number | undefined;
  time?: number | undefined;
  payout?: Payout | undefined;
  walk?: Walk | undefined;
  note?: "outside" | "unclaimed" | undefined;
};
// `unread` if some rewards could not be weighed, so that the payouts are read again soon.
export type Payouts = { epochStart: number; entries: Entry[]; unread?: true };

export const automationOf = ({ delegate, claimer, delegateAtStart }: Account): Automation | undefined =>
  AUTOMATIONS.find(({ address }) => same(delegate, address) || same(claimer, address)) ??
  AUTOMATIONS.find(({ address }) => same(delegateAtStart, address));

type Part = Pick<Entry, "block" | "time" | "payout" | "walk" | "note">;
async function matchaLatteParts(
  ids: bigint[],
  standings: Promise<(Standing | undefined)[]>,
  top: number,
  time: number,
  newest: readonly [number, number],
): Promise<Map<bigint, Part>> {
  const blocks = await payoutBlocks(
    (await standings).filter((standing) => !!standing),
    top,
    time,
    newest,
  );
  const unique = [...new Set(blocks.values())];
  const [paid, times] = await Promise.all([
    Promise.all(unique.map(payoutsIn)),
    Promise.all(unique.map(async (block) => [block, await timeOf(block)] as const)).then((each) => new Map(each)),
  ]);
  return new Map(
    ids.map((id): [bigint, Part] => {
      const block = blocks.get(id);
      if (block === undefined) return [id, {}];
      const payout = paid
        .flat()
        .filter((each) => each.id === id && each.block === block)
        .at(-1);
      return [id, { block, time: times.get(block), payout, note: payout ? undefined : "outside" }];
    }),
  );
}
async function doubleEspressoParts(ids: bigint[], top: number): Promise<Map<bigint, Part>> {
  const found = await readEach(
    ids,
    { last: (id) => call(DOUBLE_ESPRESSO.address, doubleEspressoAbi, "lastClaimBlock", id) },
    read,
    { block: top, tag: "payouts" },
  );
  const lasts = await Promise.all(
    found.map(async ({ item: id, last }) => {
      const block = Number(required([last])[0]);
      const time = block ? await timeOf(block) : undefined;
      const since = time === undefined ? 0 : await epochBlock(weekStart(time), block, time);
      return { id, block, time, since };
    }),
  );
  const walks = await walkClaims(new Map(lasts.map(({ id, block, since }) => [id, { from: block, since }])), claimsAt);
  return new Map(
    lasts.map(({ id, block, time }): [bigint, Part] => {
      const walk = walks.get(id)!;
      return [id, { block: block || undefined, time, walk, note: walk.claims.length ? undefined : "unclaimed" }];
    }),
  );
}

// `earningsOf` returns what an automation's votes earned in Hydrex's last epoch, so until Hydrex moves on after a flip,
// it returns the epoch before.
export async function readPayouts(
  holdings: Holdings,
  earningsOf: (automation: Automation) => Promise<Earnings>,
): Promise<Payouts> {
  const { epochStart } = holdings;
  const members = holdings.accounts.flatMap((account) => {
    const automation = automationOf(account);
    return automation ? [{ account, automation }] : [];
  });
  if (!members.length) return { epochStart, entries: [] };
  const ids = members.map(({ account }) => account.id);
  const newest = required(await read([blockNumber, blockTime], { tag: "payouts" })).map(Number) as [number, number];
  const top = settledBelow(newest[0]);
  const at = { block: top, tag: "payouts" } as const;
  const [[time], held] = await Promise.all([
    read([blockTime], at).then(required),
    readEach(
      ids,
      {
        last: (id) => escrow("delegates", id, epochStart - WEEK),
        before: (id) => escrow("delegates", id, epochStart - 2 * WEEK),
      },
      read,
      at,
    ),
  ]);
  const delegates = new Map(held.map(({ item, ...each }) => [item, each]));
  const votedWith = (automation: Automation, id: bigint, epoch: "last" | "before"): boolean =>
    same(delegates.get(id)?.[epoch] ?? "", automation.address);
  type Member = (typeof members)[number];
  const voterOf = ({ account, automation }: Member): Automation =>
    AUTOMATIONS.find((each) => votedWith(each, account.id, "last")) ?? automation;
  const groups = (of: (member: Member) => Automation) =>
    [...new Set(members.map(of))].map(
      (automation) =>
        [automation, members.filter((member) => of(member) === automation).map(({ account }) => account.id)] as const,
    );

  const found = new Map<bigint, { earnings?: Earnings; standing?: Standing | undefined; early?: true }>();
  let unweighed = false;
  const standings = Promise.all(
    groups(voterOf).map(async ([automation, these]) => {
      const earnings = await earningsOf(automation).catch(() => undefined);
      if (!earnings) return;
      if (earnings.start < epochStart - WEEK) return these.forEach((id) => found.set(id, { early: true }));
      const votedBefore = these.filter((id) => votedWith(automation, id, "before"));
      const readBefore = async () => {
        const rewards = votedBefore.length ? await rewardsFor(automation.address, earnings.start - WEEK) : [];
        const [stamps, quotes] = await Promise.all([
          readStamps(votedBefore, pairsOf(rewards), top),
          quotesFor(rewards),
        ]);
        return { rewards, stamps, quotes };
      };
      const owed = await Promise.all([
        readOwed(these, pairsOf(earnings.rewards), top, [earnings.start - WEEK, earnings.start]).then((rows) =>
          rows.map(({ id, owing }) => ({
            id,
            earned: owing.map(({ amount }) => amount),
            stamps: required(owing.map(({ stamp }) => stamp)),
          })),
        ),
        readBefore(),
        quotesFor(earnings.rewards),
      ]).catch(() => undefined);
      if (!owed) return;
      const [rows, epochBefore, quotes] = owed;
      if (quotes.unread || epochBefore.quotes.unread) unweighed = true;
      const last = { start: earnings.start, pairs: weighed(earnings.rewards, quotes) };
      const before = { start: earnings.start - WEEK, pairs: weighed(epochBefore.rewards, epochBefore.quotes) };
      const stampsBefore = epochBefore.stamps;
      rows.forEach(({ id, earned, stamps }) => {
        const records = { last: stamps, earned, before: stampsBefore.get(id) ?? [] };
        const voted = { last: votedWith(automation, id, "last"), before: votedWith(automation, id, "before") };
        const standing =
          last.pairs.length || before.pairs.length ? standingOf(id, last, before, records, voted) : undefined;
        found.set(id, { earnings, standing });
      });
    }),
  );
  const parts = new Map<bigint, Part>();
  await Promise.all(
    groups(({ automation }) => automation).map(async ([automation, these]) => {
      const theirs = standings.then(() => these.map((id) => found.get(id)?.standing));
      const reading =
        automation === MATCHA_LATTE
          ? matchaLatteParts(these, theirs, top, Number(time), newest)
          : doubleEspressoParts(these, top);
      const each = await reading.catch((error: unknown) => void console.error(error));
      each?.forEach((part, id) => parts.set(id, part));
    }),
  );
  await standings;
  const entries = members.map((member): Entry => {
    const { account, automation } = member;
    const figures = found.get(account.id);
    const part = parts.get(account.id);
    const known = part ? figures : undefined;
    const due = votedWith(automation, account.id, "last") && same(account.claimer, automation.address);
    return {
      ...part,
      automation,
      voter: voterOf(member),
      account,
      earnings: known?.earnings,
      standing: known?.standing,
      early: !!figures?.early,
      due,
    };
  });
  if (entries.every(({ earnings, early }) => !earnings && !early))
    throw new Error("No automation's payouts could be read.");
  return { epochStart, entries, ...(unweighed ? { unread: true as const } : {}) };
}

// A payout is under way when some due accounts have been paid since the flip and others not yet, and the first known
// payment was less than half a day ago.
export function underWay({ entries }: Payouts): { paid: Entry[]; left: Entry[] } | undefined {
  const paid = entries.filter((entry) => entry.due && entry.standing?.paid);
  const left = entries.filter((entry) => entry.due && !entry.standing?.paid);
  const times = paid.flatMap(({ time }) => (time === undefined ? [] : [time]));
  return times.length && left.length && now() - Math.min(...times) < UNDER_WAY ? { paid, left } : undefined;
}
// Whether a payout due since the flip has yet to arrive. While it has not, the page rereads payouts every five minutes.
export const awaited = ({ entries }: Payouts): boolean =>
  entries.some(
    ({ due, standing }) => due && standing && !standing.paid && (standing.waiting.length || standing.unknown),
  );
// A Double Espresso payout is overdue, and the owner can claim it, once it is late for the epoch before, or once
// something still waits unclaimed half a day after the flip.
export type Overdue = Entry & { standing: Standing; earnings: Earnings };
export function overdue({ entries, epochStart }: Payouts): Overdue[] {
  return entries.filter((entry): entry is Overdue => {
    const { automation, account, standing, earnings, due } = entry;
    if (automation !== DOUBLE_ESPRESSO || !standing || !earnings || !same(account.claimer, DOUBLE_ESPRESSO.address))
      return false;
    const waits = standing.waiting.length > 0 || standing.unknown;
    return standing.late || (due && !standing.paid && waits && now() - epochStart >= UNDER_WAY);
  });
}
