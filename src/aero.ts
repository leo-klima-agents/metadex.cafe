import { decodeErrorResult, encodeFunctionData, zeroAddress, type Address, type Hex } from "viem";
import {
  aeroEscrowAbi,
  aeroPoolAbi,
  aeroVoterAbi,
  allocateErrorsAbi,
  leafVoterAbi,
  registryAbi,
  rewardsManagerAbi,
} from "./abi.ts";
import * as config from "./config.ts";
import { ANCHORS, CHAIN_ID, GAUGE_FACTORIES, PAYMENTS_MODULE, PRICING, type GaugeKind } from "./config.ts";
import { key, pricesNow, waysFor, worthOf, type Prices, type Token } from "./prices.ts";
import {
  blockClock,
  blockTime,
  contract,
  firstBlockAt,
  read,
  readEach,
  required,
  same,
  sawBlock,
  type Read,
  type Tx,
} from "./rpc.ts";
import { describe } from "./tokens.ts";

// A gauge's rewards manager sums the fees it pays per unit of power and snapshots the sum at each checkpoint, so what
// sAERO earned between two times is the growth between two snapshots.

const escrow = contract(config.AERO_ESCROW, aeroEscrowAbi);
const root = contract(config.AERO_VOTER, aeroVoterAbi);
const leaf = contract(config.LEAF_VOTER, leafVoterAbi);
const registry = contract(config.FACTORY_REGISTRY, registryAbi);
const manager = (address: Address) => contract(address, rewardsManagerAbi);

const HOUR = 3_600;
export const DAY = 86_400;
// In hours. The windows and the record lie on one 48-hour grid (`gridOf`), so they share snapshots.
export const WINDOWS = [48, 96, 192] as const;
export type Hours = (typeof WINDOWS)[number];
// An allocation holds 47 hours, so a strategy can move every 48.
export const STEP = 48 * HOUR;
export const PICKS = 4;
// Snapshot times, newest first, on the whole hour so that one read serves for the hour.
export function gridOf(time: number): { windows: number[]; record: number[]; times: number[] } {
  const hour = time - (time % HOUR);
  const windows = WINDOWS.map((hours) => hour - hours * HOUR);
  const record = Array.from({ length: PICKS + 1 }, (_, k) => hour - (k + 1) * STEP);
  return { windows, record, times: [...new Set([...windows, ...record])].sort((a, b) => b - a) };
}
// Rewards managers credit fees × 1e24 / power, so 10,000 sAERO earn the growth / 100, in the token's smallest units.
export const PER = 10_000;
const PER_UNITS = 100;
const RATE = 1e18;
// Rewards managers' supply accumulator is the sum of seconds × 1e42 / power.
const SUPPLY_SCALE = 10n ** 42n;
// Under this many sAERO, one allocation changes what a pool pays.
export const THIN = 1_000_000;
// Only a gauge's newest programs are read: programs run for days.
export const PROGRAMS = 50;
// Claim estimates walk at most this many checkpoints and are heavy, so a read holds at most `HEAVY`.
const MAX_CHECKPOINTS = 500n;
const HEAVY = 20;

// `share` is the supply accumulator, undefined if unread, and `zero` the seconds without power.
export type Point = {
  at: number;
  acc: readonly [bigint, bigint];
  share: bigint | undefined;
  zero: number;
  power: bigint;
};
// The checkpoint at or before `time`, `index` 0 if none, and the power at `time`. Fields are undefined if unread.
export type Start = {
  index: bigint | undefined;
  time?: number | undefined;
  acc: readonly bigint[] | undefined;
  ts: number | undefined;
  share: bigint | undefined;
  zero: number | undefined;
  supply: bigint | undefined;
};
// Fee accumulator growth from a checkpoint to a later time. `spread` is the harmonic mean of the power, in sAERO, from
// the start's `time` (or else the checkpoint) to `to`, if read.
export type Accrued = {
  from: number;
  to: number;
  fees0: bigint;
  fees1: bigint;
  power: bigint;
  endPower: bigint;
  spread: number | undefined;
};
export type Program = { id: bigint; token: Token | undefined; rate: bigint; start: number; end: number };
export type Gauge = {
  address: Address;
  pool: Address;
  rewards: Address;
  kind: GaugeKind;
  tickSpacing: number;
  token0: Token;
  token1: Token;
  name: string;
  // Allocations to a gauge not activated, or capped at zero, earn nothing.
  activated: boolean;
  cap: bigint;
  power: bigint;
  end: Point;
  // When its rewards manager first checkpointed, or 0.
  first: number;
  windows: Record<Hours, Accrued>;
  // The newest `PROGRAMS` of its `programCount`.
  programs: Program[];
  programCount: number;
};
// `unread`: gauges left out after a failed read. `unknown`: gauge factories the page does not know. `past`: every
// pool's snapshots on the grid.
export type Market = {
  time: number;
  cooldown: number;
  maxGauges: number;
  gauges: Gauge[];
  prices: Prices;
  unread: Address[];
  unknown: Address[];
  past: Past;
};
export const routable = (gauge: Gauge): boolean => gauge.activated && gauge.cap > 0n;
const whole = (power: bigint): number => Number(power) / 1e18;

// Aero's names, such as "CL50-WETH/USDC" and "vAMM-AERO/USDC".
const PREFIXES: Record<GaugeKind, (tickSpacing: number) => string> = {
  volatile: () => "vAMM",
  stable: () => "sAMM",
  cl: (tickSpacing) => `CL${tickSpacing}`,
};
export const nameOf = ({ kind, tickSpacing, token0, token1 }: Listed): string =>
  `${PREFIXES[kind](tickSpacing)}-${token0.symbol}/${token1.symbol}`;

// Index 0 means no checkpoint yet, so it accrues from nothing at the first one. An unread snapshot accrues nothing.
// Fees can be credited between checkpoints but power cannot change, so fees accrue from the checkpoint and the mean
// power from `time`.
export function accruedFrom(start: Start, first: number, end: Point): Accrued {
  const to = end.at;
  const { index, acc, ts, share, zero, supply } = start;
  const at =
    index === 0n
      ? { ts: first || to, acc: [0n, 0n], share: 0n, zero: 0 }
      : acc && ts !== undefined
        ? { ts, acc, share, zero }
        : undefined;
  const from = Math.min(at?.ts ?? to, to);
  const grown = (a: bigint, b: bigint | undefined) => (b !== undefined && a > b ? a - b : 0n);
  const since = index !== 0n && start.time !== undefined && supply !== undefined ? Math.max(0, start.time - from) : 0;
  const meanFrom = Math.min(from + since, to);
  const startShare =
    at?.share === undefined ? undefined : supply ? at.share + (BigInt(since) * SUPPLY_SCALE) / supply : at.share;
  const startZero = at?.zero === undefined ? undefined : supply ? at.zero : at.zero + since;
  const seconds = startZero === undefined ? 0 : to - meanFrom - (end.zero - startZero);
  const shared = startShare === undefined || end.share === undefined ? 0n : end.share - startShare;
  return {
    from,
    to,
    fees0: at ? grown(end.acc[0], at.acc[0]) : 0n,
    fees1: at ? grown(end.acc[1], at.acc[1]) : 0n,
    power: supply ?? end.power,
    endPower: end.power,
    spread: seconds > 0 && shared > 0n ? Number((BigInt(seconds) * SUPPLY_SCALE) / shared) / 1e18 : undefined,
  };
}
function endOf(latest: Start, accumulator: readonly [bigint, bigint], power: bigint, now: number): Point {
  const since = Math.max(0, now - (latest.ts ?? now));
  const share = latest.index === 0n ? 0n : latest.share;
  const zero = latest.index === 0n ? 0 : (latest.zero ?? 0);
  return {
    at: now,
    acc: accumulator,
    share: share === undefined ? undefined : power > 0n ? share + (BigInt(since) * SUPPLY_SCALE) / power : share,
    zero: power > 0n ? zero : zero + since,
    power,
  };
}

