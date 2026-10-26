import assert from "node:assert/strict";
import { test } from "node:test";
import { zeroAddress } from "viem";
import { allocate, along, curveOf, worth, type Candidate, type Curve, type Model } from "../src/routing.ts";

// A pool of reserves r and r, as Uniswap v2's without its fee: what it pays for x.
const pays = (r: number) => (x: number) => (r * x) / (r + x);
// Read at amounts halving from `range`, as the router reads a pool.
const curve = (paid: (x: number) => number, range: number, amounts = 6): Curve =>
  curveOf(
    Array.from({ length: amounts }, (_, k) => {
      const x = range / 2 ** k;
      return [BigInt(Math.round(x)), BigInt(Math.round(paid(x)))] as [bigint, bigint];
    }),
  );
const route = (pools: string[], gas = 0): Candidate => ({ pools, hops: pools.map(() => hop), gas });
const hop = { exchange: 0, pool: zeroAddress, tokenOut: zeroAddress, fee: 0, tickSpacing: 0 };

test("a pool pays in proportion between the amounts it was read at, at half its last rate past them, up to a refusal", () => {
  const read = curveOf([
    [100n, 90n],
    [200n, 160n],
    [400n, undefined],
  ]);
  assert.equal(along(read, 0), 0);
  assert.equal(along(read, 50), 45);
  assert.equal(along(read, 150), 125);
  assert.equal(along(read, 300), 160 + (100 * 0.7) / 2);
  assert.equal(along(read, 400), undefined, "it refused 400");
  // Never less for more, and 1% less for Aero's classic pools.
  const odd = curveOf([
    [100n, 90n],
    [200n, 80n],
  ]);
  assert.equal(along(odd, 200), 90);
  assert.equal(along(curveOf([[100n, 100n]], true), 100), 99);
  // A pool that refused every amount pays nothing.
  assert.equal(along(curveOf([[100n, undefined]]), 1), undefined);
});

test("two sales through one pool fetch together what the pool pays for both, whatever their order", () => {
  const curves = new Map([["shared", curve(pays(1_000_000), 2_000)]]);
  const model: Model = {
    amounts: [1_000, 1_000],
    candidates: [[route(["shared"])], [route(["shared"])]],
    curves,
    gasPrice: 0,
  };
  const both = worth(model, [[10], [10]])!;
  const once = worth({ ...model, amounts: [2_000], candidates: [[route(["shared"])]] }, [[10]])!;
  assert.ok(Math.abs(both - once) < 1e-6, `${both} ${once}`);
  // Less than each would fetch alone.
  const alone = worth({ ...model, amounts: [1_000], candidates: [[route(["shared"])]] }, [[10]])!;
  assert.ok(both < 2 * alone);
});

test("a sale too large for its pool goes in parts through another, as far as they pay alike", () => {
  const curves = new Map([
    ["deep", curve(pays(10_000), 10_000)],
    ["shallow", curve(pays(5_000), 10_000)],
  ]);
  const model: Model = {
    amounts: [10_000],
    candidates: [[route(["deep"]), route(["shallow"])]],
    curves,
    gasPrice: 0,
  };
  const chunks = allocate(model);
  // Reserves of two to one: two thirds and a third, to the nearest tenth.
  assert.deepEqual(chunks, [[7, 3]]);
  assert.ok(worth(model, chunks)! > worth(model, [[10, 0]])!);
});

test("a part is not worth a route whose gas costs more than it gains", () => {
  const curves = new Map([
    ["deep", curve(pays(10_000), 1_000)],
    ["other", curve(pays(10_000), 1_000)],
  ]);
  const candidates = [[route(["deep"], 100), route(["other"], 100)]];
  assert.deepEqual(allocate({ amounts: [1_000], candidates, curves, gasPrice: 1 }), [[10, 0]]);
  // Without gas, half and half pays a little more.
  assert.deepEqual(allocate({ amounts: [1_000], candidates, curves, gasPrice: 0 }), [[5, 5]]);
});

test("a sale leaves a pool another fills for a route of its own, once the other moved that pool", () => {
  // Two sales both end through "last"; the second may go through "aside" instead, a longer way that pays less alone.
  const curves = new Map([
    ["first", curve(pays(100_000), 50_000)],
    ["last", curve(pays(100_000), 50_000)],
    ["middle", curve(pays(100_000), 50_000)],
    ["aside", curve((x) => 0.9 * pays(100_000)(x), 50_000)],
  ]);
  const model: Model = {
    amounts: [20_000, 10_000],
    candidates: [[route(["first", "last"])], [route(["middle", "last"]), route(["middle", "aside"])]],
    curves,
    gasPrice: 0,
  };
  const alone = worth({ ...model, amounts: [10_000], candidates: [model.candidates[1]!] }, [[10, 0]])!;
  const aside = worth({ ...model, amounts: [10_000], candidates: [model.candidates[1]!] }, [[0, 10]])!;
  assert.ok(alone > aside, "alone, the second sale's own route pays more");
  const chunks = allocate(model);
  assert.ok(chunks[1]![1]! > 0, JSON.stringify(chunks));
  assert.ok(worth(model, chunks)! > worth(model, [[10], [10, 0]])!);
});

test("a sale goes along three routes at most", () => {
  const curves = new Map(["a", "b", "c", "d", "e"].map((name) => [name, curve(pays(1_000), 10_000)] as const));
  const model: Model = {
    amounts: [10_000],
    candidates: [["a", "b", "c", "d", "e"].map((name) => route([name]))],
    curves,
    gasPrice: 0,
  };
  const [chunks] = allocate(model);
  assert.equal(chunks!.filter(Boolean).length, 3, JSON.stringify(chunks));
  assert.equal(
    chunks!.reduce((sum, n) => sum + n, 0),
    10,
  );
});

test("a route through a pool that would refuse its part is not taken", () => {
  const curves = new Map([
    ["deep", curve(pays(10_000), 10_000)],
    [
      "thin",
      curveOf([
        [1_000n, 990n],
        [2_000n, undefined],
      ]),
    ],
  ]);
  const chunks = allocate({ amounts: [10_000], candidates: [[route(["deep"]), route(["thin"])]], curves, gasPrice: 0 });
  // A tenth, 1,000, fits; two tenths would not.
  assert.deepEqual(chunks, [[9, 1]]);
});
