import { AUTOMATIONS, MATCHA_LATTE, byKind, type Automation } from "../config.ts";
import { earnedByAccount, figuresOf, lastEarnings, ownPerThousand, perThousandOf } from "../earnings.ts";
import {
  WEEK,
  bps,
  count,
  date,
  day,
  list as words,
  money,
  short,
  units,
  until,
  utc,
  voteWords,
  weekStart,
} from "../format.ts";
import {
  LockType,
  canJoin,
  canLeave,
  canLeaveOther,
  gasCost,
  groupOf,
  hasStopped,
  join,
  leave,
  leaveOther,
  statusOf,
  type Account,
  type Status,
  type Step,
} from "../hydrex.ts";
import { overdue, underWay } from "../payouts.ts";
import { gasWords } from "../prices.ts";
import { now } from "../rpc.ts";
import { $, $$, fill, list, setState, status, time, type Value } from "./dom.ts";
import { openReview, type Slip } from "./review.ts";
import { hrefOf, route } from "./router.ts";
import {
  appPayouts,
  checks,
  doubleEspresso,
  failed,
  holdings,
  joinable,
  matchaLatte,
  paidShare,
  reloadAccounts,
  session,
} from "./session.ts";
import { openClaim } from "./claim.ts";

const hydrex = $(".view[data-view=hydrex]");
const automationView = $(".view[data-view=automation]");
const shown = (): Automation => byKind(document.documentElement.dataset.kind ?? "") ?? MATCHA_LATTE;

// "Account" alone is an address in crypto: "Hydrex account #9540", or the owner's name for it.
export const accountName = (name: string): string =>
  !name ? "Hydrex account" : /^hydrex\b/i.test(name) ? name : `Hydrex ${name}`;
export const inYear = (time: number) =>
  new Date(time * 1000).getUTCFullYear() === new Date(now() * 1000).getUTCFullYear() ? day : date;
export function lockWords({ lockType, end }: Account): string {
  if (lockType === LockType.permanent) return "Protocol, permanent";
  if (lockType === LockType.rolling) return "Flex, rolling";
  return end ? `Flex, ${end > now() ? "ends" : "ended"} ${date(end)}` : "Flex";
}

// An account's status: a shape, then words to its owner, or about them.
export function statusWords(found: Status, own: boolean): [string, string, string] {
  const back = (when: number) => `${own ? "your votes from" : "votes back from"} ${day(when)}`;
  switch (found.kind) {
    case "in":
      return ["running", `In ${found.automation.name}`, ""];
    case "joined":
      return ["joining", `Joining ${found.automation.name}:`, `votes from ${day(found.date)}`];
    case "left":
      return ["leaving", `Leaving ${found.automation.name}:`, back(found.date)];
    case "partly":
      return ["stopped", `Partly in ${found.automation.name}`, ""];
    case "stopped":
      return ["stopped", `In ${found.name}`, `· stopped since ${inYear(found.voted)(found.voted)}`];
    case "other":
      return ["elsewhere", `In ${found.name}`, ""];
    case "left-other":
      return ["leaving", `Left ${found.name}:`, back(found.date)];
    case "delegated":
      return ["elsewhere", `Delegated to ${short(found.to)}`, ""];
    case "self":
      return ["idle", own ? "You vote with it" : "Its owner votes with it", ""];
    case "unvoted":
      return ["stopped", found.voted ? `Not voted since ${inYear(found.voted)(found.voted)}` : "Not voted yet", ""];
    case "ended":
      return ["idle", "Lock ended", ""];
    case "empty":
      return ["idle", "Empty", ""];
  }
}

// What Matcha Latte takes: "33.33% retired, 1% fee", the fee said to be unread while it is.
const feeWords = (feeBps: bigint | undefined) =>
  feeBps === 0n ? "" : feeBps === undefined ? ", fee not read yet" : `, ${bps(feeBps)} fee`;
