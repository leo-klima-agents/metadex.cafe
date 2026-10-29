import { AUTOMATIONS, byKind, type Automation, type Kind } from "./config.ts";
import { PENDING, clone, fill, fillAddress, isOpen, show } from "./dom.ts";
import { zeroAddress, type Address } from "viem";
import { now, same } from "./chain.ts";
import {
  holdersOf,
  readAllEarnings,
  readEarnings,
  readVoterEarnings,
  stakesOf,
  valueOf,
  type Earnings,
  type Stake,
} from "./earnings.ts";
import { WEEK, compact, count, fraction, money, moneyAt, weekStart, type Money } from "./format.ts";
import type { Holdings } from "./hydrex.ts";
import { RETRY, reader, type Reader } from "./read.ts";

// What the automations' votes earned last epoch: each automation's line on the menu and on its page, each account's
// part of its automation's, and, on each automation's page, the fold that sets it against all of Hydrex: its
// "Performance".

type Value = ReturnType<typeof valueOf>;
type Read = { found: Earnings; value: Value };

// Called after each read, whichever caller started it, with the automation read and whether its figures are new, could
// not be read, or are as they were.
type Outcome = "read" | "failed" | "same";
const listeners: ((kind: Kind, outcome: Outcome) => void)[] = [];
// Each automation's figures, read again once an epoch has ended, and then each five minutes until Hydrex moves on to the
// new epoch, as it does once someone calls its minter. A read that fails keeps those of an earlier epoch.
const earned = new Map<Kind, Reader<Read>>(
  AUTOMATIONS.map(({ kind, address }) => {
    let heard: Read | undefined;
    const figures: Reader<Read> = reader(
      async (before) => {
        const found = await readEarnings(address, before?.found.start);
        return found ? { found, value: valueOf(found) } : before!;
      },
      {
        stale: ({ found }, since) => found.start < weekStart(now()) - WEEK && since > RETRY,
        settled: () => {
          const outcome = figures.failed ? "failed" : figures.value !== heard ? "read" : "same";
          heard = figures.value;
          for (const listener of listeners) listener(kind, outcome);
        },
      },
    );
    return [kind, figures];
  }),
);
const figuresOf = ({ kind }: Automation): Reader<Read> => earned.get(kind)!;
// All of Hydrex, for each epoch, read once for every automation's fold; and the epoch each fold compares.
const allOf = new Map<number, Promise<Earnings>>();
const compared = new Map<Kind, number>();
// An account's votes count for whoever held them when the epoch began: an automation, or mostly its owner. Each
// account's holder and votes then, by account number, whoever holds it now; `asked` holds the accounts read or being
// read, and `failed` when the last read of each that failed began: it is read again five minutes after. Then what each
// holder that is none of the page's automations earned, for the epoch from `start`, by holder.
let stakes:
  { start: number; of: Map<bigint, Stake | undefined>; asked: Set<bigint>; failed: Map<bigint, number> } | undefined;
const voters = new Map<string, Reader<Read>>();
// All of Hydrex, for the average beside each choice, for the epoch from `start`: its value per 1,000 votes.
let average: { start: number; figures: Reader<{ all: Earnings; per: Money }> } | undefined;

// Each automation's popup "Performance", on its page.
const foldOf = ({ kind }: Automation): HTMLElement =>
  document.querySelector<HTMLElement>(`.view[data-kind="${kind}"] [data-section="record"]`)!;
const part = (fold: HTMLElement, name: string): HTMLElement => fold.querySelector<HTMLElement>(`.${name}`)!;

// Whether any of the automations' figures are due to be read; and whether each one's read has ended, found or failed.
export const earningsDue = (automations: Automation[]): boolean => automations.some((each) => figuresOf(each).due());
export const earningsEnded = (automations: Automation[]): boolean => automations.every((each) => figuresOf(each).ended);

// Resolves to true once new figures are shown for any of the automations. Callers share a read under way.
export const loadEarnings = (automations: Automation[]): Promise<boolean> =>
  Promise.all(automations.map(loadOne)).then((changed) => changed.includes(true));

function loadOne(automation: Automation): Promise<boolean> {
  const figures = figuresOf(automation);
  const before = figures.value;
  // The page works without these figures: it says so where they go, and keeps any from an earlier epoch.
  return figures.read().then(
    (after) => after !== before,
    () => false,
  );
}

export const onEarnings = (listener: (kind: Kind, outcome: Outcome) => void): void => void listeners.push(listener);

// Whether an automation's figures could not be read, and there are none from an earlier epoch.
export const earningsFailed = (automation: Automation): boolean => {
  const figures = figuresOf(automation);
  return figures.failed && !figures.value;
};