type Found = { address: Address; index: bigint | undefined; supply: bigint | undefined; time?: number };
async function indicesAt(rewards: Address[], times: bigint[], rd: Read): Promise<Found[]> {
  const found = await readEach(
    rewards.flatMap((address) => times.map((time) => ({ address, time }))),
    {
      index: ({ address, time }) => manager(address)("getPriorSupplyIndex", time),
      supply: ({ address, time }) => manager(address)("supplyAt", time),
    },
    rd,
  );
  return found.map(({ item: { address, time }, index, supply }) => ({
    address,
    index,
    supply,
    time: Number(time),
  }));
}
async function snapshotsOf(found: Found[], rd: Read): Promise<Start[]> {
  const known = found.filter((each): each is Found & { index: bigint } => each.index !== undefined);
  const read = await readEach(
    known,
    {
      acc: ({ address, index }) => manager(address)("feeRewardPerVotingPowerAt", index),
      point: ({ address, index }) => manager(address)("globalRewardPointHistory", index),
      share: ({ address, index }) => manager(address)("supplyAccumulatorAt", index),
    },
    rd,
  );
  const of = new Map<Found, (typeof read)[number]>(read.map((each) => [each.item, each]));
  return found.map((item) => {
    const { acc, point, share } = of.get(item) ?? {};
    return {
      index: item.index,
      time: item.time,
      acc,
      ts: point && Number(point.ts),
      share: share?.[0],
      zero: point && Number(point.zeroSupplySeconds),
      supply: item.supply,
    };
  });
}
// By manager, then time.
export const startsAt = async (rewards: Address[], times: bigint[], rd: Read): Promise<Start[]> =>
  snapshotsOf(await indicesAt(rewards, times, rd), rd);
export type StartsOf = (rewards: Address[], times: number[]) => Promise<Start[]>;
// A snapshot that should exist but could not be read.
export const unreadStart = ({ index, acc, ts }: Start): boolean => index !== 0n && (!acc || ts === undefined);

// What changes only when Aero adds a gauge.
export type Listed = {
  address: Address;
  kind: GaugeKind;
  pool: Address;
  rewards: Address;
  token0: Token;
  token1: Token;
  tickSpacing: number;
};
export type Universe = { gauges: Listed[]; unread: Address[]; unknown: Address[] };
export async function readUniverse(rd: Read = read): Promise<Universe> {
  const [factories] = required(await rd([registry("gaugeFactories")]));
  const known = factories.flatMap((address) => GAUGE_FACTORIES.filter((each) => same(each.address, address)));
  const unknown = factories.filter((address) => !GAUGE_FACTORIES.some((each) => same(each.address, address)));
  const lists = required(await rd(known.map(({ address }) => registry("factoryToGauges", address))));
  const listed = known.flatMap(({ kind }, i) => lists[i]!.map((address) => ({ address, kind })));
  const links = await readEach(
    listed,
    {
      pool: ({ address }) => registry("gaugeToTarget", address),
      rewards: ({ address }) => registry("gaugeToRewards", address),
    },
    rd,
  );
  const linked = links.flatMap(({ item, pool, rewards }) => (pool && rewards ? [{ ...item, pool, rewards }] : []));
  const [sides, spacings] = await Promise.all([
    readEach(
      linked,
      {
        token0: ({ rewards }) => manager(rewards)("token0"),
        token1: ({ rewards }) => manager(rewards)("token1"),
      },
      rd,
    ),
    readEach(
      linked.filter(({ kind }) => kind === "cl"),
      { spacing: ({ pool }) => contract(pool, aeroPoolAbi)("tickSpacing") },
      rd,
    ),
  ]);
  const tokens = await describe(
    sides.flatMap(({ token0, token1 }) => [token0, token1].filter((token) => token !== undefined)),
    rd,
  );
  const spacing = new Map(spacings.map(({ item, spacing }) => [item.address, spacing]));
  const gauges = sides.flatMap(({ item, token0, token1 }): Listed[] => {
    const [first, second] = [token0 && tokens.get(key(token0)), token1 && tokens.get(key(token1))];
    const tickSpacing = item.kind === "cl" ? spacing.get(item.address) : 0;
    return first && second && tickSpacing !== undefined
      ? [{ ...item, token0: first, token1: second, tickSpacing }]
      : [];
  });
  const kept = new Set(gauges.map(({ address }) => address));
  return { gauges, unread: listed.flatMap(({ address }) => (kept.has(address) ? [] : [address])), unknown };
}

// An hour, or five minutes for the next `RETRIES` reads while some gauges are unread.
const RETRIES = 3;
export function universeReads(read: () => Promise<Universe>) {
  let unreadTimes = 0;
  return {
    read: async (): Promise<Universe> => {
      const found = await read();
      unreadTimes = found.unread.length ? unreadTimes + 1 : 0;
      return found;
    },
    ttl: ({ unread }: Universe): number => (unread.length && unreadTimes <= RETRIES ? 5 * 60_000 : 60 * 60_000),
  };
}

const tokensIn = (gauges: (Listed & { programs?: Program[] })[]): Token[] => [
  ...new Map(
    gauges
      .flatMap(({ token0, token1, programs = [] }) => [token0, token1, ...programs.map(({ token }) => token)])
      .flatMap((token) => (token ? [[key(token.address), token] as const] : [])),
  ).values(),
];
// A day of each token the gauges pay: each gauge's fees at the most a window paid in a day, and a day of its live
// streams. Pricing needs pools deep enough for that.
export function dayOf(gauges: Gauge[], time: number): Map<string, bigint> {
  const amounts = new Map<string, bigint>();
  const add = (token: Token | undefined, amount: bigint) => {
    if (token && amount > 0n) amounts.set(key(token.address), (amounts.get(key(token.address)) ?? 0n) + amount);
  };
  for (const gauge of gauges) {
    let [most0, most1] = [0n, 0n];
    for (const hours of WINDOWS) {
      const accrued = gauge.windows[hours];
      if (accrued.to <= accrued.from) continue;
      // All the power earned the growth × power / 1e24, with power in sAERO's 18 decimals.
      const [times, per] = [
        BigInt(Math.round(meanOf(accrued))) * BigInt(DAY),
        BigInt(accrued.to - accrued.from) * 10n ** 6n,
      ];
      const [day0, day1] = [(accrued.fees0 * times) / per, (accrued.fees1 * times) / per];
      if (day0 > most0) most0 = day0;
      if (day1 > most1) most1 = day1;
    }
    add(gauge.token0, most0);
    add(gauge.token1, most1);
    for (const program of gauge.programs)
      if (isLive(program, time)) add(program.token, (program.rate * BigInt(DAY)) / 10n ** 18n);
  }
  return amounts;
}

