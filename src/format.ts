import { CURRENCIES, type Currency, type Fiat } from "./config.ts";

const LANG = "en-GB";
export const WEEK = 604_800;
// Hydrex's epochs start on Thursday at 00:00 UTC, as the Unix epoch did, so each starts at a multiple of `WEEK`.
export const weekStart = (time: number): number => time - (time % WEEK);

const number = (options: Intl.NumberFormatOptions) => new Intl.NumberFormat(LANG, options);
const whole = number({ maximumFractionDigits: 0 });
const hundredths = number({ minimumFractionDigits: 2, maximumFractionDigits: 2 });
const percent = number({ style: "percent", maximumFractionDigits: 2 });
const roughPercent = number({ style: "percent", maximumFractionDigits: 1 });
const tenthsPercent = number({ style: "percent", minimumFractionDigits: 1, maximumFractionDigits: 1 });
const threeDigits = number({ maximumSignificantDigits: 3 });
const fourDigits = number({ maximumSignificantDigits: 4 });
const plurals = new Intl.PluralRules(LANG);
const and = new Intl.ListFormat(LANG, { type: "conjunction" });
const POINT = hundredths.formatToParts(0.5).find(({ type }) => type === "decimal")!.value;

export const units = (value: bigint): string => whole.format(value / 10n ** 18n);
// Two decimals, so that a receipt's figures line up: "18,686.45", "< 0.01", "0.00".
export const amount = (value: bigint, decimals: number): string => fixed(value, decimals, 2);
export function figure(value: bigint, decimals: number): string {
  const n = Number(value) / 10 ** decimals;
  return n >= 10_000 ? whole.format(n) : fourDigits.format(n);
}
// Votes, which have 18 decimals, with an SI prefix: "897k", "1.17M".
export function compact(value: bigint): string {
  const n = Number((Number(value / 10n ** 15n) / 1000).toPrecision(3));
  const [scale, suffix] = (
    [
      [1e9, "G"],
      [1e6, "M"],
      [1e3, "k"],
    ] as const
  ).find(([scale]) => n >= scale) ?? [1, ""];
  return `${threeDigits.format(n / scale)}${suffix}`;
}

// `value` rounded half away from zero to `places`, still with `decimals`.
export function rounded(value: bigint, decimals: number, places: number): bigint {
  if (places >= decimals) return value;
  const unit = 10n ** BigInt(decimals - places);
  const [sign, magnitude] = value < 0n ? [-1n, -value] : [1n, value];
  return sign * ((magnitude + unit / 2n) / unit) * unit;
}
// To a set number of places, without floats, so that a column lines up: "63.93", "−0.64", "< 0.01".
export function fixed(value: bigint, decimals: number, places: number): string {
  const [sign, magnitude] = value < 0n ? ["−", -value] : ["", value];
  const scale = 10n ** BigInt(places);
  const over = 10n ** BigInt(Math.max(0, decimals - places));
  const under = 10n ** BigInt(Math.max(0, places - decimals));
  const scaled = (rounded(magnitude, decimals, places) / over) * under;
  const shown = (n: bigint) =>
    `${whole.format(n / scale)}${places ? POINT + String(n % scale).padStart(places, "0") : ""}`;
  if (magnitude > 0n && scaled === 0n) return `${sign ? ">" : "<"} ${sign}${shown(1n)}`;
  return `${sign}${shown(scaled)}`;
}

export const voteFigure = (votes: bigint): string => (votes > 0n && votes < 10n ** 18n ? "< 1" : units(votes));
export const voteWords = (votes: bigint): string =>
  `${voteFigure(votes)} ${votes > 0n && votes < 2n * 10n ** 18n ? "vote" : "votes"}`;
export const bps = (value: bigint): string => percent.format(Number(value) / 10_000);
// For example "16.7%" or "3%". With `column`, always to a tenth, as in a column: "3.0%", "< 0.1%".
export const fraction = (value: number, column = false): string =>
  !column ? roughPercent.format(value) : value > 0 && value < 0.0005 ? "< 0.1%" : tenthsPercent.format(value);

// The unit prices are in: USD, or USDC when no dollar price was found. `rates` gives each currency's price in dollars
// at the prices' time.
type Unit = "USD" | "USDC";
export type Rates = Partial<Record<Fiat, number>>;
export type Basis = { unit: Unit; rates?: Rates | undefined };
// `atLeast` when some of what it sums had no price.
export type Money = Basis & { value: number; atLeast?: true };
export const moneyAt = (value: number, { unit, rates }: Basis, atLeast = false): Money => ({
  value,
  unit,
  rates,
  ...(atLeast && { atLeast: true }),
});