const record = (automation: Automation): Value => {
  const per = perThousandOf(automation);
  if (per !== undefined) return per === null ? "No record yet" : money(per);
  return figuresOf(automation).failed ? "Not read yet" : undefined;
};
function stateOf(automation: Automation): [string, string, string] {
  if (checks.value?.get(automation.kind)?.length) return ["failed", "Joining off", ""];
  const found = automation === MATCHA_LATTE ? matchaLatte : doubleEspresso;
  const { value } = found;
  if (!value) return found.failed ? ["idle", "Not read yet", ""] : ["checking", "Checking…", ""];
  if (value.voted === undefined) return ["idle", "Not read yet", ""];
  const stopped = hasStopped(value.voted, value.epochStart);
  return [
    stopped ? "stopped" : "running",
    stopped ? "Stopped" : "Running",
    value.voted ? `${stopped ? "since" : "· voted"} ${day(value.voted)}` : "",
  ];
}

function renderAutomation(automation: Automation, place: HTMLElement): void {
  const [shape, title, rest] = stateOf(automation);
  status($(".state", place), shape, title, rest);
  const found = holdings();
  const yours = (found?.accounts ?? []).filter((account) => {
    const each = statusOf(account, found!.owner, now(), found!.epochStart);
    return (each.kind === "in" || each.kind === "joined") && each.automation === automation;
  }).length;
  fill(place, {
    record: record(automation),
    yours: yours ? `Yours: ${count(yours, "Hydrex account", "Hydrex accounts")}` : "",
  });
  if (automation !== MATCHA_LATTE) return;
  const settings = matchaLatte.value;
  const unread = matchaLatte.failed ? "Not read yet" : undefined;
  fill(place, {
    takes: settings ? `${bps(settings.retireBps)} retired${feeWords(settings.feeBps)}` : unread,
    retired: settings ? bps(settings.retireBps) : unread,
    "takes-fee": settings ? `retired${feeWords(settings.feeBps)}` : "",
    tonnes: settings ? `${units(settings.tonnes)} t` : unread,
    "retire-cost": settings ? `Up to ${bps(settings.retireBps)} of each payout` : unread,
    "fee-cost": settings?.feeBps === undefined ? (settings ? "Not read yet" : unread) : bps(settings.feeBps),
    "max-fee": settings?.maxFeeBps === undefined ? "" : ` (up to ${bps(settings.maxFeeBps)})`,
    "fee-recipient": settings?.feeRecipient
      ? { text: short(settings.feeRecipient), href: `https://basescan.org/address/${settings.feeRecipient}` }
      : (unread ?? "Not read yet"),
  });
}

// Groups of the wallet's accounts. A group's buttons act on its ticked accounts; with one account to act on, it needs no
// box. What needs its owner starts ticked.
type Action = "join" | "leave" | "claim";
const actionOf = (button: HTMLElement): [Action, Automation | undefined] => {
  const [action, kind] = button.dataset.action!.split(":") as [Action, string?];
  return [action, kind ? byKind(kind) : action === "join" ? shown() : undefined];
};
const entryOf = (account: Account) => appPayouts.found?.entries.find((entry) => entry.account.id === account.id);
export function can(button: HTMLElement, account: Account): boolean {
  const [action, automation] = actionOf(button);
  if (action === "join") return !!automation && joinable(automation) && canJoin(account, automation, now());
  if (action === "claim") return overdue(appPayouts.found, entryOf(account));
  return AUTOMATIONS.some((each) => canLeave(account, each)) || canLeaveOther(account);
}
const seen = new WeakMap<HTMLElement, Set<string>>();
const ableIn = new WeakMap<HTMLElement, Account[]>();

