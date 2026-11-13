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

// A gauge's rewards manager keeps a running sum of the fees it paid per unit of power. It saves a snapshot of the sum
// at each checkpoint. What sAERO earned between two times is how much the sum grew between two snapshots.

const escrow = contract(config.AERO_ESCROW, aeroEscrowAbi);
const root = contract(config.AERO_VOTER, aeroVoterAbi);
const leaf = contract(config.LEAF_VOTER, leafVoterAbi);
const registry = contract(config.FACTORY_REGISTRY, registryAbi);
const manager = (address: Address) => contract(address, rewardsManagerAbi);

const HOUR = 3_600;
export const DAY = 86_400;
// In hours. The windows and the record use one grid of times 48 hours apart (see `gridOf`), so they share snapshots.
export const WINDOWS = [48, 96, 192] as const;
export type Hours = (typeof WINDOWS)[number];
// An allocation is locked for 47 hours, so a strategy can move every 48 hours.
export const STEP = 48 * HOUR;
export const PICKS = 4;
// Snapshot times, newest first. They count back from the time rounded down to the hour, so the same reads serve the
// whole hour.
export function gridOf(time: number): { windows: number[]; record: number[]; times: number[] } {
  const hour = time - (time % HOUR);
  const windows = WINDOWS.map((hours) => hour - hours * HOUR);
  const record = Array.from({ length: PICKS + 1 }, (_, k) => hour - (k + 1) * STEP);
  return { windows, record, times: [...new Set([...windows, ...record])].sort((a, b) => b - a) };
}
// Rewards managers credit fees × 1e24 / power, with power in 18-decimal units. So 10,000 sAERO earn the growth / 100,
// in the token's smallest units.
export const PER = 10_000;
const PER_UNITS = 100;
const RATE = 1e18;
// Rewards managers' supply accumulator is the sum of seconds × 1e42 / power.
const SUPPLY_SCALE = 10n ** 42n;
// Pools with fewer sAERO than this are thin: one allocation changes what each sAERO there earns.
export const THIN = 1_000_000;
// Only this many of a gauge's newest incentive programs are read. Programs run for days, so older ones have ended.
export const PROGRAMS = 50;
// Claim estimates walk at most this many checkpoints. They are costly, so each batch of reads holds at most `HEAVY`.
const MAX_CHECKPOINTS = 500n;
const HEAVY = 20;

// `share` is the supply accumulator, undefined when it could not be read. `zero` is the seconds with no power.
export type Point = {
  at: number;
  acc: readonly [bigint, bigint];
  share: bigint | undefined;
  zero: number;
  power: bigint;
};
// The checkpoint at or before `time`, and the power at `time` (`supply`). `index` is 0 when there is no checkpoint yet.
// A field is undefined when its read failed.
export type Start = {
  index: bigint | undefined;
  time?: number | undefined;
  acc: readonly bigint[] | undefined;
  ts: number | undefined;
  share: bigint | undefined;
  zero: number | undefined;
  supply: bigint | undefined;
};
// Fee accumulator growth from a checkpoint to a later time. `spread` is the harmonic mean of the power, in whole sAERO,
// from the start's `time` (or else from the checkpoint) to `to`. Undefined when it can't be worked out.
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
  // Allocations to a gauge earn nothing when it isn't activated or its cap is zero.
  activated: boolean;
  cap: bigint;
  power: bigint;
  end: Point;
  // When its rewards manager first checkpointed, or 0.
  first: number;
  windows: Record<Hours, Accrued>;
  // Only the newest `PROGRAMS` of its `programCount` programs.
  programs: Program[];
  programCount: number;
};
// `unread` lists gauges left out because a read failed. `unknown` lists gauge factories the page doesn't know. `past`
// holds every pool's snapshots at the record's times.
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

