// Tests whether Aero stakes allocated better than chance, separately for which pools they chose (selection) and when
// they moved (timing). Reads data/*.json, written by the fetch scripts. Writes summary.md and strategies.csv to
// results/, or to the directory in OUT, relative to the current one. See README.md for the method.
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { AERO } from "../src/config.ts";
import { dataEnd, feeSeries, HOUR, load, type Allocations, type Gauges, type Snap, type Stakes } from "./common.ts";
import { bh, generator, mean, median, probit, scaledRanks, seedOf, spearman, variance } from "./stats.ts";

const COOLDOWN = 47; // hours
// Only strategies of at least this many sAERO, with at least this many hours in pools, are tested for selection. Dust
// stakes alone in an empty pool earn all its fees, at APRs of billions of percent, which says nothing about allocating.
const MIN_AMOUNT = 100;
const MIN_HOURS = 96;
const FDR = 0.1;
// A strategy is "thin" when it held more than this share of a pool's power.
const THIN = 0.25;
// A placebo only goes to a pool where its sAERO would be at most this share of the pool's power, or at most the share
// the strategy took in the pool it stands for, if that was more. Real stakes rarely take more than a quarter of a pool:
// 1% to 8% of entries, depending on size. Without this, a large strategy's placebos land in pools far too small for
// them and dilute themselves, which no real stake of that size does, and the strategy looks skilled for avoiding that.
// `CAP=0.01 OUT=research/results/strict node research/analyze.ts` runs the strict version.
const CAP = Number(process.env.CAP ?? 0.25);
if (!(CAP > 0 && CAP <= 1)) throw new Error(`CAP must be above 0 and at most 1, not ${process.env.CAP}.`);
const OUT = pathToFileURL(resolve(process.env.OUT ?? fileURLToPath(new URL("./results", import.meta.url))) + "/");
const SIMS = 1_000;
const MORE_SIMS = 20_000;
const HALF_SIMS = 500;

// ---------------------------------------------------------------------------------------------------------------------
// 0. Data, cut at the last hour that every file covers.
// ---------------------------------------------------------------------------------------------------------------------
const data = load<Gauges>("gauges.json");
const allocationFile = load<Allocations>("allocations.json");
const stakeFile = load<Stakes>("stakes.json");
const END = dataEnd(data, allocationFile);
if (stakeFile.at !== END)
  throw new Error("stakes.json is not as of the last hour of the other files. Run fetch-stakes.ts again.");
const hours = data.hours.filter((time) => time <= END);
const gauges = data.gauges;
const K = hours.length;
const J = gauges.length;
const T0 = hours[0]!;
const allocations = allocationFile.allocations.filter(({ time }) => time <= END);
const leftOut = allocationFile.allocations.length - allocations.length;
const priceOf = (address: string): number | undefined => data.prices[address.toLowerCase()];
const aeroPrice = priceOf(AERO)!;
// An allocation counts from the first whole hour after it, and so does the end of a stake.
const hourAfter = (time: number) => Math.min(K - 1, Math.max(0, Math.ceil((time - T0) / HOUR)));

// ---------------------------------------------------------------------------------------------------------------------
// 1. Each gauge's cumulative pay per sAERO, in dollars at today's prices, at every hour.
// ---------------------------------------------------------------------------------------------------------------------
// Y[j][k]: what one whole sAERO earned in gauge j from launch to hour k, fees and incentives. P[j][k]: its power then.
// T[j][k]: what all of its sAERO earned from hour k-1 to hour k. A stake that adds `a` sAERO then earns T / (P + a).
const Y: Float64Array[] = [];
const P: Float64Array[] = [];
const T: Float64Array[] = [];
const unpricedGauges = new Set<number>();
const paid = { fees: 0, incentives: 0 };
for (const [j, g] of gauges.entries()) {
  if (priceOf(g.token0.address) === undefined || priceOf(g.token1.address) === undefined) unpricedGauges.add(j);
  // ∫ dt / power, with power in whole sAERO: the supply accumulator is Σ seconds × 1e42 / power in 18-decimal units.
  const share = (k: number, snap: Snap | undefined, supply: bigint) => {
    if (!snap) return 0;
    const since = Math.max(0, hours[k]! - snap.ts);
    const grown = supply > 0n ? (BigInt(since) * 10n ** 42n) / supply : 0n;
    return Number(BigInt(snap.share) + grown) / 1e24;
  };
  const programs = g.programs.flatMap(({ token, rate, start, end }) => {
    const t = data.tokens[token];
    const price = priceOf(token);
    if (!t || price === undefined) {
      if (BigInt(rate) > 0n) unpricedGauges.add(j);
      return [];
    }
    return [{ start, end, perSecond: (Number(BigInt(rate)) / 1e18 / 10 ** t.decimals) * price }];
  });
  const [y, p, t] = [new Float64Array(K), new Float64Array(K), new Float64Array(K)];
  // Checkpoints after the last hour still say how the fees before it were spread.
  const fees = feeSeries(g, data.hours, data.prices);
  let [incentives, lastShare, lastFee] = [0, 0, 0];
  for (let k = 0; k < K; k++) {
    const supply = BigInt(g.supply[k]!);
    const snap = g.index[k] === "0" ? undefined : g.snaps[g.index[k]!];
    const s = share(k, snap, supply);
    const fee = fees[k]!;
    p[k] = Number(supply) / 1e18;
    if (k > 0) {
      // A program streams `perSecond` dollars to all the gauge's power. Over an hour, one sAERO gets perSecond × ∫ dt /
      // power, for the part of the hour it ran.
      const [from, to] = [hours[k - 1]!, hours[k]!];
      let perSecond = 0;
      for (const program of programs)
        perSecond +=
          (program.perSecond * Math.max(0, Math.min(to, program.end) - Math.max(from, program.start))) / HOUR;
      const added = perSecond * Math.max(0, s - lastShare);
      incentives += added;
      const power = Math.max(0, p[k - 1]!);
      paid.fees += (fee - lastFee) * power;
      paid.incentives += added * power;
    }
    [lastShare, lastFee] = [s, fee];
    y[k] = fee + incentives;
    if (k > 0) t[k] = (y[k]! - y[k - 1]!) * Math.max(0, p[k - 1]!);
  }
  Y.push(y);
  P.push(p);
  T.push(t);
}

