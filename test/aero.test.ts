import assert from "node:assert/strict";
import { test } from "node:test";
import { zeroAddress, type Address } from "viem";
import {
  DAY,
  THIN,
  WINDOWS,
  accruedFrom,
  amountOf,
  average,
  averageOver,
  earnedBy,
  feesPerDay,
  isThin,
  movesAt,
  paidBy,
  pendingOf,
  per10k,
  pricedByPools,
  readMarket,
  readUniverse,
  sharesOf,
  universeReads,
  stakeOf,
  stitched,
  streamPerDay,
  totalsOf,
  meanOf,
  weightOf,
  windowFees,
  type Accrued,
  type Gauge,
  type Market,
  type Point,
  type Program,
  type Stake,
  type Start,
} from "../src/aero.ts";
import { AERO, GAUGE_FACTORIES, USDC, WETH } from "../src/config.ts";
import { money, moneyAt } from "../src/format.ts";
import { key, type Prices, type Token } from "../src/prices.ts";
import { same, type Call, type Read } from "../src/rpc.ts";

const NOW = 1_793_736_000;
const TODAY = NOW - (NOW % DAY);
const SAERO = 10n ** 18n;
const usdc: Token = { address: USDC, decimals: 6, symbol: "USDC" };
const weth: Token = { address: WETH, decimals: 18, symbol: "WETH" };
const aero: Token = { address: AERO, decimals: 18, symbol: "AERO" };
const other: Token = { address: "0x00000000000000000000000000000000000000aa", decimals: 18, symbol: "OTHER" };
const prices = (of: [Token, number][]): Prices => ({
  unit: "USD",
  of: new Map(of.map(([token, price]) => [key(token.address), price])),
  standIns: new Map(),
});
const PRICES = prices([
  [usdc, 1],
  [weth, 2_000],
  [aero, 0.6],
]);

// 10,000 sAERO earn the accumulator's growth / 100, so a growth of 100 × 10^6 pays them 1 USDC.
const accrued = (usdcUnits: bigint, days = 1, power = 5_000_000n * SAERO): Accrued => ({
  from: NOW - days * DAY,
  to: NOW,
  fees0: usdcUnits * 100n,
  fees1: 0n,
  power,
  endPower: power,
  spread: undefined,
});
const end = (power = 5_000_000n * SAERO): Point => ({ at: NOW, acc: [0n, 0n], share: 0n, zero: 0, power });
let next = 0;
function gauge(fields: Partial<Gauge> & { perDay?: number } = {}): Gauge {
  const { perDay = 1, ...rest } = fields;
  const address = `0x${(++next).toString(16).padStart(40, "0")}` as Address;
  const grown = (days: number) => accrued(BigInt(Math.round(perDay * days * 1e6)), days);
  return {
    address,
    pool: address,
    rewards: address,
    kind: "cl",
    tickSpacing: 100,
    token0: usdc,
    token1: weth,
    name: "USDC / WETH CL100",
    activated: true,
    cap: SAERO,
    power: 5_000_000n * SAERO,
    end: end(),
    first: NOW - 30 * DAY,
    windows: { 24: grown(1), 48: grown(2), 168: grown(7) },
    programs: [],
    programCount: 0,
    ...rest,
  };
}
const market = (gauges: Gauge[], of = PRICES): Market => ({
  time: NOW,
  cooldown: 169_200,
  maxGauges: 20,
  gauges,
  prices: of,
  unread: [],
  unknown: [],
});
// Answers each call from `answer`, and records what each read asked.
type Asked = { names: Set<string>; perBatch: number | undefined };
function fake(answer: (call: Call) => unknown, asked: Asked[] = []): Read {
  return (async (calls: readonly Call[], options?: { perBatch?: number }) => {
    asked.push({ names: new Set(calls.map(({ functionName }) => functionName)), perBatch: options?.perBatch });
    return calls.map(answer);
  }) as Read;
}

