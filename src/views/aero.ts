import { zeroAddress, type Address } from "viem";
import * as aero from "../aero.ts";
import {
  WINDOWS,
  isBlueChip,
  isThin,
  routable,
  type Gauge,
  type Hours,
  type Market,
  type Paid,
  type Pending,
  type Per10k,
  type Stake,
} from "../aero.ts";
import { andThen, type Got } from "../cache.ts";
import * as config from "../config.ts";
import { AUTOPILOTS, BASESCAN, PAYMENTS_MODULE } from "../config.ts";
import * as data from "../data.ts";
import { compact, count, date, day, figure, fixed, fraction, money, moneyAt, short, until, utc } from "../format.ts";
import { key } from "../prices.ts";
import { hrefOf } from "../routes.ts";
import { now, same, simulate } from "../rpc.ts";
import { actions, render, state } from "../state.ts";
import { $, busy, enable, fill, fromTemplate, link, list, shown, stateOf, status, type Value } from "../ui.ts";
import type { Slip } from "../wallet.ts";
import { drawChart, type Series } from "./chart.ts";
import { openReview } from "./review.ts";

const aeroView = $('[data-view="aero"]');
const stakeView = $('[data-view="stake"]');
const poolView = $('[data-view="pool"]');

// As the visitor set it on the Aero page; the stake and pool pages show the same window.
const controls: { hours: Hours } = { hours: 48 };
// A shorter record says nothing.
const SHORTEST = 6 * 3_600;
const STEP_DAYS = aero.STEP / aero.DAY;
const RECORD_DAYS = aero.PICKS * STEP_DAYS;
const WINDOW: Record<Hours, { last: string; head: string; over: string; name: string }> = {
  48: { last: "last 48 h", head: "Last 48 h", over: "48 hours", name: "48 hours" },
  96: { last: "last 4 days", head: "Last 4 days", over: "four days", name: "4 days" },
  192: { last: "last 8 days", head: "Last 8 days", over: "eight days", name: "8 days" },
};
// `k` counts back from the newest step.
const stepWords = (k: number): string =>
  k === 0 ? `Last ${STEP_DAYS} days` : `${k * STEP_DAYS}–${(k + 1) * STEP_DAYS} days ago`;
const stepBrief = (k: number): string => `${k * STEP_DAYS}–${(k + 1) * STEP_DAYS} d`;

// To the cent, and "At least" when some tokens have no price.
const perDay = (value: number, priced: boolean, market: Market): string =>
  money(moneyAt(value, market.prices, !priced), true);
// What 10,000 sAERO earn a day as an APR, to a tenth of a point, and "At least" when some tokens have no price.
function apr(per10k: number, priced: boolean, market: Market): string {
  const found = aero.aprOf(per10k, market.prices);
  return found === undefined ? "–" : `${priced ? "" : "At\u00a0least\u00a0"}${fraction(found, true)}`;
}
const sAero = (amount: bigint): string => `${compact(amount)} sAERO`;
const power = (amount: bigint): string => `${compact(amount)} sAERO weight`;
const hoursWords = (seconds: number): string =>
  seconds % 3_600 === 0 ? count(seconds / 3_600, "hour", "hours") : until(seconds);

export const autopilotOf = (stake: Stake) =>
  AUTOPILOTS.find((each) => each.id === stake.id && same(stake.owner, each.relay));
export const stakeName = (stake: Stake | undefined, id: bigint): string =>
  (stake && autopilotOf(stake)?.name) ?? `sAERO #${id}`;
const lockWords = ({ permanent, end }: Stake): string =>
  permanent ? "Permanent" : `${end > now() ? "Ends" : "Ended"} ${date(end)}`;
const poolsIn = (stake: Stake): number => stake.allocations.filter(({ gauge }) => !aero.isIdleGauge(gauge)).length;

function holdNode(stake: Stake, market: Market | undefined): Value {
  if (!stake.onBase && !poolsIn(stake)) return status("idle", "Not allocated on Base");
  if (!market) return undefined;
  const at = aero.movesAt(stake, market.cooldown);
  return at > now()
    ? status("running", "Holds", ` until ${utc(at)}, in ${until(at - now())}`)
    : status("idle", "Can move now");
}
// Of approvals for all of an owner's sAERO, only Aero's payments module's can be read: others would need logs.
function approvalNode(stake: Stake, full = false): Value {
  if (!same(stake.approved, zeroAddress) && !same(stake.approved, PAYMENTS_MODULE))
    return status(
      "stopped",
      "Approved to ",
      link(`${BASESCAN}/address/${stake.approved}`, short(stake.approved), true),
      ", which can also transfer it",
    );
  if (same(stake.approved, PAYMENTS_MODULE) || stake.module) return "Approved for Aero's payments module";
  return full
    ? "Not approved to anyone for this sAERO alone. An address its owner approved for all their sAERO would not show here."
    : null;
}
function pendingWords(stake: Stake, pending: Got<Map<bigint, Pending>>, market: Market | undefined): Value {
  if (!poolsIn(stake)) return null;
  const got = andThen(pending, (all) => ({ value: all.get(stake.id) ?? null }));
  return shown(got, (found) => {
    if (!market) return undefined;
    if (!found.amounts.size)
      return found.partial
        ? "Nothing found to claim from its pools now, though some of it could not be counted"
        : "Nothing to claim from its pools now";
    const worth = aero.worthPending(found, market.prices);
    const words = money(moneyAt(worth.value, market.prices, found.partial || !worth.priced));
    return `${words} to claim from its pools now, in ${count(found.amounts.size, "token", "tokens")}`;
  });
}
// The wallet's own stakes are read together.
function pendingFor(stake: Stake): Got<Map<bigint, Pending>> {
  const own = data.ownStakes().value;
  return data.pending(own?.some(({ id }) => id === stake.id) ? own : [stake]);
}