// A gauge whose state cannot be read is left out and listed in `unread`. A failed read of its snapshots or programs
// leaves out only those.
export async function readMarket(
  from: Universe | Promise<Universe>,
  rd: Read = read,
  startsOf: StartsOf = (rewards, times) => startsAt(rewards, times.map(BigInt), rd),
): Promise<Market> {
  const [[time, cooldown, maxGauges], universe] = await Promise.all([
    rd([blockTime, leaf("allocationCooldown"), leaf("maxGauges")]).then(required),
    from,
  ]);
  const listed = universe.gauges;
  // Pricing looks up pools while the gauges are read; only its depth check waits for what they pay.
  const pairs = listed
    .flatMap(({ token0, token1 }) => [token0.address, token1.address])
    .filter((token) => !ANCHORS.some(({ address }) => same(address, token)))
    .flatMap((token) => ANCHORS.map(({ address }) => [token, address] as const));
  void waysFor(pairs, PRICING[0], rd).catch(() => undefined);
  const now = Number(time);
  sawBlock(now);
  const reading = gaugesOf(listed, now, rd, startsOf);
  const sized = reading.then(({ gauges }) => dayOf(gauges, now));
  sized.catch(() => undefined);
  const pooled = tokensIn(listed);
  const [{ gauges, past }, early] = await Promise.all([reading, pricesNow(pooled, sized, rd)]);
  const rest = tokensIn(gauges).filter(({ address }) => !pooled.some((token) => same(token.address, address)));
  const late = rest.length ? await pricesNow(rest, sized, rd) : undefined;
  const kept = new Set(gauges.map(({ address }) => address));
  return {
    time: now,
    cooldown: Number(cooldown),
    maxGauges: Number(maxGauges),
    gauges,
    prices: late
      ? {
          ...early,
          of: new Map([...early.of, ...late.of]),
          sources: new Map([...(early.sources ?? []), ...(late.sources ?? [])]),
          ...((early.unread || late.unread) && { unread: true }),
        }
      : early,
    unread: [...universe.unread, ...listed.flatMap(({ address }) => (kept.has(address) ? [] : [address]))],
    unknown: universe.unknown,
    past,
  };
}
async function gaugesOf(
  listed: Listed[],
  now: number,
  rd: Read,
  startsOf: StartsOf,
): Promise<{ gauges: Gauge[]; past: Past }> {
  const grid = gridOf(now);
  const [states, starts] = await Promise.all([
    readEach(
      listed,
      {
        cap: ({ address }) => registry("emissionCap", address),
        activated: ({ address }) => leaf("isActivated", address),
        power: ({ rewards }) => manager(rewards)("totalSupply"),
        accumulator: ({ rewards }) => manager(rewards)("feeRewardPerVotingPower"),
        count: ({ rewards }) => manager(rewards)("incentiveCount"),
        first: ({ rewards }) => manager(rewards)("globalRewardPointHistory", 1n),
        latest: ({ rewards }) => manager(rewards)("globalCheckpointIndex"),
      },
      rd,
    ),
    startsOf(
      listed.map(({ rewards }) => rewards),
      grid.times,
    ),
  ]);
  const latests = await snapshotsOf(
    states.map(({ item: { rewards: address }, latest, power }) => ({ address, index: latest ?? 0n, supply: power })),
    rd,
  );
  const at = (i: number, time: number) => starts[i * grid.times.length + grid.times.indexOf(time)]!;
  const read0 = states.flatMap(({ item, cap, activated, power, accumulator, count, first, latest }, i) =>
    cap !== undefined &&
    activated !== undefined &&
    power !== undefined &&
    accumulator &&
    count !== undefined &&
    latest !== undefined
      ? [
          {
            ...item,
            cap,
            activated,
            power,
            accumulator: [accumulator[0], accumulator[1]] as const,
            count,
            first: first ? Number(first.ts) : 0,
            starts: grid.windows.map((time) => at(i, time)),
            record: grid.record.map((time) => at(i, time)),
            latest: latests[i]!,
          },
        ]
      : [],
  );
  const ids = read0.flatMap(({ rewards, count }) =>
    Array.from({ length: Math.min(Number(count), PROGRAMS) }, (_, i) => ({ rewards, id: count - BigInt(i) })),
  );
  const programs = await readEach(ids, { program: ({ rewards, id }) => manager(rewards)("incentive", id) }, rd);
  const tokens = await describe(
    programs.flatMap(({ program }) => (program ? [program.token] : [])),
    rd,
  );
  const byRewards = Map.groupBy(
    programs.flatMap(({ item, program }) =>
      program
        ? [
            {
              rewards: item.rewards,
              program: {
                id: item.id,
                token: tokens.get(key(program.token)),
                rate: program.rate,
                start: Number(program.start),
                end: Number(program.end),
              },
            },
          ]
        : [],
    ),
    ({ rewards }) => rewards,
  );

  const gauges = read0.map((each): Gauge => {
    const { token0, token1 } = each;
    const end = endOf(each.latest, each.accumulator, each.power, now);
    const windows = Object.fromEntries(
      WINDOWS.map((hours, i) => [hours, accruedFrom(each.starts[i]!, each.first, end)]),
    ) as Record<Hours, Accrued>;
    return {
      address: each.address,
      pool: each.pool,
      rewards: each.rewards,
      kind: each.kind,
      tickSpacing: each.tickSpacing,
      token0,
      token1,
      name: nameOf(each),
      activated: each.activated,
      cap: each.cap,
      power: each.power,
      end,
      first: each.first,
      windows,
      programs: (byRewards.get(each.rewards) ?? []).map(({ program }) => program),
      programCount: Number(each.count),
    };
  });
  return {
    gauges,
    past: { times: grid.record, starts: new Map(read0.map(({ rewards, record }) => [key(rewards), record])) },
  };
}

export async function startsSince(gauges: Gauge[], time: number, rd: Read = read): Promise<Map<string, Start>> {
  const rewards = gauges.map((gauge) => gauge.rewards);
  const starts = await startsAt(rewards, [BigInt(time)], rd);
  return new Map(rewards.map((address, i) => [key(address), starts[i]!]));
}
export const sinceIn =
  (starts: Map<string, Start>) =>
  (gauge: Gauge): Accrued | undefined => {
    const start = starts.get(key(gauge.rewards));
    return start && accruedFrom(start, gauge.first, gauge.end);
  };

// Newest first. A row covers several days when no checkpoint fell in some. The oldest starts at the gauge's first
// checkpoint, if `days` reach back to it. Rows stop at an unread snapshot.
export type Day = Accrued & { day: number; days: number };
export async function historyOf(gauge: Gauge, days: number, rd: Read = read): Promise<Day[]> {
  const today = gauge.end.at - (gauge.end.at % DAY);
  const bounds = Array.from({ length: days + 1 }, (_, k) => today - k * DAY);
  const starts = await startsAt(
    [gauge.rewards],
    bounds.map((bound) => BigInt(bound)),
    rd,
  );
  return stitched(gauge, bounds, starts);
}
export function stitched(gauge: Gauge, bounds: number[], starts: Start[]): Day[] {
  const rows: Day[] = [];
  let end = gauge.end;
  let last: bigint | undefined;
  for (const [k, start] of starts.entries()) {
    const bound = bounds[k]!;
    if (start.index === undefined) break;
    if (start.index !== 0n && start.index === last) {
      const row = rows.at(-1)!;
      [row.day, row.days] = [bound, row.days + 1];
      continue;
    }
    if (start.index === 0n) {
      if (gauge.first && gauge.first < end.at)
        rows.push({ ...accruedFrom(start, gauge.first, end), day: bound, days: 1 });
      break;
    }
    if (!start.acc || start.ts === undefined) break;
    rows.push({ ...accruedFrom(start, gauge.first, end), day: bound, days: 1 });
    last = start.index;
    end = {
      at: start.ts,
      acc: [start.acc[0]!, start.acc[1]!],
      share: start.share,
      zero: start.zero ?? 0,
      power: start.supply ?? end.power,
    };
  }
  return rows;
}