test("fees per 10,000 sAERO a day come from the accumulator's growth over the time it grew", () => {
  const g = gauge();
  assert.deepEqual(feesPerDay(g, accrued(2_000_000n, 2), PRICES), { value: 1, priced: true });
  const both = { ...accrued(1_000_000n), fees1: 10n ** 15n * 100n };
  assert.deepEqual(feesPerDay(g, both, PRICES), { value: 1 + 2, priced: true }, "0.001 WETH at $2,000");
  assert.deepEqual(feesPerDay(gauge({ token1: other }), both, PRICES), { value: 1, priced: false });
  assert.equal(feesPerDay(g, { ...accrued(1n), from: NOW }, PRICES), undefined, "no time, no yield");
});

test("a pool whose power dipped pays exactly what it paid, and is thin and weighs little for it", () => {
  // 5M sAERO at both ends, but a harmonic mean of 50k over the day: a dip to dust.
  const dipped = gauge({ perDay: 1_000 });
  dipped.windows[24] = { ...dipped.windows[24], spread: 50_000 };
  assert.equal(feesPerDay(dipped, dipped.windows[24], PRICES)!.value, 1_000, "exactly what it paid");
  assert.ok(isThin(dipped, 24) && !isThin(gauge(), 24));
  assert.equal(weightOf(dipped.windows[24]), 50_000);
  const steady = gauge({ perDay: 2 });
  const mixed = averageOver(market([steady, dipped]), 24);
  assert.ok(mixed.fees > 2 && mixed.fees < 12, `the dip weighs a hundredth: ${mixed.fees}`);
  // Lower power, but not next to nothing, leaves it as it is.
  const lower = gauge();
  lower.windows[24] = { ...lower.windows[24], spread: 2_500_000 };
  assert.ok(!isThin(lower, 24) && weightOf(lower.windows[24]) === 2_500_000);
  // From the accumulators: a day at 50k sAERO adds 86,400 × 1e42 / (50k × 1e18).
  const share = (86_400n * 10n ** 42n) / (50_000n * SAERO);
  const start: Start = { index: 3n, acc: [0n, 0n], ts: NOW - DAY, share: 0n, zero: 0, supply: 5_000_000n * SAERO };
  const found = accruedFrom(start, NOW - 9 * DAY, { ...end(), share });
  assert.ok(Math.abs(found.spread! - 50_000) < 1e-6, String(found.spread));
  const idle = accruedFrom(start, NOW - 9 * DAY, { ...end(), share, zero: 43_200 });
  assert.ok(Math.abs(idle.spread! - 25_000) < 1e-6, "seconds without power do not count");
  // From a checkpoint four days before the window, the mean still covers only the window.
  const old: Start = { ...start, ts: NOW - 5 * DAY, time: NOW - DAY, supply: 8_000_000n * SAERO };
  const window = accruedFrom(old, NOW - 9 * DAY, {
    ...end(),
    share: (4n * 86_400n * 10n ** 42n) / (8_000_000n * SAERO) + share,
  });
  assert.equal(window.from, NOW - 5 * DAY, "fees accrue from the checkpoint");
  assert.ok(Math.abs(window.spread! - 50_000) < 1e-6, `the mean is the window's: ${window.spread}`);
});

test("a window counts only if the gauge's history covers most of it", () => {
  const young = gauge({ windows: { ...gauge().windows, 168: accrued(3_000_000n, 3) } });
  assert.equal(windowFees(young, 168, PRICES), undefined);
  assert.deepEqual(windowFees(young, 48, PRICES), { value: 1, priced: true });
});