const inCurrency = (currency: Currency, digits: number) =>
  number({
    style: "currency",
    currency,
    currencyDisplay: currency === "AUD" || currency === "CAD" ? "symbol" : "narrowSymbol",
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
const FORMATS: Record<string, [Intl.NumberFormat, Intl.NumberFormat]> = {
  USDC: [hundredths, whole],
  ...Object.fromEntries(CURRENCIES.map((c) => [c, [inCurrency(c, 2), inCurrency(c, 0)]])),
};

// The currency picked for this visit. A sum shows in it at the rate from its prices' time, or in its own unit when
// there is no such rate.
let picked: Currency = "USD";
export const setCurrency = (currency: Currency): void => void (picked = currency);
function shownOf({ unit, rates }: Basis): [string, number] {
  const rate = picked === "USD" || unit !== "USD" ? undefined : rates?.[picked];
  return rate === undefined ? [unit, 1] : [picked, rate];
}
const toCents = (sum: Money): number => {
  const [, rate] = shownOf(sum);
  return (Math.round((sum.value / rate) * 100) / 100) * rate;
};
// The difference between two sums as each is shown, rounded to the cent, so that a column adds up as it reads.
export const between = (from: Money, to: Money): Money => ({ ...to, value: toCents(to) - toCents(from) });

// For example "$692", "−€0.69", "< £0.01", "0.77 USDC" or "At least $3.10". With `cents`, always to the cent,
// as in a column.
export const money = (sum: Money, cents = false): string =>
  `${sum.atLeast ? "At\u00a0least\u00a0" : ""}${figureOf(sum, cents)}`;
function figureOf(sum: Money, cents: boolean): string {
  const [shown, rate] = shownOf(sum);
  const value = sum.value / rate;
  const [withCents, without] = FORMATS[shown]!;
  const of = (text: string) => (shown === "USDC" ? `${text} USDC` : text);
  const [sign, magnitude] = value < 0 ? ["−", -value] : ["", value];
  if (value === 0) return of((cents ? withCents : without).format(0));
  if (magnitude < 0.005) return `${sign ? ">" : "<"} ${sign}${of(withCents.format(0.01))}`;
  return `${sign}${of((magnitude >= 100 && !cents ? without : withCents).format(magnitude))}`;
}

const dateFormat = (options: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat(LANG, { timeZone: "UTC", ...options });
const utcDay = dateFormat({ weekday: "short", day: "numeric", month: "short" });
const utcDate = dateFormat({ day: "numeric", month: "short", year: "numeric" });
const utcTime = dateFormat({
  weekday: "short",
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});
export const day = (time: number): string => utcDay.format(time * 1000);
export const date = (time: number): string => utcDate.format(time * 1000);
export const utc = (time: number): string => `${utcTime.format(time * 1000)} UTC`;
export function until(seconds: number): string {
  const minutes = Math.max(0, Math.floor(seconds / 60));
  const [days, hours, rest] = [Math.floor(minutes / 1440), Math.floor((minutes % 1440) / 60), minutes % 60];
  if (days) return `${days} d ${hours} h`;
  if (hours) return `${hours} h ${rest} min`;
  return rest ? `${rest} min` : "less than a minute";
}

export const short = (hex: string): string => `${hex.slice(0, 6)}…${hex.slice(-4)}`;
// Hex in groups of four digits. An address or a hash fits on one line; calldata shows its selector, then one line per
// 32-byte word.
export function hexLines(hex: string): string[][] {
  const groups = (digits: string): string[] => digits.match(/.{1,4}/g) ?? [];
  if (hex.length === 42 || hex.length === 66) return [["0x", ...groups(hex.slice(2))]];
  return [[hex.slice(0, 10)], ...(hex.slice(10).match(/.{1,64}/g) ?? []).map(groups)];
}
// An address as hardware wallets show it: three lines of four columns, "0x" in the first.
export function walletLines(address: string): string[][] {
  const cells = hexLines(address)[0]!;
  return [cells.slice(0, 4), cells.slice(4, 8), cells.slice(8)];
}

export const listWords = (items: string[]): string => and.format(items);
// The items with the words between them: [a, ", ", b, " and ", c].
export const listWith = <T>(items: T[]): (T | string)[] =>
  and
    .formatToParts(items.map((_, i) => String(i)))
    .map(({ type, value }) => (type === "element" ? items[Number(value)]! : value));
export const count = (n: number, one: string, other: string): string =>
  `${whole.format(n)} ${plurals.select(n) === "one" ? one : other}`;
// Strips invisible and text-reordering characters, which a name could use to pass for another.
export const clean = (text = ""): string =>
  text
    .replace(/\s+/g, " ")
    .replace(/[\p{Cc}\p{Cf}\p{Default_Ignorable_Code_Point}]/gu, "")
    .replace(/ {2,}/g, " ")
    .trim();