// The least of start, end and mean power: a gauge that held next to nothing for a while pays a lot per unit then.
export const weightOf = (accrued: Accrued): number =>
  Math.min(whole(accrued.power), whole(accrued.endPower), accrued.spread ?? Infinity);
export const thinOver = (accrued: Accrued): boolean => weightOf(accrued) < THIN;
// The harmonic mean, which times the fees per unit gives what was paid when fees come evenly.
export const meanOf = (accrued: Accrued): number =>
  accrued.spread ?? Math.min(whole(accrued.power), whole(accrued.endPower));

// `priced` is false if a token that paid has no price, which counts as 0.
export type Yield = { value: number; priced: boolean };
export function feesPerDay(gauge: Gauge, accrued: Accrued | undefined, prices: Prices): Yield | undefined {
  const span = accrued ? accrued.to - accrued.from : 0;
  if (!accrued || span <= 0) return undefined;
  let [value, priced] = [0, true];
  for (const [amount, token] of [
    [accrued.fees0, gauge.token0],
    [accrued.fees1, gauge.token1],
  ] as const) {
    if (amount === 0n) continue;
    const price = prices.of.get(key(token.address));
    if (price === undefined) priced = false;
    else value += worthOf(amount, token.decimals, price) / PER_UNITS;
  }
  return { value: value / (span / DAY), priced };
}
export function windowFees(gauge: Gauge, hours: Hours, prices: Prices): Yield | undefined {
  const accrued = gauge.windows[hours];
  return accrued.to - accrued.from >= 0.9 * hours * HOUR ? feesPerDay(gauge, accrued, prices) : undefined;
}

export const isLive = (program: Program, time: number): boolean => program.start <= time && time < program.end;
export function streamPerDay(gauge: Gauge, time: number, prices: Prices): Yield {
  let [value, priced] = [0, true];
  for (const program of gauge.programs) {
    if (!isLive(program, time) || program.rate === 0n) continue;
    const price = program.token && prices.of.get(key(program.token.address));
    if (price === undefined) priced = false;
    else value += (Number(program.rate) / RATE / 10 ** program.token!.decimals) * DAY * price;
  }
  return { value, priced };
}

export type Per10k = { fees: number; incentives: number; total: number; priced: boolean };
export function per10k(gauge: Gauge, hours: Hours, time: number, prices: Prices, amount = 0): Per10k | undefined {
  const fees = windowFees(gauge, hours, prices);
  const power = whole(gauge.power);
  if (!fees || power <= 0) return undefined;
  const stream = streamPerDay(gauge, time, prices);
  const shared = (fees.value * power) / (power + amount);
  const incentives = (stream.value * PER) / (power + amount);
  return { fees: shared, incentives, total: shared + incentives, priced: fees.priced && stream.priced };
}

export const isThin = (gauge: Gauge, hours: Hours): boolean => thinOver(gauge.windows[hours]);

// Weighed by mean power, leaving out gauges without power or paying a token without a price.
export type Average = Omit<Per10k, "priced">;
export function average(market: Market, accrued: (gauge: Gauge) => Accrued | undefined, live = true): Average {
  let [weight, fees, stream] = [0, 0, 0];
  for (const gauge of market.gauges) {
    const span = accrued(gauge);
    const power = span ? meanOf(span) : 0;
    const found = power > 0 ? feesPerDay(gauge, span, market.prices) : undefined;
    const incentives = live ? streamPerDay(gauge, market.time, market.prices) : { value: 0, priced: true };
    if (!found?.priced || !incentives.priced) continue;
    weight += power;
    fees += found.value * power;
    stream += incentives.value;
  }
  const [f, i] = weight ? [fees / weight, (stream * PER) / weight] : [0, 0];
  return { fees: f, incentives: i, total: f + i };
}
export const averageOver = (market: Market, hours: Hours): Average => average(market, (gauge) => gauge.windows[hours]);

export type Allocation = { gauge: Address; amount: bigint };
// `idle` is on no chain; `approved` is approved for this stake alone; `module` says whether its owner approved Aero's
// payments module for all their stakes.
export type Stake = {
  id: bigint;
  owner: Address;
  amount: bigint;
  end: number;
  permanent: boolean;
  approved: Address;
  module: boolean;
  onBase: bigint;
  idle: bigint;
  elsewhere: bigint;
  lastAllocated: number;
  reduction: number;
  allocations: Allocation[];
};
export const isIdleGauge = (gauge: Address): boolean => same(gauge, zeroAddress);
const lookups = new WeakMap<Market, Map<string, Gauge>>();
export function gaugeAt(market: Market, address: Address): Gauge | undefined {
  let found = lookups.get(market);
  if (!found) lookups.set(market, (found = new Map(market.gauges.map((gauge) => [key(gauge.address), gauge]))));
  return found.get(key(address));
}
// 0 if it never allocated.
export const movesAt = ({ lastAllocated, reduction }: Stake, cooldown: number): number =>
  lastAllocated ? Math.max(0, lastAllocated + cooldown - reduction) : 0;

