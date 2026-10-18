import { now, readLater, same } from "./chain.ts";
import { CONDUIT, KVCM } from "./config.ts";
import { clone, fill, fillAddress, fillTime, show, showHex, txUrl } from "./dom.ts";
import { tokensOf } from "./earnings.ts";
import { WEEK, amount, bps, list, listWith, usd, utc, weekStart } from "./format.ts";
import type { Holdings } from "./hydrex.ts";
import { pricesAt, usdOf, type Token } from "./prices.ts";
import {
  blockTimes,
  lastRun,
  namesAt,
  totalRetired,
  type Amount,
  type Payout,
  type Run,
  type RunSearch,
} from "./receipts.ts";

// The section "Last payout": a receipt for each of the owner's accounts in Carbon Impact's last run of payouts.

const section = document.getElementById("receipts")!;
const STATES = ["reading", "none", "other", "underway", "failed", "found"] as const;
// A run takes up to half a day, so one whose last payout is more recent may still be under way.
const UNDER_WAY = 12 * 3600;

// The accounts on the page, and those whose receipts were read.
let shown: Holdings | undefined;
let readFor: Holdings | undefined;
// The owner whose payout the section shows, and whether as receipts.
let showing: { owner: string; drawn: boolean } | undefined;
// The last run is the same for every owner, so its search is kept.
let search: Promise<RunSearch> | undefined;
let checked = 0;

function setState(state: (typeof STATES)[number]): void {
  for (const name of STATES) show(`.receipts-${name}`, name === state, section);
}

const tokenOf = (tokens: Map<string, Token>, address: string) => tokens.get(address.toLowerCase());

// Each token by name, or by address and in its smallest units if its decimals are unknown.
function showAmounts(element: Element, found: Amount[], tokens: Map<string, Token>, sign = ""): void {
  if (!found.length) return void element.replaceChildren("0 kVCM");
  const items = found.map(({ token, amount: value }) => {
    const known = tokenOf(tokens, token);
    if (known) return `${amount(value, known.decimals)} ${known.symbol}`;
    const address = document.createElement("code");
    address.translate = false;
    showHex(address, token);
    const unknown = document.createElement("span");
    unknown.append(`${value} base units of `, address);
    return unknown;
  });
  element.replaceChildren(sign, ...listWith<Node | string>(items));
}

function worth(found: Amount[], tokens: Map<string, Token>, prices: Map<string, number> | undefined): string {
  if (!prices) return "";
  const total = found.reduce((sum, { token, amount: value }) => {
    const [known, price] = [tokenOf(tokens, token), prices.get(token.toLowerCase())];
    return known && price !== undefined ? sum + usdOf(value, known.decimals, price) : sum;
  }, 0);
  return total > 0 ? usd(total) : "";
}

const kvcm = (found: Amount[]): bigint => found.find(({ token }) => same(token, KVCM))?.amount ?? 0n;

// The receipt's fields have class names of their own, because fill(document, …) sets Carbon Impact's figures, such as
// .tonnes, all over the page.
function receipt(payout: Payout, time: number, name: string, tokens: Map<string, Token>, prices?: Map<string, number>) {
  const item = clone("receipt");
  // Rewards claimed as kVCM were not swapped. The shares are of all the kVCM: Carbon Impact retires up to its share,
  // and pays out the rest.
  const all = kvcm(payout.paid) + kvcm(payout.fees) + payout.retiredKvcm;
  const swapped = all - kvcm(payout.earned);
  const of = (part: bigint) => (all ? bps((part * 10_000n + all / 2n) / all) : "");
  fill(item, {
    "receipt-id": `#${payout.id}`,
    "receipt-earned-usd": worth(payout.earned, tokens, prices),
    "receipt-swapped": `${amount(swapped > 0n ? swapped : 0n, 18)} kVCM`,
    "receipt-retired-share": of(payout.retiredKvcm),
    "receipt-retired": `${payout.retiredKvcm ? "−" : ""}${amount(payout.retiredKvcm, 18)} kVCM`,
    "receipt-tonnes": `${amount(payout.tonnes, 18)} t of carbon credits`,
    "receipt-entity": name,
    "receipt-fee-share": of(kvcm(payout.fees)),
    "receipt-paid-usd": worth(payout.paid, tokens, prices),
  });
  showAmounts(item.querySelector(".receipt-earned")!, payout.earned, tokens);
  showAmounts(item.querySelector(".receipt-fee")!, payout.fees, tokens, payout.fees.length ? "−" : "");
  showAmounts(item.querySelector(".receipt-paid")!, payout.paid, tokens);
  show(".receipt-carbon, .through", payout.tonnes > 0n, item);
  // The payout is for the epoch that ended at the flip before it.
  fillTime(item, "receipt-from", weekStart(time) - WEEK);
  fillTime(item, "receipt-to", weekStart(time));
  fillTime(item, "receipt-time", time, utc);
  show(".receipt-elsewhere", !same(payout.recipient, payout.owner), item);
  fillAddress(item, "receipt-recipient", payout.recipient);
  item.querySelector<HTMLAnchorElement>(".receipt-tx")!.href = txUrl(payout.tx);
  return item;
}

