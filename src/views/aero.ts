import { zeroAddress, type Address } from "viem";
import * as aero from "../aero.ts";
import {
  WINDOWS,
  isThin,
  routable,
  type Gauge,
  type Held,
  type Hours,
  type Market,
  type Paid,
  type Pending,
  type Stake,
} from "../aero.ts";
import { andThen, type Got } from "../cache.ts";
import * as config from "../config.ts";
import { AUTOPILOTS, BASESCAN, PAYMENTS_MODULE } from "../config.ts";
import * as data from "../data.ts";
import {
  capitalized,
  compact,
  count,
  date,
  day,
  figure,
  fixed,
  fraction,
  money,
  moneyAt,
  short,
  until,
  utc,
} from "../format.ts";
import { key, type Prices } from "../prices.ts";
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

// In seconds. Records shorter than this aren't shown.
const SHORTEST = 6 * 3_600;
const STEP_DAYS = aero.STEP / aero.DAY;
const RECORD_DAYS = aero.PICKS * STEP_DAYS;
const WINDOW: Record<Hours, string> = { 48: "48 hours", 96: "4 days", 192: "8 days" };
// The window the strategies pick from, and the one the pages show for each pool: the last 8 days, as long as the
// record. On Aero's history, no shorter window earned either strategy even half a percentage point more.
const HOURS: Hours = 192;
const SPAN = WINDOW[HOURS];
// `k` counts back from the newest step.
const stepWords = (k: number): string =>
  k === 0 ? `Last ${STEP_DAYS} days` : `${k * STEP_DAYS}–${(k + 1) * STEP_DAYS} days ago`;
const stepBrief = (k: number): string => `${k * STEP_DAYS}–${(k + 1) * STEP_DAYS} d`;

// To the cent, and "At least" when some tokens have no price.
const perDay = (value: number, priced: boolean, market: Market): string =>
  money(moneyAt(value, market.prices, !priced), true);
// To one decimal place, and "At least" when some tokens have no price.
const aprWords = (found: number | undefined, priced: boolean): string =>
  found === undefined ? "–" : `${priced ? "" : "At\u00a0least\u00a0"}${fraction(found, true)}`;
// What 10,000 sAERO earn a day as an APR.
const aprAt = (per10k: number, priced: boolean, prices: Prices): string => aprWords(aero.aprOf(per10k, prices), priced);
const apr = (per10k: number, priced: boolean, market: Market): string => aprAt(per10k, priced, market.prices);
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
    ? status("running", "Locked", ` until ${utc(at)}, in ${until(at - now())}`)
    : status("idle", "Can move now");
}
// Of the approvals an owner gives for all their sAERO, only the one to Aero's payments module can be read. Others would
// need event logs.
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
// If the stake is one of the wallet's own, all of them are read together.
function pendingFor(stake: Stake): Got<Map<bigint, Pending>> {
  const own = data.ownStakes().value;
  return data.pending(own?.some(({ id }) => id === stake.id) ? own : [stake]);
}

type Part = { gauge: Address; percent: number };
// When `rows` is undefined, the table follows the suggestion. When `stake` is undefined, the page picks one with
// `stakeFor` and keeps it once shown. `amount` is used only when there is no stake. `more` lists the extra pools shown,
// by gauge. Each comes after the suggested pools, in the order it was added, even once its share is typed, so that its
// row keeps its place and its focus.
const plan: {
  again: boolean;
  blueChips: boolean;
  leaders: boolean;
  amount: number;
  stake: bigint | undefined;
  rows: Part[] | undefined;
  more: string[];
} = {
  again: true,
  blueChips: false,
  leaders: true,
  amount: 10_000,
  stake: undefined,
  rows: undefined,
  more: [],
};
// The two strategies, in the order shown. Each has its line's colour, and its `id` names its column in the record's
// table.
const STRATEGIES = [
  { id: "leaders", leaders: true, name: "Follow the leaders", color: "var(--series-1)" },
  { id: "revenue", leaders: false, name: "Follow revenue", color: "var(--series-3)" },
];
// The pools a strategy picks and how it splits them.
function poolsWords({ count: top, blueChips, leaders }: aero.Strategy): string {
  const pools = `${count(top, "pool", "pools")}${blueChips ? " of blue chips" : ""}`;
  return leaders
    ? `The ${pools} paying the most per sAERO above the average, each weighted in proportion to that excess, counted with your sAERO in the pool.`
    : `The ${pools} with the most revenue, each weighted in proportion to its revenue.`;
}
// `drawn` is the rows as last drawn, which the actions edit. `nextPools` is the pools "Show more pools" adds next.
let drawn: Part[] = [];
let nextPools: string[] = [];
const MORE = 10;
const wholeOf = (amount: bigint): number => Number(amount) / 1e18;
const wholePower = (amount: number): string => power(BigInt(Math.round(amount)) * 10n ** 18n);
const totalOf = (rows: Part[]): number => rows.reduce((sum, { percent }) => sum + percent, 0);
// Shares within 0.05 points of 100% count as whole. They are scaled to exactly 100% when sent.
const whole = (total: number): boolean => Math.abs(total - 100) < 0.05;
const ruleRows = (picks: aero.Pick[]): Part[] =>
  picks.map(({ gauge, weight }) => ({ gauge: gauge.address, percent: weight * 100 }));
