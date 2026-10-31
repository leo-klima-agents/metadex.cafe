import { decodeEventLog, encodeEventTopics, numberToHex, type Address, type Hex } from "viem";
import { claimsOf, totals, type Claimed } from "./claim.ts";
import { ABI, AUTOMATIONS, DOUBLE_ESPRESSO, MATCHA_LATTE, type Automation, type Kind, type Token } from "./config.ts";
import { lastEarnings, rewardsFor, type Earnings, type Reward } from "./earnings.ts";
import { WEEK, weekStart } from "./format.ts";
import { automationOf, escrow, type Account, type Holdings } from "./hydrex.ts";
import { pricesNow, worthOf, type Prices } from "./prices.ts";
import { blockTime, call, logsAt, now, readFor, required, rpc, timeOf, type Call, type Log } from "./rpc.ts";
import { RETRY, update } from "./state.ts";
import { tokensOf } from "./tokens.ts";
import { key, maxBy, memo, positive, same, sum, sumByToken, type Amount } from "./util.ts";

// Hydrex's reward contracts record, per account and token, the epoch up to which they paid it: any claim moves it, even of
// nothing. An epoch counts as paid once the records of more than half its rewards' worth moved past its end; then a
// search through past blocks finds where the payout's own record moved: the block of the last payout.
const reads = readFor("payouts");
// The newest blocks are skipped, as an RPC a little behind may not have them.
export const SETTLED = 5;
// A payout takes up to half a day after each flip.
export const UNDER_WAY = 12 * 3600;
// Anyone can claim dust for an account, as often as they like, so a walk back through its claims stops at 10 blocks.
export const WALK_LIMIT = 10;

export type Pair = { contract: Address; token: Address };
type Weighed = Pair & { value: number };
type Rewards = { start: number; pairs: Weighed[] };
export type Standing = {
  id: bigint;
  // The epoch up to which it was paid, or 0, and a pair whose record its last payout moved.
  through: number;
  pair?: Pair;
  // Paid for last epoch, if it voted with the automation then; late for the one before, if it voted then.
  paid: boolean;
  late: boolean;
  // What it can claim now from last epoch's pairs; `unknown` if some could not be read.
  waiting: (Amount & { contract: Address })[];
  unknown: boolean;
};

export const weighed = (rewards: Reward[], prices: Prices): Weighed[] =>
  rewards.map(({ contract, token, amount }) => {
    const price = prices.of.get(key(token.address));
    return { contract, token: token.address, value: price === undefined ? 0 : worthOf(amount, token.decimals, price) };
  });
export const stampOf = (id: bigint, { contract, token }: Pair): Call =>
  call(contract, ABI.rewards, "tokenTimestamp", id, token);
// Each pair's weight: its worth, or the same for all when none has a price.
const weights = (pairs: Weighed[]) => pairs.map(({ value }) => (pairs.some((pair) => pair.value > 0) ? value : 1));

// Paid, once claims since `end` took more than half the rewards' worth: not a claim of a few small ones, as anyone may
// make, nor kept from counting by tokens a payout leaves out.
export function paidFor(pairs: Weighed[], stamps: number[], end: number): boolean {
  const weight = weights(pairs);
  return !pairs.length || 2 * sum(weight.filter((_, i) => stamps[i]! >= end)) > sum(weight);
}

// The fewest pairs worth half: a payout claims one of them.
export function watchedOf(pairs: Weighed[]): Weighed[] {
  const weight = weights(pairs);
  const watched: Weighed[] = [];
  let taken = 0;
  for (const i of pairs.map((_, i) => i).sort((a, b) => weight[b]! - weight[a]!)) {
    if (watched.length && 2 * taken >= sum(weight)) break;
    watched.push(pairs[i]!);
    taken += weight[i]!;
  }
  return watched;
}

