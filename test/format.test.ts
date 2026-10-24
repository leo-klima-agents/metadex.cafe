import assert from "node:assert/strict";
import { test } from "node:test";
import {
  WEEK,
  amount,
  between,
  bps,
  clean,
  compact,
  CURRENCIES,
  count,
  currency,
  date,
  day,
  earningPower,
  fixed,
  fraction,
  hexLines,
  listWith,
  money,
  moneyAt,
  rounded,
  onCurrency,
  setCurrency,
  short,
  units,
  until,
  walletLines,
  weekStart,
  when,
  type Currency,
} from "../src/format.ts";

const FLIP = 1_792_627_200; // Thu 22 Oct 2026, 00:00 UTC

test("weeks start on Thursday at 00:00 UTC", () => {
  assert.equal(weekStart(FLIP), FLIP);
  assert.equal(weekStart(FLIP - 1), FLIP - WEEK);
  assert.equal(weekStart(FLIP + WEEK - 1), FLIP);
});

test("dates in UTC; some browsers put a comma after the day of the week", () => {
  assert.match(day(FLIP), /^Thu,? 22 Oct$/);
  assert.match(day(FLIP - 1), /^Wed,? 21 Oct$/);
  assert.equal(date(1_803_945_600), "2 Mar 2027");
});

test("times in UTC, then in the visitor's zone when it differs", () => {
  assert.match(when(FLIP, "UTC"), /^Thu,? 22 Oct,? 00:00 UTC$/);
  assert.match(when(FLIP, "Europe/Paris"), /^Thu,? 22 Oct,? 00:00 UTC \(Thu,? 22 Oct,? 02:00 your time\)$/);
  assert.match(when(FLIP, "America/New_York"), /^Thu,? 22 Oct,? 00:00 UTC \(Wed,? 21 Oct,? 20:00 your time\)$/);
});

test("how long until", () => {
  assert.equal(until(4 * 86_400 + 6 * 3_600 + 59 * 60), "4 d 6 h");
  assert.equal(until(6 * 3_600 + 12 * 60 + 30), "6 h 12 min");
  assert.equal(until(61), "1 min");
  assert.equal(until(59), "less than a minute");
  assert.equal(until(-5), "less than a minute");
});

test("numbers", () => {
  assert.equal(bps(3333n), "33.33%");
  assert.equal(bps(5000n), "50%");
  assert.equal(bps(0n), "0%");
  assert.equal(bps(100n), "1%");
  assert.equal(units(5_691_499_999_999_999_999_999n), "5,691");
  assert.equal(earningPower(897_043n * 10n ** 18n), "1,166,155");
  assert.equal(earningPower(10n ** 17n), "< 1");
  assert.equal(earningPower(0n), "0");
  assert.equal(short("0x5a1C2f3A4b5C6d7E8f9A0b1C2d3E4f5A6b7C7e40"), "0x5a1C…7e40");
});

test("text from the chain loses hidden marks, and its line breaks and tabs become spaces", () => {
  assert.equal(clean("\u202eevil\u202c name"), "evil name");
  assert.equal(clean("zero\u200bwidth\u0000"), "zerowidth");
  assert.equal(clean("  spaced \n  out  "), "spaced out");
  assert.equal(clean("Main\nAccount"), "Main Account");
  assert.equal(clean("\ufeffa\u061c\u200b\u200f\u202a\u202e\u2060\u2069b"), "ab");
  assert.equal(clean("Main\tProtocol\r\nAccount"), "Main Protocol Account");
  assert.equal(clean("US\u00adDC"), "USDC", "a soft hyphen");
  assert.equal(clean("tag\u{e0041}s"), "tags", "a tag character");
  assert.equal(clean("Main \u200b Account"), "Main Account", "no double space where a mark was");
});

test("counts, with plurals", () => {
  assert.equal(count(1, "account", "accounts"), "1 account");
  assert.equal(count(27, "account", "accounts"), "27 accounts");
  assert.equal(count(1234, "empty account", "empty accounts"), "1,234 empty accounts");
});

