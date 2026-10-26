import { AUTOMATIONS, byKind, type Automation, type Kind } from "./config.ts";
import { clone, fill, fillAddress, isOpen, show } from "./dom.ts";
import { zeroAddress, type Address } from "viem";
import { same } from "./chain.ts";
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
import { WEEK, compact, count, fraction, money, moneyAt, toEarningPower, type Money } from "./format.ts";
import type { Holdings } from "./hydrex.ts";

// What the automations' votes earned last epoch: each automation's line on the menu and on its page, each account's
// part of its automation's, and, on each automation's page, the fold that sets it against all of Hydrex.

type Value = ReturnType<typeof valueOf>;
type Read = { found: Earnings; value: Value };

// Each automation's figures, its read under way, when it was last tried, and whether that failed.
const earned = new Map<Kind, Read>();
const reading = new Map<Kind, Promise<boolean>>();
const tried = new Map<Kind, number>();
const failedKinds = new Set<Kind>();
// Called after each read, whichever caller started it, with the automation read and whether its figures are new, could
// not be read, or are as they were.
type Outcome = "read" | "failed" | "same";
const listeners: ((kind: Kind, outcome: Outcome) => void)[] = [];
// All of Hydrex, for each epoch, read once for every automation's fold; and the epoch each fold compares.
const allOf = new Map<number, Promise<Earnings>>();
const compared = new Map<Kind, number>();
// An account's votes count for whoever held them when the epoch began: an automation, or mostly its owner. Each
// account's holder and votes then, by account number, whoever holds it now; `asked` holds the accounts read or being
// read. Then what each holder that is none of the page's automations earned, for the epoch from `start`.
let stakes: { start: number; of: Map<bigint, Stake | undefined>; asked: Set<bigint> } | undefined;
const voters = new Map<string, { start: number; read?: Read; reading?: Promise<void> | undefined }>();
// All of Hydrex, for the average beside each choice: its value per 1,000 Earning Power, once read.
type Average = { start: number; all?: Earnings; per?: Money; failed?: number };
let average: Average | undefined;

// Each automation's popup "Against all of Hydrex", on its page.
const foldOf = ({ kind }: Automation): HTMLElement =>
  document.querySelector<HTMLElement>(`.view[data-kind="${kind}"] [data-section="record"]`)!;
const part = (fold: HTMLElement, name: string): HTMLElement => fold.querySelector<HTMLElement>(`.${name}`)!;

export const earningsDue = (epoch: number, automations: Automation[]): boolean =>
  automations.some(
    ({ kind }) =>
      !reading.has(kind) &&
      (earned.get(kind)?.found.start ?? 0) < epoch - WEEK &&
      Date.now() - (tried.get(kind) ?? 0) > 300_000,
  );

// Resolves to true once new figures are shown for any of the automations. Callers share a read under way.
export const loadEarnings = (automations: Automation[]): Promise<boolean> =>
  Promise.all(automations.map(loadOne)).then((changed) => changed.includes(true));

function loadOne(automation: Automation): Promise<boolean> {
  const { kind } = automation;
  let pending = reading.get(kind);
  if (!pending) {
    pending = readAndShow(automation).finally(() => reading.delete(kind));
    reading.set(kind, pending);
  }
  return pending;
}

export const onEarnings = (listener: (kind: Kind, outcome: Outcome) => void): void => void listeners.push(listener);

async function readAndShow({ kind, address }: Automation): Promise<boolean> {
  tried.set(kind, Date.now());
  let outcome: Outcome = "same";
  try {
    const found = await readEarnings(address, earned.get(kind)?.found.start);
    if (!found) return false;
    earned.set(kind, { found, value: valueOf(found) });
    failedKinds.delete(kind);
    outcome = "read";
    return true;
  } catch (error) {
    // The page works without these figures: it says so where they go, and keeps any from an earlier epoch.
    console.error(error);
    failedKinds.add(kind);
    outcome = "failed";
    return false;
  } finally {
    for (const listener of listeners) listener(kind, outcome);
  }
}

// Whether an automation's figures could not be read, and there are none from an earlier epoch.
export const earningsFailed = ({ kind }: Automation): boolean => failedKinds.has(kind) && !earned.has(kind);

// An automation's figures, read first if there are none yet, or none from the epoch from `start`. The receipts read
// each account's rewards in its pools. Just after a flip, until Hydrex moves on to the new epoch, they are still the
// epoch before's.
export async function lastEarnings(automation: Automation, start = 0): Promise<Earnings> {
  if ((earned.get(automation.kind)?.found.start ?? -1) < start) await loadOne(automation);
  const found = earned.get(automation.kind)?.found;
  if (!found) throw new Error(`What ${automation.name}'s votes earned last epoch could not be read.`);
  return found;
}