function renderGroup(section: HTMLElement, members: Account[], ticked: boolean): void {
  const owner = holdings()!;
  const buttons = $$("button[data-action]", section);
  const able = members.filter((account) => buttons.some((button) => can(button, account)));
  const boxes = able.length > 1;
  const before = seen.get(section) ?? new Set();
  list(
    $(".list", section),
    "account-row",
    members,
    ({ id }) => `${id}`,
    (row, account) => {
      const found = statusOf(account, owner.owner, now(), owner.epochStart);
      const name = accountName(account.name);
      const earned = earnedByAccount(account);
      fill(row, {
        name,
        id: `#${account.id}`,
        votes: voteWords(account.votes),
        earned: earned === null ? "" : earned === undefined ? undefined : `· ${money(earned)} last epoch`,
        late: entryOf(account)?.standing?.late ? "Payout late" : "",
      });
      $("a", row).setAttribute("href", hrefOf({ view: "account", id: account.id }));
      const [shape, title, rest] = statusWords(found, true);
      const inOwn = found.kind === "in" && section.dataset.group === `in:${found.automation.kind}`;
      status($("[data-v=status]", row), inOwn ? undefined : shape, inOwn ? "" : title, inOwn ? "" : rest);
      const box = $<HTMLInputElement>(".pick", row);
      box.hidden = !boxes || !able.includes(account);
      box.value = `${account.id}`;
      box.setAttribute("aria-label", `Pick ${name} #${account.id}`);
      if (!before.has(box.value) && !box.hidden) box.checked = ticked;
    },
  );
  seen.set(section, new Set(able.map(({ id }) => `${id}`)));
  ableIn.set(section, able);
  const picked = pickedIn(section, able);
  for (const button of buttons) {
    button.hidden = !able.some((account) => can(button, account));
    button.setAttribute("aria-disabled", String(!picked.some((account) => can(button, account))));
  }
  const all = section.querySelector<HTMLInputElement>(".all input");
  if (all) {
    all.parentElement!.hidden = !boxes;
    all.checked = picked.length === able.length;
    all.indeterminate = picked.length > 0 && picked.length < able.length;
  }
  const votes = picked.reduce((total, account) => total + account.votes, 0n);
  fill(section, {
    count: `· ${members.length}`,
    picked: boxes && picked.length ? `${picked.length} of ${able.length} · ${voteWords(votes)}` : "",
  });
  section.hidden = !members.length;
}

function pickedIn(section: HTMLElement, able: Account[]): Account[] {
  if (able.length <= 1) return able;
  const ids = new Set(
    $$<HTMLInputElement>(".pick:checked", section)
      .filter((box) => !box.hidden)
      .map(({ value }) => value),
  );
  return able.filter(({ id }) => ids.has(`${id}`));
}

export function renderHydrex(): void {
  const found = holdings();
  const accounts = found?.accounts ?? [];
  const failing = new Set([...(checks.value?.values() ?? [])].flat());
  for (const notice of $$("[data-check]", hydrex)) notice.hidden = !failing.has(notice.dataset.check!);
  $("#checks").hidden = !failing.size;
  for (const automation of AUTOMATIONS)
    renderAutomation(automation, $(`.card[data-kind="${automation.kind}"]`, hydrex));
  const settings = matchaLatte.value;
  const flip = (settings?.epochStart ?? weekStart(now())) + WEEK;
  fill(hydrex, { flip: time(flip, utc), countdown: `in ${until(flip - now())}` });
  const own = found ? ownPerThousand(found) : session.accounts?.failed ? null : undefined;
  fill($("#own-votes"), {
    own:
      own === undefined
        ? undefined
        : own === null
          ? "Not read yet"
          : own === "none"
            ? "No votes of your own"
            : own === "unvoted"
              ? "Didn't vote"
              : `${money(own)} per 1,000 votes, last epoch`,
  });
  for (const element of $$(".underway", hydrex)) element.hidden = !appPayouts.found || !underWay(appPayouts.found);
  const reader = session.accounts;
  const state =
    !reader || (!reader.value && reader.reading)
      ? "loading"
      : !reader.value
        ? "failed"
        : accounts.some(({ amount }) => amount > 0n)
          ? "ready"
          : "empty";
  for (const place of $$(".accounts")) setState(place, state);
  if (!found) return;
  const members = accounts.map((account) => ({
    account,
    group: groupOf(account, statusOf(account, found.owner, now(), found.epochStart)),
  }));
  for (const section of $$<HTMLElement>(".group", hydrex)) {
    const these = members.filter(({ group }) => group === section.dataset.group).map(({ account }) => account);
    if (section.dataset.group === "closed") {
      const some = these.some(({ votes }) => votes > 0n);
      fill(section, {
        closed: count(
          these.length,
          `Hydrex account ${some ? "with less than one vote" : "without votes"}`,
          `Hydrex accounts ${some ? "with less than one vote" : "without votes"}`,
        ),
      });
      list(
        $(".list", section),
        "account-row",
        these,
        ({ id }) => `${id}`,
        (row, account) => {
          fill(row, {
            name: accountName(account.name),
            id: `#${account.id}`,
            votes: voteWords(account.votes),
            earned: "",
            late: "",
          });
          $("a", row).setAttribute("href", hrefOf({ view: "account", id: account.id }));
          $(".pick", row).hidden = true;
          status(
            $("[data-v=status]", row),
            ...statusWords(statusOf(account, found.owner, now(), found.epochStart), true),
          );
        },
      );
      section.hidden = !these.length;
    } else renderGroup(section, these, section.dataset.group!.startsWith("needs:"));
  }
}

