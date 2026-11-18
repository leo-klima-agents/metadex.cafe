// Tests whether Aero stakes allocated better than chance, separately for which pools they chose (selection) and when
// they moved (timing). Reads data/*.json, written by the fetch scripts. Writes results/summary.md and
// results/strategies.csv. See README.md for the method.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const HOUR = 3_600;
const COOLDOWN = 47; // hours
// Only strategies with at least this many hours in pools are tested for selection.
const MIN_HOURS = 96;
// Only strategies that allocate at least this many sAERO are tested. Dust stakes alone in an empty pool earn all its
// fees, at APRs of billions of percent, which says nothing about allocating.
const MIN_AMOUNT = 100;
const FDR = 0.1;
// A placebo only goes to a pool where its sAERO would be at most this share of the pool's power, or at most the share
// the strategy took in the pool it stands for, if that was more. Real stakes rarely take more than a quarter of a pool:
// 1% to 8% of entries, depending on size. Without this, a large strategy's placebos land in pools far too small for
// them and dilute themselves, which no real stake of that size does, and the strategy looks skilled for avoiding that.
// `CAP=0.01 OUT=… node research/analyze.ts` runs the strict version, where a placebo takes at most the share the
// strategy took, into another directory.
const CAP = Number(process.env.CAP ?? 0.25);
const OUT = new URL(`${process.env.OUT ?? "./results"}/`, import.meta.url);
const SIMS = 1_000;
const MORE_SIMS = 20_000;

const load = (name: string) => JSON.parse(readFileSync(new URL(`./data/${name}`, import.meta.url), "utf8"));
type Token = { address: string; decimals: number; symbol: string };
type Snap = { acc0: string; acc1: string; ts: number; share: string; zero: number };
type SavedGauge = {
  address: string;
  name: string;
  token0: Token;
  token1: Token;
  index: string[];
  supply: string[];
  snaps: Record<string, Snap>;
  programs: { token: string; rate: string; start: number; end: number }[];
};
const data: {
  hours: number[];
  gauges: SavedGauge[];
  prices: Record<string, number>;
  tokens: Record<string, Token>;
} = load("gauges.json");
const allocations: {
  id: string;
  time: number;
  block: number;
  log: number;
  gauges: { gauge: string; amount: string }[];
}[] = load("allocations.json");
const stakes: Record<string, { amount: string }> = load("stakes.json");