test("what prices value is approximate, in dollars or USDC, with no break after the sign or before the unit", () => {
  const usd = (value: number) => money({ value, unit: "USD" });
  assert.equal(usd(692.85), "≈\u00a0$693");
  assert.equal(usd(0.7724), "≈\u00a0$0.77");
  assert.equal(usd(111_078.6), "≈\u00a0$111,079");
  assert.equal(usd(0.001), "<\u00a0$0.01");
  assert.equal(usd(0), "$0");
  const usdc = (value: number) => money({ value, unit: "USDC" });
  assert.equal(usdc(692.85), "≈\u00a0693\u00a0USDC");
  assert.equal(usdc(0.7724), "≈\u00a00.77\u00a0USDC");
  assert.equal(usdc(0.001), "<\u00a00.01\u00a0USDC");
  assert.equal(usdc(0), "0\u00a0USDC");
});

test("a sum taken away has its minus on the number, after the ≈; in a column, to the cent", () => {
  const usd = (value: number, cents = false) => money({ value, unit: "USD" }, { cents });
  assert.equal(usd(-123.4), "≈\u00a0−$123");
  assert.equal(usd(-1.312), "≈\u00a0−$1.31");
  assert.equal(usd(-0.001), ">\u00a0−$0.01");
  assert.equal(usd(692.4, true), "≈\u00a0$692.40");
  assert.equal(usd(-692.4, true), "≈\u00a0−$692.40");
  assert.equal(usd(0, true), "$0.00");
  assert.equal(money({ value: -0.77, unit: "USDC" }), "≈\u00a0−0.77\u00a0USDC");
});

test("token amounts to a set number of decimal places, so that a column lines up at the point", () => {
  assert.equal(fixed(63_930_000n, 6, 2), "63.93");
  assert.equal(fixed(639_300n, 6, 2), "0.64");
  assert.equal(fixed(-639_300n, 6, 2), "−0.64");
  assert.equal(fixed(1_000n, 6, 2), "<\u00a00.01");
  assert.equal(fixed(-1_000n, 6, 2), ">\u00a0−0.01");
  assert.equal(fixed(25_490_000_000_000_000n, 18, 6), "0.025490");
  assert.equal(fixed(1_234_567_890n, 6, 2), "1,234.57");
  assert.equal(fixed(0n, 6, 2), "0.00");
});

test("token amounts round half away from zero, and keep every digit", () => {
  assert.equal(fixed(15_000n, 6, 2), "0.02");
  assert.equal(fixed(-15_000n, 6, 2), "−0.02");
  assert.equal(fixed(5_000n, 6, 2), "0.01");
  assert.equal(fixed(4_999n, 6, 2), "<\u00a00.01");
  assert.equal(fixed(123_456_789_012_345_678_901_234_567n, 18, 6), "123,456,789.012346");
  assert.equal(fixed(5n, 0, 2), "5.00");
  assert.equal(fixed(1_234_567n, 6, 0), "1");
  assert.equal(rounded(1_015_000n, 6, 2), 1_020_000n);
  assert.equal(rounded(-1_005_000n, 6, 2), -1_010_000n);
  assert.equal(rounded(7n, 2, 4), 7n);
});

test("what lies between two sums, so that a column adds up as it reads", () => {
  setCurrency("USD");
  const [fetched, paid] = [moneyAt(1.006, { unit: "USD" }), moneyAt(0.994, { unit: "USD" })];
  const fee = between(fetched, paid);
  assert.equal(money(fetched, { cents: true }), "≈\u00a0$1.01");
  assert.equal(money(paid, { cents: true }), "≈\u00a0$0.99");
  assert.equal(money(fee, { cents: true }), "≈\u00a0−$0.02");
  assert.equal(money(between(fetched, fetched), { cents: true }), "$0.00");
  // In the currency picked, at its rate.
  const rates = { EUR: 1.1 };
  setCurrency("EUR");
  const [a, b] = [moneyAt(1.1 * 1.006, { unit: "USD", rates }), moneyAt(1.1 * 0.994, { unit: "USD", rates })];
  assert.equal(money(between(a, b), { cents: true }), "≈\u00a0−€0.02");
  setCurrency("USD");
});