// Ids with no stake are left out.
export async function readStakes(ids: bigint[], rd: Read = read): Promise<Stake[]> {
  const found = await readEach(
    ids,
    {
      staked: (id) => escrow("staked", id),
      owner: (id) => escrow("ownerOf", id),
      approved: (id) => escrow("getApproved", id),
      chains: (id) => root("allocationChainIds", id),
      state: (id) => leaf("tokenStates", id),
      gauges: (id) => leaf("allocatedGauges", id),
      reduction: (id) => leaf("accumulatedCooldownReduction", id),
    },
    rd,
  );
  const stakes = found.flatMap(({ owner, staked, ...each }) => (owner && staked ? [{ ...each, owner, staked }] : []));
  const [amounts, allocations, modules] = await Promise.all([
    readEach(
      stakes.flatMap(({ item: id, chains }) =>
        [...new Set([0n, BigInt(CHAIN_ID), ...(chains ?? [])])].map((chain) => ({ id, chain })),
      ),
      { amount: ({ id, chain }) => root("allocationChainAmounts", id, chain) },
      rd,
    ),
    readEach(
      stakes.flatMap(({ item: id, gauges }) => (gauges ?? []).map((gauge) => ({ id, gauge }))),
      { amount: ({ id, gauge }) => leaf("allocations", id, gauge) },
      rd,
    ),
    readEach(
      [...new Set(stakes.map(({ owner }) => owner))],
      { approved: (owner) => escrow("isApprovedForAll", owner, PAYMENTS_MODULE) },
      rd,
    ),
  ]);
  return stakes.map(({ item: id, staked, owner, approved, state, reduction }) =>
    stakeOf({
      id,
      staked,
      owner,
      approved,
      module: modules.find(({ item }) => item === owner)?.approved ?? false,
      state,
      reduction,
      chains: amounts.flatMap(({ item, amount }) => (item.id === id ? [[item.chain, amount ?? 0n] as const] : [])),
      allocations: allocations.flatMap(({ item, amount }) =>
        item.id === id && amount ? [{ gauge: item.gauge, amount }] : [],
      ),
    }),
  );
}
// In `chains`, CHAIN0, the chain of idle power, is 0.
export type StakeReads = {
  id: bigint;
  staked: { amount: bigint; end: number; isPermanent: boolean };
  owner: Address;
  approved: Address | undefined;
  module: boolean;
  state: readonly [Address, number, boolean, bigint] | undefined;
  reduction: number | undefined;
  chains: (readonly [bigint, bigint])[];
  allocations: Allocation[];
};
export function stakeOf({
  id,
  staked,
  owner,
  approved,
  module,
  state,
  reduction,
  chains,
  allocations,
}: StakeReads): Stake {
  const on = (chain: bigint) => chains.find(([each]) => each === chain)?.[1] ?? 0n;
  const all = chains.reduce((sum, [, amount]) => sum + amount, 0n);
  return {
    id,
    owner,
    amount: staked.amount,
    end: Number(staked.end),
    permanent: staked.isPermanent,
    approved: approved ?? zeroAddress,
    module,
    onBase: on(BigInt(CHAIN_ID)),
    idle: on(0n),
    elsewhere: all - on(0n) - on(BigInt(CHAIN_ID)),
    lastAllocated: state ? Number(state[1]) : 0,
    reduction: Number(reduction ?? 0),
    allocations,
  };
}
export async function stakesOf(owner: Address, rd: Read = read): Promise<Stake[]> {
  const [count] = required(await rd([escrow("balanceOf", owner)]));
  const ids = required(
    await rd(Array.from({ length: Number(count) }, (_, i) => escrow("tokenOfOwnerByIndex", owner, BigInt(i)))),
  );
  return readStakes(ids, rd);
}

// What can be claimed from the gauges a stake is in now. `partial` if some was not counted: a failed read, older
// programs, or more checkpoints than an estimate walks.
export type Pending = { amounts: Map<string, { token: Token; amount: bigint }>; partial: boolean };
export async function pendingOf(stakes: Stake[], market: Market, rd: Read = read): Promise<Map<bigint, Pending>> {
  const pairs = stakes.flatMap((stake) =>
    stake.allocations.flatMap(({ gauge: address }) => {
      const gauge = gaugeAt(market, address);
      return gauge ? [{ stake, gauge }] : [];
    }),
  );
  const programs = pairs.flatMap(({ stake, gauge }) => gauge.programs.map((program) => ({ stake, gauge, program })));
  const heavy = { perBatch: HEAVY };
  const [fees, incentives, walks] = await Promise.all([
    readEach(
      pairs,
      { earned: ({ stake, gauge }) => manager(gauge.rewards)("earnedFees", stake.id, MAX_CHECKPOINTS) },
      rd,
      heavy,
    ),
    readEach(
      programs,
      {
        earned: ({ stake, gauge, program }) =>
          manager(gauge.rewards)("earnedIncentives", stake.id, program.id, MAX_CHECKPOINTS),
      },
      rd,
      heavy,
    ),
    readEach(
      pairs,
      {
        checkpoints: ({ stake, gauge }) => manager(gauge.rewards)("userRewardCheckpointIndex", stake.id),
        claimed: ({ stake, gauge }) => manager(gauge.rewards)("feeClaimState", stake.id),
      },
      rd,
    ),
  ]);
  const found = new Map(
    stakes.map(({ id, allocations }): [bigint, Pending] => [
      id,
      {
        amounts: new Map(),
        partial: allocations.some(({ gauge }) => !isIdleGauge(gauge) && !gaugeAt(market, gauge)),
      },
    ]),
  );
  const add = (id: bigint, token: Token | undefined, amount: bigint | undefined) => {
    const pending = found.get(id)!;
    if (amount === undefined || !token) pending.partial = true;
    if (!amount || !token) return;
    const was = pending.amounts.get(key(token.address));
    pending.amounts.set(key(token.address), { token, amount: (was?.amount ?? 0n) + amount });
  };
  for (const { item, earned } of fees) {
    add(item.stake.id, item.gauge.token0, earned?.[0]);
    add(item.stake.id, item.gauge.token1, earned?.[1]);
  }
  for (const { item, earned } of incentives) add(item.stake.id, item.program.token, earned);
  for (const { item, checkpoints, claimed } of walks) {
    const pending = found.get(item.stake.id)!;
    const unwalked = checkpoints === undefined || !claimed || checkpoints - claimed.lastUserCp > MAX_CHECKPOINTS;
    if (unwalked || item.gauge.programs.length < item.gauge.programCount) pending.partial = true;
  }
  return found;
}
export function worthPending({ amounts }: Pending, prices: Prices): Yield {
  let [value, priced] = [0, true];
  for (const { token, amount } of amounts.values()) {
    const price = prices.of.get(key(token.address));
    if (price === undefined) priced = false;
    else value += worthOf(amount, token.decimals, price);
  }
  return { value, priced };
}

// Shares include the zero gauge, which earns nothing.
export type Share = { gauge: Gauge | undefined; address: Address; amount: bigint; share: number };
export function sharesOf(stake: Stake, market: Market): Share[] {
  const total = stake.allocations.reduce((sum, { amount }) => sum + amount, 0n);
  return stake.allocations
    .map(({ gauge, amount }) => ({
      gauge: gaugeAt(market, gauge),
      address: gauge,
      amount,
      share: total ? Number(amount) / Number(total) : 0,
    }))
    .sort((a, b) => b.share - a.share);
}
export function earnedBy(shares: Share[], accrued: (gauge: Gauge) => Accrued | undefined, prices: Prices): Yield {
  let [value, priced] = [0, true];
  for (const { gauge, share } of shares) {
    const found = gauge && feesPerDay(gauge, accrued(gauge), prices);
    if (!found) continue;
    value += share * found.value;
    priced &&= found.priced;
  }
  return { value, priced };
}
export function paidBy(shares: Share[], market: Market, hours: Hours): Yield | undefined {
  let [value, priced, any] = [0, true, false];
  for (const { gauge, share } of shares) {
    const found = gauge && per10k(gauge, hours, market.time, market.prices);
    if (!found) continue;
    [value, priced, any] = [value + share * found.total, priced && found.priced, true];
  }
  return any ? { value, priced } : undefined;
}