test("an accrual starts at the checkpoint before it, or from nothing at the first one, or not at all if unread", () => {
  const now = { ...end(9n), acc: [500n, 70n] as const };
  const start: Start = { index: 7n, acc: [200n, 20n, 0n, 0n], ts: NOW - DAY, share: 0n, zero: 0, supply: 3n };
  const found = accruedFrom(start, NOW - 9 * DAY, now);
  assert.deepEqual(
    [found.from, found.to, found.fees0, found.fees1, found.power, found.endPower],
    [NOW - DAY, NOW, 300n, 50n, 3n, 9n],
  );
  const none: Start = { index: 0n, acc: [0n, 0n, 0n, 0n], ts: 0, share: 0n, zero: 0, supply: 0n };
  const young = accruedFrom(none, NOW - 2 * DAY, now);
  assert.deepEqual([young.from, young.fees0, young.fees1], [NOW - 2 * DAY, 500n, 70n]);
  const unread: Start = { index: 7n, acc: undefined, ts: undefined, share: undefined, zero: undefined, supply: 3n };
  assert.equal(accruedFrom(unread, NOW - 9 * DAY, now).fees0, 0n);
  assert.equal(accruedFrom({ ...start, supply: undefined }, 0, now).power, 9n, "an unread power is the end's");
});

test("a pool's days run between checkpoints, merge days without one, and start at its first checkpoint", () => {
  const first = TODAY - 3 * DAY + 3_600;
  const g = gauge({ first, end: { ...end(), acc: [900n, 0n] } });
  const at = (index: bigint, ts: number, acc: bigint): Start => ({
    index,
    acc: [acc, 0n],
    ts,
    share: 0n,
    zero: 0,
    supply: 5_000_000n * SAERO,
  });
  const bounds = [0, 1, 2, 3].map((k) => TODAY - k * DAY);
  const quiet = at(3n, TODAY - 3 * DAY + 5 * 3_600, 100n);
  const starts = [at(5n, TODAY - 7_200, 500n), quiet, quiet, at(0n, 0, 0n)];
  const rows = stitched(g, bounds, starts).map(({ day, days, from, to, fees0 }) => [day, days, from, to, fees0]);
  assert.deepEqual(rows, [
    [TODAY, 1, TODAY - 7_200, NOW, 400n],
    [TODAY - 2 * DAY, 2, quiet.ts, TODAY - 7_200, 400n],
    [TODAY - 3 * DAY, 1, first, quiet.ts, 100n],
  ]);
  const born = gauge({ first: TODAY + 3_600, end: { ...end(), acc: [50n, 0n] } });
  const today = stitched(born, [TODAY], [at(0n, 0, 0n)]);
  assert.deepEqual(
    today.map(({ day, from, fees0 }) => [day, from, fees0]),
    [[TODAY, TODAY + 3_600, 50n]],
    "a gauge made today shows today",
  );
  assert.deepEqual(stitched(gauge({ first: 0 }), [TODAY], [at(0n, 0, 0n)]), [], "no checkpoint, no history");
});

test("incentives stream only while live, and sAERO a visitor adds shares both fees and incentives", () => {
  // In USDC units a second, scaled by 1e18.
  const rate = (perDay: number) => (BigInt(perDay) * 10n ** 24n) / BigInt(DAY);
  const program = (start: number, end: number, perDay: number): Program => ({
    id: 1n,
    token: usdc,
    rate: rate(perDay),
    start,
    end,
  });
  const g = gauge({
    perDay: 2,
    power: 1_000_000n * SAERO,
    programs: [program(NOW - DAY, NOW + DAY, 100), program(NOW - 9 * DAY, NOW - DAY, 1_000)],
  });
  assert.ok(Math.abs(streamPerDay(g, NOW, PRICES).value - 100) < 1e-6);
  const alone = per10k(g, 48, NOW, PRICES)!;
  assert.ok(Math.abs(alone.fees - 2) < 1e-9 && Math.abs(alone.incentives - 1) < 1e-6, "$100 a day over 1M sAERO");
  const shared = per10k(g, 48, NOW, PRICES, 1_000_000)!;
  assert.ok(Math.abs(shared.fees - 1) < 1e-9 && Math.abs(shared.incentives - 0.5) < 1e-6);
  assert.equal(per10k(gauge({ power: 0n }), 48, NOW, PRICES), undefined);
});