// Pool names as Aero writes them, such as "CL50-WETH/USDC" and "vAMM-AERO/USDC".
const PREFIXES: Record<GaugeKind, (tickSpacing: number) => string> = {
  volatile: () => "vAMM",
  stable: () => "sAMM",
  cl: (tickSpacing) => `CL${tickSpacing}`,
};
export const nameOf = ({ kind, tickSpacing, token0, token1 }: Listed): string =>
  `${PREFIXES[kind](tickSpacing)}-${token0.symbol}/${token1.symbol}`;

// Index 0 means there is no checkpoint yet, so the sums start from zero at the first checkpoint. An unread snapshot
// accrues nothing. Fees can be credited between checkpoints, but power can't change. So fees count from the
// checkpoint, and the mean power counts from `time`.
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
// Ordered by manager, then by time.
export const startsAt = async (rewards: Address[], times: bigint[], rd: Read): Promise<Start[]> =>
  snapshotsOf(await indicesAt(rewards, times, rd), rd);
export type StartsOf = (rewards: Address[], times: number[]) => Promise<Start[]>;
// A snapshot that should exist but could not be read.
export const unreadStart = ({ index, acc, ts }: Start): boolean => index !== 0n && (!acc || ts === undefined);

// Gauge details that change only when Aero adds a gauge.
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

// The gauge list is kept for an hour. While some gauges are unread, it is kept for five minutes instead, for up to
// `RETRIES` reads in a row.
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
// How much of each token the gauges pay in a day. For each gauge, this is its highest daily fees across the windows,
// plus a day of its live programs. Pricing checks that pools are deep enough for these amounts.
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
      // All of the gauge's sAERO together earned growth × power / 1e24, with power in 18-decimal units. With power in
      // whole sAERO, that is growth × power / 1e6.
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

// A gauge whose state can't be read is left out and listed in `unread`. If only its snapshots or programs can't be
// read, just those are left out.
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
  // Pricing looks up pools while the gauges are read. Only its depth check waits for what the gauges pay.
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

// Newest first. A row covers several days when some of them had no checkpoint. The oldest row starts at the gauge's
// first checkpoint, if `days` reaches back that far. Rows stop at the first snapshot that could not be read.
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

// The lowest of the start, end and mean power. A gauge that had almost no power for a while paid a lot per unit then.
export const weightOf = (accrued: Accrued): number =>
  Math.min(whole(accrued.power), whole(accrued.endPower), accrued.spread ?? Infinity);
export const thinOver = (accrued: Accrued): boolean => weightOf(accrued) < THIN;
// The harmonic mean of the power, or else the lower of the start and end power. Multiplied by the fees per unit, it
// gives the total paid, if fees came in evenly.
export const meanOf = (accrued: Accrued): number =>
  accrued.spread ?? Math.min(whole(accrued.power), whole(accrued.endPower));

// `priced` is false when a token that paid has no price. That token counts as 0.
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

// Weighted by mean power. Leaves out gauges with no power, and gauges that pay a token with no price.
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
// `idle` is the amount on no chain. `approved` is the address approved for this stake alone. `module` is true when the
// owner approved Aero's payments module for all their stakes.
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
// In `chains`, chain 0 holds the idle power, which is on no chain.
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

// What a stake can claim now from the gauges it is in. `partial` is true when some of it could not be counted: a gauge
// or a read is missing, older programs were not read, or there were more checkpoints than an estimate walks.
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