// Up to when an account was paid goes by payouts, not any claim: if late, its newest record before the epoch it is
// late for; if paid for last epoch, or the one before, that epoch's end, through the claimed pair worth the most; else
// its newest record, before last epoch if it voted with the automation then.
export function standingOf(
  id: bigint,
  last: Rewards,
  before: Rewards,
  records: { last: number[]; earned: (bigint | undefined)[]; before: number[] },
  voted: { last: boolean; before: boolean },
): Standing {
  const waiting = last.pairs.flatMap(({ contract, token }, i) => {
    const amount = records.earned[i];
    return amount ? [{ contract, token, amount }] : [];
  });
  const unknown = records.earned.some((amount) => amount === undefined);
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
  const newest = (cap: number) => {
    const found = maxBy(
      held.filter(({ stamp }) => stamp > 0 && stamp <= cap),
      ({ stamp }) => stamp,
    );
    return found ? { through: found.stamp, pair: found.pair } : { through: 0 };
  };
  const payout = (rewards: Rewards) => {
    const found = maxBy(
      held.filter((item) => item.rewards === rewards && item.stamp >= rewards.start + WEEK),
      ({ weight }) => weight,
    );
    return found && { through: rewards.start + WEEK, pair: found.pair };
  };
  const standing =
    (late && newest(before.start)) ||
    (paid && payout(last)) ||
    (paidBefore && payout(before)) ||
    newest(voted.last ? last.start : Infinity);
  return { id, ...standing, paid, late, waiting, unknown };
}

const byAccount = <T>(values: T[], ids: bigint[], width: number): T[][] =>
  ids.map((_, a) => values.slice(a * width, (a + 1) * width));
const pairReads = (ids: bigint[], pairs: Pair[], name: string) =>
  ids.flatMap((id) => pairs.map(({ contract, token }) => call(contract, ABI.rewards, name, id, token)));
export async function readStamps(ids: bigint[], pairs: Pair[], block: number): Promise<number[][]> {
  const values = required(await reads(pairReads(ids, pairs, "tokenTimestamp"), block)) as bigint[];
  return byAccount(values.map(Number), ids, pairs.length);
}
// earned() adds up to 50 epochs, about a million gas: 20 a request.
export async function readEarned(
  ids: bigint[],
  pairs: Pair[],
  block: number | "latest",
): Promise<(bigint | undefined)[][]> {
  return byAccount(
    (await reads(pairReads(ids, pairs, "earned"), block, 20)) as (bigint | undefined)[],
    ids,
    pairs.length,
  );
}

// The first block in (from, to] at which each item has reached what it waits for, which once reached stays so. Items
// that reach it at the same block are read together to the end.
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

// The first block of an epoch, from a later block: a few guesses by the time between the closest blocks known, as Base
// makes one every two seconds, then halving.
export const epochBlock = memo(
  async ([time, top, topTime]: [number, number, number]): Promise<number> => {
    let [lo, loTime, hi, hiTime] = [-1, 0, top, topTime];
    for (let step = 0; hi - lo > 1; step++) {
      const gap = lo < 0 ? 2 : (hiTime - loTime) / (hi - lo);
      const placed = hi - Math.ceil((hiTime - time) / gap);
      const guess = step < 4 ? Math.min(hi - 1, Math.max(lo + 1, placed)) : Math.floor((lo + hi) / 2);
      const [at] = required(await reads([blockTime], guess)).map(Number) as [number];
      if (at >= time) [hi, hiTime] = [guess, at];
      else [lo, loTime] = [guess, at];
    }
    return hi;
  },
  Infinity,
  ([time]) => String(time),
);

// Each account's last payout block: the first, from its paid-through epoch's first, at which the pair recording it
// reached that epoch. Accounts paid through the same epoch are searched together; what is found is kept.
const searched = new Map<string, number>();
async function payoutBlocks(standings: Standing[], top: number, time: number): Promise<Map<bigint, number>> {
  const blocks = new Map<bigint, number>();
  const name = ({ id, through, pair }: Standing) => `${id} ${through} ${pair?.contract} ${pair?.token}`;
  const left = standings.filter((standing) => {
    const found = searched.get(name(standing));
    if (found !== undefined && found <= top) blocks.set(standing.id, found);
    return standing.pair && !blocks.has(standing.id);
  });
  await Promise.all(
    [...new Set(left.map(({ through }) => through))].map(async (epoch) => {
      const reached = async (block: number, items: Standing[]) =>
        (
          required(
            await reads(
              items.map(({ id, pair }) => stampOf(id, pair!)),
              block,
            ),
          ) as bigint[]
        ).map((stamp) => stamp >= BigInt(epoch));
      const from = (await epochBlock([epoch, top, time])) - 1;
      for (const [standing, block] of await firstReached(
        reached,
        left.filter(({ through }) => through === epoch),
        from,
        top,
      )) {
        searched.set(name(standing), block);
        blocks.set(standing.id, block);
      }
    }),
  );
  return blocks;
}

