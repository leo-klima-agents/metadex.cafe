import type { Address, Hex } from "viem";
import { blockTime, now, readLater, required, rpc, same, type Call } from "./chain.ts";
import { lastClaimBlocks, readClaimsAt, totals, walkClaims, WALK_LIMIT, type Walk } from "./claims.ts";
import { AUTOMATIONS, AUTOMAXI_FEE_BPS, KEEPER, KVCM, type Automation, type Kind } from "./config.ts";
import { clone, fill, fillAddress, fillOwn, fillTime, show, showHex, txUrl } from "./dom.ts";
import { rewardsFor, tokensOf, type Earnings } from "./earnings.ts";
import { WEEK, amount, bps, listWith, short, usd, utc, weekStart } from "./format.ts";
import { escrow, type Account, type Holdings } from "./hydrex.ts";
import { lastEarnings } from "./last-epoch.ts";
import { pricesAtFlip, type Token } from "./prices.ts";
import { prefill } from "./swap-view.ts";
import {
  SETTLED,
  blockTimes,
  dollars,
  epochBlock,
  namesAt,
  payoutBlocks,
  payoutsIn,
  readEarned,
  readStamps,
  stampOf,
  standingOf,
  watchedOf,
  weighed,
  type Amount,
  type Payout,
  type Standing,
} from "./receipts.ts";

// The payouts of accounts in the page's automations: for each, up to when it has been paid and what waits to be
// claimed, then the receipt of its last payout. The App reads them for all of an owner's accounts, to mark those paid
// late; an account's page reads them for that account, and draws its receipt.

const STATES = ["reading", "failed", "found"] as const;
// A payout takes up to half a day after each flip.
export const UNDER_WAY = 12 * 3600;

// What an automation's own reader finds of an account's payouts through it.
type Part = {
  // The block and time of its last payout, if any.
  block?: number;
  time?: number;
  // Carbon Impact's receipt, unless it was claimed elsewhere; AutoMaxi's claims in the epoch of its last one.
  payout?: Payout;
  walk?: Walk;
  // Why there is no receipt: its last claim was made outside the automation, or nothing was claimed through it yet.
  note?: "outside" | "unclaimed";
};
export type Entry = Part & {
  // The automation it is in, joining or leaving, whose receipts it shows; and the one whose votes earned its rewards
  // last epoch, in whose pools its standing is read: the same, unless it moved since.
  automation: Automation;
  voter: Automation;
  account: Account;
  // Unless the voter had no rewards in last epoch or the one before.
  standing?: Standing;
  // The voter's figures, unless they or the payouts could not be read, or they are not final yet.
  earnings?: Earnings;
  early: boolean;
  // Whether it voted with the automation last epoch, which still holds its claims, so that the payout after this
  // epoch's flip is due to it.
  due: boolean;
};
export type Found = { epochStart: number; entries: Entry[] };
// A payout under way: the accounts it has reached since the flip, those still due, and when it first paid one.
export type UnderWay = { paid: Entry[]; left: Entry[]; first: number };
// A receipt drawn, which is drawn again once prices are read.
type Drawn = {
  node: HTMLElement;
  priced: boolean;
  flip: number;
  amounts: Amount[];
  draw(prices?: Map<string, number>): void;
};

// What the five-minute check reads: one call for each account that a payout due since the flip has not reached yet,
// whose answer shows once it has. Each calls for the payouts to be read again.
type Signal = { call: Call; paid: (answer: unknown) => boolean };
// Each receipt drawn, by its owner and what it shows. Only those of the last draw are kept.
const drawn = new Map<string, Drawn>();

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
  owner: Address,
  time: number,
  name: string,
  tokens: Map<string, Token>,
  own: boolean,
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
  // To the owner: "Paid to you", unless the payout went to whoever owned the account then, and to its address.
  const then = !same(payout.owner, owner);
  const itself = same(payout.recipient, payout.owner);
  ownWords(
    item.querySelector(".receipt-paid-to")!,
    then ? "Paid to its owner then" : "Paid to you",
    then ? "Paid to its owner then" : "Paid to its owner",
  );
  const at = then ? "To its owner then," : "To";
  ownWords(item.querySelector(".receipt-elsewhere-at")!, at, at);
  show(".receipt-elsewhere", then || !itself, item);
  fillAddress(item, "receipt-recipient", payout.recipient);
  item.querySelector<HTMLAnchorElement>(".receipt-tx")!.href = txUrl(payout.tx);
  fillOwn(item, own);
}

