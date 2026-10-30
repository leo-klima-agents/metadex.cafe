import { now, same } from "../chain.ts";
import { DOUBLE_ESPRESSO } from "../config.ts";
import { UNDER_WAY, payouts, type Entry, type Found, type UnderWay } from "../last-payout.ts";
import { waitingWords } from "../receipts.ts";
import { shown, views } from "./page.ts";

// The wallet's payouts, as the App, the accounts and an account's page show them: the accounts paid late, a payout
// under way, what their last read found, and how many times they were read: an overdue line is of one read, and drawn
// again with the next.
export const owed: { late: Set<bigint>; under?: UnderWay | undefined; found?: Found | undefined; reads: number } = {
  late: new Set(),
  reads: 0,
};

// The App reads the wallet's payouts to mark those paid late and those overdue; an account's page draws its own.
export const appPayouts = payouts(
  undefined,
  (found, underWay) => {
    owed.late = new Set(found.entries.flatMap(({ standing, account }) => (standing?.late ? [account.id] : [])));
    owed.under = underWay;
    owed.found = found;
    owed.reads++;
    showUnderWay();
    views.accounts(true);
    views.app();
  },
  undefined,
  // An overdue payout says what waits in tokens, then at prices now, once read: rewrite() writes its lines again, in
  // the App and on the account's page, with nothing to draw anew.
  () => {},
  // The App waits for them, read or not, before it reads Hydrex's average.
  () => views.app(),
);

// Forgets the wallet's payouts, as when another wallet is connected, or none.
export function forgetPayouts(): void {
  owed.late = new Set();
  owed.under = owed.found = undefined;
  appPayouts.forget();
}

// A payout under way: a line on Hydrex's page, and on the page of each account it has not reached yet.
function showUnderWay(): void {
  document.getElementById("underway")!.hidden = !owed.under;
  views.position();
}

// An account's payout through Double Espresso is overdue when something waits for it and nobody has claimed it: half a
// day after the flip, the time a payout takes, for the epoch that just ended, or once it is late for the one before.
// Only the wallet's own accounts, while Double Espresso holds their claims: a claim pays the owner, whoever calls.
export function overdueEntry(id: bigint): Entry | undefined {
  const entry = owed.found?.entries.find(({ account }) => account.id === id);
  if (!entry || !owed.found || entry.automation !== DOUBLE_ESPRESSO || !entry.standing || !entry.earnings)
    return undefined;
  if (!same(entry.account.claimer, DOUBLE_ESPRESSO.address) || !shown()?.accounts.some((account) => account.id === id))
    return;
  const { standing } = entry;
  const waits = standing.waiting.length > 0 || standing.unknown;
  const missed = entry.due && !standing.paid && waits && now() - owed.found.epochStart >= UNDER_WAY;
  return missed || standing.late ? entry : undefined;
}
export const overdue = (): Entry[] =>
  (shown()?.accounts ?? []).flatMap((account) => {
    const entry = overdueEntry(account.id);
    return entry ? [entry] : [];
  });

// What waits for an overdue account, in words, at prices now, or else in tokens: "≈ $1.84 in 9 tokens".
export function waitsLine({ standing }: Entry): () => string {
  const { waiting, unknown, late } = standing!;
  // The read it is of, whose prices may come after.
  const read = owed.found;
  return () => {
    const { worth, partial, tokens } = waitingWords(waiting, read?.waiting);
    if (!tokens) return "from the epoch before last";
    return `${unknown || late || partial ? "at least " : ""}${worth ? `${worth} in ${tokens}` : tokens}`;
  };
}