export function renderAutomationView(): void {
  const automation = shown();
  const accounts = holdings()?.accounts ?? [];
  renderAutomation(automation, automationView);
  $("#joining-off").hidden = !checks.value?.get(automation.kind)?.length;
  if (!holdings()) return;
  const mine = accounts.filter((account) => canLeave(account, automation));
  const able = accounts.filter((account) => joinable(automation) && canJoin(account, automation, now()));
  renderGroup($("[data-group=mine]", automationView), mine, false);
  renderGroup($("[data-group=can]", automationView), able, false);
  $("[data-action=join]", automationView).textContent = `Join ${automation.name}`;
  if (joinable(automation) && !mine.length && !able.length) setState($(".accounts", automationView), "empty");
}

// setConduitApproval, as the review shows it.
const slipOf = (step: Step): Slip => {
  const contract = AUTOMATIONS.find(({ address }) => address === step.conduit)?.contract;
  const name = step.other ? `the ${step.name} automation` : step.name;
  const says = step.approve
    ? `${step.leaving.length ? `leaves ${words(step.leaving)} and ` : ""}joins ${name}.`
    : `leaves ${name}.`;
  return {
    ...step,
    title: step.approve ? `Join ${name}` : `Leave ${name}`,
    says: `Account #${step.id} ${says}`,
    on: "Hydrex's VotingEscrow",
    call: "setConduitApproval",
    fields: [
      {
        label: "Conduit",
        code: step.conduit,
        description: step.other ? `The ${step.name} automation` : (contract ?? step.name),
      },
      { label: "Account", code: `${step.id}` },
      { label: "Approve", code: `${step.approve}` },
    ],
  };
};