test("the average weighs each gauge by its least power, and leaves out gauges paying tokens without a price", () => {
  const steady = gauge({ perDay: 2 });
  const surge = gauge({ perDay: 1_000_000 });
  surge.windows[48] = { ...surge.windows[48], power: SAERO };
  const found = averageOver(market([steady, surge]), 48);
  assert.ok(found.fees > 2 && found.fees < 2.3, String(found.fees));
  assert.ok(isThin(surge, 48) && !isThin(steady, 48));
  const emptied = gauge();
  emptied.windows[48] = { ...emptied.windows[48], endPower: BigInt(THIN - 1) * SAERO };
  assert.ok(isThin(emptied, 48), "thin at the end too");
  const unpriced = gauge({ perDay: 0, token1: other });
  unpriced.windows[48] = { ...unpriced.windows[48], fees1: 10n ** 20n };
  assert.equal(averageOver(market([steady, unpriced]), 48).fees, 2, "not counted at nothing");
  assert.equal(average(market([]), () => undefined).total, 0);
});

const stake = (fields: Partial<Stake> = {}): Stake => ({
  id: 1n,
  owner: zeroAddress,
  amount: 100n * SAERO,
  end: 0,
  permanent: true,
  approved: zeroAddress,
  module: false,
  onBase: 100n * SAERO,
  idle: 0n,
  elsewhere: 0n,
  lastAllocated: NOW - DAY,
  reduction: 0,
  allocations: [],
  ...fields,
});

test("Base's fees count each pool at its mean power, and its incentives only those paid to some sAERO", () => {
  const growing = gauge({ perDay: 10 });
  growing.windows[24] = {
    ...growing.windows[24],
    power: 2_000_000n * SAERO,
    endPower: 4_000_000n * SAERO,
    spread: 3e6,
  };
  const rate = (BigInt(1_000) * 10n ** 24n) / BigInt(DAY);
  const program = { id: 1n, token: usdc, rate, start: NOW - DAY, end: NOW + DAY };
  const empty = gauge({ perDay: 0, power: 0n, programs: [program] });
  const paid = gauge({ programs: [program] });
  const totals = totalsOf(market([growing, empty, paid]));
  assert.ok(Math.abs(totals.fees.value - (10 * 300 + 1 * 500)) < 1e-6, `fees ${totals.fees.value}`);
  assert.ok(Math.abs(totals.incentives.value - 1_000) < 1e-6, `incentives ${totals.incentives.value}`);
  assert.equal(meanOf(growing.windows[24]), 3e6);
  assert.equal(meanOf({ ...growing.windows[24], spread: undefined }), 2e6, "else the least of either end");
});

test("a stake moves 47 hours after it last allocated, less any reduction, or now if it never did", () => {
  assert.equal(movesAt(stake(), 169_200), NOW - DAY + 169_200);
  assert.equal(movesAt(stake({ reduction: 3_600 }), 169_200), NOW - DAY + 165_600);
  assert.equal(movesAt(stake({ lastAllocated: 0 }), 169_200), 0);
});

test("a stake's sAERO is on Base, idle on no chain, or on the other chains", () => {
  const found = stakeOf({
    id: 7n,
    staked: { amount: 10n * SAERO, end: 0, isPermanent: true },
    owner: zeroAddress,
    approved: undefined,
    module: true,
    state: [zeroAddress, NOW - DAY, false, 5n * SAERO],
    reduction: undefined,
    chains: [
      [0n, SAERO],
      [8453n, 5n * SAERO],
      [57073n, 3n * SAERO],
      [1n, SAERO],
    ],
    allocations: [],
  });
  assert.deepEqual(
    [found.onBase, found.idle, found.elsewhere, found.lastAllocated, found.reduction, found.approved, found.module],
    [5n * SAERO, SAERO, 4n * SAERO, NOW - DAY, 0, zeroAddress, true],
  );
});