// A seeded generator, so that every run gives the same numbers.
let seed = 0x9e3779b9;
function random(): number {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

// ---------------------------------------------------------------------------------------------------------------------
// 1. Each gauge's cumulative pay per sAERO, in dollars at today's prices, at every hour.
// ---------------------------------------------------------------------------------------------------------------------
const { hours, gauges } = data;
const K = hours.length;
const J = gauges.length;
const T0 = hours[0]!;
const priceOf = (address: string): number | undefined => data.prices[address.toLowerCase()];
const AERO = "0x3f5bf3edac59d650d8fdf9657a71f2f904a3a4ee";
const aeroPrice = priceOf(AERO)!;
const unpricedGauges = new Set<number>();

// Y[j][k]: what one whole sAERO earned in gauge j from launch to hour k, fees and incentives. P[j][k]: its power then.
const Y: Float64Array[] = [];
const P: Float64Array[] = [];
const feeShare = { fees: 0, incentives: 0 };
for (const [j, g] of gauges.entries()) {
  const [p0, p1] = [priceOf(g.token0.address), priceOf(g.token1.address)];
  if (p0 === undefined || p1 === undefined) unpricedGauges.add(j);
  const [d0, d1] = [10 ** g.token0.decimals, 10 ** g.token1.decimals];
  // Rewards managers credit fees × 1e24 / power in 18-decimal units: per whole sAERO, growth / 1e6 smallest units.
  const fee = (snap: Snap | undefined) =>
    snap ? (Number(BigInt(snap.acc0)) / 1e6 / d0) * (p0 ?? 0) + (Number(BigInt(snap.acc1)) / 1e6 / d1) * (p1 ?? 0) : 0;
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
  const y = new Float64Array(K);
  const p = new Float64Array(K);
  let [incentives, lastShare] = [0, 0];
  for (let k = 0; k < K; k++) {
    const supply = BigInt(g.supply[k]!);
    const snap = g.index[k] === "0" ? undefined : g.snaps[g.index[k]!];
    const s = share(k, snap, supply);
    if (k > 0) {
      const [from, to] = [hours[k - 1]!, hours[k]!];
      // The programs' dollars a second, averaged over the hour.
      let perSecond = 0;
      for (const program of programs)
        perSecond +=
          (program.perSecond * Math.max(0, Math.min(to, program.end) - Math.max(from, program.start))) / HOUR;
      incentives += perSecond * Math.max(0, s - lastShare);
    }
    lastShare = s;
    const f = fee(snap);
    y[k] = f + incentives;
    p[k] = Number(supply) / 1e18;
    if (k === K - 1) {
      feeShare.fees += f * (p[k] || 0);
      feeShare.incentives += incentives * (p[k] || 0);
    }
  }
  Y.push(y);
  P.push(p);
}
// Note on the incentive term: a program streams `perSecond` dollars to all the power in the gauge. Over an hour, one
// sAERO gets perSecond × ∫ dt / power, which is perSecond × (share growth), for the part of the hour it ran.

// T[j][k]: what all of gauge j's sAERO earned from hour k-1 to hour k. A stake that adds `a` sAERO to the gauge then
// earns T / (power + a) per sAERO.
const T: Float64Array[] = Y.map((y, j) => {
  const t = new Float64Array(K);
  for (let k = 1; k < K; k++) t[k] = (y[k]! - y[k - 1]!) * Math.max(0, P[j]![k - 1]!);
  return t;
});

// The market: what the average sAERO in a pool earned each hour, weighting pools by their power.
const M = new Float64Array(K); // M[k]: the average from hour k-1 to hour k.
const CM = new Float64Array(K); // its running sum
const totalPower = new Float64Array(K);
for (let k = 1; k < K; k++) {
  let [paid, power] = [0, 0];
  for (let j = 0; j < J; j++) {
    const pw = P[j]![k - 1]!;
    if (pw <= 0) continue;
    paid += (Y[j]![k]! - Y[j]![k - 1]!) * pw;
    power += pw;
  }
  totalPower[k - 1] = power;
  M[k] = power > 0 ? paid / power : 0;
  CM[k] = CM[k - 1]! + M[k]!;
}
let lastPower = 0;
for (let j = 0; j < J; j++) lastPower += Math.max(0, P[j]![K - 1]!);
totalPower[K - 1] = lastPower;
const aprOf = (dollars: number, hoursHeld: number) => ((dollars / hoursHeld) * 24 * 365) / aeroPrice;

// The crowd that placebos copy picks a pool in proportion to its weight: its power ("power"), or the number of stakes
// in it ("stakes"). `weight[crowd][j][k]` is that weight at hour k; `cumulative[crowd][k]` sums it over the gauges.
type Crowd = "power" | "stakes";
const weight: Record<Crowd, Float64Array[]> = { power: P, stakes: [] };
const cumulative: Record<Crowd, Float64Array[]> = { power: [], stakes: [] };
function cumulate(crowd: Crowd) {
  for (let k = 0; k < K; k++) {
    const c = new Float64Array(J);
    let s = 0;
    for (let j = 0; j < J; j++) c[j] = s += Math.max(0, weight[crowd][j]![k]!);
    cumulative[crowd].push(c);
  }
}
function drawGauge(k: number, crowd: Crowd): number {
  const c = cumulative[crowd][k]!;
  const u = random() * c[J - 1]!;
  let [lo, hi] = [0, J - 1];
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (c[mid]! > u) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}

// ---------------------------------------------------------------------------------------------------------------------
// 2. Each stake's allocations, as spells of fixed pools, grouped into strategies.
// ---------------------------------------------------------------------------------------------------------------------
const indexOf = new Map(gauges.map((g, j) => [g.address, j]));
const hourAfter = (time: number) => Math.max(0, Math.ceil((time - T0) / HOUR));
type Event = { k: number; js: number[]; ws: number[]; amounts: number[]; idle: number };
const byId = Map.groupBy(allocations, ({ id }) => id);
type Nft = { id: string; events: Event[]; withdrawn: boolean; key: string };
const nfts: Nft[] = [];
let [sentinelShare, allShare] = [0, 0];
for (const [id, list] of byId) {
  list.sort((a, b) => a.block - b.block || a.log - b.log);
  const events = list.map(({ time, gauges: entries }): Event => {
    const all = entries.reduce((s, { amount }) => s + Number(BigInt(amount)) / 1e18, 0);
    const kept = entries.flatMap(({ gauge, amount }) => {
      const j = indexOf.get(gauge);
      return j === undefined ? [] : [{ j, amount: Number(BigInt(amount)) / 1e18 }];
    });
    const inPools = kept.reduce((s, { amount }) => s + amount, 0);
    sentinelShare += all - inPools;
    allShare += all;
    kept.sort((a, b) => a.j - b.j);
    return {
      k: hourAfter(time),
      js: kept.map(({ j }) => j),
      ws: kept.map(({ amount }) => amount / inPools),
      amounts: kept.map(({ amount }) => amount),
      idle: all > 0 ? 1 - inPools / all : 1,
    };
  });
  // Of several allocations within one hour, the last one counts.
  const merged = events.filter((e, i) => i === events.length - 1 || events[i + 1]!.k !== e.k);
  const withdrawn = (stakes[id]?.amount ?? "0") === "0";
  const key =
    merged.map((e) => `${e.k}:${e.js.map((j, i) => `${j}@${Math.round(e.ws[i]! * 100)}`).join(",")}`).join(";") +
    (withdrawn ? ";w" : "");
  nfts.push({ id, events: merged, withdrawn, key });
}

// `amounts` are the whole strategy's sAERO in each pool: the sum over its stakes.
// `caps` is, for each pool, the largest share of a pool that the placebo standing for it may take (see `CAP`).
type Spell = {
  ka: number;
  kb: number;
  js: number[];
  ws: number[];
  amounts: number[];
  caps: number[];
  members: number;
  own: number;
};
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
const strategies: Strategy[] = [];
for (const group of Map.groupBy(nfts, ({ key }) => key).values()) {
  const { withdrawn } = group[0]!;
  // Stakes in a strategy allocate at the same hours, to the same pools, in the same shares. Their amounts add up.
  const events: Event[] = group[0]!.events.map((e, i) => ({
    ...e,
    amounts: e.amounts.map((_, n) => group.reduce((s, nft) => s + nft.events[i]!.amounts[n]!, 0)),
  }));
  // Spells run from one allocation to the next. A withdrawn stake's last spell has an unknown end, so it is dropped.
  const spells: Spell[] = [];
  const timeline: { e: Event; kb: number | undefined }[] = events.map((e, i) => ({
    e,
    kb: i + 1 < events.length ? events[i + 1]!.k : withdrawn ? undefined : K - 1,
  }));
  for (const { e, kb } of timeline) {
    if (kb === undefined || kb <= e.k || !e.js.length) continue;
    // The stake's share of each of its pools when it moved in, counting every stake in the strategy.
    const shares = e.js.map((j, i) => {
      const pw = P[j]![e.k]!;
      return pw > 0 ? Math.min(1, e.amounts[i]! / pw) : 1;
    });
    const own = Math.max(0, ...shares);
    const caps = shares.map((share) => Math.max(CAP, share));
    spells.push({ ka: e.k, kb, js: e.js, ws: e.ws, amounts: e.amounts, caps, members: group.length, own });
  }
  // Timing: each move from one set of pools to another, against every other hour it could have moved at.
  const switches: Switch[] = [];
  for (let i = 1; i < timeline.length; i++) {
    const [before, now] = [timeline[i - 1]!.e, timeline[i]!.e];
    const next = timeline[i + 1]?.e;
    if (!before.js.length || !now.js.length) continue;
    const same =
      before.js.length === now.js.length &&
      before.js.every((j, n) => j === now.js[n] && Math.abs(before.ws[n]! - now.ws[n]!) < 0.01);
    if (same) continue;
    if (!next && withdrawn) continue; // the end of the window it had is unknown
    // It could move from the end of the lock that began at its last allocation, until the hour after which its next
    // allocation would not have been allowed.
    const lower = before.k + COOLDOWN;
    const upper = next ? next.k - COOLDOWN : K - 1;
    if (upper - lower < 1) continue;
    const actual = Math.min(Math.max(now.k, lower), upper) - lower;
    const n = upper - lower + 1;
    // What one of the strategy's sAERO would have earned in the hour to k, in the pools of `e`, had it been there. The
    // pools' power is taken without the strategy's own, which was in the old pools before the move and in the new
    // ones after it, and then with the amounts `e` puts there.
    const ownIn = (j: number, k: number) => {
      const e = k < lower + actual ? before : now;
      const at = e.js.indexOf(j);
      return at < 0 ? 0 : e.amounts[at]!;
    };
    const hourIn = (e: Event, k: number) =>
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
    const sorted = Float64Array.from(E).sort();
    const u = new Float64Array(n);
    for (let x = 0; x < n; x++) {
      // Mid-rank of E[x] among all the hours, scaled to [0, 1].
      let [lo, hi] = [0, n];
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (sorted[mid]! < E[x]!) lo = mid + 1;
        else hi = mid;
      }
      let top = lo;
      while (top < n && sorted[top] === E[x]) top++;
      u[x] = (lo + (top - lo - 1) / 2) / (n - 1);
    }
    const mean = E.reduce((s, v) => s + v, 0) / n;
    const hourly = (CM[upper]! - CM[lower]!) / (upper - lower);
    switches.push({
      u,
      actual,
      gainHours: hourly > 0 ? (E[actual]! - mean) / hourly : 0,
      bestHours: hourly > 0 ? (sorted[n - 1]! - mean) / hourly : 0,
    });
  }
  if (!spells.length && !switches.length) continue;
  let [earned, market, hoursIn, amount] = [0, 0, 0, 0];
  for (const s of spells) {
    earned += s.js.reduce((sum, j, m) => sum + s.ws[m]! * (Y[j]![s.kb]! - Y[j]![s.ka]!), 0);
    market += CM[s.kb]! - CM[s.ka]!;
    hoursIn += s.kb - s.ka;
    amount = Math.max(
      amount,
      s.amounts.reduce((a, b) => a + b, 0),
    );
  }
  for (const { e } of timeline)
    amount = Math.max(
      amount,
      e.amounts.reduce((a, b) => a + b, 0),
    );
  strategies.push({
    ids: group.map(({ id }) => id),
    spells,
    switches,
    hoursIn,
    amount,
    earned,
    market,
    apr: hoursIn ? aprOf(earned, hoursIn) : NaN,
    marketApr: hoursIn ? aprOf(market, hoursIn) : NaN,
    relative: market > 0 ? earned / market : NaN,
    selZ: NaN,
    selP: NaN,
    selP2: NaN,
    timU: NaN,
    timP: NaN,
    thin: spells.some(({ own }) => own > 0.25),
  });
}

