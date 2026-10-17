export const LANG = "en-GB";
export const WEEK = 604_800;

// The Unix epoch began on a Thursday at 00:00 UTC, as Hydrex's epochs do.
export const weekStart = (time: number): number => time - (time % WEEK);

const whole = new Intl.NumberFormat(LANG, { maximumFractionDigits: 0 });
const percent = new Intl.NumberFormat(LANG, { style: "percent", maximumFractionDigits: 2 });
const utcDay = new Intl.DateTimeFormat(LANG, { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
const DAY_AND_TIME: Intl.DateTimeFormatOptions = {
  weekday: "short",
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
};
const utcDate = new Intl.DateTimeFormat(LANG, { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const plurals = new Intl.PluralRules(LANG);
const and = new Intl.ListFormat(LANG, { type: "conjunction" });

export const units = (value: bigint): string => whole.format(value / 10n ** 18n);

// Hydrex shows votes × 1.3 as Earning Power.
export function earningPower(votes: bigint): string {
  const power = (votes * 13n) / 10n;
  return power > 0n && power < 10n ** 18n ? "< 1" : units(power);
}

export const bps = (value: bigint): string => percent.format(Number(value) / 10_000);

const FRACTIONS: Record<number, string> = {
  0: "none",
  2500: "a quarter",
  3333: "a third",
  3334: "a third",
  5000: "half",
  6666: "two thirds",
  6667: "two thirds",
  7500: "three quarters",
  10_000: "all",
};

// A share in words where it has a plain name, as "a third (33.33%)".
export function share(value: bigint): string {
  const words = FRACTIONS[Number(value)];
  return words ? `${words} (${bps(value)})` : bps(value);
}

export const day = (time: number): string => utcDay.format(time * 1000);
export const date = (time: number): string => utcDate.format(time * 1000);
const at = (time: number, timeZone?: string): string =>
  new Intl.DateTimeFormat(LANG, { ...DAY_AND_TIME, ...(timeZone && { timeZone }) }).format(time * 1000);

// The time in UTC, then in the visitor's own zone when it differs: "Thu 22 Oct, 00:00 UTC (Thu 22 Oct, 02:00 your time)".
export function when(time: number, timeZone?: string): string {
  const utc = at(time, "UTC");
  const local = at(time, timeZone);
  return local === utc ? `${utc} UTC` : `${utc} UTC (${local} your time)`;
}

export function until(seconds: number): string {
  const minutes = Math.max(0, Math.floor(seconds / 60));
  const [days, hours, rest] = [Math.floor(minutes / 1440), Math.floor((minutes % 1440) / 60), minutes % 60];
  if (days) return `${days} d ${hours} h`;
  if (hours) return `${hours} h ${rest} min`;
  return rest ? `${rest} min` : "less than a minute";
}

export const short = (address: string): string => `${address.slice(0, 6)}…${address.slice(-4)}`;
export const list = (items: string[]): string => and.format(items);
// The same list in parts, for one that holds elements.
export const listParts = (items: string[]) => and.formatToParts(items);

export const count = (n: number, one: string, other: string): string =>
  `${whole.format(n)} ${plurals.select(n) === "one" ? one : other}`;

// Controls, and the marks that reorder or hide text, which a name could use to pass for another.
const HIDDEN = /[\p{Cc}\u061c\u200b-\u200f\u202a-\u202e\u2060-\u2069\ufeff]/gu;

export const clean = (text = ""): string => text.replace(/\s+/g, " ").replace(HIDDEN, "").trim();
