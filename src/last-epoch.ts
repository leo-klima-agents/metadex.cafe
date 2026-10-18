import { clone, fill, fillAddress, fillTime, show } from "./dom.ts";
import { readAllEarnings, readEarnings, sharesOf, valueOf, type Earnings } from "./earnings.ts";
import { WEEK, compact, count, fraction, toEarningPower, usd } from "./format.ts";
import type { Holdings } from "./hydrex.ts";

// What Carbon Impact's votes earned last epoch: the figure on Home, each account's part of it in the App, and the
// section "How the votes did last epoch".

type Value = ReturnType<typeof valueOf>;

let earned: { found: Earnings; value: Value } | undefined;
let reading = false;
let tried = 0;
let comparedEpoch: number | undefined;
let onScreen = false;
// Each account's share of Carbon Impact's votes, kept with the accounts it was read for.
const shares = new WeakMap<Holdings, { start: number; of: Map<bigint, number> }>();

const table = document.querySelector<HTMLElement>("#last-epoch .earnings")!;
const comparison = {
  status: document.querySelector<HTMLElement>("#last-epoch .all-status")!,
  failed: document.querySelector<HTMLElement>("#last-epoch .all-failed")!,
  versus: document.querySelector<HTMLElement>("#last-epoch .versus")!,
};
const waiting = comparison.status.textContent ?? "";

export const earningsDue = (epoch: number): boolean =>
  !reading && (!earned || earned.found.start < epoch - WEEK) && Date.now() - tried > 300_000;

// Resolves to true once new figures are shown.
export async function loadEarnings(): Promise<boolean> {
  if (reading) return false;
  reading = true;
  tried = Date.now();
  try {
    const found = await readEarnings(earned?.found.start);
    if (!found) return false;
    showEarnings(found);
    return true;
  } catch (error) {
    // The page works without these figures: it says so where they go, and keeps any from an earlier epoch.
    console.error(error);
    show(".earnings-failed", !earned);
    show(".earnings-read", !!earned);
    return false;
  } finally {
    reading = false;
  }
}

// Resolves to true once the accounts' shares of the epoch shown are read.
export async function loadShares(holdings: Holdings): Promise<boolean> {
  const found = earned?.found;
  if (!found || shares.get(holdings)?.start === found.start) return false;
  const ids = holdings.accounts.filter(({ amount }) => amount > 0n).map(({ id }) => id);
  const of = await sharesOf(ids, found.start, found.votes).catch((error) => void console.error(error));
  if (!of || earned?.found !== found) return false;
  shares.set(holdings, { start: found.start, of });
  return true;
}

// What the account's votes earned in the epoch shown, in dollars, if it was in Carbon Impact then.
export function earnedByAccount(holdings: Holdings, id: bigint): number | undefined {
  const mine = shares.get(holdings);
  const part = mine?.of.get(id);
  if (!earned || mine?.start !== earned.found.start || part === undefined) return undefined;
  return part * earned.value.usd;
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

function showEarnings(found: Earnings): void {
  const value = valueOf(found);
  earned = { found, value };
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
  const mine = earned?.found;
  if (!mine || comparedEpoch === mine.start) return;
  comparedEpoch = mine.start;
  comparison.failed.hidden = true;
  comparison.status.hidden = false;
  comparison.status.textContent = "Reading every pool's rewards…";
  readAllEarnings(mine.start).then(
    (all) => {
      if (earned?.found !== mine) return;
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
      if (earned?.found !== mine) return;
      comparedEpoch = undefined;
      comparison.status.hidden = true;
      comparison.failed.hidden = false;
    },
  );
}

new IntersectionObserver((entries) => {
  onScreen = entries.some(({ isIntersecting }) => isIntersecting);
  if (onScreen) compare();
}).observe(table);
document.querySelector("#last-epoch .compare-again")!.addEventListener("click", compare);
