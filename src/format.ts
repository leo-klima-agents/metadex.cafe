import type { Currency } from "./config.ts";

export const LANG = "en-GB";
export const WEEK = 604_800;
// Hydrex's epochs start on Thursday at 00:00 UTC, as did the Unix epoch.
export const weekStart = (time: number): number => time - (time % WEEK);

const whole = new Intl.NumberFormat(LANG, { maximumFractionDigits: 0 });
const hundredths = new Intl.NumberFormat(LANG, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const threeDigits = new Intl.NumberFormat(LANG, { maximumSignificantDigits: 3 });
const fourDigits = new Intl.NumberFormat(LANG, { maximumSignificantDigits: 4 });
const percent = new Intl.NumberFormat(LANG, { style: "percent", maximumFractionDigits: 2 });
const roughPercent = new Intl.NumberFormat(LANG, { style: "percent", maximumFractionDigits: 1 });
const plurals = new Intl.PluralRules(LANG);
const and = new Intl.ListFormat(LANG, { type: "conjunction" });
const POINT = hundredths.formatToParts(0.5).find(({ type }) => type === "decimal")!.value;

// Whole tokens of 18 decimals.
export const units = (value: bigint): string => whole.format(value / 10n ** 18n);
// Two decimals, so a receipt's figures line up: "18,686.45", "< 0.01", "0".
export const amount = (value: bigint, decimals: number): string => (value === 0n ? "0" : fixed(value, decimals, 2));
// Four significant figures, or whole from 10,000: "0.000065", "41.2", "1,000,000".
export function figure(value: bigint, decimals: number): string {
  const number = Number(value) / 10 ** decimals;
  return (number >= 10_000 ? whole : fourDigits).format(number);
}
// Votes with an SI prefix, written by hand as browsers disagree: "897k", "1.17M".
export function compact(value: bigint): string {
  const rounded = Number((Number(value / 10n ** 15n) / 1000).toPrecision(3));
  const [scale, suffix] = (
    [
      [1e9, "G"],
      [1e6, "M"],
      [1e3, "k"],
    ] as const
  ).find(([at]) => rounded >= at) ?? [1, ""];
  return `${threeDigits.format(rounded / scale)}${suffix}`;
}
export const voteFigure = (votes: bigint): string => (votes > 0n && votes < 10n ** 18n ? "< 1" : units(votes));
export const voteWords = (votes: bigint): string =>
  `${voteFigure(votes)} ${votes > 0n && votes < 2n * 10n ** 18n ? "vote" : "votes"}`;
export const bps = (value: bigint): string => percent.format(Number(value) / 10_000);
export const fraction = (value: number): string => roughPercent.format(value);

// Rounded half away from zero to `places`, still with `decimals`.
export function rounded(value: bigint, decimals: number, places: number): bigint {
  if (places >= decimals) return value;
  const unit = 10n ** BigInt(decimals - places);
  const [sign, magnitude] = value < 0n ? [-1n, -value] : [1n, value];
  return sign * ((magnitude + unit / 2n) / unit) * unit;
}

// To `places`, without a float, so a column lines up at the point: "63.93", "−0.64", "< 0.01".
export function fixed(value: bigint, decimals: number, places: number): string {
  const [sign, magnitude] = value < 0n ? ["−", -value] : ["", value];
  const scale = 10n ** BigInt(places);
  const shift = (n: bigint) =>
    decimals >= places ? n / 10n ** BigInt(decimals - places) : n * 10n ** BigInt(places - decimals);
  const units = shift(rounded(magnitude, decimals, places));
  const shown = (n: bigint) =>
    `${whole.format(n / scale)}${places ? POINT + String(n % scale).padStart(places, "0") : ""}`;
  if (magnitude > 0n && units === 0n) return `${sign ? ">" : "<"} ${sign}${shown(1n)}`;
  return `${sign}${shown(units)}`;
}

// Money: in dollars, or in USDC when no Chainlink feed answered. Shown in the currency picked, at Chainlink's rate.
export type Unit = "USD" | "USDC";
export type Money = { value: number; unit: Unit };
export type Rates = Partial<Record<Currency, number>>;
let currency: Currency = "USD";
let rates: Rates = {};
export const setCurrency = (picked: Currency): void => void (currency = picked);
export const setRates = (found: Rates): void => void (rates = { ...rates, ...found });

const formats = new Map<string, Intl.NumberFormat>();
function formatOf(shown: Currency | "USDC", digits: number): Intl.NumberFormat {
  if (shown === "USDC") return digits ? hundredths : whole;
  const name = `${shown} ${digits}`;
  if (!formats.has(name))
    formats.set(
      name,
      new Intl.NumberFormat(LANG, {
        style: "currency",
        currency: shown,
        currencyDisplay: shown === "AUD" || shown === "CAD" ? "symbol" : "narrowSymbol",
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
      }),
    );
  return formats.get(name)!;
}
function shownOf({ unit }: Money): [Currency | "USDC", number] {
  const rate = unit === "USD" && currency !== "USD" ? rates[currency] : undefined;
  return rate === undefined ? [unit, 1] : [currency, rate];
}
const toCents = (sum: Money): number => {
  const [, rate] = shownOf(sum);
  return (Math.round((sum.value / rate) * 100) / 100) * rate;
};
// The difference between two sums as each shows to the cent, so a column adds up as it reads.
export const between = (from: Money, to: Money): Money => ({ ...to, value: toCents(to) - toCents(from) });

// "≈ $692", "≈ −€0.69", "< £0.01", "≈ 0.77 USDC"; with `cents`, always to the cent, for columns.
export function money(sum: Money, cents = false): string {
  const [shown, rate] = shownOf(sum);
  const value = sum.value / rate;
  const of = (text: string) => (shown === "USDC" ? `${text} USDC` : text);
  const [sign, magnitude] = value < 0 ? ["−", -value] : ["", value];
  if (value === 0) return of(formatOf(shown, cents ? 2 : 0).format(0));
  if (magnitude < 0.005) return `${sign ? ">" : "<"} ${sign}${of(formatOf(shown, 2).format(0.01))}`;
  return `≈ ${sign}${of(formatOf(shown, magnitude >= 100 && !cents ? 0 : 2).format(magnitude))}`;
}

const utcDay = new Intl.DateTimeFormat(LANG, { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
const utcDate = new Intl.DateTimeFormat(LANG, { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
export const day = (time: number): string => utcDay.format(time * 1000);
export const date = (time: number): string => utcDate.format(time * 1000);
const at = (time: number, timeZone?: string): string =>
  new Intl.DateTimeFormat(LANG, {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    ...(timeZone && { timeZone }),
  }).format(time * 1000);
export const utc = (time: number): string => `${at(time, "UTC")} UTC`;
// "Thu 22 Oct, 00:00 UTC (Thu 22 Oct, 02:00 your time)", the second part only where it differs.
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

export const short = (hex: string): string => `${hex.slice(0, 6)}…${hex.slice(-4)}`;
// Groups of four: an address or a hash on one line; calldata as its selector, then a line per 32-byte word.
export function hexLines(hex: string): string[][] {
  const groups = (digits: string): string[] => digits.match(/.{1,4}/g) ?? [];
  if (hex.length === 42 || hex.length === 66) return [["0x", ...groups(hex.slice(2))]];
  return [[hex.slice(0, 10)], ...(hex.slice(10).match(/.{1,64}/g) ?? []).map(groups)];
}
// As hardware wallets show an address: three lines of four columns, "0x" in the first.
export function walletLines(address: string): string[][] {
  const cells = hexLines(address)[0]!;
  return [cells.slice(0, 4), cells.slice(4, 8), cells.slice(8)];
}

export const list = (items: string[]): string => and.format(items);
export const count = (n: number, one: string, other: string): string =>
  `${whole.format(n)} ${plurals.select(n) === "one" ? one : other}`;
// Without control, invisible or reordering characters, with which a name could pass for another.
export const clean = (text = ""): string =>
  text
    .replace(/\s+/g, " ")
    .replace(/[\p{Cc}\p{Cf}\p{Default_Ignorable_Code_Point}]/gu, "")
    .replace(/ {2,}/g, " ")
    .trim();