test("a stake earns its pools' yields by its share in each, and its power on the zero gauge earns nothing", () => {
  const [a, b] = [gauge({ perDay: 4 }), gauge({ perDay: 1 })];
  const m = market([a, b]);
  const shares = sharesOf(
    stake({
      allocations: [
        { gauge: b.address, amount: 25n * SAERO },
        { gauge: a.address, amount: 50n * SAERO },
        { gauge: zeroAddress, amount: 25n * SAERO },
      ],
    }),
    m,
  );
  assert.deepEqual(
    shares.map(({ address, share }) => [address, share]),
    [
      [a.address, 0.5],
      [b.address, 0.25],
      [zeroAddress, 0.25],
    ],
  );
  assert.deepEqual(
    earnedBy(shares, (g) => g.windows[24], PRICES),
    { value: 2 + 0.25, priced: true },
  );
  assert.ok(Math.abs(paidBy(shares, m, 48)!.value - 2.25) < 1e-9);
  const young = gauge({ windows: { ...gauge().windows, 48: accrued(1n, 1) } });
  assert.equal(
    paidBy(sharesOf(stake({ allocations: [{ gauge: young.address, amount: SAERO }] }), m), m, 48),
    undefined,
  );
});

test("what a stake can claim adds up by token, in small reads, and says when some of it was not counted", async () => {
  const program = (id: bigint): Program => ({ id, token: aero, rate: 1n, start: 0, end: NOW + DAY });
  const g = gauge({ programs: [program(3n), program(2n)], programCount: 2 });
  const others = Array.from({ length: 30 }, (_, i) => program(100n + BigInt(i)));
  const crowded = gauge({ programs: others, programCount: 80 });
  const own = stake({ allocations: [{ gauge: g.address, amount: SAERO }] });
  const busy = stake({ id: 2n, allocations: [{ gauge: crowded.address, amount: SAERO }] });
  const asked: Asked[] = [];
  const read = fake(({ functionName, args }) => {
    switch (functionName) {
      case "earnedFees":
        return [5n, 10n ** 15n];
      case "earnedIncentives":
        return args[1] === 2n ? 7n : 0n;
      case "userRewardCheckpointIndex":
        return 9n;
      case "feeClaimState":
        return { lastGlobalCp: 0n, lastUserCp: 4n };
    }
  }, asked);
  const found = await pendingOf([own, busy], market([g, crowded]), read);
  const mine = found.get(1n)!;
  assert.deepEqual(
    [...mine.amounts.values()].map(({ token, amount }) => [token.symbol, amount]),
    [
      ["USDC", 5n],
      ["WETH", 10n ** 15n],
      ["AERO", 7n],
    ],
  );
  assert.equal(mine.partial, false);
  assert.equal(found.get(2n)!.partial, true, "80 programs, 30 read");
  const heavy = asked.filter(({ names }) => names.has("earnedFees") || names.has("earnedIncentives"));
  assert.equal(heavy.length, 2);
  assert.ok(
    heavy.every(({ perBatch }) => perBatch !== undefined && perBatch <= 20),
    "estimates go 20 to a read",
  );
  const failing = fake(({ functionName }) => (functionName === "earnedFees" ? undefined : 0n));
  assert.equal((await pendingOf([own], market([g]), failing)).get(1n)!.partial, true);
  const behind = fake(({ functionName }) =>
    functionName === "userRewardCheckpointIndex" ? 900n : functionName === "feeClaimState" ? { lastUserCp: 1n } : 0n,
  );
  assert.equal((await pendingOf([own], market([g]), behind)).get(1n)!.partial, true, "more checkpoints than walked");
});

