import assert from "node:assert/strict";
import { test } from "node:test";
import { SPAN, observedPrice, pairPrice, tickPrice, worthOf } from "../src/prices.ts";

test("a tick, reserves on either curve, and an amount's worth", () => {
  assert.ok(Math.abs(tickPrice(0, 18, 6) - 1e12) < 1);
  assert.equal(pairPrice(2, 4, false), 2);
  assert.equal(pairPrice(1, 1, true), 1);
  assert.equal(worthOf(1_500_000n, 6, 2), 3);
});

test("an average between observations, unless too far apart or empty", () => {
  const first = [0n, 0n, 0n] as const;
  assert.equal(observedPrice(first, [10n, 10n * 10n ** 18n, 20n * 10n ** 6n], 18, 6, false), 2);
  assert.equal(observedPrice(first, [BigInt(SPAN + 1), 10n, 10n], 0, 0, false), undefined);
  assert.equal(observedPrice(first, [10n, 0n, 10n], 0, 0, false), undefined);
});
