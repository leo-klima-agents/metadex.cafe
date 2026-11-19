import assert from "node:assert/strict";
import { test } from "node:test";
import { blockAsOf, dataEnd, feeSeries, feeValue, timeOfBlock } from "../research/common.ts";
import { bh, generator, probit, ranks, scaledRanks, seedOf, spearman, variance } from "../research/stats.ts";

test("block times follow Base's schedule on both sides of Denim", () => {
  assert.equal(timeOfBlock(52_919_288), 1_792_627_923);
  assert.equal(timeOfBlock(53_556_127), 1_793_901_601);
  // Five blocks a second after Denim: blocks 5 to 9 after it share a second.
  assert.equal(timeOfBlock(53_556_132), 1_793_901_602);
  assert.equal(timeOfBlock(53_556_136), 1_793_901_602);
  for (const time of [1_792_627_923, 1_793_901_601, 1_795_039_200]) {
    const block = blockAsOf(time);
    assert.ok(timeOfBlock(block) <= time);
    assert.ok(timeOfBlock(block + 1) > time);
  }
});

test("the data ends at the earlier of the gauges' last hour and the last whole hour searched", () => {
  assert.equal(dataEnd({ hours: [0, 3600, 7200] }, { headTime: 9000 }), 7200);
  assert.equal(dataEnd({ hours: [0, 3600, 7200] }, { headTime: 5000 }), 3600);
});

test("fee accumulators are worth growth / 1e6 smallest units per sAERO", () => {
  const token = (address: string, decimals: number) => ({ address, decimals, symbol: "" });
  const gauge = { token0: token("0xA", 6), token1: token("0xB", 18) };
  const snap = { acc0: (2n * 10n ** 12n).toString(), acc1: "0", ts: 0, share: "0", zero: 0 };
  // 2e12 / 1e6 = 2e6 units of a 6-decimal token at $3: $6.
  assert.equal(feeValue(snap, gauge, { "0xa": 3 }), 6);
  assert.equal(feeValue(snap, gauge, {}), 0);
  assert.equal(feeValue(undefined, gauge, { "0xa": 3 }), 0);
});

test("Benjamini–Hochberg q-values keep the order of the p-values", () => {
  const qs = bh([0.01, 0.04, 0.03, 0.2]);
  assert.deepEqual(
    qs.map((q) => Number(q.toFixed(4))),
    [0.04, 0.0533, 0.0533, 0.2],
  );
});

test("ranks share ties, and scaled ranks run from 0 to 1", () => {
  assert.deepEqual(ranks([3, 1, 3, 2]), [2.5, 0, 2.5, 1]);
  assert.deepEqual([...scaledRanks([5, 5])], [0.5, 0.5]);
  assert.deepEqual([...scaledRanks([1, 2, 3])], [0, 0.5, 1]);
});

test("Spearman's ρ is 1 for any increasing relation, ties included", () => {
  assert.equal(spearman([1, 2, 3, 4], [10, 20, 30, 40]), 1);
  assert.equal(spearman([1, 2, 3, 4], [4, 3, 2, 1]), -1);
  assert.ok(Math.abs(spearman([1, 1, 2, 2], [1, 1, 2, 2]) - 1) < 1e-12);
});

test("statistics helpers", () => {
  assert.equal(variance([1, 2, 3, 4]), 1.25);
  assert.ok(Math.abs(probit(0.975) - 1.959964) < 1e-5);
  assert.ok(Math.abs(probit(0.025) + probit(0.975)) < 1e-9);
  const [a, b] = [generator(seedOf("x")), generator(seedOf("x"))];
  assert.deepEqual([a(), a(), a()], [b(), b(), b()]);
  assert.notEqual(generator(seedOf("x"))(), generator(seedOf("y"))());
});

test("fees credited at a checkpoint are spread over the time since the one before", () => {
  const token = { address: "0xa", decimals: 0, symbol: "" };
  const snap = (acc: number, ts: number) => ({ acc0: String(acc * 1e6), acc1: "0", ts, share: "0", zero: 0 });
  // Checkpoints at 0 ($0), 10 ($10) and 40 ($40); hours at 0, 10, 20, 30, 40, 50.
  const gauge = {
    token0: token,
    token1: token,
    index: ["1", "2", "2", "2", "3", "3"],
    snaps: { "1": snap(0, 0), "2": snap(10, 10), "3": snap(40, 40) },
  };
  const fees = feeSeries(gauge, [0, 10, 20, 30, 40, 50], { "0xa": 1 });
  assert.deepEqual([...fees], [0, 10, 20, 30, 40, 40]);
});