// AutoMaxi's receipt: what its claims in the epoch of the last one received, its fee, and what reached the account's
// owner, in the tokens earned. Each claim pays whoever owned the account then, which a claim made before it changed hands
// shows. Tokens without a price show as amounts only.
function fillClaims(
  item: HTMLElement,
  id: bigint,
  owner: Address,
  { claims, stopped }: Walk,
  times: Map<number, number>,
  tokens: Map<string, Token>,
  own: boolean,
  prices?: Map<string, number>,
): void {
  const { received, fees, paid } = totals(claims);
  const flip = weekStart(times.get(claims[0]!.block)!);
  const elsewhere = claims.some((claim) => !same(claim.owner, owner));
  // To the owner: "Paid to you", unless some claims paid whoever owned the account before.
  ownWords(
    item.querySelector(".receipt-paid-to")!,
    elsewhere ? "Paid to its owner" : "Paid to you",
    "Paid to its owner",
  );
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
  // The usual path to one token, week after week: the swap's page, with these tokens and amounts ticked.
  item.querySelector<HTMLAnchorElement>(".swap-these")!.onclick = () => prefill(paid);
  item.querySelector(".receipt-claims")!.replaceChildren(
    ...claims.map(({ block, caller, owner: paid, tx }) => {
      const line = clone("claim-line");
      fillTime(line, "claim-time", times.get(block)!, utc);
      const by = same(caller, KEEPER) ? "by AutoMaxi" : `by ${short(caller)}`;
      ownWords(
        line.querySelector(".claim-by")!,
        same(caller, owner) ? "by you" : by,
        same(caller, owner) ? "by its owner" : by,
      );
      show(".claim-to", !same(paid, owner), line);
      fillAddress(line, "claim-owner", paid);
      line.querySelector<HTMLAnchorElement>(".claim-tx")!.href = txUrl(tx);
      return line;
    }),
  );
  fillOwn(item, own);
}

// Words that differ for the owner: fillOwn puts them in.
function ownWords(element: Element, own: string, theirs: string): void {
  Object.assign((element as HTMLElement).dataset, { own, theirs });
}

// Dollars at the prices of last epoch's rewards.
function valueIn(earnings: Earnings): (found: Amount[]) => number {
  const tokens = new Map(earnings.rewards.map(({ token }) => [token.address.toLowerCase(), token]));
  return (found) => dollars(found, tokens, earnings.prices);
}

// What waits to be claimed in last epoch's pools, as far as it could be read.
function waitingLine({ waiting, unknown }: Standing, earnings: Earnings): string {
  const value = valueIn(earnings)(waiting);
  if (unknown && value > 0) return `At least ${usd(value)} waiting`;
  if (unknown) return "Waiting: not read";
  return value > 0 ? `${usd(value)} waiting` : "Nothing waiting";
}

function standingItem(entry: Entry, epochStart: number, own: boolean, receipt?: HTMLElement) {
  const { automation, voter, account, standing, earnings, early, note, time } = entry;
  const item = clone("standing");
  const through = standing?.through ?? 0;
  const late = !!standing?.late;
  fill(item, {
    "standing-automation": automation.name,
    "standing-voter": voter.name,
    "standing-waiting": standing && earnings ? waitingLine(standing, earnings) : "",
  });
  if (through) fillTime(item, "standing-through", through);
  fillTime(item, "late-from", epochStart - 2 * WEEK);
  fillTime(item, "late-to", epochStart - WEEK);
  show(".standing-failed", !earnings && !early, item);
  show(".standing-early", early, item);
  show(".standing-none", !!earnings && !standing, item);
  show(".standing-paid", !!standing && !late && through > 0, item);
  show(".standing-never", !!standing && !late && !through, item);
  show(".standing-late", late, item);
  show(".standing-waits", !!standing, item);
  show(".late-through", through > 0, item);
  show(".late-never", !through, item);
  // Rewards its voter earned, and can no longer claim for it, since the voter no longer holds its claims.
  const stranded = !!standing && (standing.waiting.length > 0 || standing.unknown);
  show(".standing-moved", stranded && !same(account.claimer, voter.address), item);
  if (note === "outside" && time !== undefined) fillTime(item, "outside-day", time);
  show(".standing-outside", note === "outside", item);
  show(".standing-unclaimed", note === "unclaimed", item);
  if (receipt) item.querySelector(".standing")!.append(receipt);
  fillOwn(item, own);
  return item;
}