test("in the currency picked, at its rate of the prices' own time; without one, as the prices are", () => {
  const then = { unit: "USD", rates: { EUR: 1.25, GBP: 1.25, CHF: 1.25, AUD: 0.625, CAD: 0.625 } } as const;
  assert.deepEqual(CURRENCIES, ["USD", "EUR", "GBP", "CHF", "AUD", "CAD"]);
  assert.equal(currency(), "USD");
  assert.equal(money(moneyAt(10, then)), "≈\u00a0$10.00");
  try {
    setCurrency("EUR");
    assert.equal(money(moneyAt(10, then)), "≈\u00a0€8.00");
    assert.equal(money(moneyAt(250, then)), "≈\u00a0€200");
    assert.equal(money(moneyAt(0.005, then)), "<\u00a0€0.01");
    assert.equal(money({ value: 10, unit: "USD" }), "≈\u00a0$10.00", "no rate for the time");
    assert.equal(money({ value: 10, unit: "USDC", rates: then.rates }), "≈\u00a010.00\u00a0USDC", "no dollar prices");
    // Each sign tells its currency from the dollar's.
    const shown = (picked: Currency) => (setCurrency(picked), money(moneyAt(10, then)));
    assert.equal(shown("GBP"), "≈\u00a0£8.00");
    assert.equal(shown("CHF"), "≈\u00a0CHF\u00a08.00");
    assert.equal(shown("AUD"), "≈\u00a0A$16.00");
    assert.equal(shown("CAD"), "≈\u00a0CA$16.00");
    assert.equal(money({ value: 10, unit: "USD", rates: { EUR: 1.25 } }), "≈\u00a0$10.00", "no CAD rate for the time");
  } finally {
    setCurrency("USD");
  }
});

test("a change of currency calls each listener once, and none when it stays", () => {
  let calls = 0;
  onCurrency(() => calls++);
  setCurrency("USD");
  assert.equal(calls, 0);
  setCurrency("EUR");
  setCurrency("USD");
  assert.equal(calls, 2);
});

test("large numbers of votes, and shares", () => {
  assert.equal(compact(897_042_934_693_272_892_269_268n), "897k");
  assert.equal(compact(1_166_155n * 10n ** 18n), "1.17M");
  assert.equal(compact(168_381_324n * 10n ** 18n), "168M");
  assert.equal(compact(999_600n * 10n ** 18n), "1M", "rounded before it is scaled");
  assert.equal(compact(1_234n * 10n ** 18n), "1.23k");
  assert.equal(compact(999n * 10n ** 18n), "999");
  assert.equal(compact(0n), "0");
  assert.equal(fraction(0.1667), "16.7%");
});

test("hex in groups of four: an address or a hash on one line, calldata a line for each word", () => {
  assert.deepEqual(hexLines("0xdE91885cF35ac57DF0c4A75c16862127dBe8317c"), [
    ["0x", "dE91", "885c", "F35a", "c57D", "F0c4", "A75c", "1686", "2127", "dBe8", "317c"],
  ]);
  assert.equal(hexLines(`0x${"ab".repeat(32)}`)[0]!.length, 17);
  const data = `0x84dbc448${"0".repeat(24)}de91885cf35ac57df0c4a75c16862127dbe8317c${"0".repeat(60)}2544${"0".repeat(63)}1`;
  const lines = hexLines(data);
  assert.deepEqual(lines[0], ["0x84dbc448"]);
  assert.equal(lines.length, 4);
  assert.deepEqual(lines[2]!.slice(-2), ["0000", "2544"]);
  assert.equal(lines.flat().join(""), data, "the groups are the hex, with nothing added");
});

test("an address as hardware wallets show it: three lines of four columns, the 0x first", () => {
  const address = "0xdE91885cF35ac57DF0c4A75c16862127dBe8317c";
  assert.deepEqual(walletLines(address), [
    ["0x", "dE91", "885c", "F35a"],
    ["c57D", "F0c4", "A75c", "1686"],
    ["2127", "dBe8", "317c"],
  ]);
  assert.equal(walletLines(address).flat().join(""), address, "the groups are the address, with nothing added");
});

test("amounts of a token, from its decimals", () => {
  assert.equal(amount(18_686_451_234_567_890_000_000n, 18), "18,686.45");
  assert.equal(amount(1_500_000n, 6), "1.50");
  assert.equal(amount(1n, 18), "<\u00a00.01");
  assert.equal(amount(0n, 18), "0");
});

test("a list's items with the words between them, whatever the items are", () => {
  assert.deepEqual(listWith([1, 2, 3]), [1, ", ", 2, " and ", 3]);
  assert.deepEqual(listWith(["a"]), ["a"]);
});