type Part = { gauge: Address; percent: number };
// `rows` undefined follows the suggestion; `stake` undefined is the wallet's first; `amount` counts only without a
// stake. `more` lists the other pools shown too, by gauge, each after the suggestion's in the order it was added, even
// once its share is typed, so that its row keeps its place and its focus.
const plan: {
  count: number;
  again: boolean;
  blueChips: boolean;
  incentives: boolean;
  amount: number;
  stake: bigint | undefined;
  rows: Part[] | undefined;
  more: string[];
} = {
  count: 10,
  again: false,
  blueChips: false,
  incentives: true,
  amount: 10_000,
  stake: undefined,
  rows: undefined,
  more: [],
};
// The rows as last drawn, which the actions edit, and the next pools "Show more pools" adds.
let drawn: Part[] = [];
let nextPools: string[] = [];
const MORE = 10;
const wholeOf = (amount: bigint): number => Number(amount) / 1e18;
const wholePower = (amount: number): string => power(BigInt(Math.round(amount)) * 10n ** 18n);
const totalOf = (rows: Part[]): number => rows.reduce((sum, { percent }) => sum + percent, 0);
// Within a twentieth of a point of 100%, the shares are scaled to it when sent.
const whole = (total: number): boolean => Math.abs(total - 100) < 0.05;
const ruleRows = (picks: aero.Pick[]): Part[] =>
  picks.map(({ gauge, weight }) => ({ gauge: gauge.address, percent: weight * 100 }));
function edit(change: (rows: Part[]) => Part[]): void {
  plan.rows = change(plan.rows ?? drawn);
  render();
}
const strategyOf = (market: Market): aero.Strategy => ({
  count: Math.min(plan.count, market.maxGauges),
  hours: controls.hours,
  again: plan.again,
  blueChips: plan.blueChips,
  incentives: plan.incentives,
});
// As weights that add up to one.
function holdingsOf(rows: Part[], market: Market): aero.Holding[] {
  const total = totalOf(rows);
  return total > 0
    ? rows.map(({ gauge, percent }) => ({ gauge: aero.gaugeAt(market, gauge), weight: percent / total }))
    : [];
}

const stakeFor = (stakes: Stake[]): Stake | undefined => stakes.find(({ id }) => id === plan.stake) ?? stakes[0];
// In whole sAERO.
function placesOf(stake: Stake | undefined) {
  const mine = new Map<string, number>();
  for (const { gauge, amount } of stake?.allocations ?? [])
    if (!aero.isIdleGauge(gauge)) mine.set(key(gauge), (mine.get(key(gauge)) ?? 0) + wholeOf(amount));
  return mine;
}
function flagsOf(gauge: Gauge | undefined, market: Market, hold: number): string | null {
  if (!gauge) return "Not one of Aero's pools on Base";
  if (!routable(gauge)) return "Doesn't take allocations";
  const ends = gauge.programs
    .filter(
      ({ rate, start, end }) => rate && start < market.time + hold && end > market.time && end < market.time + hold,
    )
    .map(({ end }) => end);
  const grew = Number(gauge.power) / Number(gauge.windows[controls.hours].power) - 1;
  const flags = [
    isThin(gauge, controls.hours) ? "Thin" : "",
    ends.length ? `Incentives end in ${until(Math.min(...ends) - market.time)}` : "",
    grew > 0.25 ? `${fraction(grew)} more sAERO weight than ${WINDOW[controls.hours].over} ago` : "",
  ].filter(Boolean);
  return flags.length ? flags.join(" · ") : null;
}
function blockedWords(blocked: aero.Blocked, stake: Stake): string {
  const name = stakeName(stake, stake.id);
  switch (blocked.why) {
    case "ended":
      return `The lock of ${name} has ended, so it can't be allocated.`;
    case "empty":
      return `${name} has nothing to allocate on Base: all its sAERO weight is on other chains.`;
    case "held":
      return `${name} was allocated less than ${hoursWords(data.market().value?.cooldown ?? 0)} ago. It can be changed again from ${utc(blocked.until)}, in ${until(blocked.until - now())}.`;
  }
}
// Why the rows cannot be allocated now, or what allocating them does.
function allocateWords(stake: Stake | undefined, stakes: Stake[], rows: Part[], market: Market): [boolean, string] {
  if (!state.connection) return [false, "Connect a wallet to allocate."];
  if (!stakes.length) return [false, "This wallet has no sAERO."];
  if (!stake) return [false, ""];
  const blocked = aero.blockedOf(stake, market.cooldown, now());
  if (blocked) return [false, blockedWords(blocked, stake)];
  if (!rows.length) return [false, "Add at least one pool."];
  const total = totalOf(rows);
  if (!whole(total)) return [false, `The shares add up to ${fraction(total / 100, true)}, not 100%.`];
  // A pool at 0% is not sent.
  const included = rows.filter(({ percent }) => percent > 0);
  if (included.length > market.maxGauges) return [false, `Aero allows at most ${market.maxGauges} pools.`];
  const closed = included.find(({ gauge }) => {
    const found = aero.gaugeAt(market, gauge);
    return !found || !routable(found);
  });
  if (closed)
    return [
      false,
      `${aero.gaugeAt(market, closed.gauge)?.name ?? short(closed.gauge)} doesn't take allocations: remove it.`,
    ];
  return [
    true,
    `Allocates the ${power(aero.budgetOf(stake))} of ${stakeName(stake, stake.id)} on Base to ${included.length === 1 ? "this pool" : `these ${count(included.length, "pool", "pools")}`}, replacing its current allocation. It can't be changed again for ${hoursWords(market.cooldown)} after that.`,
  ];
}