// The review of joining, with what a week at last epoch's rate would pay and the gas; or of leaving.
export function review(accounts: Account[], action: Action, automation: Automation | undefined): void {
  const found = holdings();
  const { connection } = session;
  if (!connection || !found) return;
  const flip = found.epochStart + WEEK;
  const next = time(flip, utc);
  const pages = $("#pages");
  if (action === "join" && automation) {
    const thousands = Number(accounts.reduce((total, { votes }) => total + votes, 0n)) / 1e21;
    const settings = matchaLatte.value;
    const many = accounts.length > 1;
    const fee =
      automation === MATCHA_LATTE
        ? settings?.feeBps === 0n
          ? ""
          : settings?.feeBps === undefined
            ? " and any fee"
            : ` and the ${bps(settings.feeBps)} fee`
        : "";
    fill(pages, {
      callout: `Unclaimed rewards on ${many ? "these Hydrex accounts" : "this Hydrex account"} will be paid to you${automation === MATCHA_LATTE ? " in kVCM" : ""} with ${many ? "their next payouts" : "its next payout"}, less ${automation === MATCHA_LATTE ? `the share retired${fee}` : "the 1% fee"}.`,
      next,
      week: undefined,
      gas: undefined,
      takes:
        automation === MATCHA_LATTE
          ? settings
            ? `${bps(settings.retireBps)} retired${feeWords(settings.feeBps)}`
            : "Not read"
          : "1% fee",
      control: {
        text: automation === MATCHA_LATTE ? "Can change" : "Immutable",
        href: hrefOf({ view: "automation", kind: automation.kind, section: "control" }),
      },
    });
    lastEarnings(automation).then(
      () => {
        const per = perThousandOf(automation);
        const paid = paidShare(automation);
        fill(pages, {
          week:
            per && paid !== undefined
              ? money({ ...per, value: per.value * thousands * paid })
              : per === null
                ? "No record yet"
                : "Not read",
        });
      },
      () => fill(pages, { week: "Not read" }),
    );
    gasCost(join(accounts, automation), found.owner).then(
      ({ wei, prices }) => fill(pages, { gas: gasWords(wei, prices) }),
      (error: unknown) => (console.error(error), fill(pages, { gas: "Not read" })),
    );
    openReview({
      name: `Join ${automation.name}`,
      intro: { kind: "join", title: "Before you join" },
      steps: join(accounts, automation).map(slipOf),
      checkHref: hrefOf({ view: "automation", kind: automation.kind, section: "check" }),
      connection,
      outcome: `Joined. Votes from ${utc(flip)}.`,
    });
    return;
  }
  const from = AUTOMATIONS.filter((each) => accounts.some((account) => canLeave(account, each)));
  const steps = [
    ...accounts.flatMap((account) => from.flatMap((each) => (canLeave(account, each) ? leave([account], each) : []))),
    ...leaveOther(accounts.filter(canLeaveOther)),
  ];
  const names = [...new Set(steps.map((step) => (step.other ? `the ${step.name} automation` : step.name)))];
  const title = `Leave ${words(names)}`;
  fill(pages, { next });
  openReview({
    name: title,
    intro: { kind: "leave", title },
    steps: steps.map(slipOf),
    checkHref: hrefOf({ view: "automation", kind: (from[0] ?? MATCHA_LATTE).kind, section: "check" }),
    connection,
    outcome: `Left. From ${utc(flip)}, ${accounts.length > 1 ? "their votes are" : "its votes are"} yours: vote with them on Hydrex each week.`,
  });
}

// A button acts on its group's ticked accounts, or on `only`, an account's page's own.
export function act(button: HTMLElement, only?: Account[]): void {
  if (button.getAttribute("aria-disabled") === "true") return;
  const found = holdings();
  if (!found) return;
  // In a new epoch the statuses and dates would be wrong: read the accounts again first.
  if (weekStart(now()) > found.epochStart) return void reloadAccounts();
  const [action, automation] = actionOf(button);
  const section = button.closest<HTMLElement>(".group");
  const accounts = (only ?? (section ? pickedIn(section, ableIn.get(section) ?? []) : [])).filter((account) =>
    can(button, account),
  );
  if (!accounts.length) return;
  if (action === "claim")
    return void openClaim(
      accounts.flatMap((account) => entryOf(account) ?? []),
      button,
    ).catch(failed);
  if (action === "join" && automation === MATCHA_LATTE && !matchaLatte.value)
    return void matchaLatte.read().then(() => act(button, only), failed);
  review(accounts, action, automation);
}

export function initHydrex(): void {
  document.addEventListener("change", (event) => {
    const box = event.target as HTMLInputElement;
    const section = box.closest<HTMLElement>(".group");
    if (!section) return;
    if (box.closest(".all"))
      for (const each of $$<HTMLInputElement>(".pick", section)) if (!each.hidden) each.checked = box.checked;
    renderHydrex();
    renderAutomationView();
  });
  for (const button of $$(
    "[data-view=hydrex] .group button[data-action], [data-view=automation] .group button[data-action]",
  ))
    button.addEventListener("click", () => act(button));
  for (const again of $$(".accounts .again")) again.addEventListener("click", () => void reloadAccounts());
}
