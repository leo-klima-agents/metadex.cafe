import { CARBON_IMPACT, type Automation, type Kind } from "./config.ts";
import { clone, fill, fillAddress, fillTime, show } from "./dom.ts";
import { readAllEarnings, readEarnings, sharesOf, valueOf, type Earnings } from "./earnings.ts";
import { WEEK, compact, count, fraction, toEarningPower, usd } from "./format.ts";
import type { Holdings } from "./hydrex.ts";

// What the automations' votes earned last epoch: Carbon Impact's figure on Home, each account's part of its
// automation's in the App, and the section "How the votes did last epoch".

type Value = ReturnType<typeof valueOf>;
type Read = { found: Earnings; value: Value };

// Each automation's figures, its read under way, when it was last tried, and whether that failed.
const earned = new Map<Kind, Read>();
const reading = new Map<Kind, Promise<boolean>>();
const tried = new Map<Kind, number>();
const failedKinds = new Set<Kind>();
// Called after each read, whichever caller started it, with the automation whose figures are new or failed.
const listeners: ((kind: Kind) => void)[] = [];
let comparedEpoch: number | undefined;
let onScreen = false;
// Each account's share of its automation's votes, kept with the accounts it was read for.
const shares = new WeakMap<Holdings, Map<Kind, { start: number; of: Map<bigint, number> }>>();

const carbonImpact = (): Read | undefined => earned.get(CARBON_IMPACT.kind);

const table = document.querySelector<HTMLElement>("#last-epoch .earnings")!;
const comparison = {
  status: document.querySelector<HTMLElement>("#last-epoch .all-status")!,
  failed: document.querySelector<HTMLElement>("#last-epoch .all-failed")!,
  versus: document.querySelector<HTMLElement>("#last-epoch .versus")!,
};
const waiting = comparison.status.textContent ?? "";

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

export const onEarnings = (listener: (kind: Kind) => void): void => void listeners.push(listener);

async function readAndShow({ kind, address }: Automation): Promise<boolean> {
  tried.set(kind, Date.now());
  try {
    const found = await readEarnings(address, earned.get(kind)?.found.start);
    if (!found) return false;
    const value = valueOf(found);
    earned.set(kind, { found, value });
    failedKinds.delete(kind);
    display[kind].read(found, value);
    return true;
  } catch (error) {
    // The page works without these figures: it says so where they go, and keeps any from an earlier epoch.
    console.error(error);
    failedKinds.add(kind);
    display[kind].failed();
    return false;
  } finally {
    for (const listener of listeners) listener(kind);
  }
}

// Whether an automation's figures could not be read, and there are none from an earlier epoch.
export const earningsFailed = ({ kind }: Automation): boolean => failedKinds.has(kind) && !earned.has(kind);

// An automation's figures, read first if there are none yet. The receipts read each account's rewards in its pools.
export async function lastEarnings(automation: Automation): Promise<Earnings> {
  if (!earned.has(automation.kind)) await loadOne(automation);
  const found = earned.get(automation.kind)?.found;
  if (!found) throw new Error(`What ${automation.name}'s votes earned last epoch could not be read.`);
  return found;
}

// Resolves to true once the accounts' shares of each automation's votes in the epoch shown are read.
// Overlapping calls for the same accounts share one map, each adding its automations' shares.
export async function loadShares(holdings: Holdings, automations: Automation[]): Promise<boolean> {
  const known = shares.get(holdings) ?? new Map();
  shares.set(holdings, known);
  const ids = holdings.accounts.filter(({ amount }) => amount > 0n).map(({ id }) => id);
  const read = await Promise.all(
    automations.map(async ({ kind, address }) => {
      const found = earned.get(kind)?.found;
      if (!found || !found.votes || known.get(kind)?.start === found.start) return false;
      const of = await sharesOf(ids, found.start, found.votes, address).catch((error) => void console.error(error));
      if (!of || earned.get(kind)?.found !== found) return false;
      known.set(kind, { start: found.start, of });
      return true;
    }),
  );
  return read.includes(true);
}

// What the account's votes earned in the epoch shown, in dollars, if it was in one of the automations then.
export function earnedByAccount(holdings: Holdings, id: bigint): number | undefined {
  for (const [kind, { start, of }] of shares.get(holdings) ?? []) {
    const read = earned.get(kind);
    const part = of.get(id);
    if (read && start === read.found.start && part !== undefined) return part * read.value.usd;
  }
  return undefined;
}

// An automation's figures shown, if read.
export const earningsOf = (automation: Automation): Earnings | undefined => earned.get(automation.kind)?.found;