// What a pool pays all its sAERO in a day, by token. `value` is undefined when the token is unknown or has no price.
export type Flow = { token: Token | undefined; value: number | undefined };
export type Paying = { fees: Flow[]; incentives: Flow[]; power: number };
const valueOf = (token: Token | undefined, units: number, prices: Prices): number | undefined => {
  const price = token && prices.of.get(key(token.address));
  return token && price !== undefined ? (units / 10 ** token.decimals) * price : undefined;
};
// At the accrual's mean power, in whole sAERO, all the sAERO earned growth × mean / 1e6 in the token's smallest units.
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
// Accruals start at a checkpoint at or before the window's start. So one falls short of the window only when the gauge
// is younger than the window, or a snapshot could not be read.
const covers = (accrued: Accrued, seconds: number): boolean => accrued.to - accrued.from >= 0.9 * seconds;
// The sAERO that will share a pool's pay, as a strategy counts it. It is the larger of two figures. The first is the
// mean power over the last 48 hours (`recent`), or over the strategy's `window` if `recent` is missing or too short.
// The second is the power at `end`, or else at the end of that span. Taking the larger stops a pool that others just
// left from looking better than it is.
function crowdOf(recent: Accrued | undefined, window: Accrued, end?: bigint): number {
  const lately = recent && covers(recent, 48 * HOUR) ? recent : window;
  return Math.max(meanOf(lately), whole(end ?? lately.endPower));
}

// Undefined when there is no accrual, or it has no time or no power.
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
// What a pool would pay a day over the next `hold` seconds, shared by its sAERO now (see `crowdOf`). Fees repeat the
// window's fees. Incentives are what its programs stream during the hold.
export function paysNext(gauge: Gauge, hours: Hours, market: Market, hold: number): Paying | undefined {
  const accrued = gauge.windows[hours];
  if (!covers(accrued, hours * HOUR) || !(meanOf(accrued) > 0)) return undefined;
  return {
    fees: feeFlows(gauge, accrued, market.prices),
    incentives: streamFlows(gauge, market.time, market.time + hold, market.prices),
    power: crowdOf(gauge.windows[48], accrued, gauge.power),
  };
}

function sumOf(flows: Flow[]): Yield {
  let [value, priced] = [0, true];
  for (const flow of flows) [value, priced] = [value + (flow.value ?? 0), priced && flow.value !== undefined];
  return { value, priced };
}
export const totalOf = (paying: Paying): number => sumOf(paying.fees).value + sumOf(paying.incentives).value;
// Turns what 10,000 sAERO earn a day into an APR, counting each sAERO as one AERO at AERO's price. Undefined when AERO
// has no price.
export function aprOf(per10k: number, prices: Prices): number | undefined {
  const price = prices.of.get(key(config.AERO));
  return price ? (per10k * 365) / (PER * price) : undefined;
}
// With `added` more sAERO in the pool, or fewer if `added` is negative.
export function per10kOf(paying: Paying, added = 0): Per10k | undefined {
  const power = paying.power + added;
  if (!(power > 0)) return undefined;
  const [fees, incentives] = [sumOf(paying.fees), sumOf(paying.incentives)];
  const [f, i] = [(fees.value * PER) / power, (incentives.value * PER) / power];
  return { fees: f, incentives: i, total: f + i, priced: fees.priced && incentives.priced };
}