const aprOf = (dollars: number, hoursHeld: number) => ((dollars / hoursHeld) * 24 * 365) / aeroPrice;

// ---------------------------------------------------------------------------------------------------------------------
// 2. Each stake's allocations, as spells of fixed pools, grouped into strategies.
// ---------------------------------------------------------------------------------------------------------------------
const indexOf = new Map(gauges.map((g, j) => [g.address, j]));
type Event = { k: number; js: number[]; amounts: number[] };
type Nft = { id: string; events: Event[]; endHour: number; key: string };
const byId = Map.groupBy(allocations, ({ id }) => id);
const nfts: Nft[] = [];
let [notGauges, allAllocated, ended] = [0, 0, 0];
for (const [id, list] of byId) {
  const stake = stakeFile.stakes[id];
  if (!stake) throw new Error(`Stake ${id} is not in stakes.json. Run fetch-stakes.ts again.`);
  // A stake stops earning when it is withdrawn, or when its lock ends.
  const endTime = Math.min(stake.withdrawn ?? Infinity, stake.permanent ? Infinity : stake.end);
  const endHour = endTime <= END ? hourAfter(endTime) : K - 1;
  // Allocations from the hour a stake ended are left out. A stake that is still on can allocate up to the last hour.
  const until = endTime <= END ? endHour : K;
  if (endTime <= END) ended++;
  const events = list
    .sort((a, b) => a.block - b.block || a.log - b.log)
    .map(({ time, gauges: entries }): Event => {
      const kept = entries
        .flatMap(({ gauge, amount }) => {
          const units = Number(BigInt(amount)) / 1e18;
          allAllocated += units;
          const j = indexOf.get(gauge);
          if (j === undefined) notGauges += units;
          return j === undefined ? [] : [{ j, amount: units }];
        })
        .sort((a, b) => a.j - b.j);
      return { k: hourAfter(time), js: kept.map(({ j }) => j), amounts: kept.map(({ amount }) => amount) };
    })
    // Of several allocations within one hour, the last one counts.
    .filter((e, i, all) => (i === all.length - 1 || all[i + 1]!.k !== e.k) && e.k < until);
  const shares = (e: Event) => {
    const total = e.amounts.reduce((a, b) => a + b, 0);
    return e.amounts.map((amount) => Math.round((amount / total) * 100));
  };
  const key = `${events.map((e) => `${e.k}:${e.js.map((j, i) => `${j}@${shares(e)[i]}`).join(",")}`).join(";")}|${endHour}`;
  if (events.length) nfts.push({ id, events, endHour, key });
}

