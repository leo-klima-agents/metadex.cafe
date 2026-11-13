import type { Address } from "viem";
import * as aero from "./aero.ts";
import { memo, andThen, prune, use, type Got } from "./cache.ts";
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
import { now, same, tagged } from "./rpc.ts";
import { state } from "./state.ts";

// What the views show from Base, cached by key. Keys hold the wallet and the epoch, so nothing read for another wallet
// is shown, and a read is made again once its epoch has ended.
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

// The start of the last epoch that Hydrex has ended. Just after an epoch ends, Hydrex may still give the one before.
// Until Hydrex moves on, this is read again every five minutes.
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
// What an account's votes earned last epoch: its share of what their holder earned. `null` when the account had no
// votes as the epoch began, when their holder had none, or when a holder other than the automations did not vote.
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

// The payouts of the accounts in the automations, as of the last epoch that Hydrex has ended. They are read again when
// Hydrex moves on. They are also read every five minutes while a due payout has not come, or while some rewards could
// not be priced.
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

// Aero's reads of the present are kept for five minutes. Its universe is kept as long as `universeReads` says.
const MARKET = "aero market";
const universes = aero.universeReads(() => aero.readUniverse(tagged("aero")));
const universe = () => memo("aero universe", universes.read, universes.ttl);
// A short, stable name for a list of addresses, for use in a key: the list's length and a 53-bit hash of it.
function digest(list: readonly string[]): string {
  let [h1, h2] = [0xdeadbeef, 0x41c6ce57];
  for (const item of list)
    for (const c of `${item},`) {
      h1 = Math.imul(h1 ^ c.charCodeAt(0), 2654435761);
      h2 = Math.imul(h2 ^ c.charCodeAt(0), 1597334677);
    }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return `${list.length}:${(4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36)}`;
}
// Snapshots on the grid's whole hours never change, so each set is read only once, unless some could not be read.
const startsOf: aero.StartsOf = (rewards, times) =>
  memo(
    `aero starts ${times.join()} ${digest(rewards)}`,
    () => aero.startsAt(rewards, times.map(BigInt), tagged("aero")),
    (found: aero.Start[]) => (found.some(aero.unreadStart) ? 0 : Infinity),
  );
const readAero = () => aero.readMarket(universe(), tagged("aero"), startsOf);
// Reads keyed by the grid's hour. They are forgotten once newer hours have replaced them.
const HOURLY = ["aero starts ", "aero past ", "aero prices ", "aero autopilot ", "aero moves "];
let pruned = 0;
export const market = (): Got<aero.Market> => {
  if (performance.now() - pruned > 10 * MINUTE) {
    pruned = performance.now();
    prune(HOURLY, 2 * HOUR);
  }
  return use(MARKET, readAero, 5 * MINUTE);
};
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
// Prices at the start of each of the record's steps, from the pools that price each token now. The grid's times are on
// the hour, so these prices are kept. If some pools could not be read, they are read again in five minutes.
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
// Snapshots outside the grid, which the record's older picks need to look back 8 days. They are read again in five
// minutes if some could not be read.
const unreadIn = (past: aero.Past): boolean =>
  [...past.starts.values()].some((starts) => starts.some((start) => start && aero.unreadStart(start)));
export function pastFor(times: number[]): Got<aero.Past> {
  if (!times.length) return { value: { times: [], starts: new Map() } };
  return andThen(market(), (found) => {
    const rewards = found.gauges.map((gauge) => gauge.rewards);
    return use(
      `aero past ${times.join()} ${digest(rewards)}`,
      async () => aero.pastOf(rewards, times, await startsOf(rewards, times)),
      (past: aero.Past) => (unreadIn(past) ? 5 * MINUTE : Infinity),
    );
  });
}
// A stake's moves since the record's oldest step. They are read again when the stake moves.
const sinceOf = (found: aero.Market): number => aero.stepsOf(found).at(-1)!.from;
const movesSince = (stake: aero.Stake, since: number): [string, () => Promise<aero.Move[]>] => [
  `aero moves ${stake.id} ${stake.lastAllocated} ${since}`,
  () => aero.movesOf(stake, since, tagged("aero")),
];
export const stakeMoves = (stake: aero.Stake): Got<aero.Move[]> =>
  andThen(market(), (found) => use(...movesSince(stake, sinceOf(found))));
// The first Autopilot that its Relay still owns, with its moves and its pools' snapshots at each move.
export type AutopilotRecord = { stake: aero.Stake; moves: aero.Move[]; past: aero.Past };
export const autopilotRecord = (): Got<AutopilotRecord | null> =>
  andThen(market(), (found) =>
    andThen(autopilots(), (stakes) => {
      const stake = AUTOPILOTS.flatMap(({ id, relay }) =>
        stakes.filter((each) => each.id === id && same(each.owner, relay)),
      )[0];
      if (!stake) return { value: null };
      const since = sinceOf(found);
      return use(`aero autopilot ${stake.id} ${stake.lastAllocated} ${since}`, async () => {
        const moves = await memo(...movesSince(stake, since));
        return { stake, moves, past: await aero.movesPast(moves, await marketRead(), since, tagged("aero")) };
      });
    }),
  );
// Waits for the wallet's own stakes first, so that no stake is read twice.
export function stakeShown(id: bigint): Got<aero.Stake | null> {
  const mine = ownStakes();
  const own = mine.value?.find((stake) => stake.id === id);
  if (own) return { value: own };
  if (owner() && mine.value === undefined && !mine.failed) return {};
  return use(`aero stake ${id}`, async () => (await aero.readStakes([id], tagged("aero")))[0] ?? null, 5 * MINUTE);
}
// Read again when a stake moves, and every five minutes.
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
