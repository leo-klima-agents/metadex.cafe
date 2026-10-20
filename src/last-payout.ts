import type { Address, Hex } from "viem";
import { blockTime, now, readLater, required, rpc, same } from "./chain.ts";
import { lastClaimBlocks, readClaimsAt, totals, walkClaims, WALK_LIMIT, type Walk } from "./claims.ts";
import {
  AUTOMATIONS,
  AUTOMAXI,
  AUTOMAXI_FEE_BPS,
  CARBON_IMPACT,
  KEEPER,
  KVCM,
  type Automation,
  type Kind,
} from "./config.ts";
import { clone, fill, fillAddress, fillTime, show, showHex, txUrl } from "./dom.ts";
import { rewardPairs, tokensOf, type Earnings } from "./earnings.ts";
import { WEEK, amount, bps, list, listWith, short, usd, utc, weekStart } from "./format.ts";
import { escrow, type Account, type Holdings } from "./hydrex.ts";
import { lastEarnings } from "./last-epoch.ts";
import { pricesAt, type Token } from "./prices.ts";
import {
  BLOCK_TIME,
  SETTLED,
  blockTimes,
  dollars,
  isLate,
  namesAt,
  paidThrough,
  payoutBlocks,
  payoutsIn,
  readStandings,
  type Amount,
  type Payout,
  type Standing,
} from "./receipts.ts";

// The section "Payouts": for each of the owner's accounts in the page's automations, up to when it has been paid and
// what waits to be claimed, then the receipt of its last payout.

const section = document.getElementById("receipts")!;
const STATES = ["reading", "failed", "found"] as const;
// A payout takes up to half a day after each flip.
const UNDER_WAY = 12 * 3600;

// What an automation's own reader finds for an account.
type Part = {
  // Unless the automation has no record of rewards in last epoch or the one before.
  standing?: Standing;
  // The block and time of its last payout, if any.
  block?: number;
  time?: number;
  // Carbon Impact's receipt, unless it was claimed elsewhere; AutoMaxi's claims in the epoch of its last one.
  payout?: Payout;
  walk?: Walk;
  // Why there is no receipt: its last claim was made outside the automation, or nothing was claimed through it yet.
  note?: "outside" | "unclaimed";
};
type Entry = Part & {
  automation: Automation;
  account: Account;
  // Unless its automation's payouts could not be read.
  earnings?: Earnings;
  // Whether it voted with the automation last epoch, so that the payout after this epoch's flip is due to it.
  due: boolean;
  late: boolean;
};
type Found = { epochStart: number; entries: Entry[] };
// A receipt drawn, which is drawn again once prices are read.
type Drawn = {
  node: HTMLElement;
  priced: boolean;
  flip: number;
  amounts: Amount[];
  draw(prices?: Map<string, number>): void;
};

// The accounts on the page, and the accounts whose payouts were read.
let shown: Holdings | undefined;
let readFor: string | undefined;
// The owner whose payouts the section shows.
let showing: string | undefined;
let checked = 0;
// Whether a payout due since the flip has not reached every account yet, or some payouts could not be read.
let awaited = false;
// Each receipt drawn, by what it shows.
const drawn = new Map<string, Drawn>();

const setState = (state: (typeof STATES)[number]): void => {
  for (const name of STATES) show(`.receipts-${name}`, name === state, section);
};

// The automation an account is in or joining, or else the one it is leaving.
const automationOf = ({ delegate, claimer, delegateAtStart }: Account): Automation | undefined =>
  AUTOMATIONS.find(({ address }) => same(delegate, address) || same(claimer, address)) ??
  AUTOMATIONS.find(({ address }) => same(delegateAtStart, address));

const keyOf = (holdings: Holdings): string =>
  [
    holdings.owner.toLowerCase(),
    holdings.epochStart,
    ...holdings.accounts.flatMap((account) => {
      const automation = automationOf(account);
      return automation ? [`${account.id}:${automation.kind}`] : [];
    }),
  ].join(" ");

const tokenOf = (tokens: Map<string, Token>, address: string) => tokens.get(address.toLowerCase());

