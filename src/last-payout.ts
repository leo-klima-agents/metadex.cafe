import type { Address, Hex } from "viem";
import { blockTime, now, readLater, required, rpc, same } from "./chain.ts";
import { CONDUIT, KVCM } from "./config.ts";
import { clone, fill, fillAddress, fillTime, show, showHex, txUrl } from "./dom.ts";
import { tokensOf, type Earnings } from "./earnings.ts";
import { WEEK, amount, bps, list, listWith, usd, utc, weekStart } from "./format.ts";
import { escrow, type Account, type Holdings } from "./hydrex.ts";
import { lastEarnings } from "./last-epoch.ts";
import { pricesAt, type Token } from "./prices.ts";
import {
  SETTLED,
  blockTimes,
  dollars,
  isLate,
  namesAt,
  payoutBlocks,
  payoutsIn,
  readStandings,
  type Amount,
  type Payout,
  type Standing,
} from "./receipts.ts";

// The section "Payouts": for each of the owner's accounts in Carbon Impact, up to when it has been paid and what waits
// to be claimed, then the receipt of its last payout.

const section = document.getElementById("receipts")!;
const STATES = ["reading", "failed", "found"] as const;
// A payout takes up to half a day after each flip.
const UNDER_WAY = 12 * 3600;

type Entry = {
  account: Account;
  standing: Standing;
  // Whether it voted with Carbon Impact last epoch, so that the payout after this epoch's flip is due to it.
  due: boolean;
  late: boolean;
  // The block and time of its last payout, and Carbon Impact's receipt for it, unless it was claimed elsewhere.
  block?: number;
  time?: number;
  payout?: Payout;
};
type Found = { epochStart: number; earnings: Earnings; entries: Entry[] };

// The accounts on the page, and those whose payouts were read, by owner, epoch and accounts.
let shown: Holdings | undefined;
let readFor: string | undefined;
// The owner whose payouts the section shows.
let showing: string | undefined;
let checked = 0;
// Each receipt drawn, by account and block, with whether it shows dollars yet.
const drawn = new Map<string, { node: HTMLElement; priced: boolean }>();

const setState = (state: (typeof STATES)[number]): void => {
  for (const name of STATES) show(`.receipts-${name}`, name === state, section);
};

const inCarbonImpact = ({ delegate, claimer, delegateAtStart }: Account): boolean =>
  [delegate, claimer, delegateAtStart].some((address) => same(address, CONDUIT));

const keyOf = (holdings: Holdings): string =>
  [
    holdings.owner.toLowerCase(),
    holdings.epochStart,
    ...holdings.accounts.filter(inCarbonImpact).map(({ id }) => id),
  ].join(" ");

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
  const total = prices ? dollars(found, tokens, prices) : 0;
  return total > 0 ? usd(total) : "";
}

const kvcm = (found: Amount[]): bigint => found.find(({ token }) => same(token, KVCM))?.amount ?? 0n;

// The receipt's fields have class names of their own, because fill(document, …) sets Carbon Impact's figures, such as
// .tonnes, all over the page.
function fillReceipt(
  item: HTMLElement,
  payout: Payout,
  time: number,
  name: string,
  tokens: Map<string, Token>,
  prices?: Map<string, number>,
): void {
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
}

function standingItem({ account, standing, late, payout, time }: Entry, found: Found, receipt?: HTMLElement) {
  const item = clone("standing");
  const { earnings, epochStart } = found;
  const { through, waiting } = standing;
  const tokens = new Map(earnings.rewards.map(({ token }) => [token.address.toLowerCase(), token]));
  const value = dollars(waiting, tokens, earnings.prices);
  fill(item, {
    "standing-name": account.name || "Account",
    "standing-id": `#${account.id}`,
    "standing-waiting": value > 0 ? `${usd(value)} waits to be claimed` : "Nothing waits to be claimed",
  });
  if (through) fillTime(item, "standing-through", through);
  fillTime(item, "late-from", epochStart - 2 * WEEK);
  fillTime(item, "late-to", epochStart - WEEK);
  show(".standing-paid", !late && through > 0, item);
  show(".standing-never", !late && !through, item);
  show(".standing-late", late, item);
  show(".late-through", through > 0, item);
  show(".late-never", !through, item);
  const outside = time !== undefined && !payout;
  if (outside) fillTime(item, "outside-day", time);
  show(".standing-outside", outside, item);
  if (receipt) item.querySelector(".standing")!.append(receipt);
  return item;
}

// The accounts paid since the flip, and those still due, while the first of them was paid less than half a day ago.
function underWay({ entries, epochStart }: Found): { paid: Entry[]; left: Entry[]; first: number } | undefined {
  const paid = entries.filter(({ due, standing, time }) => due && standing.through >= epochStart && time !== undefined);
  const left = entries.filter(({ due, standing }) => due && standing.through < epochStart);
  const first = Math.min(...paid.map(({ time }) => time!));
  return paid.length && left.length && now() - first < UNDER_WAY ? { paid, left, first } : undefined;
}

