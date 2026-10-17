import type { Hex } from "viem";
import type { Step } from "./calls.ts";
import { included, simulate } from "./chain.ts";
import { CHAIN_ID, CONDUIT } from "./config.ts";
import { clone, fill, txLink } from "./dom.ts";
import { count } from "./format.ts";
import {
  Failed,
  batches,
  declined,
  proposes,
  sendBatch,
  sendTransaction,
  switchToBase,
  type Connection,
} from "./wallet.ts";

const dialog = document.getElementById("review") as HTMLDialogElement;
const part = (selector: string) => dialog.querySelector<HTMLElement>(selector)!;
const [effects, how, steps, key, check, progress] = [
  part(".effects"),
  part(".how"),
  part(".steps"),
  part(".key"),
  part(".check"),
  part(".progress"),
];
fill(key, "conduit", CONDUIT);
const confirm = dialog.querySelector<HTMLButtonElement>(".confirm")!;
const back = dialog.querySelector<HTMLButtonElement>(".back")!;

type Review = {
  steps: Step[];
  connection: Connection;
  /** Whether the wallet sends the calls as one transaction; undefined until known. */
  batch?: boolean;
  checked: boolean;
  /** Whether a request to the wallet, or a transaction, is on its way. */
  sending: boolean;
  /** Without batching, the transactions Base included so far: the next call to send comes after them. */
  done: Hex[];
  /** Whether the wallet took anything. */
  submitted: boolean;
  closed: (submitted: boolean) => void;
};

let current: Review | undefined;

/**
 * Shows what the calls change and the calls themselves, checks them against Base from the owner's address, and sends
 * them when the user confirms. Calls closed when the dialog closes, and again when what it sent is over if the dialog
 * closed before.
 */
export function review(
  title: string,
  changes: DocumentFragment,
  calls: Step[],
  connection: Connection,
  closed: (submitted: boolean) => void,
): void {
  const state: Review = {
    steps: calls,
    connection,
    checked: false,
    sending: false,
    done: [],
    submitted: false,
    closed,
  };
  current = state;
  dialog.querySelector("h2")!.textContent = title;
  effects.replaceChildren(changes);
  steps.replaceChildren(
    ...calls.map((step) => {
      const item = clone("step");
      fill(item, "says", step.says);
      fill(item, "shows", step.shows);
      fill(item, "on", step.on);
      return item;
    }),
  );
  // Joining and leaving name the conduit by its address, which the wallet shows too.
  key.hidden = !calls.some(({ shows }) => shows.includes(CONDUIT));
  how.textContent = "";
  check.textContent = "Checking each call against Base…";
  progress.replaceChildren();
  confirm.hidden = false;
  showBack(state);
  update();
  dialog.showModal();
  const { address, provider } = connection;
  // A Safe always takes the calls as one Safe transaction.
  const proposing = proposes(connection);
  batches(provider, address).then((batch) => {
    if (current !== state) return;
    state.batch = proposing || batch;
    const one = proposing ? "One Safe transaction" : "One transaction";
    how.textContent =
      calls.length === 1
        ? `${one}:`
        : state.batch
          ? `${one}, with ${calls.length} calls:`
          : `${count(calls.length, "transaction", "transactions")}, one after the other:`;
    update();
  });
  simulate(address, calls)
    .then((failure) => {
      if (current !== state) return;
      state.checked = !failure;
      check.textContent = failure
        ? `Call ${failure.index + 1} would fail on Base, so nothing can be sent. The chain says: “${failure.reason}”.`
        : "Checked ✓ Each call was run against Base from your address: it would succeed.";
      update();
    })
    .catch((error) => {
      console.error(error);
      if (current !== state) return;
      check.textContent = "The calls could not be checked: no Base RPC answered. Go back and try again.";
    });
}

/**
 * Updates the main button: disabled until the calls are checked, a switch while the wallet is on another chain, and,
 * without batching, one click per transaction. A Safe on another chain cannot switch: its page says so.
 */
export function update(): void {
  if (!current) return;
  const { connection, steps, batch, done, checked, sending } = current;
  const wrongChain = connection.chainId !== CHAIN_ID;
  const proposing = proposes(connection);
  confirm.textContent = proposing
    ? "Propose in Safe{Wallet}"
    : wrongChain
      ? "Switch to Base"
      : batch || steps.length === 1
        ? "Confirm in your wallet"
        : `Confirm transaction ${done.length + 1} of ${steps.length}`;
  confirm.disabled = !checked || batch === undefined || sending || (proposing && wrongChain);
}

/** Closes the review, as when the wallet changes account. */
export function close(): void {
  if (dialog.open) dialog.close();
}

