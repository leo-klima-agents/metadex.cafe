// Reads, for every Aero gauge on Base, the state of its rewards manager at each hour since launch, its incentive
// programs, and today's price of every token they pay. Saves data/gauges.json. Everything is read at the latest block:
// the managers keep their history as checkpoints, indexed by time.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { nameOf, readUniverse } from "../src/aero.ts";
import { rewardsManagerAbi } from "../src/abi.ts";
import { AERO } from "../src/config.ts";
import { key, pricesNow, type Token } from "../src/prices.ts";
import { contract, read, readEach } from "../src/rpc.ts";
import { describe } from "../src/tokens.ts";
import { dataUrl, HOUR, type Gauges, type SavedGauge } from "./common.ts";

const START = Date.UTC(2026, 9, 22) / 1000; // Aero's first checkpoints are on 22 October 2026, just after midnight.
const OUT = dataUrl("gauges.json");
const manager = (address: string) => contract(address as `0x${string}`, rewardsManagerAbi);

const saved: Gauges | undefined = existsSync(OUT) ? JSON.parse(readFileSync(OUT, "utf8")) : undefined;
const universe = await readUniverse();
// A gauge left out here would look like an address that is not a gauge, and its stakes' weights would be wrong.
if (universe.unread.length) throw new Error(`${universe.unread.length} gauges could not be read. Run this again.`);
if (universe.unknown.length) throw new Error(`Gauge factories the site doesn't know: ${universe.unknown.join(", ")}.`);
const now = Math.floor(Date.now() / 1000);
const hours: number[] = [];
for (let t = START; t <= now - 600; t += HOUR) hours.push(t);

// Hours already read are kept, except the last day's, which later checkpoints can still change. A gauge with no saved
// history is read from the first hour.
const keep = saved && saved.hours[0] === START ? Math.max(0, saved.hours.length - 24) : 0;
const gauges: SavedGauge[] = universe.gauges.map((g) => {
  const old = keep ? saved?.gauges.find(({ address }) => address === g.address.toLowerCase()) : undefined;
  const kept = old && old.index.length >= keep ? keep : 0;
  return {
    address: g.address.toLowerCase(),
    rewards: g.rewards.toLowerCase(),
    name: nameOf(g),
    kind: g.kind,
    token0: g.token0,
    token1: g.token1,
    index: old?.index.slice(0, kept) ?? [],
    supply: old?.supply.slice(0, kept) ?? [],
    snaps: old?.snaps ?? {},
    programs: [],
  };
});

const DAY_HOURS = 24;
for (let from = Math.min(...gauges.map((g) => g.index.length)); from < hours.length; from += DAY_HOURS) {
  const pairs = gauges.flatMap((g) =>
    hours.slice(from, from + DAY_HOURS).flatMap((time, i) => (from + i >= g.index.length ? [{ g, time }] : [])),
  );
  const found = await readEach(pairs, {
    index: ({ g, time }) => manager(g.rewards)("getPriorSupplyIndex", BigInt(time)),
    supply: ({ g, time }) => manager(g.rewards)("supplyAt", BigInt(time)),
  });
  for (const { item, index, supply } of found) {
    if (index === undefined || supply === undefined) throw new Error(`Unread ${item.g.name} at ${item.time}`);
    item.g.index.push(index.toString());
    item.g.supply.push(supply.toString());
  }
  const wanted = [
    ...new Map(
      gauges.flatMap((g) =>
        g.index
          .slice(from)
          .filter((index) => index !== "0" && !g.snaps[index])
          .map((index) => [`${g.rewards}:${index}`, { g, index }] as const),
      ),
    ).values(),
  ];
  const snaps = await readEach(wanted, {
    acc: ({ g, index }) => manager(g.rewards)("feeRewardPerVotingPowerAt", BigInt(index)),
    point: ({ g, index }) => manager(g.rewards)("globalRewardPointHistory", BigInt(index)),
    share: ({ g, index }) => manager(g.rewards)("supplyAccumulatorAt", BigInt(index)),
  });
  for (const { item, acc, point, share } of snaps) {
    if (!acc || !point || !share) throw new Error(`Unread snapshot ${item.g.name} #${item.index}`);
    item.g.snaps[item.index] = {
      acc0: acc[0].toString(),
      acc1: acc[1].toString(),
      ts: Number(point.ts),
      share: share[0].toString(),
      zero: Number(point.zeroSupplySeconds),
    };
  }
  process.stderr.write(`\r${new Date(hours[Math.min(from + DAY_HOURS, hours.length) - 1]! * 1000).toISOString()}   `);
}
for (const g of gauges)
  if (g.index.length !== hours.length || g.supply.length !== hours.length)
    throw new Error(`${g.name} has ${g.index.length} hours of history, not ${hours.length}.`);