function edit(change: (rows: Part[]) => Part[]): void {
  plan.rows = change(plan.rows ?? drawn);
  render();
}
// A strategy uses up to 10 pools, or fewer if Aero allows fewer.
const POOLS = 10;
const strategyOf = (market: Market | undefined): aero.Strategy => ({
  count: Math.min(POOLS, market?.maxGauges ?? POOLS),
  hours: HOURS,
  again: plan.again,
  blueChips: plan.blueChips,
  leaders: plan.leaders,
});
// The rows as holdings, with weights that add up to one.
function holdingsOf(rows: Part[], market: Market): aero.Holding[] {
  const total = totalOf(rows);
  return total > 0
    ? rows.map(({ gauge, percent }) => ({ gauge: aero.gaugeAt(market, gauge), weight: percent / total }))
    : [];
}

// How long Aero locks an allocation, in seconds (47 hours). This launch value is used until the market is read.
const LOCK = 169_200;
const cooldownOf = (): number => data.market().value?.cooldown ?? LOCK;
// Largest on Base first.
const bySize = (stakes: Stake[]): Stake[] =>
  [...stakes].sort((a, b) => {
    const [x, y] = [aero.budgetOf(a), aero.budgetOf(b)];
    return x === y ? 0 : x > y ? -1 : 1;
  });
// The stake picked, or else the largest on Base that can be allocated now, or else the largest.
function stakeFor(stakes: Stake[]): Stake | undefined {
  const picked = stakes.find(({ id }) => id === plan.stake);
  if (picked) return picked;
  const sized = bySize(stakes);
  return sized.find((stake) => !aero.blockedOf(stake, cooldownOf(), now())) ?? sized[0];
}
// Why a stake can't be allocated now. Undefined if it can.
function blockedPhrase(stake: Stake): string | undefined {
  const blocked = aero.blockedOf(stake, cooldownOf(), now());
  if (!blocked) return undefined;
  if (blocked.why === "empty") return "nothing on Base";
  if (blocked.why === "ended") return "its lock has ended";
  return `locked until ${utc(blocked.until)}`;
}
// A stake as the picker lists it.
function optionWords(stake: Stake): string {
  const budget = aero.budgetOf(stake);
  return [stakeName(stake, stake.id), budget ? `${power(budget)} on Base` : "", blockedPhrase(stake)]
    .filter(Boolean)
    .join(" · ");
}
// The stake's sAERO in each pool, in whole sAERO, by gauge.
const placesOf = (stake: Stake | undefined): Map<string, number> => aero.byGauge(stake?.allocations ?? []);
function flagsOf(gauge: Gauge | undefined, market: Market, hold: number): string | null {
  if (!gauge) return "Not one of Aero's pools on Base";
  if (!routable(gauge)) return "Doesn't take allocations";
  const ends = gauge.programs
    .filter(
      ({ rate, start, end }) => rate && start < market.time + hold && end > market.time && end < market.time + hold,
    )
    .map(({ end }) => end);
  const grew = Number(gauge.power) / Number(gauge.windows[HOURS].power) - 1;
  const flags = [
    isThin(gauge, HOURS) ? "Thin" : "",
    ends.length ? `Incentives end in ${until(Math.min(...ends) - market.time)}` : "",
    grew > 0.25 ? `${fraction(grew)} more sAERO weight than ${SPAN} ago` : "",
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
  if (!rows.length) return [false, "Show more pools, then give one a share."];
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
      `${aero.gaugeAt(market, closed.gauge)?.name ?? short(closed.gauge)} doesn't take allocations: set its share to 0%.`,
    ];
  return [
    true,
    `Replaces the allocation of ${stakeName(stake, stake.id)} on Base, which then can't change for ${hoursWords(market.cooldown)}.`,
  ];
}

