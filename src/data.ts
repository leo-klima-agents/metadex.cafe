import type { Address } from "viem";
import { memo, andThen, use, type Got } from "./cache.ts";
import { checks } from "./checks.ts";
import { AUTOMATIONS, type Automation } from "./config.ts";
import { WEEK, moneyAt, weekStart, type Money } from "./format.ts";
import { automationAt, readAccount, readAccounts, readFreshness, readMatchaLatte, type Holdings } from "./hydrex.ts";
import { awaited, readPayouts, readTime, type Payouts } from "./payouts.ts";
import {
  allEarnings,
  holdersOf,
  lastEpoch,
  stakesOf,
  valueOf,
  votesEarned,
  type Earnings,
  type Stake,
} from "./rewards.ts";
import { now, tagged } from "./rpc.ts";
import { state } from "./state.ts";

// What the views show from Base, each read once and kept: by wallet and by epoch, so that what was read for another
// is never shown, and what is of an epoch that ended is read again.
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const week = (): number => weekStart(now());
export const owner = (): Address | undefined => state.connection?.address;

export const matchaLatte = () => use(`matcha-latte ${week()}`, readMatchaLatte, HOUR);
export const freshness = (automation: Automation) =>
  use(`voted ${automation.kind} ${week()}`, () => readFreshness(automation), HOUR);
export const accounts = (): Got<Holdings> => {
  const address = owner();
  return address ? use(`accounts ${address} ${week()}`, () => readAccounts(address)) : {};
};
export const timeOfBlock = (block: number) => use(`time ${block}`, () => readTime(block));
const account = (id: bigint) => use(`account ${id} ${week()}`, async () => (await readAccount(id)) ?? null);
export function accountShown(id: bigint): { holdings: Got<Holdings | null>; own: boolean } {
  const own = accounts().value;
  if (!own?.accounts.some((each) => each.id === id)) return { holdings: account(id), own: false };
  return { holdings: { value: { ...own, accounts: own.accounts.filter((each) => each.id === id) } }, own: true };
}

// The last epoch Hydrex has ended: until it moves on after a flip, the epoch before's, read again every five minutes.
const epoch = () =>
  use(`epoch ${week()}`, lastEpoch, (start: number) => (start < week() - WEEK ? 5 * MINUTE : Infinity));
const earningsKey = (automation: Automation, start: number) => `earnings ${automation.kind} ${start}`;
const readEarnings = (automation: Automation, start: number) => () =>
  votesEarned(automation.address, start, true, tagged("earnings"));
export const earnings = (automation: Automation): Got<Earnings> =>
  andThen(epoch(), (start) => use(earningsKey(automation, start), readEarnings(automation, start)));
export const average = (): Got<Earnings> =>
  andThen(epoch(), (start) => use(`average ${start}`, () => allEarnings(start, tagged("average"))));
const stakes = (holdings: Holdings): Got<Map<bigint, Stake>> =>
  andThen(epoch(), (start) => {
    const ids = holdings.accounts.filter(({ amount }) => amount > 0n).map(({ id }) => id);
    return use(`stakes ${start} ${ids.join()}`, () => stakesOf(ids, start, tagged("shares")));
  });
// What a holder of votes earned last epoch with all the votes it held.
export const holderEarnings = (holder: Address): Got<Earnings> =>
  andThen(epoch(), (start) =>
    use(`voter ${holder} ${start}`, () => votesEarned(holder, start, false, tagged("shares"))),
  );
// What an account's votes earned last epoch: its part of whoever held them, if they voted.
export function accountEarned(holdings: Holdings, id: bigint): Got<Money | null> {
  return andThen(stakes(holdings), (all) => {
    const stake = all.get(id);
    if (!stake) return { value: null };
    const automation = automationAt(stake.delegate);
    return andThen(automation ? earnings(automation) : holderEarnings(stake.delegate), (of) => ({
      value:
        of.votes && (automation || of.pools.length)
          ? moneyAt((Number(stake.votes) / Number(of.votes)) * valueOf(of).total, of.prices)
          : null,
    }));
  });
}
const holders = (holdings: Holdings) => andThen(stakes(holdings), (all) => ({ value: holdersOf(all.values()) }));

// The payouts of the accounts in the automations, as of the last epoch Hydrex has ended: read again once it moves on,
// and every five minutes while one due has not come.
export function payouts(holdings: Holdings): Got<Payouts> {
  const key = holdings.accounts.map(({ id, delegate, claimer }) => `${id}:${delegate}:${claimer}`).join(" ");
  return andThen(epoch(), (start) =>
    use(
      `payouts ${holdings.owner} ${holdings.epochStart} ${start} ${key}`,
      () =>
        readPayouts(holdings, (automation) => memo(earningsKey(automation, start), readEarnings(automation, start))),
      (found: Payouts) => (awaited(found) ? 5 * MINUTE : Infinity),
    ),
  );
}

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
  for (const holder of holders(holdings).value ?? []) holderEarnings(holder);
}