export function drawAero(): void {
  const got = data.market();
  const market = got.value;
  const stakes = data.ownStakes().value ?? [];
  const stake = stakeFor(stakes);
  const amount = stake ? wholeOf(aero.budgetOf(stake)) : plan.amount;
  fill(aeroView, {
    cooldown: shown(got, () => until(market!.cooldown)),
    "max-gauges": shown(got, () => String(market!.maxGauges)),
  });
  drawControls(stakes, stake);
  drawRecord(got, amount, stake);
  drawAllocation(got, amount, stake, stakes);
  list(
    $("[data-list=contract]", aeroView),
    [
      ["VotingEscrow (sAERO)", config.AERO_ESCROW],
      ["Voter", config.AERO_VOTER],
      ["LeafVoter", config.LEAF_VOTER],
      ["FactoryRegistry", config.FACTORY_REGISTRY],
    ] as const,
    ([name]) => name,
    (row, [name, address]) => fill(row, { name, address: { address } }),
  );
}

function drawControls(stakes: Stake[], stake: Stake | undefined): void {
  fill(aeroView, {
    "stake-row": stakes.length ? true : null,
    "stake-link": stake ? { href: hrefOf({ view: "stake", id: stake.id }), text: "Its allocation now" } : null,
    "amount-row": stakes.length ? null : true,
  });
  list(
    $("[data-list=stake-option]", aeroView),
    stakes,
    ({ id }) => String(id),
    (option, each) => {
      fill(option, { name: `${stakeName(each, each.id)} · ${power(aero.budgetOf(each))} on Base` });
      (option as HTMLOptionElement).value = String(each.id);
    },
  );
  $<HTMLSelectElement>("[data-action=aero-stake]", aeroView).value = stake ? String(stake.id) : "";
  $<HTMLSelectElement>("[data-action=aero-count]", aeroView).value = String(plan.count);
  $<HTMLSelectElement>("[data-action=aero-window]", aeroView).value = String(controls.hours);
  $<HTMLInputElement>("[data-action=aero-again]", aeroView).checked = plan.again;
  $<HTMLInputElement>("[data-action=aero-blue]", aeroView).checked = plan.blueChips;
  $<HTMLInputElement>("[data-action=aero-incentives]", aeroView).checked = plan.incentives;
}

const secondsOf = (steps: Paid[]): number => steps.reduce((sum, { from, to, paid }) => sum + (paid ? to - from : 0), 0);
// "the last 6 days", or "6 of the last 8 days" when the steps with an answer are not the newest.
function periodOf(steps: Paid[]): string {
  const days = Math.round(secondsOf(steps) / aero.DAY);
  const gap = steps.findIndex(({ paid }) => !paid);
  return gap < 0 || steps.slice(gap).every(({ paid }) => !paid)
    ? `the last ${count(days, "day", "days")}`
    : `${days} of the last ${RECORD_DAYS} days`;
}
// The strategy as the controls set it, and that it is picked from only what was known then.
function introOf({ count: top, hours, again, blueChips, incentives }: aero.Strategy): string {
  const pools = `the top ${count(top, "pool", "pools")}${blueChips ? " of blue chips" : ""} by exchange revenue${incentives ? "" : " without incentives"} over the ${WINDOW[hours].over} before`;
  return again
    ? `Your strategy as if you had started it ${RECORD_DAYS} days ago: ${pools} each pick, picked again every ${hoursWords(aero.STEP)}. Without hindsight: each pick knows only what was known then.`
    : `Your strategy as if you had started it ${RECORD_DAYS} days ago: ${pools} that, and kept since. Without hindsight: the pick knows only what was known then.`;
}
const beganOf = (market: Market): number =>
  Math.min(...market.gauges.filter((gauge) => routable(gauge) && gauge.first > 0).map(({ first }) => first));

