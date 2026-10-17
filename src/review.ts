import type { Hex } from "viem";
import { included } from "./chain.ts";
import { CHAIN_ID } from "./config.ts";
import { clone, fill, txLink } from "./dom.ts";
import { count, listParts } from "./format.ts";
import type { Step } from "./hydrex.ts";
import { declined, sendTransaction, switchToBase, type Connection, type Wallet } from "./wallet.ts";

export type Hooks = { closed(submitted: boolean): void; switched(): void };
// The last page also shows the calls, and Confirm.
export type Page = { title: string; body?: DocumentFragment };

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
const key = part(".key");
const doneBox = part(".done");
const progress = part(".progress");
const next = part<HTMLButtonElement>(".next");
const confirm = part<HTMLButtonElement>(".confirm");
const back = part(".back");
let current: Review | undefined;

// Names each automation in the calls by its address, as the wallet will show it.
function explain(steps: Step[]): void {
  const conduits = [...new Map(steps.map((step) => [step.conduit.toLowerCase(), step])).values()];
  const named = conduits.map(({ conduit, automation }) => {
    const code = document.createElement("code");
    code.translate = false;
    code.textContent = conduit;
    return [code, ` is ${automation ? `the ${automation} automation` : "Carbon Impact"}`];
  });
  key.replaceChildren(`In ${steps.length === 1 ? "this call" : "these calls"}, `);
  // The list's words come from list(); its items are the addresses and their names.
  let i = 0;
  for (const { type, value } of listParts(named.map((_, n) => String(n)))) {
    key.append(...(type === "element" ? named[i++]! : [value]));
  }
  key.append(".");
}

export function review(
  name: string,
  pages: Page[],
  steps: Step[],
  connection: Connection,
  hooks: Hooks,
  outcome?: DocumentFragment,
): void {
  const titles = pages.map(({ title }) => title);
  current = {
    name,
    titles,
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
  stepList.replaceChildren(
    ...steps.map(({ says, shows, on }) => {
      const item = clone("step");
      fill(item, { says, shows, on });
      return item;
    }),
  );
  explain(steps);
  how.textContent = connection.wallet.propose
    ? n === 1
      ? "One Safe transaction:"
      : `One Safe transaction, with ${n} calls:`
    : n === 1
      ? "One transaction:"
      : `${count(n, "transaction", "transactions")}, one after the other:`;
  progress.replaceChildren();
  turn(0);
  dialog.showModal();
}

function turn(page: number): void {
  if (!current) return;
  const { name, titles } = current;
  current.page = page;
  title.textContent = titles[page]!;
  stepCount.textContent = `${name}: step ${page + 1} of ${titles.length}`;
  stepCount.hidden = titles.length === 1;
  [...pageList.children].forEach((element, i) => ((element as HTMLElement).hidden = i !== page));
  calls.hidden = page < titles.length - 1;
  update();
  if (dialog.open) title.focus();
}

export function update(): void {
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

export const close = (): void => dialog.close();

// A review may have closed, and another opened, by the time its wallet answers.
function tell(state: Review, message: string, hashes: Hex[] = []): void {
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
  tell(state, "Waiting for your wallet…");
  await proposing;
  state.submitted = state.finished = true;
  tell(state, "Proposed. The Safe's owners sign it in Safe{Wallet}; the accounts here change once it executes.");
}

async function sendNext(state: Review): Promise<void> {
  const { steps, done } = state;
  const sending = sendTransaction(state.connection, steps[done.length]!);
  tell(state, "Waiting for your wallet…", done);
  const hash = await sending;
  const hashes = [...done, hash];
  const which = steps.length === 1 ? "Sent" : `Transaction ${hashes.length} of ${steps.length} sent`;
  state.submitted = true;
  update();
  tell(state, `${which}. Waiting for Base to include it…`, hashes);
  const ok = await included(hash);
  if (ok) done.push(hash);
  state.finished = !ok || done.length === steps.length;
  if (ok === undefined) tell(state, "Sent. Your wallet shows when Base includes it; reload this page then.", hashes);
  else if (!ok) tell(state, `A transaction failed on Base.${wentThrough(state)}`, hashes);
  else if (state.finished) {
    tell(state, "Done.", done);
    if (state === current && state.outcome) {
      doneBox.replaceChildren(state.outcome);
      doneBox.hidden = false;
    }
  } else {
    const next = `Confirm transaction ${done.length + 1} when you are ready; closing stops here.`;
    tell(state, `Transaction ${done.length} of ${steps.length} is included. ${next}`, done);
  }
}

confirm.addEventListener("click", () => {
  const state = current;
  if (!state) return;
  // The wallet's request comes first, with no wait since the click: a wallet that opens a window opens it only from a
  // click. That is also why each transaction takes a click of its own.
  const { propose } = state.connection.wallet;
  const sending =
    state.connection.chainId !== CHAIN_ID
      ? switchToBase(state.connection).then(state.hooks.switched)
      : propose
        ? proposeAll(state, propose)
        : sendNext(state);
  state.sending = true;
  update();
  sending
    .catch((error) => tell(state, failure(error) + wentThrough(state), state.done))
    .finally(() => {
      state.sending = false;
      if (state === current) update();
      else state.hooks.closed(state.submitted);
    });
});

next.addEventListener("click", () => current && turn(current.page + 1));

// While the wallet is asked, or once something was sent, Back closes the review: the page sends nothing more, and
// follows what it sent.
back.addEventListener("click", () => {
  if (current && !current.sending && !current.submitted && current.page > 0) turn(current.page - 1);
  else close();
});

dialog.addEventListener("close", () => {
  const state = current;
  current = undefined;
  // One still sending tells the page when it ends.
  if (state && !state.sending) state.hooks.closed(state.submitted);
});