// A gauge that isn't activated, or whose cap is zero, doesn't count the sAERO allocated to it: its power stays far below
// them, and a few sAERO counted there can earn its whole fees. Stakes allocated to it earn nothing then. A gauge
// counts its allocations at an hour unless its power is under `COUNTED` of the sAERO allocated to it. The bar is low,
// since a time lock's power falls below its sAERO as it nears its end. From here on, Y and T only grow over the hours
// a gauge counted its allocations, so that they say what an allocated sAERO earned.
const COUNTED = 0.1;
let [uncounted, allocatedHours] = [0, 0];
{
  const diff = Array.from({ length: J }, () => new Float64Array(K + 1));
  for (const { events, endHour } of nfts)
    for (const [i, e] of events.entries()) {
      const end = events[i + 1]?.k ?? endHour;
      for (const [n, j] of e.js.entries()) {
        const d = diff[j]!;
        d[e.k] = d[e.k]! + e.amounts[n]!;
        d[end] = d[end]! - e.amounts[n]!;
      }
    }
  for (let j = 0; j < J; j++) {
    const [y, t, d] = [Y[j]!, T[j]!, diff[j]!];
    let allocated = 0;
    const counted = new Uint8Array(K);
    for (let k = 0; k < K; k++) {
      allocated += d[k]!;
      counted[k] = allocated <= 1 || P[j]![k]! >= COUNTED * allocated ? 1 : 0;
      if (allocated > 1)
        [allocatedHours, uncounted] = [allocatedHours + allocated, uncounted + (counted[k] ? 0 : allocated)];
    }
    let last = y[0]!;
    for (let k = 1; k < K; k++) {
      const grown = y[k]! - last;
      last = y[k]!;
      if (!counted[k - 1]) t[k] = 0;
      y[k] = y[k - 1]! + (counted[k - 1] ? grown : 0);
    }
  }
}
// The market: what the average counted sAERO in a pool earned, weighting pools by their power. CM[k] sums it to hour k.
const CM = new Float64Array(K);
for (let k = 1; k < K; k++) {
  let [total, power] = [0, 0];
  for (let j = 0; j < J; j++) [total, power] = [total + T[j]![k]!, power + Math.max(0, P[j]![k - 1]!)];
  CM[k] = CM[k - 1]! + (power > 0 ? total / power : 0);
}

// `amounts` are the whole strategy's sAERO in each pool, summed over its stakes, and `ws` their shares. `caps` is, for
// each pool, the largest share of a pool that the placebo standing for it may take (see `CAP`).
type Spell = { ka: number; kb: number; js: number[]; ws: number[]; amounts: number[]; caps: number[]; own: number };
type Switch = { u: Float64Array; actual: number; gainHours: number; bestHours: number };
type Strategy = {
  ids: string[];
  spells: Spell[];
  switches: Switch[];
  hoursIn: number;
  amount: number;
  earned: number;
  market: number;
  apr: number;
  marketApr: number;
  relative: number;
  members: number;
  selZ: number;
  selP: number;
  selQ?: number;
  // The same, against a crowd of stakes rather than of sAERO.
  selP2: number;
  selQ2?: number;
  timU: number;
  timP: number;
  timQ?: number;
  thin: boolean;
};
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const strategies: Strategy[] = [];
let outsideWindow = 0;
for (const group of Map.groupBy(nfts, ({ key }) => key).values()) {
  const { endHour } = group[0]!;
  // Stakes in a strategy allocate at the same hours, to the same pools, in about the same shares. Their amounts add up.
  const events = group[0]!.events.map((e, i) => {
    const amounts = e.amounts.map((_, n) => sum(group.map((nft) => nft.events[i]!.amounts[n]!)));
    return { ...e, amounts, ws: amounts.map((a) => a / sum(amounts)) };
  });
  const timeline = events.map((e, i) => ({ e, kb: events[i + 1]?.k ?? endHour }));
  const spells: Spell[] = [];
  for (const { e, kb } of timeline) {
    if (kb <= e.k || !e.js.length) continue;
    // The strategy's share of each of its pools when it moved in.
    const shares = e.js.map((j, i) => {
      const pw = P[j]![e.k]!;
      return pw > 0 ? Math.min(1, e.amounts[i]! / pw) : 1;
    });
    const caps = shares.map((share) => Math.max(CAP, share));
    spells.push({ ka: e.k, kb, js: e.js, ws: e.ws, amounts: e.amounts, caps, own: Math.max(0, ...shares) });
  }
  // Timing: each move from one set of pools to another, against every other hour it could have moved at. It could move
  // from the end of the lock that began at its last allocation, until the hour after which its next allocation would
  // not have been allowed, or until its stake ended.
  const switches: Switch[] = [];
  for (let i = 1; i < events.length; i++) {
    const [before, now, next] = [events[i - 1]!, events[i]!, events[i + 1]];
    if (!before.js.length || !now.js.length) continue;
    const same =
      before.js.length === now.js.length &&
      before.js.every((j, n) => j === now.js[n] && Math.abs(before.ws[n]! - now.ws[n]!) < 0.01);
    if (same) continue;
    const lower = before.k + COOLDOWN;
    const upper = next ? next.k - COOLDOWN : endHour;
    if (now.k < lower || now.k > upper) {
      outsideWindow++;
      continue;
    }
    if (upper - lower < 1) continue;
    const [actual, n] = [now.k - lower, upper - lower + 1];
    // What one of the strategy's sAERO would have earned in the hour to k, in the pools of `e`. The pools' power is
    // taken without the strategy's own, which was in the old pools before the move and in the new ones after it, and
    // then with the amounts `e` puts there.
    const ownIn = (j: number, k: number) => {
      const e = k < now.k ? before : now;
      const at = e.js.indexOf(j);
      return at < 0 ? 0 : e.amounts[at]!;
    };
    const hourIn = (e: (typeof events)[number], k: number) =>
      e.js.reduce((s, j, m) => {
        const others = Math.max(0, P[j]![k - 1]! - ownIn(j, k - 1));
        return s + (e.ws[m]! * T[j]![k]!) / (others + e.amounts[m]!);
      }, 0);
    const [inOld, inNew] = [new Float64Array(n), new Float64Array(n)];
    for (let x = 1; x < n; x++) [inOld[x], inNew[x]] = [hourIn(before, lower + x), hourIn(now, lower + x)];
    // E[x]: what one sAERO would have earned from `lower` to `upper`, moving at hour lower + x.
    const E = new Float64Array(n);
    let [old, rest] = [0, inNew.reduce((s, v) => s + v, 0)];
    for (let x = 0; x < n; x++) {
      if (x > 0) [old, rest] = [old + inOld[x]!, rest - inNew[x]!];
      E[x] = old + rest;
    }
    const average = mean(E);
    const hourly = (CM[upper]! - CM[lower]!) / (upper - lower);
    switches.push({
      u: scaledRanks(E),
      actual,
      gainHours: hourly > 0 ? (E[actual]! - average) / hourly : 0,
      bestHours: hourly > 0 ? (Math.max(...E) - average) / hourly : 0,
    });
  }
  if (!spells.length && !switches.length) continue;
  let [earned, market, hoursIn] = [0, 0, 0];
  for (const s of spells) {
    earned += s.js.reduce((total, j, m) => total + s.ws[m]! * (Y[j]![s.kb]! - Y[j]![s.ka]!), 0);
    market += CM[s.kb]! - CM[s.ka]!;
    hoursIn += s.kb - s.ka;
  }
  if (!Number.isFinite(earned) || !Number.isFinite(market))
    throw new Error(`Earnings of ${group[0]!.id} are not finite.`);
  strategies.push({
    ids: group.map(({ id }) => id),
    spells,
    switches,
    hoursIn,
    amount: Math.max(...events.map((e) => sum(e.amounts))),
    earned,
    market,
    apr: hoursIn ? aprOf(earned, hoursIn) : NaN,
    marketApr: hoursIn ? aprOf(market, hoursIn) : NaN,
    relative: market > 0 ? earned / market : NaN,
    members: group.length,
    selZ: NaN,
    selP: NaN,
    selP2: NaN,
    timU: NaN,
    timP: NaN,
    thin: spells.some(({ own }) => own > THIN),
  });
}

