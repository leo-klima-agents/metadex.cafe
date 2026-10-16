import type { Hex } from "viem";
import type { Step } from "./calls.ts";
import { simulate } from "./chain.ts";
import { CHAIN_ID } from "./config.ts";
import { clone, fill, txLink } from "./dom.ts";
import { count } from "./format.ts";
import { Failed, batches, declined, sendBatch, sendEach, switchToBase, type Connection } from "./wallet.ts";

const dialog = document.getElementById("review") as HTMLDialogElement;
const part = (selector: string) => dialog.querySelector<HTMLElement>(selector)!;
const [effects, how, steps, check, progress] = [
  part(".effects"),
  part(".how"),
  part(".steps"),
  part(".check"),
  part(".progress"),
];
const confirm = dialog.querySelector<HTMLButtonElement>(".confirm")!;
const back = dialog.querySelector<HTMLButtonElement>(".back")!;

type Review = {
  steps: Step[];
  connection: Connection;
  /** Whether the wallet sends the calls as one transaction; undefined until known. */
  batch?: boolean;
  checked: boolean;
  sending: boolean;
  /** Whether the wallet is asking the user. The dialog stays open meanwhile. */
  asking: boolean;
  /** Whether the wallet sent anything. */
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
    asking: false,
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
  how.textContent = "";
  check.textContent = "Checking each call against Base…";
  progress.replaceChildren();
  confirm.hidden = false;
  showBack(state);
  update();
  dialog.showModal();
  const { address, provider } = connection;
  batches(provider, address).then((batch) => {
    if (current !== state) return;
    state.batch = batch;
    how.textContent =
      calls.length === 1
        ? "One transaction:"
        : batch
          ? `One transaction, with ${calls.length} calls:`
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
      if (current === state) check.textContent = "The calls could not be checked: no Base RPC answered. Try again.";
    });
}

/** Updates the main button: disabled until the calls are checked, and a switch while the wallet is on another chain. */
export function update(): void {
  if (!current) return;
  const wrongChain = current.connection.chainId !== CHAIN_ID;
  confirm.textContent = wrongChain ? "Switch to Base" : "Confirm in your wallet";
  confirm.disabled = !current.checked || current.batch === undefined || current.sending;
}

/** Closes the review, as when the wallet changes account. */
export function close(): void {
  if (dialog.open) dialog.close();
}

/** The second button: off while the wallet asks, then "Close" once anything was sent. */
function showBack(state: Review): void {
  if (current !== state) return;
  back.disabled = state.asking;
  back.textContent = state.submitted ? "Close" : "Back";
}

confirm.addEventListener("click", () => {
  const state = current;
  if (!state) return;
  if (state.connection.chainId !== CHAIN_ID) {
    switchToBase(state.connection).then(update, (error) => say(failure(error)));
    return;
  }
  const { provider, address } = state.connection;
  const calls = state.steps.map(({ to, data }) => ({ to, data }));
  const total = calls.length;
  const hashes: Hex[] = [];
  // Messages go to this review only: it may have closed, and another opened.
  const tell = (message: string, links: Hex[] = []) => current === state && say(message, links);
  const asking = (index: number) => {
    if (current !== state) return false;
    state.asking = true;
    showBack(state);
    tell(index ? `${index} of ${total} included. Waiting for your wallet…` : "Waiting for your wallet…");
    return true;
  };
  const sent = (hash?: Hex) => {
    if (hash) hashes.push(hash);
    state.asking = false;
    state.submitted = true;
    showBack(state);
    tell(
      state.batch || total === 1 ? "Sent. Waiting for Base to include it…" : `${hashes.length} of ${total} sent…`,
      hashes,
    );
  };
  state.sending = true;
  // The wallet's request comes first, with no wait since the click: Coinbase's window only opens from a click.
  const sending = state.batch
    ? (asking(0), sendBatch(provider, address, calls, () => sent()))
    : sendEach(provider, address, calls, asking, sent);
  update();
  sending
    .then((all) => {
      tell("Done.", all);
      if (current === state) confirm.hidden = true;
    })
    .catch((error) => {
      const links = error instanceof Failed ? error.hashes : hashes;
      const partly =
        hashes.length && hashes.length < total ? ` ${hashes.length} of ${total} transactions went through.` : "";
      tell(`${failure(error)}${partly}`, links);
      // Once anything went through, the calls checked are no longer the ones to send.
      if (current === state && state.submitted) confirm.hidden = true;
    })
    .finally(() => {
      state.sending = false;
      state.asking = false;
      if (current === state) {
        update();
        showBack(state);
      } else if (state.submitted) state.closed(true);
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

// Escape closes the dialog, but not while the wallet asks.
dialog.addEventListener("cancel", (event) => {
  if (current?.asking) event.preventDefault();
});

dialog.addEventListener("close", () => {
  const state = current;
  current = undefined;
  state?.closed(state.submitted);
});
