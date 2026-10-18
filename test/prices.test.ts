import assert from "node:assert/strict";
import { test } from "node:test";
import { zeroAddress } from "viem";
import type { Call } from "../src/chain.ts";
import { SPAN, WINDOW, narrow, observedPrice, pairPrice, points, tickPrice, type Search } from "../src/prices.ts";

const close = (actual: number, expected: number, relative = 1e-9) =>
  assert.ok(Math.abs(actual - expected) <= Math.abs(expected) * relative, `${actual} is not ${expected}`);

test("a concentrated pool's tick, in whole tokens of each", () => {
  close(tickPrice(0, 18, 18), 1);
  close(tickPrice(0, 18, 6), 1e12);
  close(tickPrice(10_000, 6, 6), 1.0001 ** 10_000);
  // USDC (6 decimals) is token0 of USDC / cbBTC (8): about 0.0000123 cbBTC a dollar, with bitcoin at $81,500.
  close(1 / tickPrice(-67_040, 6, 8), 81_460, 1e-3);
});

test("a classic pair's price: the ratio of its reserves, or the slope of x³y + xy³ for a stable one", () => {
  close(pairPrice(100, 250, false), 2.5);
  close(pairPrice(100, 100, true), 1);
  // A stable pair keeps its price near 1 even when its reserves are uneven; a volatile pair would not.
  const stable = pairPrice(110, 90, true);
  assert.ok(stable < 1 && stable > 0.99, String(stable));
  assert.ok(pairPrice(90, 110, true) > 1);
});

test("a classic pair's average between two observations, unless they are too far apart or it held nothing", () => {
  const flip = 1_792_022_400n;
  // 2,000 of token0 (18 decimals) and 50 of token1 (6 decimals), held for the 50 minutes between the two.
  const [reserve0, reserve1] = [2_000n * 10n ** 18n, 50n * 10n ** 6n];
  const at = (time: bigint, elapsed: bigint) => [time, reserve0 * elapsed, reserve1 * elapsed] as const;
  const first = at(flip - BigInt(WINDOW) - 600n, 0n);
  close(observedPrice(first, at(flip + 600n, 3_000n), 18, 6, false)!, 0.025);
  assert.equal(observedPrice(first, at(first[0] + BigInt(SPAN) + 1n, BigInt(SPAN) + 1n), 18, 6, false), undefined);
  assert.equal(observedPrice(first, [flip + 600n, 0n, 0n], 18, 6, false), undefined, "it held nothing");
  assert.equal(observedPrice(first, first, 18, 6, false), undefined);
});

test("a search probes every point of a short range, and spreads its points over a long one", () => {
  assert.deepEqual(points(3, 8), [3, 4, 5, 6, 7]);
  const spread = points(0, 11_769);
  assert.equal(spread.length, 16);
  assert.equal(spread[0], 0);
  assert.ok(spread.every((point, i) => i === 0 || point > spread[i - 1]!));
  assert.ok(spread.at(-1)! < 11_769);
});

// A list of timestamps, and a reader that counts the batches it reads.
function history(times: number[], failAt?: number) {
  let batches = 0;
  const probe = (index: number): Call => ({ address: zeroAddress, abi: [], functionName: "at", args: [index] });
  const reader = async (calls: Call[]) => {
    batches++;
    return calls.map(({ args: [index] }) => (index === failAt ? undefined : times[index as number]));
  };
  const search = (at: number, lo = 0): Search => ({
    lo,
    hi: times.length,
    probe,
    passes: (time) => (time as number) >= at,
    seen: new Map(),
  });
  return { reader, search, batches: () => batches };
}

test("searches narrow together, a batch a round, and keep the reads either side of what they find", async () => {
  // About half an hour apart, unevenly, as a classic pair records them.
  const times = Array.from({ length: 5_000 }, (_, i) => 1_000_000 + i * 1_800 + (i % 7) * 60);
  const { reader, search, batches } = history(times);
  const target = times[3_210]! - 30;
  const searches = [search(target), search(times[4_999]! + 1), search(0)];
  await narrow(searches, reader);
  const [found, none, first] = searches as [Search, Search, Search];
  assert.equal(found.hi, 3_210);
  assert.equal(found.seen.get(3_210), times[3_210]);
  assert.equal(found.seen.get(3_209), times[3_209]);
  assert.equal(none.hi, 5_000, "none passes: the end");
  assert.equal(first.hi, 0);
  assert.ok(batches() <= 4, `${batches()} rounds`);
});

test("a search that starts from a bound finds the same, and a read that fails ends it", async () => {
  const times = Array.from({ length: 100 }, (_, i) => i * 10);
  const { reader, search } = history(times, 50);
  const bounded = search(705, 60);
  await narrow([bounded], reader);
  assert.equal(bounded.hi, 71);
  assert.ok(bounded.seen.has(70));
  const broken = search(500);
  await narrow([broken], reader);
  assert.equal(broken.failed, true);
});