// Each token by name, or by address and in its smallest units if its decimals are unknown.
function showAmounts(element: Element, found: Amount[], tokens: Map<string, Token>, sign = "", none = "0 kVCM"): void {
  if (!found.length) return void element.replaceChildren(none);
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

// AutoMaxi's receipt: what its claims in the epoch of the last one received, its fee, and what reached the owner, in
// the tokens earned. Tokens without a price show as amounts only.
function fillClaims(
  item: HTMLElement,
  id: bigint,
  owner: Address,
  { claims, stopped }: Walk,
  times: Map<number, number>,
  tokens: Map<string, Token>,
  prices?: Map<string, number>,
): void {
  const { received, fees, paid } = totals(claims);
  const flip = weekStart(times.get(claims[0]!.block)!);
  fill(item, {
    "receipt-id": `#${id}`,
    "receipt-fee-share": bps(AUTOMAXI_FEE_BPS),
    "receipt-claimed-usd": worth(received, tokens, prices),
    "receipt-fee-usd": worth(fees, tokens, prices),
    "receipt-paid-usd": worth(paid, tokens, prices),
    "receipt-limit": String(WALK_LIMIT),
  });
  showAmounts(item.querySelector(".receipt-claimed")!, received, tokens, "", "Nothing");
  showAmounts(item.querySelector(".receipt-fee")!, fees, tokens, fees.length ? "−" : "", "Nothing");
  showAmounts(item.querySelector(".receipt-paid")!, paid, tokens, "", "Nothing");
  fillTime(item, "receipt-from", flip - WEEK);
  fillTime(item, "receipt-to", flip);
  show(".receipt-stopped", stopped, item);
  item.querySelector(".receipt-claims")!.replaceChildren(
    ...claims.map(({ block, caller, tx }) => {
      const line = clone("claim-line");
      fillTime(line, "claim-time", times.get(block)!, utc);
      const by = same(caller, KEEPER) ? "by the keeper" : same(caller, owner) ? "by you" : `by ${short(caller)}`;
      fill(line, { "claim-by": by });
      line.querySelector<HTMLAnchorElement>(".claim-tx")!.href = txUrl(tx);
      return line;
    }),
  );
}

// What waits to be claimed in last epoch's pools, as far as it could be read.
function waitingLine({ waiting, unknown }: Standing, earnings: Earnings): string {
  const tokens = new Map(earnings.rewards.map(({ token }) => [token.address.toLowerCase(), token]));
  const value = dollars(waiting, tokens, earnings.prices);
  if (unknown && value > 0) return `At least ${usd(value)} waits to be claimed in last epoch's pools.`;
  if (unknown) return "What waits to be claimed in last epoch's pools could not be read.";
  return value > 0
    ? `${usd(value)} waits to be claimed in last epoch's pools.`
    : "Nothing waits to be claimed in last epoch's pools.";
}

function standingItem(entry: Entry, epochStart: number, receipt?: HTMLElement) {
  const { automation, account, standing, earnings, late, note, time } = entry;
  const item = clone("standing");
  const through = standing?.through ?? 0;
  fill(item, {
    "standing-name": account.name || "Account",
    "standing-id": `#${account.id}`,
    "standing-automation": automation.name,
    "standing-waiting": standing && earnings ? waitingLine(standing, earnings) : "",
  });
  if (through) fillTime(item, "standing-through", through);
  fillTime(item, "late-from", epochStart - 2 * WEEK);
  fillTime(item, "late-to", epochStart - WEEK);
  show(".standing-failed", !earnings, item);
  show(".standing-paid", !!standing && !late && through > 0, item);
  show(".standing-never", !!standing && !late && !through, item);
  show(".standing-late", !!standing && late, item);
  show(".standing-waits", !!standing, item);
  show(".late-through", through > 0, item);
  show(".late-never", !through, item);
  if (note === "outside" && time !== undefined) fillTime(item, "outside-day", time);
  show(".standing-outside", note === "outside", item);
  show(".standing-unclaimed", note === "unclaimed", item);
  if (receipt) item.querySelector(".standing")!.append(receipt);
  return item;
}

// The accounts paid since the flip, and those still due, while the first of them was paid less than half a day ago.
function underWay({ entries, epochStart }: Found): { paid: Entry[]; left: Entry[]; first: number } | undefined {
  const since = ({ time }: Entry) => time !== undefined && time >= epochStart;
  const paid = entries.filter((entry) => entry.due && since(entry));
  const left = entries.filter((entry) => entry.due && !since(entry));
  const first = Math.min(...paid.map(({ time }) => time!));
  return paid.length && left.length && now() - first < UNDER_WAY ? { paid, left, first } : undefined;
}

const pairsOf = (earnings: Earnings) =>
  earnings.rewards.map(({ contract, token }) => ({ contract, token: token.address }));

// Each account's standing in an automation's reward contracts, last epoch's first. An account not paid since last epoch
// started may have been paid on the pools of the epoch before, until its next payout, so those are read for it too.
// None if the automation had rewards in neither.
async function standingsIn(
  automation: Automation,
  ids: bigint[],
  earnings: Earnings,
  top: number,
): Promise<Standing[] | undefined> {
  const pairs = pairsOf(earnings);
  const standings = await readStandings(ids, pairs, top);
  if (standings.every(({ through }) => through >= earnings.start)) return standings;
  const before = await rewardPairs(automation.address, earnings.start - WEEK);
  if (!pairs.length && !before.length) return undefined;
  return paidThrough(standings, before, top);
}

// An automation's own reader of its accounts' payouts, at block `top`, of time `time` if it could be read.
type Reader = (ids: bigint[], earnings: Earnings, top: number, time?: bigint) => Promise<Part[]>;

// Carbon Impact: about 25 reads to find each block of payouts, then one read of logs per block.
const carbonImpactPayouts: Reader = async (ids, earnings, top, time) => {
  const standings = await standingsIn(CARBON_IMPACT, ids, earnings, top);
  if (!standings) return ids.map(() => ({}));
  const blocks = await payoutBlocks(standings, top, Number(required([time])[0]));
  const [paid, times] = await Promise.all([payoutsIn([...blocks.values()]), blockTimes([...blocks.values()])]);
  return ids.map((id, i) => {
    const block = blocks.get(id);
    const payout = paid.filter(({ id: paidId, block: at }) => paidId === id && at === block).at(-1);
    return {
      standing: standings[i]!,
      ...(block !== undefined && { block, time: times.get(block)! }),
      ...(payout ? { payout } : block !== undefined && { note: "outside" as const }),
    };
  });
};

// AutoMaxi: one read of each account's last claim block, then its claims back to the start of that claim's epoch, one
// read of logs per block.
const autoMaxiPayouts: Reader = async (ids, earnings, top) => {
  const [standings, last] = await Promise.all([standingsIn(AUTOMAXI, ids, earnings, top), lastClaimBlocks(ids, top)]);
  const lastTimes = await blockTimes([...last.values()].filter((block) => block > 0));
  const starts = new Map(
    ids.map((id) => {
      const from = last.get(id)!;
      const time = lastTimes.get(from) ?? 0;
      // The first block of the epoch of the last claim.
      return [id, { from, since: from && from - Math.floor((time - weekStart(time)) / BLOCK_TIME) }];
    }),
  );
  const walks = await walkClaims(starts, readClaimsAt);
  return ids.map((id, i) => {
    const block = last.get(id)!;
    const walk = walks.get(id)!;
    return {
      ...(standings && { standing: standings[i]! }),
      ...(block > 0 && { block, time: lastTimes.get(block)! }),
      walk,
      ...(!walk.claims.length && { note: "unclaimed" as const }),
    };
  });
};

const readers: Record<Kind, Reader> = { "carbon-impact": carbonImpactPayouts, automaxi: autoMaxiPayouts };

// Each automation's accounts are read on their own: if one automation's payouts cannot be read, the others' still show.
async function readPayouts(holdings: Holdings, members: Account[]): Promise<Found> {
  const { epochStart } = holdings;
  const ids = members.map(({ id }) => id);
  const automations = [...new Set(members.map((account) => automationOf(account)!))];
  const top = Number(await rpc<Hex>("eth_blockNumber", [], { later: true })) - SETTLED;
  const [time, ...delegates] = await readLater(
    [
      blockTime,
      ...ids.flatMap((id) => [epochStart - WEEK, epochStart - 2 * WEEK].map((at) => escrow("delegates", id, at))),
    ],
    top,
  );
  const read = new Map(
    await Promise.all(
      automations.map(async (automation) => {
        const these = members.filter((account) => automationOf(account) === automation).map(({ id }) => id);
        try {
          const earnings = await lastEarnings(automation);
          const parts = await readers[automation.kind](these, earnings, top, time as bigint | undefined);
          return [automation, { earnings, parts: new Map(these.map((id, j) => [id, parts[j]!])) }] as const;
        } catch (error) {
          console.error(error);
          return [automation, undefined] as const;
        }
      }),
    ),
  );
  const entries = members.map((account, i): Entry => {
    const automation = automationOf(account)!;
    const found = read.get(automation);
    const part = found?.parts.get(account.id) ?? {};
    const [last, before] = delegates.slice(2 * i, 2 * i + 2) as (Address | undefined)[];
    return {
      ...part,
      automation,
      account,
      ...(found && { earnings: found.earnings }),
      due: same(String(last), automation.address),
      late: !!part.standing && isLate(part.standing.through, same(String(before), automation.address), epochStart),
    };
  });
  if (entries.every(({ earnings }) => !earnings)) throw new Error("No automation's payouts could be read.");
  return { epochStart, entries };
}

export function forgetPayout(): void {
  shown = readFor = showing = undefined;
  awaited = false;
  section.hidden = true;
}

// Shows the payouts of an owner with an account that is in one of the page's automations, or was when this epoch
// started.
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
  const members = holdings.accounts.filter((account) => automationOf(account));
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
  let times: Map<number, number>;
  try {
    found = await readPayouts(holdings, members);
    const payouts = found.entries.flatMap(({ payout }) => (payout ? [payout] : []));
    const claims = found.entries.flatMap(({ walk }) => walk?.claims ?? []);
    [tokens, names, times] = await Promise.all([
      tokensOf(
        [
          ...payouts.flatMap(({ earned, paid, fees }) => [...earned, ...paid, ...fees]),
          ...claims.flatMap(({ received }) => received),
        ].map(({ token }) => token),
        readLater,
      ),
      namesAt(payouts.map(({ block }) => block)),
      blockTimes(claims.map(({ block }) => block)),
    ]);
  } catch (error) {
    return fail(error);
  }
  if (!current()) return;
  const receipts = new Map<Entry, Drawn>();
  for (const entry of found.entries) {
    const { payout, time, walk, account, automation } = entry;
    let key: string;
    let make: () => Drawn;
    if (payout && time !== undefined) {
      key = `${payout.id} ${payout.block}`;
      make = () => {
        const node = clone("receipt").firstElementChild as HTMLElement;
        const draw = (prices?: Map<string, number>) =>
          fillReceipt(node, payout, time, names.get(payout.block)!, tokens, prices);
        return { node, priced: false, flip: weekStart(time), amounts: [...payout.earned, ...payout.paid], draw };
      };
    } else if (walk?.claims.length) {
      key = `${automation.kind} ${account.id} ${walk.claims.map(({ tx }) => tx).join(" ")}`;
      make = () => {
        const node = clone("claims-receipt").firstElementChild as HTMLElement;
        const draw = (prices?: Map<string, number>) =>
          fillClaims(node, account.id, holdings.owner, walk, times, tokens, prices);
        const flip = weekStart(times.get(walk.claims[0]!.block)!);
        return { node, priced: false, flip, amounts: totals(walk.claims).received, draw };
      };
    } else continue;
    if (!drawn.has(key)) {
      const receipt = make();
      receipt.draw();
      drawn.set(key, receipt);
    }
    receipts.set(entry, drawn.get(key)!);
  }
  section
    .querySelector(".standings")!
    .replaceChildren(...found.entries.map((entry) => standingItem(entry, found.epochStart, receipts.get(entry)?.node)));
  fill(section, {
    "receipts-automations": list([...new Set(found.entries.map(({ automation }) => automation.name))]),
  });
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
  const paidSince = ({ time }: Entry) => time !== undefined && time >= found.epochStart;
  awaited = found.entries.some((entry) => !entry.earnings || (entry.due && !paidSince(entry)));
  // Dollars need many more reads, so they come after, at the prices of the flip before each payout, flip by flip at
  // once. Without them, the receipts show tokens only.
  const unpriced = [...new Set(receipts.values())].filter(({ priced }) => !priced);
  await Promise.all(
    [...new Set(unpriced.map((receipt) => receipt.flip))].map(async (flip) => {
      const these = unpriced.filter((receipt) => receipt.flip === flip);
      // A pool must be deep enough for the largest amount of the token that any receipt shows in dollars.
      const amounts = new Map<string, bigint>();
      for (const { token, amount: value } of these.flatMap((receipt) => receipt.amounts))
        if (value > (amounts.get(token.toLowerCase()) ?? 0n)) amounts.set(token.toLowerCase(), value);
      // Another owner's accounts, or a newer read, may have taken over by then.
      if (!current()) return;
      const prices = await pricesAt([...tokens.values()], amounts, flip, now(), readLater).catch((error) => {
        console.error(error);
        return undefined;
      });
      if (!prices) return;
      for (const receipt of these) {
        receipt.draw(prices);
        receipt.priced = true;
      }
    }),
  );
}

// A payout goes on for hours, so the page may have read it half done. Every five minutes, while a payout due since the
// flip has not reached every account, or some payouts could not be read, the accounts' standings are read again, and
// the payouts of any account paid since. A new epoch, or a change of accounts, reads them again anyway.
export function checkPayout(): void {
  if (!readFor || !awaited || Date.now() - checked < 300_000) return;
  readFor = undefined;
  void load(true);
}

section.querySelector(".receipts-again")!.addEventListener("click", () => void load());
