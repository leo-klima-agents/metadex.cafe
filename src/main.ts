import { getAddress, isAddress, type Address } from "viem";
import {
  WEEK,
  bps,
  count,
  countdown,
  date,
  day,
  dayTime,
  earningPower,
  shareOf,
  short,
  units,
  weekStart,
} from "./format.ts";
import { LockType, check, readAccounts, readRelay, status, type Account } from "./hydrex.ts";

const form = document.querySelector("form")!;
const input = form.querySelector("input")!;
const button = form.querySelector("button")!;

const seconds = () => Math.floor(Date.now() / 1000);

/** Sets the text of every element with this class in root. */
function fill(root: ParentNode, name: string, text: string): void {
  for (const element of root.querySelectorAll(`.${name}`)) element.textContent = text;
}

/** Sets every <time> with this class to a time: its datetime, and its text in a given format. */
function fillTime(root: ParentNode, name: string, time: number, format: (time: number) => string): void {
  for (const element of root.querySelectorAll<HTMLTimeElement>(`time.${name}`)) {
    element.dateTime = new Date(time * 1000).toISOString();
    element.textContent = format(time);
  }
}

function show(id: string, shown = true): void {
  document.getElementById(id)!.hidden = !shown;
}

/** Sets every link with this class to an address: its page on Basescan, and the text shown. */
function fillAddress(root: ParentNode, name: string, address: Address, text: string): void {
  for (const link of root.querySelectorAll<HTMLAnchorElement>(`a.${name}`)) {
    link.href = `https://basescan.org/address/${address}`;
    link.textContent = text;
  }
}

/** Shows or hides every element with this class. */
function showAll(name: string, shown: boolean): void {
  for (const element of document.querySelectorAll<HTMLElement>(`.${name}`)) element.hidden = !shown;
}

function clone(template: string): DocumentFragment {
  return (document.getElementById(template) as HTMLTemplateElement).content.cloneNode(true) as DocumentFragment;
}

function failed(error: unknown): void {
  console.error(error);
  show("error");
}

function showWeek(): void {
  const now = seconds();
  const next = weekStart(now) + WEEK;
  fillTime(document, "week-start", next - WEEK, day);
  fillTime(document, "week-end", next, day);
  fill(document, "countdown", countdown(next - now));
}

async function showRelay(): Promise<void> {
  const { tonnes, retireBps, feeBps, votes, entity, lastVoted, pools } = await readRelay();
  fill(document, "tonnes", units(tonnes));
  fill(document, "retired", bps(retireBps));
  fill(document, "fee", bps(feeBps));
  showAll("no-fee", feeBps === 0n);
  showAll("with-fee", feeBps > 0n);
  fill(document, "power", earningPower(votes));
  fill(document, "entity", entity);
  const start = weekStart(seconds());
  fill(
    document,
    "voted",
    !lastVoted || !pools.length
      ? "None yet."
      : lastVoted >= start
        ? `Cast this epoch, on ${dayTime(lastVoted)} UTC. It can change until the epoch ends.`
        : lastVoted >= start - WEEK
          ? `Cast on ${dayTime(lastVoted)} UTC, ${countdown(start - lastVoted)} before the previous epoch ended.`
          : `Cast in the epoch that started ${day(weekStart(lastVoted))}.`,
  );
  const total = pools.reduce((sum, pool) => sum + pool.votes, 0n);
  const rows = document.querySelector<HTMLTableElement>(".shares")!.tBodies[0]!;
  for (const pool of pools) {
    const row = rows.insertRow();
    row.insertCell().textContent = pool.name;
    row.insertCell().textContent = total ? shareOf(pool.votes, total) : "–";
  }
  fill(document, "pools", count(pools.length, "pool", "pools"));
  show("split", pools.length > 0);
}

async function showChecks(): Promise<void> {
  const failing = await check();
  for (const id of failing) show(id);
  show("checks", failing.length > 0);
}

function kind({ lockType, end }: Account): string {
  if (lockType === LockType.permanent) return "Protocol Account";
  if (lockType === LockType.rolling) return "Flex Account, rolling lock";
  return end ? `Flex Account, lock ${end > seconds() ? "ends" : "ended"} ${date(end)}` : "Flex Account";
}

function accountItem(account: Account, owner: Address, epochStart: number): DocumentFragment {
  const item = clone("account");
  if (account.name) fill(item, "name", account.name);
  fill(item, "id", `#${account.id}`);
  fill(item, "kind", kind(account));
  fill(item, "votes", earningPower(account.votes));
  const state = status(account, owner, seconds(), epochStart);
  const line = clone(state.kind);
  if ("date" in state) fillTime(line, "date", state.date, day);
  if ("name" in state) fill(line, "automation", state.name);
  if ("to" in state) fillAddress(line, "address", state.to, short(state.to));
  item.querySelector(".status")!.replaceWith(line);
  return item;
}

async function showAccounts(owner: Address): Promise<void> {
  const { accounts, payout, epochStart } = await readAccounts(owner);
  const full = accounts.filter(({ amount }) => amount > 0n);
  const empty = accounts.filter(({ amount }) => amount === 0n);
  const items = (list: Account[]) => list.map((account) => accountItem(account, owner, epochStart));
  document.getElementById("full")!.replaceChildren(...items(full));
  document.querySelector("#empty-accounts ul")!.replaceChildren(...items(empty));
  fill(document, "empty-count", count(empty.length, "empty account", "empty accounts"));
  show("empty-accounts", empty.length > 0);
  show("none", !full.length);
  fillAddress(document, "owner", owner, short(owner));
  fillAddress(document, "payout", payout, payout);
  show("itself", payout.toLowerCase() === owner.toLowerCase());
  show("accounts");
  show("payout");
}

input.addEventListener("input", () => input.setCustomValidity(""));

form.addEventListener("submit", (event) => {
  event.preventDefault();
  const text = input.value.trim();
  // The pattern checks the format; an address in mixed case must also match its checksum.
  if (!isAddress(text)) {
    input.setCustomValidity(input.dataset.typo!);
    input.reportValidity();
    return;
  }
  button.disabled = true;
  show("reading");
  show("accounts", false);
  show("payout", false);
  showAccounts(getAddress(text))
    .catch(failed)
    .finally(() => {
      button.disabled = false;
      show("reading", false);
    });
});

showWeek();
showRelay().catch(failed);
showChecks().catch(failed);
