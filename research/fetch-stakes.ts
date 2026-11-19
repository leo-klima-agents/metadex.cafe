// Reads every stake that allocated as it was at the data's last hour (see `dataEnd`), into data/stakes.json. For each
// stake withdrawn by then, it also finds the first hour at which it was no longer staked: a withdrawn stake loses its
// allocation with no GaugesAllocated event. The search reads past blocks, at hours 64, then 8, then 1 apart.
import { writeFileSync } from "node:fs";
import { aeroEscrowAbi } from "../src/abi.ts";
import { AERO_ESCROW } from "../src/config.ts";
import { contract, readEach } from "../src/rpc.ts";
import {
  blockAsOf,
  dataEnd,
  dataUrl,
  HOUR,
  load,
  type Allocations,
  type Gauges,
  type Stake,
  type Stakes,
} from "./common.ts";

const allocations = load<Allocations>("allocations.json");
const at = dataEnd(load<Gauges>("gauges.json"), allocations);
const block = blockAsOf(at);
const escrow = contract(AERO_ESCROW, aeroEscrowAbi);
type Staked = { amount: bigint; end: number; isPermanent: boolean };

// The stakes' state at each of `times`, by time and then by id. A failed read throws: a stake that looks withdrawn
// because a read failed would lose its last spell.
async function stakedAt(asked: { id: string; time: number }[]): Promise<Map<number, Map<string, Staked>>> {
  const byTime = Map.groupBy(asked, ({ time }) => time);
  const out = new Map<number, Map<string, Staked>>();
  await Promise.all(
    [...byTime].map(async ([time, items]) => {
      const found = await readEach(items, { staked: ({ id }) => escrow("staked", BigInt(id)) }, undefined, {
        block: blockAsOf(time),
      });
      const states = new Map<string, Staked>();
      for (const { item, staked } of found) {
        if (!staked) throw new Error(`Could not read stake ${item.id} at ${time}. Run this again.`);
        states.set(item.id, { amount: staked.amount, end: Number(staked.end), isPermanent: staked.isPermanent });
      }
      out.set(time, states);
    }),
  );
  return out;
}

const lastAllocated = new Map<string, number>();
for (const { id, time } of allocations.allocations) if (time <= at) lastAllocated.set(id, time);
const ids = [...lastAllocated.keys()];
const atEnd = (await stakedAt(ids.map((id) => ({ id, time: at })))).get(at)!;
const stakes: Record<string, Stake> = {};
for (const id of ids) {
  const { amount, end, isPermanent } = atEnd.get(id)!;
  stakes[id] = { amount: amount.toString(), end, permanent: isPermanent };
}

// Withdrawn by `at`: it was staked when it last allocated (`lo`) and not at `hi`. Each pass reads it at the whole hours
// `spacing` apart between the two, and narrows them to the last hour it was staked and the first it wasn't. Its lock
// and amount come from the last hour it was still staked.
const gone = ids.filter((id) => atEnd.get(id)!.amount === 0n);
const range = new Map(
  gone.map((id) => [id, { lo: lastAllocated.get(id)!, hi: at, last: undefined as Staked | undefined }]),
);
for (const spacing of [64 * HOUR, 8 * HOUR, HOUR]) {
  const asked = gone.flatMap((id) => {
    const { lo, hi } = range.get(id)!;
    const probes: { id: string; time: number }[] = [];
    for (let time = lo - (lo % spacing) + spacing; time < hi; time += spacing) probes.push({ id, time });
    return probes;
  });
  const read = await stakedAt(asked);
  for (const id of gone) {
    const r = range.get(id)!;
    for (const time of [...read.keys()].sort((a, b) => a - b)) {
      const state = read.get(time)!.get(id);
      if (!state || time <= r.lo || time >= r.hi) continue;
      if (state.amount > 0n) [r.lo, r.last] = [time, state];
      else {
        r.hi = time;
        break;
      }
    }
  }
  process.stderr.write(`\rFound withdrawals to within ${spacing / HOUR} hours (${asked.length} reads).   `);
}
// Stakes never seen staked by a probe: their lock, from the block they last allocated at.
const unseen = gone.filter((id) => !range.get(id)!.last);
const seen = await stakedAt(unseen.map((id) => ({ id, time: lastAllocated.get(id)! })));
for (const id of gone) {
  const r = range.get(id)!;
  const last = r.last ?? seen.get(lastAllocated.get(id)!)!.get(id)!;
  stakes[id] = { amount: "0", end: last.end, permanent: last.isPermanent, withdrawn: r.hi };
}

const out: Stakes = { at, block, stakes };
writeFileSync(dataUrl("stakes.json"), JSON.stringify(out));
const expired = Object.values(stakes).filter(({ permanent, end, withdrawn }) => !permanent && end <= (withdrawn ?? at));
console.error(
  `\nSaved ${ids.length} stakes as of ${new Date(at * 1000).toISOString()}: ${gone.length} withdrawn by then,` +
    ` ${expired.length} whose lock ended first.`,
);
