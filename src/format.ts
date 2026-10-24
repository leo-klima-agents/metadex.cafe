export const LANG = "en-GB";
export const WEEK = 604_800;

// Hydrex's epochs start on Thursday at 00:00 UTC. So did the Unix epoch, so every epoch starts at a multiple of WEEK.
export const weekStart = (time: number): number => time - (time % WEEK);

const whole = new Intl.NumberFormat(LANG, { maximumFractionDigits: 0 });
const percent = new Intl.NumberFormat(LANG, { style: "percent", maximumFractionDigits: 2 });
const roughPercent = new Intl.NumberFormat(LANG, { style: "percent", maximumFractionDigits: 1 });
const hundredths = new Intl.NumberFormat(LANG, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const threeDigits = new Intl.NumberFormat(LANG, { maximumSignificantDigits: 3 });
const utcDay = new Intl.DateTimeFormat(LANG, { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
const utcDate = new Intl.DateTimeFormat(LANG, { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const DAY_AND_TIME: Intl.DateTimeFormatOptions = {
  weekday: "short",
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
};
const plurals = new Intl.PluralRules(LANG);
const and = new Intl.ListFormat(LANG, { type: "conjunction" });

// A whole number of tokens with 18 decimals.
export const units = (value: bigint): string => whole.format(value / 10n ** 18n);

// Two decimals, so that the figures on a receipt line up: "18,686.45", "1.50", "< 0.01", "0".
export const amount = (value: bigint, decimals: number): string => (value === 0n ? "0" : fixed(value, decimals, 2));

const SCALES: [number, string][] = [
  [1e9, "G"],
  [1e6, "M"],
  [1e3, "k"],
];

// Votes with 18 decimals, with an SI prefix: "897k", "1.17M". Browsers' own compact notation differs between versions
// ("897K", "1.17m"), so the page writes it itself.
export function compact(value: bigint): string {
  const rounded = Number((Number(value / 10n ** 15n) / 1000).toPrecision(3));
  const [scale, suffix] = SCALES.find(([scale]) => rounded >= scale) ?? [1, ""];
  return `${threeDigits.format(rounded / scale)}${suffix}`;
}

// The currencies the visitor can pick, by the share of the world's currency trading, for the visit: dollars, or another
// where the prices' time has its rate. Chainlink publishes each rate on Base.
export const CURRENCIES = ["USD", "EUR", "GBP", "CHF", "AUD", "CAD"] as const;
export type Currency = (typeof CURRENCIES)[number];
export type Fiat = Exclude<Currency, "USD">;
// What prices are in: dollars, or USDC when no dollar price could be found for the time.
export type Unit = "USD" | "USDC";
// Each currency's price in dollars at the prices' time, as Chainlink's GBP / USD gives it, if found: a sum in dollars is
// divided by it to show it in that currency.
export type Rates = Partial<Record<Fiat, number>>;
// What prices are in, and the rates at their time.
export type Basis = { unit: Unit; rates?: Rates | undefined };
// A sum at some prices.
export type Money = Basis & { value: number };
export const moneyAt = (value: number, { unit, rates }: Basis): Money => ({ value, unit, rates });

// Each currency's sign, as the page writes it: "A$" and "CA$" apart from the dollar's "$".
const inCurrency = (currency: Currency, digits: number) =>
  new Intl.NumberFormat(LANG, {
    style: "currency",
    currency,
    currencyDisplay: currency === "AUD" || currency === "CAD" ? "symbol" : "narrowSymbol",
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
const formats = Object.fromEntries([
  ...CURRENCIES.map((currency) => [currency, [inCurrency(currency, 2), inCurrency(currency, 0)]] as const),
  ["USDC", [hundredths, whole]] as const,
]) as Record<Currency | "USDC", readonly [Intl.NumberFormat, Intl.NumberFormat]>;

let shownIn: Currency = "USD";
const changes: (() => void)[] = [];
export const currency = (): Currency => shownIn;
// Called once the currency picked changes, to draw again what shows money.
export const onCurrency = (listener: () => void): void => void changes.push(listener);
export function setCurrency(picked: Currency): void {
  if (picked === shownIn) return;
  shownIn = picked;
  changes.forEach((listener) => listener());
}

// What a sum shows in: the currency picked, at the rate of the prices' own time; without one, what the prices are in.
function shownOf({ unit, rates }: Basis): [Currency | Unit, number] {
  const rate = shownIn === "USD" || unit !== "USD" ? undefined : rates?.[shownIn];
  return rate === undefined ? [unit, 1] : [shownIn, rate];
}

// A sum as it shows to the cent, in what it shows in.
function toCents(sum: Money): number {
  const [, rate] = shownOf(sum);
  return (Math.round((sum.value / rate) * 100) / 100) * rate;
}

// What lies between two sums as each shows to the cent, so that a column of them adds up as it reads: what is taken
// from `from` to leave `to`, negative.
export const between = (from: Money, to: Money): Money => ({ ...to, value: toCents(to) - toCents(from) });

// Prices are approximate, so what they value is too: "≈ $692", "≈ −€0.69", "< £0.01", or in USDC, "≈ 0.77 USDC". In the
// currency picked at the rate of the prices' own time; without one, in what the prices are in. With `cents`, as in a
// column, always to the cent, so that the column lines up at the point: "≈ $692.40". The minus sign goes with the
// number, and no-break spaces keep the sign and the unit with it.
export function money(sum: Money, { cents = false }: { cents?: boolean } = {}): string {
  const [shown, rate] = shownOf(sum);
  const amount = sum.value / rate;
  const [withCents, without] = formats[shown];
  const of = (formatted: string) => (shown === "USDC" ? `${formatted}\u00a0USDC` : formatted);
  const [sign, magnitude] = amount < 0 ? ["−", -amount] : ["", amount];
  if (amount === 0) return of((cents ? withCents : without).format(0));
  if (magnitude < 0.005) return `${sign ? ">" : "<"}\u00a0${sign}${of(withCents.format(0.01))}`;
  return `≈\u00a0${sign}${of((magnitude >= 100 && !cents ? without : withCents).format(magnitude))}`;
}

const POINT = hundredths.formatToParts(0.5).find(({ type }) => type === "decimal")!.value;

// An amount of a token with `decimals`, rounded to `places`, half away from zero, still with `decimals`: as fixed() shows
// it, so that what lies between two amounts as they show can be shown too.
export function rounded(value: bigint, decimals: number, places: number): bigint {
  if (places >= decimals) return value;
  const unit = 10n ** BigInt(decimals - places);
  const [sign, magnitude] = value < 0n ? [-1n, -value] : [1n, value];
  return sign * ((magnitude + unit / 2n) / unit) * unit;
}

// An amount of a token to a set number of decimal places, so that a column of them lines up at the point: "63.93",
// "−0.64", "< 0.01". Without passing through a float, so that it rounds as it should, and keeps every digit.
export function fixed(value: bigint, decimals: number, places: number): string {
  const [sign, magnitude] = value < 0n ? ["−", -value] : ["", value];
  const scale = 10n ** BigInt(places);
  const [over, under] = [10n ** BigInt(Math.max(0, decimals - places)), 10n ** BigInt(Math.max(0, places - decimals))];
  const units = (rounded(magnitude, decimals, places) / over) * under;
  const shown = (units: bigint) =>
    `${whole.format(units / scale)}${places ? POINT + String(units % scale).padStart(places, "0") : ""}`;
  if (magnitude > 0n && units === 0n) return `${sign ? ">" : "<"}\u00a0${sign}${shown(1n)}`;
  return `${sign}${shown(units)}`;
}

// Hydrex shows Earning Power as 1.3 times the votes.
export const toEarningPower = (votes: bigint): bigint => (votes * 13n) / 10n;

export function earningPower(votes: bigint): string {
  const power = toEarningPower(votes);
  return power > 0n && power < 10n ** 18n ? "< 1" : units(power);
}

export const bps = (value: bigint): string => percent.format(Number(value) / 10_000);
export const fraction = (value: number): string => roughPercent.format(value);

export const day = (time: number): string => utcDay.format(time * 1000);
export const date = (time: number): string => utcDate.format(time * 1000);

const at = (time: number, timeZone?: string): string =>
  new Intl.DateTimeFormat(LANG, { ...DAY_AND_TIME, ...(timeZone && { timeZone }) }).format(time * 1000);

export const utc = (time: number): string => `${at(time, "UTC")} UTC`;

// UTC, then the visitor's own time if it differs: "Thu 22 Oct, 00:00 UTC (Thu 22 Oct, 02:00 your time)".
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

// Hex in groups of four. An address or a hash is one line; calldata is its selector, then a line per 32-byte word.
export function hexLines(hex: string): string[][] {
  const groups = (digits: string): string[] => digits.match(/.{1,4}/g) ?? [];
  if (hex.length === 42 || hex.length === 66) return [["0x", ...groups(hex.slice(2))]];
  return [[hex.slice(0, 10)], ...(hex.slice(10).match(/.{1,64}/g) ?? []).map(groups)];
}

// An address as hardware wallets show it, on three lines of four columns, the "0x" in the first column:
//   0x 0000 0000 0000
// 0000 0000 0000 0000
// 0000 0000 0000
export function walletLines(address: string): string[][] {
  const cells = hexLines(address)[0]!;
  return [cells.slice(0, 4), cells.slice(4, 8), cells.slice(8)];
}

export const list = (items: string[]): string => and.format(items);

// The items with the words between them, as list() would join them: [a, ", ", b, " and ", c].
export const listWith = <T>(items: T[]): (T | string)[] =>
  and
    .formatToParts(items.map((_, i) => String(i)))
    .map(({ type, value }) => (type === "element" ? items[Number(value)]! : value));

export const count = (n: number, one: string, other: string): string =>
  `${whole.format(n)} ${plurals.select(n) === "one" ? one : other}`;

// Control characters, and characters that are invisible or reorder text, which a name could use to pass for another.
const HIDDEN = /[\p{Cc}\p{Cf}\p{Default_Ignorable_Code_Point}]/gu;

export const clean = (text = ""): string => text.replace(/\s+/g, " ").replace(HIDDEN, "").replace(/ {2,}/g, " ").trim();

const fourDigits = new Intl.NumberFormat(LANG, { maximumSignificantDigits: 4 });

// An amount of a token, to four significant figures, or whole from 10,000: "0.000065", "41.2", "1,000,000".
export function figure(value: bigint, decimals: number): string {
  const number = Number(value) / 10 ** decimals;
  return number >= 10_000 ? whole.format(number) : fourDigits.format(number);
}
