import { decodeEventLog, encodeEventTopics, numberToHex, parseAbi, type Address, type Hex } from "viem";
import { memo } from "./cache.ts";
import { AUTOMATIONS, DOUBLE_ESPRESSO, MATCHA_LATTE, type Automation } from "./config.ts";
import { WEEK, weekStart } from "./format.ts";
import { escrow, type Account, type Holdings } from "./hydrex.ts";
import { key, worthOf, type Prices } from "./prices.ts";
import { rewardsFor, type Earnings, type Reward } from "./rewards.ts";
import { blockTime, call, now, read, required, rpc, same, type Call } from "./rpc.ts";

// Hydrex's reward contracts record, for each account and token, the start of the epoch up to which they have paid it:
// every claim sets it to the current epoch, even of nothing. An epoch counts as paid once the records of more than half
// of what its rewards were worth have moved past its end. A search through past blocks then finds the block of the
// last payout, whose logs make its receipt. Matcha Latte pays each account in one transaction, which logs its payout
// and its retirement. Double Espresso records each account's last claim block, and each claim the one before.

const rewardsAbi = parseAbi([
  "function tokenTimestamp(uint256 tokenId, address token) view returns (uint256)",
  "function earned(uint256 tokenId, address token) view returns (uint256)",
]);
const eventsAbi = parseAbi([
  "event CarbonRetired(address indexed creditToken_, uint256 retireTonnes, uint256 kvcmSpent)",
  "event ClaimSwapAndDistributeCompleted(uint256 indexed tokenId, address indexed owner, address indexed recipient, address[] claimedTokens, uint256[] claimedAmounts, address[] distributedTokens, uint256[] distributedAmounts, uint256[] treasuryFees)",
  "event Claimed(uint256 indexed tokenId, address indexed owner, address indexed caller, address[] tokens, uint256[] amounts, uint256[] fees, uint256 previousClaimBlock)",
  "function lastClaimBlock(uint256 tokenId) view returns (uint256)",
]);

// Base makes a block every two seconds. The newest blocks are skipped: an RPC a little behind may not have them.
const BLOCK_TIME = 2;
const SETTLED = 5;
// A payout takes up to half a day after each flip.
const UNDER_WAY = 12 * 3600;
// The most blocks of Double Espresso's claims read for one account: anyone can claim dust for it, as often as they like.
export const WALK_LIMIT = 10;

