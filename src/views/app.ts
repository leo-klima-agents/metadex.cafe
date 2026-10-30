import type { Address } from "viem";
import { now, same } from "../chain.ts";
import { AUTOMATIONS, SWAPPERS } from "../config.ts";
import { PENDING, clone, fill, live, setText, show, type Text } from "../dom.ts";
import { count, figure, money } from "../format.ts";
import { automationName, canLeave, hasVotes, statusOf, type Holdings } from "../hydrex.ts";
import { hrefOf } from "../routes.ts";
import { describe } from "../tokens.ts";
import { claim, review, showAccounts, type Action } from "./accounts.ts";
import { session, shown, views } from "./page.ts";
import { overdue, owed, waitsLine } from "./payouts.ts";
import { showPosition } from "./position.ts";
import { allowancesLeft, onSwapChange, resetReview, swapLine } from "./swap.ts";

// The App: what needs you across the products, each with one action, then the products, each with what you hold in it,
// and what this wallet allows the café's contracts to do.

const appView = document.querySelector<HTMLElement>('.view[data-view="app"]')!;

function need(
  shape: string,
  words: Text | (() => Text),
  act: { link?: string; button?: (event: MouseEvent) => void; label: string } | undefined,
): DocumentFragment {
  const item = clone("need");
  item.querySelector(".shape")!.classList.add(shape);
  fill(item, { "need-words": words });
  const link = item.querySelector<HTMLAnchorElement>(".need-link")!;
  const button = item.querySelector<HTMLButtonElement>(".need-button")!;
  if (act?.link) Object.assign(link, { href: act.link, textContent: act.label, hidden: false });
  if (act?.button) {
    Object.assign(button, { textContent: act.label, hidden: false });
    button.addEventListener("click", act.button);
  }
  return item;
}

let overdueShown = "";
let needsShown: string | undefined;
let allowsShown: string | undefined;

export function showApp(): void {
  const items: DocumentFragment[] = [];
  // What each line is keyed on: its words, or, for a line whose words change as prices come, what it is of.
  const keys: string[] = [];
  const add = (item: DocumentFragment, key = item.textContent ?? ""): void => void (items.push(item), keys.push(key));
  const { connection } = session;
  const holdings = connection ? shown() : undefined;
  if (holdings) {
    const { owner, accounts, epochStart } = holdings;
    // Accounts their owner votes with, who did not vote last epoch, and accounts in automations that stopped, a line
    // each, as each shares one remedy, which Hydrex's page offers; then a line for each account partly in one, to its
    // page. In the order of Hydrex's page. An account with less than a vote needs nothing.
    let [unvoted, stopped] = [0, 0];
    const partly: DocumentFragment[] = [];
    const toHydrex = { link: hrefOf({ view: "hydrex" }), label: "Change" };
    for (const account of accounts.filter(hasVotes)) {
      const status = statusOf(account, owner, now(), epochStart);
      if (status.kind === "unvoted") unvoted++;
      if (status.kind === "stopped") stopped++;
      if (status.kind === "partly") {
        const change = { link: hrefOf({ view: "position", id: account.id }), label: "Change" };
        partly.push(need("stopped", `Hydrex account #${account.id} is partly in ${status.automation.name}`, change));
      }
    }
    if (unvoted)
      add(need("stopped", `${count(unvoted, "Hydrex account", "Hydrex accounts")} didn't vote last epoch`, toHydrex));
    if (stopped) {
      const where = stopped === 1 ? "a stopped automation" : "stopped automations";
      add(need("stopped", `${count(stopped, "Hydrex account", "Hydrex accounts")} in ${where}`, toHydrex));
    }
    for (const item of partly) add(item);
    for (const entry of overdue()) {
      const waits = waitsLine(entry);
      add(
        need("stopped", () => `Hydrex account #${entry.account.id}: payout overdue, ${waits()}`, {
          label: "Claim now",
          button: (event) => claim([entry.account], showApp, event.currentTarget as HTMLButtonElement),
        }),
        `overdue ${entry.account.id} ${owed.reads}`,
      );
    }
  }
  const left = connection ? allowancesLeft() : undefined;
  if (left?.length) {
    add(
      need("idle", `${count(left.length, "token approval hasn't", "token approvals haven't")} been used`, {
        label: "Reset",
        // The approvals left when clicked, which a later read may have changed.
        button: () => void resetReview(allowancesLeft() ?? []),
      }),
    );
  }
  // Above the products, with a wallet: while its accounts are read, a line keeps the list's place, and once read, a
  // line says when nothing needs it, so that the products stay where they are. Drawn again only when its lines change,
  // so that a button keeps its focus between ticks.
  const needs = document.getElementById("needs")!;
  const reading = !!connection && !holdings && !session.accounts?.failed;
  const placeholder = reading ? "reading" : holdings && !items.length ? "nothing" : "";
  // Keyed on what each line acts on, not only its words.
  const drawnNeeds = [...keys, ...(left ?? []).map(({ token, spender }) => `${token} ${spender}`), placeholder].join(
    "\n",
  );
  if (drawnNeeds !== needsShown) {
    needsShown = drawnNeeds;
    needs.hidden = !items.length && !placeholder;
    fill(needs, { count: items.length ? `· ${items.length}` : "" });
    if (placeholder === "reading") items.push(need("checking", PENDING, undefined));
    if (placeholder === "nothing") items.push(need("running", "Nothing right now", undefined));
    needs.querySelector(".needs-list")!.replaceChildren(...items);
  }
  // What you hold in each product, once connected: pending while read.
  const hydrexYours = appView.querySelector<HTMLElement>(".hydrex-yours")!;
  hydrexYours.hidden = !connection || (!holdings && !!session.accounts?.failed);
  if (!holdings) setText(hydrexYours, PENDING);
  else {
    const full = holdings.accounts.filter(({ amount }) => amount > 0n);
    const counts = AUTOMATIONS.flatMap((automation) => {
      const n = full.filter((account) => {
        const status = statusOf(account, holdings.owner, now(), holdings.epochStart);
        return (
          "automation" in status &&
          status.automation === automation &&
          (status.kind === "in" || status.kind === "joined")
        );
      }).length;
      return n ? [`${n} in ${automation.name}`] : [];
    });
    setText(hydrexYours, [count(full.length, "Hydrex account", "Hydrex accounts"), ...counts].join(" · "));
  }
  const swapYours = appView.querySelector<HTMLElement>(".swap-yours")!;
  const line = connection ? swapLine() : undefined;
  swapYours.hidden = !connection;
  // What is found so far, while the wallet's tokens are quoted.
  if (!line) setText(swapYours, PENDING);
  else {
    live(swapYours, () =>
      line.failed
        ? "Not read"
        : line.reading && !line.count
          ? PENDING
          : line.count
            ? `${count(line.count, "token", "tokens")} · ${money(line.worth)}${line.reading ? " so far" : ""}`
            : "Nothing to swap",
    );
  }
  void showAllows(holdings, left);
  // A payout becomes overdue as time passes: the groups' Claim follows.
  const key = overdue()
    .map(({ account }) => account.id)
    .join();
  if (key !== overdueShown) {
    overdueShown = key;
    showAccounts(true);
    showPosition();
  }
}

