import {
  AUTOMATIONS,
  BASESCAN,
  FEE_BPS,
  MATCHA_LATTE,
  MATCHA_LATTE_ADMIN,
  MATCHA_LATTE_OPERATOR,
  FEE_RECIPIENT,
  byKind,
  type Automation,
} from "../config.ts";
import type { Got } from "../cache.ts";
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
  listWords,
  money,
  moneyAt,
  short,
  type Money,
  units,
  until,
  utc,
  voteWords,
} from "../format.ts";
import * as hydrex from "../hydrex.ts";
import type { Account, Holdings, MatchaLatte, Status } from "../hydrex.ts";
import { overdue, underWay } from "../payouts.ts";
import { gasWords, key } from "../prices.ts";
import { aprOf, shareOf, valueOf, type Earnings } from "../rewards.ts";
import { hrefOf } from "../routes.ts";
import { now } from "../rpc.ts";
import { actions, render, state } from "../state.ts";
import { $, busy, enable, fill, frag, fromTemplate, link, list, shown, stateOf, status, type Value } from "../ui.ts";
import { openClaim } from "./claim.ts";
import { openReview } from "./review.ts";

const hydrexView = $('[data-view="hydrex"]');
const productView = $('[data-view="product"]');

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
const feeWords = (feeBps: bigint | undefined): string =>
  feeBps === 0n ? "" : feeBps === undefined ? ", payout fee not read yet" : ` and ${bps(feeBps)} payout fee`;

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
      return status("elsewhere", "Delegated to ", link(`${BASESCAN}/address/${s.to}`, short(s.to), true));
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

// To a tenth of a point.
const aprWords = (apr: number | undefined): string => (apr === undefined ? "No price for HYDX" : fraction(apr, true));
const record = (automation: Automation): Value =>
  shown(data.earnings(automation), (earnings) => {
    if (!earnings.votes) return "No record yet";
    const apr = aprOf(earnings);
    return apr === undefined ? aprWords(apr) : frag(aprWords(apr), fromTemplate("apr"));
  });
// Shown next to an automation's record.
function averageNote(): Value {
  const all = data.average();
  return all.failed
    ? null
    : shown(all, (found) => (aprOf(found) === undefined ? null : `Hydrex average: ${aprWords(aprOf(found))}`));
}
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
const matchaLatteValue = (text: (found: MatchaLatte) => Value): Value => shown(data.matchaLatte(), text);

type Member = { account: Account; status: Status; group: hydrex.Group };
const members = ({ owner, accounts, epochStart }: Holdings): Member[] =>
  accounts.map((account) => {
    const status = hydrex.statusOf(account, owner, now(), epochStart);
    return { account, status, group: hydrex.groupOf(account, status) };
  });
const joinable = (automation: Automation): boolean => checks().value?.get(automation.kind)?.length === 0;
const overdueOf = (holdings: Holdings) => {
  const found = data.payouts(holdings).value;
  return found ? overdue(found) : [];
};
export function can(action: string, account: Account, arg: string | undefined, holdings: Holdings): boolean {
  const automation = byKind(arg ?? "");
  if (action === "join") return !!automation && joinable(automation) && hydrex.canJoin(account, automation, now());
  if (action === "leave") return AUTOMATIONS.some((each) => hydrex.canLeave(account, each));
  if (action === "self")
    return AUTOMATIONS.some((each) => hydrex.canLeave(account, each)) || hydrex.canLeaveOther(account);
  if (action === "claim") return overdueOf(holdings).some((entry) => entry.account.id === account.id);
  return false;
}
// The accounts ticked in a group. Until the owner ticks or unticks one, a `needs:` group starts with every account its
// buttons can act on ticked, and any other group with none.
const picks = (group: string, able: Account[]): Set<bigint> =>
  state.picks.get(group) ?? new Set(group.includes(" needs:") ? able.map(({ id }) => id) : []);

