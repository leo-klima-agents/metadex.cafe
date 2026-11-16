import assert from "node:assert/strict";
import { test } from "node:test";
import { ticksOf } from "../src/views/scale.ts";

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