export type Holding = { gauge: Gauge | undefined; weight: number };
// Shares below this (1%) are dropped, so that every pool picked matters.
const SMALLEST = 0.01;
// A pool the strategy can pick from. `paying` is what it pays, shared by its sAERO at the time of the pick
// (`paying.power`). `own` is how many of those whole sAERO belong to the stake.
export type Candidate = { gauge: Gauge; paying: Paying; own?: number };
export type Pick = { gauge: Gauge; weight: number; paying: Paying };
// Picks at most `count` pools for `amount` sAERO. Following revenue, it takes the pools that pay the most, each
// weighted by what it pays. Following the leaders, it splits the stake as `leadersOf` does. With no amount, it picks as
// for one sAERO.
export function picksOf(
  pools: Candidate[],
  { count, leaders }: { count: number; leaders: boolean },
  amount = 0,
): Pick[] {
  const shares = leaders ? leadersOf(pools, count, amount > 0 ? amount : 1) : byRevenue(pools, count);
  return shares
    .flatMap((weight, i) => (weight > 0 ? [{ gauge: pools[i]!.gauge, paying: pools[i]!.paying, weight }] : []))
    .sort((a, b) => b.weight - a.weight);
}
function byRevenue(pools: Candidate[], count: number): number[] {
  const top = pools
    .map(({ paying }, i) => ({ i, total: totalOf(paying) }))
    .filter(({ total }) => total > 0)
    .sort((a, b) => b.total - a.total)
    .slice(0, Math.max(0, count));
  const all = sum(top.map(({ total }) => total));
  const shares = pools.map(() => 0);
  for (const { i, total } of top) shares[i] = total / all;
  return shares;
}
// The leaders' shares of `amount` sAERO, by pool. A pool's lead is how much more each of its sAERO earns than the
// average over all the pools, both counted with the stake in them. Each share is in proportion to its pool's lead after
// that share has joined it, so no pool is filled past the average. If the kept pools can't take the whole stake while
// staying above the average, the stake goes instead to the pools, at most `count`, that pay the most when all are
// filled to the same pay.
function leadersOf(pools: Candidate[], count: number, amount: number): number[] {
  // `pays` is what all of a pool's sAERO earn a day, times 10,000, so `pays / others` is the pay per 10,000 sAERO.
  // `others` is the pool's sAERO other than the stake's own.
  const rows = pools.map(({ paying, own = 0 }) => ({
    pays: totalOf(paying) * PER,
    others: Math.max(paying.power - own, 0),
  }));
  const average = sum(rows.map(({ pays }) => pays)) / (sum(rows.map(({ others }) => others)) + amount);
  return (
    trimmed(rows, count, (kept) => leadingShares(rows, kept, average, amount)) ??
    trimmed(rows, count, (kept) => levelled(rows, kept, count, amount))!
  );
}
const sum = (xs: number[]): number => xs.reduce((all, x) => all + x, 0);
type Row = { pays: number; others: number };
// Runs `solve` over the pools that pay. Then drops pools past the top `count`, and pools under `SMALLEST` other than
// the largest, and runs it again, until none are dropped. Undefined once `solve` finds no answer.
function trimmed(rows: Row[], count: number, solve: (kept: boolean[]) => number[] | undefined): number[] | undefined {
  let kept = rows.map(({ pays }) => pays > 0);
  for (;;) {
    const shares = solve(kept);
    if (!shares) return undefined;
    const held = shares.flatMap((share, i) => (share > 0 ? [i] : [])).sort((a, b) => shares[b]! - shares[a]!);
    const keep = new Set(held.slice(0, Math.max(1, count)).filter((i, rank) => rank === 0 || shares[i]! >= SMALLEST));
    if (keep.size === held.length) return shares;
    kept = rows.map((_, i) => keep.has(i));
  }
}
// Shares w of the `kept` pools, with w = c × (pays ÷ (others + w × amount) − average), where the scale `c` makes the
// shares add up to one. Undefined if the pools can't take the whole stake while staying above the average.
function leadingShares(rows: Row[], kept: boolean[], average: number, amount: number): number[] | undefined {
  // As `c` grows, each pool fills up to the average. `room` is how many sAERO they can take before that.
  const room = sum(rows.map(({ pays, others }, i) => (kept[i] ? Math.max(0, pays / average - others) : 0)));
  if (!(room > amount * (1 + 1e-6))) return undefined;
  // The positive root of amount·w² + (others + c·average·amount)·w − c·(pays − average·others) = 0.
  const at = (c: number) =>
    rows.map(({ pays, others }, i) => {
      const [b, k] = [others + c * average * amount, c * (pays - average * others)];
      return kept[i] && k > 0 ? (2 * k) / (b + Math.sqrt(b * b + 4 * amount * k)) : 0;
    });
  let [low, high] = [0, 1];
  while (sum(at(high)) < 1) high *= 2;
  for (let k = 0; k < 200; k++) {
    const mid = (low + high) / 2;
    if (sum(at(mid)) < 1) low = mid;
    else high = mid;
  }
  const found = at(high);
  const total = sum(found);
  return found.map((share) => share / total);
}
// Picks at most `count` of the `kept` pools and fills each until they all pay the same. It chooses the pools that make
// this pay as high as possible: those that pay more than it, the furthest above it first (Dinkelbach's method).
function levelled(rows: Row[], kept: boolean[], count: number, amount: number): number[] {
  let [level, chosen] = [0, [] as number[]];
  for (let k = 0; k < 100; k++) {
    const gain = (i: number) => rows[i]!.pays - level * rows[i]!.others;
    const next = rows
      .flatMap((_, i) => (kept[i] && gain(i) > 0 ? [i] : []))
      .sort((a, b) => gain(b) - gain(a))
      .slice(0, Math.max(1, count));
    const found = sum(next.map((i) => rows[i]!.pays)) / (sum(next.map((i) => rows[i]!.others)) + amount);
    if (!(found > level * (1 + 1e-12))) break;
    [level, chosen] = [found, next];
  }
  const shares = rows.map(({ pays, others }, i) =>
    chosen.includes(i) ? Math.max(0, pays / level - others) / amount : 0,
  );
  const total = sum(shares);
  return total > 0 ? shares.map((share) => share / total) : shares;
}