function drawRecord(got: Got<Market>, amount: number, stake: Stake | undefined): void {
  const market = got.value;
  const extra = andThen(got, (found) => data.pastFor(aero.timesFor(found, strategyOf(found))));
  fill(aeroView, {
    "record-intro": introOf(
      market
        ? strategyOf(market)
        : {
            count: plan.count,
            hours: controls.hours,
            again: plan.again,
            blueChips: plan.blueChips,
            incentives: plan.incentives,
          },
    ),
  });
  if (!market || !extra.value) return void fill(aeroView, { plan: stateOf(extra) });
  const { hours, again, incentives } = strategyOf(market);
  const past = aero.mergePast(market.past, extra.value);
  const strategy = aero.strategySteps(market, past, strategyOf(market), amount);
  const custom = plan.rows && aero.customSteps(market, market.past, holdingsOf(plan.rows, market), amount);
  const average = aero.averageSteps(market, market.past);
  const record = data.autopilotRecord();
  const pilot: Got<Paid[]> = andThen(record, (found) => ({
    value: found ? aero.movedSteps(market, aero.mergePast(market.past, found.past), found.moves) : [],
  }));
  const pilotName = (record.value && autopilotOf(record.value.stake)?.name) ?? AUTOPILOTS[0]!.name;
  const overall = aero.overallOf(strategy);
  // Picks need the window before them, which the pools' history on Base may not cover.
  const began = beganOf(market);
  const short = strategy.filter(({ from, paid }) => !paid && from - hours * 3_600 < began).length;
  const history = `Aero's pools on Base began ${count(Math.floor((market.time - began) / aero.DAY), "day", "days")} ago`;
  fill(aeroView, {
    plan: stateOf(extra, !overall),
    "record-empty": short
      ? `${history}: too recently for a pick ${RECORD_DAYS} days ago from the ${WINDOW[hours].over} before it. Pick a shorter window, or reallocate every ${hoursWords(aero.STEP)}.`
      : "No pool has enough history yet.",
  });
  if (!overall) return;
  const ofCustom = custom && aero.overallOf(custom);
  const ofPilot = pilot.value && aero.overallOf(pilot.value);
  const ofAverage = aero.overallOf(average);
  const first = record.value?.moves.at(-1)?.at;
  const since = strategy.at(-1)!.from;
  // Over fewer days than the record's.
  const shorter = (steps: Paid[]) => (steps.every(({ paid }) => paid) ? "" : ` over ${periodOf(steps)}`);
  const earned = money(
    moneyAt((overall.total * amount * secondsOf(strategy)) / aero.PER / aero.DAY, market.prices, !overall.priced),
  );
  const figure = (found: Per10k | undefined) => (found ? `${apr(found.total, found.priced, market)} APR` : "–");
  fill(aeroView, {
    "average-apr": figure(ofAverage),
    "pilot-apr": shown(pilot, () => figure(ofPilot)),
    "pilot-note": shown(pilot, () =>
      first !== undefined && first > since
        ? `${pilotName}'s actual allocations, since it first allocated on Base ${until(market.time - first)} ago`
        : `${pilotName}'s actual allocations`,
    ),
    "strategy-apr": figure(overall),
    "strategy-note":
      amount > 0
        ? `${earned}${shorter(strategy)} for ${stake ? stakeName(stake, stake.id) : wholePower(amount)}`
        : shorter(strategy).trim() || null,
    "custom-tile": custom ? true : null,
    "custom-apr": figure(ofCustom),
  });
  drawLines(market, [
    { id: "average", name: "Base average", color: "var(--series-3)", steps: average },
    { id: "pilot", name: pilotName, color: "var(--series-2)", steps: pilot.value ?? [] },
    { id: "strategy", name: "Your strategy", color: "var(--series-1)", steps: strategy },
    ...(custom
      ? [{ id: "custom", name: "Custom allocation", color: "var(--series-1)", dashed: true, steps: custom }]
      : []),
  ]);
  fill(aeroView, { "custom-head": custom ? true : null });
  const cell = (paid: Per10k | undefined) => (paid ? apr(paid.total, paid.priced, market) : "–");
  list(
    $("[data-list=step]", aeroView),
    strategy,
    ({ from }) => String(from),
    (tr, step, k) =>
      fill(tr, {
        when: stepWords(k),
        strategy: cell(step.paid),
        custom: custom ? cell(custom[k]?.paid) : null,
        pilot: shown(pilot, (steps) => cell(steps[k]?.paid)),
        average: cell(average[k]?.paid),
      }),
  );
  const knows = `each pool's fees over the ${WINDOW[hours].over} before it${incentives ? " and the incentives running then" : ""}`;
  fill(aeroView, {
    "record-note": [
      again
        ? `Each pick knows ${knows}, and is kept until the next, as an allocation holds for ${hoursWords(market.cooldown)}.`
        : `The pick knows ${knows}.`,
      short
        ? `${history}, too recently for ${short === 1 ? "the oldest step's pick" : `the oldest ${short} steps' picks`} from the ${WINDOW[hours].over} before.`
        : "",
      "Every step is valued at today's prices, not the prices then, and each sAERO is counted as one AERO.",
    ]
      .filter(Boolean)
      .join(" "),
  });
}

type Line = { id: string; name: string; color: string; dashed?: boolean; steps: Paid[] };
// `steps` come newest first; the chart puts the oldest on the left. Each line is drawn over those before it.
function drawLines(market: Market, lines: Line[]): void {
  const series: Series[] = lines.map(({ steps, ...line }) => ({
    ...line,
    values: Array.from({ length: aero.PICKS }, (_, i) => {
      const paid = steps[aero.PICKS - 1 - i]?.paid;
      return paid && aero.aprOf(paid.total, market.prices);
    }),
  }));
  const ks = Array.from({ length: aero.PICKS }, (_, i) => aero.PICKS - 1 - i);
  drawChart($<SVGSVGElement>("[data-chart=record]", aeroView), $(".Chart-tip", aeroView), {
    positions: ks.map(stepWords),
    brief: ks.map(stepBrief),
    series,
    value: (n) => fraction(n, true),
    tick: (n) => fraction(n),
  });
  list(
    $("[data-list=legend]", aeroView),
    lines,
    ({ id }) => id,
    (li, { name, color, dashed }) => {
      li.style.setProperty("--key", color);
      li.toggleAttribute("data-dashed", !!dashed);
      fill(li, { name });
    },
  );
}