// ---------------------------------------------------------------------------------------------------------------------
// 3. Selection: the strategy against placebos that move at the same hours with the same weights, into pools drawn as
// the rest of the crowd chose them: in proportion to the other stakes' power, or to their number. A placebo keeps its
// pool for as long as the strategy keeps the pool it stands for. It holds as many sAERO there as the strategy holds
// in the pool it stands for, and they dilute the pool's pay, as the strategy's own did.
// ---------------------------------------------------------------------------------------------------------------------
type Crowd = "power" | "stakes";
// weight[crowd][j][k]: how much the crowd favours gauge j at hour k. cumulative[crowd][k]: those weights summed over j.
const weight: Record<Crowd, Float64Array[]> = { power: P, stakes: [] };
{
  // How many stakes were in each pool at each hour, until their next allocation or until their stake ended.
  const diff = Array.from({ length: J }, () => new Float64Array(K + 1));
  for (const { events, endHour } of nfts)
    for (const [i, e] of events.entries()) {
      const end = events[i + 1]?.k ?? endHour;
      for (const j of e.js) {
        const d = diff[j]!;
        d[e.k] = d[e.k]! + 1;
        d[end] = d[end]! - 1;
      }
    }
  weight.stakes = diff.map((d) => {
    const c = new Float64Array(K);
    let run = 0;
    for (let k = 0; k < K; k++) c[k] = run += d[k]!;
    return c;
  });
}
const cumulative: Record<Crowd, Float64Array[]> = { power: [], stakes: [] };
for (const crowd of ["power", "stakes"] as const)
  for (let k = 0; k < K; k++) {
    const c = new Float64Array(J);
    let total = 0;
    for (let j = 0; j < J; j++) c[j] = total += Math.max(0, weight[crowd][j]![k]!);
    cumulative[crowd].push(c);
  }
function search(c: Float64Array, u: number, length = c.length): number {
  let [lo, hi] = [0, length - 1];
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (c[mid]! > u) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}

