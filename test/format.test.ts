import assert from "node:assert/strict";
import { test } from "node:test";
import {
  between,
  clean,
  compact,
  count,
  date,
  day,
  figure,
  fixed,
  hexLines,
  money,
  rounded,
  setCurrency,
  setRates,
  until,
  walletLines,
  weekStart,
  when,
} from "../src/format.ts";

const THURSDAY = 1_792_627_200; // Thu 22 Oct 2026, 00:00 UTC
const usd = (value: number) => ({ value, unit: "USD" as const });

test("epochs, dates and times", () => {
  assert.equal(weekStart(THURSDAY + 86_399), THURSDAY);
  assert.match(day(THURSDAY), /^Thu,? 22 Oct$/);
  assert.equal(date(THURSDAY), "22 Oct 2026");
  assert.match(when(THURSDAY, "Europe/Paris"), /^Thu,? 22 Oct,? 00:00 UTC \(Thu,? 22 Oct,? 02:00 your time\)$/);
  assert.match(when(THURSDAY, "UTC"), /UTC$/);
  assert.deepEqual([until(90_061), until(3_660), until(59)], ["1 d 1 h", "1 h 1 min", "less than a minute"]);
});

test("amounts: fixed places, rounding half away from zero, figures and votes", () => {
  assert.equal(fixed(63_925n, 3, 2), "63.93");
  assert.equal(fixed(-635n, 3, 2), "−0.64");
  assert.equal(fixed(1n, 18, 2), "< 0.01");
  assert.equal(rounded(-15n, 1, 0), -20n);
  assert.deepEqual([figure(65n, 6), figure(41_234n, 3), figure(10n ** 24n, 18)], ["0.000065", "41.23", "1,000,000"]);
  assert.deepEqual([compact(897_043n * 10n ** 18n), compact(1_170_000n * 10n ** 18n)], ["897k", "1.17M"]);
  assert.equal(count(1, "token", "tokens"), "1 token");
});

test("money: approximate, in the currency picked, and columns that add up", () => {
  assert.equal(money(usd(692.4)), "≈ $692");
  assert.equal(money(usd(692.4), true), "≈ $692.40");
  assert.equal(money(usd(-0.69)), "≈ −$0.69");
  assert.equal(money(usd(0.001)), "< $0.01");
  assert.equal(money({ value: 0.77, unit: "USDC" }), "≈ 0.77 USDC");
  assert.equal(between(usd(1.004), usd(0.996)).value, 0);
  setRates({ EUR: 1.25 });
  setCurrency("EUR");
  assert.equal(money(usd(10)), "≈ €8.00");
  setCurrency("GBP");
  assert.equal(money(usd(10)), "≈ $10.00", "without a rate, in dollars");
  setCurrency("USD");
});

test("hex in groups, as wallets show addresses, and text cleaned of hidden marks", () => {
  const address = "0xdE91885cF35ac57DF0c4A75c16862127dBe8317c";
  assert.deepEqual(hexLines(address), [
    ["0x", "dE91", "885c", "F35a", "c57D", "F0c4", "A75c", "1686", "2127", "dBe8", "317c"],
  ]);
  assert.deepEqual(
    walletLines(address).map((line) => line.length),
    [4, 4, 3],
  );
  assert.equal(hexLines(`0x12345678${"0".repeat(64)}`).length, 2);
  assert.equal(clean(" a​\tb‮ "), "a b");
});
