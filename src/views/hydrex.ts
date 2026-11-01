import {
  AUTOMATIONS,
  FEE_BPS,
  MATCHA_LATTE,
  MATCHA_LATTE_OPERATOR,
  FEE_RECIPIENT,
  byKind,
  type Automation,
} from "../config.ts";
import { type Got } from "../cache.ts";
import { checks } from "../checks.ts";
import * as data from "../data.ts";
import {
  WEEK,
  bps,
  compact,
  count,
  date,
  day,
  fraction,
  list as listWords,
  money,
  moneyAt,
  short,
  units,
  until,
  utc,
  voteWords,
} from "../format.ts";
import * as hydrex from "../hydrex.ts";
import type { Account, Holdings, MatchaLatte, Status } from "../hydrex.ts";
import { overdue, underWay } from "../payouts.ts";
import { gasWords } from "../prices.ts";
import { perThousand, perThousandOf, valueOf, versus, type Earnings } from "../rewards.ts";
import { hrefOf } from "../routes.ts";
import { now, same } from "../rpc.ts";
import { actions, render, state } from "../state.ts";
import { $, busy, fill, frag, link, list, shown, stateOf, status, type Value } from "../ui.ts";
import { openClaim } from "./claim.ts";
import { openReview } from "./review.ts";

const hydrexView = $('[data-view="hydrex"]');
const productView = $('[data-view="product"]');
const automationOf = (kind = ""): Automation | undefined => byKind(kind);

// Words for figures

export const accountName = ({ name, id }: Account): string =>
  `${!name ? "Hydrex account" : /^hydrex\b/i.test(name) ? name : `Hydrex ${name}`} #${id}`;
export const lockWords = ({ lockType, end }: Account): string =>
  lockType === hydrex.LockType.permanent
    ? "Protocol, permanent"
    : lockType === hydrex.LockType.rolling
      ? "Flex, rolling"
      : end
        ? `Flex, ${end > now() ? "ends" : "ended"} ${date(end)}`
        : "Flex";
const inYear = (time: number): string =>
  new Date(time * 1000).getUTCFullYear() === new Date(now() * 1000).getUTCFullYear() ? day(time) : date(time);
const versusWords = (ratio: number | null | undefined): Value =>
  ratio === undefined || ratio === null
    ? null
    : Math.abs(ratio - 1) < 0.005
      ? "About the average"
      : `${fraction(Math.abs(ratio - 1))} ${ratio > 1 ? "above" : "below"} the average`;
const feeWords = (feeBps: bigint | undefined): string =>
  feeBps === 0n ? "" : feeBps === undefined ? ", fee not read yet" : `, ${bps(feeBps)} fee`;

// An account's status, to its owner or to anyone.
export function statusNode(s: Status, own: boolean, inGroup?: string): Value {
  const automationLink = (automation: Automation) =>
    link(hrefOf({ view: "product", kind: automation.kind }), automation.name);
  const back = (date: number) => `${own ? "your votes" : "votes back"} from ${utc(date)}`;
  switch (s.kind) {
    case "in":
      return inGroup === `in:${s.automation.kind}` ? null : status("running", "In ", automationLink(s.automation));
    case "joined":
      return status("joining", `Joining ${s.automation.name}: `, `votes from ${utc(s.date)}`);
    case "left":
      return status("leaving", `Leaving ${s.automation.name}: `, back(s.date));
    case "partly":
      return status("stopped", `Partly in ${s.automation.name}`);
    case "stopped":
      return status("stopped", `In ${s.name}`, ` · stopped since ${inYear(s.voted)}`);
    case "other":
      return status("elsewhere", `In ${s.name}`);
    case "left-other":
      return status("leaving", `Left ${s.name}: `, back(s.date));
    case "delegated":
      return status("elsewhere", "Delegated to ", link(`https://basescan.org/address/${s.to}`, short(s.to), true));
    case "self":
      return status("idle", own ? "You vote with it" : "Its owner votes with it");
    case "unvoted":
      return status("stopped", `Not voted ${s.voted ? `since ${inYear(s.voted)}` : "yet"}`);
    case "ended":
      return status("idle", "Lock ended · ", link("https://www.hydrex.fi/accounts", "Extend", true));
    case "empty":
      return status("idle", "Empty");
  }
}