// What a pool pays all its sAERO a day, by token. A value is undefined if its token has no price.
export type Flow = { token: Token | undefined; value: number | undefined };
export type Paying = { fees: Flow[]; incentives: Flow[]; power: number };
const valueOf = (token: Token | undefined, units: number, prices: Prices): number | undefined => {
  const price = token && prices.of.get(key(token.address));
  return token && price !== undefined ? (units / 10 ** token.decimals) * price : undefined;
};
// All the sAERO at the accrual's mean power earned the growth × mean / 1e6, in the token's smallest units.
function feeFlows(gauge: Gauge, accrued: Accrued, prices: Prices): Flow[] {
  const [days, mean] = [(accrued.to - accrued.from) / DAY, meanOf(accrued)];
  return (
    [
      [gauge.token0, accrued.fees0],
      [gauge.token1, accrued.fees1],
    ] as const
  ).flatMap(([token, growth]) =>
    growth ? [{ token, value: valueOf(token, ((Number(growth) / 1e6) * mean) / days, prices) }] : [],
  );
}
function streamFlows(gauge: Gauge, from: number, to: number, prices: Prices, counted = (_: Program) => true): Flow[] {
  const days = (to - from) / DAY;
  return gauge.programs.flatMap((program) => {
    const overlap = Math.min(to, program.end) - Math.max(from, program.start);
    if (overlap <= 0 || !program.rate || !counted(program)) return [];
    return [
      { token: program.token, value: valueOf(program.token, ((Number(program.rate) / RATE) * overlap) / days, prices) },
    ];
  });
}
// Coming from a checkpoint before the window, a span is shorter only for a gauge younger than the window.
const covers = (accrued: Accrued, seconds: number): boolean => accrued.to - accrued.from >= 0.9 * seconds;

// Undefined without time or power.
export function paidOver(gauge: Gauge, accrued: Accrued | undefined, prices: Prices): Paying | undefined {
  if (!accrued || accrued.to <= accrued.from) return undefined;
  const power = meanOf(accrued);
  if (!(power > 0)) return undefined;
  return {
    fees: feeFlows(gauge, accrued, prices),
    incentives: streamFlows(gauge, accrued.from, accrued.to, prices),
    power,
  };
}
// What a pool would pay a day over the next `hold` seconds, shared by its sAERO now: the window's fees again, and what
// its programs stream over the hold.
export function paysNext(gauge: Gauge, hours: Hours, market: Market, hold: number): Paying | undefined {
  const accrued = gauge.windows[hours];
  if (!covers(accrued, hours * HOUR) || !(meanOf(accrued) > 0)) return undefined;
  return {
    fees: feeFlows(gauge, accrued, market.prices),
    incentives: streamFlows(gauge, market.time, market.time + hold, market.prices),
    power: whole(gauge.power),
  };
}

function sumOf(flows: Flow[]): Yield {
  let [value, priced] = [0, true];
  for (const flow of flows) [value, priced] = [value + (flow.value ?? 0), priced && flow.value !== undefined];
  return { value, priced };
}
export const totalOf = (paying: Paying): number => sumOf(paying.fees).value + sumOf(paying.incentives).value;
// A rate per 10,000 sAERO a day as an APR, each sAERO counted as one AERO at its price; undefined without one.
export function aprOf(per10k: number, prices: Prices): number | undefined {
  const price = prices.of.get(key(config.AERO));
  return price ? (per10k * 365) / (PER * price) : undefined;
}
// With `added` sAERO more, or fewer if negative.
export function per10kOf(paying: Paying, added = 0): Per10k | undefined {
  const power = paying.power + added;
  if (!(power > 0)) return undefined;
  const [fees, incentives] = [sumOf(paying.fees), sumOf(paying.incentives)];
  const [f, i] = [(fees.value * PER) / power, (incentives.value * PER) / power];
  return { fees: f, incentives: i, total: f + i, priced: fees.priced && incentives.priced };
}

export type Holding = { gauge: Gauge | undefined; weight: number };
// What the strategy ranks pools by: what they pay, or their fees alone without `incentives`.
export const payOf = (paying: Paying, incentives = true): number =>
  incentives ? totalOf(paying) : sumOf(paying.fees).value;
// The top `count` pools by `payOf`, each weighed by its share of it.
export type Pick = { gauge: Gauge; weight: number; paying: Paying };
export function picksOf(pools: { gauge: Gauge; paying: Paying }[], count: number, incentives = true): Pick[] {
  const top = pools
    .map((each) => ({ ...each, total: payOf(each.paying, incentives) }))
    .filter(({ total }) => total > 0)
    .sort((a, b) => b.total - a.total)
    .slice(0, Math.max(0, count));
  const sum = top.reduce((all, { total }) => all + total, 0);
  return top.map(({ gauge, paying, total }) => ({ gauge, paying, weight: total / sum }));
}
// What 10,000 of `amount` sAERO held as `holdings` earn a day. Each pool takes its weight of `amount`, less what `mine`
// (whole sAERO by gauge) already holds there. A holding outside the market's pools, or in a pool without an answer,
// counts for nothing and leaves the figure partial, a lower bound. Undefined when no pool has an answer.
export function heldOver(
  holdings: Holding[],
  payingOf: (gauge: Gauge) => Paying | undefined,
  amount = 0,
  mine?: Map<string, number>,
): Per10k | undefined {
  let [fees, incentives, priced, any] = [0, 0, true, false];
  for (const { gauge, weight } of holdings) {
    if (!(weight > 0)) continue;
    const paying = gauge && payingOf(gauge);
    const found = paying && per10kOf(paying, amount * weight - (mine?.get(key(gauge.address)) ?? 0));
    if (!found) {
      priced = false;
      continue;
    }
    [fees, incentives] = [fees + weight * found.fees, incentives + weight * found.incentives];
    [priced, any] = [priced && found.priced, true];
  }
  return any ? { fees, incentives, total: fees + incentives, priced } : undefined;
}
// All the pools pay over all their sAERO, leaving out pools paying tokens without a price.
export function marketOver(gauges: Gauge[], payingOf: (gauge: Gauge) => Paying | undefined): Average {
  let [power, fees, incentives] = [0, 0, 0];
  for (const gauge of gauges) {
    const paying = payingOf(gauge);
    if (!paying || !(paying.power > 0)) continue;
    const [f, i] = [sumOf(paying.fees), sumOf(paying.incentives)];
    if (!f.priced || !i.priced) continue;
    [power, fees, incentives] = [power + paying.power, fees + f.value, incentives + i.value];
  }
  const [f, i] = power ? [(fees * PER) / power, (incentives * PER) / power] : [0, 0];
  return { fees: f, incentives: i, total: f + i };
}
// Pools' snapshots at `times`, newest first, by rewards manager.
export type Past = { times: number[]; starts: Map<string, (Start | undefined)[]> };
export const pastOf = (rewards: Address[], times: number[], starts: Start[]): Past => ({
  times,
  starts: new Map(rewards.map((address, i) => [key(address), starts.slice(i * times.length, (i + 1) * times.length)])),
});
export function mergePast(a: Past, b: Past): Past {
  const times = [...new Set([...a.times, ...b.times])].sort((x, y) => y - x);
  const of = (past: Past, id: string, time: number) => past.starts.get(id)?.[past.times.indexOf(time)];
  const ids = new Set([...a.starts.keys(), ...b.starts.keys()]);
  return {
    times,
    starts: new Map([...ids].map((id) => [id, times.map((time) => of(a, id, time) ?? of(b, id, time))])),
  };
}
// A checkpoint read as a past end. Fees credited after it count in the time after.
const pointOf = (start: Start | undefined): Point | undefined =>
  start && start.index !== 0n && start.acc && start.ts !== undefined
    ? {
        at: start.ts,
        acc: [start.acc[0]!, start.acc[1]!],
        share: start.share,
        zero: start.zero ?? 0,
        power: start.supply ?? 0n,
      }
    : undefined;