// How many stakes were in each pool at each hour. A withdrawn stake is counted until its last allocation's hour.
cumulate("power");
{
  const diff = Array.from({ length: J }, () => new Float64Array(K + 1));
  for (const { events, withdrawn } of nfts)
    for (const [i, e] of events.entries()) {
      const end = events[i + 1]?.k ?? (withdrawn ? e.k : K);
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
  cumulate("stakes");
}

// ---------------------------------------------------------------------------------------------------------------------
// 3. Selection: the strategy against placebos that move at the same hours with the same weights, into pools drawn as
// the rest of the crowd chose them: in proportion to the other stakes' power, or to their number. A placebo keeps its
// pool for as long as the strategy keeps the pool it stands for. It holds as many sAERO there as the strategy holds
// in the pool it stands for, and they dilute the pool's pay, as the strategy's own did.
// ---------------------------------------------------------------------------------------------------------------------
function placeboEarnings(spells: Spell[], crowd: Crowd): number {
  let total = 0;
  let mapping = new Map<number, number>();
  let lastEnd = -1;
  for (const s of spells) {
    const next = new Map<number, number>();
    const taken = new Set<number>();
    if (s.ka === lastEnd)
      for (const j of s.js) if (mapping.has(j)) (taken.add(mapping.get(j)!), next.set(j, mapping.get(j)!));
    // The strategy's own weight in pool g, which the crowd's leaves out.
    const own = (g: number, c: Crowd) => {
      const at = s.js.indexOf(g);
      return at < 0 ? 0 : c === "power" ? s.amounts[at]! : s.members;
    };
    // Pool g can take `amount` sAERO if they would be at most `cap` of its power.
    const fits = (g: number, amount: number, cap: number) =>
      cap >= 1 || Math.max(0, P[g]![s.ka]! - own(g, "power")) >= (amount * (1 - cap)) / cap;
    const draw = (amount: number, cap: number) => {
      for (let tries = 0; tries < 100; tries++) {
        const g = drawGauge(s.ka, crowd);
        const all = weight[crowd][g]![s.ka]!;
        if (!taken.has(g) && fits(g, amount, cap) && random() * all < all - own(g, crowd)) return g;
      }
      // Few pools can take it: draw among those directly, or else take the largest pool left.
      let [sum, best, most] = [0, -1, -1];
      const open: [number, number][] = [];
      for (let g = 0; g < J; g++) {
        if (taken.has(g)) continue;
        const others = Math.max(0, P[g]![s.ka]! - own(g, "power"));
        if (others > most) [best, most] = [g, others];
        if (!fits(g, amount, cap)) continue;
        const w = Math.max(0, weight[crowd][g]![s.ka]! - own(g, crowd));
        if (w > 0) open.push([g, (sum += w)]);
      }
      if (!open.length) return best;
      const u = random() * sum;
      return open.find(([, upTo]) => upTo > u)?.[0] ?? open.at(-1)![0];
    };
    for (const [m, j] of s.js.entries()) {
      if (next.has(j)) continue;
      const pick = draw(s.amounts[m]!, s.caps[m]!);
      taken.add(pick);
      next.set(j, pick);
    }
    for (const [m, j] of s.js.entries()) {
      // What all of g's sAERO earned, shared by the others' and the placebo's.
      const g = next.get(j)!;
      const power = P[g]![s.ka]!;
      const others = Math.max(0, power - own(g, "power"));
      total += (s.ws[m]! * (Y[g]![s.kb]! - Y[g]![s.ka]!) * power) / (others + s.amounts[m]!);
    }
    mapping = next;
    lastEnd = s.kb;
  }
  return total;
}
function selection(spells: Spell[], earned: number, sims: number, crowd: Crowd = "power") {
  let [sum, sq, above] = [0, 0, 0];
  for (let i = 0; i < sims; i++) {
    const v = placeboEarnings(spells, crowd);
    sum += v;
    sq += v * v;
    if (v >= earned) above++;
  }
  const mean = sum / sims;
  const sd = Math.sqrt(Math.max(0, sq / sims - mean * mean));
  return { z: sd > 0 ? (earned - mean) / sd : 0, p: (above + 1) / (sims + 1), mean };
}

// ---------------------------------------------------------------------------------------------------------------------
// 4. Timing: with no timing skill, each move is equally likely at any hour it could have moved at. So its rank among
// those hours is uniform. The statistic is the sum of (rank - 1/2) over the strategy's moves.
// ---------------------------------------------------------------------------------------------------------------------
function timing(switches: Switch[], sims: number) {
  const observed = switches.reduce((s, w) => s + w.u[w.actual]! - 0.5, 0);
  let above = 0;
  for (let i = 0; i < sims; i++) {
    let v = 0;
    for (const w of switches) v += w.u[Math.floor(random() * w.u.length)]! - 0.5;
    if (v >= observed - 1e-12) above++;
  }
  return { u: observed / switches.length + 0.5, p: (above + 1) / (sims + 1) };
}

const tested = strategies.filter(({ hoursIn, amount }) => hoursIn >= MIN_HOURS && amount >= MIN_AMOUNT);
for (const s of tested) {
  let r = selection(s.spells, s.earned, SIMS);
  if (r.p < 0.01) r = selection(s.spells, s.earned, MORE_SIMS);
  [s.selZ, s.selP] = [r.z, r.p];
  let r2 = selection(s.spells, s.earned, SIMS, "stakes");
  if (r2.p < 0.01) r2 = selection(s.spells, s.earned, MORE_SIMS, "stakes");
  s.selP2 = r2.p;
}
const timed = strategies.filter(({ switches, amount }) => switches.length > 0 && amount >= MIN_AMOUNT);
for (const s of timed) {
  let r = timing(s.switches, SIMS);
  if (r.p < 0.01) r = timing(s.switches, MORE_SIMS);
  [s.timU, s.timP] = [r.u, r.p];
}
// Benjamini–Hochberg q-values.
function bh<T>(items: T[], p: (t: T) => number, set: (t: T, q: number) => void) {
  const sorted = [...items].sort((a, b) => p(a) - p(b));
  let min = 1;
  for (let i = sorted.length - 1; i >= 0; i--) {
    min = Math.min(min, (p(sorted[i]!) * sorted.length) / (i + 1));
    set(sorted[i]!, min);
  }
}
bh(
  tested,
  (s) => s.selP,
  (s, q) => (s.selQ = q),
);
bh(
  tested,
  (s) => s.selP2,
  (s, q) => (s.selQ2 = q),
);
bh(
  timed,
  (s) => s.timP,
  (s, q) => (s.timQ = q),
);

// Population checks. With no skill anywhere, selection z-scores have mean 0 and variance about 1, and ranks of moves
// have mean 1/2.
const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
const variance = (xs: number[]) => mean(xs.map((x) => (x - mean(xs)) ** 2));
// z-scores from placebo means and spreads are dominated by a few pools paying thousands of times the average. The
// population checks use each strategy's p-value instead, as a normal quantile: Φ⁻¹(1 - p).
function probit(p: number): number {
  // Acklam's approximation of the normal quantile.
  const a = [
    -39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716, 2.506628277459239,
  ];
  const b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572];
  const c = [
    -0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968,
    2.938163982698783,
  ];
  const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];
  const q = Math.min(Math.max(p, 1e-12), 1 - 1e-12);
  if (q < 0.02425) {
    const r = Math.sqrt(-2 * Math.log(q));
    return (
      (((((c[0]! * r + c[1]!) * r + c[2]!) * r + c[3]!) * r + c[4]!) * r + c[5]!) /
      ((((d[0]! * r + d[1]!) * r + d[2]!) * r + d[3]!) * r + 1)
    );
  }
  if (q > 1 - 0.02425) return -probit(1 - q);
  const r = (q - 0.5) * (q - 0.5);
  return (
    ((((((a[0]! * r + a[1]!) * r + a[2]!) * r + a[3]!) * r + a[4]!) * r + a[5]!) * (q - 0.5)) /
    (((((b[0]! * r + b[1]!) * r + b[2]!) * r + b[3]!) * r + b[4]!) * r + 1)
  );
}
const zs = tested.map(({ selP }) => -probit(selP));
const allSwitches = timed.flatMap(({ switches }) => switches);
const meanU = mean(allSwitches.map((w) => w.u[w.actual]!));
// Its null: each move's rank drawn uniformly from its own hours.
let [nullSum, nullSq] = [0, 0];
for (const w of allSwitches) {
  const m = mean([...w.u]);
  nullSum += m;
  nullSq += variance([...w.u]);
}
const meanUz = (meanU * allSwitches.length - nullSum) / Math.sqrt(nullSq);

