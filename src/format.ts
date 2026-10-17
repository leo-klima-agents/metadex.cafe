// Times are in seconds.

/** The page's language, as in <html lang>. Numbers and dates follow it, not the browser's language. */
export const LANG = "en-GB";

export const WEEK = 604_800;

/** The Thursday 00:00 UTC at or before a time. The Unix epoch began on a Thursday. */
export const weekStart = (time: number): number => time - (time % WEEK);

const whole = new Intl.NumberFormat(LANG, { maximumFractionDigits: 0 });
const percent = new Intl.NumberFormat(LANG, { style: "percent", maximumFractionDigits: 2 });
const share = new Intl.NumberFormat(LANG, { style: "percent", minimumFractionDigits: 1, maximumFractionDigits: 1 });
const utcDay = new Intl.DateTimeFormat(LANG, { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
const utcDate = new Intl.DateTimeFormat(LANG, { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const utcTime = new Intl.DateTimeFormat(LANG, {
  weekday: "short",
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "UTC",
});
const plurals = new Intl.PluralRules(LANG);
const and = new Intl.ListFormat(LANG, { type: "conjunction" });

/** A whole number of 18-decimal units, rounded down: 897042.7e18 → "897,042". */
export const units = (value: bigint): string => whole.format(value / 10n ** 18n);

/** Votes as Hydrex shows them, × 1.3 as Earning Power; "< 1" for less than one but not none. */
export function earningPower(votes: bigint): string {
  const power = (votes * 13n) / 10n;
  return power > 0n && power < 10n ** 18n ? "< 1" : units(power);
}

/** Basis points as a percentage: 3333 → "33.33%". */
export const bps = (value: bigint): string => percent.format(Number(value) / 10_000);

/** A part of a whole as a percentage with one decimal: "16.6%". */
export const shareOf = (part: bigint, whole: bigint): string => share.format(Number(part) / Number(whole));

/** "Thu 15 Oct", in UTC. */
export const day = (time: number): string => utcDay.format(time * 1000);

/** "3 Mar 2027", in UTC. */
export const date = (time: number): string => utcDate.format(time * 1000);

/** "Wed 14 Oct, 23:59", in UTC. */
export const dayTime = (time: number): string => utcTime.format(time * 1000);

/**
 * The two largest units: "6 days, 2 hours", "3 hours, 5 minutes", "less than a minute". Built from plural rules rather
 * than Intl.DurationFormat, which Chrome has had only since 2024 and Firefox since 2025.
 */
export function countdown(seconds: number): string {
  const [days, hours, minutes] = [
    Math.floor(seconds / 86_400),
    Math.floor(seconds / 3600) % 24,
    Math.floor(seconds / 60) % 60,
  ];
  const values = [days, hours, minutes];
  const parts = [count(days, "day", "days"), count(hours, "hour", "hours"), count(minutes, "minute", "minutes")];
  const first = values.findIndex((n) => n > 0);
  if (first < 0) return "less than a minute";
  // The largest unit, and the next one unless it is zero.
  return parts
    .slice(first, first + 2)
    .filter((_, i) => values[first + i])
    .join(", ");
}

/** "0x5a1C…7e40". */
export const short = (address: string): string => `${address.slice(0, 6)}…${address.slice(-4)}`;

/** A number of things: "1 pool", "1,234 pools". */
export const count = (n: number, one: string, other: string): string =>
  `${whole.format(n)} ${plurals.select(n) === "one" ? one : other}`;

/** "#1", "#1 and #2", "#1, #2 and #3". */
export const list = (items: string[]): string => and.format(items);

// Controls, and the marks that reorder or hide text, which a name could use to pass for another.
const HIDDEN = /[\p{Cc}\u061c\u200b-\u200f\u202a-\u202e\u2060-\u2069\ufeff]/gu;

/** Text from the chain, such as a name, on one line and without hidden marks. The page shows it in <bdi>. */
export const clean = (text = ""): string => text.replace(/\s+/g, " ").replace(HIDDEN, "").trim();