// To one of the past's times, or to now.
export function accrualOf(gauge: Gauge, past: Past, from: number, to: number, market: Market): Accrued | undefined {
  const starts = past.starts.get(key(gauge.rewards));
  const start = starts?.[past.times.indexOf(from)];
  const end = to >= market.time ? gauge.end : pointOf(starts?.[past.times.indexOf(to)]);
  return start && end ? accruedFrom(start, gauge.first, end) : undefined;
}
// Newest first; the newest ends now.
export type Step = { from: number; to: number };
export const stepsOf = (market: Market): Step[] =>
  market.past.times.slice(0, PICKS).map((from, k) => ({ from, to: k ? market.past.times[k - 1]! : market.time }));
// `prices` value the step: the market's, or the mean of the prices at its two ends.
export type Paid = Step & { paid: Per10k | undefined; prices: Prices };
// Prices at the record's step starts, by time.
export type Then = Map<number, Prices>;
// The prices at `time`, the market's from its time on. A past pricing in another unit, after its feeds failed, is left
// out, so that units never mix.
function pricedAt(market: Market, then: Then | undefined, time: number): Prices | undefined {
  const found = time >= market.time ? market.prices : then?.get(time);
  return found?.unit === market.prices.unit ? found : undefined;
}
// Each step's prices, by `then` and market, so that every line shares them.
const stepPrices = new WeakMap<Then, WeakMap<Market, Map<number, Prices>>>();
// The mean of the prices at a step's two ends, or either's where the other has none; the market's without either.
function pricesOver(market: Market, then: Then | undefined, { from, to }: Step): Prices {
  if (!then) return market.prices;
  const byMarket = stepPrices.get(then) ?? new WeakMap<Market, Map<number, Prices>>();
  const bySteps = byMarket.get(market) ?? new Map<number, Prices>();
  stepPrices.set(then, byMarket);
  byMarket.set(market, bySteps);
  const known = bySteps.get(from);
  if (known) return known;
  const [a, b] = [pricedAt(market, then, from), pricedAt(market, then, to)];
  let found = a ?? b ?? market.prices;
  if (a && b) {
    const of = new Map<string, number>();
    for (const token of new Set([...a.of.keys(), ...b.of.keys()])) {
      const [x, y] = [a.of.get(token), b.of.get(token)];
      of.set(token, x === undefined ? y! : y === undefined ? x : (x + y) / 2);
    }
    found = {
      unit: market.prices.unit,
      rates: market.prices.rates,
      of,
      ...((a.unread || b.unread) && { unread: true }),
    };
  }
  bySteps.set(from, found);
  return found;
}

// The top `count` pools, of all or of blue chips, by the fees they paid over the `hours` before each pick and, unless
// `incentives` is false, what their live programs stream over the next step, each given its share; picked again every
// step (`again`), or once at the oldest step's start.
export type Strategy = { count: number; hours: Hours; again: boolean; blueChips: boolean; incentives: boolean };
export const isBlueChip = ({ token0, token1 }: Gauge): boolean =>
  [token0, token1].every(({ address }) => config.BLUE_CHIPS.some((chip) => same(chip, address)));
// False for thin pools and pools paying a token without a price, which the strategy and the suggestion leave out.
export const weighable = (accrued: Accrued, paying: Paying): boolean =>
  !thinOver(accrued) && !!per10kOf(paying)?.priced;
// From what each pool paid over the `hours` before `time`, and what its programs live then would stream over the next
// step, at `prices`, those of `time`.
export function picksAt(
  market: Market,
  past: Past,
  time: number,
  { count, hours, blueChips, incentives }: Strategy,
  prices = market.prices,
): Pick[] {
  const since = time - hours * HOUR;
  const pools = market.gauges
    .filter((gauge) => routable(gauge) && (!blueChips || isBlueChip(gauge)))
    .flatMap((gauge) => {
      const before = accrualOf(gauge, past, since, time, market);
      if (!before || before.to <= before.from || before.from > since + 0.1 * (time - since) || !(meanOf(before) > 0))
        return [];
      const live = (program: Program) => program.start <= time;
      const paying = {
        fees: feeFlows(gauge, before, prices),
        incentives: streamFlows(gauge, time, time + STEP, prices, live),
        power: meanOf(before),
      };
      return weighable(before, paying) ? [{ gauge, paying }] : [];
    });
  return picksOf(pools, count, incentives);
}
// The snapshots a strategy needs beyond the grid's.
export function timesFor(market: Market, { again, hours }: Strategy): number[] {
  const steps = stepsOf(market);
  const picks = again ? steps.map(({ from }) => from) : steps.slice(-1).map(({ from }) => from);
  return picks.map((time) => time - hours * HOUR).filter((time) => !market.past.times.includes(time));
}
const paidDuring = (market: Market, past: Past, step: Step, prices: Prices) => (gauge: Gauge) =>
  paidOver(gauge, accrualOf(gauge, past, step.from, step.to, market), prices);
// How a record is held: `amount` sAERO more in the pools, less what the stake's `own` moves, if read, already had in
// them, at `then`'s prices.
export type Held = { amount?: number; then?: Then; own?: Move[] };
// The whole sAERO by gauge that `moves` held over a span, on average: what they already added to each pool's power.
export function heldIn(moves: Move[], { from, to }: Step): Map<string, number> {
  const mine = new Map<string, number>();
  const cuts = [from, ...moves.map(({ at }) => at).filter((at) => at > from && at < to), to].sort((a, b) => a - b);
  for (let i = 0; i + 1 < cuts.length; i++) {
    const share = (cuts[i + 1]! - cuts[i]!) / (to - from);
    for (const { gauge, amount } of moves.find(({ at }) => at <= cuts[i]!)?.allocations ?? [])
      if (!isIdleGauge(gauge)) mine.set(key(gauge), (mine.get(key(gauge)) ?? 0) + whole(amount) * share);
  }
  return mine;
}
const heldSteps = (
  market: Market,
  past: Past,
  holdingsAt: (step: Step) => Holding[],
  { amount = 0, then, own }: Held,
): Paid[] =>
  stepsOf(market).map((step) => {
    const prices = pricesOver(market, then, step);
    const mine = own && heldIn(own, step);
    return { ...step, paid: heldOver(holdingsAt(step), paidDuring(market, past, step, prices), amount, mine), prices };
  });
// Each pick at the prices when it was made.
export function strategySteps(market: Market, past: Past, strategy: Strategy, held: Held = {}): Paid[] {
  const pick = (time: number) =>
    picksAt(market, past, time, strategy, pricedAt(market, held.then, time) ?? market.prices);
  const once = strategy.again ? undefined : pick(stepsOf(market).at(-1)!.from);
  return heldSteps(market, past, (step) => once ?? pick(step.from), held);
}
// Shares chosen now, held over every step: hindsight.
export const customSteps = (market: Market, past: Past, holdings: Holding[], held: Held = {}): Paid[] =>
  heldSteps(market, past, () => holdings, held);
// The Base average: all the pools paid in each step over all their sAERO, leaving out pools paying a token without a
// price.
export const averageSteps = (market: Market, past: Past, then?: Then): Paid[] =>
  stepsOf(market).map((step) => {
    const prices = pricesOver(market, then, step);
    const { fees, incentives, total } = marketOver(market.gauges, paidDuring(market, past, step, prices));
    return { ...step, paid: total > 0 ? { fees, incentives, total, priced: true } : undefined, prices };
  });

