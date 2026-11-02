import { encodeEventTopics, numberToHex, parseEventLogs, type Address, type Hex, type RpcLog } from "viem";
import { doubleEspressoAbi, matchaLatteAbi, rewardsAbi } from "./abi.ts";
import type { Amount } from "./tokens.ts";
import { memo } from "./cache.ts";
import { AUTOMATIONS, DOUBLE_ESPRESSO, MATCHA_LATTE, type Automation } from "./config.ts";
import { WEEK, weekStart } from "./format.ts";
import { escrow, type Account, type Holdings } from "./hydrex.ts";
import { key, worthOf, type Prices } from "./prices.ts";
import { rewardsFor, type Earnings, type Reward } from "./rewards.ts";
import { blockTime, call, now, read, readEach, required, rpc, same } from "./rpc.ts";

// Hydrex's reward contracts record, for each account and token, the start of the epoch up to which they have paid it:
// every claim sets it to the current epoch, even of nothing. An epoch counts as paid once the records of more than half
// of what its rewards were worth have moved past its end. A search through past blocks then finds the block of the
// last payout, whose logs make its receipt. Matcha Latte pays each account in one transaction, which logs its payout
// and its retirement. Double Espresso records each account's last claim block, and each claim the one before.

// Base makes a block every two seconds. The newest blocks are skipped: an RPC a little behind may not have them.
const BLOCK_TIME = 2;
const SETTLED = 5;
// A payout takes up to half a day after each flip.
const UNDER_WAY = 12 * 3600;
// The most blocks of Double Espresso's claims read for one account: anyone can claim dust for it, as often as they like.
export const WALK_LIMIT = 10;

