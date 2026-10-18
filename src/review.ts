import type { Hex } from "viem";
import { waitForTransaction } from "./chain.ts";
import { CHAIN_ID } from "./config.ts";
import { clone, fill, show, showHex, txLink } from "./dom.ts";
import { count } from "./format.ts";
import type { Step } from "./hydrex.ts";
import { declined, sendTransaction, switchToBase, type Connection, type Wallet } from "./wallet.ts";

export type Hooks = { closed(submitted: boolean): void; switched(): void };
// The last page also shows the calls and the Confirm button.
export type ReviewPage = { title: string; body?: DocumentFragment };

type Review = {
  name: string;
  titles: string[];
  page: number;
  // Shown once every transaction is included.
  outcome?: DocumentFragment | undefined;
  steps: Step[];
  connection: Connection;
  hooks: Hooks;
  done: Hex[];
  sending: boolean;
  submitted: boolean;
  finished: boolean;
};

const dialog = document.getElementById("review") as HTMLDialogElement;
const part = <T extends HTMLElement = HTMLElement>(selector: string) => dialog.querySelector<T>(selector)!;
const title = part("h2");
const stepCount = part(".step-count");
const pageList = part(".pages");
const calls = part(".calls");
const callsTitle = part(".calls h3");
const how = part(".how");
const stepList = part(".steps");
const doneBox = part(".done");
const progress = part(".progress");
const next = part<HTMLButtonElement>(".next");
const confirm = part<HTMLButtonElement>(".confirm");
const back = part(".back");
let current: Review | undefined;

// A call as the wallet will show it. In a Safe, the Safe transaction's fields and calldata follow, for co-signers to
// compare with Safe{Wallet}.
function slip(step: Step, i: number, n: number, safe: boolean): DocumentFragment {
  const item = clone("step");
  const which = n > 1 ? ` · ${safe ? "call " : ""}${i + 1} of ${n}` : "";
  fill(item, {
    count: safe ? `In a Safe${which || " · one transaction to sign"}` : `Your wallet will ask${which}`,
    says: step.says,
    on: step.on,
    "conduit-name": step.automation ? `The ${step.automation} automation` : "Carbon Impact",
    account: String(step.id),
    approve: String(step.approve),
    call: `The call above, in ${(step.data.length - 2) / 2} bytes:`,
    "slip-note": `The selector, then each 32-byte word on two lines: the conduit, ${step.id} as ${step.id.toString(16)}, and ${step.approve} as ${Number(step.approve)}.`,
  });
  showHex(item.querySelector(".to")!, step.to);
  showHex(item.querySelector(".conduit")!, step.conduit);
  showHex(item.querySelector(".data")!, step.data);
  show(".raw, .slip-note", safe, item);
  show(".operation", safe && n === 1, item);
  return item;
}

export function openReview(
  name: string,
  pages: ReviewPage[],
  steps: Step[],
  connection: Connection,
  hooks: Hooks,
  outcome?: DocumentFragment,
): void {
  current = {
    name,
    titles: pages.map(({ title }) => title),
    page: 0,
    outcome,
    steps,
    connection,
    hooks,
    done: [],
    sending: false,
    submitted: false,
    finished: false,
  };
  const n = steps.length;
  pageList.replaceChildren(
    ...pages.map(({ body }) => {
      const page = document.createElement("div");
      if (body) page.append(body);
      return page;
    }),
  );
  callsTitle.hidden = !pages.at(-1)?.body;
  doneBox.replaceChildren();
  doneBox.hidden = true;
  const safe = !!connection.wallet.propose;
  stepList.replaceChildren(...steps.map((step, i) => slip(step, i, n, safe)));
  how.textContent = safe
    ? n === 1
      ? "One Safe transaction. Safe{Wallet} sets its nonce; its other fields are these:"
      : `One Safe transaction, with ${n} calls. Safe{Wallet} sends them through its MultiSend contract, with operation 1, and sets the nonce. The calls:`
    : n === 1
      ? "One transaction:"
      : `${count(n, "transaction", "transactions")}, one after the other:`;
  progress.replaceChildren();
  showPage(0);
  dialog.showModal();
}

function showPage(page: number): void {
  if (!current) return;
  const { name, titles } = current;
  current.page = page;
  title.textContent = titles[page]!;
  stepCount.textContent = `${name}: step ${page + 1} of ${titles.length}`;
  stepCount.hidden = titles.length === 1;
  [...pageList.children].forEach((element, i) => ((element as HTMLElement).hidden = i !== page));
  calls.hidden = page < titles.length - 1;
  refreshReview();
  if (dialog.open) title.focus();
}

