// Data shared by the research scripts: the shapes of the files in data/, Base's block times, and how much a gauge's
// fee accumulator is worth.
import { readFileSync } from "node:fs";
import { BLOCK_SCHEDULE } from "../src/config.ts";
import { scheduled } from "../src/rpc.ts";

export const HOUR = 3_600;

export type Token = { address: string; decimals: number; symbol: string };
// One `GaugesAllocated` event: it replaces the stake's whole allocation on Base. Amounts are in 18-decimal units.
export type Allocation = {
  id: string;
  block: number;
  time: number;
  log: number;
  gauges: { gauge: string; amount: string }[];
};
// `head` is the last block searched, and `headTime` its time.
export type Allocations = { head: number; headTime: number; allocations: Allocation[] };
// A rewards manager's checkpoint: its fee accumulators, its time, its supply accumulator and its seconds with no power.
export type Snap = { acc0: string; acc1: string; ts: number; share: string; zero: number };
export type SavedGauge = {
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
};
export type Gauges = {
  hours: number[];
  gauges: SavedGauge[];
  prices: Record<string, number>;
  tokens: Record<string, Token>;
  pricedAt: number;
};
// Each stake as it was at `at`, the last hour every data file covers. A stake withdrawn by then has `withdrawn`, the
// first hour at which it was no longer staked. `end` is when its lock ends, unless it is permanent.
export type Stake = { amount: string; end: number; permanent: boolean; withdrawn?: number };
export type Stakes = { at: number; block: number; stakes: Record<string, Stake> };

export const dataUrl = (name: string): URL => new URL(`./data/${name}`, import.meta.url);
export const load = <T>(name: string): T => JSON.parse(readFileSync(dataUrl(name), "utf8")) as T;

// Base keeps a fixed schedule (see `BLOCK_SCHEDULE`), so a block's time follows from its number.
export function timeOfBlock(block: number): number {
  const from = BLOCK_SCHEDULE.findLast((each) => each.block <= block) ?? BLOCK_SCHEDULE[0]!;
  return from.time + Math.floor(((block - from.block) * from.ms) / 1000);
}
// The last block whose time is at most `time`: the chain's state as of that second.
export const blockAsOf = (time: number): number => scheduled(time + 1, BLOCK_SCHEDULE)! - 1;

// The last hour that every data file covers: the gauges' last hour, or the last whole hour searched for allocations,
// if that is earlier. Allocations after it are left out, so nothing reaches past the gauges' history.
export function dataEnd(gauges: Pick<Gauges, "hours">, allocations: Pick<Allocations, "headTime">): number {
  const lastHour = gauges.hours.at(-1)!;
  const searched = allocations.headTime - (allocations.headTime % HOUR);
  return Math.min(lastHour, searched);
}

// What one whole sAERO had earned in fees, in dollars, at a checkpoint. Rewards managers credit fees × 1e24 / power,
// with power in 18-decimal units: per whole sAERO, the growth / 1e6, in the token's smallest units. A token without a
// price counts as 0.
export function feeValue(
  snap: Snap | undefined,
  gauge: Pick<SavedGauge, "token0" | "token1">,
  prices: Record<string, number>,
): number {
  if (!snap) return 0;
  const worth = (acc: string, token: Token) =>
    (Number(BigInt(acc)) / 1e6 / 10 ** token.decimals) * (prices[token.address.toLowerCase()] ?? 0);
  return worth(snap.acc0, gauge.token0) + worth(snap.acc1, gauge.token1);
}

// What one whole sAERO had earned in fees, in dollars, at each of `hours`. A rewards manager only records fees at its
// checkpoints, which can be hours apart, so the fees credited at a checkpoint are spread evenly over the time since the
// one before. Hours after the last checkpoint read take the fees recorded by then.
export function feeSeries(
  gauge: Pick<SavedGauge, "token0" | "token1" | "index" | "snaps">,
  hours: number[],
  prices: Record<string, number>,
): Float64Array {
  const out = new Float64Array(hours.length);
  let later: Snap | undefined;
  for (let k = hours.length - 1; k >= 0; k--) {
    const index = gauge.index[k]!;
    if (k + 1 < hours.length && gauge.index[k + 1] !== index) later = gauge.snaps[gauge.index[k + 1]!];
    const snap = index === "0" ? undefined : gauge.snaps[index];
    const here = feeValue(snap, gauge, prices);
    if (!snap || !later || later.ts <= snap.ts) {
      out[k] = here;
      continue;
    }
    const along = Math.min(1, Math.max(0, (hours[k]! - snap.ts) / (later.ts - snap.ts)));
    out[k] = here + (feeValue(later, gauge, prices) - here) * along;
  }
  return out;
}
