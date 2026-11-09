import assert from "node:assert/strict";
import { test } from "node:test";
import { decodeFunctionData, encodeErrorResult, getAddress, zeroAddress, type Address } from "viem";
import { aeroVoterAbi, allocateErrorsAbi } from "../src/abi.ts";
import {
  DAY,
  THIN,
  WINDOWS,
  accruedFrom,
  aprOf,
  aprOver,
  heldIn,
  payOf,
  allocateCall,
  allotmentsOf,
  amountOf,
  blockedOf,
  budgetOf,
  average,
  averageOver,
  dayOf,
  earnedBy,
  heldOver,
  marketOver,
  paidOver,
  gridOf,
  unreadStart,
  STEP,
  paysNext,
  per10kOf,
  picksOf,
  refusalOf,
  feesPerDay,
  isThin,
  movesAt,
  paidBy,
  pendingOf,
  per10k,
  readMarket,
  readUniverse,
  sharesOf,
  universeReads,
  stakeOf,
  startsAt,
  stitched,
  streamPerDay,
  meanOf,
  nameOf,
  weightOf,
  windowFees,
  averageSteps,
  customSteps,
  isBlueChip,
  mergePast,
  movedSteps,
  movesOf,
  stepsOf,
  strategySteps,
  timesFor,
  totalOf,
  accrualOf,
  type Accrued,
  type Gauge,
  type Market,
  type Move,
  type Paid,
  type Past,
  type Point,
  type Program,
  type Stake,
  type Start,
} from "../src/aero.ts";
import { AERO, AERO_VOTER, GAUGE_FACTORIES, USDC, WETH } from "../src/config.ts";
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
    windows: { 48: grown(2), 96: grown(4), 192: grown(8) },
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
  past: { times: [], starts: new Map() },
});
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
  // 5M sAERO at both ends, but a harmonic mean of 50k over the 48 hours: a dip to dust.
  const dipped = gauge({ perDay: 1_000 });
  dipped.windows[48] = { ...dipped.windows[48], spread: 50_000 };
  assert.equal(feesPerDay(dipped, dipped.windows[48], PRICES)!.value, 1_000, "exactly what it paid");
  assert.ok(isThin(dipped, 48) && !isThin(gauge(), 48));
  assert.equal(weightOf(dipped.windows[48]), 50_000);
  const steady = gauge({ perDay: 2 });
  const mixed = averageOver(market([steady, dipped]), 48);
  assert.ok(mixed.fees > 2 && mixed.fees < 12, `the dip weighs a hundredth: ${mixed.fees}`);
  // Lower power, but not next to nothing, leaves it as it is.
  const lower = gauge();
  lower.windows[48] = { ...lower.windows[48], spread: 2_500_000 };
  assert.ok(!isThin(lower, 48) && weightOf(lower.windows[48]) === 2_500_000);
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
  const young = gauge({ windows: { ...gauge().windows, 192: accrued(3_000_000n, 3) } });
  assert.equal(windowFees(young, 192, PRICES), undefined);
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

test("an APR is a year of what 10,000 sAERO earn a day, over what 10,000 AERO are worth", () => {
  // $2 a day, a year of days, over 10,000 AERO at $0.60.
  near(aprOf(2, PRICES)!, (2 * 365) / (10_000 * 0.6));
  assert.equal(aprOf(2, prices([[usdc, 1]])), undefined, "without a price for AERO");
});

test("a pool's mean power is the harmonic mean of its sAERO, else the least of either end", () => {
  const growing = gauge().windows[48];
  const window = { ...growing, power: 2_000_000n * SAERO, endPower: 4_000_000n * SAERO, spread: 3e6 };
  assert.equal(meanOf(window), 3e6);
  assert.equal(meanOf({ ...window, spread: undefined }), 2e6, "else the least of either end");
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
    earnedBy(shares, (g) => g.windows[48], PRICES),
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
  // A pool the market could not read is not counted, and says so; the zero gauge has nothing to count.
  const [unseen, idle] = [gauge().address, zeroAddress];
  const both = (other: Address) =>
    stake({
      allocations: [
        { gauge: g.address, amount: SAERO },
        { gauge: other, amount: SAERO },
      ],
    });
  assert.equal((await pendingOf([both(unseen)], market([g]), read)).get(1n)!.partial, true, "a pool not read");
  assert.equal((await pendingOf([both(idle)], market([g]), read)).get(1n)!.partial, false, "the zero gauge");
});