// A stake's allocations, newest first, each read at the block before the next, back to the first at or before `since`,
// at most `most` of them.
export type Move = { at: number; allocations: Allocation[] };
export async function movesOf(stake: Stake, since: number, rd: Read = read, most = 12): Promise<Move[]> {
  const moves: Move[] = [{ at: stake.lastAllocated, allocations: stake.allocations }];
  if (!(stake.lastAllocated > since)) return moves;
  const { newest, newestTime, timeOf } = await blockClock(rd);
  for (let at = stake.lastAllocated; at > since && moves.length < most;) {
    const block = (await firstBlockAt(at, newest, newestTime, timeOf)) - 1;
    const [state, gauges] = required(
      await rd([leaf("tokenStates", stake.id), leaf("allocatedGauges", stake.id)], { block }),
    );
    const amounts = required(
      await rd(
        gauges.map((gauge) => leaf("allocations", stake.id, gauge)),
        { block },
      ),
    );
    const before = Number(state[1]);
    if (!before || before >= at) break;
    moves.push({
      at: before,
      allocations: gauges.flatMap((gauge, i) => (amounts[i] ? [{ gauge, amount: amounts[i] }] : [])),
    });
    at = before;
  }
  return moves;
}
// So that steps can be cut where the allocation changed.
export async function movesPast(moves: Move[], market: Market, since: number, rd: Read = read): Promise<Past> {
  const times = moves.map(({ at }) => at).filter((at) => at > since && at < market.time);
  const rewards = [
    ...new Set(
      moves.flatMap(({ allocations }) => allocations.flatMap(({ gauge }) => gaugeAt(market, gauge)?.rewards ?? [])),
    ),
  ];
  if (!times.length || !rewards.length) return { times: [], starts: new Map() };
  return pastOf(rewards, times, await startsAt(rewards, times.map(BigInt), rd));
}
// Each step cut where the stake moved, each part held as its allocation was then, its sAERO on no chain earning
// nothing. A step is measured over the parts it held an allocation for.
export function movedSteps(market: Market, past: Past, moves: Move[], { amount = 0, then, own }: Held = {}): Paid[] {
  return stepsOf(market).map((step) => {
    const prices = pricesOver(market, then, step);
    const inside = moves.map(({ at }) => at).filter((at) => at > step.from && at < step.to);
    const cuts = [step.from, ...inside.sort((a, b) => a - b), step.to];
    let [fees, incentives, seconds, priced] = [0, 0, 0, true];
    for (let i = 0; i + 1 < cuts.length; i++) {
      const part = { from: cuts[i]!, to: cuts[i + 1]! };
      const move = moves.find(({ at }) => at <= part.from);
      const total = move?.allocations.reduce((sum, { amount }) => sum + amount, 0n) ?? 0n;
      if (!move || !total) continue;
      const holdings = move.allocations.flatMap(({ gauge, amount }) =>
        isIdleGauge(gauge) ? [] : [{ gauge: gaugeAt(market, gauge), weight: Number(amount) / Number(total) }],
      );
      const paid = heldOver(holdings, paidDuring(market, past, part, prices), amount, own && heldIn(own, part));
      if (!paid) continue;
      const length = part.to - part.from;
      [fees, incentives, seconds, priced] = [
        fees + paid.fees * length,
        incentives + paid.incentives * length,
        seconds + length,
        priced && paid.priced,
      ];
    }
    return {
      ...step,
      paid: seconds
        ? { fees: fees / seconds, incentives: incentives / seconds, total: (fees + incentives) / seconds, priced }
        : undefined,
      prices,
    };
  });
}
// The APR, and what 10,000 sAERO earned a day, over the steps whose APR is known, each at its own prices and weighed by
// its length, so that both cover the same steps.
export function aprOver(steps: Paid[]): { apr: number; total: number; priced: boolean } | undefined {
  let [apr, total, seconds, priced] = [0, 0, 0, true];
  for (const { from, to, paid, prices } of steps) {
    const found = paid && aprOf(paid.total, prices);
    if (found === undefined) continue;
    [apr, total, seconds] = [apr + found * (to - from), total + paid!.total * (to - from), seconds + to - from];
    priced &&= paid!.priced;
  }
  return seconds ? { apr: apr / seconds, total: total / seconds, priced } : undefined;
}

// Aero's Voter takes a stake's whole list for Base at once, replacing the last: amounts in sAERO's smallest units,
// above zero, gauges strictly ascending, adding up to exactly what the stake has on Base. What it has on no chain moves
// onto Base in the same call. Base is Aero's root chain, so the LeafVoter takes the list in the same transaction, with
// no gas limit and no fee, and reverts it while the stake holds.
export type Allotment = { gauge: Address; amount: bigint };
export const budgetOf = ({ onBase, idle }: Stake): bigint => onBase + idle;
// The weights need not add up to 1. Rounding goes to the largest amount; one that rounds to nothing is left out.
export function allotmentsOf(weights: { gauge: Address; weight: number }[], budget: bigint): Allotment[] {
  const units = weights.map(({ gauge, weight }) => ({ gauge, units: BigInt(Math.max(0, Math.round(weight * 1e9))) }));
  const total = units.reduce((sum, each) => sum + each.units, 0n);
  if (!total || budget <= 0n) return [];
  const found = units.map(({ gauge, units }) => ({ gauge, amount: (budget * units) / total }));
  const largest = found.reduce((best, each) => (each.amount > best.amount ? each : best));
  largest.amount += budget - found.reduce((sum, { amount }) => sum + amount, 0n);
  return found.filter(({ amount }) => amount > 0n).sort((a, b) => (BigInt(a.gauge) < BigInt(b.gauge) ? -1 : 1));
}
const BASE = BigInt(CHAIN_ID);
export function allocateCall(stake: Stake, allotments: Allotment[], refundTo: Address): Tx {
  const chains = stake.idle ? [{ chainId: BASE, delta: stake.idle, gasLimit: 0n, value: 0n }] : [];
  const gauges = allotments.map(({ gauge, amount }) => ({ gauge, allocated: amount, data: "0x" as Hex }));
  return {
    to: config.AERO_VOTER,
    data: encodeFunctionData({
      abi: aeroVoterAbi,
      functionName: "allocate",
      args: [stake.id, chains, [{ chainId: BASE, gasLimit: 0n, value: 0n, gauges }], refundTo],
    }),
  };
}
export type Blocked = { why: "ended" } | { why: "empty" } | { why: "held"; until: number };
export function blockedOf(stake: Stake, cooldown: number, time: number): Blocked | undefined {
  if (!stake.permanent && stake.end <= time) return { why: "ended" };
  if (!budgetOf(stake)) return { why: "empty" };
  const until = movesAt(stake, cooldown);
  return until > time ? { why: "held", until } : undefined;
}
// The name of the error an allocation reverted with, if it is one of Aero's.
export function refusalOf(data: Hex): string | undefined {
  try {
    return decodeErrorResult({ abi: allocateErrorsAbi, data }).errorName;
  } catch {
    return undefined;
  }
}

// Digits with "." for decimals, spaces ignored.
export function amountOf(text: string): number | undefined {
  const cleaned = text.replace(/\s/g, "");
  if (!cleaned) return 0;
  const value = Number(cleaned);
  return /^(\d+\.?\d*|\.\d+)$/.test(cleaned) && Number.isFinite(value) ? value : undefined;
}