// What 10,000 of `amount` sAERO, split as `holdings`, earn a day. Each pool gets its weight of `amount`, less what
// `mine` (whole sAERO by gauge) already holds there. A holding outside the market's pools, or in a pool with no figure,
// counts as 0 and sets `priced` to false, so the result is a lower bound. Undefined when no pool has a figure.
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
// What all the pools pay per 10,000 sAERO, over all their sAERO. Leaves out pools that pay a token with no price.
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
// Pools' snapshots at `times`, newest first, keyed by rewards manager.
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
// A checkpoint used as the end of a past span. Fees credited after it count in the next span.
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
// From one of the past's times to another, or to now.
export function accrualOf(gauge: Gauge, past: Past, from: number, to: number, market: Market): Accrued | undefined {
  const starts = past.starts.get(key(gauge.rewards));
  const start = starts?.[past.times.indexOf(from)];
  const end = to >= market.time ? gauge.end : pointOf(starts?.[past.times.indexOf(to)]);
  return start && end ? accruedFrom(start, gauge.first, end) : undefined;
}
// Newest first. The newest step ends now.
export type Step = { from: number; to: number };
export const stepsOf = (market: Market): Step[] =>
  market.past.times.slice(0, PICKS).map((from, k) => ({ from, to: k ? market.past.times[k - 1]! : market.time }));
// `prices` are the prices for the step: the market's, or the mean of the prices at its two ends.
export type Paid = Step & { paid: Per10k | undefined; prices: Prices };
// Prices at the record's step starts, by time.
export type Then = Map<number, Prices>;
// The prices at `time`. From the market's time on, these are the market's prices. Past prices in another unit (after
// their feeds failed) are left out, so units never mix.
function pricedAt(market: Market, then: Then | undefined, time: number): Prices | undefined {
  const found = time >= market.time ? market.prices : then?.get(time);
  return found?.unit === market.prices.unit ? found : undefined;
}
// A cache of each step's prices, by `then` and market, so every line uses the same prices.
const stepPrices = new WeakMap<Then, WeakMap<Market, Map<number, Prices>>>();
// The mean of the prices at a step's two ends. Where one end has no price, the other end's is used. With neither, the
// market's prices are used.
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

// A strategy picks at most `count` pools, from all pools or only blue chips. It splits them as `picksOf` does,
// following revenue or the `leaders`. It uses the fees each pool paid over the `hours` before each pick, and what its
// live programs stream over the next step. With `again` it picks again every step; otherwise it picks once, at the
// start of the oldest step.
export type Strategy = { count: number; hours: Hours; again: boolean; blueChips: boolean; leaders: boolean };
export const isBlueChip = ({ token0, token1 }: Gauge): boolean =>
  [token0, token1].every(({ address }) => config.BLUE_CHIPS.some((chip) => same(chip, address)));