// Matcha Latte pays each account in one transaction: an event for the retirement, if any, then one for the payout.
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
  for (const log of [...logs].sort(
    (a, b) => Number(BigInt(a.blockNumber) - BigInt(b.blockNumber)) || Number(BigInt(a.logIndex) - BigInt(b.logIndex)),
  )) {
    let event;
    try {
      event = decodeEventLog({ abi: ABI.matchaLatte, data: log.data, topics: log.topics as [Hex] });
    } catch {
      continue;
    }
    if (!event.args) continue;
    if (event.eventName === "CarbonRetired") {
      retired.set(log.transactionHash, { tonnes: event.args.retireTonnes, kvcm: event.args.kvcmSpent });
      continue;
    }
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

// A block's payouts, from one read of its logs. A claim made elsewhere leaves none, so no logs is taken only if no RPC
// has any, and read again next time; a block with logs is read once.
const logsKept = new Map<number, Payout[]>();
async function payoutsIn(blocks: number[]): Promise<Payout[]> {
  const found = await Promise.all(
    [...new Set(blocks)].map(async (block) => {
      if (logsKept.has(block)) return logsKept.get(block)!;
      const logs = await logsAt(MATCHA_LATTE.address, block, [], {
        topics: ["payouts"],
        doubt: (found) => Array.isArray(found) && !found.length,
      });
      const paid = payoutsOf(logs);
      if (logs.length) logsKept.set(block, paid);
      return paid;
    }),
  );
  return found.flat();
}

// Double Espresso records each account's last claim block, and each Claimed event the one before: its claims are read
// newest first, a block of logs at a time, accounts claimed in one block sharing the read. When a block holds several
// claims for an account, the first points back, the others to the block itself.
export type Walk = { claims: Claimed[]; stopped: boolean };
export async function walkClaims(
  starts: Map<bigint, { from: number; since: number }>,
  claimsAt: (block: number, ids: bigint[]) => Promise<Claimed[]>,
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
          [...at].flatMap(([id, b]) => (b === block ? [id] : [])),
        ),
      ),
    );
    const next = new Map<bigint, number>();
    for (const [id, block] of at) {
      const walk = walks.get(id)!;
      const mine = found[blocks.indexOf(block)]!.filter((claim) => claim.id === id && claim.block === block);
      walk.claims.push(...mine.filter(({ received }) => received.length));
      const before = Math.min(...mine.map(({ previous }) => previous).filter((previous) => previous < block));
      if (!Number.isFinite(before) || before === 0 || before < starts.get(id)!.since) continue;
      if (round >= limit) walk.stopped = true;
      else next.set(id, before);
    }
    at = next;
  }
  return walks;
}

// An RPC whose logs lack a claim recorded there is behind, and the next is asked. Each is read once.
const CLAIMED = encodeEventTopics({ abi: ABI.doubleEspresso, eventName: "Claimed" })[0];
const claimsKept = new Map<string, Claimed[]>();
async function claimsAt(block: number, ids: bigint[]): Promise<Claimed[]> {
  const missing = ids.filter((id) => !claimsKept.has(`${block} ${id}`));
  if (missing.length) {
    const found = claimsOf(
      await logsAt(DOUBLE_ESPRESSO.address, block, [CLAIMED, missing.map((id) => numberToHex(id, { size: 32 }))], {
        topics: ["payouts"],
        accept: (logs) =>
          Array.isArray(logs) && missing.every((id) => claimsOf(logs as Log[]).some((claim) => claim.id === id)),
      }),
    );
    for (const id of missing)
      claimsKept.set(
        `${block} ${id}`,
        found.filter((claim) => claim.id === id),
      );
  }
  return ids.flatMap((id) => claimsKept.get(`${block} ${id}`)!);
}