// What each automation's votes earned last epoch per 1,000 votes, and against Hydrex's average at the same prices.
const record = (automation: Automation): Value =>
  shown(data.earnings(automation), (earnings) =>
    earnings.votes
      ? frag(
          money(perThousandOf(earnings)),
          Object.assign(document.createElement("span"), { className: "small", textContent: " / 1k votes" }),
        )
      : "No record yet",
  );
// How some votes compare with Hydrex's average: hidden when there is nothing to compare, or it could not be read.
const compared = (mine: Got<Earnings | "none">): Value => {
  const got = data.then(mine, (earnings) =>
    earnings === "none" || !earnings.votes || !earnings.pools.length
      ? { value: null }
      : data.then(data.average(), (all) => ({ value: versus(earnings, all) ?? null })),
  );
  return got.failed || got.value === null ? null : shown(got, versusWords);
};
const recordVersus = (automation: Automation): Value => compared(data.earnings(automation));
// The automation's state: whether joining is on, whether it voted in the epoch.
function stateNode(automation: Automation): Value {
  const off = checks().value?.get(automation.kind)?.length;
  if (off) return status("failed", "Joining off");
  const fresh: Got<{ voted?: number | undefined; epochStart: number }> =
    automation === MATCHA_LATTE ? data.matchaLatte() : data.freshness(automation);
  if (fresh.value?.voted === undefined)
    return fresh.failed || fresh.value ? status("idle", "Not read yet") : status("checking", "Checking…");
  const { voted, epochStart } = fresh.value;
  const stopped = hydrex.hasStopped(voted, epochStart);
  return status(
    stopped ? "stopped" : "running",
    stopped ? "Stopped" : "Running",
    ...(voted ? [`${stopped ? " since " : " · voted "}${day(voted)}`] : []),
  );
}
const matchaLatteValue = <T>(text: (found: MatchaLatte) => T): Value => shown(data.matchaLatte(), text as never);

// The wallet's Hydrex accounts, each with its status and group.
type Member = { account: Account; status: Status; group: hydrex.Group };
const members = ({ owner, accounts, epochStart }: Holdings): Member[] =>
  accounts.map((account) => {
    const status = hydrex.statusOf(account, owner, now(), epochStart);
    return { account, status, group: hydrex.groupOf(account, status) };
  });
const open = (automation: Automation): boolean => !!checks().value && !checks().value!.get(automation.kind)!.length;
const overdueOf = (holdings: Holdings) => {
  const found = data.payouts(holdings).value;
  return found ? overdue(found) : [];
};
// What a group's buttons can do for an account.
function can(action: string, account: Account, arg: string | undefined, holdings: Holdings): boolean {
  const automation = automationOf(arg);
  if (action === "join") return !!automation && open(automation) && hydrex.canJoin(account, automation, now());
  if (action === "leave") return AUTOMATIONS.some((each) => hydrex.canLeave(account, each));
  if (action === "self")
    return AUTOMATIONS.some((each) => hydrex.canLeave(account, each)) || hydrex.canLeaveOther(account);
  if (action === "claim") return overdueOf(holdings).some((entry) => entry.account.id === account.id);
  return false;
}
// Each group's accounts ticked: those that need their owner, until the owner ticks or unticks one.
const picks = (group: string, able: Account[]): Set<bigint> =>
  state.picks.get(group) ?? new Set(group.includes(" needs:") ? able.map(({ id }) => id) : []);