// The pools a strategy considers: those that take allocations, from all pools or only blue chips.
export const eligible = (gauge: Gauge, { blueChips }: { blueChips: boolean }): boolean =>
  routable(gauge) && (!blueChips || isBlueChip(gauge));
// False for thin pools and for pools that pay a token with no price. Strategies and the suggestion leave these out.
export const weighable = (accrued: Accrued, paying: Paying): boolean =>
  !thinOver(accrued) && !!per10kOf(paying)?.priced;
// The pools `eligible` for a strategy, leaving out thin and unpriced ones. `payingOf` gives what each pays and the
// accrual it is based on. `own` gives the stake's whole sAERO in each pool, by gauge.
export function candidatesOf(
  market: Market,
  strategy: { blueChips: boolean },
  payingOf: (gauge: Gauge) => { accrued: Accrued; paying: Paying } | undefined,
  own?: Map<string, number>,
): Candidate[] {
  return market.gauges
    .filter((gauge) => eligible(gauge, strategy))
    .flatMap((gauge) => {
      const found = payingOf(gauge);
      return found && weighable(found.accrued, found.paying)
        ? [{ gauge, paying: found.paying, own: own?.get(key(gauge.address)) }]
        : [];
    });
}
// What a pick is made for: `amount` sAERO at `prices`. `own` is the stake's whole sAERO already in each pool, by gauge.
export type Picking = { prices?: Prices; amount?: number; own?: Map<string, number> };
// Picks pools at `time`, from what each paid over the `hours` before `time`, and what its programs live then would
// stream over the next step. Values are at `prices`, shared by the pool's sAERO at `time` (see `crowdOf`).
export function picksAt(
  market: Market,
  past: Past,
  time: number,
  strategy: Strategy,
  { prices = market.prices, amount = 0, own }: Picking = {},
): Pick[] {
  const since = time - strategy.hours * HOUR;
  const pools = candidatesOf(
    market,
    strategy,
    (gauge) => {
      const before = accrualOf(gauge, past, since, time, market);
      if (!before || before.to <= before.from || before.from > since + 0.1 * (time - since) || !(meanOf(before) > 0))
        return undefined;
      const live = (program: Program) => program.start <= time;
      const recent = strategy.hours === 48 ? before : accrualOf(gauge, past, time - 48 * HOUR, time, market);
      const paying = {
        fees: feeFlows(gauge, before, prices),
        incentives: streamFlows(gauge, time, time + STEP, prices, live),
        power: crowdOf(recent, before),
      };
      return { accrued: before, paying };
    },
    own,
  );
  return picksOf(pools, strategy, amount);
}
// The snapshot times a strategy needs that the grid doesn't already have.
export function timesFor(market: Market, { again, hours }: Strategy): number[] {
  const steps = stepsOf(market);
  const picks = again ? steps.map(({ from }) => from) : steps.slice(-1).map(({ from }) => from);
  return picks.map((time) => time - hours * HOUR).filter((time) => !market.past.times.includes(time));
}
const paidDuring = (market: Market, past: Past, step: Step, prices: Prices) => (gauge: Gauge) =>
  paidOver(gauge, accrualOf(gauge, past, step.from, step.to, market), prices);
// How a record is worked out: for `amount` sAERO added to the pools, less what the stake's `own` moves (if read)
// already had in them, at `then`'s prices.
export type Held = { amount?: number; then?: Then; own?: Move[] };
// The whole sAERO by gauge in `allocations`, leaving out the zero gauge.
export function byGauge(allocations: Allocation[]): Map<string, number> {
  const mine = new Map<string, number>();
  for (const { gauge, amount } of allocations)
    if (!isIdleGauge(gauge)) mine.set(key(gauge), (mine.get(key(gauge)) ?? 0) + whole(amount));
  return mine;
}
// The whole sAERO by gauge that `moves` held at `time`.
export const heldAt = (moves: Move[], time: number): Map<string, number> =>
  byGauge(moves.find(({ at }) => at <= time)?.allocations ?? []);