type Part = {
  block?: number;
  time?: number;
  payout?: Payout;
  walk?: Walk;
  // No receipt: last claimed outside the automation, or never through it.
  note?: "outside" | "unclaimed";
};
export type Entry = Part & {
  // The automation it is in, whose receipts it shows; the one it voted with last epoch, in whose pools its standing is.
  automation: Automation;
  voter: Automation;
  account: Account;
  standing?: Standing;
  earnings?: Earnings;
  // Last epoch's figures are not final yet.
  early: boolean;
  // A payout is due to it after this flip: it voted with the automation, which still holds its claims.
  due: boolean;
};
// `tokens` and `prices` come after, for what waits and the receipts.
export type Found = {
  epochStart: number;
  entries: Entry[];
  tokens?: Map<string, Token> | undefined;
  prices?: Prices | undefined;
};

type Reader = (
  ids: bigint[],
  standings: Promise<(Standing | undefined)[]>,
  top: number,
  time: number,
) => Promise<Part[]>;
const readers: Record<Kind, Reader> = {
  // About 25 reads to find each payout block, then one of logs.
  "matcha-latte": async (ids, standings, top, time) => {
    const blocks = await payoutBlocks(
      (await standings).filter((each) => each !== undefined),
      top,
      time,
    );
    const paid = await payoutsIn([...blocks.values()]);
    return Promise.all(
      ids.map(async (id) => {
        const block = blocks.get(id);
        if (block === undefined) return {};
        const payout = paid.filter((each) => each.id === id && each.block === block).at(-1);
        return { block, time: await timeOf(block), ...(payout ? { payout } : { note: "outside" as const }) };
      }),
    );
  },
  // Each last claim block, then its claims back to the start of that claim's epoch.
  "double-espresso": async (ids, _, top) => {
    const last = (
      required(
        await reads(
          ids.map((id) => call(DOUBLE_ESPRESSO.address, ABI.doubleEspresso, "lastClaimBlock", id)),
          top,
        ),
      ) as bigint[]
    ).map(Number);
    const times = await Promise.all(last.map((block) => (block ? timeOf(block) : 0)));
    const starts = new Map(
      await Promise.all(
        ids.map(
          async (id, i) =>
            [
              id,
              { from: last[i]!, since: last[i]! && (await epochBlock([weekStart(times[i]!), last[i]!, times[i]!])) },
            ] as const,
        ),
      ),
    );
    const walks = await walkClaims(starts, claimsAt);
    return ids.map((id, i) => {
      const walk = walks.get(id)!;
      return {
        ...(last[i] && { block: last[i], time: times[i] }),
        walk,
        ...(!walk.claims.length && { note: "unclaimed" as const }),
      };
    });
  },
};