// What this wallet allows: the automations that vote or claim for its accounts, and what the swappers may take.
async function showAllows(
  holdings: Holdings | undefined,
  left: { token: Address; spender: Address; amount: bigint }[] | undefined,
): Promise<void> {
  const { connection } = session;
  show(".allows-open", !!connection, appView);
  if (!connection) return appView.querySelector<HTMLElement>(".allows")!.hidePopover?.();
  const lines = (holdings?.accounts ?? []).flatMap((account) => {
    const theirs = AUTOMATIONS.filter((automation) => canLeave(account, automation)).map((automation) => {
      const votes = same(account.delegate, automation.address);
      const claims = same(account.claimer, automation.address);
      const what = votes && claims ? "votes and claims" : votes ? "votes" : "claims";
      return { words: `Hydrex account #${account.id} · ${automation.name}: ${what}`, action: "leave" as Action };
    });
    const other = automationName(account.delegate);
    if (other) theirs.push({ words: `Hydrex account #${account.id} · ${other}: votes`, action: "self" });
    return theirs.map((line) => ({ ...line, account }));
  });
  const drawn = [
    ...lines.map(({ words }) => words),
    ...(left ?? []).map(({ token, spender, amount }) => `${token} ${spender} ${amount}`),
  ].join("\n");
  if (drawn === allowsShown) return;
  allowsShown = drawn;
  appView.querySelector(".allows-accounts")!.replaceChildren(
    ...lines.map(({ words, action, account }) => {
      const item = clone("allows-account");
      fill(item, { "allows-words": words });
      item.querySelector(".allows-undo")!.addEventListener("click", () => review([account], action));
      return item;
    }),
  );
  show(".allows-none", !lines.length, appView);
  const tokens = left?.length ? await describe(left.map(({ token }) => token)).catch(() => new Map()) : new Map();
  // A later call, with newer approvals, may have drawn them meanwhile.
  if (allowsShown !== drawn) return;
  appView.querySelector(".allows-tokens")!.replaceChildren(
    ...(left ?? []).map((allowance) => {
      const item = clone("allowance");
      const token = tokens.get(allowance.token.toLowerCase());
      const swapper = SWAPPERS.find(({ address }) => same(address, allowance.spender))!;
      fill(item, {
        "allowance-symbol": token?.symbol ?? allowance.token,
        "allowance-amount": token ? figure(allowance.amount, token.decimals) : String(allowance.amount),
        "allowance-swapper": swapper.symbol,
      });
      item.querySelector(".reset")!.addEventListener("click", () => void resetReview([allowance]));
      return item;
    }),
  );
  show(".allows-tokens-none", !left?.length, appView);
}

// How the App is drawn again: as the wallet's accounts, their payouts and what the swap found change.
export function initApp(): void {
  views.app = showApp;
  onSwapChange(showApp);
}
