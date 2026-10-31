import type { Address } from "viem";
import { memo, use, type Got } from "./cache.ts";
import { AUTOMATIONS, type Automation } from "./config.ts";
import { WEEK, weekStart } from "./format.ts";
import { failedChecks, readAccount, readAccounts, readFreshness, readMatchaLatte, type Holdings } from "./hydrex.ts";
import { awaited, readPayouts, readTime, type Found } from "./payouts.ts";
import { allEarnings, holdersOf, lastEpoch, stakesOf, votesEarned, type Earnings, type Stake } from "./rewards.ts";
import { now, same, tagged } from "./rpc.ts";
import { state } from "./state.ts";

// What the views show from Base, each read once and kept: by wallet and by epoch, so that what was read for another
// is never shown, and what is of an epoch that ended is read again.
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const week = (): number => weekStart(now());
export const owner = (): Address | undefined => state.connection?.address;
// The second read, once the first has a value.
export const then = <T, U>(got: Got<T>, next: (value: T) => Got<U>): Got<U> =>
  got.value !== undefined ? next(got.value) : got.failed ? { failed: true } : {};

export const checks = () => use(`checks`, failedChecks, HOUR);
export const matchaLatte = () => use(`matcha-latte ${week()}`, readMatchaLatte, HOUR);
export const freshness = (automation: Automation) =>
  use(`voted ${automation.kind} ${week()}`, () => readFreshness(automation), HOUR);
export const accounts = (): Got<Holdings> => {
  const address = owner();
  return address ? use(`accounts ${address} ${week()}`, () => readAccounts(address)) : {};
};
export const blockTime = (block: number) => use(`time ${block}`, () => readTime(block));
export const account = (id: bigint) => use(`account ${id} ${week()}`, async () => (await readAccount(id)) ?? null);

// The last epoch Hydrex has ended: until it moves on after a flip, the epoch before's, read again every five minutes.
const epochKey = () => `epoch ${week()}`;
export const epoch = () =>
  use(epochKey(), lastEpoch, (start: number) => (start < week() - WEEK ? 5 * MINUTE : Infinity));
const earningsKey = (automation: Automation, start: number) => `earnings ${automation.kind} ${start}`;
const readEarnings = (automation: Automation, start: number) => () =>
  votesEarned(automation.address, start, true, tagged("earnings"));
export const earnings = (automation: Automation): Got<Earnings> =>
  then(epoch(), (start) => use(earningsKey(automation, start), readEarnings(automation, start)));
export const average = (): Got<Earnings> =>
  then(epoch(), (start) => use(`average ${start}`, () => allEarnings(start, tagged("average"))));
// Who held the wallet's accounts' votes when the epoch began, and what each holder that is none of the automations earned.
export const stakes = (holdings: Holdings): Got<Map<bigint, Stake>> =>
  then(epoch(), (start) => {
    const ids = holdings.accounts.filter(({ amount }) => amount > 0n).map(({ id }) => id);
    return use(`stakes ${start} ${ids.join()}`, () => stakesOf(ids, start, tagged("shares")));
  });
export const voter = (holder: Address): Got<Earnings> =>
  then(epoch(), (start) => use(`voter ${holder} ${start}`, () => votesEarned(holder, start, false, tagged("shares"))));
// What an account's votes earned last epoch: its part of whoever held them, if they voted.
export function earnedBy(holdings: Holdings, id: bigint): Got<{ share: number; of: Earnings } | null> {
  return then(stakes(holdings), (all) => {
    const stake = all.get(id);
    if (!stake) return { value: null };
    const automation = AUTOMATIONS.find(({ address }) => same(address, stake.delegate));
    return then(automation ? earnings(automation) : voter(stake.delegate), (of) => ({
      value: of.votes && (automation || of.pools.length) ? { share: Number(stake.votes) / Number(of.votes), of } : null,
    }));
  });
}
export const holders = (holdings: Holdings) => then(stakes(holdings), (all) => ({ value: holdersOf(all.values()) }));

// The payouts of the accounts in the automations, read again every five minutes while one due has not come.
export function payouts(holdings: Holdings): Got<Found> {
  const key = holdings.accounts.map(({ id, delegate, claimer }) => `${id}:${delegate}:${claimer}`).join(" ");
  const earningsOf = (automation: Automation) =>
    memo(epochKey(), lastEpoch).then((start) => memo(earningsKey(automation, start), readEarnings(automation, start)));
  return use(
    `payouts ${holdings.owner} ${holdings.epochStart} ${key}`,
    () => readPayouts(holdings, earningsOf),
    (found: Found) => (awaited(found) ? 5 * MINUTE : Infinity),
  );
}

// Reads ahead what every view shows, so that each opens with it read, or under way.
export function preload(): void {
  checks();
  matchaLatte();
  for (const automation of AUTOMATIONS) {
    freshness(automation);
    earnings(automation);
  }
  average();
  const holdings = accounts().value;
  if (!holdings) return;
  payouts(holdings);
  for (const holder of holders(holdings).value ?? []) voter(holder);
}