function drawAllocation(got: Got<Market>, amount: number, stake: Stake | undefined, stakes: Stake[]): void {
  const market = got.value;
  if (!market) return void fill(aeroView, { picks: stateOf(got) });
  const hold = market.cooldown;
  const mine = placesOf(stake);
  // The stake's sAERO leaves the pools it is in now.
  const leaving = mine.size ? mine : undefined;
  const ahead = new Map(market.gauges.map((gauge) => [gauge, aero.paysNext(gauge, controls.hours, market, hold)]));
  const next = (gauge: Gauge) => ahead.get(gauge);
  const { count: top, blueChips, incentives } = strategyOf(market);
  const picks = aero.picksOf(
    market.gauges
      .filter((gauge) => routable(gauge) && (!blueChips || isBlueChip(gauge)))
      .flatMap((gauge) => {
        const paying = next(gauge);
        return paying && aero.weighable(gauge.windows[controls.hours], paying) ? [{ gauge, paying }] : [];
      }),
    top,
    incentives,
  );
  fill(aeroView, { picks: stateOf(got, !picks.length && !plan.rows) });
  const rows = (drawn = plan.rows ?? ruleRows(picks));
  const total = totalOf(rows);
  const expected = aero.heldOver(holdingsOf(rows, market), next, amount, leaving);
  const inRows = new Set(rows.map(({ gauge }) => key(gauge)));
  const pays = (gauge: Gauge) => {
    const found = next(gauge);
    return found ? aero.totalOf(found) : -1;
  };
  const more = new Set(plan.more);
  nextPools = market.gauges
    .filter((gauge) => routable(gauge) && !inRows.has(key(gauge.address)) && !more.has(key(gauge.address)))
    .sort((a, b) => pays(b) - pays(a))
    .slice(0, MORE)
    .map(({ address }) => key(address));
  const byKey = new Map<string, Part>(rows.map((row) => [key(row.gauge), row]));
  const shownRows = [
    ...rows.filter(({ gauge }) => !more.has(key(gauge))),
    ...plan.more.map((gauge): Part => byKey.get(gauge) ?? { gauge: gauge as Address, percent: 0 }),
  ];
  list(
    $("[data-list=pick]", aeroView),
    shownRows,
    ({ gauge }) => gauge,
    (tr, row) => {
      const gauge = aero.gaugeAt(market, row.gauge);
      const found = gauge && next(gauge);
      const weight = row.percent / 100;
      const here = found && aero.per10kOf(found, amount * weight - (leaving?.get(key(row.gauge)) ?? 0));
      const all = found && aero.per10kOf(found);
      const name = gauge?.name ?? short(row.gauge);
      const input = $<HTMLInputElement>("input", tr);
      if (document.activeElement !== input) input.value = row.percent.toFixed(1);
      input.setAttribute("aria-label", `Share of ${name}`);
      const drop = $("[data-action=aero-drop]", tr);
      drop.setAttribute("aria-label", `Set ${name} to 0%`);
      // Kept in place, so that the share boxes line up.
      drop.toggleAttribute("data-off", !(row.percent > 0));
      fill(tr, {
        pool: gauge ? { href: hrefOf({ view: "pool", gauge: gauge.address }), text: name } : name,
        note: flagsOf(gauge, market, hold),
        amount: amount && weight ? compact(BigInt(Math.round(amount * weight)) * 10n ** 18n) : "–",
        pays: found ? money(moneyAt(aero.totalOf(found), market.prices, !all?.priced)) : "–",
        per: here ? apr(here.total, here.priced, market) : "Not enough history",
      });
    },
  );
  const [can, words] = allocateWords(stake, stakes, rows, market);
  enable($<HTMLButtonElement>("[data-action=aero-allocate]", aeroView), can);
  const moved = leaving
    ? 1 -
      rows.reduce((sum, { gauge, percent }) => sum + Math.min(percent / 100, (mine.get(key(gauge)) ?? 0) / amount), 0)
    : undefined;
  fill(aeroView, {
    "share-total": fraction(total / 100, true),
    "total-amount": amount ? compact(BigInt(Math.round((amount * total) / 100)) * 10n ** 18n) : "–",
    "total-per": expected ? apr(expected.total, expected.priced, market) : "–",
    more: nextPools.length ? true : null,
    scale: (!whole(total) && total > 0) || null,
    edited: plan.rows ? true : null,
    current: mine.size ? true : null,
    "allocate-why": words,
    "plan-note": [
      incentives
        ? `Each pool's share is its part of the top pools' exchange revenue: their fees over the last ${WINDOW[controls.hours].over}, and the incentives already scheduled for the next ${hoursWords(hold)}.`
        : `Each pool's share is its part of the top pools' fees over the last ${WINDOW[controls.hours].over}.`,
      `Thin pools, and pools paying a token without a price, are left out, as in the record. Daily revenue: the pool's fees over the last ${WINDOW[controls.hours].over} and its incentives over the next ${hoursWords(hold)}, a day. Current APR: what your share would earn there in a year if that came again, at current prices, each sAERO counted as one AERO.`,
      amount
        ? `It takes into account that adding ${stake ? `the ${power(aero.budgetOf(stake))} of ${stakeName(stake, stake.id)}` : wholePower(amount)} to a pool lowers what each sAERO in it earns.`
        : "",
      moved === undefined ? "" : `${fraction(moved)} of it would move to different pools.`,
      stake?.elsewhere ? `The ${power(stake.elsewhere)} it has on other chains isn't affected.` : "",
    ]
      .filter(Boolean)
      .join(" "),
  });
}