// The accounts each group's buttons can act on, and those they act on, as last drawn.
const drawn = new WeakMap<HTMLElement, { able: Account[]; chosen: Account[] }>();

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
    drawn.set(section, { able, chosen });
    section.hidden = !these.length;
    list(
      $("[data-list=account]", section),
      these,
      ({ account }) => String(account.id),
      (row, { account, status: st }) => {
        const earned = data.accountEarned(holdings, account.id);
        fill(row, {
          link: { href: hrefOf({ view: "account", id: account.id }), text: accountName(account) },
          votes: voteWords(account.votes),
          earned: shown(earned, (worth) => ` · ${money(worth)} last epoch`),
          status: statusNode(st, true, section.dataset.group),
          late: late.has(account.id) ? status("stopped", "Payout late") : null,
        });
        const pickable = able.length > 1 && able.includes(account);
        const box = row.querySelector<HTMLInputElement>("input")!;
        box.parentElement!.hidden = !pickable;
        box.checked = pickable && picked.has(account.id);
        box.setAttribute("aria-label", `Pick ${accountName(account)}`);
      },
    );
    for (const button of buttons) {
      button.hidden = !able.some((account) => can(button.dataset.action!, account, button.dataset.arg, holdings));
      enable(
        button,
        chosen.some((account) => can(button.dataset.action!, account, button.dataset.arg, holdings)),
      );
    }
    const box = section.querySelector<HTMLInputElement>("[data-action=pick-all]");
    if (box) {
      box.checked = chosen.length === able.length;
      box.indeterminate = chosen.length > 0 && chosen.length < able.length;
    }
    const votes = chosen.reduce((sum, { votes }) => sum + votes, 0n);
    const fewer = these.some(({ account }) => account.votes > 0n);
    fill(section, {
      all: able.length > 1 || null,
      picked: able.length > 1 && chosen.length > 0 ? `${chosen.length} of ${able.length} · ${voteWords(votes)}` : null,
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
      takes: matchaLatteValue(({ retireBps }) => `Up to ${bps(retireBps)}`),
      "takes-note": matchaLatteValue(({ feeBps }) => `retired${feeWords(feeBps)}`),
      record: record(automation),
      "record-average": averageNote(),
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
  const average = data.average().value;
  fill(hydrexView, {
    checks: failed.size
      ? frag(...[...failed].map((id) => Object.assign(document.createElement("p"), { textContent: reasons[id] })))
      : null,
    underway: found && underWay(found) ? "Payout under way." : null,
    average: shown(data.average(), (all) => aprWords(aprOf(all))),
    // Only beside an APR, not "Loading…", "Not read" or "No price for HYDX".
    "average-aside": average && aprOf(average) !== undefined ? true : null,
    own: shown(holdings, ownWords),
    epoch: state.connection ? epochWords() : null,
    accounts: stateOf(holdings, !holdings.value?.accounts.some(({ amount }) => amount > 0n)),
  });
  if (holdings.value) drawGroups(hydrexView, holdings.value, (group, { group: of }) => of === group);
}

function epochWords(): Value {
  const { value: found, failed } = data.matchaLatte();
  if (!found) return found === undefined && !failed ? undefined : null;
  const end = found.epochStart + WEEK;
  return `A change made now moves the votes from ${utc(end)}${now() < end ? `, in ${until(end - now())}` : ""}.`;
}
// Last epoch's APR, for the votes the wallet casts itself; votes cast through others don't count.
function ownWords(holdings: Holdings): Value {
  return shown(data.holderEarnings(holdings.owner), (own) =>
    !own.votes
      ? "No votes of your own"
      : !own.pools.length
        ? "Didn't vote"
        : aprOf(own) === undefined
          ? aprWords(undefined)
          : `${aprWords(aprOf(own))} APR, last epoch`,
  );
}

export function drawProduct(): void {
  const automation = byKind(state.route.view === "product" ? state.route.kind : "")!;
  const earnings = data.earnings(automation);
  const off = !joinable(automation) && checks().value;
  fill(productView, {
    name: automation.name,
    state: stateNode(automation),
    off: off ? frag(status("failed", `Joining ${automation.name} is off. `), link("#hydrex", "Why")) : null,
    "retired-share": matchaLatteValue(({ retireBps }) => `Up to ${bps(retireBps)}`),
    takes: matchaLatteValue(({ feeBps }) => `retired${feeWords(feeBps)}`),
    record: record(automation),
    "record-average": averageNote(),
    tonnes: matchaLatteValue(({ tonnes }) => `${units(tonnes)} t`),
    "retire-cost": matchaLatteValue(({ retireBps }) => `Up to ${bps(retireBps)} of each payout`),
    "fee-cost": matchaLatteValue(({ feeBps }) => (feeBps === undefined ? "Not read" : bps(feeBps))),
    "max-fee": matchaLatteValue(({ maxFeeBps }) =>
      maxFeeBps === undefined ? " (its maximum not read)" : ` (up to ${bps(maxFeeBps)})`,
    ),
    join: `Join ${automation.name}`,
    performance: stateOf(earnings, !earnings.value?.votes),
    "performance-note": performance(automation),
  });
  const ml = automation === MATCHA_LATTE;
  const recipient = data.matchaLatte().value?.feeRecipient;
  const contracts: [string, Value][] = ml
    ? [
        ["Matcha Latte", { address: MATCHA_LATTE.address }],
        ["Fee recipient", recipient ? { address: recipient } : shown(data.matchaLatte(), () => "Not read")],
        ["Hydrex admin", { address: MATCHA_LATTE_ADMIN }],
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
        : joinable(automation) && hydrex.canJoin(account, automation, now()),
    );
}

// Fills the "Performance" popup, valuing the automation and all of Hydrex at the average's prices, and returns why all
// of Hydrex is missing, if it is.
function performance(automation: Automation): Value {
  const mine = data.earnings(automation).value;
  if (!mine?.votes) return null;
  const all = data.average();
  const pending = all.failed ? "" : undefined;
  const row = (prefix: string, earnings: Earnings | undefined, prices = earnings?.prices) => {
    const value = earnings && valueOf(earnings, prices);
    const cents = (sum: Money | undefined) => (sum ? money(sum, true) : pending);
    return {
      [`${prefix}votes`]: earnings ? compact(earnings.votes) : pending,
      [`${prefix}pools`]: earnings ? count(earnings.pools.length, "pool", "pools") : pending,
      [`${prefix}earned`]: cents(value && moneyAt(value.total, value)),
      [`${prefix}fees`]: cents(value && moneyAt(value.fees, value)),
      [`${prefix}incentives`]: cents(value && moneyAt(value.incentives, value)),
      [`${prefix}apr`]: earnings ? aprWords(aprOf(earnings, prices)) : pending,
    };
  };
  const value = valueOf(mine, all.value?.prices);
  fill(productView, { ...row("", mine, all.value?.prices), ...row("all-", all.value) });
  list(
    $("[data-list=pool]", productView),
    mine.pools,
    ({ address }) => address,
    (tr, pool) =>
      fill(tr, {
        pool: { address: pool.address, text: pool.name },
        share: fraction(Number(pool.votes) / Number(mine.votes), true),
        worth: money(moneyAt(value.byPool.get(key(pool.address)) ?? 0, value), true),
      }),
  );
  if (all.failed) return "All of Hydrex could not be read.";
  return all.value ? null : "Loading all of Hydrex… This can take a minute.";
}

function pickGroup(el: HTMLElement) {
  const section = el.closest<HTMLElement>("[data-group]")!;
  return {
    key: `${el.closest<HTMLElement>("[data-view]")!.dataset.view} ${section.dataset.group}`,
    ...drawn.get(section)!,
  };
}
actions.pick = (el) => {
  const { key, able } = pickGroup(el);
  const ids = new Set(picks(key, able));
  const id = BigInt(el.closest<HTMLElement>("[data-key]")!.dataset.key!);
  if ((el as HTMLInputElement).checked) ids.add(id);
  else ids.delete(id);
  state.picks.set(key, ids);
  render();
};
actions["pick-all"] = (el) => {
  const { key, able } = pickGroup(el);
  state.picks.set(key, new Set((el as HTMLInputElement).checked ? able.map(({ id }) => id) : []));
  render();
};
function chosen(el: HTMLElement): Account[] {
  const view = el.closest<HTMLElement>("[data-view]")!;
  if (view.dataset.view === "account" && state.route.view === "account")
    return data.accountShown(state.route.id).holdings.value?.accounts ?? [];
  return data.accounts().value ? pickGroup(el).chosen : [];
}
actions.join = (el) => change(chosen(el), "join", byKind(el.dataset.arg ?? ""));
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

export function change(accounts: Account[], action: "join" | "leave" | "self", automation?: Automation): void {
  const connection = state.connection;
  const holdings =
    data.accounts().value ?? (state.route.view === "account" ? data.accountShown(state.route.id).holdings.value : null);
  if (!connection || !holdings || !accounts.length) return;
  const able = accounts.filter((account) =>
    action === "join" ? automation && hydrex.canJoin(account, automation, now()) : true,
  );
  const next = utc(holdings.epochStart + WEEK);
  const plural = (one: string, many: string) => (able.length === 1 ? one : many);
  if (action === "join" && automation) {
    const body = fromTemplate("join");
    const ml = automation === MATCHA_LATTE;
    const settings = data.matchaLatte().value;
    const fee =
      settings?.feeBps === 0n
        ? ""
        : settings?.feeBps === undefined
          ? " and any payout fee"
          : ` and the ${bps(settings.feeBps)} payout fee`;
    const steps = hydrex.join(able, automation);
    const weekly = data.earnings(automation);
    const paid = ml ? settings && hydrex.paidBpsOf(settings) : 10_000n - FEE_BPS;
    const votes = able.reduce((sum, { votes }) => sum + votes, 0n);
    const gas = hydrex.gasEstimate(steps, connection.address);
    const drawBody = (wei?: Value) =>
      fill(body, {
        unclaimed: `Unclaimed rewards on ${plural("this Hydrex account", "these Hydrex accounts")} will be paid to you ${ml ? "in kVCM " : ""}with ${plural("its next payout", "their next payouts")}${ml ? `, less the share retired${fee}` : ", less the 1% fee"}.`,
        next,
        weekly: shown(weekly, (earnings) => {
          if (!earnings.votes) return "No record yet";
          if (paid === undefined) return "Not read";
          const each = shareOf(earnings, votes);
          return money({ ...each, value: (each.value * Number(paid)) / 10_000 });
        }),
        gas: wei,
        takes: ml ? (settings ? `Up to ${bps(settings.retireBps)}` : "Not read") : "1%",
        "takes-note": ml ? (settings ? `retired${feeWords(settings.feeBps)}` : null) : "on claims",
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
  const body = fromTemplate("leave");
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
  const done = fromTemplate("done");
  fill(done, { words, vote: vote || null });
  return done;
}