// The accounts paid since the flip, and those still due, while the first of them was paid less than half a day ago.
function underWay({ entries }: Found): UnderWay | undefined {
  const paid = entries.filter((entry) => entry.due && entry.standing?.paid);
  const left = entries.filter((entry) => entry.due && !entry.standing?.paid);
  const first = Math.min(...paid.flatMap(({ time }) => (time === undefined ? [] : [time])));
  // Without the time of a payout made, the page cannot say whether one is under way.
  if (!Number.isFinite(first)) return undefined;
  return paid.length && left.length && now() - first < UNDER_WAY ? { paid, left, first } : undefined;
}

// Each account's standing in an automation's reward contracts: in last epoch's, and, for the accounts that voted with
// it in the epoch before, in that epoch's too, which are found among every pool's. None if the automation had rewards
// in neither.
async function standingsIn(
  automation: Automation,
  ids: bigint[],
  earnings: Earnings,
  top: number,
  voted: { last: Set<bigint>; before: Set<bigint> },
): Promise<Standing[] | undefined> {
  const last = { start: earnings.start, pairs: weighed(earnings.rewards, earnings.prices) };
  const votedBefore = ids.filter((id) => voted.before.has(id));
  const [stamps, earned, rewards] = await Promise.all([
    readStamps(ids, last.pairs, top),
    readEarned(ids, last.pairs, top),
    votedBefore.length ? rewardsFor(automation.address, earnings.start - WEEK) : [],
  ]);
  const before = { start: earnings.start - WEEK, pairs: weighed(rewards, earnings.prices) };
  if (!last.pairs.length && !before.pairs.length) return undefined;
  const stampsBefore = await readStamps(votedBefore, before.pairs, top);
  return ids.map((id, i) =>
    standingOf(
      id,
      last,
      before,
      { last: stamps[i]!, earned: earned[i]!, before: stampsBefore[votedBefore.indexOf(id)] ?? [] },
      { last: voted.last.has(id), before: voted.before.has(id) },
    ),
  );
}

// An automation's own reader of its accounts' payouts through it, at block `top`, of time `time` if it could be read,
// from their standings once read, where they could be.
type Reader = (
  ids: bigint[],
  standings: Promise<(Standing | undefined)[]>,
  top: number,
  time?: bigint,
) => Promise<Part[]>;

// Carbon Impact: about 25 reads to find each block of payouts, then one read of logs per block.
const carbonImpactPayouts: Reader = async (ids, standings, top, time) => {
  const found = (await standings).flatMap((standing) => (standing ? [standing] : []));
  const blocks = await payoutBlocks(found, top, Number(required([time])[0]));
  const [paid, times] = await Promise.all([payoutsIn([...blocks.values()]), blockTimes([...blocks.values()])]);
  return ids.map((id) => {
    const block = blocks.get(id);
    const payout = paid.filter(({ id: paidId, block: at }) => paidId === id && at === block).at(-1);
    return {
      ...(block !== undefined && { block, time: times.get(block)! }),
      ...(payout ? { payout } : block !== undefined && { note: "outside" as const }),
    };
  });
};