function drawGroups(root: HTMLElement, holdings: Holdings, belongs: (group: string, member: Member) => boolean): void {
  const all = members(holdings);
  const late = new Set(
    data.payouts(holdings).value?.entries.flatMap(({ standing, account }) => (standing?.late ? [account.id] : [])),
  );
  for (const section of root.querySelectorAll<HTMLElement>("[data-group]")) {
    const group = `${root.dataset.view} ${section.dataset.group}`;
    const these = all.filter((member) => belongs(section.dataset.group!, member));
    const buttons = [...section.querySelectorAll<HTMLButtonElement>("button[data-action]")];
    const able = these
      .map(({ account }) => account)
      .filter((account) => buttons.some(({ dataset }) => can(dataset.action!, account, dataset.arg, holdings)));
    const picked = picks(group, able);
    const chosen = able.length > 1 ? able.filter(({ id }) => picked.has(id)) : able;
    section.hidden = !these.length;
    list(
      $("[data-list=account]", section),
      these,
      ({ account }) => String(account.id),
      (row, { account, status: st }) => {
        const earned = data.earnedBy(holdings, account.id);
        fill(row, {
          link: { href: hrefOf({ view: "account", id: account.id }), text: accountName(account) },
          votes: voteWords(account.votes),
          earned:
            earned.value === null
              ? null
              : shown(
                  earned,
                  (found) =>
                    ` · ${money(moneyAt(found!.share * valueOf(found!.of).total, found!.of.prices))} last epoch`,
                ),
          status: statusNode(st, true, section.dataset.group),
          late: late.has(account.id) ? status("stopped", "Payout late") : null,
        });
        const box = row.querySelector<HTMLInputElement>("input")!;
        box.hidden = !(able.length > 1 && able.includes(account));
        box.checked = picked.has(account.id);
        box.setAttribute("aria-label", `Pick ${accountName(account)}`);
      },
    );
    for (const button of buttons) {
      button.hidden = !able.some((account) => can(button.dataset.action!, account, button.dataset.arg, holdings));
      button.disabled = !chosen.some((account) => can(button.dataset.action!, account, button.dataset.arg, holdings));
    }
    const box = section.querySelector<HTMLInputElement>("[data-action=pick-all]");
    if (box) {
      box.checked = chosen.length === able.length;
      box.indeterminate = chosen.length > 0 && chosen.length < able.length;
    }
    const votes = chosen.reduce((sum, { votes }) => sum + votes, 0n);
    const fewer = these.some(({ account }) => account.votes > 0n);
    fill(section, {
      all: able.length > 1,
      picked: able.length > 1 && chosen.length > 0 && `${chosen.length} of ${able.length} · ${voteWords(votes)}`,
      count:
        section.dataset.group === "closed"
          ? count(
              these.length,
              `Hydrex account ${fewer ? "with less than one vote" : "without votes"}`,
              `Hydrex accounts ${fewer ? "with less than one vote" : "without votes"}`,
            )
          : String(these.length),
    });
  }
}

export function drawHydrex(): void {
  for (const automation of AUTOMATIONS) {
    const item = $(`[data-kind="${automation.kind}"]`, hydrexView);
    const holdings = data.accounts().value;
    const yours =
      holdings &&
      members(holdings).filter(
        ({ status }) => (status.kind === "in" || status.kind === "joined") && status.automation === automation,
      ).length;
    fill(item, {
      state: stateNode(automation),
      yours: yours ? `Yours: ${count(yours, "Hydrex account", "Hydrex accounts")}` : null,
      takes: matchaLatteValue(({ retireBps, feeBps }) => `${bps(retireBps)} retired${feeWords(feeBps)}`),
      record: record(automation),
      versus: recordVersus(automation),
    });
  }
  const failed = new Set([...(checks().value?.values() ?? [])].flat());
  const reasons: Record<string, string> = {
    chain: "Joining is off: the page reached another network than Base.",
    upgrade: "Joining is off: Hydrex upgraded its VotingEscrow, which this page has not checked yet.",
    logic: "Joining is off: Hydrex changed its VotingEscrow's approval logic, which this page has not checked yet.",
    approvals:
      "Joining Matcha Latte is off: Hydrex changed what joining it approves, which this page has not checked yet.",
    "double-espresso-approvals":
      "Joining Double Espresso is off: Hydrex changed what joining it approves, which this page has not checked yet.",
  };
  const holdings = data.accounts();
  const found = holdings.value && data.payouts(holdings.value).value;
  fill(hydrexView, {
    checks: failed.size
      ? frag(...[...failed].map((id) => Object.assign(document.createElement("p"), { textContent: reasons[id] })))
      : null,
    underway: !!found && !!underWay(found) && "Payout under way.",
    average: shown(data.average(), (all) => money(moneyAt(perThousand(valueOf(all).total, all.votes), all.prices))),
    own: holdings.value ? ownWords(holdings.value) : holdings.failed ? "Not read" : undefined,
    "own-versus": holdings.value ? ownVersus(holdings.value) : null,
    epoch: state.connection ? epochWords() : null,
    accounts: stateOf(holdings, !holdings.value?.accounts.some(({ amount }) => amount > 0n)),
  });
  if (holdings.value) drawGroups(hydrexView, holdings.value, (group, { group: of }) => of === group);
}

