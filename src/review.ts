import type { Hex } from "viem";
import type { Step } from "./calls.ts";
import { included } from "./chain.ts";
import { CHAIN_ID, CONDUIT } from "./config.ts";
import { clone, fill, txLink } from "./dom.ts";
import { count } from "./format.ts";
import { declined, propose, proposes, sendTransaction, switchToBase, type Connection } from "./wallet.ts";

const dialog = document.getElementById("review") as HTMLDialogElement;
const part = (selector: string) => dialog.querySelector<HTMLElement>(selector)!;
const [effects, how, steps, key, progress] = [
  part(".effects"),
  part(".how"),
  part(".steps"),
  part(".key"),
  part(".progress"),
];
fill(key, "conduit", CONDUIT);
const confirm = dialog.querySelector<HTMLButtonElement>(".confirm")!;
const back = dialog.querySelector<HTMLButtonElement>(".back")!;

/** What a review tells the page. */
export type Hooks = {
  /** Once the review has closed and nothing it asked for is on its way: whether the wallet took anything. */
  closed(submitted: boolean): void;
  /** The wallet switched to Base from the review. */
  switched(): void;
};

type Review = {
  steps: Step[];
  connection: Connection;
  hooks: Hooks;
  /** Whether a request to the wallet, or a transaction, is on its way. */
  sending: boolean;
  /** The transactions Base included so far: the next call to send comes after them. */
  done: Hex[];
  /** Whether the wallet took anything. */
  submitted: boolean;
};

let current: Review | undefined;

/**
 * Whether to go on following a transaction: for ten minutes from the first time it is asked. The page goes on following
 * after the review closes, so that it reads the accounts again once Base includes what was sent.
 */
function following(): () => boolean {
  let end: number | undefined;
  return () => Date.now() < (end ??= Date.now() + 10 * 60_000);
}

/**
 * Shows what the calls change and the calls themselves, and sends them when the user confirms: a Safe proposes them as
 * one Safe transaction, and any other wallet sends one transaction per call. Tells the page once it has closed and what
 * it sent is over.
 */
export function review(
  title: string,
  changes: DocumentFragment,
  calls: Step[],
  connection: Connection,
  hooks: Hooks,
): void {
  const state: Review = { steps: calls, connection, hooks, sending: false, done: [], submitted: false };
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
  fill(key, "calls", calls.length === 1 ? "this call" : "these calls");
  how.textContent = proposes(connection)
    ? calls.length === 1
      ? "One Safe transaction:"
      : `One Safe transaction, with ${calls.length} calls:`
    : calls.length === 1
      ? "One transaction:"
      : `${count(calls.length, "transaction", "transactions")}, one after the other:`;
  progress.replaceChildren();
  confirm.hidden = false;
  showBack(state);
  update();
  dialog.showModal();
}

/**
 * Updates the main button: a switch while the wallet is on another chain, and one click per transaction. A Safe on
 * another chain cannot switch: its page says so.
 */
export function update(): void {
  if (!current) return;
  const { connection, steps, done, sending } = current;
  const wrongChain = connection.chainId !== CHAIN_ID;
  const proposing = proposes(connection);
  confirm.textContent = proposing
    ? "Propose in Safe{Wallet}"
    : wrongChain
      ? "Switch to Base"
      : steps.length === 1
        ? "Confirm in your wallet"
        : `Confirm transaction ${done.length + 1} of ${steps.length}`;
  confirm.disabled = sending || (proposing && wrongChain);
}

/** Closes the review, as when the wallet changes account. */
export function close(): void {
  if (dialog.open) dialog.close();
}

/**
 * The second button: "Close" once the wallet took anything. Closing stops the page sending more, not what it sent: the
 * page follows that in the background.
 */
function showBack(state: Review): void {
  if (current === state) back.textContent = state.submitted ? "Close" : "Back";
}

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

/** Hides the main button: there is nothing left to send. */
function finished(state: Review): void {
  if (current === state) confirm.hidden = true;
}

const calls = (state: Review) => state.steps.map(({ to, data }) => ({ to, data }));

/** Proposes every call as one Safe transaction. Its owners sign in Safe{Wallet}, maybe days later: the page stops here. */
async function proposeAll(state: Review): Promise<void> {
  const proposing = propose(state.connection.provider, calls(state));
  tell(state, "Waiting for your wallet…");
  await proposing;
  sent(state, "Proposed. The Safe's owners sign it in Safe{Wallet}; the accounts here change once it executes.");
  finished(state);
}

/** Sends the next call as a transaction of its own, and follows it until Base includes it. */
async function sendNext(state: Review): Promise<void> {
  const { provider, address } = state.connection;
  const [index, total] = [state.done.length, state.steps.length];
  const sending = sendTransaction(provider, address, calls(state)[index]!);
  tell(state, "Waiting for your wallet…", state.done);
  const hash = await sending;
  const hashes = [...state.done, hash];
  const which = total === 1 ? "Sent" : `Transaction ${index + 1} of ${total} sent`;
  sent(state, `${which}. Waiting for Base to include it…`, hashes);
  const ok = await included(hash, following());
  if (!ok) {
    const partly = index ? ` ${index} of ${total} transactions went through.` : "";
    // Base has not included it after a while, as when the wallet replaced it: the wallet knows the rest.
    const unsure = "Sent. Your wallet shows when Base includes it; reload this page then.";
    tell(state, ok === undefined ? unsure : `A transaction failed on Base.${partly}`, hashes);
    return finished(state);
  }
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
  // The wallet's request comes first, with no wait since the click: a wallet that opens a window opens it only from a
  // click. Each transaction takes a click of its own for the same reason.
  if (state.connection.chainId !== CHAIN_ID) {
    const switching = switchToBase(state.connection);
    state.sending = true;
    update();
    switching.then(state.hooks.switched, (error) => tell(state, failure(error))).finally(() => ended(state));
    return;
  }
  const sending = proposes(state.connection) ? proposeAll(state) : sendNext(state);
  state.sending = true;
  update();
  sending
    .catch((error) => {
      const [n, total] = [state.done.length, state.steps.length];
      const partly = n ? ` ${n} of ${total} transactions went through.` : "";
      tell(state, `${failure(error)}${partly}`, state.done);
    })
    .finally(() => ended(state));
});

/** Ends a request to the wallet: the review shows what comes next, or, if it closed meanwhile, tells the page. */
function ended(state: Review): void {
  state.sending = false;
  if (current === state) update();
  else state.hooks.closed(state.submitted);
}

function failure(error: unknown): string {
  if (declined(error)) return "You said no in your wallet.";
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
  // A request still on its way tells the page when it ends.
  if (state && !state.sending) state.hooks.closed(state.submitted);
});