test("pools price tokens outward from the prices known, each through its deepest pool that is deep enough", () => {
  const tok = (n: number, decimals = 18): Token => ({
    address: `0x${n.toString(16).padStart(40, "0")}`,
    decimals,
    symbol: `T${n}`,
  });
  const [t1, t2, t3] = [tok(1), tok(2), tok(3)];
  const anchors = prices([[usdc, 1]]);
  const found = pricedByPools(anchors, [
    // t1 at 2 USDC in a deep pool, and at 5 in a shallower one.
    { token0: t1, token1: usdc, price0: 2, reserve0: 50_000, reserve1: 100_000 },
    { token0: usdc, token1: t1, price0: 1 / 5, reserve0: 5_000, reserve1: 1_000 },
    // t2 only through t1, at 3 t1.
    { token0: t2, token1: t1, price0: 3, reserve0: 1_000, reserve1: 3_000 },
    // t3 in a pool too thin to price it.
    { token0: t3, token1: usdc, price0: 10, reserve0: 10, reserve1: 100 },
  ]);
  assert.equal(found.of.get(key(t1.address)), 2);
  assert.equal(found.of.get(key(t2.address)), 6);
  assert.equal(found.of.has(key(t3.address)), false);
  assert.equal(found.of.get(key(USDC)), 1, "an anchor keeps its feed's price");
  assert.equal(anchors.of.size, 1, "the prices given are left alone");
});

test("an amount typed in sAERO: digits, with a dot for decimals", () => {
  const cases: [string, number][] = [
    ["", 0],
    ["1500", 1_500],
    [" 1 000 000 ", 1_000_000],
    ["2.5", 2.5],
    ["2.125", 2.125],
    [".5", 0.5],
    ["10.", 10],
  ];
  for (const [text, value] of cases) assert.equal(amountOf(text), value, text);
  for (const bad of ["1,000", "2,5", "1.000.000", "1e6", "-5", "0x10", "lots", "1".repeat(400)])
    assert.equal(amountOf(bad), undefined, bad);
});

test("a sum that leaves something out reads as a floor", () => {
  const usd = (value: number) => moneyAt(value, { unit: "USD" });
  assert.equal(money(usd(2.5), true, true), "≥ $2.50");
  assert.equal(money(usd(0.001), true, true), "≥ $0.00");
  assert.equal(money(usd(0), true, true), "≥ $0.00");
  assert.equal(money(usd(2.5), true), "≈ $2.50");
});

