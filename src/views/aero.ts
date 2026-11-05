import { zeroAddress, type Address } from "viem";
import * as aero from "../aero.ts";
import { WINDOWS, isThin, routable, type Gauge, type Hours, type Market, type Pending, type Stake } from "../aero.ts";
import { andThen, type Got } from "../cache.ts";
import * as config from "../config.ts";
import { AUTOPILOTS, BASESCAN, PAYMENTS_MODULE } from "../config.ts";
import * as data from "../data.ts";
import {
  compact,
  count,
  listWords,
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
  versusAverage,
} from "../format.ts";
import { key } from "../prices.ts";
import { hrefOf } from "../routes.ts";
import { now, same, simulate } from "../rpc.ts";
import { actions, render, state } from "../state.ts";
import {
  $,
  asWritten,
  busy,
  enable,
  fill,
  fromTemplate,
  link,
  list,
  shown,
  stateOf,
  status,
  type Value,
} from "../ui.ts";
import type { Slip } from "../wallet.ts";
import { openReview } from "./review.ts";

const aeroView = $('[data-view="aero"]');
const stakeView = $('[data-view="stake"]');
const poolView = $('[data-view="pool"]');

// As the visitor last set them. `all` shows every pool, not only the first `LIMIT`.
const controls: { hours: Hours; amount: number; thin: boolean; all: boolean } = {
  hours: 48,
  amount: 0,
  thin: false,
  all: false,
};
const LIMIT = 20;
// A shorter record says nothing.
const SHORTEST = 6 * 3_600;
const STEP_DAYS = aero.STEP / aero.DAY;
const WINDOW: Record<Hours, { last: string; head: string; over: string; name: string }> = {
  48: { last: "last 48 h", head: "Last 48 h", over: "48 hours", name: "48 hours" },
  96: { last: "last 4 days", head: "Last 4 days", over: "four days", name: "4 days" },
  192: { last: "last 8 days", head: "Last 8 days", over: "eight days", name: "8 days" },
};

// To the cent, and "At least" when it leaves out tokens without a price.
const perDay = (value: number, priced: boolean, market: Market): string =>
  money(moneyAt(value, market.prices, !priced), true);
// A tile's total leaves out what a few small pools pay in tokens without a price, which its note says.
const leftOut = (note: string, left: number | undefined, what: string): string =>
  left ? `${note} · ${count(left, "pool's", "pools'")} unpriced ${what} left out` : note;