/** The second button: "Close" once the wallet took anything. Closing stops what the page follows, not the wallet. */
function showBack(state: Review): void {
  if (current === state) back.textContent = state.submitted ? "Close" : "Back";
}

const PROPOSED = "Proposed. The Safe's owners sign it in Safe{Wallet}; the accounts here change once it executes.";

/** Shows a message in this review only: it may have closed, and another opened. */
function tell(state: Review, message: string, hashes: Hex[] = []): void {
  if (current === state) say(message, hashes);
}

/** Notes that the wallet took a request. */
function sent(state: Review, message: string, hashes: Hex[] = []): void {
  state.submitted = true;
  showBack(state);
  tell(state, message, hashes);
}

/** Hides the main button: what was checked is no longer what is left to send. */
function finished(state: Review): void {
  if (current === state) confirm.hidden = true;
}

const calls = (state: Review) => state.steps.map(({ to, data }) => ({ to, data }));

/** Sends every call as one transaction, or proposes it in a Safe, and follows it until Base includes it. */
async function sendAll(state: Review): Promise<void> {
  const { provider, address } = state.connection;
  // A Safe's owners sign in Safe{Wallet}, maybe days later: the page does not follow the proposal.
  const proposing = proposes(state.connection);
  const sending = sendBatch(
    provider,
    address,
    calls(state),
    () => sent(state, proposing ? PROPOSED : "Sent. Waiting for Base to include it…"),
    () => !proposing && current === state,
  );
  tell(state, "Waiting for your wallet…");
  const hashes = await sending;
  if (!proposing) {
    tell(
      state,
      hashes ? "Done." : "Sent. Your wallet shows when Base includes it; the accounts here change then.",
      hashes,
    );
  }
  finished(state);
}

/** Sends the next call as a transaction of its own, and follows it until Base includes it. */
async function sendNext(state: Review): Promise<void> {
  const { provider, address } = state.connection;
  const [index, total] = [state.done.length, state.steps.length];
  const sending = sendTransaction(provider, address, calls(state)[index]!);
  tell(state, "Waiting for your wallet…", state.done);
  const hash = await sending;
  const which = total === 1 ? "Sent" : `Transaction ${index + 1} of ${total} sent`;
  sent(state, `${which}. Waiting for Base to include it…`, [...state.done, hash]);
  const ok = await included(hash, () => current === state);
  if (ok === undefined) return;
  if (!ok) throw new Failed([...state.done, hash]);
  state.done.push(hash);
  if (state.done.length < total) {
    const next = `Confirm transaction ${index + 2} when you are ready; closing stops here.`;
    tell(state, `Transaction ${index + 1} of ${total} is included. ${next}`, state.done);
  } else {
    tell(state, "Done.", state.done);
    finished(state);
  }
}

confirm.addEventListener("click", () => {
  const state = current;
  if (!state) return;
  if (state.connection.chainId !== CHAIN_ID) {
    switchToBase(state.connection).then(update, (error) => say(failure(error)));
    return;
  }
  // The wallet's request comes first, with no wait since the click: a wallet that opens a window, such as Coinbase's,
  // opens it only from a click. Without batching, each transaction takes a click of its own for the same reason.
  const sending = state.batch ? sendAll(state) : sendNext(state);
  state.sending = true;
  update();
  sending
    .catch((error) => {
      const [n, total] = [state.done.length, state.steps.length];
      const partly = n ? ` ${n} of ${total} transactions went through.` : "";
      tell(state, `${failure(error)}${partly}`, error instanceof Failed ? error.hashes : state.done);
      if (error instanceof Failed) finished(state);
    })
    .finally(() => {
      state.sending = false;
      if (current === state) update();
      else if (state.submitted) state.closed(true);
    });
});

function failure(error: unknown): string {
  if (declined(error)) return "You said no in your wallet.";
  if (error instanceof Failed) return "A transaction failed on Base.";
  console.error(error);
  const message = (error as { message?: string } | undefined)?.message;
  return message ? `Your wallet answered: “${message}”` : "Your wallet did not answer.";
}

/** Shows a message on the progress line, with links to transactions. */
function say(message: string, hashes: Hex[] = []): void {
  progress.replaceChildren(message);
  for (const [i, hash] of hashes.entries()) {
    progress.append(i ? ", " : hashes.length === 1 ? " Transaction: " : " Transactions: ");
    progress.append(txLink(hash, `${hash.slice(0, 10)}…`));
  }
  if (hashes.length) progress.append(".");
}

back.addEventListener("click", () => dialog.close());

dialog.addEventListener("close", () => {
  const state = current;
  current = undefined;
  state?.closed(state.submitted);
});