// Persistence: selection in the first half against selection in the second, for strategies tested in both halves.
const split = Math.floor(K / 2);
const halves = tested.flatMap((s) => {
  const clip = (lo: number, hi: number) =>
    s.spells.flatMap((sp) => {
      const [ka, kb] = [Math.max(sp.ka, lo), Math.min(sp.kb, hi)];
      return kb > ka ? [{ ...sp, ka, kb }] : [];
    });
  const [a, b] = [clip(0, split), clip(split, K - 1)];
  const hrs = (xs: Spell[]) => xs.reduce((h, sp) => h + sp.kb - sp.ka, 0);
  if (hrs(a) < MIN_HOURS / 2 || hrs(b) < MIN_HOURS / 2) return [];
  const earn = (xs: Spell[]) =>
    xs.reduce((t, sp) => t + sp.js.reduce((u, j, m) => u + sp.ws[m]! * (Y[j]![sp.kb]! - Y[j]![sp.ka]!), 0), 0);
  // Moves that start fresh in each half: the second half's spells are drawn anew, as the placebo would.
  return [{ a: selection(a, earn(a), 300).z, b: selection(b, earn(b), 300).z, weight: s.ids.length }];
});
function spearman(pairs: { a: number; b: number }[]) {
  const rank = (xs: number[]) => {
    const order = xs.map((x, i) => [x, i] as const).sort((p, q) => p[0] - q[0]);
    const r = new Array<number>(xs.length);
    order.forEach(([, i], n) => (r[i] = n));
    return r;
  };
  const [ra, rb] = [rank(pairs.map(({ a }) => a)), rank(pairs.map(({ b }) => b))];
  const [ma, mb] = [mean(ra), mean(rb)];
  let [num, da, db] = [0, 0, 0];
  for (let i = 0; i < pairs.length; i++) {
    num += (ra[i]! - ma) * (rb[i]! - mb);
    da += (ra[i]! - ma) ** 2;
    db += (rb[i]! - mb) ** 2;
  }
  return num / Math.sqrt(da * db);
}
const rho = spearman(halves);

