import assert from "node:assert/strict";
import { test } from "node:test";
import {
  WEEK,
  amount,
  bps,
  clean,
  compact,
  count,
  date,
  day,
  earningPower,
  fraction,
  hexLines,
  listWith,
  share,
  short,
  units,
  until,
  usd,
  weekStart,
  when,
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

test("shares with a plain name are said in words too", () => {
  assert.equal(share(3333n), "a third (33.33%)");
  assert.equal(share(6667n), "two thirds (66.67%)");
  assert.equal(share(5000n), "half (50%)");
  assert.equal(share(1234n), "12.34%");
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
});

test("counts, with plurals", () => {
  assert.equal(count(1, "account", "accounts"), "1 account");
  assert.equal(count(27, "account", "accounts"), "27 accounts");
  assert.equal(count(1234, "empty account", "empty accounts"), "1,234 empty accounts");
});

test("dollars are approximate, with no break after the sign", () => {
  assert.equal(usd(692.85), "≈\u00a0$693");
  assert.equal(usd(0.7724), "≈\u00a0$0.77");
  assert.equal(usd(111_078.6), "≈\u00a0$111,079");
  assert.equal(usd(0.001), "<\u00a0$0.01");
  assert.equal(usd(0), "$0");
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
    ["0xdE91", "885c", "F35a", "c57D", "F0c4", "A75c", "1686", "2127", "dBe8", "317c"],
  ]);
  assert.equal(hexLines(`0x${"ab".repeat(32)}`)[0]!.length, 16);
  const data = `0x84dbc448${"0".repeat(24)}de91885cf35ac57df0c4a75c16862127dbe8317c${"0".repeat(60)}2544${"0".repeat(63)}1`;
  const lines = hexLines(data);
  assert.deepEqual(lines[0], ["0x84dbc448"]);
  assert.equal(lines.length, 4);
  assert.deepEqual(lines[2]!.slice(-2), ["0000", "2544"]);
  assert.equal(lines.flat().join(""), data, "the groups are the hex, with nothing added");
});

test("amounts of a token, from its decimals", () => {
  assert.equal(amount(18_686_451_234_567_890_000_000n, 18), "18,686.45");
  assert.equal(amount(1_500_000n, 6), "1.50");
  assert.equal(amount(1n, 18), "< 0.01");
  assert.equal(amount(0n, 18), "0");
});

test("a list's items with the words between them, whatever the items are", () => {
  assert.deepEqual(listWith([1, 2, 3]), [1, ", ", 2, " and ", 3]);
  assert.deepEqual(listWith(["a"]), ["a"]);
});