function epochWords(): Value {
  const found = data.matchaLatte().value;
  if (!found) return null;
  const end = found.epochStart + WEEK;
  return `A change made now moves the votes from ${utc(end)}${now() < end ? `, in ${until(end - now())}` : ""}.`;
}
// What the wallet's own votes earned last epoch per 1,000 votes, through the accounts it voted with itself.
function ownEarnings(holdings: Holdings): Got<Earnings | "none"> {
  return data.then<Map<bigint, import("../rewards.ts").Stake>, Earnings | "none">(data.stakes(holdings), (stakes) => {
    if (![...stakes.values()].some(({ delegate }) => same(delegate, holdings.owner))) return { value: "none" };
    return data.voter(holdings.owner);
  });
}
function ownWords(holdings: Holdings): Value {
  return shown(ownEarnings(holdings), (own) =>
    own === "none" || !own.votes
      ? "No votes of your own"
      : !own.pools.length
        ? "Didn't vote"
        : `${money(perThousandOf(own))} / 1k votes, last epoch`,
  );
}
const ownVersus = (holdings: Holdings): Value => compared(ownEarnings(holdings));

export function drawProduct(): void {
  const automation = automationOf(state.route.view === "product" ? state.route.kind : "")!;
  const earnings = data.earnings(automation);
  const off = !open(automation) && checks().value;
  fill(productView, {
    name: automation.name,
    state: stateNode(automation),
    off: off ? frag(status("failed", `Joining ${automation.name} is off. `), link("#hydrex", "Why")) : null,
    "retired-share": matchaLatteValue(({ retireBps }) => bps(retireBps)),
    takes: matchaLatteValue(({ feeBps }) => `retired${feeWords(feeBps)}`),
    record: record(automation),
    versus: recordVersus(automation),
    tonnes: matchaLatteValue(({ tonnes }) => `${units(tonnes)} t`),
    "retire-cost": matchaLatteValue(({ retireBps }) => `Up to ${bps(retireBps)} of each payout`),
    "fee-cost": matchaLatteValue(({ feeBps }) => (feeBps === undefined ? "Not read" : bps(feeBps))),
    "max-fee": matchaLatteValue(({ maxFeeBps }) => (maxFeeBps === undefined ? "" : ` (up to ${bps(maxFeeBps)})`)),
    join: `Join ${automation.name}`,
    performance: stateOf(earnings, !earnings.value?.votes),
    "versus-words": performance(automation),
  });
  const ml = automation === MATCHA_LATTE;
  const recipient = data.matchaLatte().value?.feeRecipient;
  const contracts: [string, Value][] = ml
    ? [
        ["Matcha Latte", { address: MATCHA_LATTE.address }],
        ["Fee recipient", recipient ? { address: recipient } : shown(data.matchaLatte(), () => "Not read")],
        ["Operator", { address: MATCHA_LATTE_OPERATOR }],
      ]
    : [
        ["Double Espresso", { address: automation.address }],
        ["Fee recipient", { address: FEE_RECIPIENT }],
      ];
  list(
    $("[data-list=contract]", productView),
    contracts,
    ([name]) => name,
    (row, [name, address]) => fill(row, { name, address }),
  );
  for (const button of productView.querySelectorAll<HTMLElement>("[data-group=can] [data-action=join]"))
    button.dataset.arg = automation.kind;
  for (const button of productView.querySelectorAll<HTMLElement>("[data-group=in] [data-action=leave]"))
    button.dataset.arg = automation.kind;
  const holdings = data.accounts();
  fill(productView, {
    accounts: stateOf(
      holdings,
      !holdings.value?.accounts.some(
        (account) => hydrex.canJoin(account, automation, now()) || hydrex.canLeave(account, automation),
      ),
    ),
  });
  if (holdings.value)
    drawGroups(productView, holdings.value, (group, { account, status }) =>
      group === "in"
        ? hydrex.canLeave(account, automation) ||
          ((status.kind === "in" || status.kind === "joined") && status.automation === automation)
        : open(automation) && hydrex.canJoin(account, automation, now()),
    );
}