function refusalWords(name: string | undefined, stake: Stake, market: Market): string {
  switch (name) {
    case "CooldownActive":
      return blockedWords({ why: "held", until: aero.movesAt(stake, market.cooldown) }, stake);
    case "ChainAllocationMismatch":
    case "InsufficientChain0Allocation":
      return `${stakeName(stake, stake.id)} changed since the page read it. Close this, wait a moment, and try again.`;
    case "NotAuthorized":
      return `This wallet doesn't own ${stakeName(stake, stake.id)} and isn't approved for it.`;
    case "StakeExpired":
    case "StakeWithdrawn":
      return blockedWords({ why: "ended" }, stake);
    case "ExceedsMaxGauges":
      return `Aero allows at most ${market.maxGauges} pools.`;
    case "ChainNotActiveOrSunset":
    case "SunsetDeallocOnly":
      return "Aero isn't taking allocations on Base right now.";
    default:
      return "Base refused this allocation without saying why.";
  }
}
async function allocateNow(): Promise<void> {
  const connection = state.connection;
  const market = data.market().value;
  const picked = stakeFor(data.ownStakes().value ?? []);
  if (!connection || !market || !picked) return;
  const name = `Allocate ${stakeName(picked, picked.id)}`;
  const checkHref = hrefOf({ view: "aero", section: "check" });
  const say = (words: string) =>
    openReview({
      name,
      pages: [{ title: name, body: Object.assign(document.createElement("p"), { textContent: words }) }],
      steps: () => [],
      checkHref,
    });
  const [stake] = await aero.readStakes([picked.id]).catch(() => []);
  if (!stake) return say("Base did not answer: try again in a moment.");
  const blocked = aero.blockedOf(stake, market.cooldown, now());
  if (blocked) return say(blockedWords(blocked, stake));
  const rows = drawn.filter(({ percent }) => percent > 0);
  const allotments = aero.allotmentsOf(
    rows.map(({ gauge, percent }) => ({ gauge, weight: percent })),
    aero.budgetOf(stake),
  );
  const call = aero.allocateCall(stake, allotments, connection.address);
  const [run] = await simulate(connection.address, [call]).catch(() => []);
  if (run && !run.ok) return say(refusalWords(aero.refusalOf(run.returnData), stake, market));
  const named = (gauge: Address) => aero.gaugeAt(market, gauge)?.name ?? short(gauge);
  const budget = aero.budgetOf(stake);
  const slip: Slip = {
    ...call,
    title: name,
    says: `Allocates the ${power(budget)} of ${stakeName(stake, stake.id)} on Base to ${count(allotments.length, "pool", "pools")}, replacing its current allocation.`,
    on: "Aero's Voter",
    call: "allocate",
    fields: [
      { label: "sAERO", code: String(stake.id), description: stakeName(stake, stake.id) },
      ...(stake.idle
        ? [
            {
              label: "Onto Base",
              code: String(stake.idle),
              description: `${fixed(stake.idle, 18, 2)} sAERO weight not yet on any chain`,
            },
          ]
        : []),
      { label: "Chain", code: String(config.CHAIN_ID), description: "Base" },
      ...allotments.map(({ gauge, amount }, i) => ({
        label: `Pool ${i + 1}`,
        description: `${named(gauge)} · ${fixed(amount, 18, 2)} sAERO weight`,
        code: [gauge, String(amount)],
        tags: ["Gauge", "sAERO weight"],
        lines: true,
      })),
      {
        label: "Refunds to",
        code: connection.address,
        description: "Where Aero refunds unused fees: allocating on Base charges none",
      },
    ],
  };
  const body = fromTemplate("allocate-review");
  const ends = now() + market.cooldown;
  fill(body, {
    summary: `${stakeName(stake, stake.id)} will allocate its ${power(budget)} on Base to these pools:`,
  });
  list(
    $("[data-list=allot]", body),
    [...allotments].sort((a, b) => (b.amount > a.amount ? 1 : -1)),
    ({ gauge }) => gauge,
    (tr, { gauge, amount }) =>
      fill(tr, {
        pool: named(gauge),
        share: fraction(Number(amount) / Number(budget), true),
        amount: compact(amount),
      }),
  );
  list(
    $("[data-list=allot-note]", body),
    [
      `This replaces its current allocation on Base. It can't be changed again until ${utc(ends)}.`,
      stake.idle ? `Its ${power(stake.idle)} not yet on any chain moves onto Base too.` : "",
      stake.elsewhere ? `Its ${power(stake.elsewhere)} on other chains isn't affected.` : "",
      run ? "Simulated on Base: it succeeds." : "Base couldn't simulate it, so your wallet may warn you.",
    ].filter(Boolean),
    (words) => words,
    (li, words) => fill(li, { words }),
  );
  openReview({
    name,
    pages: [{ title: "Before you allocate", body }, {}],
    steps: () => [slip],
    checkHref,
    outcome: async () => {
      const done = fromTemplate("done");
      fill(done, {
        words: `Allocated. ${stakeName(stake, stake.id)} can be changed again from ${utc(ends)}.`,
        vote: null,
      });
      return done;
    },
  });
}