const sAero = (amount: bigint): string => `${compact(amount)} sAERO`;
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
function placeWords(stake: Stake): string {
  const pools = poolsIn(stake);
  return [
    stake.onBase || pools ? `${sAero(stake.onBase)} on Base in ${count(pools, "pool", "pools")}` : "None on Base",
    ...(stake.idle ? [`${sAero(stake.idle)} not allocated`] : []),
    ...(stake.elsewhere ? [`${sAero(stake.elsewhere)} on other chains`] : []),
  ].join(" · ");
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

export function drawAero(): void {
  const got = data.market();
  const market = got.value;
  const totals = market && aero.totalsOf(market);
  const average = market && aero.averageOver(market, controls.hours);
  fill(aeroView, {
    "hold-time": market ? hoursWords(market.cooldown) : true,
    average: shown(got, () => money(moneyAt(average!.total, market!.prices), true)),
    "average-note": `/ 10k sAERO a day, ${WINDOW[controls.hours].last}`,
    allocated: shown(got, () => sAero(totals!.power)),
    "allocated-note": shown(got, () => `in ${count(market!.gauges.length, "pool", "pools")}`),
    fees: shown(got, () => money(moneyAt(totals!.fees.value, market!.prices))),
    "fees-note": leftOut("a day to allocators, last 48 h", totals?.fees.left, "fees"),
    incentives: shown(got, () => money(moneyAt(totals!.incentives.value, market!.prices))),
    "incentives-note": leftOut("a day, streaming now", totals?.incentives.left, "streams"),
    cooldown: shown(got, () => until(market!.cooldown)),
    "max-gauges": shown(got, () => String(market!.maxGauges)),
  });
  drawStakes(market);
  drawPlan(got);
  drawAutopilots(market, average);
  drawPools(got);
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

function drawStakes(market: Market | undefined): void {
  const got = data.ownStakes();
  const stakes = got.value ?? [];
  const pending = stakes.length ? data.pending(stakes) : { value: new Map<bigint, Pending>() };
  fill(aeroView, { stakes: stateOf(got, !stakes.length) });
  list(
    $("[data-list=stake]", aeroView),
    stakes,
    ({ id }) => String(id),
    (li, stake) =>
      fill(li, {
        link: { href: hrefOf({ view: "stake", id: stake.id }), text: stakeName(stake, stake.id) },
        lock: `${sAero(stake.amount)} · ${lockWords(stake)}`,
        place: placeWords(stake),
        hold: holdNode(stake, market),
        pending: pendingWords(stake, pending, market),
        approved: approvalNode(stake),
      }),
  );
}

// The allocation being drawn up, as the visitor last set it: `rows` undefined follows the suggestion, the rule's
// picks; `stake` undefined is the wallet's first; `amount` counts only without a stake.
type Part = { gauge: Address; percent: number };
const plan: { count: number; amount: number; stake: bigint | undefined; rows: Part[] | undefined } = {
  count: 10,
  amount: 0,
  stake: undefined,
  rows: undefined,
};
// The rows as last drawn, which the actions edit.
let drawn: Part[] = [];
const wholeOf = (amount: bigint): number => Number(amount) / 1e18;
const wholeSAero = (amount: number): string => sAero(BigInt(Math.round(amount)) * 10n ** 18n);
const signed = (ratio: number): string =>
  Number.isFinite(ratio) ? `${ratio >= 1 ? "+" : "−"}${fraction(Math.abs(ratio - 1), true)}` : "–";
const totalOf = (rows: Part[]): number => rows.reduce((sum, { percent }) => sum + percent, 0);
// Within a twentieth of a point of 100%, the shares are scaled to it when sent.
const whole = (total: number): boolean => Math.abs(total - 100) < 0.05;
const ruleRows = (picks: aero.Pick[]): Part[] =>
  picks.map(({ gauge, weight }) => ({ gauge: gauge.address, percent: weight * 100 }));
function edit(change: (rows: Part[]) => Part[]): void {
  plan.rows = change(plan.rows ?? drawn);
  render();
}

const stakeFor = (stakes: Stake[]): Stake | undefined => stakes.find(({ id }) => id === plan.stake) ?? stakes[0];
// A stake's sAERO in each pool, in whole sAERO; all it has allocated on Base; and its holdings, the zero gauge's
// included.
function placesOf(stake: Stake | undefined, market: Market) {
  const mine = new Map<string, number>();
  const allocations = stake?.allocations ?? [];
  const allocated = allocations.reduce((sum, { amount }) => sum + wholeOf(amount), 0);
  for (const { gauge, amount } of allocations)
    if (!aero.isIdleGauge(gauge)) mine.set(key(gauge), (mine.get(key(gauge)) ?? 0) + wholeOf(amount));
  const holdings: aero.Holding[] = allocated
    ? allocations.map(({ gauge, amount }) => ({
        gauge: aero.gaugeAt(market, gauge),
        weight: wholeOf(amount) / allocated,
      }))
    : [];
  return { mine, allocated, holdings };
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
    grew > 0.25 ? `${fraction(grew)} more sAERO than ${WINDOW[controls.hours].over} ago` : "",
  ].filter(Boolean);
  return flags.length ? flags.join(" · ") : null;
}
function paidInWords(flows: aero.Flow[]): string {
  const priced = flows.filter(({ value }) => value !== undefined && value > 0);
  const sum = priced.reduce((all, { value }) => all + value!, 0);
  const unpriced = flows.length - priced.length;
  const top = priced.slice(0, 3).map(({ token, value }) => `${token!.symbol} (${Math.round((value! / sum) * 100)}%)`);
  return [
    top.length ? `Mostly ${listWords(top)}` : "",
    unpriced ? `${count(unpriced, "token has", "tokens have")} no price` : "",
  ]
    .filter(Boolean)
    .join(" · ");
}
function blockedWords(blocked: aero.Blocked, stake: Stake): string {
  const name = stakeName(stake, stake.id);
  switch (blocked.why) {
    case "ended":
      return `The lock of ${name} has ended, so it can't be allocated.`;
    case "empty":
      return `${name} has nothing to allocate on Base: all its sAERO is on other chains.`;
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
  if (!whole(total))
    return [false, `The shares add up to ${fraction(total / 100, true)}: make them add up to 100%, or scale them.`];
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
    `Allocates the ${sAero(aero.budgetOf(stake))} of ${stakeName(stake, stake.id)} on Base to ${included.length === 1 ? "this pool" : `these ${count(included.length, "pool", "pools")}`}, replacing its current allocation. It can't be changed again for ${hoursWords(market.cooldown)} after that.`,
  ];
}

function drawPlan(got: Got<Market>): void {
  const market = got.value;
  const stakes = data.ownStakes().value ?? [];
  const stake = stakeFor(stakes);
  fill(aeroView, { "stake-row": stakes.length ? true : null, "amount-row": stakes.length ? null : true });
  list(
    $("[data-list=stake-option]", aeroView),
    stakes,
    ({ id }) => String(id),
    (option, each) => {
      fill(option, { name: `${stakeName(each, each.id)} · ${sAero(aero.budgetOf(each))} on Base` });
      (option as HTMLOptionElement).value = String(each.id);
    },
  );
  $<HTMLSelectElement>("[data-action=aero-stake]", aeroView).value = stake ? String(stake.id) : "";
  $<HTMLSelectElement>("[data-action=aero-count]", aeroView).value = String(plan.count);
  if (!market) return void fill(aeroView, { plan: stateOf(got) });
  const hold = market.cooldown;
  const amount = stake ? wholeOf(aero.budgetOf(stake)) : plan.amount;
  const { mine, allocated, holdings: current } = placesOf(stake, market);
  // The stake's sAERO leaves the pools it is in now.
  const leaving = mine.size ? mine : undefined;
  const ahead = new Map(market.gauges.map((gauge) => [gauge, aero.paysNext(gauge, controls.hours, market, hold)]));
  const next = (gauge: Gauge) => ahead.get(gauge);
  const picks = aero.picksOf(
    market.gauges.filter(routable).flatMap((gauge) => {
      const paying = next(gauge);
      return paying ? [{ gauge, paying }] : [];
    }),
    Math.min(plan.count, market.maxGauges),
  );
  fill(aeroView, { plan: stateOf(got, !picks.length && !plan.rows) });
  const rows = (drawn = plan.rows ?? ruleRows(picks));
  const total = totalOf(rows);
  const chosen = rows.map(({ gauge, percent }) => ({
    address: gauge,
    gauge: aero.gaugeAt(market, gauge),
    weight: percent / 100,
  }));
  const expected = aero.heldOver(chosen, next, amount, leaving);
  const average = aero.marketOver(market.gauges, next);
  const now = current.length ? aero.heldOver(current, next) : undefined;
  const overHold = (per10k: number, of: number) => (per10k * of * hold) / aero.PER / aero.DAY;
  const gain = expected && now ? overHold(expected.total, amount) - overHold(now.total, allocated) : undefined;
  const moved = leaving
    ? 1 - chosen.reduce((sum, { address, weight }) => sum + Math.min(weight, (mine.get(key(address)) ?? 0) / amount), 0)
    : undefined;
  const paying = chosen.flatMap(({ gauge, weight }) => {
    const found = gauge && next(gauge);
    return gauge && found ? [{ gauge, weight, paying: found }] : [];
  });
  const paidIn = aero.paidIn(paying, amount, leaving);
  fill(aeroView, {
    "next-label": "Expected",
    next: expected ? perDay(expected.total, expected.priced, market) : "Not enough history",
    "next-note": expected
      ? [
          `per 10k sAERO a day over the next ${hoursWords(hold)}`,
          versusAverage(expected.total / average.total),
          expected.incentives / expected.total >= 0.005
            ? `${fraction(expected.incentives / expected.total)} of it from scheduled incentives`
            : "",
        ]
          .filter(Boolean)
          .join(" · ")
      : null,
    "yours-tile": amount > 0 && expected ? true : null,
    "yours-label": asWritten(stake ? stakeName(stake, stake.id) : wholeSAero(amount)),
    yours: expected ? money(moneyAt(overHold(expected.total, amount), market.prices, !expected.priced)) : null,
    "yours-note": [
      `expected over the next ${hoursWords(hold)}`,
      gain === undefined
        ? ""
        : `${money(moneyAt(Math.abs(gain), market.prices))} ${gain >= 0 ? "more" : "less"} than the current allocation`,
    ]
      .filter(Boolean)
      .join(" · "),
    "paid-in": count(paidIn.length, "token", "tokens"),
    "paid-in-note": paidInWords(paidIn),
    "plan-note": [
      `Expected earnings assume each pool's fees over the last ${WINDOW[controls.hours].over} repeat over the next ${hoursWords(hold)}, plus the incentives already scheduled, at current prices.`,
      amount
        ? `They take into account that adding ${stake ? `the ${sAero(aero.budgetOf(stake))} of ${stakeName(stake, stake.id)}` : wholeSAero(amount)} to a pool lowers what each sAERO in it earns.`
        : "Enter an amount to see how adding it to each pool lowers what each sAERO in it earns.",
      moved === undefined ? "" : `${fraction(moved)} of it would move to different pools.`,
      stake?.elsewhere ? `The ${sAero(stake.elsewhere)} it has on other chains isn't affected.` : "",
    ]
      .filter(Boolean)
      .join(" "),
  });
  list(
    $("[data-list=pick]", aeroView),
    rows,
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
      $("button", tr).setAttribute("aria-label", `Remove ${name}`);
      fill(tr, {
        pool: gauge ? { href: hrefOf({ view: "pool", gauge: gauge.address }), text: name } : name,
        note: row.percent > 0 ? flagsOf(gauge, market, hold) : "Not included at 0%",
        amount: amount ? compact(BigInt(Math.round(amount * weight)) * 10n ** 18n) : "–",
        pays: found ? money(moneyAt(aero.totalOf(found), market.prices, !all?.priced)) : "–",
        per: here ? perDay(here.total, here.priced, market) : "Not enough history",
      });
    },
  );
  const inRows = new Set(rows.map(({ gauge }) => key(gauge)));
  const full = rows.length >= market.maxGauges;
  const addable = full
    ? []
    : market.gauges
        .filter((gauge) => routable(gauge) && !inRows.has(key(gauge.address)))
        .map((gauge) => {
          const found = next(gauge);
          return { gauge, pays: found ? aero.totalOf(found) : -1 };
        })
        .sort((a, b) => b.pays - a.pays);
  list(
    $("[data-list=add-option]", aeroView),
    [undefined, ...addable],
    (each) => each?.gauge.address ?? "none",
    (option, each) => {
      fill(option, {
        name: each
          ? `${each.gauge.name}${each.pays >= 0 ? ` · ${money(moneyAt(each.pays, market.prices))} a day` : ""}`
          : full
            ? `At most ${market.maxGauges} pools`
            : "Add a pool…",
      });
      (option as HTMLOptionElement).value = each?.gauge.address ?? "";
    },
  );
  const adder = $<HTMLSelectElement>("[data-action=aero-add]", aeroView);
  adder.value = "";
  adder.disabled = full;
  const [can, words] = allocateWords(stake, stakes, rows, market);
  enable($<HTMLButtonElement>("[data-action=aero-allocate]", aeroView), can);
  fill(aeroView, {
    "share-total": fraction(total / 100, true),
    "total-amount": amount ? compact(BigInt(Math.round((amount * total) / 100)) * 10n ** 18n) : "–",
    scale: (!whole(total) && total > 0) || null,
    rule: plan.rows ? true : null,
    current: mine.size ? true : null,
    "allocate-why": words,
  });
  drawVersus(market, picks, chosen, next, amount, leaving, stake, current);
  drawRecord(market, amount);
}