// For a slot that few pools can take, the pools that can, with their weights summed, and the pools by how many sAERO
// others hold there. Kept for each spell, slot and crowd, since every placebo needs the same lists.
type Open = { gs: Int32Array; cum: Float64Array; bySize: number[] };
const opens = new WeakMap<Spell, Map<string, Open>>();
const ownOf = (s: Spell, members: number, g: number, crowd: Crowd) => {
  const at = s.js.indexOf(g);
  return at < 0 ? 0 : crowd === "power" ? s.amounts[at]! : members;
};
const othersIn = (s: Spell, g: number) => Math.max(0, P[g]![s.ka]! - ownOf(s, 0, g, "power"));
// Pool g can take `amount` sAERO if they would be at most `cap` of its power.
const fits = (s: Spell, g: number, amount: number, cap: number) =>
  cap >= 1 || othersIn(s, g) >= (amount * (1 - cap)) / cap;
function openFor(s: Spell, m: number, members: number, crowd: Crowd): Open {
  let byKey = opens.get(s);
  if (!byKey) opens.set(s, (byKey = new Map()));
  const key = `${m}:${crowd}`;
  let open = byKey.get(key);
  if (!open) {
    const [gs, cum] = [[] as number[], [] as number[]];
    let total = 0;
    for (let g = 0; g < J; g++) {
      if (!fits(s, g, s.amounts[m]!, s.caps[m]!)) continue;
      const w = Math.max(0, weight[crowd][g]![s.ka]! - ownOf(s, members, g, crowd));
      if (w > 0) [gs.push(g), cum.push((total += w))];
    }
    const bySize = Array.from({ length: J }, (_, g) => g).sort((a, b) => othersIn(s, b) - othersIn(s, a));
    byKey.set(key, (open = { gs: Int32Array.from(gs), cum: Float64Array.from(cum), bySize }));
  }
  return open;
}
function placeboEarnings(spells: Spell[], members: number, crowd: Crowd, random: () => number): number {
  let total = 0;
  let mapping = new Map<number, number>();
  let lastEnd = -1;
  for (const s of spells) {
    const next = new Map<number, number>();
    const taken = new Set<number>();
    if (s.ka === lastEnd)
      for (const j of s.js) {
        const kept = mapping.get(j);
        if (kept !== undefined) [taken.add(kept), next.set(j, kept)];
      }
    const draw = (m: number) => {
      // Most pools can take most placebos: draw in proportion to the crowd's weight, then keep a pool with the chance
      // that the others' weight in it is of the whole, if it can take the placebo.
      const c = cumulative[crowd][s.ka]!;
      for (let tries = 0; tries < 20; tries++) {
        const g = search(c, random() * c[J - 1]!);
        const all = weight[crowd][g]![s.ka]!;
        if (
          !taken.has(g) &&
          fits(s, g, s.amounts[m]!, s.caps[m]!) &&
          random() * all < all - ownOf(s, members, g, crowd)
        )
          return g;
      }
      // Few pools can take it: draw among those, or else take the largest pool left.
      const open = openFor(s, m, members, crowd);
      for (let tries = 0; open.gs.length && tries < 50; tries++) {
        const g = open.gs[search(open.cum, random() * open.cum[open.cum.length - 1]!)]!;
        if (!taken.has(g)) return g;
      }
      return open.bySize.find((g) => !taken.has(g))!;
    };
    for (const [m, j] of s.js.entries()) {
      if (next.has(j)) continue;
      const pick = draw(m);
      taken.add(pick);
      next.set(j, pick);
    }
    for (const [m, j] of s.js.entries()) {
      // What all of g's sAERO earned, shared by the others' and the placebo's.
      const g = next.get(j)!;
      const power = P[g]![s.ka]!;
      total += (s.ws[m]! * (Y[g]![s.kb]! - Y[g]![s.ka]!) * power) / (othersIn(s, g) + s.amounts[m]!);
    }
    mapping = next;
    lastEnd = s.kb;
  }
  return total;
}
function selection(spells: Spell[], members: number, earned: number, crowd: Crowd, seed: string, sims: number) {
  const random = generator(seedOf(seed));
  let [total, squares, above] = [0, 0, 0];
  for (let i = 0; i < sims; i++) {
    const v = placeboEarnings(spells, members, crowd, random);
    total += v;
    squares += v * v;
    if (v >= earned) above++;
  }
  const average = total / sims;
  const sd = Math.sqrt(Math.max(0, squares / sims - average * average));
  return { z: sd > 0 ? (earned - average) / sd : 0, p: (above + 1) / (sims + 1) };
}
// A thousand placebos, then twenty thousand when that leaves p below 0.01.
function tested(spells: Spell[], members: number, earned: number, crowd: Crowd, seed: string) {
  const first = selection(spells, members, earned, crowd, seed, SIMS);
  return first.p < 0.01 ? selection(spells, members, earned, crowd, `${seed}+`, MORE_SIMS) : first;
}