// The accounts in the page's automations, or in one as this epoch began. Each automation's are read on their own, so
// one that fails leaves the others.
export async function readPayouts({ epochStart }: Holdings, members: Account[]): Promise<Found> {
  const ids = members.map(({ id }) => id);
  const top = Number(await rpc<Hex>("eth_blockNumber", [], { topics: ["payouts"] })) - SETTLED;
  const [time, ...delegates] = await reads(
    [
      blockTime,
      ...ids.flatMap((id) => [epochStart - WEEK, epochStart - 2 * WEEK].map((at) => escrow("delegates", id, at))),
    ],
    top,
  );
  const votedWith = (automation: Automation, id: bigint, ago: 1 | 2) =>
    same(String(delegates[2 * ids.indexOf(id) + ago - 1]), automation.address);
  const voterOf = (account: Account) =>
    AUTOMATIONS.find((each) => votedWith(each, account.id, 1)) ?? automationOf(account)!;
  const groups = (of: (account: Account) => Automation) =>
    [...new Set(members.map(of))].map(
      (automation) => [automation, members.filter((each) => of(each) === automation).map(({ id }) => id)] as const,
    );
  const read = new Map<bigint, { earnings: Earnings; standing?: Standing } | "early">();
  const standings = Promise.all(
    groups(voterOf).map(async ([automation, these]) => {
      try {
        const earnings = await lastEarnings(automation, epochStart - WEEK);
        if (earnings.start < epochStart - WEEK) return these.forEach((id) => read.set(id, "early"));
        const last = { start: earnings.start, pairs: weighed(earnings.rewards, earnings.prices) };
        const votedBefore = these.filter((id) => votedWith(automation, id, 2));
        const [stamps, earned, rewards] = await Promise.all([
          readStamps(these, last.pairs, top),
          readEarned(these, last.pairs, top),
          votedBefore.length ? rewardsFor([automation.address, earnings.start - WEEK]) : [],
        ]);
        const before = { start: earnings.start - WEEK, pairs: weighed(rewards, earnings.prices) };
        const stampsBefore = await readStamps(votedBefore, before.pairs, top);
        these.forEach((id, i) => {
          const records = { last: stamps[i]!, earned: earned[i]!, before: stampsBefore[votedBefore.indexOf(id)] ?? [] };
          const voted = { last: votedWith(automation, id, 1), before: votedBefore.includes(id) };
          const none = !last.pairs.length && !before.pairs.length;
          read.set(id, { earnings, ...(!none && { standing: standingOf(id, last, before, records, voted) }) });
        });
      } catch (error) {
        console.error(error);
      }
    }),
  );
  const standingFor = (id: bigint) => {
    const found = read.get(id);
    return typeof found === "object" ? found.standing : undefined;
  };
  const parts = new Map<bigint, Part>();
  await Promise.all(
    groups((account) => automationOf(account)!).map(async ([automation, these]) => {
      try {
        const found = await readers[automation.kind](
          these,
          standings.then(() => these.map(standingFor)),
          top,
          Number(required([time])[0]),
        );
        these.forEach((id, i) => parts.set(id, found[i]!));
      } catch (error) {
        console.error(error);
      }
    }),
  );
  await standings;
  const entries = members.map((account): Entry => {
    const automation = automationOf(account)!;
    const found = read.get(account.id);
    const part = parts.get(account.id);
    const known = typeof found === "object" && part ? found : undefined;
    return {
      ...part,
      automation,
      voter: voterOf(account),
      account,
      ...(known && { earnings: known.earnings, ...(known.standing && { standing: known.standing }) }),
      early: found === "early",
      due: votedWith(automation, account.id, 1) && same(account.claimer, automation.address),
    };
  });
  if (entries.every(({ earnings, early }) => !earnings && !early))
    throw new Error("No automation's payouts could be read.");
  return { epochStart, entries };
}

// Some accounts paid since the flip, others still due, within half a day of the first.
export type UnderWay = { paid: Entry[]; left: Entry[]; first: number };
export function underWay({ entries }: Found): UnderWay | undefined {
  const paid = entries.filter((entry) => entry.due && entry.standing?.paid);
  const left = entries.filter((entry) => entry.due && !entry.standing?.paid);
  const first = Math.min(...paid.flatMap(({ time }) => (time === undefined ? [] : [time])));
  return paid.length && left.length && Number.isFinite(first) && now() - first < UNDER_WAY
    ? { paid, left, first }
    : undefined;
}

// Overdue in Double Espresso: something waits, nobody claimed it half a day after the flip, or it is late.
export function overdue(found: Found | undefined, entry: Entry | undefined): boolean {
  if (!found || !entry || entry.automation !== DOUBLE_ESPRESSO || !entry.standing || !entry.earnings) return false;
  if (!same(entry.account.claimer, DOUBLE_ESPRESSO.address)) return false;
  const { waiting, unknown, paid, late } = entry.standing;
  return late || (entry.due && !paid && (waiting.length > 0 || unknown) && now() - found.epochStart >= UNDER_WAY);
}

