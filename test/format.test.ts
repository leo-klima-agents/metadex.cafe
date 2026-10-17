import assert from "node:assert/strict";
import { test } from "node:test";
import { WEEK, bps, clean, count, date, day, earningPower, short, units, weekStart } from "../src/format.ts";

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