// ---------------------------------------------------------------------------------------------------------------------
// 4. Timing: with no timing skill, each move is equally likely at any hour it could have moved at. So its rank among
// those hours is uniform. The statistic is the sum of (rank - 1/2) over the strategy's moves.
// ---------------------------------------------------------------------------------------------------------------------
function timing(switches: Switch[], seed: string, sims: number) {
  const random = generator(seedOf(seed));
  const observed = switches.reduce((s, w) => s + w.u[w.actual]! - 0.5, 0);
  let above = 0;
  for (let i = 0; i < sims; i++) {
    let v = 0;
    for (const w of switches) v += w.u[Math.floor(random() * w.u.length)]! - 0.5;
    if (v >= observed - 1e-12) above++;
  }
  return { u: observed / switches.length + 0.5, p: (above + 1) / (sims + 1) };
}

const forSelection = strategies.filter(({ hoursIn, amount }) => hoursIn >= MIN_HOURS && amount >= MIN_AMOUNT);
for (const s of forSelection) {
  const r = tested(s.spells, s.members, s.earned, "power", `power:${s.ids[0]}`);
  [s.selZ, s.selP] = [r.z, r.p];
  s.selP2 = tested(s.spells, s.members, s.earned, "stakes", `stakes:${s.ids[0]}`).p;
}
const forTiming = strategies.filter(({ switches, amount }) => switches.length > 0 && amount >= MIN_AMOUNT);
for (const s of forTiming) {
  let r = timing(s.switches, `timing:${s.ids[0]}`, SIMS);
  if (r.p < 0.01) r = timing(s.switches, `timing+:${s.ids[0]}`, MORE_SIMS);
  [s.timU, s.timP] = [r.u, r.p];
}
bh(forSelection.map((s) => s.selP)).forEach((q, i) => (forSelection[i]!.selQ = q));
bh(forSelection.map((s) => s.selP2)).forEach((q, i) => (forSelection[i]!.selQ2 = q));
bh(forTiming.map((s) => s.timP)).forEach((q, i) => (forTiming[i]!.timQ = q));

// Population checks. With no skill anywhere, p-values as normal quantiles, Φ⁻¹(1 - p), have mean 0 and variance about
// 1, and ranks of moves have mean 1/2.
const zs = forSelection.map(({ selP }) => -probit(selP));
const allSwitches = forTiming.flatMap(({ switches }) => switches);
const meanU = mean(allSwitches.map((w) => w.u[w.actual]!));
let [nullMean, nullVariance] = [0, 0];
for (const w of allSwitches) [nullMean, nullVariance] = [nullMean + mean(w.u), nullVariance + variance(w.u)];
const meanUz = (meanU * allSwitches.length - nullMean) / Math.sqrt(nullVariance);

// Persistence: selection p-values in the first half of the period against those in the second, for strategies with at
// least half the minimum hours in each half. Each half's placebos are drawn anew.
const split = Math.floor(K / 2);
const halves = forSelection.flatMap((s) => {
  const clip = (lo: number, hi: number) =>
    s.spells.flatMap((sp) => {
      const [ka, kb] = [Math.max(sp.ka, lo), Math.min(sp.kb, hi)];
      return kb > ka ? [{ ...sp, ka, kb }] : [];
    });
  const [a, b] = [clip(0, split), clip(split, K - 1)];
  const hoursOf = (xs: Spell[]) => sum(xs.map((sp) => sp.kb - sp.ka));
  if (hoursOf(a) < MIN_HOURS / 2 || hoursOf(b) < MIN_HOURS / 2) return [];
  const earn = (xs: Spell[]) =>
    sum(xs.map((sp) => sp.js.reduce((u, j, m) => u + sp.ws[m]! * (Y[j]![sp.kb]! - Y[j]![sp.ka]!), 0)));
  const z = (xs: Spell[], half: string) =>
    -probit(selection(xs, s.members, earn(xs), "power", `${half}:${s.ids[0]}`, HALF_SIMS).p);
  return [{ a: z(a, "first"), b: z(b, "second") }];
});
const rho = spearman(
  halves.map(({ a }) => a),
  halves.map(({ b }) => b),
);

