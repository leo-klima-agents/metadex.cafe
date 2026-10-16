import assert from "node:assert/strict";
import { test } from "node:test";
import {
  WEEK,
  bps,
  clean,
  count,
  countdown,
  date,
  day,
  dayTime,
  earningPower,
  shareOf,
  short,
  units,
  weekStart,
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

test("times in UTC, to the minute", () => {
  assert.match(dayTime(FLIP), /^Thu,? 22 Oct, 00:00$/);
  assert.match(dayTime(FLIP - 3), /^Wed,? 21 Oct, 23:59$/);
});

test("countdowns keep the two largest units", () => {
  assert.equal(countdown(6 * 86_400 + 2 * 3600 + 59), "6 days, 2 hours");
  assert.equal(countdown(86_400), "1 day");
  assert.equal(countdown(3 * 3600 + 300), "3 hours, 5 minutes");
  assert.equal(countdown(3600), "1 hour");
  assert.equal(countdown(61), "1 minute");
  assert.equal(countdown(59), "less than a minute");
});

test("numbers", () => {
  assert.equal(bps(3333n), "33.33%");
  assert.equal(bps(5000n), "50%");
  assert.equal(bps(0n), "0%");
  assert.equal(bps(100n), "1%");
  assert.equal(shareOf(166n, 1000n), "16.6%");
  assert.equal(units(5_691_499_999_999_999_999_999n), "5,691");
  assert.equal(earningPower(897_043n * 10n ** 18n), "1,166,155");
  assert.equal(earningPower(10n ** 17n), "< 1");
  assert.equal(earningPower(0n), "0");
  assert.equal(short("0x5a1C2f3A4b5C6d7E8f9A0b1C2d3E4f5A6b7C7e40"), "0x5a1C…7e40");
});

test("text from the chain loses hidden marks", () => {
  assert.equal(clean("\u202eevil\u202c name"), "evil name");
  assert.equal(clean("zero\u200bwidth\u0000"), "zerowidth");
  assert.equal(clean("  spaced \n  out  "), "spaced out");
});

test("line breaks and tabs in text from the chain become spaces", () => {
  assert.equal(clean("Main\nAccount"), "Main Account");
  assert.equal(clean("Main\tProtocol\r\nAccount"), "Main Protocol Account");
});

test("counts, with plurals", () => {
  assert.equal(count(1, "pool", "pools"), "1 pool");
  assert.equal(count(27, "pool", "pools"), "27 pools");
  assert.equal(count(1234, "empty account", "empty accounts"), "1,234 empty accounts");
});
