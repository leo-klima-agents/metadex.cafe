import assert from "node:assert/strict";
import { test } from "node:test";
import type { Currency } from "../src/config.ts";
import * as f from "../src/format.ts";

const FLIP = 1_792_627_200; // Thu 22 Oct 2026, 00:00 UTC

test("weeks, dates and durations", () => {
  assert.equal(f.weekStart(FLIP), FLIP);
  assert.equal(f.weekStart(FLIP - 1), FLIP - f.WEEK);
  assert.match(f.day(FLIP), /^Thu,? 22 Oct$/);
  assert.equal(f.date(1_803_945_600), "2 Mar 2027");
  assert.match(f.utc(FLIP), /^Thu,? 22 Oct,? 00:00 UTC$/);
  assert.equal(f.until(4 * 86_400 + 6 * 3_600 + 59 * 60), "4 d 6 h");
  assert.equal(f.until(6 * 3_600 + 12 * 60 + 30), "6 h 12 min");
  assert.equal(f.until(59), "less than a minute");
});

test("numbers, votes, counts and lists", () => {
  assert.equal(f.bps(3333n), "33.33%");
  assert.equal(f.fraction(0.1667), "16.7%");
  assert.deepEqual(
    [0.1667, 0.03, 0, 0.0004].map((share) => f.fraction(share, true)),
    ["16.7%", "3.0%", "0.0%", "< 0.1%"],
    "in a column, always to a tenth",
  );
  assert.equal(f.units(5_691_499_999_999_999_999_999n), "5,691");
  assert.equal(f.voteWords(897_043n * 10n ** 18n), "897,043 votes");
  assert.equal(f.voteWords(15n * 10n ** 17n), "1 vote");
  assert.equal(f.voteWords(10n ** 17n), "< 1 vote");
  assert.equal(f.compact(897_042_934_693_272_892_269_268n), "897k");
  assert.equal(f.compact(999_600n * 10n ** 18n), "1M");
  assert.equal(f.figure(41_234_000n, 6), "41.23");
  assert.equal(f.count(1, "account", "accounts"), "1 account");
  assert.equal(f.count(1234, "account", "accounts"), "1,234 accounts");
  assert.deepEqual(f.listWith([1, 2, 3]), [1, ", ", 2, " and ", 3]);
  assert.equal(f.short("0x5a1C2f3A4b5C6d7E8f9A0b1C2d3E4f5A6b7C7e40"), "0x5a1C…7e40");
});

test("text from the chain loses what is hidden or reorders it", () => {
  assert.equal(f.clean("‮evil‬ name"), "evil name");
  assert.equal(f.clean("Main\tProtocol\r\nAccount"), "Main Protocol Account");
  assert.equal(f.clean("US­DC"), "USDC");
  assert.equal(f.clean("Main ​ Account"), "Main Account");
});

test("token amounts to fixed places, rounded half away from zero, without floats", () => {
  assert.equal(f.fixed(63_930_000n, 6, 2), "63.93");
  assert.equal(f.fixed(-639_300n, 6, 2), "−0.64");
  assert.equal(f.fixed(1_000n, 6, 2), "< 0.01");
  assert.equal(f.fixed(-1_000n, 6, 2), "> −0.01");
  assert.equal(f.fixed(15_000n, 6, 2), "0.02");
  assert.equal(f.fixed(123_456_789_012_345_678_901_234_567n, 18, 6), "123,456,789.012346");
  assert.equal(f.fixed(5n, 0, 2), "5.00");
  assert.equal(f.rounded(-1_005_000n, 6, 2), -1_010_000n);
  assert.equal(f.amount(18_686_451_234_567_890_000_000n, 18), "18,686.45");
  assert.equal(f.amount(0n, 18), "0.00");
});

test("money, approximate, in the currency picked at the rate of its prices' time", () => {
  const usd = (value: number, cents = false) => f.money({ value, unit: "USD" }, cents);
  assert.equal(usd(692.85), "$693");
  assert.equal(usd(0.7724), "$0.77");
  assert.equal(usd(0.001), "< $0.01");
  assert.equal(usd(0), "$0");
  assert.equal(usd(-1.312), "−$1.31");
  assert.equal(usd(692.4, true), "$692.40");
  assert.equal(f.money({ value: 0.7724, unit: "USDC" }), "0.77 USDC");
  assert.equal(
    f.money(f.moneyAt(3.1, { unit: "USD" }, true)),
    "At\u00a0least\u00a0$3.10",
    "when some of it had no price",
  );
  assert.deepEqual(f.moneyAt(3.1, { unit: "USD" }), { value: 3.1, unit: "USD", rates: undefined });
  const then = { unit: "USD", rates: { EUR: 1.25, GBP: 1.25, CHF: 1.25, AUD: 0.625, CAD: 0.625 } } as const;
  try {
    const shown = (currency: Currency, value = 10) => {
      f.setCurrency(currency);
      return f.money(f.moneyAt(value, then));
    };
    assert.equal(shown("EUR"), "€8.00");
    assert.equal(shown("EUR", 250), "€200");
    assert.equal(shown("GBP"), "£8.00");
    assert.equal(shown("CHF"), "CHF 8.00");
    assert.equal(shown("AUD"), "A$16.00");
    assert.equal(shown("CAD"), "CA$16.00");
    assert.equal(f.money({ value: 10, unit: "USD" }), "$10.00", "no rate for the time");
    assert.equal(f.money({ value: 10, unit: "USDC", rates: then.rates }), "10.00 USDC");
  } finally {
    f.setCurrency("USD");
  }
});

test("what lies between two sums, so that a column adds up as it reads", () => {
  const [fetched, paid] = [f.moneyAt(1.006, { unit: "USD" }), f.moneyAt(0.994, { unit: "USD" })];
  assert.equal(f.money(fetched, true), "$1.01");
  assert.equal(f.money(paid, true), "$0.99");
  assert.equal(f.money(f.between(fetched, paid), true), "−$0.02");
});

test("hex in groups of four, and an address as hardware wallets show it", () => {
  const address = "0xdE91885cF35ac57DF0c4A75c16862127dBe8317c";
  assert.deepEqual(f.hexLines(address), [
    ["0x", "dE91", "885c", "F35a", "c57D", "F0c4", "A75c", "1686", "2127", "dBe8", "317c"],
  ]);
  const data = `0x84dbc448${"0".repeat(24)}de91885cf35ac57df0c4a75c16862127dbe8317c${"0".repeat(60)}2544`;
  assert.deepEqual(f.hexLines(data)[0], ["0x84dbc448"]);
  assert.equal(f.hexLines(data).flat().join(""), data);
  assert.deepEqual(f.walletLines(address), [
    ["0x", "dE91", "885c", "F35a"],
    ["c57D", "F0c4", "A75c", "1686"],
    ["2127", "dBe8", "317c"],
  ]);
});