// An automation's figures, read first if there are none yet, or none from the epoch from `start`. The receipts read
// each account's rewards in its pools. Just after a flip, until Hydrex moves on to the new epoch, they are still the
// epoch before's.
export async function lastEarnings(automation: Automation, start = 0): Promise<Earnings> {
  if ((figuresOf(automation).value?.found.start ?? -1) < start) await loadOne(automation);
  const found = figuresOf(automation).value?.found;
  if (!found) throw new Error(`What ${automation.name}'s votes earned last epoch could not be read.`);
  return found;
}

// The epoch the automations' figures are of, once one is read.
const shownStart = (): number | undefined =>
  Math.max(0, ...[...earned.values()].map(({ value }) => value?.found.start ?? 0)) || undefined;
// Whether no epoch can be shown: every automation's figures failed, and none were read before. What waits for them, as
// the average and the wallet's own votes, says it could not be read rather than stay pending, until a read succeeds.
const noEpoch = (): boolean => !shownStart() && [...earned.values()].every(({ failed }) => failed);

// Resolves to true once what the accounts' votes earned in the epoch shown is newly read: each account's holder and
// votes, read once an epoch, then what each holder that is none of the page's automations earned, read once. Calls that
// overlap read each account and each holder only once; a read that failed is tried again at a call five minutes after,
// and resolves to true too, so that what waited for it says it could not be read.
export async function loadShares(holdings: Holdings): Promise<boolean> {
  const start = shownStart();
  if (!start) return false;
  if (stakes?.start !== start) {
    stakes = { start, of: new Map(), asked: new Set(), failed: new Map() };
    voters.clear();
  }
  const known = stakes;
  const time = Date.now();
  const missing = holdings.accounts
    .filter(({ amount }) => amount > 0n)
    .map(({ id }) => id)
    .filter((id) => !known.asked.has(id) && time - (known.failed.get(id) ?? -Infinity) >= RETRY);
  let changed = false;
  if (missing.length) {
    for (const id of missing) known.asked.add(id);
    const found = await stakesOf(missing, start).catch((error) => void console.error(error));
    if (!found) for (const id of missing) known.asked.delete(id);
    if (stakes !== known) return false;
    // A failure is news too: what waited for it says so.
    if (!found) {
      for (const id of missing) known.failed.set(id, time);
      return true;
    }
    for (const id of missing) {
      known.failed.delete(id);
      known.of.set(id, found.get(id));
    }
    changed = true;
  }
  const reads = holdersOf(known.of.values()).map((holder) => {
    const key = holder.toLowerCase();
    let voter = voters.get(key);
    if (!voter) {
      voter = reader(async () => {
        const found = await readVoterEarnings(holder, start);
        return { found, value: valueOf(found) };
      });
      voters.set(key, voter);
    }
    const these = voter;
    if (these.value || (!these.reading && !these.due())) return Promise.resolve(false);
    const current = () => voters.get(key) === these;
    return these.read().then(current, current);
  });
  return (await Promise.all(reads)).includes(true) || changed;
}

const voterOf = (holder: Address): Reader<Read> | undefined =>
  stakes?.start === shownStart() ? voters.get(holder.toLowerCase()) : undefined;

// What an owner's own votes earned in the epoch shown per 1,000 votes: undefined until read, and null if it
// could not be, until read again; "none" if none of their accounts' votes were theirs when it began, as when all were
// in automations; "unvoted" if they did not vote.
export function ownPerThousand({ owner, accounts }: Holdings): Money | "none" | "unvoted" | null | undefined {
  const ids = accounts.filter(({ amount }) => amount > 0n).map(({ id }) => id);
  if (noEpoch()) return null;
  if (!stakes || stakes.start !== shownStart()) return undefined;
  const unread = ids.filter((id) => !stakes!.of.has(id));
  if (unread.length) return unread.some((id) => stakes!.failed.has(id)) ? null : undefined;
  if (!ids.some((id) => same(stakes!.of.get(id)?.delegate ?? zeroAddress, owner))) return "none";
  const voter = voterOf(owner);
  const read = voter?.value;
  if (!read) return voter?.failed ? null : undefined;
  if (!read.found.votes) return "none";
  return read.found.pools.length ? moneyAt(perThousand(read.value.total, read.found.votes), read.value) : "unvoted";
}

// An owner's own votes against the average, when they voted with them: undefined until both are read, and null when
// there is none to show.
export function ownVersus(holdings: Holdings): number | null | undefined {
  const own = ownPerThousand(holdings);
  if (own === undefined) return undefined;
  const found = typeof own === "object" && own ? voterOf(holdings.owner)?.value?.found : undefined;
  return found ? versusAverage(found) : null;
}