export type Amount = { token: Address; amount: bigint };
export type Pair = { contract: Address; token: Address };
export type Owed = Amount & { contract: Address };
// A pair of an epoch's rewards, with what it paid the automation's votes, or 0 if unknown.
export type Weighed = Pair & { value: number };
type Rewards = { start: number; pairs: Weighed[] };
type Standing = {
  id: bigint;
  // The start of the epoch up to which it has been paid, or 0, and a pair whose record reached it in its last payout.
  through: number;
  pair?: Pair | undefined;
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
// Amounts of the same token, added together.
export function summed(amounts: Amount[]): Amount[] {
  const all = new Map<string, Amount>();
  for (const { token, amount } of amounts)
    all.set(key(token), { token, amount: (all.get(key(token))?.amount ?? 0n) + amount });
  return [...all.values()];
}
// What is left of each amount once `taken` is.
export const less = (amounts: Amount[], taken: Amount[]): Amount[] =>
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

// Each reward, weighed at the prices given: a token without a price then, at its stand-in.
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

const pairReads = (ids: bigint[], pairs: Pair[], name: "tokenTimestamp" | "earned"): Call[] =>
  ids.flatMap((id) => pairs.map(({ contract, token }) => call(contract, rewardsAbi, name, id, token)));
const byAccount = <T>(values: T[], ids: bigint[], pairs: Pair[]): T[][] =>
  ids.map((_, a) => values.slice(a * pairs.length, (a + 1) * pairs.length));
// Each account's record in each pair, at a block.
export async function readStamps(ids: bigint[], pairs: Pair[], block: number): Promise<number[][]> {
  return byAccount(
    (required(await read(pairReads(ids, pairs, "tokenTimestamp"), { block, tag: "payouts" })) as bigint[]).map(Number),
    ids,
    pairs,
  );
}
// What each account can claim from each pair: earned() adds up to 50 epochs, about a million gas each, so 20 a batch.
export async function readEarned(
  ids: bigint[],
  pairs: Pair[],
  block: number | "latest",
): Promise<(bigint | undefined)[][]> {
  return byAccount(
    (await read(pairReads(ids, pairs, "earned"), { block, tag: "payouts", perBatch: 20 })) as (bigint | undefined)[],
    ids,
    pairs,
  );
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
  const epochs = [...new Set(standings.filter(({ pair }) => pair).map(({ through }) => through))];
  await Promise.all(
    epochs.map(async (epoch) => {
      const reached = async (block: number, items: Standing[]) =>
        (
          required(
            await read(
              items.map(({ id, pair }) => call(pair!.contract, rewardsAbi, "tokenTimestamp", id, pair!.token)),
              { block, tag: "payouts" },
            ),
          ) as bigint[]
        ).map((value) => value >= BigInt(epoch));
      const these = standings.filter(({ through, pair }) => pair && through === epoch);
      const found = await firstReached(reached, these, (await epochBlock(epoch, top, time)) - 1, top);
      for (const [standing, block] of found) blocks.set(standing.id, block);
    }),
  );
  return blocks;
}

type Log = {
  address: Address;
  data: Hex;
  topics: [Hex, ...Hex[]];
  transactionHash: Hex;
  logIndex: Hex;
  blockNumber: Hex;
};
const order = (log: Log): bigint => BigInt(log.blockNumber) * 1_000_000n + BigInt(log.logIndex);
function decoded(logs: Log[]) {
  return logs.flatMap((log) => {
    try {
      return [{ log, event: decodeEventLog({ abi: eventsAbi, data: log.data, topics: log.topics }) }];
    } catch {
      return [];
    }
  });
}

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
export function payoutsOf(logs: Log[]): Payout[] {
  const found: Payout[] = [];
  const retired = new Map<Hex, { tonnes: bigint; kvcm: bigint }>();
  for (const { log, event } of decoded([...logs].sort((a, b) => Number(order(a) - order(b))))) {
    if (event.eventName === "CarbonRetired")
      retired.set(log.transactionHash, { tonnes: event.args.retireTonnes, kvcm: event.args.kvcmSpent });
    if (event.eventName !== "ClaimSwapAndDistributeCompleted") continue;
    const {
      tokenId,
      owner,
      recipient,
      claimedTokens,
      claimedAmounts,
      distributedTokens,
      distributedAmounts,
      treasuryFees,
    } = event.args;
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
  if (logsOf.has(block)) return logsOf.get(block)!;
  const logs = await rpc<Log[]>(
    "eth_getLogs",
    [{ address: MATCHA_LATTE.address, fromBlock: numberToHex(block), toBlock: numberToHex(block) }],
    {
      tag: "payouts",
      want: (found) => (found as Log[]).length > 0,
    },
  );
  if (logs.length) logsOf.set(block, payoutsOf(logs));
  return payoutsOf(logs);
}

// Double Espresso's claims in some logs, newest first. `previous` is the claim block recorded before it.
export type Claim = {
  id: bigint;
  owner: Address;
  caller: Address;
  received: Amount[];
  fees: Amount[];
  previous: number;
  tx: Hex;
  block: number;
};
export type Walk = { claims: Claim[]; stopped: boolean };
export function claimsOf(logs: Log[]): Claim[] {
  return decoded([...logs].sort((a, b) => Number(order(b) - order(a)))).flatMap(({ log, event }) =>
    event.eventName === "Claimed"
      ? [
          {
            id: event.args.tokenId,
            owner: event.args.owner,
            caller: event.args.caller,
            received: positive(event.args.tokens, event.args.amounts),
            fees: positive(event.args.tokens, event.args.fees),
            previous: Number(event.args.previousClaimBlock),
            tx: log.transactionHash,
            block: Number(log.blockNumber),
          },
        ]
      : [],
  );
}
// What claims received, took and paid, token by token.
export function totals(claims: Pick<Claim, "received" | "fees">[]) {
  const received = summed(claims.flatMap((claim) => claim.received));
  const fees = summed(claims.flatMap((claim) => claim.fees));
  return { received, fees, paid: less(received, fees) };
}

// Each account's claims, from its last claim block `from` back to `since`, its epoch's first block. A block may hold
// several claims of one account: the first points back, the later ones to the block itself.
export async function walkClaims(
  starts: Map<bigint, { from: number; since: number }>,
  claimsAt: (block: number, ids: bigint[]) => Promise<Claim[]>,
  limit = WALK_LIMIT,
): Promise<Map<bigint, Walk>> {
  const walks = new Map<bigint, Walk>([...starts.keys()].map((id) => [id, { claims: [], stopped: false }]));
  let at = new Map([...starts].flatMap(([id, { from }]) => (from > 0 ? [[id, from] as const] : [])));
  for (let round = 1; at.size; round++) {
    const blocks = [...new Set(at.values())];
    const found = await Promise.all(
      blocks.map((block) =>
        claimsAt(
          block,
          [...at].flatMap(([id, current]) => (current === block ? [id] : [])),
        ),
      ),
    );
    const next = new Map<bigint, number>();
    for (const [id, current] of at) {
      const walk = walks.get(id)!;
      const mine = found[blocks.indexOf(current)]!.filter((claim) => claim.id === id && claim.block === current);
      // A claim that received nothing moved nothing.
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
const claimsIn = new Map<string, Claim[]>();
async function claimsAt(block: number, ids: bigint[]): Promise<Claim[]> {
  const missing = ids.filter((id) => !claimsIn.has(`${block} ${id}`));
  let found: Claim[] = [];
  if (missing.length) {
    const topics = [
      encodeEventTopics({ abi: eventsAbi, eventName: "Claimed" })[0],
      missing.map((id) => numberToHex(id, { size: 32 })),
    ];
    const filter = {
      address: DOUBLE_ESPRESSO.address,
      fromBlock: numberToHex(block),
      toBlock: numberToHex(block),
      topics,
    };
    const logs = await rpc<Log[]>("eth_getLogs", [filter], {
      tag: "payouts",
      want: (found) => missing.every((id) => claimsOf(found as Log[]).some((claim) => claim.id === id)),
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
export type Entry = {
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
export type Found = { epochStart: number; entries: Entry[] };

export const automationOf = ({ delegate, claimer, delegateAtStart }: Account): Automation | undefined =>
  AUTOMATIONS.find(({ address }) => same(delegate, address) || same(claimer, address)) ??
  AUTOMATIONS.find(({ address }) => same(delegateAtStart, address));

type Part = Pick<Entry, "block" | "time" | "payout" | "walk" | "note">;
async function matchaLatteParts(
  ids: bigint[],
  standings: Promise<(Standing | undefined)[]>,
  top: number,
  time: number,
): Promise<Part[]> {
  const blocks = await payoutBlocks(
    (await standings).filter((standing) => !!standing),
    top,
    time,
  );
  const [paid, times] = await Promise.all([
    Promise.all([...new Set(blocks.values())].map(payoutsIn)),
    Promise.all([...blocks.values()].map(timeOf)),
  ]);
  return ids.map((id) => {
    const block = blocks.get(id);
    if (block === undefined) return {};
    const payout = paid
      .flat()
      .filter((each) => each.id === id && each.block === block)
      .at(-1);
    return { block, time: times[[...blocks.values()].indexOf(block)], payout, note: payout ? undefined : "outside" };
  });
}
async function doubleEspressoParts(ids: bigint[], top: number): Promise<Part[]> {
  const last = (
    required(
      await read(
        ids.map((id) => call(DOUBLE_ESPRESSO.address, eventsAbi, "lastClaimBlock", id)),
        { block: top, tag: "payouts" },
      ),
    ) as bigint[]
  ).map(Number);
  const times = await Promise.all(last.map((block) => (block ? timeOf(block) : 0)));
  const starts = await Promise.all(
    ids.map(
      async (id, i) =>
        [
          id,
          { from: last[i]!, since: last[i] ? await epochBlock(weekStart(times[i]!), last[i]!, times[i]!) : 0 },
        ] as const,
    ),
  );
  const walks = await walkClaims(new Map(starts), claimsAt);
  return ids.map((id, i) => {
    const walk = walks.get(id)!;
    return {
      block: last[i] || undefined,
      time: last[i] ? times[i] : undefined,
      walk,
      note: walk.claims.length ? undefined : "unclaimed",
    };
  });
}

// The payouts of the accounts in the page's automations. `earningsOf` gives what an automation's votes earned last
// epoch, as Hydrex knows it: until Hydrex moves on after a flip, of the epoch before.
export async function readPayouts(
  holdings: Holdings,
  earningsOf: (automation: Automation) => Promise<Earnings>,
): Promise<Found> {
  const { epochStart } = holdings;
  const members = holdings.accounts.filter((account) => automationOf(account));
  if (!members.length) return { epochStart, entries: [] };
  const ids = members.map(({ id }) => id);
  const top = Number(await rpc<Hex>("eth_blockNumber", [], { tag: "payouts" })) - SETTLED;
  const [time, ...delegates] = await read(
    [blockTime, ...ids.flatMap((id) => [1, 2].map((ago) => escrow("delegates", id, epochStart - ago * WEEK)))],
    { block: top, tag: "payouts" },
  );
  required([time]);
  const votedWith = (automation: Automation, id: bigint, ago: 1 | 2): boolean =>
    same(String(delegates[2 * ids.indexOf(id) + ago - 1]), automation.address);
  const voterOf = (account: Account): Automation =>
    AUTOMATIONS.find((automation) => votedWith(automation, account.id, 1)) ?? automationOf(account)!;
  const groups = (of: (account: Account) => Automation) =>
    [...new Set(members.map(of))].map(
      (automation) =>
        [automation, members.filter((account) => of(account) === automation).map(({ id }) => id)] as const,
    );

  const found = new Map<bigint, { earnings: Earnings; standing?: Standing } | "early">();
  const standings = Promise.all(
    groups(voterOf).map(async ([automation, these]) => {
      const earnings = await earningsOf(automation).catch(() => undefined);
      if (!earnings) return;
      if (earnings.start < epochStart - WEEK) return these.forEach((id) => found.set(id, "early"));
      const last = { start: earnings.start, pairs: weighed(earnings.rewards, earnings.prices) };
      const votedBefore = these.filter((id) => votedWith(automation, id, 2));
      const [stamps, earned, rewards] = await Promise.all([
        readStamps(these, last.pairs, top),
        readEarned(these, last.pairs, top),
        votedBefore.length ? rewardsFor(automation.address, earnings.start - WEEK) : [],
      ]).catch(() => []);
      if (!stamps) return;
      const before = { start: earnings.start - WEEK, pairs: weighed(rewards!, earnings.prices) };
      const stampsBefore = await readStamps(votedBefore, before.pairs, top).catch(() => undefined);
      if (!stampsBefore) return;
      these.forEach((id, i) => {
        const records = { last: stamps[i]!, earned: earned![i]!, before: stampsBefore[votedBefore.indexOf(id)] ?? [] };
        const voted = { last: votedWith(automation, id, 1), before: votedWith(automation, id, 2) };
        const standing =
          last.pairs.length || before.pairs.length ? standingOf(id, last, before, records, voted) : undefined;
        found.set(id, { earnings, standing });
      });
    }),
  );
  const parts = new Map<bigint, Part>();
  await Promise.all(
    groups((account) => automationOf(account)!).map(async ([automation, these]) => {
      const theirs = standings.then(() =>
        these.map((id) => (found.get(id) as { standing?: Standing } | undefined)?.standing),
      );
      const read =
        automation === MATCHA_LATTE
          ? matchaLatteParts(these, theirs, top, Number(time))
          : doubleEspressoParts(these, top);
      const each = await read.catch((error: unknown) => void console.error(error));
      each?.forEach((part, i) => parts.set(these[i]!, part));
    }),
  );
  await standings;
  const entries = members.map((account): Entry => {
    const automation = automationOf(account)!;
    const read = found.get(account.id);
    const part = parts.get(account.id);
    const known = typeof read === "object" && part ? read : undefined;
    const due = votedWith(automation, account.id, 1) && same(account.claimer, automation.address);
    return {
      ...part,
      automation,
      voter: voterOf(account),
      account,
      earnings: known?.earnings,
      standing: known?.standing,
      early: read === "early",
      due,
    };
  });
  if (entries.every(({ earnings, early }) => !earnings && !early))
    throw new Error("No automation's payouts could be read.");
  return { epochStart, entries };
}

// A payout under way: some accounts due paid since the flip, others not yet, the first less than half a day ago.
export function underWay({ entries }: Found): { paid: Entry[]; left: Entry[] } | undefined {
  const paid = entries.filter((entry) => entry.due && entry.standing?.paid);
  const left = entries.filter((entry) => entry.due && !entry.standing?.paid);
  const first = Math.min(...paid.flatMap(({ time }) => (time === undefined ? [] : [time])));
  return paid.length && left.length && now() - first < UNDER_WAY ? { paid, left } : undefined;
}
// Whether a payout due since the flip has not come yet: what the page reads again every five minutes.
export const awaited = ({ entries }: Found): boolean =>
  entries.some(
    ({ due, standing }) => due && standing && !standing.paid && (standing.waiting.length || standing.unknown),
  );
// A payout through Double Espresso is overdue once something waits and nobody claimed it, half a day after the flip,
// or once it is late for the epoch before: the owner can then claim it.
export function overdue({ entries, epochStart }: Found): Entry[] {
  return entries.filter(({ automation, account, standing, earnings, due }) => {
    if (automation !== DOUBLE_ESPRESSO || !standing || !earnings || !same(account.claimer, DOUBLE_ESPRESSO.address))
      return false;
    const waits = standing.waiting.length > 0 || standing.unknown;
    return standing.late || (due && !standing.paid && waits && now() - epochStart >= UNDER_WAY);
  });
}