// ---------------------------------------------------------------------------------------------------------------------
// 5. Report.
// ---------------------------------------------------------------------------------------------------------------------
const day = (k: number) => new Date(hours[k]! * 1000).toISOString().slice(0, 16).replace("T", " ");
const pct = (x: number) => `${(100 * x).toFixed(1)}%`;
const fmtP = (p: number) => (p < 1e-4 ? p.toExponential(1) : p.toFixed(4));
const names = (s: Strategy) =>
  [...new Set(s.spells.flatMap(({ js }) => js.map((j) => gauges[j]!.name)))].slice(0, 4).join(", ");
const ids = (s: Strategy) =>
  s.ids.length > 3 ? `${s.ids.slice(0, 3).join(", ")} +${s.ids.length - 3}` : s.ids.join(", ");
const unpricedPower = [...unpricedGauges].reduce((s, j) => s + Math.max(0, P[j]![K - 1]!), 0);
const marketApr = aprOf(CM[K - 1]!, K - 1);

const lines: string[] = [];
const out = (line = "") => lines.push(line);
out("# Aero allocation skill: results");
out();
out(
  `Data: ${day(0)} to ${day(K - 1)} UTC (${((K - 1) / 24).toFixed(1)} days), ${J} gauges, ${allocations.length} allocations by ${byId.size} stakes.`,
);
out(
  `Prices: one snapshot, AERO at $${aeroPrice.toFixed(4)}. Gauges paying a token without a price hold ${pct(unpricedPower / lastPower)} of today's power; that token counts as 0, for strategies and placebos alike.`,
);
out(
  `Allocations to addresses that are not gauges (the zero address and 0x2e67…6902, which has no code): ${pct(sentinelShare / allShare)} of all power allocated. Weights are taken over real gauges only.`,
);
out(
  `Average sAERO in a pool over the whole period: APR ${pct(marketApr)} at today's prices (fees ${pct(feeShare.fees / (feeShare.fees + feeShare.incentives))} of pay, incentives the rest).`,
);
out();
out(
  `Strategies: ${nfts.length} stakes, grouped into ${strategies.length} strategies (stakes with exactly the same allocations, hour by hour, are one strategy). Only strategies of at least ${MIN_AMOUNT} sAERO are tested.`,
);
out();
out("## Selection");
out();
out(`Tested: ${tested.length} strategies with at least ${MIN_HOURS} hours in pools.`);
out(
  `- Significant at FDR ${FDR} (Benjamini–Hochberg): ${tested.filter((s) => s.selQ! <= FDR).length} better than chance.`,
);
out(
  `- p < 0.05: ${pct(tested.filter((s) => s.selP < 0.05).length / tested.length)} of strategies (5% expected with no skill anywhere).`,
);
out(
  `- p-values as normal quantiles: mean ${mean(zs).toFixed(2)}, variance ${variance(zs).toFixed(2)} (about 0 and 1 with no skill anywhere).`,
);
out(
  `- Against a crowd of stakes (pools drawn by how many stakes are in them, not by their power): ${tested.filter((s) => s.selQ2! <= FDR).length} significant at FDR ${FDR}; p < 0.05 for ${pct(tested.filter((s) => s.selP2 < 0.05).length / tested.length)}.`,
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
  const group = tested.filter(({ amount }) => amount >= lo && amount < hi);
  const share = (test: (s: Strategy) => boolean) => pct(group.filter(test).length / group.length);
  out(
    `  | ${label} | ${group.length} | ${share((s) => s.selP < 0.05)} | ${share((s) => s.selP > 0.9)} | ${share((s) => s.selP2 < 0.05)} | ${share((s) => s.selP2 > 0.9)} |`,
  );
}
out();
out(
  `- Persistence: Spearman ρ between first-half and second-half selection z, ${halves.length} strategies: ${rho.toFixed(3)} (±${(1.96 / Math.sqrt(Math.max(1, halves.length - 1))).toFixed(3)} is the 95% band for 0).`,
);
out();
out("## Timing");
out();
out(`Tested: ${timed.length} strategies with ${allSwitches.length} moves that had at least two possible hours.`);
out(`- Significant at FDR ${FDR}: ${timed.filter((s) => s.timQ! <= FDR).length}.`);
out(`- p < 0.05: ${pct(timed.filter((s) => s.timP < 0.05).length / timed.length)} of strategies.`);
out(
  `- Mean rank of the hour actually chosen, over all moves: ${meanU.toFixed(3)} (0.5 with no timing skill; z = ${meanUz.toFixed(2)}).`,
);
const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[xs.length >> 1]!;
out(
  `- Gain from timing, against moving at a random possible hour, in hours of the average sAERO's pay: median ${median(allSwitches.map((w) => w.gainHours)).toFixed(1)} per move; the best possible hour would have gained a median ${median(allSwitches.map((w) => w.bestHours)).toFixed(1)}.`,
);
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
      `| ${ids(s)} | ${Math.round(s.amount).toLocaleString("en-US")} | ${names(s)} | ${(s.hoursIn / 24).toFixed(1)} | ${pct(s.apr)} | ${pct(s.marketApr)} | ${Number.isNaN(s.selP) ? "" : fmtP(s.selP)} | ${s.selQ?.toFixed(3) ?? ""} | ${s.switches.length} | ${Number.isNaN(s.timU) ? "" : s.timU.toFixed(2)} | ${Number.isNaN(s.timP) ? "" : fmtP(s.timP)} | ${s.timQ?.toFixed(3) ?? ""} |${s.thin ? " thin" : ""}`,
    );
  out();
};
top(
  [...tested]
    .filter((s) => s.hoursIn >= 7 * 24)
    .sort((a, b) => b.apr - a.apr)
    .slice(0, 25),
  "Highest APRs (at least 7 days in pools)",
);
top([...tested].sort((a, b) => b.amount - a.amount).slice(0, 15), "Largest strategies");
top([...tested].sort((a, b) => a.selP - b.selP || b.selZ - a.selZ).slice(0, 15), "Strongest selection evidence");
top([...timed].sort((a, b) => a.timP - b.timP).slice(0, 15), "Strongest timing evidence");
const autopilot = strategies.find(({ ids }) => ids.includes("20366"));
if (autopilot) top([autopilot], "Aero Autopilot USDC Maxi (stake 20366)");
out(
  '"thin" marks a strategy that held more than 25% of a pool\'s power at some point. Placebos pay the same dilution, but such pools are rarely drawn.',
);

mkdirSync(OUT, { recursive: true });
writeFileSync(new URL("summary.md", OUT), lines.join("\n") + "\n");
const csv = [
  "stakes,count,saero,pools,hours_in_pools,apr,market_apr,relative,selection_z,selection_p,selection_q,selection_p_stakes,selection_q_stakes,moves,timing_rank,timing_p,timing_q,thin",
  ...strategies.map((s) =>
    [
      s.ids.join(" "),
      s.ids.length,
      s.amount,
      `"${names(s)}"`,
      s.hoursIn,
      s.apr,
      s.marketApr,
      s.relative,
      s.selZ,
      s.selP,
      s.selQ ?? "",
      s.selP2,
      s.selQ2 ?? "",
      s.switches.length,
      s.timU,
      s.timP,
      s.timQ ?? "",
      s.thin,
    ]
      .map((v) => (typeof v === "number" && !Number.isInteger(v) ? Number(v.toPrecision(5)) : v))
      .join(","),
  ),
];
writeFileSync(new URL("strategies.csv", OUT), csv.join("\n") + "\n");
console.log(lines.join("\n"));