// What the account's votes earned in the epoch shown, at its prices: its part of its automation's, or of whoever else
// held its votes, if they voted then. Undefined until read, and null when there is none to show: an account with no
// votes, or none then, a holder that did not vote, or a read that failed.
export function earnedByAccount({ id, amount }: { id: bigint; amount: bigint }): Money | null | undefined {
  if (amount === 0n || noEpoch()) return null;
  if (!stakes || stakes.start !== shownStart()) return undefined;
  if (!stakes.of.has(id)) return stakes.failed.has(id) ? null : undefined;
  const stake: Stake | undefined = stakes.of.get(id);
  if (!stake) return null;
  const automation = AUTOMATIONS.find(({ address }) => same(address, stake.delegate));
  const figures = automation ? figuresOf(automation) : voterOf(stake.delegate);
  const read = figures?.value;
  if (!read) return figures?.failed ? null : undefined;
  if (read.found.start !== stakes.start || !read.found.votes) return null;
  if (!automation && !read.found.pools.length) return null;
  return moneyAt((Number(stake.votes) / Number(read.found.votes)) * read.value.total, read.value);
}

// Hydrex's average, per 1,000 votes, in the epoch the automations' figures are of: read once, after the page's
// own reads, and five minutes after a read that failed. Resolves to true once newly read, or failed.
export async function loadAverage(): Promise<boolean> {
  const start = shownStart();
  if (!start) return false;
  if (average?.start !== start) {
    const figures = reader(async () => {
      const all = await readAll(start);
      const value = valueOf(all);
      return { all, per: moneyAt(perThousand(value.total, all.votes), value) };
    });
    average = { start, figures };
  }
  const { figures } = average;
  if (!figures.due()) return false;
  const current = () => average?.figures === figures;
  return figures.read().then(current, current);
}

// Hydrex's average: undefined until read, and null if it, or the epoch it is of, could not be.
export function averagePerThousand(): Money | null | undefined {
  if (noEpoch()) return null;
  const figures = average?.start === shownStart() ? average?.figures : undefined;
  return figures?.failed ? null : figures?.value?.per;
}

// What some votes earned per 1,000 votes against Hydrex's average, as a ratio: both at the average's prices,
// so that they compare fairly, as the popup "Performance" does. Undefined until the average is read, and null
// if it could not be, or if it is of another epoch than the one shown, which the page does not read.
function versusAverage(found: Earnings): number | null | undefined {
  const figures = average?.start === found.start ? average.figures : undefined;
  if (!figures) return found.start === shownStart() ? undefined : null;
  if (figures.failed) return null;
  const all = figures.value?.all;
  if (!all) return undefined;
  const ratio =
    perThousand(valueOf({ ...found, prices: all.prices }).total, found.votes) /
    perThousand(valueOf(all).total, all.votes);
  return Number.isFinite(ratio) ? ratio : null;
}

// An automation's votes against the average: undefined until both are read, and null when there is none to show, as
// with no record, or with figures that could not be read.
export const automationVersus = (automation: Automation): number | null | undefined => {
  const figures = figuresOf(automation);
  const found = figures.value?.found;
  if (!found) return figures.failed ? null : undefined;
  return found.pools.length && found.votes ? versusAverage(found) : null;
};

// An automation's figures shown, if read.
export const earningsOf = (automation: Automation): Earnings | undefined => figuresOf(automation).value?.found;

// What an automation earned last epoch per 1,000 votes, at last epoch's prices: undefined until read, and null
// if it had no votes then, so no record yet.
export function perThousandOf(automation: Automation): Money | null | undefined {
  const read = figuresOf(automation).value;
  if (!read) return undefined;
  return read.found.votes ? moneyAt(perThousand(read.value.total, read.found.votes), read.value) : null;
}

const perThousand = (value: number, votes: bigint): number => (votes > 0n ? value / (Number(votes) / 1e21) : 0);

// A table's figures to the cent, so that each column lines up at the point.
const CENTS = { cents: true };

function showColumn(table: HTMLElement, column: "ours" | "all", { votes, pools }: Earnings, value: Value): void {
  const per = perThousand(value.total, votes);
  fill(table, {
    [`${column}.votes`]: compact(votes),
    [`${column}.pools`]: count(pools.length, "pool", "pools"),
    [`${column}.earned`]: () => money(moneyAt(value.total, value), CENTS),
    [`${column}.fees`]: () => money(moneyAt(value.fees, value), CENTS),
    [`${column}.incentives`]: () => money(moneyAt(value.incentives, value), CENTS),
    [`${column}.per-thousand`]: () => money(moneyAt(per, value), CENTS),
  });
}