export function refreshReview(): void {
  if (!current) return;
  const { connection, steps, done, sending, submitted, finished, page, titles } = current;
  const last = page === titles.length - 1;
  const safe = !!connection.wallet.propose;
  const wrongChain = connection.chainId !== CHAIN_ID;
  confirm.textContent = safe
    ? "Propose in Safe{Wallet}"
    : wrongChain
      ? "Switch to Base"
      : steps.length === 1
        ? "Confirm in your wallet"
        : `Confirm transaction ${done.length + 1} of ${steps.length}`;
  confirm.disabled = sending || (safe && wrongChain);
  confirm.hidden = !last || finished;
  next.hidden = last;
  back.textContent = submitted ? "Close" : "Back";
}

export const closeReview = (): void => dialog.close();

// The review may have closed, or another opened, by the time the wallet answers.
function say(state: Review, message: string, hashes: Hex[] = []): void {
  if (state !== current) return;
  progress.replaceChildren(message);
  hashes.forEach((hash, i) => {
    progress.append(i ? ", " : hashes.length === 1 ? " Transaction: " : " Transactions: ", txLink(hash));
  });
  if (hashes.length) progress.append(".");
}

const wentThrough = ({ done, steps }: Review): string =>
  done.length ? ` ${done.length} of ${steps.length} transactions went through.` : "";

function failure(error: unknown): string {
  if (declined(error)) return "You said no in your wallet.";
  console.error(error);
  const message = (error as { message?: string } | undefined)?.message;
  return message ? `Your wallet answered: “${message}”` : "Your wallet did not answer.";
}

async function proposeAll(state: Review, propose: NonNullable<Wallet["propose"]>): Promise<void> {
  const proposing = propose(state.steps);
  say(state, "Waiting for your wallet…");
  await proposing;
  state.submitted = state.finished = true;
  say(state, "Proposed. The Safe's owners sign it in Safe{Wallet}; the accounts here change once it executes.");
  if (state !== current) return;
  doneBox.replaceChildren(clone("proposed"));
  doneBox.hidden = false;
}

async function sendNext(state: Review): Promise<void> {
  const { steps, done } = state;
  const sending = sendTransaction(state.connection, steps[done.length]!);
  say(state, "Waiting for your wallet…", done);
  const hash = await sending;
  const hashes = [...done, hash];
  const which = steps.length === 1 ? "Sent" : `Transaction ${hashes.length} of ${steps.length} sent`;
  state.submitted = true;
  refreshReview();
  say(state, `${which}. Waiting for Base to include it…`, hashes);
  const ok = await waitForTransaction(hash);
  if (ok) done.push(hash);
  state.finished = !ok || done.length === steps.length;
  if (ok === undefined) say(state, "Sent. Your wallet shows when Base includes it; reload this page then.", hashes);
  else if (!ok) say(state, `A transaction failed on Base.${wentThrough(state)}`, hashes);
  else if (state.finished) {
    say(state, "Done.", done);
    if (state === current && state.outcome) {
      doneBox.replaceChildren(state.outcome);
      doneBox.hidden = false;
    }
  } else {
    const next = `Confirm transaction ${done.length + 1} when you are ready; closing stops here.`;
    say(state, `Transaction ${done.length} of ${steps.length} is included. ${next}`, done);
  }
}

confirm.addEventListener("click", () => {
  const state = current;
  if (!state) return;
  // Ask the wallet right away: some wallets open their window only in response to a click. That is also why each
  // transaction takes a click of its own.
  const { propose } = state.connection.wallet;
  const sending =
    state.connection.chainId !== CHAIN_ID
      ? switchToBase(state.connection).then(state.hooks.switched)
      : propose
        ? proposeAll(state, propose)
        : sendNext(state);
  state.sending = true;
  refreshReview();
  sending
    .catch((error) => say(state, failure(error) + wentThrough(state), state.done))
    .finally(() => {
      state.sending = false;
      if (state === current) refreshReview();
      else state.hooks.closed(state.submitted);
    });
});

next.addEventListener("click", () => current && showPage(current.page + 1));

// Once something was sent, or while the wallet is asked, Back closes the review. The page then sends nothing more, but
// keeps following what it sent.
back.addEventListener("click", () => {
  if (current && !current.sending && !current.submitted && current.page > 0) showPage(current.page - 1);
  else closeReview();
});

// A link to a section closes the review, so that the section shows, and Back returns to the accounts as they were.
// While the wallet is asked, or between transactions, closing would stop the rest, so the link opens in a new tab.
dialog.addEventListener("click", (event) => {
  const link = (event.target as Element).closest<HTMLAnchorElement>('a[href^="#"]');
  if (!link || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
  if (current && (current.sending || (current.submitted && !current.finished))) {
    event.preventDefault();
    open(link.href, "_blank", "noopener");
  } else closeReview();
});

dialog.addEventListener("close", () => {
  const state = current;
  current = undefined;
  // A review that is still sending calls closed() when it ends.
  if (state && !state.sending) state.hooks.closed(state.submitted);
});