export function forgetPayout(): void {
  shown = readFor = showing = undefined;
  section.hidden = true;
}

// Shows the last payout to an owner with an account that is in Carbon Impact, or was when this epoch started.
export function showPayout(holdings: Holdings): void {
  shown = holdings;
  void load();
}

// A quiet read keeps what is shown until there is something new: a run that has not reached the owner's accounts yet
// keeps the last receipts, and a failed read keeps everything.
async function load(quietly = false): Promise<void> {
  const holdings = shown;
  if (!holdings || readFor?.owner === holdings.owner) return;
  const member = holdings.accounts.some(({ delegate, claimer, delegateAtStart }) =>
    [delegate, claimer, delegateAtStart].some((address) => same(address, CONDUIT)),
  );
  section.hidden = !member;
  if (!member) return;
  readFor = holdings;
  const owner = holdings.owner.toLowerCase();
  const kept = quietly && showing?.owner === owner;
  if (!kept) setState("reading");
  // False once another owner's accounts, or a newer read, took over.
  const current = () => readFor === holdings && shown?.owner === holdings.owner;
  const fail = (error: unknown) => {
    console.error(error);
    if (!current() || kept) return;
    readFor = undefined;
    setState("failed");
  };
  const settle = (state: "none" | "other" | "underway") => {
    showing = { owner, drawn: false };
    setState(state);
  };
  if (!search) checked = Date.now();
  const searching = (search ??= lastRun());
  let run: Run | undefined;
  try {
    ({ run } = await searching);
  } catch (error) {
    if (search === searching) search = undefined;
    return fail(error);
  }
  if (!current()) return;
  if (!run) return settle("none");
  const underway = now() - run.time < UNDER_WAY;
  const mine = run.payouts.filter((payout) => same(payout.owner, owner));
  if (!mine.length) {
    if (underway && kept && showing?.drawn) {
      fillTime(section, "run-next", run.time);
      show(".receipts-more", false, section);
      show(".receipts-next", true, section);
      return;
    }
    fillTime(section, "run-day", run.time);
    return settle(underway ? "underway" : "other");
  }
  const all = mine.flatMap(({ earned, paid, fees }) => [...earned, ...paid, ...fees]);
  let tokens: Map<string, Token>;
  let times: Map<number, number>;
  let names: Map<number, string>;
  try {
    [tokens, times, names] = await Promise.all([
      tokensOf(
        all.map(({ token }) => token),
        readLater,
      ),
      blockTimes(mine.map(({ block }) => block)),
      namesAt(mine.map(({ block }) => block)),
    ]);
  } catch (error) {
    return fail(error);
  }
  if (!current()) return;
  // A pool must be deep enough for the largest amount of the token that any receipt shows in dollars.
  const amounts = new Map<string, bigint>();
  for (const { token, amount: value } of mine.flatMap(({ earned, paid }) => [...earned, ...paid]))
    if (value > (amounts.get(token.toLowerCase()) ?? 0n)) amounts.set(token.toLowerCase(), value);
  const shelf = section.querySelector(".receipt-list")!;
  const draw = (prices?: Map<string, number>) =>
    shelf.replaceChildren(
      ...mine.map((payout) => receipt(payout, times.get(payout.block)!, names.get(payout.block)!, tokens, prices)),
    );
  draw();
  fill(section, { "receipt-which": list(mine.map(({ id }) => `#${id}`)) });
  fillTime(section, "run-day", run.time);
  fillTime(section, "run-flip", weekStart(run.time));
  show(".receipts-more", underway, section);
  show(".receipts-next", false, section);
  showing = { owner, drawn: true };
  setState("found");
  // Dollars need many more reads, so they come after. Without them, the receipts show tokens only.
  const prices = await pricesAt([...tokens.values()], amounts, weekStart(run.time), now(), readLater).catch((error) => {
    console.error(error);
    return undefined;
  });
  if (prices && current()) draw(prices);
}

// A run goes on for hours, so the page may have read it half done. Every five minutes, if the total retired has grown,
// the search goes on from where it stopped and the receipts are read again. A failed search starts over.
export async function checkPayout(): Promise<void> {
  if (!readFor || Date.now() - checked < 300_000) return;
  checked = Date.now();
  const searching = search;
  let previous: RunSearch | undefined;
  if (searching) {
    try {
      const [done, total] = await Promise.all([searching, totalRetired()]);
      if (total <= done.total || search !== searching) return;
      previous = done;
    } catch (error) {
      return void console.error(error);
    }
  }
  search = lastRun(previous);
  readFor = undefined;
  void load(true);
}

section.querySelector(".receipts-again")!.addEventListener("click", () => void load());