// The epoch the automations' figures are of, once one is read.
const shownStart = (): number | undefined =>
  Math.max(0, ...[...earned.values()].map(({ found }) => found.start)) || undefined;

// Resolves to true once what the accounts' votes earned in the epoch shown is newly read: each account's holder and
// votes, read once an epoch, then what each holder that is none of the page's automations earned, read once. Calls that
// overlap read each account and each holder only once; a read that failed is tried again at the next call.
export async function loadShares(holdings: Holdings): Promise<boolean> {
  const start = shownStart();
  if (!start) return false;
  if (stakes?.start !== start) stakes = { start, of: new Map(), asked: new Set() };
  const known = stakes;
  const missing = holdings.accounts
    .filter(({ amount }) => amount > 0n)
    .map(({ id }) => id)
    .filter((id) => !known.asked.has(id));
  let changed = false;
  if (missing.length) {
    for (const id of missing) known.asked.add(id);
    const found = await stakesOf(missing, start).catch((error) => void console.error(error));
    if (!found) for (const id of missing) known.asked.delete(id);
    if (!found || stakes !== known) return false;
    for (const id of missing) known.of.set(id, found.get(id));
    changed = true;
  }
  const reads = holdersOf(known.of.values()).map((holder) => {
    const key = holder.toLowerCase();
    let voter = voters.get(key);
    if (voter?.start !== start) voters.set(key, (voter = { start }));
    if (voter.read) return Promise.resolve(false);
    const entry = voter;
    entry.reading ??= readVoterEarnings(holder, start).then(
      (found) => void (entry.read = { found, value: valueOf(found) }),
      (error) => {
        console.error(error);
        entry.reading = undefined;
      },
    );
    return entry.reading.then(() => voters.get(key) === entry && !!entry.read);
  });
  return (await Promise.all(reads)).includes(true) || changed;
}

const voterOf = (holder: Address): Read | undefined => {
  const voter = voters.get(holder.toLowerCase());
  return voter && voter.start === stakes?.start ? voter.read : undefined;
};

// What an owner's own votes earned in the epoch shown per 1,000 Earning Power: undefined until read; "none" if none of
// their accounts' votes were theirs when it began, as when all were in automations; "unvoted" if they did not vote.
export function ownPerThousand({ owner, accounts }: Holdings): Money | "none" | "unvoted" | undefined {
  const ids = accounts.filter(({ amount }) => amount > 0n).map(({ id }) => id);
  if (!stakes || stakes.start !== shownStart() || ids.some((id) => !stakes!.of.has(id))) return undefined;
  if (!ids.some((id) => same(stakes!.of.get(id)?.delegate ?? zeroAddress, owner))) return "none";
  const read = voterOf(owner);
  if (!read) return undefined;
  if (!read.found.votes) return "none";
  return read.found.pools.length ? moneyAt(perThousand(read.value.total, read.found.votes), read.value) : "unvoted";
}

// An owner's own votes against the average, when they voted with them.
export function ownVersus(holdings: Holdings): number | undefined {
  if (typeof ownPerThousand(holdings) !== "object") return undefined;
  return versusAverage(voterOf(holdings.owner)?.found);
}

// What the account's votes earned in the epoch shown, at its prices: its part of its automation's, or of whoever else
// held its votes, if they voted then.
export function earnedByAccount(id: bigint): Money | undefined {
  const stake: Stake | undefined = stakes?.of.get(id);
  if (!stake) return undefined;
  const automation = AUTOMATIONS.find(({ address }) => same(address, stake.delegate));
  const read = automation ? earned.get(automation.kind) : voterOf(stake.delegate);
  if (!read || read.found.start !== stakes!.start || !read.found.votes) return undefined;
  if (!automation && !read.found.pools.length) return undefined;
  return moneyAt((Number(stake.power) / Number(read.found.votes)) * read.value.total, read.value);
}

// Hydrex's average, per 1,000 Earning Power, in the epoch the automations' figures are of: read once, after the page's
// own reads, and five minutes after a read that failed. Resolves to true once newly read, or failed.
export async function loadAverage(): Promise<boolean> {
  const start = shownStart();
  const retry = !!average?.failed && Date.now() - average.failed >= 300_000;
  if (!start || (average?.start === start && !retry)) return false;
  const mine: Average = { start };
  average = mine;
  try {
    const all = await readAll(start);
    if (average !== mine) return false;
    const value = valueOf(all);
    mine.all = all;
    mine.per = moneyAt(perThousand(value.total, all.votes), value);
    return true;
  } catch (error) {
    console.error(error);
    if (average === mine) mine.failed = Date.now();
    return true;
  }
}