// AutoMaxi: one read of each account's last claim block, then its claims back to the start of that claim's epoch, one
// read of logs per block.
const autoMaxiPayouts: Reader = async (ids, _standings, top) => {
  const last = await lastClaimBlocks(ids, top);
  const lastTimes = await blockTimes([...last.values()].filter((block) => block > 0));
  const starts = new Map(
    await Promise.all(
      ids.map(async (id) => {
        const from = last.get(id)!;
        const time = lastTimes.get(from)!;
        // The first block of the epoch of the last claim.
        return [id, { from, since: from && (await epochBlock(weekStart(time), from, time)) }] as const;
      }),
    ),
  );
  const walks = await walkClaims(starts, readClaimsAt);
  return ids.map((id) => {
    const block = last.get(id)!;
    const walk = walks.get(id)!;
    return {
      ...(block > 0 && { block, time: lastTimes.get(block)! }),
      walk,
      ...(!walk.claims.length && { note: "unclaimed" as const }),
    };
  });
};

const readers: Record<Kind, Reader> = { "carbon-impact": carbonImpactPayouts, automaxi: autoMaxiPayouts };

// Each automation's accounts are read on their own: if one automation's payouts cannot be read, the others' still show.
// An account's standing is read in the pools of the automation it voted with last epoch, and its receipts are those of
// the automation it is in now, which are the same unless it moved since.
async function readPayouts(holdings: Holdings, members: Account[]): Promise<Found> {
  const { epochStart } = holdings;
  const ids = members.map(({ id }) => id);
  const top = Number(await rpc<Hex>("eth_blockNumber", [], { later: true })) - SETTLED;
  const [time, ...delegates] = await readLater(
    [
      blockTime,
      ...ids.flatMap((id) => [epochStart - WEEK, epochStart - 2 * WEEK].map((at) => escrow("delegates", id, at))),
    ],
    top,
  );
  // Whether an account voted with an automation in the epoch that started one or two epochs ago.
  const votedWith = (automation: Automation, id: bigint, epochsAgo: 1 | 2): boolean =>
    same(String(delegates[2 * ids.indexOf(id) + epochsAgo - 1]), automation.address);
  const voterOf = (account: Account): Automation =>
    AUTOMATIONS.find((automation) => votedWith(automation, account.id, 1)) ?? automationOf(account)!;
  const groups = (of: (account: Account) => Automation) =>
    [...new Set(members.map(of))].map(
      (automation) =>
        [automation, members.filter((account) => of(account) === automation).map(({ id }) => id)] as const,
    );
  // Each voter's figures and standings, unless they could not be read, or are not final yet.
  const read = new Map<bigint, { earnings: Earnings; standing?: Standing } | "early">();
  const standingFor = (id: bigint) => {
    const found = read.get(id);
    return typeof found === "object" ? found.standing : undefined;
  };
  const standings = Promise.all(
    groups(voterOf).map(async ([automation, these]) => {
      try {
        const earnings = await lastEarnings(automation, epochStart - WEEK);
        if (earnings.start < epochStart - WEEK) return these.forEach((id) => read.set(id, "early"));
        const voted = {
          last: new Set(these.filter((id) => votedWith(automation, id, 1))),
          before: new Set(these.filter((id) => votedWith(automation, id, 2))),
        };
        const found = await standingsIn(automation, these, earnings, top, voted);
        these.forEach((id, i) => read.set(id, { earnings, ...(found && { standing: found[i]! }) }));
      } catch (error) {
        console.error(error);
      }
    }),
  );
  // Each automation's receipts, from the standings once read, where its reader needs them.
  const parts = new Map<bigint, Part>();
  await Promise.all(
    groups((account) => automationOf(account)!).map(async ([automation, these]) => {
      try {
        const theirs = standings.then(() => these.map(standingFor));
        const found = await readers[automation.kind](these, theirs, top, time as bigint | undefined);
        these.forEach((id, i) => parts.set(id, found[i]!));
      } catch (error) {
        console.error(error);
      }
    }),
  );
  await standings;
  const entries = members.map((account): Entry => {
    const automation = automationOf(account)!;
    const found = read.get(account.id);
    const part = parts.get(account.id);
    const known = typeof found === "object" && part ? found : undefined;
    return {
      ...part,
      automation,
      voter: voterOf(account),
      account,
      ...(known && { earnings: known.earnings, ...(known.standing && { standing: known.standing }) }),
      early: found === "early",
      // Only while the automation still holds its claims: an account that left can no longer be paid by it.
      due: votedWith(automation, account.id, 1) && same(account.claimer, automation.address),
    };
  });
  if (entries.every(({ earnings, early }) => !earnings && !early))
    throw new Error("No automation's payouts could be read.");
  return { epochStart, entries };
}