export type Pair = { contract: Address; token: Address };
export type Owed = Amount & { contract: Address };
// A pair of an epoch's rewards, with what it paid the automation's votes, or 0 if unknown.
type Weighed = Pair & { value: number };
type Rewards = { start: number; pairs: Weighed[] };
export type Standing = {
  id: bigint;
  // The start of the epoch up to which it has been paid, and a pair whose record reached it in its last payout; none if
  // never paid.
  paidUpTo?: { through: number; pair: Pair } | undefined;
  // Paid for last epoch, if it voted with the automation then; late for the epoch before, if it voted with it then.
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
// What amounts are worth, a token without a price counting for nothing, or, with `standIns`, at today's.
export function valueAt(
  amounts: Amount[],
  decimals: Map<string, { decimals: number }>,
  prices: Prices,
  standIns = false,
): number {
  return sum(
    amounts.map(({ token, amount }) => {
      const price = prices.of.get(key(token)) ?? (standIns ? prices.standIns.get(key(token)) : undefined);
      const known = decimals.get(key(token));
      return known && price !== undefined ? worthOf(amount, known.decimals, price) : 0;
    }),
  );
}

export const weighed = (rewards: Reward[], prices: Prices): Weighed[] =>
  rewards.map(({ contract, token, amount }) => ({
    contract,
    token: token.address,
    value: valueAt([{ token: token.address, amount }], new Map([[key(token.address), token]]), prices, true),
  }));
const weights = (pairs: Weighed[]): number[] =>
  pairs.some(({ value }) => value > 0) ? pairs.map(({ value }) => value) : pairs.map(() => 1);

// Whether claims since an epoch ended, at `end`, took more than half of what its rewards were worth: a payout, not a
// claim of a few small rewards; nor do the tokens a payout leaves out keep it from counting.
export function paidFor(pairs: Weighed[], stamps: number[], end: number): boolean {
  if (!pairs.length) return true;
  const weight = weights(pairs);
  return 2 * sum(weight.filter((_, i) => stamps[i]! >= end)) > sum(weight);
}

// An account's standing from its records in last epoch's rewards and the epoch before's. Up to when it has been paid
// goes by payouts, not by any claim: if late, the newest record from before the epoch it is late for; if paid for last
// epoch, or the one before, that one's end; else the newest record from before last epoch, if it voted then.
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
// earned() reads at most 50 epochs: from the account's last claim from the contract, or, if it never claimed there, from
// the contract's first incentives, or the account's creation if later, as hydrex-keeper works it out. Each claim moves
// them on by as many.
const WINDOW = 50 * WEEK;
export const windowStart = (stamp: number, first: number, created: number): number =>
  stamp >= first ? stamp : created > first ? created : first - WEEK;
// How many times a claim asks a contract to pay through `epoch`, from where earned() starts.
export const passesTo = (start: number, epoch: number): number =>
  epoch < start ? 1 : Math.floor((epoch - start) / WINDOW) + 1;

// What each account can claim from each pair: what earned() reads, and, of the `epochs` given, those past it, each read
// on its own; with the claim's passes, and the pair's record. If where earned() starts cannot be read, what it reads
// alone. earned() adds up to 50 epochs, about a million gas each, so 20 a batch.
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

// The first block after `from`, up to `to`, at which each item has reached what it waits for, if it has by `to`. Each
// step reads a group at its middle block, and splits it by whether they have.
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

// The first block whose time is at least `time`, from a block `top` at or after it: guessed from the times of the
// closest blocks known, then by halving.
export async function firstBlockAt(
  time: number,
  top: number,
  topTime: number,
  rd: (block: number) => Promise<number> = blockTimeAt,
): Promise<number> {
  let [lo, loTime, hi, hiTime] = [-1, 0, top, topTime];
  for (let step = 0; hi - lo > 1; step++) {
    const gap = lo < 0 ? BLOCK_TIME : (hiTime - loTime) / (hi - lo);
    const placed = hi - Math.ceil((hiTime - time) / gap);
    const guess = step < 4 ? Math.min(hi - 1, Math.max(lo + 1, placed)) : Math.floor((lo + hi) / 2);
    const at = await rd(guess);
    if (at >= time) [hi, hiTime] = [guess, at];
    else [lo, loTime] = [guess, at];
  }
  return hi;
}
const blockTimeAt = async (block: number): Promise<number> =>
  Number(required(await read([blockTime], { block, tag: "payouts" }))[0]);
const epochBlock = (epoch: number, top: number, time: number): Promise<number> =>
  memo(`first ${epoch}`, () => firstBlockAt(epoch, top, time));
export const readTime = async (block: number): Promise<number> =>
  Number(
    (await rpc<{ timestamp: Hex }>("eth_getBlockByNumber", [numberToHex(block), false], { tag: "payouts" })).timestamp,
  );
const timeOf = (block: number): Promise<number> => memo(`time ${block}`, () => readTime(block));

// The block of each account's last payout: the first, from the one its paid-through epoch began in, in which the pair
// that records that epoch reached it. Accounts paid through the same epoch are searched together.
async function payoutBlocks(standings: Standing[], top: number, time: number): Promise<Map<bigint, number>> {
  const blocks = new Map<bigint, number>();
  const paid = standings.flatMap(({ id, paidUpTo }) => (paidUpTo ? [{ id, ...paidUpTo }] : []));
  await Promise.all(
    [...new Set(paid.map(({ through }) => through))].map(async (epoch) => {
      const reached = async (block: number, items: typeof paid) =>
        required(await read(items.map(stampOf), { block, tag: "payouts" })).map((value) => value >= BigInt(epoch));
      const these = paid.filter(({ through }) => through === epoch);
      const found = await firstReached(reached, these, (await epochBlock(epoch, top, time)) - 1, top);
      for (const [{ id }, block] of found) blocks.set(id, block);
    }),
  );
  return blocks;
}

type Placed = { blockNumber: bigint; logIndex: number };
const inOrder = (a: Placed, b: Placed): number => Number(a.blockNumber - b.blockNumber) || a.logIndex - b.logIndex;

// Matcha Latte's payout, as its logs give it: an account's retirement, if any, comes just before, in its transaction.
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
// A block's payouts, from one read of its logs. The last claim may have been made elsewhere, with no log of Matcha
// Latte's, so no logs is taken only once no RPC has any, and is read again next time.
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

// Double Espresso's claims in some logs, newest first. `previous` is the claim block recorded before it.
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

// Each account's claims, from its last claim block `from` back to `since`, its epoch's first block. A block may hold
// several claims of one account: the first points back, the later ones to the block itself.
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
// Some accounts' claims in a block, each kept once read. An RPC whose logs lack one is behind, and the next is asked;
// if none has it, it is read again next time.
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

// An account's payouts through the automation it is in, joining or leaving; its standing in the pools of the one it
// voted with last epoch, where its rewards are; and its last payout's receipt, or why there is none.
type Entry = {
  automation: Automation;
  voter: Automation;
  account: Account;
  standing?: Standing | undefined;
  // The voter's figures, unless they could not be read, or are not final yet: `early`.
  earnings?: Earnings | undefined;
  early: boolean;
  // Whether it voted with the automation last epoch, which still holds its claims: a payout is due to it.
  due: boolean;
  block?: number | undefined;
  time?: number | undefined;
  payout?: Payout | undefined;
  walk?: Walk | undefined;
  note?: "outside" | "unclaimed" | undefined;
};
export type Payouts = { epochStart: number; entries: Entry[] };

export const automationOf = ({ delegate, claimer, delegateAtStart }: Account): Automation | undefined =>
  AUTOMATIONS.find(({ address }) => same(delegate, address) || same(claimer, address)) ??
  AUTOMATIONS.find(({ address }) => same(delegateAtStart, address));

type Part = Pick<Entry, "block" | "time" | "payout" | "walk" | "note">;
async function matchaLatteParts(
  ids: bigint[],
  standings: Promise<(Standing | undefined)[]>,
  top: number,
  time: number,
): Promise<Map<bigint, Part>> {
  const blocks = await payoutBlocks(
    (await standings).filter((standing) => !!standing),
    top,
    time,
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

// The payouts of the accounts in the page's automations. `earningsOf` gives what an automation's votes earned last
// epoch, as Hydrex knows it: until Hydrex moves on after a flip, of the epoch before.
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
  const top = Number(await rpc<Hex>("eth_blockNumber", [], { tag: "payouts" })) - SETTLED;
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
  const standings = Promise.all(
    groups(voterOf).map(async ([automation, these]) => {
      const earnings = await earningsOf(automation).catch(() => undefined);
      if (!earnings) return;
      if (earnings.start < epochStart - WEEK) return these.forEach((id) => found.set(id, { early: true }));
      const last = { start: earnings.start, pairs: weighed(earnings.rewards, earnings.prices) };
      const votedBefore = these.filter((id) => votedWith(automation, id, "before"));
      const owed = await Promise.all([
        readOwed(these, last.pairs, top, [last.start - WEEK, last.start]).then((rows) =>
          rows.map(({ id, owing }) => ({
            id,
            earned: owing.map(({ amount }) => amount),
            stamps: required(owing.map(({ stamp }) => stamp)),
          })),
        ),
        votedBefore.length ? rewardsFor(automation.address, earnings.start - WEEK) : [],
      ]).catch(() => undefined);
      if (!owed) return;
      const [rows, rewards] = owed;
      const before = { start: earnings.start - WEEK, pairs: weighed(rewards, earnings.prices) };
      const stampsBefore = await readStamps(votedBefore, before.pairs, top).catch(() => undefined);
      if (!stampsBefore) return;
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
          ? matchaLatteParts(these, theirs, top, Number(time))
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
  return { epochStart, entries };
}

// A payout under way: some accounts due paid since the flip, others not yet, the first known less than half a day ago.
export function underWay({ entries }: Payouts): { paid: Entry[]; left: Entry[] } | undefined {
  const paid = entries.filter((entry) => entry.due && entry.standing?.paid);
  const left = entries.filter((entry) => entry.due && !entry.standing?.paid);
  const times = paid.flatMap(({ time }) => (time === undefined ? [] : [time]));
  return times.length && left.length && now() - Math.min(...times) < UNDER_WAY ? { paid, left } : undefined;
}
// Whether a payout due since the flip has not come yet: what the page reads again every five minutes.
export const awaited = ({ entries }: Payouts): boolean =>
  entries.some(
    ({ due, standing }) => due && standing && !standing.paid && (standing.waiting.length || standing.unknown),
  );
// A payout through Double Espresso is overdue once something waits and nobody claimed it, half a day after the flip,
// or once it is late for the epoch before: the owner can then claim it.
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