// The popup "Performance": the automation against all of Hydrex, both at the average's prices, and its pools.
function performance(automation: Automation): Value {
  const mine = data.earnings(automation).value;
  if (!mine?.votes) return null;
  const all = data.average();
  const row = (prefix: string, earnings: Earnings | undefined, prices = earnings?.prices) => {
    const value = earnings && valueOf(earnings, prices);
    const cents = (n: (v: NonNullable<typeof value>) => number) =>
      value ? money(moneyAt(n(value), value), true) : all.failed ? "" : undefined;
    return {
      [`${prefix}votes`]: earnings ? compact(earnings.votes) : all.failed ? "" : undefined,
      [`${prefix}pools`]: earnings ? count(earnings.pools.length, "pool", "pools") : all.failed ? "" : undefined,
      [`${prefix}earned`]: cents((v) => v.total),
      [`${prefix}fees`]: cents((v) => v.fees),
      [`${prefix}incentives`]: cents((v) => v.incentives),
      [`${prefix}per-thousand`]: cents((v) => perThousand(v.total, earnings!.votes)),
    };
  };
  fill(productView, { ...row("", mine, all.value?.prices), ...row("all-", all.value) });
  const value = valueOf(mine, all.value?.prices);
  list(
    $("[data-list=pool]", productView),
    mine.pools,
    ({ address }) => address,
    (tr, pool) =>
      fill(tr, {
        pool: { address: pool.address, text: pool.name },
        share: fraction(Number(pool.votes) / Number(mine.votes)),
        worth: money(moneyAt(value.byPool.get(pool.address.toLowerCase()) ?? 0, value), true),
      }),
  );
  if (all.failed) return "All of Hydrex could not be read.";
  const ratio = all.value && versus(mine, all.value);
  if (ratio === undefined) return all.value ? null : "Loading all of Hydrex… This can take a minute.";
  return Math.abs(ratio - 1) < 0.005
    ? `${automation.name}'s votes earned about the average last epoch.`
    : `${automation.name}'s votes earned ${fraction(Math.abs(ratio - 1))} ${ratio > 1 ? "more" : "less"} than average last epoch.`;
}

// Picking accounts, then acting on those picked.
actions.pick = (el) => {
  const section = el.closest<HTMLElement>("[data-group]")!;
  const group = `${el.closest<HTMLElement>("[data-view]")!.dataset.view} ${section.dataset.group}`;
  const id = BigInt(el.closest<HTMLElement>("[data-key]")!.dataset.key!);
  const rows = [...section.querySelectorAll<HTMLElement>("[data-list=account] > [data-key]")];
  const picked = new Set(
    rows.filter((row) => row.querySelector<HTMLInputElement>("input")!.checked).map((row) => BigInt(row.dataset.key!)),
  );
  if ((el as HTMLInputElement).checked) picked.add(id);
  else picked.delete(id);
  state.picks.set(group, picked);
  render();
};
actions["pick-all"] = (el) => {
  const section = el.closest<HTMLElement>("[data-group]")!;
  const group = `${el.closest<HTMLElement>("[data-view]")!.dataset.view} ${section.dataset.group}`;
  const ids = [...section.querySelectorAll<HTMLElement>("[data-list=account] > [data-key]")].filter(
    (row) => !row.querySelector("input")!.hidden,
  );
  state.picks.set(group, new Set((el as HTMLInputElement).checked ? ids.map((row) => BigInt(row.dataset.key!)) : []));
  render();
};
// The accounts an action is for: those picked in the button's group, or the account shown.
function chosen(el: HTMLElement): Account[] {
  const holdings = data.accounts().value;
  const view = el.closest<HTMLElement>("[data-view]")!;
  if (view.dataset.view === "account" && state.route.view === "account")
    return data.accountShown(state.route.id).holdings.value?.accounts ?? [];
  const section = el.closest<HTMLElement>("[data-group]")!;
  if (!holdings) return [];
  const rows = [...section.querySelectorAll<HTMLElement>("[data-list=account] > [data-key]")];
  const ids = rows
    .filter((row) => row.querySelector("input")!.hidden || row.querySelector<HTMLInputElement>("input")!.checked)
    .map((row) => BigInt(row.dataset.key!));
  return holdings.accounts.filter(({ id }) => ids.includes(id));
}
actions.join = (el) => change(chosen(el), "join", automationOf(el.dataset.arg));
actions.leave = (el) => change(chosen(el), "leave");
actions.self = (el) => change(chosen(el), "self");
actions.claim = (el) => {
  const holdings = data.accounts().value;
  if (!holdings) return;
  const ids = new Set(chosen(el).map(({ id }) => id));
  const entries = overdueOf(holdings).filter(({ account }) => ids.has(account.id));
  if (!entries.length) return;
  busy(el as HTMLButtonElement);
  void openClaim(entries)
    .catch(console.error)
    .finally(() => busy(el as HTMLButtonElement, false));
};

