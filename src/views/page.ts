import type { Address } from "viem";
import { same } from "../chain.ts";
import { show } from "../dom.ts";
import type { Holdings } from "../hydrex.ts";
import type { Reader } from "../read.ts";
import type { Connection } from "../wallet.ts";
import type { Hooks } from "./review.ts";

// What the page's views share: the wallet connected, and its Hydrex accounts as read, anew for each wallet, again in
// each new epoch, after each review that sent something, and five minutes after a read that failed.
export const session: { connection?: Connection | undefined; accounts?: Reader<Holdings> | undefined } = {};
export const shown = (): Holdings | undefined => session.accounts?.value;
export const viewerOwns = (owner: Address): boolean => !!session.connection && same(owner, session.connection.address);

// How each view is drawn again, and what the page does as a whole. The views stand in layers, so that no two import each
// other: each imports those under it and draws them itself, and has one above it drawn again only through `views`, which
// that one sets as it starts, before anything is read. From the bottom: the router and the review; the swap, the
// payouts and the automations; the claim; the accounts; an account's page; the App; the connection; then main.ts, which
// sets `catchUp`.
export const views = {
  // The groups of the wallet's accounts, keeping what was ticked when `keepTicked`.
  accounts: (_keepTicked?: boolean): void => {},
  // An account's page, while it shows.
  position: (): void => {},
  // The App.
  app: (): void => {},
  // The header, and what shows whether a wallet is connected.
  connection: (): void => {},
  // Reads the wallet's accounts again: quietly, what was shown stays until then.
  loadAccounts: (_quietly?: boolean): Promise<void> => Promise.resolve(),
  // Reads again whatever is missing or from an epoch that has ended.
  catchUp: (): void => {},
};

// Once a review that sent something closes, the wallet's accounts are read again; once the wallet switched networks
// from one, the header says so.
export const hooks: Hooks = {
  closed: (submitted) => submitted && void views.loadAccounts(true),
  switched: () => views.connection(),
};

export function failed(error: unknown): void {
  console.error(error);
  show("#error");
}