type Versus = {
  id: string;
  name: Value;
  note: string | null;
  holdings?: aero.Holding[];
  amount?: number;
  mine?: Map<string, number> | undefined;
};
function drawVersus(
  market: Market,
  picks: aero.Pick[],
  chosen: aero.Holding[],
  next: (gauge: Gauge) => aero.Paying | undefined,
  amount: number,
  leaving: Map<string, number> | undefined,
  stake: Stake | undefined,
  current: aero.Holding[],
): void {
  const pilots = (data.autopilots().value ?? []).flatMap((each) => {
    const pilot = autopilotOf(each);
    return pilot && each.id !== stake?.id ? [{ pilot, stake: each }] : [];
  });
  const rows: Versus[] = [
    ...(plan.rows ? [{ id: "choice", name: "Your choice", note: null, holdings: chosen, amount, mine: leaving }] : []),
    { id: "rule", name: `Suggested, top ${picks.length}`, note: null, holdings: picks, amount, mine: leaving },
    ...(stake && current.length
      ? [
          {
            id: "own",
            name: { href: hrefOf({ view: "stake", id: stake.id }), text: stakeName(stake, stake.id) },
            note: "Current allocation",
            holdings: current,
          },
        ]
      : []),
    ...pilots.map(({ pilot, stake: each }) => ({
      id: String(pilot.id),
      name: { href: hrefOf({ view: "stake", id: each.id }), text: pilot.name },
      note: null,
      holdings: aero.sharesOf(each, market).map(({ gauge, share }) => ({ gauge, weight: share })),
    })),
    { id: "market", name: "Base average", note: null },
  ];
  const lately = Object.fromEntries(
    WINDOWS.map((hours) => {
      const found = new Map(market.gauges.map((gauge) => [gauge, aero.paidLately(gauge, hours, market.prices)]));
      return [hours, (gauge: Gauge) => found.get(gauge)];
    }),
  ) as Record<Hours, (gauge: Gauge) => aero.Paying | undefined>;
  const cell = (row: Versus, payingOf: (gauge: Gauge) => aero.Paying | undefined): string => {
    if (!row.holdings) return perDay(aero.marketOver(market.gauges, payingOf).total, true, market);
    const found = aero.heldOver(row.holdings, payingOf, row.amount, row.mine);
    return found ? perDay(found.total, found.priced, market) : "–";
  };
  fill(aeroView, {
    "next-head": `Next ${hoursWords(market.cooldown)}, expected`,
    ...Object.fromEntries(WINDOWS.map((hours, i) => [`w${i}-head`, WINDOW[hours].head])),
  });
  list(
    $("[data-list=versus]", aeroView),
    rows,
    ({ id }) => id,
    (tr, row) =>
      fill(tr, {
        name: row.name,
        note: row.note,
        next: cell(row, next),
        ...Object.fromEntries(WINDOWS.map((hours, i) => [`w${i}`, cell(row, lately[hours])])),
      }),
  );
}