// The receipts' and what waits' amounts, at prices now, for pools deep enough for the largest of each token.
async function price(found: Found): Promise<void> {
  const amounts: Amount[] = found.entries.flatMap(({ standing, payout, walk }) => [
    ...(standing?.waiting ?? []),
    ...(payout ? [...payout.earned, ...payout.paid, ...payout.fees] : []),
    ...(walk ? totals(walk.claims).received : []),
  ]);
  const largest = new Map<string, bigint>();
  for (const { token, amount } of amounts)
    if (amount > (largest.get(key(token)) ?? 0n)) largest.set(key(token), amount);
  found.tokens = await tokensOf(
    sumByToken(amounts).map(({ token }) => token),
    reads,
  );
  found.prices = await pricesNow([...found.tokens.values()], largest, reads);
}

// A payout runs for hours, so the page may read it half done: every five minutes, while one due since the flip has not
// reached every account, one read per account tells whether it has since, and only then are all read again.
export function payouts() {
  let holdings: Holdings | undefined;
  let readKey: string | undefined;
  let signals: { call: Call; paid: (answer: unknown) => boolean }[] = [];
  let missed = false;
  let underUntil = Infinity;
  let checked = 0;
  let checking = false;
  let owner: string | undefined;
  const keyOf = ({ owner, epochStart, accounts }: Holdings) =>
    [
      owner.toLowerCase(),
      epochStart,
      ...accounts.flatMap((each) => (automationOf(each) ? [`${each.id}:${automationOf(each)!.kind}`] : [])),
    ].join(" ");
  const self = {
    found: undefined as Found | undefined,
    reading: false,
    failed: false,
    // Reads the accounts given, unless they were read already; a quiet read keeps what is shown until it is done.
    async load(given: Holdings, quietly = true): Promise<void> {
      holdings = given;
      const name = keyOf(given);
      if (quietly && readKey === name) return;
      readKey = name;
      const members = given.accounts.filter(automationOf);
      if (!quietly || owner !== key(given.owner)) self.found = undefined;
      owner = key(given.owner);
      if (!members.length) {
        [signals, missed, underUntil, self.found] = [
          [],
          false,
          Infinity,
          { epochStart: given.epochStart, entries: [] },
        ];
        return update();
      }
      checked = Date.now();
      [self.reading, self.failed] = [true, false];
      update();
      const current = () => readKey === name;
      try {
        const found = await readPayouts(given, members);
        if (!current()) return;
        const before = self.found;
        [found.tokens, found.prices] = [before?.tokens, before?.prices];
        self.found = found;
        const under = underWay(found);
        signals = found.entries.flatMap(({ due, standing, earnings, account }) =>
          due && standing && !standing.paid && (standing.waiting.length || standing.unknown)
            ? watchedOf(weighed(earnings!.rewards, earnings!.prices)).map((pair) => ({
                call: stampOf(account.id, pair),
                paid: (stamp: unknown) => Number(stamp) >= found.epochStart,
              }))
            : [],
        );
        missed = found.entries.some(({ earnings }) => !earnings);
        underUntil = under ? under.first + UNDER_WAY : Infinity;
        void price(found).then(
          () => current() && update(),
          (error: unknown) => console.error(error),
        );
      } catch (error) {
        console.error(error);
        if (!current()) return;
        missed = self.failed = true;
      } finally {
        if (current()) self.reading = false;
        update();
      }
    },
    forget(): void {
      [holdings, readKey, owner, self.found, signals, missed, underUntil, self.failed] = [
        undefined,
        undefined,
        undefined,
        undefined,
        [],
        false,
        Infinity,
        false,
      ];
    },
    again(): void {
      if (holdings) void self.load(holdings, false);
    },
    check(): void {
      if (!readKey || !holdings || checking || Date.now() - checked < RETRY) return;
      if (!signals.length && !missed && now() < underUntil) return;
      const [name, given] = [readKey, holdings];
      checked = Date.now();
      checking = true;
      const moved = async () => {
        if (missed || now() >= underUntil) return true;
        const answers = await reads(signals.map(({ call }) => call)).catch(() => []);
        return signals.some(({ paid }, i) => answers[i] !== undefined && paid(answers[i]));
      };
      void moved()
        .then((again) => {
          if (!again || readKey !== name) return;
          readKey = undefined;
          return self.load(given);
        })
        .finally(() => (checking = false));
    },
  };
  return self;
}
export type Payouts = ReturnType<typeof payouts>;
