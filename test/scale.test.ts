import assert from "node:assert/strict";
import { test } from "node:test";
import { spread, ticksOf } from "../src/views/scale.ts";

test("a chart's ticks fit its values, from the last tick below the lowest, never below zero", () => {
  // APRs between 19.5% and 33.8% get ticks every 5 points, not every 10 from zero.
  assert.deepEqual(ticksOf(0.195, 0.338), [0.15, 0.2, 0.25, 0.3, 0.35]);
  // A lowest value on a tick still has a tick below it, so its line doesn't run along the bottom.
  assert.deepEqual(ticksOf(0.2, 0.3), [0.15, 0.2, 0.25, 0.3]);
  assert.deepEqual(ticksOf(0, 0.3), [0, 0.1, 0.2, 0.3]);
  assert.deepEqual(ticksOf(0.01, 0.3), [0, 0.1, 0.2, 0.3], "never below zero");
  assert.deepEqual(ticksOf(0.25, 0.25), [0.2, 0.3], "one value still gets a range");
  assert.deepEqual(ticksOf(0, 0), [0, 1], "nothing above zero");
});

test("end labels move apart, keeping their order, as near their own places as the room allows", () => {
  assert.deepEqual(spread([100, 104, 106, 200], 14, 16, 216), [100, 114, 128, 200]);
  assert.deepEqual(spread([106, 100, 104], 14, 16, 216), [128, 100, 114], "in any order");
  assert.deepEqual(spread([210, 215], 14, 16, 216), [202, 216], "pushed up from the bottom");
  assert.deepEqual(spread([10, 12], 14, 16, 216), [16, 30], "pushed down from the top");
  assert.deepEqual(spread([50, 150], 14, 16, 216), [50, 150], "labels apart stay put");
});