export function drawStake(): void {
  if (state.route.view !== "stake") return;
  const id = state.route.id;
  const got = data.stakeShown(id);
  const stake = got.value ?? undefined;
  const market = data.market().value;
  const name = stakeName(stake, id);
  document.title = `${name} · metaDEX Café`;
  fill(stakeView, { name, stake: stateOf(got, got.value === null) });
  if (!stake) return;
  const own = !!state.connection && same(stake.owner, state.connection.address);
  const pilot = autopilotOf(stake);
  const shares = market ? aero.sharesOf(stake, market) : [];
  // A record needs every gauge's snapshot from when the stake allocated, and a hold long enough.
  const held = market ? market.time - stake.lastAllocated : undefined;
  const soon = held !== undefined && held < SHORTEST;
  const since: Got<Map<string, aero.Start> | null> =
    !stake.lastAllocated || !poolsIn(stake) || soon
      ? { value: null }
      : market
        ? data.since(stake.lastAllocated)
        : andThen(data.market(), () => ({}));
  const record = andThen(since, (starts) => ({
    value:
      starts && market
        ? {
            earned: aero.earnedBy(shares, aero.sinceIn(starts), market.prices),
            average: aero.average(market, aero.sinceIn(starts), false),
          }
        : null,
  }));
  const paid = market && aero.paidBy(shares, market, controls.hours);
  const average = market && aero.averageOver(market, controls.hours);
  fill(stakeView, {
    hold: holdNode(stake, market),
    amount: sAero(stake.amount),
    lock: lockWords(stake),
    "on-base": compact(stake.onBase),
    pools: `sAERO weight, in ${count(poolsIn(stake), "pool", "pools")}`,
    "idle-row": stake.idle ? true : null,
    idle: compact(stake.idle),
    "elsewhere-row": stake.elsewhere ? true : null,
    elsewhere: compact(stake.elsewhere),
    "pending-row": poolsIn(stake) ? true : null,
    pending: pendingWords(stake, pendingFor(stake), market),
    "owner-row": own ? null : true,
    owner: { address: stake.owner, text: pilot ? `${pilot.name}'s Relay` : short(stake.owner) },
    approval: approvalNode(stake, true),
    manage: own || null,
    record: poolsIn(stake) ? true : null,
    since: soon
      ? `Allocated ${until(held!)} ago`
      : shown(record, ({ earned }) => `${apr(earned.value, earned.priced, market!)} APR`),
    "since-note": soon
      ? "Too soon for a record"
      : shown(
          record,
          ({ average }) => `fees since ${utc(stake.lastAllocated)} · Base average ${apr(average.fees, true, market!)}`,
        ),
    paid: !market ? undefined : paid ? `${apr(paid.value, paid.priced, market)} APR` : "Not enough history",
    "paid-note": !market
      ? undefined
      : paid
        ? `${WINDOW[controls.hours].last}, with live incentives · Base average ${apr(average!.total, true, market)}`
        : null,
    "window-head": WINDOW[controls.hours].head,
  });
  list(
    $("[data-list=share]", stakeView),
    shares,
    ({ address }) => address,
    (tr, { gauge, address, amount, share }) => {
      const earned =
        gauge && market && since.value
          ? aero.feesPerDay(gauge, aero.sinceIn(since.value)(gauge), market.prices)
          : undefined;
      const window = gauge && market && aero.per10k(gauge, controls.hours, market.time, market.prices);
      fill(tr, {
        pool: aero.isIdleGauge(address)
          ? "Not allocated"
          : gauge
            ? { href: hrefOf({ view: "pool", gauge: gauge.address }), text: gauge.name }
            : { address, text: short(address) },
        share: fraction(share),
        power: compact(amount),
        since: earned ? apr(earned.value, earned.priced, market!) : "–",
        window: window ? apr(window.total, window.priced, market!) : "–",
      });
    },
  );
}

function daysWords(row: aero.Day, today: number): string {
  const last = row.day + (row.days - 1) * aero.DAY;
  const words = row.days > 1 ? `${day(row.day)} – ${day(last)}` : day(row.day);
  return last === today ? `${words}, so far` : words;
}

export function drawPool(): void {
  if (state.route.view !== "pool") return;
  const address = state.route.gauge;
  const got = data.market();
  const market = got.value;
  const gauge = market?.gauges.find((each) => same(each.address, address));
  const unread = !!market?.unread.some((each) => same(each, address));
  document.title = `${gauge?.name ?? "Aero pool"} · metaDEX Café`;
  fill(poolView, {
    name: gauge?.name ?? "Aero pool",
    pool: unread ? { state: "failed" } : stateOf(got, !gauge),
    "pool-failed": unread ? "This pool could not be read." : "Aero's pools could not be read.",
  });
  if (!market || !gauge) return;
  const aeroPrice = market.prices.of.get(key(config.AERO));
  const capPerDay = (Number(gauge.cap) / 1e18) * aero.DAY;
  const aeroAmount = (amount: number) => `${figure(BigInt(Math.round(amount)) * 10n ** 18n, 18)} AERO`;
  const stream = aero.streamPerDay(gauge, market.time, market.prices);
  const live = gauge.programs.filter((program) => aero.isLive(program, market.time));
  const paid = aero.per10k(gauge, controls.hours, market.time, market.prices);
  fill(poolView, {
    status: routable(gauge)
      ? status("running", "Takes allocations")
      : status("stopped", "Pays nothing", gauge.activated ? ": its emissions cap is zero" : ": not activated"),
    power: compact(gauge.power),
    thin: isThin(gauge, controls.hours) ? "Thin: one allocation changes what it pays" : null,
    paid: paid ? `${apr(paid.total, paid.priced, market)} APR` : "Not enough history",
    "paid-note": WINDOW[controls.hours].last,
    stream: live.length ? perDay(stream.value, stream.priced, market) : "None",
    programs: live.length ? `a day, from ${count(live.length, "live program", "live programs")}` : "no live program",
    cap: aeroPrice === undefined ? aeroAmount(capPerDay * 7) : money(moneyAt(capPerDay * 7 * aeroPrice, market.prices)),
    "cap-note": `a week, ${aeroAmount(capPerDay)} a day`,
  });
  list(
    $("[data-list=window]", poolView),
    [...WINDOWS],
    (hours) => String(hours),
    (tr, hours) => {
      const found = aero.per10k(gauge, hours, market.time, market.prices);
      fill(tr, {
        window: WINDOW[hours].name,
        fees: found ? apr(found.fees, found.priced, market) : "–",
        incentives: found?.incentives ? apr(found.incentives, found.priced, market) : "–",
        total: found ? apr(found.total, found.priced, market) : "Not enough history",
      });
    },
  );
  const history = data.history(gauge.address);
  const today = market.time - (market.time % aero.DAY);
  fill(poolView, { history: stateOf(history, !history.value?.length) });
  list(
    $("[data-list=day]", poolView),
    history.value ?? [],
    ({ day }) => String(day),
    (tr, row) => {
      const found = aero.feesPerDay(gauge, row, market.prices);
      fill(tr, {
        day: daysWords(row, today),
        note: aero.thinOver(row) ? "Thin" : null,
        power: compact(row.power),
        fees: found ? apr(found.value, found.priced, market) : "–",
      });
    },
  );
  list(
    $("[data-list=program]", poolView),
    live,
    ({ id }) => String(id),
    (li, program) => {
      const perDayUnits = (program.rate * BigInt(aero.DAY)) / 10n ** 18n;
      const price = program.token && market.prices.of.get(key(program.token.address));
      fill(li, {
        words: program.token
          ? `${figure(perDayUnits, program.token.decimals)} ${program.token.symbol} a day${price === undefined ? "" : `, ${money(moneyAt((Number(perDayUnits) / 10 ** program.token.decimals) * price, market.prices))}`}`
          : "A token that could not be read",
        until: `until ${utc(program.end)}`,
      });
    },
  );
  list(
    $("[data-list=contract]", poolView),
    [
      ["Pool", gauge.pool],
      ["Gauge", gauge.address],
      ["Rewards manager", gauge.rewards],
    ] as const,
    ([name]) => name,
    (row, [name, address]) => fill(row, { name, address: { address } }),
  );
}