test("each gauge's windows run from its own snapshots to its own latest checkpoint, carried on to now", async () => {
  const listed = [0, 1].map((n) => {
    const address = `0x${(0xa0 + n).toString(16).padStart(40, "0")}` as Address;
    return {
      address,
      kind: "cl" as const,
      pool: address,
      rewards: address,
      token0: usdc,
      token1: weth,
      tickSpacing: 1,
    };
  });
  // Gauge i has power (i + 1)M, its window k starts at checkpoint 10i + 2 + k, and its latest is 10i + 9, a day old.
  const n = (address: string) => listed.findIndex((each) => same(each.rewards, address));
  const power = (i: number) => BigInt(i + 1) * 1_000_000n * SAERO;
  const at = (index: bigint) => Number(index % 10n);
  const read = fake(({ address, functionName, args }) => {
    const i = n(address);
    switch (functionName) {
      case "getCurrentBlockTimestamp":
        return BigInt(NOW);
      case "allocationCooldown":
        return 169_200;
      case "maxGauges":
        return 20n;
      case "latestRoundData":
        return [1n, 100_000_000n, 0n, BigInt(NOW), 1n];
      case "emissionCap":
        return SAERO;
      case "isActivated":
        return true;
      case "totalSupply":
        return power(i);
      case "feeRewardPerVotingPower":
        return [BigInt(1_000 * (i + 1)), 0n, 0n, 0n];
      case "incentiveCount":
        return 0n;
      case "globalCheckpointIndex":
        return BigInt(10 * i + 9);
      case "getPriorSupplyIndex":
        return BigInt(10 * i + 2 + WINDOWS.findIndex((hours) => BigInt(NOW - hours * 3_600) === args[0]));
      case "supplyAt":
        return power(i);
      case "feeRewardPerVotingPowerAt":
        return [BigInt(100 * at(args[0] as bigint) + 7 * i), 0n, 0n, 0n];
      case "globalRewardPointHistory": {
        const index = args[0] as bigint;
        const ts = index === 1n ? NOW - 30 * DAY : at(index) === 9 ? NOW - DAY : NOW - WINDOWS[at(index) - 2]! * 3_600;
        return { bias: 0n, slope: 0n, ts, permanentStakeBalance: 0n, zeroSupplySeconds: 0 };
      }
      case "supplyAccumulatorAt":
        return [BigInt(at(args[0] as bigint)) * 10n ** 30n + BigInt(i) * 10n ** 29n, 0n];
      case "slot0":
        return [0n, 0, 0, 0, 0, true];
      case "balanceOf":
        return 10n ** 30n;
    }
  });
  const found = await readMarket({ gauges: listed, unread: [], unknown: [] }, read);
  assert.deepEqual(found.unread, []);
  for (const [i, gauge] of found.gauges.entries()) {
    const shared = 9n * 10n ** 30n + BigInt(i) * 10n ** 29n + (BigInt(DAY) * 10n ** 42n) / power(i);
    assert.deepEqual([gauge.end.at, gauge.end.share, gauge.end.power], [NOW, shared, power(i)], `gauge ${i}'s end`);
    for (const [k, hours] of WINDOWS.entries()) {
      const window = gauge.windows[hours];
      assert.deepEqual(
        [window.from, window.fees0],
        [NOW - hours * 3_600, BigInt(1_000 * (i + 1) - 100 * (k + 2) - 7 * i)],
        `gauge ${i}, ${hours} h`,
      );
    }
  }
});

test("a Slipstream gauge whose tick spacing cannot be read is unread, not named CL0", async () => {
  const cl = GAUGE_FACTORIES.find(({ kind }) => kind === "cl")!.address;
  const stranger = "0x00000000000000000000000000000000000000f0";
  const [named, unnamed] = [
    "0x00000000000000000000000000000000000000c1",
    "0x00000000000000000000000000000000000000c2",
  ] as const;
  const read = fake(({ address, functionName, args }) => {
    switch (functionName) {
      case "gaugeFactories":
        return [cl, stranger];
      case "factoryToGauges":
        return [named, unnamed];
      case "gaugeToTarget":
      case "gaugeToRewards":
        return args[0];
      case "token0":
        return USDC;
      case "token1":
        return WETH;
      case "tickSpacing":
        return same(address, named) ? 100 : undefined;
    }
  });
  const universe = await readUniverse(read);
  assert.deepEqual(
    universe.gauges.map(({ address, tickSpacing }) => [address, tickSpacing]),
    [[named, 100]],
  );
  assert.deepEqual([universe.unread, universe.unknown], [[unnamed], [stranger]]);
});

test("a universe with unread gauges is read again soon three times in a row, then hourly, until all of them read", async () => {
  const [MINUTES_5, HOUR] = [5 * 60_000, 60 * 60_000];
  const of = (unread: Address[]) => ({ gauges: [], unread, unknown: [] });
  const answers = [of(["0x00000000000000000000000000000000000000c2"]), of([])];
  let answer = answers[0]!;
  const { read, ttl } = universeReads(async () => answer);
  const ttls: number[] = [];
  for (let i = 0; i < 5; i++) ttls.push(ttl(await read()));
  // Read 1 leaves a gauge unread; reads 2, 3 and 4 come five minutes apart; read 4 then holds an hour.
  assert.deepEqual(ttls, [MINUTES_5, MINUTES_5, MINUTES_5, HOUR, HOUR]);
  answer = answers[1]!;
  assert.equal(ttl(await read()), HOUR, "all read");
  answer = answers[0]!;
  assert.equal(ttl(await read()), MINUTES_5, "a new failure starts over");
});