// The average whole sAERO by gauge that `moves` held over a span: what they already added to each pool's power.
export function heldIn(moves: Move[], { from, to }: Step): Map<string, number> {
  const mine = new Map<string, number>();
  const cuts = [from, ...moves.map(({ at }) => at).filter((at) => at > from && at < to), to].sort((a, b) => a - b);
  for (let i = 0; i + 1 < cuts.length; i++) {
    const share = (cuts[i + 1]! - cuts[i]!) / (to - from);
    for (const [gauge, amount] of heldAt(moves, cuts[i]!)) mine.set(gauge, (mine.get(gauge) ?? 0) + amount * share);
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
// Each pick uses the prices when it was made, the record's amount, and where the stake's own sAERO was then.
export function strategySteps(market: Market, past: Past, strategy: Strategy, held: Held = {}): Paid[] {
  const pick = (time: number) =>
    picksAt(market, past, time, strategy, {
      prices: pricedAt(market, held.then, time),
      amount: held.amount,
      own: held.own && heldAt(held.own, time),
    });
  const once = strategy.again ? undefined : pick(stepsOf(market).at(-1)!.from);
  return heldSteps(market, past, (step) => once ?? pick(step.from), held);
}
// Shares chosen now, held over every step. This uses hindsight.
export const customSteps = (market: Market, past: Past, holdings: Holding[], held: Held = {}): Paid[] =>
  heldSteps(market, past, () => holdings, held);
// The Base average: what all the pools paid in each step per 10,000 sAERO, over all their sAERO. Leaves out pools that
// pay a token with no price.
export const averageSteps = (market: Market, past: Past, then?: Then): Paid[] =>
  stepsOf(market).map((step) => {
    const prices = pricesOver(market, then, step);
    const { fees, incentives, total } = marketOver(market.gauges, paidDuring(market, past, step, prices));
    return { ...step, paid: total > 0 ? { fees, incentives, total, priced: true } : undefined, prices };
  });

// A stake's allocations, newest first, back to the first at or before `since`, and at most `most` of them. Each is read
// at the block just before the next one.
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
// Snapshots at the times the stake moved, so that steps can be split where its allocation changed.
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
// Splits each step where the stake moved, and holds each part as the allocation was then. sAERO on the zero gauge
// earns nothing. A step's figure is the average over only the parts that had an allocation and a figure.
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
// The APR, and what 10,000 sAERO earned a day, averaged over the steps whose APR is known. Each step uses its own
// prices and is weighted by its length. Both figures cover the same steps.
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

// Aero's Voter takes a stake's whole list for Base at once, replacing the last one. Each amount is in sAERO's
// 18-decimal units and must be above zero. Gauges must be in strictly ascending order, and the amounts must add up to
// exactly what the stake has on Base. What it has on no chain moves onto Base in the same call. Base is Aero's root
// chain, so the LeafVoter gets the list in the same transaction, with no gas limit and no fee. The LeafVoter reverts
// while the stake is locked.
export type Allotment = { gauge: Address; amount: bigint };
export const budgetOf = ({ onBase, idle }: Stake): bigint => onBase + idle;
// The weights don't need to add up to 1. The rounding remainder goes to the largest amount. Amounts that round to zero
// are left out.
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

// Digits with "." for decimals, spaces ignored. Empty text is 0; text in any other form is undefined.
export function amountOf(text: string): number | undefined {
  const cleaned = text.replace(/\s/g, "");
  if (!cleaned) return 0;
  const value = Number(cleaned);
  return /^(\d+\.?\d*|\.\d+)$/.test(cleaned) && Number.isFinite(value) ? value : undefined;
}