export function drawAero(): void {
  const got = data.market();
  const stakes = data.ownStakes().value ?? [];
  const stake = stakeFor(stakes);
  // Kept once shown, so that the stake doesn't change under the user as locks start and end.
  if (stake) plan.stake = stake.id;
  const amount = stake ? wholeOf(aero.budgetOf(stake)) : plan.amount;
  drawControls(stakes, stake);
  drawRecord(got, amount, stake);
  drawAllocation(got, amount, stake, stakes);
  list(
    $("[data-list=contract]", aeroView),
    // The contract that allocating calls.
    [["Voter contract", config.AERO_VOTER]] as const,
    ([name]) => name,
    (row, [name, address]) => fill(row, { name, address: { address } }),
  );
}

function drawControls(stakes: Stake[], stake: Stake | undefined): void {
  const lock = stake && blockedPhrase(stake);
  fill(aeroView, {
    "stake-row": stakes.length ? true : null,
    "stake-link": stake ? { href: hrefOf({ view: "stake", id: stake.id }), text: "Its allocation now" } : null,
    "stake-lock": lock ? capitalized(lock) : null,
    "amount-row": stakes.length ? null : true,
    "lock-hours": hoursWords(cooldownOf()),
  });
  list(
    $("[data-list=stake-option]", aeroView),
    bySize(stakes),
    ({ id }) => String(id),
    (option, each) => {
      fill(option, { name: optionWords(each) });
      (option as HTMLOptionElement).value = String(each.id);
    },
  );
  $<HTMLSelectElement>("[data-action=aero-stake]", aeroView).value = stake ? String(stake.id) : "";
  $<HTMLInputElement>("[data-action=aero-again]", aeroView).checked = plan.again;
  $<HTMLInputElement>("[data-action=aero-blue]", aeroView).checked = plan.blueChips;
}
// Draws both strategies, with their other settings from `strategy`. `apr(i)` is what strategy `i` would have earned
// over the record.
function drawStrategies(strategy: aero.Strategy, apr: (i: number) => Value): void {
  list(
    $("[data-list=strategy]", aeroView),
    STRATEGIES,
    ({ id }) => id,
    (label, { leaders, name }, i) => {
      const input = $<HTMLInputElement>("input", label);
      input.value = String(leaders);
      input.checked = strategy.leaders === leaders;
      fill(label, { name, words: poolsWords({ ...strategy, leaders }), apr: apr(i) });
    },
  );
}
// Says that the record picks without hindsight.
const introOf = ({ again }: aero.Strategy): string =>
  again
    ? `Each strategy picked again every ${hoursWords(aero.STEP)}, from only what was known then.`
    : `Each strategy picked once, ${RECORD_DAYS} days ago, from only what was known then.`;