// The review of joining or leaving: what it does, the change's gas and what a week would pay, then its calls.
export function change(accounts: Account[], action: "join" | "leave" | "self", automation?: Automation): void {
  const connection = state.connection;
  const holdings =
    data.accounts().value ?? (state.route.view === "account" ? data.accountShown(state.route.id).holdings.value : null);
  if (!connection || !holdings || !accounts.length) return;
  const can = accounts.filter((account) =>
    action === "join" ? automation && hydrex.canJoin(account, automation, now()) : true,
  );
  const next = utc(holdings.epochStart + WEEK);
  const plural = (one: string, many: string) => (can.length === 1 ? one : many);
  if (action === "join" && automation) {
    const body = $<HTMLTemplateElement>("#join").content.firstElementChild!.cloneNode(true) as HTMLElement;
    const ml = automation === MATCHA_LATTE;
    const settings = data.matchaLatte().value;
    const fee =
      settings?.feeBps === 0n
        ? ""
        : settings?.feeBps === undefined
          ? " and any fee"
          : ` and the ${bps(settings.feeBps)} fee`;
    const steps = hydrex.join(can, automation);
    const weekly = data.earnings(automation);
    const paid = ml ? settings && hydrex.paidBpsOf(settings) : 10_000n - FEE_BPS;
    const votes = can.reduce((sum, { votes }) => sum + votes, 0n);
    const gas = hydrex.gasEstimate(steps, connection.address);
    const drawBody = (wei?: Value) =>
      fill(body, {
        unclaimed: `Unclaimed rewards on ${plural("this Hydrex account", "these Hydrex accounts")} will be paid to you ${ml ? "in kVCM " : ""}with ${plural("its next payout", "their next payouts")}${ml ? `, less the share retired${fee}` : ", less the 1% fee"}.`,
        next,
        weekly: shown(weekly, (earnings) =>
          !earnings.votes
            ? "No record yet"
            : paid === undefined
              ? "Not read"
              : money(
                  moneyAt(
                    perThousandOf(earnings).value * (Number(votes) / 1e21) * (Number(paid) / 10_000),
                    earnings.prices,
                  ),
                ),
        ),
        gas: wei,
        takes: ml
          ? settings
            ? `${bps(settings.retireBps)} retired${feeWords(settings.feeBps)}`
            : "Not read"
          : "1% fee",
        control: {
          href: hrefOf({ view: "product", kind: automation.kind, section: "control" }),
          text: ml ? "Can change" : "Immutable",
        },
      });
    drawBody();
    void gas.then(
      ({ wei, prices }) => drawBody(gasWords(wei, prices)),
      () => drawBody("Not read"),
    );
    return openReview({
      name: `Join ${automation.name}`,
      pages: [{ title: "Before you join", body }, {}],
      steps: () => steps,
      checkHref: hrefOf({ view: "product", kind: automation.kind, section: "check" }),
      outcome: async () => doneNode(`Joined. Votes from ${next}.`),
    });
  }
  const from = AUTOMATIONS.filter((each) => accounts.some((account) => hydrex.canLeave(account, each)));
  const steps = [
    ...accounts.flatMap((account) =>
      from.flatMap((each) => (hydrex.canLeave(account, each) ? hydrex.leave([account], each) : [])),
    ),
    ...(action === "self" ? hydrex.leaveOther(accounts.filter(hydrex.canLeaveOther)) : []),
  ];
  const names = [
    ...new Set([
      ...from.map(({ name }) => name),
      ...(action === "self" ? accounts.flatMap((account) => hydrex.otherName(account.delegate) ?? []) : []),
    ]),
  ];
  const body = $<HTMLTemplateElement>("#leave").content.firstElementChild!.cloneNode(true) as HTMLElement;
  fill(body, { next });
  openReview({
    name: `Leave ${listWords(names)}`,
    pages: [{ title: `Leave ${listWords(names)}`, body }],
    steps: () => steps,
    checkHref: hrefOf({ view: "product", kind: (from[0] ?? MATCHA_LATTE).kind, section: "check" }),
    outcome: async () =>
      doneNode(
        `Left. From ${next}, ${plural("its votes are", "their votes are")} yours: vote with them on Hydrex each week.`,
        true,
      ),
  });
}
function doneNode(words: string, vote = false): HTMLElement {
  const done = $<HTMLTemplateElement>("#done").content.firstElementChild!.cloneNode(true) as HTMLElement;
  fill(done, { words, vote, "co-signers": null });
  return done;
}
