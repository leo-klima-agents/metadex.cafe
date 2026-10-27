import { now, sawBlock } from "../chain.ts";
import { AUTOMATIONS, AUTOMAXI, AUTOMAXI_FEE_BPS, CARBON_IMPACT, type Automation, type Kind } from "../config.ts";
import { PENDING, clone, fill, fillAddress, fillTime, show, type Text } from "../dom.ts";
import { WEEK, bps, fraction, money, moneyAt, units, until, utc, weekStart, when } from "../format.ts";
import {
  failedChecks,
  hasStopped,
  paidBpsOf,
  readCarbonImpact,
  readFreshness,
  type CarbonImpact,
  type Checks,
  type Freshness,
} from "../hydrex.ts";
import {
  automationVersus,
  averagePerThousand,
  earningsFailed,
  loadAverage,
  loadEarnings,
  ownPerThousand,
  ownVersus,
  perThousandOf,
} from "../last-epoch.ts";
import { RETRY, reader, type Reader } from "../read.ts";
import { session, shown, views } from "./page.ts";
import { route } from "./router.ts";

// The automations' state and figures, wherever they show: on Hydrex's menu, on their own pages, and beside them,
// Hydrex's average and what the wallet's own votes earned.

// Carbon Impact's settings: read again in each new epoch, and five minutes after a read that left some unread. Until one
// succeeds, at each tick, its figures say they could not be read.
export const impact: Reader<CarbonImpact> = reader(readCarbonImpact, {
  retry: 0,
  stale: (found, since) =>
    weekStart(now()) > found.epochStart ||
    ([found.voted, found.feeBps, found.maxFeeBps, found.treasury].includes(undefined) && since >= RETRY),
  settled: () => showCarbonImpact(),
});

// AutoMaxi's state, on the menu and its page: "Checking…" until read, and "Not read yet" while its reads fail, which
// each tick tries again. Read again in each new epoch.
export const autoMaxi: Reader<Freshness> = reader(() => readFreshness(AUTOMAXI), {
  retry: 0,
  stale: (fresh) => weekStart(now()) > fresh.epochStart,
  settled: () => showAutoMaxi(),
});

// The checks of each automation, before anyone can join it: until they have run, joining is off. They run again each
// hour.
export const checks: Reader<Checks> = reader(failedChecks, {
  stale: (_, since) => since >= 3_600_000,
  settled: () => showChecks(),
});

// What differs between the page's automations, kind by kind.
type Traits = {
  // The start of its review's template ids. Carbon Impact's were the page's first, and have none.
  templates: string;
  // Whether joining it shows Carbon Impact's settings, and so waits for them.
  settings: boolean;
  // The share of what its votes earn that reaches the owner, once known: Carbon Impact's needs its fee read.
  paid(): number | undefined;
};
export const traits: Record<Kind, Traits> = {
  "carbon-impact": {
    templates: "",
    settings: true,
    paid: () => {
      const paid = impact.value && paidBpsOf(impact.value);
      return paid === undefined ? undefined : Number(paid) / 10_000;
    },
  },
  automaxi: { templates: "automaxi-", settings: false, paid: () => Number(10_000n - AUTOMAXI_FEE_BPS) / 10_000 },
};

// Where an automation shows: its row on the menu, and its page.
const placesOf = ({ kind }: Automation): HTMLElement[] => [
  ...document.querySelectorAll<HTMLElement>(`.choice[data-choice="${kind}"], .view[data-kind="${kind}"]`),
];

// A status, on the menu and on an automation's page: its shape and its words. Until read, "Checking…", in a quiet ring.
function showState(shapes: string, words: string, shape: string, state: string): void {
  for (const each of document.querySelectorAll(`.${shapes}`)) {
    each.classList.remove("checking", "idle", "running", "stopped");
    each.classList.add(shape);
  }
  fill(document, { [words]: state });
}

// What Carbon Impact takes: "33.33% retired, 1% fee", the fee said to be unread when its read failed. The page says
// "Not read yet" of what it reads again by itself, and "Not read" of what it does not.
export const feeWords = (feeBps: bigint | undefined): string =>
  feeBps === undefined ? "fee not read yet" : `${bps(feeBps)} fee`;

