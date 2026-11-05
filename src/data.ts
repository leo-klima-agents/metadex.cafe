import type { Address } from "viem";
import * as aero from "./aero.ts";
import { memo, andThen, use, type Got } from "./cache.ts";
import { checks } from "./checks.ts";
import { AUTOMATIONS, AUTOPILOTS, type Automation } from "./config.ts";
import { WEEK, weekStart, type Money } from "./format.ts";
import { automationAt, readAccount, readAccounts, readFreshness, readMatchaLatte, type Holdings } from "./hydrex.ts";
import { awaited, readPayouts, readTime, type Payouts } from "./payouts.ts";
import {
  allEarnings,
  holdersOf,
  lastEpoch,
  shareOf,
  stakesOf,
  votesEarned,
  type Earnings,
  type Stake,
} from "./rewards.ts";
import { pricesFrom } from "./prices.ts";
import { now, tagged } from "./rpc.ts";
import { state } from "./state.ts";

// What the views show from Base, cached by key. Keys name the wallet and the epoch, so nothing read for another wallet
// is shown, and reads of an epoch that has ended are made again.
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

// The start of the last epoch Hydrex has ended. Just after a flip it may still be the epoch before; until Hydrex moves
// on, it is read again every five minutes.
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
// What an account's votes earned last epoch: its share of what their holder earned. `null` when it had no votes as the
// epoch began, when their holder had none, or when a holder other than the automations did not vote.
export function accountEarned(holdings: Holdings, id: bigint): Got<Money | null> {
  return andThen(stakes(holdings), (all) => {
    const stake = all.get(id);
    if (!stake) return { value: null };
    const automation = automationAt(stake.delegate);
    return andThen(automation ? earnings(automation) : holderEarnings(stake.delegate), (of) => {
      if (!of.votes || (!automation && !of.pools.length)) return { value: null };
      return { value: shareOf(of, stake.votes) };
    });
  });
}
const holders = (holdings: Holdings) => andThen(stakes(holdings), (all) => ({ value: holdersOf(all.values()) }));

// The payouts of the accounts in the automations, as of the last epoch Hydrex has ended. Read again when Hydrex moves
// on, and every five minutes while a due payout has not come or some rewards could not be weighed.
export function payouts(holdings: Holdings): Got<Payouts> {
  const key = holdings.accounts.map(({ id, delegate, claimer }) => `${id}:${delegate}:${claimer}`).join(" ");
  return andThen(epoch(), (start) =>
    use(
      `payouts ${holdings.owner} ${holdings.epochStart} ${start} ${key}`,
      () =>
        readPayouts(holdings, (automation) => memo(earningsKey(automation, start), readEarnings(automation, start))),
      (found: Payouts) => (awaited(found) || found.unread ? 5 * MINUTE : Infinity),
    ),
  );
}

// Aero's reads of the present last five minutes, and its universe as `universeReads` says.
const MARKET = "aero market";
const universes = aero.universeReads(() => aero.readUniverse(tagged("aero")));
const universe = () => memo("aero universe", universes.read, universes.ttl);
// Snapshots on the grid's whole hours never change, so each set is read once, unless some could not be.
const startsOf: aero.StartsOf = (rewards, times) =>
  memo(
    `aero starts ${times.join()} ${rewards.join()}`,
    () => aero.startsAt(rewards, times.map(BigInt), tagged("aero")),
    (found: aero.Start[]) => (found.some(aero.unreadStart) ? 0 : Infinity),
  );
const readAero = () => aero.readMarket(universe(), tagged("aero"), startsOf);
export const market = (): Got<aero.Market> => use(MARKET, readAero, 5 * MINUTE);
const marketRead = (): Promise<aero.Market> => memo(MARKET, readAero, 5 * MINUTE);
export const ownStakes = (): Got<aero.Stake[]> => {
  const address = owner();
  return address ? use(`aero stakes ${address}`, () => aero.stakesOf(address, tagged("aero")), 5 * MINUTE) : {};
};
export const autopilots = (): Got<aero.Stake[]> =>
  use(
    "aero autopilots",
    () =>
      aero.readStakes(
        AUTOPILOTS.map(({ id }) => id),
        tagged("aero"),
      ),
    5 * MINUTE,
  );