function suggest(): void {
  plan.rows = undefined;
  plan.more = [];
  render();
}
// The window sets the strategy, so the suggestion comes back.
actions["aero-window"] = (el) => {
  const hours = Number((el as HTMLSelectElement).value);
  controls.hours = WINDOWS.find((each) => each === hours) ?? 48;
  suggest();
};
// The table follows each keystroke; the box is marked invalid only when left or on Enter.
function typed(input: HTMLInputElement, done: boolean, set: (value: number) => void): void {
  const value = aero.amountOf(input.value);
  if (value === undefined) {
    if (done) input.setAttribute("aria-invalid", "true");
    return;
  }
  input.setAttribute("aria-invalid", "false");
  set(value);
  render();
}
actions["aero-count"] = (el) => {
  plan.count = Number((el as HTMLSelectElement).value) || 10;
  suggest();
};
actions["aero-again"] = (el) => {
  plan.again = (el as HTMLInputElement).checked;
  render();
};
actions["aero-incentives"] = (el) => {
  plan.incentives = (el as HTMLInputElement).checked;
  suggest();
};
actions["aero-blue"] = (el) => {
  plan.blueChips = (el as HTMLInputElement).checked;
  suggest();
};
actions["aero-stake"] = (el) => {
  const value = (el as HTMLSelectElement).value;
  plan.stake = value ? BigInt(value) : undefined;
  render();
};
const planBox = $<HTMLInputElement>("[data-action=aero-plan-amount]", aeroView);
const setPlanAmount = (value: number) => void (plan.amount = value);
planBox.addEventListener("input", () => typed(planBox, false, setPlanAmount));
actions["aero-plan-amount"] = () => typed(planBox, true, setPlanAmount);
// A share follows each keystroke; its box is marked invalid only when left or on Enter.
$("[data-list=pick]", aeroView).addEventListener("input", (event) => {
  const input = event.target as HTMLInputElement;
  const gauge = input.closest<HTMLElement>("[data-key]")?.dataset.key;
  const value = aero.amountOf(input.value);
  if (input.dataset.action !== "aero-share" || !gauge || value === undefined) return;
  input.setAttribute("aria-invalid", "false");
  edit((rows) =>
    rows.some((row) => row.gauge === gauge)
      ? rows.map((row) => (row.gauge === gauge ? { ...row, percent: value } : row))
      : [...rows, { gauge: gauge as Address, percent: value }],
  );
});
actions["aero-share"] = (el) => {
  const input = el as HTMLInputElement;
  input.setAttribute("aria-invalid", aero.amountOf(input.value) === undefined ? "true" : "false");
  render();
};
actions["aero-more"] = () => {
  plan.more = [...plan.more, ...nextPools];
  render();
};
// Its row stays, at 0%, so that its share can be typed again.
actions["aero-drop"] = (el) => {
  const gauge = el.closest<HTMLElement>("[data-key]")?.dataset.key;
  edit((rows) => rows.map((row) => (row.gauge === gauge ? { ...row, percent: 0 } : row)));
};
actions["aero-scale"] = () =>
  edit((rows) => {
    const total = totalOf(rows);
    return total > 0 ? rows.map((row) => ({ ...row, percent: (row.percent * 100) / total })) : rows;
  });
actions["aero-rule"] = suggest;
actions["aero-current"] = () => {
  const stake = stakeFor(data.ownStakes().value ?? []);
  const pools = (stake?.allocations ?? []).filter(({ gauge }) => !aero.isIdleGauge(gauge));
  const sum = pools.reduce((all, { amount }) => all + wholeOf(amount), 0);
  if (!sum) return;
  plan.rows = pools.map(({ gauge, amount }) => ({ gauge, percent: (wholeOf(amount) * 100) / sum }));
  render();
};
actions["aero-allocate"] = (el) => {
  const button = el as HTMLButtonElement;
  busy(button);
  void allocateNow()
    .catch((error: unknown) => console.error(error))
    .finally(() => {
      busy(button, false);
      render();
    });
};
export function aeroLine(): Value {
  return shown(data.ownStakes(), (stakes) =>
    stakes.length
      ? `${count(stakes.length, "stake", "stakes")} · ${sAero(stakes.reduce((sum, { amount }) => sum + amount, 0n))}`
      : "No sAERO",
  );
}