function drawRecord(market: Market, amount: number): void {
  const top = Math.min(plan.count, market.maxGauges);
  const periods: Got<aero.Period[]> = { value: aero.recordOf(market, market.past, top, amount) };
  const found = periods.value && aero.overall(periods.value);
  const priced = !!periods.value?.every(({ rule }) => !rule || rule.priced);
  fill(aeroView, {
    record: stateOf(periods, !found),
    followed: shown(periods, () => (found ? perDay(found.rule, priced, market) : "Not enough history")),
    "followed-note": shown(periods, () =>
      found
        ? [
            `per 10k sAERO a day over the last ${count(Math.round((found.to - found.from) / aero.DAY), "day", "days")}`,
            versusAverage(found.rule / found.market),
          ]
            .filter(Boolean)
            .join(" · ")
        : null,
    ),
    "record-note": shown(periods, () =>
      [
        `Every ${hoursWords(aero.STEP)}, counted back from the last whole hour, the suggestion is worked out again using only what was known at the time: each pool's fees over the ${hoursWords(aero.STEP)} before and the incentives running then.`,
        `Its pools are kept until the next time, since an allocation can't be changed for ${hoursWords(market.cooldown)}.`,
        "Everything is valued at current prices.",
        amount ? `Adding ${wholeSAero(amount)} to the pools is taken into account.` : "",
      ]
        .filter(Boolean)
        .join(" "),
    ),
  });
  list(
    $("[data-list=hold]", aeroView),
    periods.value ?? [],
    ({ from }) => String(from),
    (tr, { rule, market: base }, k) =>
      fill(tr, {
        when: k === 0 ? `Last ${STEP_DAYS} days` : `${k * STEP_DAYS}–${(k + 1) * STEP_DAYS} days ago`,
        rule: rule ? perDay(rule.total, rule.priced, market) : "–",
        market: perDay(base.total, true, market),
        difference: rule ? signed(rule.total / base.total) : "–",
      }),
  );
}