// Last epoch's dollars per 1,000 Earning Power for an automation: undefined until read, and null if it had no votes
// then, so no record yet.
export function perThousandOf(automation: Automation): number | null | undefined {
  const read = earned.get(automation.kind);
  if (!read) return undefined;
  return read.found.votes ? perThousand(read.value.usd, read.found.votes) : null;
}

const perThousand = (value: number, votes: bigint): number =>
  votes > 0n ? value / (Number(toEarningPower(votes)) / 1e21) : 0;

function showColumn(column: "ours" | "all", { votes, pools }: Earnings, value: Value | undefined): void {
  const per = value && perThousand(value.usd, votes);
  fill(table, {
    [`${column}.earning-power`]: compact(toEarningPower(votes)),
    [`${column}.pools`]: count(pools.length, "pool", "pools"),
    [`${column}.earned`]: value ? usd(value.usd) : "…",
    [`${column}.fees`]: value ? usd(value.fees) : "…",
    [`${column}.incentives`]: value ? usd(value.incentives) : "…",
    [`${column}.per-power`]: per === undefined ? "…" : usd(per),
  });
}

function showPools({ pools, votes }: Earnings, value: Value): void {
  const rows = pools.map((pool) => {
    const row = clone("earned-pool");
    fillAddress(row, "pool", pool.address, pool.name);
    const earnedThere = value.byPool.get(pool.address.toLowerCase()) ?? 0;
    fill(row, { share: fraction(Number(pool.votes) / Number(votes)), usd: usd(earnedThere) });
    return row;
  });
  document.querySelector("#last-epoch .earned-pools tbody")!.replaceChildren(...rows);
}

function showEarnings(found: Earnings, value: Value): void {
  show(".earnings-failed", false);
  show(".earnings-read");
  fillTime(document, "last-start", found.start);
  fillTime(document, "last-end", found.start + WEEK);
  fill(document, { "last-per-power": usd(perThousand(value.usd, found.votes)) });
  showColumn("ours", found, value);
  showPools(found, value);
  comparison.status.textContent = waiting;
  comparison.status.hidden = false;
  comparison.failed.hidden = comparison.versus.hidden = true;
  fill(table, { all: "…" });
  if (onScreen) compare();
}

// All of Hydrex takes ten times the reads, so it waits until its table is on the screen. Both columns then use the
// same prices, so that they compare fairly.
function compare(): void {
  const mine = carbonImpact()?.found;
  if (!mine || comparedEpoch === mine.start) return;
  comparedEpoch = mine.start;
  comparison.failed.hidden = true;
  comparison.status.hidden = false;
  comparison.status.textContent = "Reading every pool's rewards…";
  readAllEarnings(mine.start).then(
    (all) => {
      if (carbonImpact()?.found !== mine) return;
      const ours = valueOf({ ...mine, prices: all.prices });
      const average = valueOf(all);
      showColumn("ours", mine, ours);
      showColumn("all", all, average);
      const ratio = perThousand(ours.usd, mine.votes) / perThousand(average.usd, all.votes);
      comparison.versus.textContent =
        Math.abs(ratio - 1) < 0.005
          ? "Last epoch, Carbon Impact earned about as much per 1,000 Earning Power as the average on Hydrex, at the same prices."
          : `Last epoch, Carbon Impact earned ${fraction(Math.abs(ratio - 1))} ${ratio > 1 ? "more" : "less"} per 1,000 Earning Power than the average on Hydrex, at the same prices. Tokens left unpriced count for nothing in either.`;
      comparison.status.hidden = true;
      comparison.versus.hidden = !Number.isFinite(ratio);
    },
    (error) => {
      console.error(error);
      if (carbonImpact()?.found !== mine) return;
      comparedEpoch = undefined;
      comparison.status.hidden = true;
      comparison.failed.hidden = false;
    },
  );
}

// Where each automation's figures show besides its listeners: Carbon Impact's in Home's numbers and in the section on
// how the votes did; AutoMaxi's on its own page, which the page's script fills when told.
const display: Record<Kind, { read(found: Earnings, value: Value): void; failed(): void }> = {
  "carbon-impact": {
    read: showEarnings,
    failed() {
      show(".earnings-failed", !carbonImpact());
      show(".earnings-read", !!carbonImpact());
    },
  },
  automaxi: { read() {}, failed() {} },
};

new IntersectionObserver((entries) => {
  onScreen = entries.some(({ isIntersecting }) => isIntersecting);
  if (onScreen) compare();
}).observe(table);
document.querySelector("#last-epoch .compare-again")!.addEventListener("click", compare);