// Hydrex's average: undefined until read, and null if it could not be.
export const averagePerThousand = (): Money | null | undefined =>
  average?.start !== shownStart() ? undefined : average?.failed ? null : average?.per;

// What some votes earned per 1,000 Earning Power against Hydrex's average, as a ratio: both at the average's prices,
// so that they compare fairly, as the popup "Against all of Hydrex" does. Undefined until both are read.
function versusAverage(found: Earnings | undefined): number | undefined {
  const all = average?.start === found?.start ? average?.all : undefined;
  if (!found || !all || !found.votes) return undefined;
  const ratio =
    perThousand(valueOf({ ...found, prices: all.prices }).total, found.votes) /
    perThousand(valueOf(all).total, all.votes);
  return Number.isFinite(ratio) ? ratio : undefined;
}

// An automation's votes against the average, once it has a record.
export const automationVersus = ({ kind }: Automation): number | undefined => {
  const found = earned.get(kind)?.found;
  return found?.pools.length ? versusAverage(found) : undefined;
};

// An automation's figures shown, if read.
export const earningsOf = (automation: Automation): Earnings | undefined => earned.get(automation.kind)?.found;

// What an automation earned last epoch per 1,000 Earning Power, at last epoch's prices: undefined until read, and null
// if it had no votes then, so no record yet.
export function perThousandOf(automation: Automation): Money | null | undefined {
  const read = earned.get(automation.kind);
  if (!read) return undefined;
  return read.found.votes ? moneyAt(perThousand(read.value.total, read.found.votes), read.value) : null;
}

const perThousand = (value: number, votes: bigint): number =>
  votes > 0n ? value / (Number(toEarningPower(votes)) / 1e21) : 0;

// A table's figures to the cent, so that each column lines up at the point.
const CENTS = { cents: true };

function showColumn(table: HTMLElement, column: "ours" | "all", { votes, pools }: Earnings, value?: Value): void {
  const per = value && perThousand(value.total, votes);
  fill(table, {
    [`${column}.earning-power`]: compact(toEarningPower(votes)),
    [`${column}.pools`]: count(pools.length, "pool", "pools"),
    [`${column}.earned`]: value ? () => money(moneyAt(value.total, value), CENTS) : "…",
    [`${column}.fees`]: value ? () => money(moneyAt(value.fees, value), CENTS) : "…",
    [`${column}.incentives`]: value ? () => money(moneyAt(value.incentives, value), CENTS) : "…",
    [`${column}.per-power`]: per === undefined ? "…" : () => money(moneyAt(per, value!), CENTS),
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
  part(fold, "record-waiting").hidden = true;
  show(".record-none", !found.votes, fold);
  show(".record-found", !!found.votes, fold);
  showColumn(table, "ours", found, value);
  showPools(fold, found, value);
  part(fold, "all-status").hidden = false;
  part(fold, "all-status").textContent = "Loading all of Hydrex…";
  part(fold, "all-failed").hidden = part(fold, "versus").hidden = true;
  fill(table, { all: "…" });
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
  const mine = earned.get(kind)?.found;
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
  readAll(mine.start).then(
    (all) => {
      if (earned.get(kind)?.found !== mine) return;
      const ours = valueOf({ ...mine, prices: all.prices });
      const average = valueOf(all);
      showColumn(table, "ours", mine, ours);
      showColumn(table, "all", all, average);
      const ratio = perThousand(ours.total, mine.votes) / perThousand(average.total, all.votes);
      // Before what it takes: the menu and its key figure give what reached the owner.
      versus.textContent =
        Math.abs(ratio - 1) < 0.005
          ? `${name}'s votes earned about Hydrex's average, before what it takes`
          : `${name}'s votes earned ${fraction(Math.abs(ratio - 1))} ${ratio > 1 ? "more" : "less"} than Hydrex's average, before what it takes`;
      status.hidden = true;
      versus.hidden = !Number.isFinite(ratio);
    },
    (error) => {
      console.error(error);
      if (earned.get(kind)?.found !== mine) return;
      compared.delete(kind);
      status.hidden = true;
      failed.hidden = false;
    },
  );
}

// Each automation's figures show in its fold, and the fold compares once it opens. Until they are read, it says so.
onEarnings((kind, outcome) => {
  const automation = byKind(kind)!;
  const read = earned.get(kind);
  if (outcome === "read" && read) showEarnings(automation, read);
  if (outcome === "failed" && !read) {
    part(foldOf(automation), "record-waiting").textContent = "Reading last epoch failed.";
  }
});

for (const automation of AUTOMATIONS) {
  const fold = foldOf(automation);
  fold.addEventListener("toggle", () => isOpen(fold) && compare(automation));
  fold.querySelector(".compare-again")!.addEventListener("click", () => compare(automation));
}
