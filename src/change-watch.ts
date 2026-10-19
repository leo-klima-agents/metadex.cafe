import type { Address } from "viem";
import { same } from "./chain.ts";
import { ADMIN, KEEPER } from "./config.ts";
import { clone, fill, fillTime, show, showHex, txLink } from "./dom.ts";
import { bps, list, utc } from "./format.ts";
import {
  payoutChanges,
  searchWindow,
  settingsChanges,
  type Change,
  type PayoutChange,
  type Setting,
  type Window,
} from "./changes.ts";

// The section "What changed", and what changed for the accounts on the page: Carbon Impact's settings in the last
// four epochs, and where the owner's payouts go.

const LABELS: Record<Setting, string> = {
  retired: "The share retired",
  fee: "The fee",
  treasury: "Where the fee goes",
  tokens: "The tokens it pays out in",
  routers: "The routers it swaps through",
  credit: "The carbon credit it retires",
  names: "The name and message on retirements",
  admin: "The admin key",
  keeper: "The keeper",
  approvals: "What joining approves",
};
// The parts of a setting that has several, named where only some change.
const PARTS: Partial<Record<Setting, string[]>> = {
  credit: [
    "retirement aggregator",
    "contract that spends its kVCM",
    "credit token",
    "carbon class",
    "token ID",
    "batch",
  ],
  names: ["name", "beneficiary's address", "on behalf of", "message"],
  approvals: ["actions", "active", "description"],
};
const STATES = ["reading", "none", "found", "failed"] as const;

const section = document.getElementById("changes")!;
// The window searched, shared by both searches.
let searching: Promise<Window> | undefined;
let found: Change[] | undefined;
let listener: () => void = () => {};

const isAddress = (value: string): boolean => /^0x[0-9a-fA-F]{40}$/.test(value);

function code(address: string): HTMLElement {
  const element = document.createElement("code");
  element.translate = false;
  showHex(element, address);
  return element;
}

function words(value: string): Node | string {
  if (isAddress(value)) return code(value);
  if (!value) return "none";
  const bdi = document.createElement("bdi");
  bdi.textContent = `“${value}”`;
  return bdi;
}

// A setting's value, or the parts of it that differ from the other value.
function value(setting: Setting, values: string[], other: string[]): (Node | string)[] {
  switch (setting) {
    case "retired":
    case "fee":
      return [bps(BigInt(values[0]!))];
    case "admin":
    case "keeper":
      return [code(setting === "admin" ? ADMIN : KEEPER), values[0] === "true" ? " holds it" : " does not hold it"];
    case "tokens":
    case "routers":
      return values.length ? values.flatMap((address, i) => (i ? [", ", code(address)] : [code(address)])) : ["none"];
    case "treasury":
      return [words(values[0]!)];
  }
  const names = PARTS[setting]!;
  return values.flatMap((part, i) => (part === other[i] ? [] : [i ? "; " : "", `${names[i]} `, words(part)]));
}

function line(label: string, before: (Node | string)[], after: (Node | string)[]): DocumentFragment {
  const row = clone("change-row");
  fill(row, { "change-name": label });
  row.querySelector(".change-before")!.append(...before);
  row.querySelector(".change-after")!.append(...after);
  return row;
}

function txLinks(element: Element, { txs, block }: { txs: `0x${string}`[]; block: number }): void {
  if (!txs.length) {
    const link = document.createElement("a");
    link.href = `https://basescan.org/block/${block}`;
    link.textContent = `Block ${block}`;
    return void element.replaceChildren(link);
  }
  element.replaceChildren(txs.length === 1 ? "Transaction " : "Transactions ");
  txs.forEach((hash, i) => element.append(i ? ", " : "", txLink(hash)));
}

function changeItem(change: Change): DocumentFragment {
  const item = clone("change");
  fillTime(item, "change-time", change.time, utc);
  item
    .querySelector(".fields")!
    .replaceChildren(
      ...change.settings.map((setting) =>
        line(
          LABELS[setting],
          value(setting, change.before[setting], change.after[setting]),
          value(setting, change.after[setting], change.before[setting]),
        ),
      ),
    );
  txLinks(item.querySelector(".change-txs")!, change);
  return item;
}

function setState(state: (typeof STATES)[number]): void {
  for (const name of STATES) show(`.changes-${name}`, name === state, section);
}

// What changed, in words: "the fee and where the fee goes".
export const whatChanged = ({ settings }: Change): string =>
  list(settings.map((setting) => LABELS[setting].replace(/^The /, "the ")));

// Carbon Impact's changes, newest first, once read.
export const settingsChanged = (): Change[] | undefined => found;

export function onChanges(changed: () => void): void {
  listener = changed;
}

let watching = false;

// The search takes a few reads of old blocks, so it waits until something shows the changes: the section, or accounts
// in Carbon Impact. It then runs again every hour, with the window moved on.
export function watchChanges(): void {
  if (watching) return;
  watching = true;
  void loadChanges();
  setInterval(() => void loadChanges(), 3_600_000);
}

async function loadChanges(): Promise<void> {
  if (!found) setState("reading");
  try {
    searching = searchWindow();
    const searched = await searching;
    fillTime(section, "changes-since", searched.since);
    found = (await settingsChanges(searched)).reverse();
  } catch (error) {
    console.error(error);
    searching = undefined;
    if (!found) setState("failed");
    return;
  }
  section.querySelector(".changes-list")!.replaceChildren(...found.map(changeItem));
  setState(found.length ? "found" : "none");
  listener();
}

// The changes to where the owner's payouts go, newest first.
export const readPayoutChanges = async (owner: Address): Promise<PayoutChange[]> =>
  (await payoutChanges(owner, await (searching ??= searchWindow()))).reverse();

// Shows them in the section "Payout address", or nothing.
export function showPayoutChanges(owner: Address, changes: PayoutChange[]): void {
  const payout = document.getElementById("payout")!;
  const items = changes.map((change) => {
    const item = clone("payout-change");
    fillTime(item, "payout-time", change.time, utc);
    const by = !change.by
      ? "Someone"
      : same(change.by, owner)
        ? "You"
        : same(change.by, ADMIN)
          ? "Carbon Impact's admin key"
          : code(change.by);
    item.querySelector(".payout-by")!.replaceChildren(by);
    item.querySelector(".payout-before")!.replaceChildren(code(change.before));
    item.querySelector(".payout-after")!.replaceChildren(code(change.after));
    txLinks(item.querySelector(".payout-txs")!, change);
    return item;
  });
  payout.querySelector(".payout-changes ul")!.replaceChildren(...items);
  show(".payout-changes", changes.length > 0, payout);
}

section.querySelector(".changes-again")!.addEventListener("click", () => void loadChanges());
new IntersectionObserver((entries) => {
  if (entries.some(({ isIntersecting }) => isIntersecting)) watchChanges();
}).observe(section);
