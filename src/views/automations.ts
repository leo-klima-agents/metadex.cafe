import { now, sawBlock } from "../chain.ts";
import {
  AUTOMATIONS,
  DOUBLE_ESPRESSO,
  DOUBLE_ESPRESSO_FEE_BPS,
  MATCHA_LATTE,
  type Automation,
  type Kind,
} from "../config.ts";
import { PENDING, fill, fillAddress, fillTime, show } from "../dom.ts";
import { WEEK, bps, fraction, money, short, units, until, utc, weekStart, when } from "../format.ts";
import {
  failedChecks,
  hasStopped,
  paidBpsOf,
  readMatchaLatte,
  readFreshness,
  type MatchaLatte,
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

// Matcha Latte's settings: read again in each new epoch, and five minutes after a read that left some unread. Until one
// succeeds, read again at each tick, its figures say they could not be read.
export const matchaLatte: Reader<MatchaLatte> = reader(readMatchaLatte, {
  retry: SOON,
  stale: (found, since) =>
    weekStart(now()) > found.epochStart ||
    ([found.voted, found.feeBps, found.maxFeeBps, found.feeRecipient].includes(undefined) && since >= RETRY),
  settled: () => {
    showMatchaLatte();
    recovered();
  },
});

// Double Espresso's state, on the menu and its page: "Checking…" until read, and "Not read yet" while its reads fail,
// which each tick tries again. Read again in each new epoch.
export const doubleEspresso: Reader<Freshness> = reader(() => readFreshness(DOUBLE_ESPRESSO), {
  retry: SOON,
  stale: (fresh) => weekStart(now()) > fresh.epochStart,
  settled: () => {
    showDoubleEspresso();
    views.app();
  },
});

// The checks of each automation, before anyone can join it: until they have run, joining is off. They run again each
// hour.
export const checks: Reader<Checks> = reader(failedChecks, {
  stale: (_, since) => since >= 3_600_000,
  settled: () => {
    showChecks();
    recovered();
  },
});

// The page's first reads, which say that reading Base failed when they fail: once neither's last read failed, it no
// longer says so, as each reads again by itself.
function recovered(): void {
  if (!matchaLatte.failed && !checks.failed) show("#error", false);
}

// What differs between the page's automations, kind by kind.
type Traits = {
  // The start of its review's template ids. Matcha Latte's were the page's first, and have none.
  templates: string;
  // Whether joining it shows Matcha Latte's settings, and so waits for them.
  settings: boolean;
  // The share of what its votes earn that reaches the owner, once known: Matcha Latte's needs its fee read.
  paid(): number | undefined;
};
export const traits: Record<Kind, Traits> = {
  "matcha-latte": {
    templates: "",
    settings: true,
    paid: () => {
      const paid = matchaLatte.value && paidBpsOf(matchaLatte.value);
      return paid === undefined ? undefined : Number(paid) / 10_000;
    },
  },
  "double-espresso": {
    templates: "double-espresso-",
    settings: false,
    paid: () => Number(10_000n - DOUBLE_ESPRESSO_FEE_BPS) / 10_000,
  },
};

// Where an automation shows: its row on Hydrex's menu, and its page, which holds its popups. Its figures are written
// there only, so that other views may use the same class names.
const placesOf = ({ kind }: Automation): HTMLElement[] => [
  ...document.querySelectorAll<HTMLElement>(`.choice[data-choice="${kind}"], .view[data-kind="${kind}"]`),
];
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

// What Matcha Latte takes: "33.33% retired, 1% fee", without its fee when it is none, and with it said to be unread
// when its read failed. The page says "Not read yet" of what it reads again by itself, and "Not read" of what it does
// not.
const feeWords = (feeBps: bigint | undefined): string =>
  feeBps === 0n ? "" : feeBps === undefined ? ", fee not read yet" : `, ${bps(feeBps)} fee`;
export const takesWords = (retireBps: bigint, feeBps: bigint | undefined): string =>
  `${bps(retireBps)} retired${feeWords(feeBps)}`;

function showMatchaLatte(): void {
  const found = matchaLatte.value;
  if (!found) return matchaLatteFailed();
  sawBlock(found.time);
  const { epochStart, tonnes, retireBps, voted, feeBps, maxFeeBps, feeRecipient } = found;
  // Whether it runs depends on when it last voted: unread, the status says so rather than guess.
  const stopped = voted !== undefined && hasStopped(voted, epochStart);
  const [shape, state]: [string, string] =
    voted === undefined ? ["idle", "Not read yet"] : stopped ? ["stopped", "Stopped"] : ["running", "Running"];
  showState(MATCHA_LATTE, "matcha-latte", shape, state);
  for (const place of placesOf(MATCHA_LATTE)) {
    fill(place, {
      "matcha-latte-voted-words": stopped ? " since " : " · voted ",
      tonnes: `${units(tonnes)} t`,
      retired: bps(retireBps),
      takes: takesWords(retireBps, feeBps),
      "takes-sub": `retired${feeWords(feeBps)}`,
      // Its costs and who can change them, in its popup: the most the fee can become, once read.
      "retire-cost": `Up to ${bps(retireBps)} of each payout`,
      "fee-cost": feeBps === undefined ? "Not read yet" : bps(feeBps),
      "max-fee": maxFeeBps === undefined ? "" : ` (up to ${bps(maxFeeBps)})`,
    });
    // Its fee recipient, short, as the swap's contracts are, in full on hover.
    for (const link of place.querySelectorAll<HTMLAnchorElement>("a.fee-recipient")) {
      if (feeRecipient) link.title = feeRecipient;
      else {
        // Not a link to where an earlier read found it.
        link.removeAttribute("href");
        link.removeAttribute("title");
      }
    }
    if (feeRecipient) fillAddress(place, "fee-recipient", feeRecipient, short(feeRecipient));
    else fill(place, { "fee-recipient": "Not read yet" });
    if (voted) fillTime(place, "matcha-latte-voted", voted);
    show(".matcha-latte-voted-line", !!voted, place);
  }
  fillTime(epochLine, "epoch-end", epochStart + WEEK, utc);
  show(".countdown-line", true, epochLine);
  showRecords();
  showCountdown();
  views.catchUp();
  views.app();
}

// Matcha Latte's settings could not be read, and none were before: its figures say so, rather than stay pending, until
// a read succeeds.
function matchaLatteFailed(): void {
  showState(MATCHA_LATTE, "matcha-latte", "idle", "Not read yet");
  for (const place of placesOf(MATCHA_LATTE)) {
    for (const name of ["tonnes", "retired", "takes", "retire-cost", "fee-cost", "fee-recipient"])
      fill(place, { [name]: "Not read yet" });
    fill(place, { "takes-sub": "", "max-fee": "" });
  }
  // Without the block's time, the epoch's end is only Thursday's.
  show(".countdown-line", false, epochLine);
  showRecords();
  views.app();
}

// How long until the epoch ends, by Base's clock, once Matcha Latte's settings say when it began.
export function showCountdown(): void {
  if (!matchaLatte.value) return;
  const time = now();
  const end = matchaLatte.value.epochStart + WEEK;
  if (time >= end) return;
  fill(epochLine, { countdown: `in ${until(end - time)}` });
}

// Each automation's figures for last epoch, for each 1,000 votes, on the menu and on its page: what its votes earned,
// and how that compares with Hydrex's average. Each line keeps its place while read, as most automations have a record:
// it goes only once the read finds none, or fails.
export function showRecords(): void {
  for (const automation of AUTOMATIONS) {
    const per = perThousandOf(automation);
    const failed = per === undefined && earningsFailed(automation);
    const none = per === null || failed;
    const record = failed
      ? "Not read yet"
      : per === undefined
        ? PENDING
        : per === null
          ? "No record yet"
          : () => money(per);
    const versus = automationVersus(automation);
    for (const place of placesOf(automation)) {
      fill(place, { record });
      show(".record-unit", !none, place);
      show(".record-versus-line", versus !== null, place);
      fill(place, { "record-versus": versus === undefined ? PENDING : versus === null ? "" : versusWords(versus) });
    }
  }
  // Beside voting yourself, Hydrex's average, and, with a wallet, what its own votes earned, and how they compare:
  // pending while its accounts are read, and its comparison's line kept for it whether or not it shows one, as the
  // wallet may not have voted with its own.
  const average = averagePerThousand();
  const averageWords = average === undefined ? PENDING : average === null ? "Not read yet" : () => money(average);
  fill(voteYourself, { average: averageWords });
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

// All of Hydrex is thousands of reads: Hydrex's and the automations' pages, which show its average, start them at once.
// Home and the App, on the way to them, start them too, only once the App's own reads have ended, so that those come
// first, and Hydrex's page opens with them read: see showApp, which reads it `anyway` then.
export function readAverage(anyway = false): void {
  if (anyway || ["hydrex", "product"].includes(route().view))
    void loadAverage().then((changed) => changed && showRecords());
}

// Double Espresso's state, on the menu and its page.
export function showDoubleEspresso(): void {
  const fresh = doubleEspresso.value;
  const stopped = !!fresh && hasStopped(fresh.voted, fresh.epochStart);
  const [shape, state]: [string, string] = !fresh
    ? doubleEspresso.failed
      ? ["idle", "Not read yet"]
      : ["checking", "Checking…"]
    : stopped
      ? ["stopped", "Stopped"]
      : ["running", "Running"];
  showState(DOUBLE_ESPRESSO, "double-espresso", shape, state);
  for (const place of placesOf(DOUBLE_ESPRESSO)) {
    fill(place, { "double-espresso-voted-words": stopped ? " since " : " · voted " });
    if (fresh?.voted) fillTime(place, "double-espresso-voted", fresh.voted);
    show(".double-espresso-voted-line", !!fresh?.voted, place);
  }
}

// Each read of figures, whoever started it, shows on the menu, on the automations' pages and in the accounts' shares.
export const loadAllEarnings = (): void => void loadEarnings(AUTOMATIONS).catch(console.error);

// Each automation whose checks failed: joining it is off, and its rows and pages say so. Hydrex's page says why, for a
// check it names.
export function showChecks(): void {
  const found = checks.value;
  if (!found) return;
  for (const automation of AUTOMATIONS) {
    const off = found.failed.get(automation.kind)!.length > 0;
    show(`.checks-failed[data-kind="${automation.kind}"]`, off);
    for (const place of placesOf(automation)) {
      show(".state-normal", !off, place);
      show(".state-failed", off, place);
    }
  }
  const failing = new Set([...found.failed.values()].flat());
  for (const notice of document.querySelectorAll<HTMLElement>(".check-notice"))
    notice.hidden = !failing.has(notice.dataset.check!);
  showDoubleEspresso();
  showRecords();
  // A read of the accounts that is under way shows the result when it ends.
  if (!session.accounts?.reading) views.accounts(true);
  views.position();
}
