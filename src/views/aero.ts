import { zeroAddress } from "viem";
import * as aero from "../aero.ts";
import { WINDOWS, isThin, routable, type Gauge, type Hours, type Market, type Pending, type Stake } from "../aero.ts";
import { andThen, type Got } from "../cache.ts";
import * as config from "../config.ts";
import { AUTOPILOTS, BASESCAN, PAYMENTS_MODULE } from "../config.ts";
import * as data from "../data.ts";
import {
  compact,
  count,
  date,
  day,
  figure,
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
import { now, same } from "../rpc.ts";
import { actions, render, state } from "../state.ts";
import { $, fill, link, list, shown, stateOf, status, type Value } from "../ui.ts";

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
const WINDOW: Record<Hours, { last: string; head: string; over: string; name: string }> = {
  24: { last: "last 24 h", head: "Last 24 h", over: "24 hours", name: "24 hours" },
  48: { last: "last 48 h", head: "Last 48 h", over: "48 hours", name: "48 hours" },
  168: { last: "last 7 days", head: "Last 7 days", over: "seven days", name: "7 days" },
};

// To the cent, and "At least" when it leaves out tokens without a price.
const perDay = (value: number, priced: boolean, market: Market): string =>
  money(moneyAt(value, market.prices, !priced), true);
// In a tile, "At least" may go above the figure, which stays whole.
const tileMoney = ({ value, priced }: aero.Yield, market: Market): string =>
  `${priced ? "" : "At least "}${money(moneyAt(value, market.prices))}`;
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
    fees: shown(got, () => tileMoney(totals!.fees, market!)),
    incentives: shown(got, () => tileMoney(totals!.incentives, market!)),
    cooldown: shown(got, () => until(market!.cooldown)),
    "max-gauges": shown(got, () => String(market!.maxGauges)),
  });
  drawStakes(market);
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
