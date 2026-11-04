import { erc20Abi, zeroAddress, type Address } from "viem";
import { aeroEscrowAbi, aeroPoolAbi, aeroVoterAbi, leafVoterAbi, registryAbi, rewardsManagerAbi } from "./abi.ts";
import * as config from "./config.ts";
import { CHAIN_ID, GAUGE_FACTORIES, PAYMENTS_MODULE, type GaugeKind } from "./config.ts";
import { key, pairPrice, pricesNow, tickPrice, worthOf, type Prices, type Token } from "./prices.ts";
import { blockTime, contract, read, readEach, required, same, sawBlock, type Read } from "./rpc.ts";
import { describe } from "./tokens.ts";

// A gauge's rewards manager adds up the fees it pays per unit of power and snapshots the sum at each checkpoint, so
// what sAERO earned over a window is the growth between two snapshots. Prices are today's.

const escrow = contract(config.AERO_ESCROW, aeroEscrowAbi);
const root = contract(config.AERO_VOTER, aeroVoterAbi);
const leaf = contract(config.LEAF_VOTER, leafVoterAbi);
const registry = contract(config.FACTORY_REGISTRY, registryAbi);
const manager = (address: Address) => contract(address, rewardsManagerAbi);

const HOUR = 3_600;
export const DAY = 86_400;
export const WINDOWS = [24, 48, 168] as const;
export type Hours = (typeof WINDOWS)[number];
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
// In dollars, the least a pool must hold of each side to price a token.
const POOL_FLOOR = 1_000;

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
  index: bigint;
  time?: number | undefined;
  acc: readonly bigint[] | undefined;
  ts: number | undefined;
  share: bigint | undefined;
  zero: number | undefined;
  supply: bigint | undefined;
};
// Fee accumulator growth from a checkpoint to a later time. `spread` is the harmonic mean of the power between, in
// sAERO, if read.
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
// `unread`: gauges left out after a failed read. `unknown`: gauge factories the page does not know.
export type Market = {
  time: number;
  cooldown: number;
  maxGauges: number;
  gauges: Gauge[];
  prices: Prices;
  unread: Address[];
  unknown: Address[];
};
export const routable = (gauge: Gauge): boolean => gauge.activated && gauge.cap > 0n;
const whole = (power: bigint): number => Number(power) / 1e18;

const KINDS: Record<GaugeKind, (spacing: number) => string> = {
  volatile: () => "Basic",
  stable: () => "Basic stable",
  cl: (spacing) => `CL${spacing}`,
};

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
// Carried on from the latest checkpoint at the power since.
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

type Found = { address: Address; index: bigint; supply: bigint | undefined; time?: number };
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
    index: index ?? 0n,
    supply,
    time: Number(time),
  }));
}
async function snapshotsOf(found: Found[], rd: Read): Promise<Start[]> {
  const read = await readEach(
    found,
    {
      acc: ({ address, index }) => manager(address)("feeRewardPerVotingPowerAt", index),
      point: ({ address, index }) => manager(address)("globalRewardPointHistory", index),
      share: ({ address, index }) => manager(address)("supplyAccumulatorAt", index),
    },
    rd,
  );
  return read.map(({ item: { index, supply, time }, acc, point, share }) => ({
    index,
    time,
    acc,
    ts: point && Number(point.ts),
    share: share?.[0],
    zero: point && Number(point.zeroSupplySeconds),
    supply,
  }));
}
const startsAt = async (rewards: Address[], times: bigint[], rd: Read): Promise<Start[]> =>
  snapshotsOf(await indicesAt(rewards, times, rd), rd);