test("pools must be deep enough for a day of what the gauges pay: the most a window paid in a day, and live streams", () => {
  // 5M sAERO earned growth × 5M / 1e6 = 5 × the growth: 1 USDC per 10k sAERO a day is 500 USDC a day in all.
  const steady = gauge();
  // A busier last day: 4 USDC per 10k sAERO, and 1 a day over the week.
  const busy = gauge({ perDay: 1 });
  busy.windows[48] = accrued(4_000_000n);
  const program = (rate: bigint, start: number, end: number): Program => ({ id: 1n, token: aero, rate, start, end });
  // 2 AERO a second while live, and one that ended.
  steady.programs = [program(2n * 10n ** 18n * 10n ** 18n, NOW - DAY, NOW + DAY), program(10n ** 36n, 0, NOW - 1)];
  const day = dayOf([steady, busy], NOW);
  assert.equal(day.get(key(USDC)), (500n + 2_000n) * 10n ** 6n);
  assert.equal(day.get(key(AERO)), 2n * 86_400n * 10n ** 18n);
  assert.equal(day.has(key(WETH)), false, "nothing paid, nothing to price");
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

test("each gauge's windows run from its own snapshots to its own latest checkpoint, carried on to now, priced meanwhile", async () => {
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
  // Gauge i has power (i + 1)M, its snapshot at the grid's time k is checkpoint 10i + 2 + k, and its latest is
  // 10i + 9, a day old.
  const grid = gridOf(NOW);
  const n = (address: string) => listed.findIndex((each) => same(each.rewards, address));
  const power = (i: number) => BigInt(i + 1) * 1_000_000n * SAERO;
  const at = (index: bigint) => Number(index % 10n);
  const asked: Asked[] = [];
  const answer = ({ address, functionName, args = [] }: Call) => {
    const i = n(address);
    switch (functionName) {
      case "getCurrentBlockTimestamp":
        return BigInt(NOW);
      case "getBlockNumber":
        return 1_000n;
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
        return BigInt(10 * i + 2 + grid.times.indexOf(Number(args[0])));
      case "supplyAt":
        return power(i);
      case "feeRewardPerVotingPowerAt":
        return [BigInt(100 * at(args[0] as bigint) + 7 * i), 0n, 0n, 0n];
      case "globalRewardPointHistory": {
        const index = args[0] as bigint;
        const ts = index === 1n ? NOW - 30 * DAY : at(index) === 9 ? NOW - DAY : grid.times[at(index) - 2]!;
        return { bias: 0n, slope: 0n, ts, permanentStakeBalance: 0n, zeroSupplySeconds: 0 };
      }
      case "supplyAccumulatorAt":
        return [BigInt(at(args[0] as bigint)) * 10n ** 30n + BigInt(i) * 10n ** 29n, 0n];
    }
  };
  const read = fake(answer, asked);
  const found = await readMarket({ gauges: listed, unread: [], unknown: [] }, read);
  assert.deepEqual(found.unread, []);
  // Pricing does not wait for the gauges: it asks for the newest block before the windows' snapshots are read.
  const first = (name: string) => asked.findIndex(({ names }) => names.has(name));
  assert.ok(first("getBlockNumber") >= 0 && first("getBlockNumber") < first("feeRewardPerVotingPowerAt"));
  for (const [i, gauge] of found.gauges.entries()) {
    const shared = 9n * 10n ** 30n + BigInt(i) * 10n ** 29n + (BigInt(DAY) * 10n ** 42n) / power(i);
    assert.deepEqual([gauge.end.at, gauge.end.share, gauge.end.power], [NOW, shared, power(i)], `gauge ${i}'s end`);
    for (const hours of WINDOWS) {
      const window = gauge.windows[hours];
      const k = grid.times.indexOf(NOW - hours * 3_600);
      assert.deepEqual(
        [window.from, window.fees0],
        [NOW - hours * 3_600, BigInt(1_000 * (i + 1) - 100 * (k + 2) - 7 * i)],
        `gauge ${i}, ${hours} h`,
      );
    }
    // The record's snapshots are the same reads.
    assert.deepEqual(
      found.past.starts.get(gauge.rewards.toLowerCase())!.map((start) => start?.index),
      grid.record.map((time) => BigInt(10 * i + 2 + grid.times.indexOf(time))),
    );
  }
  assert.deepEqual(found.past.times, grid.record);
  const snapshots = asked.filter(({ names }) => names.has("getPriorSupplyIndex")).length;
  assert.equal(snapshots, 1, "every time's snapshots in one read");
  // A gauge whose program count fails is left out, rather than taken to pay no incentives.
  const uncounted = fake((call) =>
    call.functionName === "incentiveCount" && n(call.address) === 1 ? undefined : answer(call),
  );
  const partly = await readMarket({ gauges: listed, unread: [], unknown: [] }, uncounted);
  assert.deepEqual(
    [partly.gauges.map(({ address }) => address), partly.unread],
    [[listed[0]!.address], [listed[1]!.address]],
  );
});

test("a snapshot whose checkpoint could not be found is unread, not one from before the first checkpoint", async () => {
  const g = gauge();
  const asked: Asked[] = [];
  const read = fake(({ functionName }) => (functionName === "supplyAt" ? 5_000_000n * SAERO : undefined), asked);
  const [start] = await startsAt([g.rewards], [BigInt(TODAY)], read);
  assert.equal(start!.index, undefined);
  assert.ok(unreadStart(start!), "so it is read again");
  assert.ok(
    !asked.some(({ names }) => names.has("feeRewardPerVotingPowerAt")),
    "nothing read at an unknown checkpoint",
  );
  assert.equal(accruedFrom(start!, g.first, g.end).fees0, 0n);
  assert.deepEqual(stitched(g, [TODAY], [start!]), [], "a pool's history stops there");
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

// In USDC units a second, scaled by 1e18.
const streaming = (perDay: number, start: number, end: number): Program => ({
  id: 1n,
  token: usdc,
  rate: (BigInt(perDay) * 10n ** 24n) / BigInt(DAY),
  start,
  end,
});
const HOLD = 169_200;
const near = (a: number, b: number, what = "") => assert.ok(Math.abs(a - b) < 1e-6, `${what} ${a} ≠ ${b}`);

test("ahead, a pool pays its window's fees again, shared by its sAERO now, and only the incentives that stream over the hold", () => {
  // $2 per 10k a day at 5M sAERO is $1,000 a day in all; now it has 10M.
  const g = gauge({ perDay: 2, power: 10_000_000n * SAERO, programs: [streaming(1_000, NOW - DAY, NOW + DAY / 2)] });
  const next = paysNext(g, 48, market([g]), HOLD)!;
  const found = per10kOf(next)!;
  near(found.fees, 1, "fees halve as the sAERO doubles");
  // Half a day of $1,000 over a 47-hour hold.
  near(found.incentives, ((1_000 * 0.5) / (HOLD / DAY)) * (10_000 / 10_000_000), "incentives prorated");
  near(per10kOf(next, 10_000_000)!.fees, 0.5, "and dilute with more");
  const young = gauge({ windows: { ...gauge().windows, 48: accrued(1n, 1) } });
  assert.equal(paysNext(young, 48, market([young]), HOLD), undefined, "too young for the window");
});

test("the rule weighs its top pools by what they pay in all, and leaves out those that pay nothing", () => {
  const [big, mid, small, none] = [
    gauge({ perDay: 3 }),
    gauge({ perDay: 2 }),
    gauge({ perDay: 1 }),
    gauge({ perDay: 0 }),
  ];
  const pools = [small, none, big, mid].map((each) => ({
    gauge: each,
    paying: paidOver(each, each.windows[48], PRICES)!,
  }));
  const picks = picksOf(pools, 2);
  assert.deepEqual(
    picks.map(({ gauge, weight }) => [gauge.address, weight]),
    [
      [big.address, 0.6],
      [mid.address, 0.4],
    ],
  );
  assert.equal(picksOf(pools, 10).length, 3);
});

test("without incentives, the rule ranks and weighs its pools by their fees alone", () => {
  const [fees, streams] = [gauge(), gauge()];
  const flows = (value: number) => [{ token: usdc, value }];
  const pools = [
    { gauge: fees, paying: { fees: flows(3), incentives: [], power: 1 } },
    { gauge: streams, paying: { fees: flows(1), incentives: flows(9), power: 1 } },
  ];
  const ranked = (incentives?: boolean) =>
    picksOf(pools, 2, incentives).map(({ gauge, weight }) => [gauge.address, weight]);
  assert.deepEqual(ranked(), [
    [streams.address, 10 / 13],
    [fees.address, 3 / 13],
  ]);
  assert.equal(payOf(pools[1]!.paying), 10, "fees and incentives");
  assert.equal(payOf(pools[1]!.paying, false), 1, "fees alone");
  assert.deepEqual(ranked(false), [
    [fees.address, 0.75],
    [streams.address, 0.25],
  ]);
});

test("the rule over its own window earns at least the average of its pools, and less as its sAERO dilutes them", () => {
  // Same fees, but one pool has a fifth of the sAERO.
  const crowded = gauge({ perDay: 1 });
  const quiet = gauge({ perDay: 5, power: 1_000_000n * SAERO });
  quiet.windows[48] = { ...quiet.windows[48], power: 1_000_000n * SAERO, endPower: 1_000_000n * SAERO };
  const m = market([crowded, quiet]);
  const lately = (each: Gauge) => paidOver(each, each.windows[48], PRICES);
  const picks = picksOf(
    [crowded, quiet].map((each) => ({ gauge: each, paying: lately(each)! })),
    2,
  );
  const rule = heldOver(picks, lately)!;
  const base = marketOver(m.gauges, lately);
  near(base.total, ((2 * 500) / 6_000_000) * 10_000, "all the fees over all the sAERO");
  near(rule.total, 0.5 * 1 + 0.5 * 5, "half in each, since each pays $500 a day");
  assert.ok(rule.total > base.total);
  // 1M more sAERO: 500k into each pool.
  const diluted = heldOver(picks, lately, 1_000_000)!;
  near(diluted.total, 0.5 * (500 / 5_500_000) * 10_000 + 0.5 * (500 / 1_500_000) * 10_000);
  // The same 1M already there does not dilute again.
  const mine = new Map([
    [key(crowded.address), 500_000],
    [key(quiet.address), 500_000],
  ]);
  near(heldOver(picks, lately, 1_000_000, mine)!.total, rule.total, "already in");
  assert.deepEqual(heldOver([{ gauge: undefined, weight: 1 }], lately), undefined, "no pool, no answer");
  // Half outside the market's pools counts for nothing, and the figure is then a lower bound.
  const half = heldOver(
    [
      { gauge: undefined, weight: 0.5 },
      { gauge: quiet, weight: 0.5 },
    ],
    lately,
  )!;
  near(half.total, 2.5, "half outside earns half");
  assert.equal(half.priced, false, "partial");
  // So does a pool without an answer, such as one whose snapshot could not be read; a share of 0% doesn't count.
  const onlyQuiet = (each: Gauge) => (each === quiet ? lately(each) : undefined);
  const both = [
    { gauge: crowded, weight: 0.5 },
    { gauge: quiet, weight: 0.5 },
  ];
  assert.equal(heldOver(both, onlyQuiet)!.priced, false, "no answer");
  assert.equal(
    heldOver(
      [
        { gauge: crowded, weight: 0 },
        { gauge: quiet, weight: 1 },
      ],
      onlyQuiet,
    )!.priced,
    true,
    "0%",
  );
});

test("a stake's own weight over a span is what its moves held there on average, its sAERO on no chain left out", () => {
  const [p, q] = [gauge(), gauge()];
  const moves: Move[] = [
    { at: NOW - DAY, allocations: [{ gauge: q.address, amount: 4n * SAERO }] },
    {
      at: NOW - 3 * DAY,
      allocations: [
        { gauge: p.address, amount: 2n * SAERO },
        { gauge: zeroAddress, amount: SAERO },
      ],
    },
  ];
  // Over the last two days: P for the first, Q for the second.
  assert.deepEqual(
    [...heldIn(moves, { from: NOW - 2 * DAY, to: NOW })],
    [
      [key(p.address), 1],
      [key(q.address), 2],
    ],
  );
  assert.equal(heldIn(moves, { from: NOW - 5 * DAY, to: NOW - 4 * DAY }).size, 0, "nothing before its first move");
});

test("the windows and the record's picks lie on one grid of 48 hours, counted back from the last whole hour", () => {
  // NOW is on the hour.
  const { windows, record, times } = gridOf(NOW + 1_234);
  assert.deepEqual(windows, [NOW - 48 * 3_600, NOW - 96 * 3_600, NOW - 192 * 3_600]);
  assert.deepEqual(
    record,
    [1, 2, 3, 4, 5].map((k) => NOW - k * 48 * 3_600),
  );
  assert.deepEqual(times, record, "each window starts at one of the record's times");
  assert.ok(STEP >= HOLD, "a pick can be followed: an allocation holds 47 hours");
  const read: Start = { index: 3n, acc: [0n, 0n], ts: NOW, share: 0n, zero: 0, supply: 0n };
  assert.ok(!unreadStart(read) && !unreadStart({ ...read, index: 0n, acc: undefined, ts: undefined }));
  assert.ok(unreadStart({ ...read, acc: undefined }), "a checkpoint whose snapshot failed");
});

// A pool paying `pays` per 10,000 sAERO a day over the grid's steps, oldest first, the last ending now; with snapshots
// at the grid's times and at `extra`.
function history(pays: number[], extra: number[] = [], fields: Partial<Gauge> = {}, supply = 5_000_000n * SAERO) {
  const bounds = pays.map((_, i) => NOW - (pays.length - i) * STEP);
  const accAt = (time: number): bigint => {
    const dollars = pays.reduce(
      (sum, pay, i) => sum + (pay * Math.max(0, Math.min(time, bounds[i]! + STEP) - bounds[i]!)) / DAY,
      0,
    );
    return BigInt(Math.round(dollars * 1e6)) * 100n;
  };
  const times = [...new Set([...bounds, ...extra])].sort((a, b) => b - a);
  const g = gauge({ ...fields, power: supply, end: { ...end(supply), acc: [accAt(NOW), 0n] } });
  const starts: Start[] = times.map((time, i) => ({
    index: BigInt(times.length - i),
    time,
    acc: [accAt(time), 0n],
    ts: time,
    share: undefined,
    zero: 0,
    supply,
  }));
  return { gauge: g, times, starts };
}
type History = ReturnType<typeof history>;
const pastOfAll = (all: History[]): Past => ({
  times: all[0]!.times,
  starts: new Map(all.map(({ gauge, starts }) => [key(gauge.rewards), starts])),
});
const only = (past: Past, times: number[]): Past => ({
  times,
  starts: new Map([...past.starts].map(([id, starts]) => [id, times.map((time) => starts[past.times.indexOf(time)])])),
});
const GRID = [1, 2, 3, 4, 5].map((k) => NOW - k * STEP);
const meme: Token = { address: "0x00000000000000000000000000000000000000bb", decimals: 18, symbol: "MEME" };
const MEMED = prices([
  [usdc, 1],
  [weth, 2_000],
  [aero, 0.6],
  [meme, 0.1],
]);
// A pays well in every other step and B in the others; only A is a blue chip. `m.past` holds the grid's snapshots,
// `past` also those at `extra`.
function twoPools(extra: number[] = [], more: (extra: number[]) => History[] = () => []) {
  const a = history([1, 10, 1, 10, 1], extra);
  const b = history([10, 1, 10, 1, 10], extra, { token1: meme });
  const all = [a, b, ...more(extra)];
  const past = pastOfAll(all);
  return {
    a,
    b,
    past,
    m: {
      ...market(
        all.map(({ gauge }) => gauge),
        MEMED,
      ),
      past: only(past, GRID),
    },
  };
}
const totals = (steps: Paid[]) => steps.map(({ paid }) => paid?.total);
const nearAll = (found: (number | undefined)[], expected: (number | undefined)[], what: string) => {
  assert.equal(found.length, expected.length, what);
  found.forEach((value, i) =>
    expected[i] === undefined
      ? assert.equal(value, undefined, `${what} ${i}`)
      : near(value!, expected[i]!, `${what} ${i}`),
  );
};

test("the record's steps run 48 hours each from the grid's times, the newest to now", () => {
  const { m } = twoPools();
  assert.deepEqual(
    stepsOf(m).map(({ from, to }) => [(NOW - from) / STEP, (NOW - to) / STEP]),
    [
      [1, 0],
      [2, 1],
      [3, 2],
      [4, 3],
    ],
  );
});

test("with the prices then, a step is valued at the mean of its ends' prices, and a pick at its own time's", () => {
  const { m } = twoPools();
  const top = { count: 1, hours: 48, again: true, blueChips: false, incentives: true } as const;
  const starts = stepsOf(m).map(({ from }) => from);
  const at = (usdcPrice?: number) =>
    prices([...(usdcPrice === undefined ? [] : [[usdc, usdcPrice] as [Token, number]]), [weth, 2_000], [aero, 0.6]]);
  // USDC, in which both pools pay, at $2 at every step start and $1 now: the newest step at $1.50, the others at $2.
  const then = new Map(starts.map((time) => [time, at(2)]));
  nearAll(totals(strategySteps(m, m.past, top, { then })), [1.5, 2, 2, 2], "the strategy");
  const times = (plain: Paid[], by: number[]) => totals(plain).map((value, k) => value! * by[k]!);
  const scaled = (plain: Paid[]) => times(plain, [1.5, 2, 2, 2]);
  nearAll(totals(averageSteps(m, m.past, then)), scaled(averageSteps(m, m.past)), "the Base average");
  const holdings = m.gauges.map((gauge) => ({ gauge, weight: 0.5 }));
  nearAll(totals(customSteps(m, m.past, holdings, { then })), scaled(customSteps(m, m.past, holdings)), "custom");
  // No price for USDC when the second newest step was picked: every pool's fees were unpriced then, so nothing was
  // picked, though the step itself is valued at its end's price.
  then.set(starts[1]!, at());
  nearAll(totals(strategySteps(m, m.past, top, { then })), [1.5, undefined, 2, 2], "picked then");
  // With one end's prices missing, a step takes the other's alone; with neither, today's.
  const one = new Map([[starts[1]!, at(2)]]);
  nearAll(totals(averageSteps(m, m.past, one)), times(averageSteps(m, m.past), [1, 2, 2, 1]), "one end");
  // A pricing in another unit, after its feeds failed, is left out rather than mixed in.
  const inUsdc = new Map(starts.map((time): [number, Prices] => [time, { ...at(2), unit: "USDC" }]));
  nearAll(totals(averageSteps(m, m.past, inUsdc)), totals(averageSteps(m, m.past)), "another unit");
});

test("an APR over steps takes each step's at its own price of AERO, weighed by its length", () => {
  const step = (from: number, total: number | undefined, aeroPrice: number): Paid => ({
    from,
    to: from + STEP,
    paid: total === undefined ? undefined : { fees: total, incentives: 0, total, priced: true },
    prices: prices([[aero, aeroPrice]]),
  });
  // $1 a day for 10,000 sAERO: 7.3% a year at $0.50 an AERO, 3.65% at $1.
  const found = aprOver([step(NOW - STEP, 1, 0.5), step(NOW - 2 * STEP, 1, 1), step(NOW - 3 * STEP, undefined, 1)]);
  near(found!.apr, (0.073 + 0.0365) / 2, "the steps with an answer");
  assert.equal(aprOver([step(NOW - STEP, undefined, 1)]), undefined);
  // A step without a price for AERO has no APR, so it counts in neither the APR nor what was earned.
  const unknown: Paid = { ...step(NOW - 2 * STEP, 9, 1), prices: prices([[usdc, 1]]) };
  const without = aprOver([step(NOW - STEP, 1, 0.5), unknown])!;
  near(without.apr, 0.073, "its APR");
  near(without.total, 1, "what 10,000 sAERO earned a day, over the same steps");
});

test("a strategy picks at each step from only the window before it, and earns what its pools paid in the step", () => {
  const { a, m } = twoPools();
  const top = { count: 1, hours: 48, again: true, blueChips: false, incentives: true } as const;
  // Chasing last step's best pool always lands on the one that pays $1 next.
  nearAll(totals(strategySteps(m, m.past, top)), [1, 1, 1, 1], "again");
  // Picked once from the 48 hours before the oldest step: B, which paid $10 then, and is kept.
  nearAll(totals(strategySteps(m, m.past, { ...top, again: false })), [10, 1, 10, 1], "once");
  // Of blue chips, only A.
  nearAll(totals(strategySteps(m, m.past, { ...top, blueChips: true })), [1, 10, 1, 10], "blue chips");
  assert.ok(isBlueChip(a.gauge) && !isBlueChip(m.gauges[1]!));
  // 5M sAERO more halves what each earns, at 5M already there.
  nearAll(totals(strategySteps(m, m.past, top, { amount: 5_000_000 })), [0.5, 0.5, 0.5, 0.5], "diluted");
  // Unless the stake's own 5M was in both pools all along: it is not added again.
  const own: Move[] = [
    {
      at: NOW - 30 * DAY,
      allocations: m.gauges.map((each) => ({ gauge: each.address, amount: 5_000_000n * SAERO })),
    },
  ];
  nearAll(totals(strategySteps(m, m.past, top, { amount: 5_000_000, own })), [1, 1, 1, 1], "its own weight");
  near(aprOver(strategySteps(m, m.past, { ...top, again: false }))!.total, 5.5, "over the 8 days");
});

test("the strategy leaves out thin pools and pools paying a token without a price, as the window before each pick shows them", () => {
  // Each would top the picks by what it pays in all: a thin pool, and one streaming a token without a price.
  const thin = (extra: number[]) => [history([1_000, 1_000, 1_000, 1_000, 1_000], extra, {}, 100_000n * SAERO)];
  const unpriced = (extra: number[]) => [
    history([100, 100, 100, 100, 100], extra, {
      programs: [{ ...streaming(1_000, NOW - 20 * DAY, NOW + DAY), token: other }],
    }),
  ];
  const top = { count: 1, hours: 48, again: true, blueChips: false, incentives: true } as const;
  for (const [more, what] of [
    [thin, "thin"],
    [unpriced, "unpriced"],
  ] as const) {
    const { m } = twoPools([], more);
    // In the 48 hours before every pick, it paid more in all than A or B.
    for (const { from } of stepsOf(m)) {
      const paid = (gauge: Gauge) => totalOf(paidOver(gauge, accrualOf(gauge, m.past, from - STEP, from, m), MEMED)!);
      assert.ok(paid(m.gauges[2]!) > Math.max(paid(m.gauges[0]!), paid(m.gauges[1]!)), `${what} pays the most`);
    }
    nearAll(totals(strategySteps(m, m.past, top)), [1, 1, 1, 1], `${what} left out`);
  }
});

test("a longer window needs snapshots before the grid's, read for it alone", () => {
  const { m, past } = twoPools([NOW - 6 * STEP]);
  const top = { count: 1, hours: 96, again: true, blueChips: false, incentives: true } as const;
  assert.deepEqual(timesFor(m, { ...top, hours: 48 }), [], "48 hours: the grid's own");
  assert.deepEqual(timesFor(m, top), [NOW - 6 * STEP]);
  assert.deepEqual(
    timesFor(m, { ...top, hours: 192 }),
    [6, 7, 8].map((k) => NOW - k * STEP),
  );
  assert.deepEqual(timesFor(m, { ...top, hours: 192, again: false }), [NOW - 8 * STEP], "once: the oldest pick's");
  // Without them, the oldest step has no picks; with them, it does.
  const without = totals(strategySteps(m, m.past, top));
  assert.ok(without.slice(0, 3).every((each) => each !== undefined) && without[3] === undefined);
  const all = mergePast(m.past, only(past, [NOW - 6 * STEP]));
  assert.deepEqual(
    all.times,
    [1, 2, 3, 4, 5, 6].map((k) => NOW - k * STEP),
  );
  assert.ok(totals(strategySteps(m, all, top)).every((each) => each !== undefined));
});

test("custom shares are held as they are over every step", () => {
  const { a, b, m } = twoPools();
  const custom = customSteps(m, m.past, [
    { gauge: a.gauge, weight: 0.5 },
    { gauge: b.gauge, weight: 0.5 },
  ]);
  nearAll(totals(custom), [5.5, 5.5, 5.5, 5.5], "half in each");
});

test("the Base average is all that the pools paid in each step over all their sAERO, thin pools too", () => {
  // A and B, at 5M sAERO each, pay $10 and $1 per 10k a day in turn.
  const { m } = twoPools();
  nearAll(totals(averageSteps(m, m.past)), [5.5, 5.5, 5.5, 5.5], "half of each");
  // A thin pool of 100k sAERO paying $1,000 per 10k counts at its sAERO: (55M + 100M) / 10.1M per 10k.
  const thin = twoPools([], (extra) => [history([1_000, 1_000, 1_000, 1_000, 1_000], extra, {}, 100_000n * SAERO)]).m;
  nearAll(totals(averageSteps(thin, thin.past)), Array(4).fill(155 / 10.1), "thin pools count");
  // One paid in a token without a price is left out.
  const unpriced = twoPools([], (extra) => [history([100, 100, 100, 100, 100], extra, { token0: other })]).m;
  nearAll(totals(averageSteps(unpriced, unpriced.past)), [5.5, 5.5, 5.5, 5.5], "unpriced left out");
});

test("an allocation as it actually moved is cut where it moved, and earns nothing before its first move", () => {
  const cuts = [NOW - 1.5 * STEP, NOW - 2.5 * STEP];
  const { a, b, m, past } = twoPools(cuts);
  const moves: Move[] = [
    { at: cuts[0]!, allocations: [{ gauge: b.gauge.address, amount: 3n * SAERO }] },
    // Half of it on the zero gauge, which earns nothing.
    {
      at: cuts[1]!,
      allocations: [
        { gauge: a.gauge.address, amount: SAERO },
        { gauge: zeroAddress, amount: SAERO },
      ],
    },
  ];
  // B through the newest step; A, half idle, and B in the one before; A, half idle, for half of the one before that.
  nearAll(totals(movedSteps(m, mergePast(m.past, past), moves)), [10, (5 + 1) / 2, 0.5, undefined], "moved");
  const record = movedSteps(m, mergePast(m.past, past), moves);
  near(aprOver(record)!.total, (10 + 3 + 0.5) / 3, "over its steps with an answer, each weighed by its length");
  assert.ok(
    record.every(({ paid }) => !paid || paid.priced),
    "its sAERO on no chain earns nothing, as it should",
  );
  // At the prices then: USDC at $2 at each step start and $1 now.
  const starts = stepsOf(m).map(({ from }) => from);
  const then = new Map(
    starts.map((time) => [
      time,
      prices([
        [usdc, 2],
        [weth, 2_000],
        [aero, 0.6],
      ]),
    ]),
  );
  nearAll(totals(movedSteps(m, mergePast(m.past, past), moves, { then })), [15, 6, 1, undefined], "then");
  // Followed with 5M more, the newest step's pool pays half; unless the 5M was the stake's own, already there.
  const holder: Move[] = [{ at: cuts[0]!, allocations: [{ gauge: b.gauge.address, amount: 5_000_000n * SAERO }] }];
  const followed = (own?: Move[]) =>
    movedSteps(m, mergePast(m.past, past), holder, { amount: 5_000_000, own })[0]!.paid!.total;
  near(followed(), 5, "diluted");
  near(followed(holder), 10, "its own");
  // First allocated a quarter of the way before the end of a step: that step is measured over that quarter.
  const late = [NOW - 1.5 * STEP, NOW - 2.25 * STEP];
  const q = twoPools(late);
  const after: Move[] = [
    { at: late[0]!, allocations: [{ gauge: q.b.gauge.address, amount: SAERO }] },
    { at: late[1]!, allocations: [{ gauge: q.a.gauge.address, amount: SAERO }] },
  ];
  nearAll(totals(movedSteps(q.m, mergePast(q.m.past, q.past), after)), [10, (10 + 1) / 2, 1, undefined], "late");
});

test("an allocation's moves are read at the block before each, back to the first at or before the record", async () => {
  const GENESIS = NOW - 200_000_000;
  const timeOf = (block: number) => GENESIS + 2 * block;
  const newest = (NOW - GENESIS) / 2;
  const [b, c] = [gauge(), gauge()];
  const times = [NOW - 10 * 3_600, NOW - 60 * 3_600, NOW - 300 * 3_600];
  const pools = [[b.address], [c.address, b.address], [c.address]];
  const blocks: (number | undefined)[] = [];
  const read = (async (calls: readonly Call[], options?: { block?: number }) => {
    blocks.push(options?.block);
    const time = options?.block === undefined ? NOW : timeOf(options.block);
    const k = times.findIndex((at) => at <= time);
    return calls.map(({ functionName }) => {
      switch (functionName) {
        case "getBlockNumber":
          return BigInt(newest);
        case "getCurrentBlockTimestamp":
          return BigInt(time);
        case "tokenStates":
          return [zeroAddress, k < 0 ? 0 : times[k], false, 0n];
        case "allocatedGauges":
          return k < 0 ? [] : pools[k];
        default:
          return k < 0 ? 0n : BigInt(k + 1) * SAERO;
      }
    });
  }) as Read;
  const own = stake({ lastAllocated: times[0]!, allocations: [{ gauge: b.address, amount: SAERO }] });
  const found = await movesOf(own, NOW - 192 * 3_600, read);
  assert.deepEqual(found, [
    { at: times[0], allocations: own.allocations },
    {
      at: times[1],
      allocations: [
        { gauge: c.address, amount: 2n * SAERO },
        { gauge: b.address, amount: 2n * SAERO },
      ],
    },
    { at: times[2], allocations: [{ gauge: c.address, amount: 3n * SAERO }] },
  ]);
  assert.ok(
    blocks.some((block) => block !== undefined && timeOf(block) < times[0]! && timeOf(block + 1) >= times[0]!),
    "the block just before the newest move",
  );
  assert.equal((await movesOf(own, 0, read, 2)).length, 2, "at most `most` of them");
});

test("an allocation splits a stake's sAERO on Base to the wei, its gauges ascending, and leaves out what rounds to nothing", () => {
  const [a, b, c]: [Address, Address, Address] = [
    "0x00000000000000000000000000000000000000c3",
    "0x00000000000000000000000000000000000000a1",
    "0x00000000000000000000000000000000000000b2",
  ];
  const budget = 1_000n * SAERO + 1n;
  const found = allotmentsOf(
    [
      { gauge: a, weight: 50 },
      { gauge: b, weight: 30 },
      { gauge: c, weight: 20 },
    ],
    budget,
  );
  assert.deepEqual(
    found.map(({ gauge }) => gauge),
    [b, c, a],
    "ascending",
  );
  assert.equal(
    found.reduce((sum, { amount }) => sum + amount, 0n),
    budget,
    "to the wei",
  );
  assert.equal(found.find(({ gauge }) => gauge === a)!.amount, budget / 2n + 1n, "the rest goes to the largest");
  assert.deepEqual(
    allotmentsOf(
      [
        { gauge: a, weight: 1 },
        { gauge: b, weight: 0 },
      ],
      5n,
    ).map(({ gauge, amount }) => [gauge, amount]),
    [[a, 5n]],
    "nothing at 0%",
  );
  assert.deepEqual(allotmentsOf([{ gauge: a, weight: 1 }], 0n), []);
  assert.deepEqual(allotmentsOf([{ gauge: a, weight: 0 }], 5n), []);
});

test("allocating calls Aero's Voter for Base alone, with no fee, and moves sAERO on no chain onto Base first", () => {
  const owner = getAddress("0x00000000000000000000000000000000000000ee");
  const gauges = [{ gauge: getAddress("0x00000000000000000000000000000000000000a1"), amount: 7n * SAERO }];
  const decoded = (idle: bigint) => {
    const tx = allocateCall(stake({ id: 9n, onBase: 5n * SAERO, idle }), gauges, owner);
    assert.equal(tx.to, AERO_VOTER);
    return decodeFunctionData({ abi: aeroVoterAbi, data: tx.data }).args as unknown as [
      bigint,
      { chainId: bigint; delta: bigint; gasLimit: bigint; value: bigint }[],
      {
        chainId: bigint;
        gasLimit: bigint;
        value: bigint;
        gauges: { gauge: Address; allocated: bigint; data: string }[];
      }[],
      Address,
    ];
  };
  const [id, chains, dispatches, refund] = decoded(2n * SAERO);
  assert.deepEqual([id, refund], [9n, owner]);
  assert.deepEqual(chains, [{ chainId: 8453n, delta: 2n * SAERO, gasLimit: 0n, value: 0n }]);
  assert.deepEqual(dispatches, [
    {
      chainId: 8453n,
      gasLimit: 0n,
      value: 0n,
      gauges: [{ gauge: gauges[0]!.gauge, allocated: 7n * SAERO, data: "0x" }],
    },
  ]);
  assert.deepEqual(decoded(0n)[1], [], "nothing to move onto Base");
  assert.equal(budgetOf(stake({ onBase: 5n * SAERO, idle: 2n * SAERO, elsewhere: 3n * SAERO })), 7n * SAERO);
});

test("a stake cannot allocate once its lock has ended, without sAERO for Base, or while it holds", () => {
  const cooldown = 169_200;
  assert.equal(blockedOf(stake({ lastAllocated: NOW - cooldown - 1 }), cooldown, NOW), undefined);
  assert.equal(blockedOf(stake({ lastAllocated: 0 }), cooldown, NOW), undefined, "never allocated");
  assert.deepEqual(blockedOf(stake({ lastAllocated: NOW - DAY }), cooldown, NOW), {
    why: "held",
    until: NOW - DAY + cooldown,
  });
  assert.equal(blockedOf(stake({ lastAllocated: NOW - DAY, reduction: DAY }), cooldown, NOW), undefined, "reduced");
  assert.deepEqual(blockedOf(stake({ permanent: false, end: NOW - 1 }), cooldown, NOW), { why: "ended" });
  assert.equal(blockedOf(stake({ permanent: false, end: NOW + DAY, lastAllocated: 0 }), cooldown, NOW), undefined);
  assert.deepEqual(blockedOf(stake({ onBase: 0n, idle: 0n, elsewhere: SAERO }), cooldown, NOW), { why: "empty" });
});

test("an allocation's refusal is named when it is one of Aero's errors", () => {
  assert.equal(refusalOf(encodeErrorResult({ abi: allocateErrorsAbi, errorName: "CooldownActive" })), "CooldownActive");
  assert.equal(
    refusalOf(encodeErrorResult({ abi: allocateErrorsAbi, errorName: "ChainAllocationMismatch", args: [8453n] })),
    "ChainAllocationMismatch",
  );
  assert.equal(refusalOf("0x"), undefined);
  assert.equal(refusalOf("0x12345678"), undefined);
});

test("pools go by Aero's names: a Slipstream pool by its tick spacing, a basic pool by its curve", () => {
  const listed = { address: zeroAddress, pool: zeroAddress, rewards: zeroAddress, token0: weth, token1: usdc };
  assert.equal(nameOf({ ...listed, kind: "cl", tickSpacing: 50 }), "CL50-WETH/USDC");
  assert.equal(nameOf({ ...listed, kind: "volatile", tickSpacing: 0 }), "vAMM-WETH/USDC");
  assert.equal(nameOf({ ...listed, kind: "stable", tickSpacing: 0 }), "sAMM-WETH/USDC");
});