function showCarbonImpact(): void {
  const found = impact.value;
  if (!found) return carbonImpactFailed();
  sawBlock(found.time);
  const { epochStart, tonnes, retireBps, entity, beneficiary, beneficiaryAddress, message, voted } = found;
  const { feeBps, maxFeeBps, treasury } = found;
  // Whether it runs depends on when it last voted: unread, the status says so rather than guess.
  const stopped = voted !== undefined && hasStopped(voted, epochStart);
  const [shape, state]: [string, string] =
    voted === undefined ? ["idle", "Not read yet"] : stopped ? ["stopped", "Stopped"] : ["running", "Running"];
  showState("impact-shape", "impact-state", shape, state);
  fill(document, {
    "impact-voted-words": stopped ? " since " : " · voted ",
    tonnes: `${units(tonnes)} t`,
    retired: bps(retireBps),
    takes: `${bps(retireBps)} retired, ${feeWords(feeBps)}`,
    "takes-sub": `retired, ${feeWords(feeBps)}`,
    "max-takes": `100% retired, ${feeWords(maxFeeBps)}`,
    entity,
    beneficiary: beneficiary || "No name",
    message,
  });
  fillAddress(document, "beneficiary-address", beneficiaryAddress);
  if (treasury) {
    fillAddress(document, "treasury", treasury);
    fillAddress(document, "treasury-named", treasury, "its treasury");
  } else {
    // Not a link to where an earlier read found it.
    for (const link of document.querySelectorAll("a.treasury, a.treasury-named")) link.removeAttribute("href");
    fill(document, { treasury: "Not read yet" });
  }
  fillTime(document, "next-epoch", epochStart + WEEK, when);
  fillTime(document, "epoch-end", epochStart + WEEK, utc);
  if (voted) fillTime(document, "impact-voted", voted);
  show(".impact-voted-line", !!voted);
  show(".countdown-line");
  showRecords();
  showCountdown();
  views.catchUp();
  views.app();
}

// Carbon Impact's settings could not be read, and none were before: its figures say so, rather than stay pending, until
// a read succeeds.
function carbonImpactFailed(): void {
  showState("impact-shape", "impact-state", "idle", "Not read yet");
  for (const name of ["tonnes", "retired", "takes", "max-takes", "treasury"])
    fill(document, { [name]: "Not read yet" });
  fill(document, { "takes-sub": "" });
  // Without the block's time, the epoch's end is only Thursday's.
  show(".countdown-line", false);
  showRecords();
}

// How long until the epoch ends, by Base's clock, once Carbon Impact's settings say when it began.
export function showCountdown(): void {
  if (!impact.value) return;
  const time = now();
  const end = impact.value.epochStart + WEEK;
  if (time >= end) return;
  fill(document, { countdown: `in ${until(end - time)}` });
}

