export const LANG = "en-GB";
export const WEEK = 604_800;

// The Unix epoch began on a Thursday at 00:00 UTC, as Hydrex's epochs do.
export const weekStart = (time: number): number => time - (time % WEEK);

const whole = new Intl.NumberFormat(LANG, { maximumFractionDigits: 0 });
const percent = new Intl.NumberFormat(LANG, { style: "percent", maximumFractionDigits: 2 });
const utcDay = new Intl.DateTimeFormat(LANG, { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
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
export const day = (time: number): string => utcDay.format(time * 1000);
export const date = (time: number): string => utcDate.format(time * 1000);
export const short = (address: string): string => `${address.slice(0, 6)}…${address.slice(-4)}`;
export const list = (items: string[]): string => and.format(items);

export const count = (n: number, one: string, other: string): string =>
  `${whole.format(n)} ${plurals.select(n) === "one" ? one : other}`;

// Controls, and the marks that reorder or hide text, which a name could use to pass for another.
const HIDDEN = /[\p{Cc}\u061c\u200b-\u200f\u202a-\u202e\u2060-\u2069\ufeff]/gu;

export const clean = (text = ""): string => text.replace(/\s+/g, " ").replace(HIDDEN, "").trim();
