import assert from "node:assert/strict";
import { test } from "node:test";
import { zeroAddress } from "viem";
import { allocate, along, curveOf, worth, type Candidate, type Curve, type Model } from "../src/routing.ts";

// `pays(r)` is what a fee-free constant-product pool with reserves r and r pays for x; `curve` reads it at amounts
// halving from `range`.
const pays = (r: number) => (x: number) => (r * x) / (r + x);
const curve = (paid: (x: number) => number, range: number): Curve =>
  curveOf(
    Array.from({ length: 6 }, (_, k) => {
      const x = range / 2 ** k;
      return [BigInt(Math.round(x)), BigInt(Math.round(paid(x)))] as [bigint, bigint];
    }),
  );
const at = (x: bigint, y?: bigint): [bigint, bigint | undefined] => [x, y];
const hop = { exchange: 0, pool: zeroAddress, tokenOut: zeroAddress, fee: 0, tickSpacing: 0 };
const route = (pools: string[], gas = 0): Candidate => ({ pools, hops: pools.map(() => hop), gas });
const model = (curves: Record<string, Curve>, amounts: number[], candidates: Candidate[][], gasPrice = 0): Model => ({
  amounts,
  candidates,
  curves: new Map(Object.entries(curves)),
  gasPrice,
});

test("a curve interpolates, runs at half its last rate past its reads, stops at a refusal, never falls", () => {
  const read = curveOf([at(100n, 90n), at(200n, 160n), at(400n)]);
  assert.deepEqual(
    [0, 50, 150, 300, 400].map((x) => along(read, x)),
    [0, 45, 125, 160 + (100 * 0.7) / 2, undefined],
  );
  assert.equal(along(curveOf([at(100n, 90n), at(200n, 80n)]), 200), 90);
  assert.equal(along(curveOf([at(100n, 100n)], true), 100), 99, "1% haircut");
  assert.equal(along(curveOf([at(100n)]), 1), undefined);
});

test("two sales through one pool fetch what it pays for both, less than each alone", () => {
  const shared = { shared: curve(pays(1_000_000), 2_000) };
  const one = [route(["shared"])];
  const both = worth(model(shared, [1_000, 1_000], [one, one]), [[10], [10]])!;
  const once = worth(model(shared, [2_000], [one]), [[10]])!;
  assert.ok(Math.abs(both - once) < 1e-6, `${both} ${once}`);
  assert.ok(both < 2 * worth(model(shared, [1_000], [one]), [[10]])!);
});

test("a sale too large for its pool is split in proportion to the pools' depth", () => {
  const curves = { deep: curve(pays(10_000), 10_000), shallow: curve(pays(5_000), 10_000) };
  const split = model(curves, [10_000], [[route(["deep"]), route(["shallow"])]]);
  const chunks = allocate(split);
  assert.deepEqual(chunks, [[7, 3]]);
  assert.ok(worth(split, chunks)! > worth(split, [[10, 0]])!);
});

test("a split is not taken when its gas costs more than it gains", () => {
  const curves = { deep: curve(pays(10_000), 1_000), other: curve(pays(10_000), 1_000) };
  const candidates = [[route(["deep"], 100), route(["other"], 100)]];
  assert.deepEqual(allocate(model(curves, [1_000], candidates, 1)), [[10, 0]]);
  assert.deepEqual(allocate(model(curves, [1_000], candidates, 0)), [[5, 5]]);
});

test("a sale moves aside from a pool another sale already moved", () => {
  const deep = curve(pays(100_000), 50_000);
  const curves = { first: deep, last: deep, middle: deep, aside: curve((x) => 0.9 * pays(100_000)(x), 50_000) };
  const second = [route(["middle", "last"]), route(["middle", "aside"])];
  const alone = model(curves, [10_000], [second]);
  assert.ok(worth(alone, [[10, 0]])! > worth(alone, [[0, 10]])!, "alone, its own route pays more");
  const both = model(curves, [20_000, 10_000], [[route(["first", "last"])], second]);
  const chunks = allocate(both);
  assert.ok(chunks[1]![1]! > 0, JSON.stringify(chunks));
  assert.ok(worth(both, chunks)! > worth(both, [[10], [10, 0]])!);
});

test("a sale goes along three routes at most, in tenths that add up", () => {
  const names = ["a", "b", "c", "d", "e"];
  const curves = Object.fromEntries(names.map((name) => [name, curve(pays(1_000), 10_000)]));
  const [chunks] = allocate(model(curves, [10_000], [names.map((name) => route([name]))]));
  assert.equal(chunks!.filter(Boolean).length, 3, JSON.stringify(chunks));
  const total = chunks!.reduce((sum, n) => sum + n);
  assert.equal(total, 10);
});

test("a route is not given more than its pool would take", () => {
  const thin = curveOf([at(1_000n, 990n), at(2_000n)]);
  const curves = { deep: curve(pays(10_000), 10_000), thin };
  assert.deepEqual(allocate(model(curves, [10_000], [[route(["deep"]), route(["thin"])]])), [[9, 1]]);
});