// Each automation's figures for last epoch, on the menu and on its page, for each 1,000 Earning Power: what its votes
// earned, beside Hydrex's average, then what reached the owner after its cut.
export function showRecords(): void {
  for (const automation of AUTOMATIONS) {
    const per = perThousandOf(automation);
    const paid = traits[automation.kind].paid();
    const record =
      per === undefined
        ? earningsFailed(automation)
          ? "Not read yet"
          : PENDING
        : per === null
          ? "No record yet"
          : () => money(per);
    // What reached the owner, once what the automation takes is read too; without it, the line hides.
    const waits = automation === CARBON_IMPACT && !impact.value && !impact.failed;
    const toYou: Text | (() => Text) =
      per && paid !== undefined ? () => `${money(moneyAt(per.value * paid, per))} to you` : per && waits ? PENDING : "";
    // On the menu, how it compares with the average, as voting yourself does; what it takes is on the same row.
    const versus = automationVersus(automation);
    for (const row of document.querySelectorAll<HTMLElement>(`.choice[data-choice="${automation.kind}"]`)) {
      show(".record-versus", versus !== undefined, row);
      if (versus !== undefined) fill(row, { "record-versus": versusWords(versus) });
    }
    for (const place of placesOf(automation)) {
      // The menu compares what the votes earned, and leaves what reached the owner to the automation's page.
      const menu = place.classList.contains("choice");
      const unit = menu ? "/ 1k Earning Power" : "earned, per 1,000 Earning Power";
      fill(place, { record, "record-unit": per ? unit : "", ...(!menu && { "record-paid": toYou }) });
    }
  }
  // Beside them, what voting yourself earned: Hydrex's average, and, with a wallet, its own votes, and how they compare.
  const average = averagePerThousand();
  fill(document, {
    average: average === undefined ? PENDING : average === null ? "Not read yet" : () => money(average),
  });
  show(".average-unit", average !== null);
  const holdings = session.connection ? shown() : undefined;
  const yours = holdings && ownPerThousand(holdings);
  show("#vote-yourself .yours", !!holdings);
  fill(document, {
    "yours-average":
      yours === undefined
        ? PENDING
        : yours === null
          ? "Not read yet"
          : yours === "none"
            ? "No votes of your own"
            : yours === "unvoted"
              ? "Didn't vote"
              : () => money(yours),
  });
  const known = !!yours && typeof yours === "object";
  show(".yours-unit", yours === undefined || known);
  const ratio = holdings && known ? ownVersus(holdings) : undefined;
  show(".yours-versus", ratio !== undefined);
  if (ratio !== undefined) fill(document, { "yours-versus": versusWords(ratio) });
}

// How some votes compare with Hydrex's average, in words and ink, not colour: "44.7% below the average".
const versusWords = (ratio: number): string =>
  Math.abs(ratio - 1) < 0.005
    ? "About the average"
    : `${fraction(Math.abs(ratio - 1))} ${ratio > 1 ? "above" : "below"} the average`;

// All of Hydrex is thousands of reads: only the pages that show its average read it.
const showsAverage = (): boolean => ["hydrex", "product"].includes(route().view);
export const readAverage = (): void => {
  if (showsAverage()) void loadAverage().then((changed) => changed && showRecords());
};

// AutoMaxi's state, on the menu and its page.
export function showAutoMaxi(): void {
  const fresh = autoMaxi.value;
  const stopped = !!fresh && hasStopped(fresh.voted, fresh.epochStart);
  const [shape, state]: [string, string] = !fresh
    ? autoMaxi.failed
      ? ["idle", "Not read yet"]
      : ["checking", "Checking…"]
    : !fresh.voted
      ? ["idle", "Not voted yet"]
      : stopped
        ? ["stopped", "Stopped"]
        : ["running", "Running"];
  showState("automaxi-shape", "automaxi-state", shape, state);
  fill(document, { "automaxi-voted-words": stopped ? " since " : " · voted " });
  if (fresh?.voted) fillTime(document, "automaxi-voted", fresh.voted);
  show(".automaxi-voted-line", !!fresh?.voted);
}

// Each read of figures, whoever started it, shows on the menu, on the automations' pages and in the accounts' shares.
export const loadAllEarnings = (): void => void loadEarnings(AUTOMATIONS).catch(console.error);

// Each automation whose checks failed: joining it is off, its rows and pages say so, and its page marks the checks.
export function showChecks(): void {
  const found = checks.value;
  if (!found) return;
  for (const automation of AUTOMATIONS) {
    const failing = found.failed.get(automation.kind)!;
    const off = failing.length > 0;
    show(`.checks-failed[data-kind="${automation.kind}"]`, off);
    for (const place of placesOf(automation)) {
      show(".state-normal", !off, place);
      show(".state-failed", off, place);
      for (const item of place.querySelectorAll<HTMLElement>("[data-check]")) markCheck(item, failing);
    }
  }
  showAutoMaxi();
  showRecords();
  // A read of the accounts that is under way shows the result when it ends.
  if (!session.accounts?.reading) views.accounts(true);
  views.position();
}

// A check that failed says so, with the square and words, before what it checks.
function markCheck(item: HTMLElement, failing: string[]): void {
  item.querySelector(".check-failed")?.remove();
  if (failing.includes(item.dataset.check!)) item.prepend(clone("check-failed"));
}