function showPools(fold: HTMLElement, { pools, votes }: Earnings, value: Value): void {
  const rows = pools.map((pool) => {
    const row = clone("earned-pool");
    fillAddress(row, "pool", pool.address, pool.name);
    const earnedThere = value.byPool.get(pool.address.toLowerCase()) ?? 0;
    fill(row, {
      share: fraction(Number(pool.votes) / Number(votes)),
      worth: () => money(moneyAt(earnedThere, value), CENTS),
    });
    return row;
  });
  fold.querySelector(".earned-pools tbody")!.replaceChildren(...rows);
}

function showEarnings(automation: Automation, { found, value }: Read): void {
  const fold = foldOf(automation);
  const table = part(fold, "earnings");
  part(fold, "record-waiting").hidden = part(fold, "record-failed").hidden = true;
  show(".record-none", !found.votes, fold);
  show(".record-found", !!found.votes, fold);
  showColumn(table, "ours", found, value);
  showPools(fold, found, value);
  part(fold, "all-status").hidden = false;
  part(fold, "all-failed").hidden = part(fold, "versus").hidden = true;
  fill(table, { all: PENDING });
  compared.delete(automation.kind);
  if (isOpen(fold)) compare(automation);
}

function readAll(start: number): Promise<Earnings> {
  let found = allOf.get(start);
  if (!found) {
    found = readAllEarnings(start);
    allOf.set(start, found);
    found.catch(() => allOf.delete(start));
  }
  return found;
}

// All of Hydrex takes ten times the reads, so it waits until the fold opens. Both columns then use the same prices,
// so that they compare fairly.
function compare(automation: Automation): void {
  const { kind, name } = automation;
  const mine = figuresOf(automation).value?.found;
  if (!mine || !mine.votes || compared.get(kind) === mine.start) return;
  compared.set(kind, mine.start);
  const fold = foldOf(automation);
  const table = part(fold, "earnings");
  const [status, failed, versus] = ["all-status", "all-failed", "versus"].map((each) => part(fold, each)) as [
    HTMLElement,
    HTMLElement,
    HTMLElement,
  ];
  failed.hidden = true;
  status.hidden = false;
  fill(table, { all: PENDING });
  readAll(mine.start).then(
    (all) => {
      if (figuresOf(automation).value?.found !== mine) return;
      const ours = valueOf({ ...mine, prices: all.prices });
      const average = valueOf(all);
      showColumn(table, "ours", mine, ours);
      showColumn(table, "all", all, average);
      const ratio = perThousand(ours.total, mine.votes) / perThousand(average.total, all.votes);
      // Before what it takes: the menu and its key figure give what reached the owner.
      versus.textContent =
        Math.abs(ratio - 1) < 0.005
          ? `${name}'s votes earned about the average last epoch.`
          : `${name}'s votes earned ${fraction(Math.abs(ratio - 1))} ${ratio > 1 ? "more" : "less"} than average last epoch.`;
      status.hidden = true;
      versus.hidden = !Number.isFinite(ratio);
    },
    (error) => {
      console.error(error);
      if (figuresOf(automation).value?.found !== mine) return;
      compared.delete(kind);
      status.hidden = true;
      failed.hidden = false;
      // Its column waits no more: the notice under it says why, with Try again.
      fill(table, { all: "" });
    },
  );
}

// Each automation's figures show in its fold, and the fold compares once it opens. Until they are read, its table shows
// with its figures pending; if they cannot be, it says so, with Try again, which the page also does five minutes after.
function showWaiting(automation: Automation, failed: boolean): void {
  const fold = foldOf(automation);
  part(fold, "record-waiting").hidden = failed;
  part(fold, "record-found").hidden = failed;
  part(fold, "record-failed").hidden = !failed;
}

onEarnings((kind, outcome) => {
  const automation = byKind(kind)!;
  const read = figuresOf(automation).value;
  if (outcome === "read" && read) showEarnings(automation, read);
  if (outcome === "failed" && !read) showWaiting(automation, true);
});

for (const automation of AUTOMATIONS) {
  const fold = foldOf(automation);
  fold.addEventListener("toggle", () => isOpen(fold) && compare(automation));
  fold.querySelector(".compare-again")!.addEventListener("click", () => compare(automation));
  fold.querySelector(".record-again")!.addEventListener("click", () => {
    showWaiting(automation, false);
    void loadOne(automation);
  });
}