// ---------------------------------------------------------------------------------------------------------------------
// 5. Report.
// ---------------------------------------------------------------------------------------------------------------------
const day = (k: number) => new Date(hours[k]! * 1000).toISOString().slice(0, 16).replace("T", " ");
const pct = (x: number) => (Number.isFinite(x) ? `${(100 * x).toFixed(1)}%` : "–");
const fmtP = (p: number) => (Number.isNaN(p) ? "" : p < 1e-4 ? p.toExponential(1) : p.toFixed(4));
// Token symbols are set by whoever made the token, so they are escaped for Markdown tables and for CSV.
const md = (text: string) => text.replace(/[\\|`*_[\]<>]/g, (c) => `\\${c}`);
const csvField = (text: string) => `"${text.replace(/"/g, '""')}"`;
const names = (s: Strategy) =>
  [...new Set(s.spells.flatMap(({ js }) => js.map((j) => gauges[j]!.name)))].slice(0, 4).join(", ");
const ids = (s: Strategy) =>
  s.ids.length > 3 ? `${s.ids.slice(0, 3).join(", ")} +${s.ids.length - 3}` : s.ids.join(", ");
const totalPower = sum(P.map((p) => Math.max(0, p[K - 1]!)));
const unpricedPower = sum([...unpricedGauges].map((j) => Math.max(0, P[j]![K - 1]!)));
const share = <T>(xs: T[], test: (x: T) => boolean) => pct(xs.filter(test).length / xs.length);