// Reads the stake again, simulates the allocation on Base, and opens it for review.
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
    says: `Allocates the ${sAero(budget)} of ${stakeName(stake, stake.id)} on Base to ${count(allotments.length, "pool", "pools")}, replacing its current allocation.`,
    on: "Aero's Voter",
    call: "allocate",
    fields: [
      { label: "sAERO", code: String(stake.id), description: stakeName(stake, stake.id) },
      ...(stake.idle
        ? [
            {
              label: "Onto Base",
              code: String(stake.idle),
              description: `${fixed(stake.idle, 18, 2)} sAERO not yet on any chain`,
            },
          ]
        : []),
      { label: "Chain", code: String(config.CHAIN_ID), description: "Base" },
      ...allotments.map(({ gauge, amount }, i) => ({
        label: `Pool ${i + 1}`,
        description: `${named(gauge)} · ${fixed(amount, 18, 2)} sAERO`,
        code: [gauge, String(amount)],
        tags: ["Gauge", "sAERO"],
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
    summary: `${stakeName(stake, stake.id)} will allocate its ${sAero(budget)} on Base to these pools:`,
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
      stake.idle ? `Its ${sAero(stake.idle)} not yet on any chain moves onto Base too.` : "",
      stake.elsewhere ? `Its ${sAero(stake.elsewhere)} on other chains isn't affected.` : "",
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

function drawAutopilots(market: Market | undefined, average: aero.Average | undefined): void {
  const got = data.autopilots();
  const pilots = (got.value ?? []).flatMap((stake) => {
    const pilot = autopilotOf(stake);
    return pilot ? [{ pilot, stake }] : [];
  });
  fill(aeroView, { autopilots: stateOf(got, !pilots.length) });
  list(
    $("[data-list=autopilot]", aeroView),
    pilots,
    ({ pilot }) => String(pilot.id),
    (li, { pilot, stake }) => {
      const paid = market && aero.paidBy(aero.sharesOf(stake, market), market, controls.hours);
      const versus = paid && average ? versusAverage(paid.value / average.total) : "";
      fill(li, {
        link: { href: hrefOf({ view: "stake", id: stake.id }), text: pilot.name },
        hold: holdNode(stake, market),
        amount: sAero(stake.amount),
        idle: stake.idle ? `${fraction(Number(stake.idle) / Number(stake.amount))} not allocated` : null,
        "on-base": sAero(stake.onBase),
        pools: count(poolsIn(stake), "pool", "pools"),
        paid: !market ? undefined : paid ? perDay(paid.value, paid.priced, market) : "Not enough history",
        versus: market ? [WINDOW[controls.hours].last, versus].filter(Boolean).join(" · ") : undefined,
      });
    },
  );
}

type Row = { gauge: Gauge; paid: aero.Per10k };
function drawPools(got: Got<Market>): void {
  const market = got.value;
  const all = market ? market.gauges.filter(routable) : [];
  const rows: Row[] = market
    ? all
        .filter((gauge) => controls.thin || !isThin(gauge, controls.hours))
        .flatMap((gauge) => {
          const paid = aero.per10k(gauge, controls.hours, market.time, market.prices, controls.amount);
          return paid ? [{ gauge, paid }] : [];
        })
        .sort((a, b) => b.paid.total - a.paid.total)
    : [];
  const thin = all.filter((gauge) => isThin(gauge, controls.hours)).length;
  const shownRows = controls.all ? rows : rows.slice(0, LIMIT);
  const closed = market ? market.gauges.length - all.length : 0;
  const unread = market?.unread.length ?? 0;
  const unknown = market?.unknown.length ?? 0;
  fill(aeroView, {
    pools: stateOf(got, !rows.length),
    "pools-count": market ? String(rows.length) : "",
    "more-row": rows.length > LIMIT || null,
    more: controls.all ? "Show fewer" : `Show all ${rows.length}`,
    "pools-note": market
      ? [
          `Fees each pool paid its sAERO over the ${WINDOW[controls.hours].over}, and the incentives it streams now, at the last half hour's prices.`,
          controls.amount ? `Your ${sAero(BigInt(Math.round(controls.amount)) * 10n ** 18n)} would share them.` : "",
          !controls.thin && thin
            ? `${count(thin, "thin pool", "thin pools")}, with less than 1M sAERO at either end or on average, not shown.`
            : "",
          closed ? `${count(closed, "pool takes", "pools take")} no allocation: a cap of zero, or not activated.` : "",
          unread ? `${count(unread, "pool", "pools")} could not be read.` : "",
          unknown
            ? `The pools of ${count(unknown, "gauge factory", "gauge factories")} this page does not know are left out.`
            : "",
          shownRows.some(({ paid }) => !paid.priced)
            ? "At least: some tokens it pays have no price, and count for nothing."
            : "",
        ]
          .filter(Boolean)
          .join(" ")
      : null,
  });
  list(
    $("[data-list=gauge]", aeroView),
    shownRows,
    ({ gauge }) => gauge.address,
    (tr, { gauge, paid }) =>
      fill(tr, {
        pool: { href: hrefOf({ view: "pool", gauge: gauge.address }), text: gauge.name },
        note: isThin(gauge, controls.hours) ? "Thin" : null,
        power: compact(gauge.power),
        fees: perDay(paid.fees, paid.priced, market!),
        incentives: paid.incentives ? perDay(paid.incentives, paid.priced, market!) : "–",
        total: perDay(paid.total, paid.priced, market!),
      }),
  );
  for (const select of aeroView.querySelectorAll<HTMLSelectElement>("[data-action=aero-window]"))
    select.value = String(controls.hours);
  $<HTMLInputElement>("[data-action=aero-thin]", aeroView).checked = controls.thin;
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
    "on-base": sAero(stake.onBase),
    pools: count(poolsIn(stake), "pool", "pools"),
    "idle-row": stake.idle ? true : null,
    idle: sAero(stake.idle),
    "elsewhere-row": stake.elsewhere ? true : null,
    elsewhere: sAero(stake.elsewhere),
    "pending-row": poolsIn(stake) ? true : null,
    pending: pendingWords(stake, pendingFor(stake), market),
    "owner-row": own ? null : true,
    owner: { address: stake.owner, text: pilot ? `${pilot.name}'s Relay` : short(stake.owner) },
    approval: approvalNode(stake, true),
    manage: own || null,
    record: poolsIn(stake) ? true : null,
    since: soon
      ? `Allocated ${until(held!)} ago`
      : shown(record, ({ earned }) => perDay(earned.value, earned.priced, market!)),
    "since-note": soon
      ? "Too soon for a record"
      : shown(record, ({ earned, average }) =>
          [`fees since ${utc(stake.lastAllocated)}`, versusAverage(earned.value / average.fees)]
            .filter(Boolean)
            .join(" · "),
        ),
    paid: !market ? undefined : paid ? perDay(paid.value, paid.priced, market) : "Not enough history",
    "paid-note": !market
      ? undefined
      : paid
        ? [`${WINDOW[controls.hours].last}, with live incentives`, versusAverage(paid.value / average!.total)]
            .filter(Boolean)
            .join(" · ")
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
        since: earned ? perDay(earned.value, earned.priced, market!) : "–",
        window: window ? perDay(window.total, window.priced, market!) : "–",
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
    power: sAero(gauge.power),
    thin: isThin(gauge, controls.hours) ? "Thin: one allocation changes what it pays" : null,
    paid: paid ? perDay(paid.total, paid.priced, market) : "Not enough history",
    "paid-note": `/ 10k sAERO a day, ${WINDOW[controls.hours].last}`,
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
        fees: found ? perDay(found.fees, found.priced, market) : "–",
        incentives: found?.incentives ? perDay(found.incentives, found.priced, market) : "–",
        total: found ? perDay(found.total, found.priced, market) : "Not enough history",
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
        fees: found ? perDay(found.value, found.priced, market) : "–",
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

actions["aero-window"] = (el) => {
  const hours = Number((el as HTMLSelectElement).value);
  controls.hours = WINDOWS.find((each) => each === hours) ?? 48;
  render();
};
// The table follows each keystroke; the box is marked invalid only when left or on Enter, not while typing.
function amountTyped(input: HTMLInputElement, done: boolean): void {
  const value = aero.amountOf(input.value);
  if (value === undefined) {
    if (done) input.setAttribute("aria-invalid", "true");
    return;
  }
  input.setAttribute("aria-invalid", "false");
  controls.amount = value;
  render();
}
const amountBox = $<HTMLInputElement>("[data-action=aero-amount]", aeroView);
amountBox.addEventListener("input", () => amountTyped(amountBox, false));
actions["aero-amount"] = () => amountTyped(amountBox, true);
actions["aero-count"] = (el) => {
  plan.count = Number((el as HTMLSelectElement).value) || 10;
  plan.rows = undefined;
  render();
};
actions["aero-stake"] = (el) => {
  const value = (el as HTMLSelectElement).value;
  plan.stake = value ? BigInt(value) : undefined;
  render();
};
const planBox = $<HTMLInputElement>("[data-action=aero-plan-amount]", aeroView);
function planTyped(done: boolean): void {
  const value = aero.amountOf(planBox.value);
  if (value === undefined) {
    if (done) planBox.setAttribute("aria-invalid", "true");
    return;
  }
  planBox.setAttribute("aria-invalid", "false");
  plan.amount = value;
  render();
}
planBox.addEventListener("input", () => planTyped(false));
actions["aero-plan-amount"] = () => planTyped(true);
// A share follows each keystroke; its box is marked invalid only when left.
$("[data-list=pick]", aeroView).addEventListener("input", (event) => {
  const input = event.target as HTMLInputElement;
  const gauge = input.closest<HTMLElement>("[data-key]")?.dataset.key;
  const value = aero.amountOf(input.value);
  if (input.dataset.action !== "aero-share" || !gauge || value === undefined) return;
  input.setAttribute("aria-invalid", "false");
  edit((rows) => rows.map((row) => (row.gauge === gauge ? { ...row, percent: value } : row)));
});
actions["aero-share"] = (el) => {
  const input = el as HTMLInputElement;
  input.setAttribute("aria-invalid", aero.amountOf(input.value) === undefined ? "true" : "false");
  render();
};
actions["aero-add"] = (el) => {
  const select = el as HTMLSelectElement;
  const gauge = select.value as Address;
  select.value = "";
  if (gauge) edit((rows) => [...rows, { gauge, percent: Math.max(0, 100 - totalOf(rows)) }]);
};
actions["aero-drop"] = (el) => {
  const gauge = el.closest<HTMLElement>("[data-key]")?.dataset.key;
  edit((rows) => rows.filter((row) => row.gauge !== gauge));
};
actions["aero-scale"] = () =>
  edit((rows) => {
    const total = totalOf(rows);
    return total > 0 ? rows.map((row) => ({ ...row, percent: (row.percent * 100) / total })) : rows;
  });
actions["aero-rule"] = () => {
  plan.rows = undefined;
  render();
};
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
actions["aero-thin"] = (el) => {
  controls.thin = (el as HTMLInputElement).checked;
  render();
};
actions["aero-more"] = () => {
  controls.all = !controls.all;
  render();
};
export function aeroLine(): Value {
  return shown(data.ownStakes(), (stakes) =>
    stakes.length
      ? `${count(stakes.length, "stake", "stakes")} · ${sAero(stakes.reduce((sum, { amount }) => sum + amount, 0n))}`
      : "No sAERO",
  );
}