// Prices at the record's step starts, from the pools that price each token now. The grid's times are on the hour, so
// they are kept, unless some pools could not be read.
export const pricesThen = (): Got<aero.Then> =>
  andThen(market(), (found) => {
    const times = aero.stepsOf(found).map(({ from }) => from);
    const sources = found.prices.sources ?? new Map();
    const amounts = aero.dayOf(found.gauges, found.time);
    return use(
      `aero prices ${times.join()}`,
      async () =>
        new Map(
          await Promise.all(
            times.map(async (time) => [time, await pricesFrom(sources, amounts, time, tagged("aero"))] as const),
          ),
        ),
      (then: aero.Then) => ([...then.values()].some(({ unread }) => unread) ? 5 * MINUTE : Infinity),
    );
  });
// Snapshots beyond the grid's, which a longer window needs, read when it is chosen.
export function pastFor(times: number[]): Got<aero.Past> {
  if (!times.length) return { value: { times: [], starts: new Map() } };
  return andThen(market(), (found) => {
    const rewards = found.gauges.map((gauge) => gauge.rewards);
    return use(`aero past ${times.join()} ${rewards.join()}`, async () =>
      aero.pastOf(rewards, times, await startsOf(rewards, times)),
    );
  });
}
// The first Autopilot its Relay still owns: its moves back to the oldest step and its pools' snapshots at each, read
// again when it moves.
export type AutopilotRecord = { stake: aero.Stake; moves: aero.Move[]; past: aero.Past };
export const autopilotRecord = (): Got<AutopilotRecord | null> =>
  andThen(market(), (found) =>
    andThen(autopilots(), (stakes) => {
      const stake = AUTOPILOTS.flatMap(({ id, relay }) =>
        stakes.filter((each) => each.id === id && each.owner.toLowerCase() === relay.toLowerCase()),
      )[0];
      if (!stake) return { value: null };
      const since = aero.stepsOf(found).at(-1)!.from;
      return use(`aero autopilot ${stake.id} ${stake.lastAllocated} ${since}`, async () => {
        const moves = await aero.movesOf(stake, since, tagged("aero"));
        return { stake, moves, past: await aero.movesPast(moves, await marketRead(), since, tagged("aero")) };
      });
    }),
  );
// Waits for the wallet's own stakes, so as not to read one twice.
export function stakeShown(id: bigint): Got<aero.Stake | null> {
  const mine = ownStakes();
  const own = mine.value?.find((stake) => stake.id === id);
  if (own) return { value: own };
  if (owner() && mine.value === undefined && !mine.failed) return {};
  return use(`aero stake ${id}`, async () => (await aero.readStakes([id], tagged("aero")))[0] ?? null, 5 * MINUTE);
}
// Read again when a stake moves.
export const pending = (stakes: aero.Stake[]): Got<Map<bigint, aero.Pending>> =>
  use(
    `aero pending ${stakes.map(({ id, lastAllocated }) => `${id}:${lastAllocated}`).join(" ")}`,
    async () => aero.pendingOf(stakes, await marketRead(), tagged("aero")),
    5 * MINUTE,
  );
// A past snapshot never changes.
export const since = (time: number): Got<Map<string, aero.Start>> =>
  andThen(market(), () =>
    use(`aero since ${time}`, async () => aero.startsSince((await marketRead()).gauges, time, tagged("aero"))),
  );
const HISTORY_DAYS = 14;
export const history = (gauge: Address): Got<aero.Day[] | null> =>
  andThen(market(), (found) => {
    const shown = found.gauges.find((each) => each.address === gauge);
    if (!shown) return { value: null };
    return use(
      `aero history ${gauge} ${found.time - (found.time % aero.DAY)}`,
      () => aero.historyOf(shown, HISTORY_DAYS, tagged("aero")),
      5 * MINUTE,
    );
  });

export function preload(): void {
  checks();
  matchaLatte();
  for (const automation of AUTOMATIONS) {
    freshness(automation);
    earnings(automation);
  }
  average();
  ownStakes();
  const holdings = accounts().value;
  if (!holdings) return;
  payouts(holdings);
  for (const holder of holders(holdings).value ?? []) holderEarnings(holder);
}