// About 25 reads to find each block of payouts, then one read of logs per block.
async function readPayouts(holdings: Holdings, members: Account[]): Promise<Found> {
  const earnings = await lastEarnings();
  const pairs = earnings.rewards.map(({ contract, token }) => ({ contract, token: token.address }));
  if (!pairs.length) throw new Error("Carbon Impact's votes earned nothing last epoch: no reward contract to read.");
  const { epochStart } = holdings;
  const ids = members.map(({ id }) => id);
  const top = Number(await rpc<Hex>("eth_blockNumber", [], { later: true })) - SETTLED;
  const [[time, ...delegates], standings] = await Promise.all([
    readLater(
      [
        blockTime,
        ...ids.flatMap((id) => [epochStart - WEEK, epochStart - 2 * WEEK].map((t) => escrow("delegates", id, t))),
      ],
      top,
    ),
    readStandings(ids, pairs, top),
  ]);
  const blocks = await payoutBlocks(standings, top, Number(required([time])[0]));
  const [paid, times] = await Promise.all([payoutsIn([...blocks.values()]), blockTimes([...blocks.values()])]);
  const entries = members.map((account, i): Entry => {
    const standing = standings[i]!;
    const [last, before] = delegates.slice(2 * i, 2 * i + 2) as (Address | undefined)[];
    const block = blocks.get(account.id);
    const payout = paid.filter(({ id, block: at }) => id === account.id && at === block).at(-1);
    return {
      account,
      standing,
      due: same(String(last), CONDUIT),
      late: isLate(standing.through, same(String(before), CONDUIT), epochStart),
      ...(block !== undefined && { block, time: times.get(block)! }),
      ...(payout && { payout }),
    };
  });
  return { epochStart, earnings, entries };
}

export function forgetPayout(): void {
  shown = readFor = showing = undefined;
  section.hidden = true;
}

// Shows the payouts of an owner with an account that is in Carbon Impact, or was when this epoch started.
export function showPayout(holdings: Holdings): void {
  shown = holdings;
  void load(true);
}

// A quiet read keeps what is shown until there is something new, and a failed one keeps everything.
async function load(quietly = false): Promise<void> {
  const holdings = shown;
  if (!holdings) return;
  const key = keyOf(holdings);
  if (quietly && readFor === key) return;
  const members = holdings.accounts.filter(inCarbonImpact);
  section.hidden = !members.length;
  if (!members.length) return;
  readFor = key;
  checked = Date.now();
  const owner = holdings.owner.toLowerCase();
  const kept = quietly && showing === owner;
  if (!kept) setState("reading");
  // False once another owner's accounts, or a newer read, took over.
  const current = () => readFor === key && !!shown && keyOf(shown) === key;
  const fail = (error: unknown) => {
    console.error(error);
    if (!current() || kept) return;
    readFor = undefined;
    setState("failed");
  };
  let found: Found;
  let tokens: Map<string, Token>;
  let names: Map<number, string>;
  try {
    found = await readPayouts(holdings, members);
    const payouts = found.entries.flatMap(({ payout }) => (payout ? [payout] : []));
    [tokens, names] = await Promise.all([
      tokensOf(
        payouts.flatMap(({ earned, paid, fees }) => [...earned, ...paid, ...fees].map(({ token }) => token)),
        readLater,
      ),
      namesAt(payouts.map(({ block }) => block)),
    ]);
  } catch (error) {
    return fail(error);
  }
  if (!current()) return;
  const receipts = new Map<Entry, HTMLElement>();
  for (const entry of found.entries) {
    const { payout, time } = entry;
    if (!payout || time === undefined) continue;
    const key = `${payout.id} ${payout.block}`;
    let receipt = drawn.get(key);
    if (!receipt) {
      receipt = { node: clone("receipt").firstElementChild as HTMLElement, priced: false };
      fillReceipt(receipt.node, payout, time, names.get(payout.block)!, tokens);
      drawn.set(key, receipt);
    }
    receipts.set(entry, receipt.node);
  }
  section
    .querySelector(".standings")!
    .replaceChildren(...found.entries.map((entry) => standingItem(entry, found, receipts.get(entry))));
  const under = underWay(found);
  if (under) {
    fill(section, {
      "underway-paid": list(under.paid.map(({ account }) => `#${account.id}`)),
      "underway-left": list(under.left.map(({ account }) => `#${account.id}`)),
    });
    fillTime(section, "underway-day", under.first);
  }
  show(".receipts-underway", !!under, section);
  showing = owner;
  setState("found");
  // Dollars need many more reads, so they come after, at the prices of the flip before each payout. Without them, the
  // receipts show tokens only.
  const unpriced = found.entries.filter(({ payout }) => payout && !drawn.get(`${payout.id} ${payout.block}`)!.priced);
  for (const flip of new Set(unpriced.map(({ time }) => weekStart(time!)))) {
    const these = unpriced.filter(({ time }) => weekStart(time!) === flip);
    // A pool must be deep enough for the largest amount of the token that any receipt shows in dollars.
    const amounts = new Map<string, bigint>();
    for (const { token, amount: value } of these.flatMap(({ payout }) => [...payout!.earned, ...payout!.paid]))
      if (value > (amounts.get(token.toLowerCase()) ?? 0n)) amounts.set(token.toLowerCase(), value);
    const prices = await pricesAt([...tokens.values()], amounts, flip, now(), readLater).catch((error) => {
      console.error(error);
      return undefined;
    });
    if (!prices) continue;
    for (const { payout, time } of these) {
      const receipt = drawn.get(`${payout!.id} ${payout!.block}`)!;
      fillReceipt(receipt.node, payout!, time!, names.get(payout!.block)!, tokens, prices);
      receipt.priced = true;
    }
  }
}

// A payout goes on for hours, so the page may have read it half done. Every five minutes, the accounts' standings are
// read again, and the payouts of any account paid since.
export function checkPayout(): void {
  if (!readFor || Date.now() - checked < 300_000) return;
  readFor = undefined;
  void load(true);
}

section.querySelector(".receipts-again")!.addEventListener("click", () => void load());
