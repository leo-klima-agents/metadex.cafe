import { AUTOMATIONS, byKind, type Automation, type Kind } from "./config.ts";
import { clone, fill, fillAddress, isOpen, show } from "./dom.ts";
import { readAllEarnings, readEarnings, sharesOf, valueOf, type Earnings } from "./earnings.ts";
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
// Each account's share of each automation's votes in the epoch from `start`, by account number, whoever holds it:
// undefined for an account not in it. `asked` holds the accounts whose shares are read or being read.
type Shares = { start: number; of: Map<bigint, number | undefined>; asked: Set<bigint> };
const shares = new Map<Kind, Shares>();

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

// Resolves to true once some of the accounts' shares of each automation's votes in the epoch shown are newly read.
// A share is read once: overlapping calls read each account only once.
export async function loadShares(holdings: Holdings, automations: Automation[]): Promise<boolean> {
  const ids = holdings.accounts.filter(({ amount }) => amount > 0n).map(({ id }) => id);
  const read = await Promise.all(
    automations.map(async ({ kind, address }) => {
      const found = earned.get(kind)?.found;
      if (!found || !found.votes) return false;
      if (shares.get(kind)?.start !== found.start)
        shares.set(kind, { start: found.start, of: new Map(), asked: new Set() });
      const known = shares.get(kind)!;
      const missing = ids.filter((id) => !known.asked.has(id));
      if (!missing.length) return false;
      for (const id of missing) known.asked.add(id);
      const of = await sharesOf(missing, found.start, found.votes, address).catch((error) => void console.error(error));
      // A failed read is tried again at the next call.
      if (!of) for (const id of missing) known.asked.delete(id);
      if (!of || shares.get(kind) !== known) return false;
      for (const id of missing) known.of.set(id, of.get(id));
      return true;
    }),
  );
  return read.includes(true);
}

// What the account's votes earned in the epoch shown, at its prices, if it was in one of the automations then.
export function earnedByAccount(id: bigint): Money | undefined {
  for (const [kind, { start, of }] of shares) {
    const read = earned.get(kind);
    const part = of.get(id);
    if (read && start === read.found.start && part !== undefined) return moneyAt(part * read.value.total, read.value);
  }
  return undefined;
}

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

function showColumn(table: HTMLElement, column: "ours" | "all", { votes, pools }: Earnings, value?: Value): void {
  const per = value && perThousand(value.total, votes);
  fill(table, {
    [`${column}.earning-power`]: compact(toEarningPower(votes)),
    [`${column}.pools`]: count(pools.length, "pool", "pools"),
    [`${column}.earned`]: value ? () => money(moneyAt(value.total, value)) : "…",
    [`${column}.fees`]: value ? () => money(moneyAt(value.fees, value)) : "…",
    [`${column}.incentives`]: value ? () => money(moneyAt(value.incentives, value)) : "…",
    [`${column}.per-power`]: per === undefined ? "…" : () => money(moneyAt(per, value!)),
  });
}

function showPools(fold: HTMLElement, { pools, votes }: Earnings, value: Value): void {
  const rows = pools.map((pool) => {
    const row = clone("earned-pool");
    fillAddress(row, "pool", pool.address, pool.name);
    const earnedThere = value.byPool.get(pool.address.toLowerCase()) ?? 0;
    fill(row, { share: fraction(Number(pool.votes) / Number(votes)), worth: () => money(moneyAt(earnedThere, value)) });
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
      versus.textContent =
        Math.abs(ratio - 1) < 0.005
          ? "About Hydrex's average"
          : `${fraction(Math.abs(ratio - 1))} ${ratio > 1 ? "above" : "below"} Hydrex's average`;
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

// An automation not on Base has no figures to read.
export function showAbsent(automation: Automation): void {
  part(foldOf(automation), "record-waiting").textContent = "Not on Base yet.";
}

for (const automation of AUTOMATIONS) {
  const fold = foldOf(automation);
  fold.addEventListener("toggle", () => isOpen(fold) && compare(automation));
  fold.querySelector(".compare-again")!.addEventListener("click", () => compare(automation));
}