const lines: string[] = [];
const out = (line = "") => lines.push(line);
out("# Aero allocation skill: results");
out();
out(
  `Data: ${day(0)} to ${day(K - 1)} UTC (${((K - 1) / 24).toFixed(1)} days), ${J} gauges, ${allocations.length} allocations by ${byId.size} stakes. ${leftOut} allocations after the last hour are left out.`,
);
out(
  `Prices: one snapshot, AERO at $${aeroPrice.toFixed(4)}, each from a pool at least 10 times as deep as the most its token paid in a day. Gauges paying a token without a price hold ${pct(unpricedPower / totalPower)} of the last hour's power; that token counts as 0, for strategies and placebos alike.`,
);
out(
  `Gauges that didn't count the sAERO allocated to them (power under ${pct(COUNTED)} of it, as when a gauge isn't activated): ${pct(uncounted / allocatedHours)} of allocated sAERO-hours, which earn nothing there.`,
);
out(
  `Allocations to addresses that are not gauges (the zero address and 0x2e67…6902, which has no code): ${pct(notGauges / allAllocated)} of the sAERO in all allocation events. Weights are taken over real gauges only.`,
);
out(
  `Average sAERO in a pool over the whole period: APR ${pct(aprOf(CM[K - 1]!, K - 1))} at today's prices (fees ${pct(paid.fees / (paid.fees + paid.incentives))} of all pay, incentives the rest).`,
);
out();
out(
  `Strategies: ${nfts.length} stakes, grouped into ${strategies.length} strategies (stakes with exactly the same allocations, hour by hour, and the same end, are one strategy). ${ended} stakes were withdrawn or their lock ended before the last hour; their allocations end then.`,
);
out();
out("## Selection");
out();
out(
  `Tested: ${forSelection.length} strategies of at least ${MIN_AMOUNT} sAERO with at least ${MIN_HOURS} hours in pools.`,
);
out(
  `- Significant at FDR ${FDR} (Benjamini–Hochberg): ${forSelection.filter((s) => s.selQ! <= FDR).length} better than chance.`,
);
out(`- p < 0.05: ${share(forSelection, (s) => s.selP < 0.05)} of strategies (5% expected with no skill anywhere).`);
out(
  `- p-values as normal quantiles: mean ${mean(zs).toFixed(2)}, variance ${variance(zs).toFixed(2)} (about 0 and 1 with no skill anywhere).`,
);
out(
  `- Against a crowd of stakes (pools drawn by how many stakes are in them, not by their power): ${forSelection.filter((s) => s.selQ2! <= FDR).length} significant at FDR ${FDR}; p < 0.05 for ${share(forSelection, (s) => s.selP2 < 0.05)}.`,
);
out("- Calibration by size. With no skill, p-values are spread evenly: 5% below 0.05 and 10% above 0.9.");
out();
out("  | sAERO | Strategies | p < 0.05 (power) | p > 0.9 (power) | p < 0.05 (stakes) | p > 0.9 (stakes) |");
out("  |---|---|---|---|---|---|");
for (const [lo, hi, label] of [
  [MIN_AMOUNT, 1e3, `${MIN_AMOUNT}–1k`],
  [1e3, 1e4, "1k–10k"],
  [1e4, 1e5, "10k–100k"],
  [1e5, 1e6, "100k–1M"],
  [1e6, Infinity, "≥ 1M"],
] as const) {
  const group = forSelection.filter(({ amount }) => amount >= lo && amount < hi);
  out(
    `  | ${label} | ${group.length} | ${share(group, (s) => s.selP < 0.05)} | ${share(group, (s) => s.selP > 0.9)} | ${share(group, (s) => s.selP2 < 0.05)} | ${share(group, (s) => s.selP2 > 0.9)} |`,
  );
}
out();
out(
  `- Persistence: Spearman ρ between first-half and second-half selection p-values (as normal quantiles), ${halves.length} strategies: ${rho.toFixed(3)} (±${(1.96 / Math.sqrt(Math.max(1, halves.length - 1))).toFixed(3)} is the 95% band for 0).`,
);
out();
out("## Timing");
out();
out(
  `Tested: ${forTiming.length} strategies of at least ${MIN_AMOUNT} sAERO, with ${allSwitches.length} moves that had at least two possible hours.`,
);
out(`- Significant at FDR ${FDR}: ${forTiming.filter((s) => s.timQ! <= FDR).length}.`);
out(`- p < 0.05: ${share(forTiming, (s) => s.timP < 0.05)} of strategies.`);
out(
  `- Mean rank of the hour actually chosen, over all moves: ${meanU.toFixed(3)} (0.5 with no timing skill; z = ${meanUz.toFixed(2)}).`,
);
out(
  `- Gain from timing, against moving at a random possible hour, in hours of the average sAERO's pay: median ${median(allSwitches.map((w) => w.gainHours)).toFixed(1)} per move; the best possible hour would have gained a median ${median(allSwitches.map((w) => w.bestHours)).toFixed(1)}.`,
);
out(`- Moves made outside the hours they were allowed at, left out: ${outsideWindow}.`);
out();
const top = (rows: Strategy[], title: string) => {
  out(`## ${title}`);
  out();
  out(
    "| Stakes | sAERO | Pools | Days in pools | APR | Average APR then | Selection p | q | Moves | Timing rank | p | q |",
  );
  out("|---|---|---|---|---|---|---|---|---|---|---|---|");
  for (const s of rows)
    out(
      `| ${ids(s)} | ${Math.round(s.amount).toLocaleString("en-US")} | ${md(names(s))} | ${(s.hoursIn / 24).toFixed(1)} | ${pct(s.apr)} | ${pct(s.marketApr)} | ${fmtP(s.selP)} | ${s.selQ?.toFixed(3) ?? ""} | ${s.switches.length} | ${Number.isNaN(s.timU) ? "" : s.timU.toFixed(2)} | ${fmtP(s.timP)} | ${s.timQ?.toFixed(3) ?? ""} |${s.thin ? " thin" : ""}`,
    );
  out();
};
top(
  forSelection
    .filter((s) => s.hoursIn >= 7 * 24 && Number.isFinite(s.apr))
    .sort((a, b) => b.apr - a.apr)
    .slice(0, 25),
  "Highest APRs (at least 7 days in pools)",
);
top([...forSelection].sort((a, b) => b.amount - a.amount).slice(0, 15), "Largest strategies");
top([...forSelection].sort((a, b) => a.selP - b.selP || b.selZ - a.selZ).slice(0, 15), "Strongest selection evidence");
top([...forTiming].sort((a, b) => a.timP - b.timP).slice(0, 15), "Strongest timing evidence");
// Aero's Autopilots: the stakes of the Relays that its factory (0xA528…4B78, `allRelays`) lists. The two Maxis allocate
// alike, within minutes. The seven internal Relays (stakes 20367 and 20369 to 20374) never allocated.
const autopilots = ["20366", "20365"].flatMap((id) => strategies.filter(({ ids }) => ids.includes(id)));
top(autopilots, "Aero Autopilots: USDC Maxi (stake 20366) and sAERO Maxi (stake 20365)");
out(
  `"thin" marks a strategy that held more than ${pct(THIN)} of a pool's power at some point. Placebos pay the same dilution, but such pools are rarely drawn.`,
);

const number = (v: number) => (Number.isInteger(v) || Number.isNaN(v) ? v : Number(v.toPrecision(5)));
mkdirSync(OUT, { recursive: true });
writeFileSync(new URL("summary.md", OUT), lines.join("\n") + "\n");
const csv = [
  "stakes,count,saero,pools,hours_in_pools,apr,market_apr,relative,selection_z,selection_p,selection_q,selection_p_stakes,selection_q_stakes,moves,timing_rank,timing_p,timing_q,thin",
  ...strategies.map((s) =>
    [
      s.ids.join(" "),
      s.ids.length,
      Math.round(s.amount),
      csvField(names(s)),
      s.hoursIn,
      number(s.apr),
      number(s.marketApr),
      number(s.relative),
      number(s.selZ),
      number(s.selP),
      s.selQ === undefined ? "" : number(s.selQ),
      number(s.selP2),
      s.selQ2 === undefined ? "" : number(s.selQ2),
      s.switches.length,
      number(s.timU),
      number(s.timP),
      s.timQ === undefined ? "" : number(s.timQ),
      s.thin,
    ].join(","),
  ),
];
writeFileSync(new URL("strategies.csv", OUT), csv.join("\n") + "\n");
console.log(lines.join("\n"));