export type Quote = { token0: Token; token1: Token; price0: number; reserve0: number; reserve1: number };
// Prices tokens outward from those already priced, each through its deepest pool holding `POOL_FLOOR` of each side.
// `price0` is token0's price in token1; reserves are in whole tokens.
export function pricedByPools(prices: Prices, quotes: Quote[]): Prices {
  const of = new Map(prices.of);
  for (;;) {
    const best = new Map<string, { price: number; depth: number }>();
    for (const { token0, token1, price0, reserve0, reserve1 } of quotes)
      for (const [token, other, price, reserve, otherReserve] of [
        [token0, token1, price0, reserve0, reserve1],
        [token1, token0, 1 / price0, reserve1, reserve0],
      ] as const) {
        const known = of.get(key(other.address));
        if (of.has(key(token.address)) || known === undefined) continue;
        const value = price * known;
        const depth = Math.min(reserve * value, otherReserve * known);
        if (!Number.isFinite(value) || value <= 0 || !(depth >= POOL_FLOOR)) continue;
        const was = best.get(key(token.address));
        if (!was || depth > was.depth) best.set(key(token.address), { price: value, depth });
      }
    if (!best.size) return { ...prices, of };
    for (const [token, { price }] of best) of.set(token, price);
  }
}

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

// A gauge whose reads fail is left out and listed in `unread`.
export async function readMarket(from: Universe | Promise<Universe>, rd: Read = read): Promise<Market> {
  const [[time, cooldown, maxGauges], anchors, universe] = await Promise.all([
    rd([blockTime, leaf("allocationCooldown"), leaf("maxGauges")]).then(required),
    pricesNow([], new Map(), rd),
    from,
  ]);
  const now = Number(time);
  sawBlock(now);
  const listed = universe.gauges;
  const times = WINDOWS.map((hours) => BigInt(now - hours * HOUR));
  const [states, found, cls, basics] = await Promise.all([
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
    indicesAt(
      listed.map(({ rewards }) => rewards),
      times,
      rd,
    ),
    readEach(
      listed.filter(({ kind }) => kind === "cl"),
      { slot0: ({ pool }) => contract(pool, aeroPoolAbi)("slot0") },
      rd,
    ),
    readEach(
      listed.filter(({ kind }) => kind !== "cl"),
      { reserves: ({ pool }) => contract(pool, aeroPoolAbi)("getReserves") },
      rd,
    ),
  ]);
  // The windows' checkpoints, then each gauge's latest.
  const starts = await snapshotsOf(
    [
      ...found,
      ...states.map(({ item: { rewards: address }, latest, power }) => ({
        address,
        index: latest ?? 0n,
        supply: power,
      })),
    ],
    rd,
  );
  const latests = starts.slice(found.length);
  const read0 = states.flatMap(({ item, cap, activated, power, accumulator, count, first, latest }, i) =>
    cap !== undefined && activated !== undefined && power !== undefined && accumulator && latest !== undefined
      ? [
          {
            ...item,
            cap,
            activated,
            power,
            accumulator: [accumulator[0], accumulator[1]] as const,
            count: count ?? 0n,
            first: first ? Number(first.ts) : 0,
            starts: starts.slice(i * times.length, (i + 1) * times.length),
            latest: latests[i]!,
          },
        ]
      : [],
  );
  const slot0s = new Map(cls.map(({ item, slot0 }) => [item.address, slot0]));
  const reserves = new Map(basics.map(({ item, reserves }) => [item.address, reserves]));
  const ids = read0.flatMap(({ rewards, count }) =>
    Array.from({ length: Math.min(Number(count), PROGRAMS) }, (_, i) => ({ rewards, id: count - BigInt(i) })),
  );
  const [programs, balances] = await Promise.all([
    readEach(ids, { program: ({ rewards, id }) => manager(rewards)("incentive", id) }, rd),
    readEach(
      read0
        .filter(({ kind }) => kind === "cl")
        .flatMap(({ pool, token0, token1 }) => [
          { pool, token: token0 },
          { pool, token: token1 },
        ]),
      { balance: ({ pool, token }) => contract(token.address, erc20Abi)("balanceOf", pool) },
      rd,
    ),
  ]);
  const tokens = await describe(
    programs.flatMap(({ program }) => (program ? [program.token] : [])),
    rd,
  );
  const held = new Map(
    balances.map(({ item: { pool, token }, balance }) => [`${key(pool)} ${key(token.address)}`, balance]),
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

  const quotes: Quote[] = [];
  const gauges = read0.map((each): Gauge => {
    const { token0, token1 } = each;
    const sides = (a: bigint | undefined, b: bigint | undefined) =>
      a === undefined || b === undefined
        ? undefined
        : ([Number(a) / 10 ** token0.decimals, Number(b) / 10 ** token1.decimals] as const);
    const slot0 = slot0s.get(each.address);
    if (each.kind === "cl" && slot0) {
      const reserve = sides(
        held.get(`${key(each.pool)} ${key(token0.address)}`),
        held.get(`${key(each.pool)} ${key(token1.address)}`),
      );
      if (reserve)
        quotes.push({
          token0,
          token1,
          price0: tickPrice(slot0[1], token0.decimals, token1.decimals),
          reserve0: reserve[0],
          reserve1: reserve[1],
        });
    } else {
      const found = reserves.get(each.address);
      const reserve = found && sides(found[0], found[1]);
      if (reserve && reserve[0] > 0 && reserve[1] > 0)
        quotes.push({
          token0,
          token1,
          price0: pairPrice(reserve[0], reserve[1], each.kind === "stable"),
          reserve0: reserve[0],
          reserve1: reserve[1],
        });
    }
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
      name: `${token0.symbol} / ${token1.symbol} ${KINDS[each.kind](each.tickSpacing)}`,
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
  const kept = new Set(gauges.map(({ address }) => address));
  return {
    time: now,
    cooldown: Number(cooldown),
    maxGauges: Number(maxGauges),
    gauges,
    prices: pricedByPools(anchors, quotes),
    unread: [...universe.unread, ...listed.flatMap(({ address }) => (kept.has(address) ? [] : [address]))],
    unknown: universe.unknown,
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

// Newest first. A row covers several days when no checkpoint fell in some. The first starts at the gauge's first
// checkpoint.
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

// With `amount` more sAERO sharing the fees and incentives.
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

// Weighed by mean power, over the gauges whose tokens all have prices.
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

// Streams to a gauge with no power go back to their creator.
export function totalsOf(market: Market) {
  let [power, fees, incentives] = [0n, { value: 0, priced: true }, { value: 0, priced: true }];
  for (const gauge of market.gauges) {
    power += gauge.power;
    const day = feesPerDay(gauge, gauge.windows[24], market.prices);
    if (day)
      fees = { value: fees.value + (day.value * meanOf(gauge.windows[24])) / PER, priced: fees.priced && day.priced };
    if (!gauge.power) continue;
    const stream = streamPerDay(gauge, market.time, market.prices);
    incentives = { value: incentives.value + stream.value, priced: incentives.priced && stream.priced };
  }
  return { power, fees, incentives };
}

// `idle` is on no chain. `approved` is approved for this stake alone, and `module` says whether its owner approved
// Aero's payments module for all their stakes.
export type Allocation = { gauge: Address; amount: bigint };
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
// 0 if it can move now.
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
  const found = new Map(stakes.map(({ id }): [bigint, Pending] => [id, { amounts: new Map(), partial: false }]));
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
// Undefined when none of its gauges has enough history.
export function paidBy(shares: Share[], market: Market, hours: Hours): Yield | undefined {
  let [value, priced, any] = [0, true, false];
  for (const { gauge, share } of shares) {
    const found = gauge && per10k(gauge, hours, market.time, market.prices);
    if (!found) continue;
    [value, priced, any] = [value + share * found.total, priced && found.priced, true];
  }
  return any ? { value, priced } : undefined;
}

// Digits with "." for decimals, spaces ignored.
export function amountOf(text: string): number | undefined {
  const cleaned = text.replace(/\s/g, "");
  if (!cleaned) return 0;
  const value = Number(cleaned);
  return /^(\d+\.?\d*|\.\d+)$/.test(cleaned) && Number.isFinite(value) ? value : undefined;
}
