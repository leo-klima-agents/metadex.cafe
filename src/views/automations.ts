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
import { RETRY, SOON, reader, type Reader } from "../read.ts";
import { session, shown, views } from "./page.ts";
import { route } from "./router.ts";

// The automations' state and figures, wherever they show: on Hydrex's menu, on their own pages, and beside them,
// Hydrex's average and what the wallet's own votes earned.

// Carbon Impact's settings: read again in each new epoch, and five minutes after a read that left some unread. Until one
// succeeds, read again at each tick, its figures say they could not be read.
export const impact: Reader<CarbonImpact> = reader(readCarbonImpact, {
  retry: SOON,
  stale: (found, since) =>
    weekStart(now()) > found.epochStart ||
    ([found.voted, found.feeBps, found.maxFeeBps, found.treasury].includes(undefined) && since >= RETRY),
  settled: () => showCarbonImpact(),
});

// AutoMaxi's state, on the menu and its page: "Checking…" until read, and "Not read yet" while its reads fail, which
// each tick tries again. Read again in each new epoch.
export const autoMaxi: Reader<Freshness> = reader(() => readFreshness(AUTOMAXI), {
  retry: SOON,
  stale: (fresh) => weekStart(now()) > fresh.epochStart,
  settled: () => {
    showAutoMaxi();
    views.app();
  },
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

// Where an automation shows: its row on Hydrex's menu, its page, which holds its popups, and its line on the App. Its
// figures are written there only, so that other views may use the same class names.
const placesOf = ({ kind }: Automation): HTMLElement[] => [
  ...document.querySelectorAll<HTMLElement>(
    `.choice[data-choice="${kind}"], .view[data-kind="${kind}"], [data-record="${kind}"]`,
  ),
];
// Where an automation's place is, for what it shows there.
const whereOf = (place: HTMLElement): "page" | "menu" | "app" =>
  place.matches(".view") ? "page" : place.matches(".choice") ? "menu" : "app";
// The sentence on Hydrex's page that says when a change takes effect; and voting yourself, beside the automations.
const epochLine = document.getElementById("epoch")!;
const voteYourself = document.getElementById("vote-yourself")!;

// A status, on the menu and on an automation's page: its shape and its words. Until read, "Checking…", in a quiet ring.
function showState(automation: Automation, prefix: string, shape: string, state: string): void {
  for (const place of placesOf(automation)) {
    for (const each of place.querySelectorAll(`.${prefix}-shape`)) {
      each.classList.remove("checking", "idle", "running", "stopped");
      each.classList.add(shape);
    }
    fill(place, { [`${prefix}-state`]: state });
  }
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
  showState(CARBON_IMPACT, "impact", shape, state);
  for (const place of placesOf(CARBON_IMPACT)) {
    fill(place, {
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
    fillAddress(place, "beneficiary-address", beneficiaryAddress);
    if (treasury) {
      fillAddress(place, "treasury", treasury);
      fillAddress(place, "treasury-named", treasury, "its treasury");
    } else {
      // Not a link to where an earlier read found it.
      for (const link of place.querySelectorAll("a.treasury, a.treasury-named")) link.removeAttribute("href");
      fill(place, { treasury: "Not read yet" });
    }
    if (voted) fillTime(place, "impact-voted", voted);
    show(".impact-voted-line", !!voted, place);
  }
  // The epoch, by Base's clock: when a join counts from, on each automation's page, and on Hydrex's.
  for (const automation of AUTOMATIONS) {
    for (const place of placesOf(automation)) fillTime(place, "next-epoch", epochStart + WEEK, when);
  }
  fillTime(epochLine, "epoch-end", epochStart + WEEK, utc);
  show(".countdown-line", true, epochLine);
  showRecords();
  showCountdown();
  views.catchUp();
  views.app();
}

// Carbon Impact's settings could not be read, and none were before: its figures say so, rather than stay pending, until
// a read succeeds.
function carbonImpactFailed(): void {
  showState(CARBON_IMPACT, "impact", "idle", "Not read yet");
  for (const place of placesOf(CARBON_IMPACT)) {
    for (const name of ["tonnes", "retired", "takes", "max-takes", "treasury"]) fill(place, { [name]: "Not read yet" });
    fill(place, { "takes-sub": "" });
  }
  // Without the block's time, the epoch's end is only Thursday's.
  show(".countdown-line", false, epochLine);
  showRecords();
  views.app();
}

// How long until the epoch ends, by Base's clock, once Carbon Impact's settings say when it began.
export function showCountdown(): void {
  if (!impact.value) return;
  const time = now();
  const end = impact.value.epochStart + WEEK;
  if (time >= end) return;
  fill(epochLine, { countdown: `in ${until(end - time)}` });
}

// Each automation's figures for last epoch, for each 1,000 votes: what its votes earned, beside Hydrex's average,
// on the menu and on the App, how they compare; on its page, then what reached the owner after its cut. Each line keeps
// its place while read, as most automations have a record: it goes only once the read finds none, or fails.
export function showRecords(): void {
  for (const automation of AUTOMATIONS) {
    const per = perThousandOf(automation);
    const paid = traits[automation.kind].paid();
    const failed = per === undefined && earningsFailed(automation);
    const none = per === null || failed;
    const record = failed
      ? "Not read yet"
      : per === undefined
        ? PENDING
        : per === null
          ? "No record yet"
          : () => money(per);
    // What reached the owner, once what the automation takes is read too; if that read failed, the line goes.
    const waits = automation === CARBON_IMPACT && !impact.value && !impact.failed;
    const toYou: Text | (() => Text) =
      per && paid !== undefined
        ? () => `${money(moneyAt(per.value * paid, per))} to you`
        : !none && (per === undefined || waits)
          ? PENDING
          : "";
    const versus = automationVersus(automation);
    for (const place of placesOf(automation)) {
      // The menu and the App compare what the votes earned, as voting yourself does, and leave what reached the owner
      // to the automation's page. The App, early on the way to them, says when, and leaves out an automation with no
      // record, or none read.
      const where = whereOf(place);
      fill(place, { record });
      show(".record-unit", !none, place);
      if (where === "page") fill(place, { "record-paid": toYou });
      else {
        show(".record-versus-line", versus !== null, place);
        fill(place, { "record-versus": versus === undefined ? PENDING : versus === null ? "" : versusWords(versus) });
      }
      if (where === "app") place.hidden = none;
    }
  }
  // Beside them, Hydrex's average, on each automation's page and beside voting yourself, and, with a wallet, what its
  // own votes earned, and how they compare: pending while its accounts are read, and its comparison's line kept for it
  // whether or not it shows one, as the wallet may not have voted with its own.
  const average = averagePerThousand();
  const averageWords = average === undefined ? PENDING : average === null ? "Not read yet" : () => money(average);
  for (const place of [voteYourself, ...AUTOMATIONS.flatMap(placesOf)]) fill(place, { average: averageWords });
  show(".average-unit", average !== null, voteYourself);
  const { connection, accounts } = session;
  const holdings = connection ? shown() : undefined;
  const yours = holdings ? ownPerThousand(holdings) : accounts?.failed ? null : undefined;
  show(".yours", !!connection, voteYourself);
  fill(voteYourself, {
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
  show(".yours-unit", yours === undefined || (!!yours && typeof yours === "object"), voteYourself);
  const ratio = holdings ? ownVersus(holdings) : yours === null ? null : undefined;
  fill(voteYourself, { "yours-versus": ratio === undefined ? PENDING : ratio === null ? "" : versusWords(ratio) });
}

// How some votes compare with Hydrex's average, in words and ink, not colour: "44.7% below the average".
const versusWords = (ratio: number): string =>
  Math.abs(ratio - 1) < 0.005
    ? "About the average"
    : `${fraction(Math.abs(ratio - 1))} ${ratio > 1 ? "above" : "below"} the average`;

// All of Hydrex is thousands of reads, which only the pages that show its average start: Hydrex's and the automations'
// pages at once; the App, which compares on its Hydrex card, and Home, on the way to it, only once the App's own reads
// have ended, so that those come first: see showApp, which reads it `anyway` then.
export function readAverage(anyway = false): void {
  if (anyway || ["hydrex", "product"].includes(route().view))
    void loadAverage().then((changed) => changed && showRecords());
}

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
  showState(AUTOMAXI, "automaxi", shape, state);
  for (const place of placesOf(AUTOMAXI)) {
    fill(place, { "automaxi-voted-words": stopped ? " since " : " · voted " });
    if (fresh?.voted) fillTime(place, "automaxi-voted", fresh.voted);
    show(".automaxi-voted-line", !!fresh?.voted, place);
  }
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