// Every incentive program, not only the newest.
const counts = await readEach(gauges, { count: (g) => manager(g.rewards)("incentiveCount") });
const ids = counts.flatMap(({ item, count }) => {
  if (count === undefined) throw new Error(`Unread program count of ${item.name}`);
  return Array.from({ length: Number(count) }, (_, i) => ({ g: item, id: BigInt(i + 1) }));
});
const programs = await readEach(ids, { program: ({ g, id }) => manager(g.rewards)("incentive", id) });
for (const { item, program } of programs) {
  if (!program) throw new Error(`Unread program ${item.id} of ${item.g.name}`);
  item.g.programs.push({
    id: item.id.toString(),
    token: program.token.toLowerCase(),
    rate: program.rate.toString(),
    start: Number(program.start),
    end: Number(program.end),
  });
}

// The most each token paid in one day, over all gauges: fees and programs. Pricing then only trusts a pool deep enough for that amount, as the site does with `dayOf`.
const paid = new Map<string, bigint>();
const tokenList = new Map<string, Token>();
for (const g of universe.gauges) for (const t of [g.token0, g.token1]) tokenList.set(key(t.address), t);
for (let from = 0; from + DAY_HOURS < hours.length; from += DAY_HOURS) {
  const to = from + DAY_HOURS;
  const day = new Map<string, bigint>();
  const add = (token: string, amount: bigint) => {
    if (amount > 0n) day.set(key(token), (day.get(key(token)) ?? 0n) + amount);
  };
  for (const g of gauges) {
    // Hour by hour, the fees credited times the power then: a day's growth times one day's power would overstate a
    // pool whose power rose from almost nothing that day.
    for (let k = from; k < to; k++) {
      const [a, b] = [g.snaps[g.index[k]!], g.snaps[g.index[k + 1]!]];
      const power = BigInt(g.supply[k]!);
      const grown = (end: string | undefined, start: string | undefined) =>
        end === undefined ? 0n : BigInt(end) - BigInt(start ?? "0");
      add(g.token0.address, (grown(b?.acc0, a?.acc0) * power) / 10n ** 24n);
      add(g.token1.address, (grown(b?.acc1, a?.acc1) * power) / 10n ** 24n);
    }
    for (const p of g.programs) {
      const overlap = Math.min(hours[to]!, p.end) - Math.max(hours[from]!, p.start);
      if (overlap > 0) add(p.token, (BigInt(p.rate) * BigInt(overlap)) / 10n ** 18n);
    }
  }
  for (const [token, amount] of day) if (amount > (paid.get(token) ?? 0n)) paid.set(token, amount);
}
for (const t of (
  await describe(
    gauges.flatMap((g) => g.programs.map(({ token }) => token as `0x${string}`)),
    read,
  )
).values())
  tokenList.set(key(t.address), t);
for (const t of (await describe([AERO], read)).values()) tokenList.set(key(t.address), t);
const prices = await pricesNow([...tokenList.values()], paid);
if (prices.unread) throw new Error("Some pools could not be read for prices. Run this again.");
if (!prices.of.has(key(AERO))) throw new Error("AERO has no price.");
const out: Gauges = {
  hours,
  gauges,
  prices: Object.fromEntries([...prices.of].map(([k, v]) => [k.toLowerCase(), v])),
  tokens: Object.fromEntries([...tokenList].map(([k, t]) => [k.toLowerCase(), t])),
  pricedAt: now,
};
mkdirSync(new URL(".", OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(out));
const unpriced = [...tokenList.values()].filter((t) => !prices.of.has(key(t.address)));
console.error(
  `\nSaved ${gauges.length} gauges over ${hours.length} hours, ${ids.length} programs, ${prices.of.size} prices` +
    ` (${unpriced.length} tokens without a price: ${unpriced.map((t) => t.symbol).join(", ")}).`,
);