// Keeps the last result of `make` and reuses it while the arguments are the same values or objects.
function lastOf<A extends unknown[], R>(make: (...args: A) => R): (...args: A) => R {
  let last: { args: A; value: R } | undefined;
  return (...args) => {
    if (last && args.length === last.args.length && args.every((arg, i) => arg === last!.args[i])) return last.value;
    last = { args, value: make(...args) };
    return last.value;
  };
}
// The record's lines, worked out again only when their inputs change, not on every render.
const strategyPast = lastOf(aero.mergePast);
const pilotPast = lastOf(aero.mergePast);
// Both strategies' lines, in the order of `STRATEGIES`, so that each strategy can show what it earned.
const strategyLines = lastOf(
  (
    market: Market,
    past: aero.Past,
    count: number,
    hours: Hours,
    again: boolean,
    blueChips: boolean,
    held: Held,
  ): Paid[][] =>
    STRATEGIES.map(({ leaders }) =>
      aero.strategySteps(market, past, { count, hours, again, blueChips, leaders }, held),
    ),
);
const averageLine = lastOf((market: Market, then: aero.Then | undefined) =>
  aero.averageSteps(market, market.past, then),
);
const customLine = lastOf((market: Market, rows: Part[], held: Held) =>
  aero.customSteps(market, market.past, holdingsOf(rows, market), held),
);
const pilotLine = lastOf((market: Market, found: data.AutopilotRecord | null, held: Held) =>
  found ? aero.movedSteps(market, pilotPast(market.past, found.past), found.moves, held) : [],
);
const heldAs = lastOf((amount: number, then: aero.Then | undefined, own: aero.Move[] | undefined): Held => ({
  amount,
  then,
  own,
}));
// A stake's current allocation, used in place of its moves when they could not be read.
const stillOf = lastOf((stake: Stake): aero.Move[] => [{ at: stake.lastAllocated, allocations: stake.allocations }]);
// The reads behind the last record drawn in full. While a new hour's reads load, the record is drawn from these, with
// the settings as they are now, instead of going blank. A stake's own moves can't stand in for another stake's.
let basis:
  | {
      market: Market;
      past: aero.Past;
      then: aero.Then | undefined;
      own: aero.Move[] | undefined;
      record: Got<data.AutopilotRecord | null>;
      stake?: bigint;
    }
  | undefined;
const waiting = (got: Got<unknown>): boolean => got.value === undefined && !got.failed;

function drawRecord(got: Got<Market>, amount: number, stake: Stake | undefined): void {
  const chosen = strategyOf(got.value);
  const extra = andThen(got, (found) => data.pastFor(aero.timesFor(found, chosen.hours)));
  fill(aeroView, { "record-intro": introOf(chosen) });
  // Past prices. When they can't be read, the record uses today's prices.
  const pricing = andThen(got, () => data.pricesThen());
  // The stake's own weight is already in the pools it was in, so it is not added there again.
  const moves: Got<aero.Move[] | null> = stake ? data.stakeMoves(stake) : { value: null };
  if (got.value && extra.value && !waiting(pricing) && !waiting(moves))
    basis = {
      market: got.value,
      past: extra.value,
      then: pricing.value,
      own: moves.value ?? (stake && moves.failed ? stillOf(stake) : undefined),
      record: data.autopilotRecord(),
      stake: stake?.id,
    };
  if (!basis || basis.stake !== stake?.id) {
    drawStrategies(chosen, () => (extra.failed ? "–" : undefined));
    return void fill(aeroView, { plan: stateOf(extra.value ? {} : extra) });
  }
  const { market, past, then, own, record } = basis;
  const held = heldAs(amount, then, own);
  const { count: top, hours, again, blueChips } = chosen;
  const strategies = strategyLines(market, strategyPast(market.past, past), top, hours, again, blueChips, held);
  drawStrategies(chosen, (i) => {
    const found = aero.aprOver(strategies[i]!);
    return found ? aprWords(found.apr, found.priced) : "–";
  });
  const custom = plan.rows && customLine(market, plan.rows, held);
  const average = averageLine(market, then);
  const pilot: Got<Paid[]> = andThen(record, (found) => ({ value: pilotLine(market, found, held) }));
  fill(aeroView, { plan: { state: "ready" } });
  const who = stake ? stakeName(stake, stake.id) : wholePower(amount);
  // The APR, and what the amount or stake would have earned a day, over the same steps.
  const figure = (steps: Paid[]) => {
    const found = aero.aprOver(steps);
    return found ? `${aprWords(found.apr, found.priced)} APR` : "–";
  };
  const daily = (steps: Paid[]) => {
    const found = aero.aprOver(steps);
    return amount > 0 && found
      ? `${perDay((found.total * amount) / aero.PER, found.priced, market)} a day for ${who}`
      : null;
  };
  const lines: Line[] = [
    ...STRATEGIES.map(({ id, name, color }, i) => {
      const steps = strategies[i]!;
      return { id, name, color, steps, apr: figure(steps), note: daily(steps) };
    }),
    {
      id: "pilot",
      name: (record.value && autopilotOf(record.value.stake)?.name) ?? AUTOPILOTS[0]!.name,
      color: "var(--series-2)",
      steps: pilot.value ?? [],
      apr: shown(pilot, figure),
      note: shown(pilot, daily),
    },
    { id: "average", name: "Base average", color: "var(--quiet)", steps: average, apr: figure(average), note: null },
    ...(custom
      ? [
          {
            id: "custom",
            name: "Custom allocation",
            color: "var(--ink)",
            dashed: true,
            steps: custom,
            apr: figure(custom),
            note: "in hindsight",
          },
        ]
      : []),
  ];
  drawLines(lines);
  const cell = (step: Paid | undefined) => (step?.paid ? aprAt(step.paid.total, step.paid.priced, step.prices) : "–");
  list(
    $("[data-list=step]", aeroView),
    lines[0]!.steps,
    ({ from }) => String(from),
    (tr, _, k) =>
      fill(tr, {
        when: stepWords(k),
        custom: null,
        ...Object.fromEntries(lines.map(({ id, steps }) => [id, cell(steps[k])])),
        pilot: shown(pilot, (steps) => cell(steps[k])),
      }),
  );
  fill(aeroView, {
    "custom-head": custom ? true : null,
    "record-note": then ? null : "Valued at today's prices: the prices then could not be read.",
  });
}