export type Payouts = {
  // Reads the payouts of the holdings' accounts that are in one of the page's automations, or were when this epoch
  // started. A read of the same accounts in the same epoch keeps what is shown until there is something new.
  show(holdings: Holdings): void;
  forget(): void;
  // A payout goes on for hours, so the page may have read it half done. Every five minutes, while a payout due since
  // the flip has not reached every account, one cheap read per account shows whether it has since, and only then are
  // the payouts read again, as they are when some could not be read. A new epoch, or a change of accounts, reads them
  // again anyway.
  check(): void;
};

// `section`, if any, shows the payouts and draws their receipts, in words to their owner when `ownedBy` says the
// account's owner is the viewer; `found` hears of each read, even one of no accounts.
export function payouts(
  section: HTMLElement | undefined,
  found: (found: Found, under: UnderWay | undefined) => void = () => {},
  ownedBy: (owner: Address) => boolean = () => true,
): Payouts {
  // The accounts given, and those whose payouts were read.
  let shown: Holdings | undefined;
  let readFor: string | undefined;
  // The owner whose payouts the section shows.
  let showing: string | undefined;
  // Whether some payouts could not be read, or were read against an older epoch's figures; and when a payout under
  // way stops being shown as such.
  let signals: Signal[] = [];
  let missed = false;
  let underUntil = Infinity;
  let checked = 0;
  let checking = false;
  const reset = (): void => void ([signals, missed, underUntil] = [[], false, Infinity]);

  const setState = (state: (typeof STATES)[number]): void => {
    if (section) for (const name of STATES) show(`.receipts-${name}`, name === state, section);
  };

  // A quiet read keeps what is shown until there is something new, and a failed one keeps everything.
  async function load(quietly = false): Promise<void> {
    const holdings = shown;
    if (!holdings) return;
    const key = keyOf(holdings);
    if (quietly && readFor === key) return;
    const members = holdings.accounts.filter((account) => automationOf(account));
    if (section) section.hidden = !members.length;
    readFor = key;
    if (!members.length) {
      reset();
      return found({ epochStart: holdings.epochStart, entries: [] }, undefined);
    }
    checked = Date.now();
    const owner = holdings.owner.toLowerCase();
    const kept = quietly && showing === owner;
    if (!kept) setState("reading");
    // False once other accounts, or a newer read, took over.
    const current = () => readFor === key && !!shown && keyOf(shown) === key;
    // A read that fails is read again by the next check, or by the section's button, and not by showing the same
    // accounts again. A quiet one keeps what is shown.
    const fail = (error: unknown) => {
      console.error(error);
      if (!current()) return;
      missed = true;
      if (!kept) setState("failed");
    };
    let read: Found;
    try {
      read = await readPayouts(holdings, members);
    } catch (error) {
      return fail(error);
    }
    if (!current()) return;
    const under = underWay(read);
    // An account is awaited while a payout is due to it, has not reached it, and has something to pay it. Its payout
    // claims one of the fewest of last epoch's rewards worth half of them, so their records show when it has come.
    signals = read.entries.flatMap(({ due, standing, earnings, account }) =>
      due && standing && !standing.paid && (standing.waiting.length || standing.unknown)
        ? watchedOf(weighed(earnings!.rewards, earnings!.prices)).map((pair) => ({
            call: stampOf(account.id, pair),
            paid: (stamp: unknown) => Number(stamp) >= read.epochStart,
          }))
        : [],
    );
    // Payouts not read, or read before last epoch's figures are final, are read again.
    missed = read.entries.some(({ earnings }) => !earnings);
    underUntil = under ? under.first + UNDER_WAY : Infinity;
    found(read, under);
    if (section) {
      // A failed draw leaves the failure shown: the next check, or the button, reads again.
      const drawn = await draw(section, holdings, read, current, () => ownedBy(holdings.owner)).then(() => true, fail);
      if (!drawn) return;
    }
    if (!current()) return;
    showing = owner;
    setState("found");
  }

  // Whether the payouts should be read again. A failed check is tried again at the next.
  async function moved(): Promise<boolean> {
    if (missed || now() >= underUntil) return true;
    const watched = signals;
    const answers = await readLater(watched.map(({ call }) => call)).catch((error: unknown) => {
      console.error(error);
      return [];
    });
    return watched.some(({ paid }, i) => answers[i] !== undefined && paid(answers[i]));
  }

  section?.querySelector(".receipts-again")!.addEventListener("click", () => void load());

  return {
    show(holdings) {
      shown = holdings;
      void load(true);
    },
    forget() {
      shown = readFor = showing = undefined;
      reset();
      // Another account's receipts never show under this one's heading.
      if (section) {
        section.hidden = true;
        section.querySelector(".standings")!.replaceChildren();
      }
    },
    check() {
      if (!readFor || checking || Date.now() - checked < 300_000) return;
      if (!signals.length && !missed && now() < underUntil) return;
      const key = readFor;
      checked = Date.now();
      checking = true;
      void moved()
        .then((again) => {
          if (!again || readFor !== key) return;
          readFor = undefined;
          return load(true);
        })
        .finally(() => (checking = false));
    },
  };
}

