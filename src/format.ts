export const LANG = "en-GB";
export const WEEK = 604_800;

// The Unix epoch began on a Thursday at 00:00 UTC, as Hydrex's epochs do.
export const weekStart = (time: number): number => time - (time % WEEK);

const whole = new Intl.NumberFormat(LANG, { maximumFractionDigits: 0 });
const percent = new Intl.NumberFormat(LANG, { style: "percent", maximumFractionDigits: 2 });
const roughPercent = new Intl.NumberFormat(LANG, { style: "percent", maximumFractionDigits: 1 });
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

const hundredths = new Intl.NumberFormat(LANG, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
// A token's amount, from its decimals, with two decimals so that a receipt's figures line up: "18,686.45", "1.50",
// "< 0.01", "0".
export function amount(value: bigint, decimals: number): string {
  const number = Number(value) / 10 ** decimals;
  if (number === 0) return "0";
  return number < 0.005 ? "< 0.01" : hundredths.format(number);
}

const threeDigits = new Intl.NumberFormat(LANG, { maximumSignificantDigits: 3 });
const SCALES: [number, string][] = [
  [1e9, "G"],
  [1e6, "M"],
  [1e3, "k"],
];
// Large numbers of votes, with 18 decimals, with SI prefixes: "897k", "1.17M". Browsers' own compact notation changes
// with their locale data, as "897K" in older ones and "1.17m" in newer ones, so the page writes it the same in all.
export function compact(value: bigint): string {
  const rounded = Number((Number(value / 10n ** 15n) / 1000).toPrecision(3));
  const [scale, suffix] = SCALES.find(([scale]) => rounded >= scale) ?? [1, ""];
  return `${threeDigits.format(rounded / scale)}${suffix}`;
}

const dollars = (digits: number) =>
  new Intl.NumberFormat(LANG, {
    style: "currency",
    currency: "USD",
    currencyDisplay: "narrowSymbol",
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
const [cents, noCents] = [dollars(2), dollars(0)];
// Approximate dollars, from prices that are themselves approximate: "≈ $692", "≈ $0.77", "< $0.01", with no break
// after the sign.
export function usd(value: number): string {
  if (value === 0) return noCents.format(0);
  if (value > 0 && value < 0.005) return `<\u00a0${cents.format(0.01)}`;
  return `≈\u00a0${(Math.abs(value) >= 100 ? noCents : cents).format(value)}`;
}

// Hydrex shows votes × 1.3 as Earning Power.
export function earningPower(votes: bigint): string {
  const power = (votes * 13n) / 10n;
  return power > 0n && power < 10n ** 18n ? "< 1" : units(power);
}

export const bps = (value: bigint): string => percent.format(Number(value) / 10_000);
export const fraction = (value: number): string => roughPercent.format(value);

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

// The time in UTC: "Wed 14 Oct, 23:59 UTC".
export const utc = (time: number): string => `${at(time, "UTC")} UTC`;

// The time in UTC, then in the visitor's own zone when it differs: "Thu 22 Oct, 00:00 UTC (Thu 22 Oct, 02:00 your time)".
export function when(time: number, timeZone?: string): string {
  const local = at(time, timeZone);
  return local === at(time, "UTC") ? utc(time) : `${utc(time)} (${local} your time)`;
}

export function until(seconds: number): string {
  const minutes = Math.max(0, Math.floor(seconds / 60));
  const [days, hours, rest] = [Math.floor(minutes / 1440), Math.floor((minutes % 1440) / 60), minutes % 60];
  if (days) return `${days} d ${hours} h`;
  if (hours) return `${hours} h ${rest} min`;
  return rest ? `${rest} min` : "less than a minute";
}

export const short = (address: string): string => `${address.slice(0, 6)}…${address.slice(-4)}`;

// Hex in groups of four, as people compare it: "0xdE91", "885c", … An address or a hash is one line of groups; calldata
// is its selector, then a line for each 32-byte word.
export function hexLines(hex: string): string[][] {
  const groups = (digits: string): string[] => digits.match(/.{1,4}/g) ?? [];
  if (hex.length === 42 || hex.length === 66) {
    const [first = "", ...rest] = groups(hex.slice(2));
    return [[`0x${first}`, ...rest]];
  }
  return [[hex.slice(0, 10)], ...(hex.slice(10).match(/.{1,64}/g) ?? []).map(groups)];
}

export const list = (items: string[]): string => and.format(items);
// The items of a list with the words between them, as list() writes them: [a, ", ", b, " and ", c].
export const listWith = <T>(items: T[]): (T | string)[] =>
  and
    .formatToParts(items.map((_, i) => String(i)))
    .map(({ type, value }) => (type === "element" ? items[Number(value)]! : value));

export const count = (n: number, one: string, other: string): string =>
  `${whole.format(n)} ${plurals.select(n) === "one" ? one : other}`;

// Controls, and the marks that reorder or hide text, which a name could use to pass for another.
const HIDDEN = /[\p{Cc}\u061c\u200b-\u200f\u202a-\u202e\u2060-\u2069\ufeff]/gu;

export const clean = (text = ""): string => text.replace(/\s+/g, " ").replace(HIDDEN, "").trim();