// A line of the record, with its tile. `steps` are newest first. The chart puts the oldest on the left.
type Line = { id: string; name: string; color: string; dashed?: boolean; steps: Paid[]; apr: Value; note: Value };
// Draws the tiles, the chart and its legend, in the order of `lines`. The first line is drawn on top.
function drawLines(lines: Line[]): void {
  list(
    $("[data-list=tile]", aeroView),
    lines,
    ({ id }) => id,
    (tile, { name, apr, note }) => fill(tile, { name, apr, note }),
  );
  const series: Series[] = lines.map(({ id, name, color, dashed, steps }) => ({
    id,
    name,
    color,
    dashed,
    values: Array.from({ length: aero.PICKS }, (_, i) => {
      const step = steps[aero.PICKS - 1 - i];
      return step?.paid && aero.aprOf(step.paid.total, step.prices);
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

// What `rows` would earn for `amount` sAERO if the window's revenue came again. If the stake is in pools now, also what
// those pools would earn for what it holds in them.
function projectedWords(
  market: Market,
  next: (gauge: Gauge) => aero.Paying | undefined,
  rows: Part[],
  amount: number,
  stake: Stake | undefined,
): string | null {
  if (!(amount > 0)) return null;
  const mine = placesOf(stake);
  const then = aero.heldOver(holdingsOf(rows, market), next, amount, mine.size ? mine : undefined);
  if (!then) return null;
  const words = (found: aero.Per10k, of: number) =>
    `${apr(found.total, found.priced, market)} APR, ${perDay((found.total * of) / aero.PER, found.priced, market)} a day`;
  const held = [...mine.values()].reduce((sum, each) => sum + each, 0);
  const current =
    held > 0
      ? aero.heldOver(
          [...mine].map(([gauge, each]) => ({ gauge: aero.gaugeAt(market, gauge as Address), weight: each / held })),
          next,
          held,
          mine,
        )
      : undefined;
  const who = stake ? stakeName(stake, stake.id) : wholePower(amount);
  return `If the last ${SPAN} came again: ${words(then, amount)} for ${who}${current ? `, against ${words(current, held)} in its current pools` : ""}.`;
}
const AUTOMATIC = "Nothing happens automatically: an allocation stays as it is until you change it.";

function drawAllocation(got: Got<Market>, amount: number, stake: Stake | undefined, stakes: Stake[]): void {
  const market = got.value;
  if (!market) return void fill(aeroView, { picks: stateOf(got) });
  const hold = market.cooldown;
  const mine = placesOf(stake);
  // The stake's sAERO leaves the pools it is in now.
  const leaving = mine.size ? mine : undefined;
  const ahead = new Map(market.gauges.map((gauge) => [gauge, aero.paysNext(gauge, HOURS, market, hold)]));
  const next = (gauge: Gauge) => ahead.get(gauge);
  const strategy = strategyOf(market);
  const candidates = aero.candidatesOf(
    market,
    strategy,
    (gauge) => {
      const paying = next(gauge);
      return paying && { accrued: gauge.windows[HOURS], paying };
    },
    leaving,
  );
  const picks = aero.picksOf(candidates, strategy, amount);
  fill(aeroView, { picks: stateOf(got) });
  const rows = (drawn = plan.rows ?? ruleRows(picks));
  const total = totalOf(rows);
  const expected = aero.heldOver(holdingsOf(rows, market), next, amount, leaving);
  const inRows = new Set(rows.map(({ gauge }) => key(gauge)));
  // The pools "Show more pools" adds: those `eligible` for the strategy and not shown yet, best paying first. Unlike
  // the strategy, this doesn't leave out thin or unpriced pools.
  const pays = (gauge: Gauge) => {
    const found = next(gauge);
    return found ? aero.totalOf(found) : -1;
  };
  const more = new Set(plan.more);
  nextPools = market.gauges
    .filter(
      (gauge) => aero.eligible(gauge, strategy) && !inRows.has(key(gauge.address)) && !more.has(key(gauge.address)),
    )
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
  fill(aeroView, {
    "share-total": fraction(total / 100, true),
    "total-amount": amount ? compact(BigInt(Math.round((amount * total) / 100)) * 10n ** 18n) : "–",
    "total-per": expected ? apr(expected.total, expected.priced, market) : "–",
    more: nextPools.length ? true : null,
    scale: (!whole(total) && total > 0) || null,
    edited: plan.rows ? true : null,
    current: mine.size ? true : null,
    "allocate-why": words,
    "plan-pay": projectedWords(market, next, rows, amount, stake),
    "plan-auto":
      plan.again && !plan.rows
        ? `Nothing happens automatically: to follow this strategy, allocate again every ${hoursWords(aero.STEP)}.`
        : AUTOMATIC,
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
      projectedWords(
        market,
        (gauge) => aero.paysNext(gauge, HOURS, market, market.cooldown),
        rows,
        wholeOf(budget),
        stake,
      ) ?? "",
      stake.idle ? `Its ${power(stake.idle)} not yet on any chain moves onto Base too.` : "",
      stake.elsewhere ? `Its ${power(stake.elsewhere)} on other chains isn't affected.` : "",
      run ? "Simulated on Base: it succeeds." : "Base couldn't simulate it, so your wallet may warn you.",
      AUTOMATIC,
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
  // A record needs every gauge's snapshot from when the stake allocated, and an allocation held for `SHORTEST` or more.
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
  const paid = market && aero.paidBy(shares, market, HOURS);
  const average = market && aero.averageOver(market, HOURS);
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
          ({ average }) =>
            `fees since ${utc(stake.lastAllocated)} · Base average fees ${apr(average.fees, true, market!)}`,
        ),
    paid: !market ? undefined : paid ? `${apr(paid.value, paid.priced, market)} APR` : "Not enough history",
    "paid-note": !market
      ? undefined
      : paid
        ? `last ${SPAN}, with the incentives running now · Base average ${apr(average!.total, true, market)}`
        : null,
    "window-head": `Last ${SPAN}`,
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
      const window = gauge && market && aero.per10k(gauge, HOURS, market.time, market.prices);
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
  const paid = aero.per10k(gauge, HOURS, market.time, market.prices);
  fill(poolView, {
    status: routable(gauge)
      ? status("running", "Takes allocations")
      : status("stopped", "Pays nothing", gauge.activated ? ": its emissions cap is zero" : ": not activated"),
    power: compact(gauge.power),
    thin: isThin(gauge, HOURS) ? "Thin: one allocation changes what each sAERO earns" : null,
    paid: paid ? `${apr(paid.total, paid.priced, market)} APR` : "Not enough history",
    "paid-note": `last ${SPAN}`,
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
        window: WINDOW[hours],
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
// The table updates on each keystroke. The box is marked invalid only when the user leaves it or presses Enter.
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
actions["aero-again"] = (el) => {
  plan.again = (el as HTMLInputElement).checked;
  render();
};
actions["aero-strategy"] = (el) => {
  plan.leaders = (el as HTMLInputElement).value === "true";
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
// A share updates on each keystroke. Its box is marked invalid only when the user leaves it or presses Enter.
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
