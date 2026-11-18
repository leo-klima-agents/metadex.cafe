// Reads, for every Aero gauge on Base, the state of its rewards manager at each hour since launch, its incentive
// programs, and today's price of every token they pay. Saves data/gauges.json. Everything is read at the latest block:
// the managers keep their history as checkpoints, indexed by time.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { readUniverse } from "../src/aero.ts";
import { rewardsManagerAbi } from "../src/abi.ts";
import { AERO } from "../src/config.ts";
import { key, pricesNow, type Token } from "../src/prices.ts";
import { contract, read, readEach } from "../src/rpc.ts";
import { describe } from "../src/tokens.ts";

const HOUR = 3_600;
const START = Date.UTC(2026, 9, 22) / 1000; // Aero's first checkpoints are on 22 October 2026, just after midnight.
const OUT = new URL("./data/gauges.json", import.meta.url);
const manager = (address: `0x${string}`) => contract(address, rewardsManagerAbi);

type Snap = { acc0: string; acc1: string; ts: number; share: string; zero: number };
type Saved = {
  hours: number[];
  gauges: {
    address: string;
    rewards: string;
    name: string;
    kind: string;
    token0: Token;
    token1: Token;
    // At each hour: the index of the checkpoint at or before it, and the power then, in 18-decimal units.
    index: string[];
    supply: string[];
    snaps: Record<string, Snap>;
    programs: { id: string; token: string; rate: string; start: number; end: number }[];
  }[];
  prices: Record<string, number>;
  tokens: Record<string, Token>;
  pricedAt: number;
};

const saved: Saved | undefined = existsSync(OUT) ? JSON.parse(readFileSync(OUT, "utf8")) : undefined;
const universe = await readUniverse();
const now = Math.floor(Date.now() / 1000);
const hours: number[] = [];
for (let t = START; t <= now - 600; t += HOUR) hours.push(t);

const gauges: Saved["gauges"] = universe.gauges.map((g) => {
  const old = saved?.gauges.find(({ address }) => address === g.address.toLowerCase());
  return {
    address: g.address.toLowerCase(),
    rewards: g.rewards.toLowerCase(),
    name: `${g.kind === "cl" ? `CL${g.tickSpacing}` : g.kind === "stable" ? "sAMM" : "vAMM"}-${g.token0.symbol}/${g.token1.symbol}`,
    kind: g.kind,
    token0: g.token0,
    token1: g.token1,
    index: old?.index ?? [],
    supply: old?.supply ?? [],
    snaps: old?.snaps ?? {},
    programs: [],
  };
});

// Hours already read are kept, except the last day's, which later checkpoints can still change.
const keep = saved ? Math.max(0, saved.hours.length - 24) : 0;
for (const g of gauges) [g.index, g.supply] = [g.index.slice(0, keep), g.supply.slice(0, keep)];
const DAY_HOURS = 24;
for (let from = keep; from < hours.length; from += DAY_HOURS) {
  const times = hours.slice(from, from + DAY_HOURS);
  const pairs = gauges.flatMap((g) => times.map((time) => ({ g, time })));
  const found = await readEach(pairs, {
    index: ({ g, time }) => manager(g.rewards as `0x${string}`)("getPriorSupplyIndex", BigInt(time)),
    supply: ({ g, time }) => manager(g.rewards as `0x${string}`)("supplyAt", BigInt(time)),
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
    acc: ({ g, index }) => manager(g.rewards as `0x${string}`)("feeRewardPerVotingPowerAt", BigInt(index)),
    point: ({ g, index }) => manager(g.rewards as `0x${string}`)("globalRewardPointHistory", BigInt(index)),
    share: ({ g, index }) => manager(g.rewards as `0x${string}`)("supplyAccumulatorAt", BigInt(index)),
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
  process.stderr.write(`\r${new Date(times.at(-1)! * 1000).toISOString()} (${wanted.length} snapshots)   `);
}

// Every incentive program, not only the newest.
const counts = await readEach(gauges, { count: (g) => manager(g.rewards as `0x${string}`)("incentiveCount") });
const ids = counts.flatMap(({ item, count }) =>
  Array.from({ length: Number(count ?? 0n) }, (_, i) => ({ g: item, id: BigInt(i + 1) })),
);
const programs = await readEach(ids, { program: ({ g, id }) => manager(g.rewards as `0x${string}`)("incentive", id) });
for (const { item, program } of programs)
  if (program)
    item.g.programs.push({
      id: item.id.toString(),
      token: program.token.toLowerCase(),
      rate: program.rate.toString(),
      start: Number(program.start),
      end: Number(program.end),
    });

// Today's prices, for every token paid. One price per token for the whole period, so that price moves cancel out
// of every comparison made at the same time.
const tokenList = new Map<string, Token>();
for (const g of gauges) for (const t of [g.token0, g.token1]) tokenList.set(key(t.address), t);
const described = await describe(
  gauges.flatMap((g) => g.programs.map(({ token }) => token as `0x${string}`)),
  read,
);
for (const t of described.values()) tokenList.set(key(t.address), t);
const aero = await describe([AERO], read);
for (const t of aero.values()) tokenList.set(key(t.address), t);
const prices = await pricesNow([...tokenList.values()]);
const out: Saved = {
  hours,
  gauges,
  prices: Object.fromEntries([...prices.of].map(([k, v]) => [k.toLowerCase(), v])),
  tokens: Object.fromEntries([...tokenList].map(([k, t]) => [k.toLowerCase(), t])),
  pricedAt: now,
};
writeFileSync(OUT, JSON.stringify(out));
const unpriced = [...tokenList.values()].filter((t) => !prices.of.has(key(t.address)));
console.error(
  `\nSaved ${gauges.length} gauges over ${hours.length} hours, ${ids.length} programs, ${prices.of.size} prices` +
    ` (${unpriced.length} tokens without a price: ${unpriced.map((t) => t.symbol).join(", ")}).`,
);