// Each standing, with the receipt of the account's last payout. Dollars need many more reads, so they come after, at
// the prices of the flip before each payout, flip by flip at once. Without them, the receipts show tokens only.
async function draw(
  section: HTMLElement,
  holdings: Holdings,
  found: Found,
  current: () => boolean,
  own: () => boolean,
): Promise<void> {
  const payouts = found.entries.flatMap(({ payout }) => (payout ? [payout] : []));
  const claims = found.entries.flatMap(({ walk }) => walk?.claims ?? []);
  const [tokens, names, times] = await Promise.all([
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
  if (!current()) return;
  const receipts = new Map<Entry, Drawn>();
  const owner = holdings.owner.toLowerCase();
  for (const entry of found.entries) {
    const { payout, time, walk, account, automation } = entry;
    let key: string;
    let make: () => Drawn;
    if (payout && time !== undefined) {
      key = `${owner} ${payout.id} ${payout.block}`;
      make = () => {
        const node = clone("receipt").firstElementChild as HTMLElement;
        const draw = (prices?: Map<string, number>) =>
          fillReceipt(node, payout, holdings.owner, time, names.get(payout.block)!, tokens, own(), prices);
        return { node, priced: false, flip: weekStart(time), amounts: [...payout.earned, ...payout.paid], draw };
      };
    } else if (walk?.claims.length) {
      key = `${owner} ${automation.kind} ${account.id} ${walk.claims.map(({ tx }) => tx).join(" ")}`;
      make = () => {
        const node = clone("claims-receipt").firstElementChild as HTMLElement;
        const draw = (prices?: Map<string, number>) =>
          fillClaims(node, account.id, holdings.owner, walk, times, tokens, own(), prices);
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
  const kept = new Set(receipts.values());
  for (const [key, receipt] of drawn) if (!kept.has(receipt)) drawn.delete(key);
  section
    .querySelector(".standings")!
    .replaceChildren(
      ...found.entries.map((entry) => standingItem(entry, found.epochStart, own(), receipts.get(entry)?.node)),
    );
  const unpriced = [...new Set(receipts.values())].filter(({ priced }) => !priced);
  void Promise.all(
    [...new Set(unpriced.map((receipt) => receipt.flip))].map(async (flip) => {
      const these = unpriced.filter((receipt) => receipt.flip === flip);
      // A pool must be deep enough for the largest amount of the token that any receipt shows in dollars.
      const amounts = new Map<string, bigint>();
      for (const { token, amount: value } of these.flatMap((receipt) => receipt.amounts))
        if (value > (amounts.get(token.toLowerCase()) ?? 0n)) amounts.set(token.toLowerCase(), value);
      // Other accounts, or a newer read, may have taken over by then.
      if (!current()) return;
      const prices = await pricesAtFlip([...tokens.values()], amounts, flip, now(), readLater).catch((error) => {
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
