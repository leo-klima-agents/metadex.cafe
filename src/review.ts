import type { Hex } from "viem";
import { waitForReceipt, type Receipt } from "./chain.ts";
import { CHAIN_ID } from "./config.ts";
import { clone, fill, show, showHex, txLink } from "./dom.ts";
import { count } from "./format.ts";
import {
  callsStatus,
  capabilities,
  declined,
  sendCalls,
  sendTransaction,
  switchToBase,
  type Capabilities,
  type CallsStatus,
  type Connection,
  type Tx,
  type Wallet,
} from "./wallet.ts";

// A field of a call as the wallet shows it: an address, a number or a list of them, in the mono face, or words, which
// may hold addresses. `under` names what the field holds, such as the contract an address is. `name` is the class of
// its value, and of its `under` with "-name" after it.
export type Field = {
  label: string;
  name?: string;
  code?: string | string[];
  words?: (string | { code: string })[];
  under?: string;
};
// A call: the page's own words, the contract it goes to, and its fields. `note` says how its calldata reads, for
// co-signers.
export type Slip = Tx & { says: string; on: string; call: string; fields: Field[]; note?: string };

export type Hooks = { closed(submitted: boolean): void; switched(): void };
// The last page also shows the calls and the Confirm button.
export type ReviewPage = { title: string; body?: DocumentFragment };

export type ReviewOptions = {
  name: string;
  pages: ReviewPage[];
  steps: Slip[];
  // Where the product's page explains the calls, for the slips and the co-signers.
  checkHref: string;
  connection: Connection;
  hooks: Hooks;
  // Shown once every transaction is included.
  outcome?: DocumentFragment | undefined;
  // Once every transaction is included, the outcome from their receipts, shown instead of `outcome`.
  outcomeOf?(receipts: Receipt[]): Promise<DocumentFragment | undefined>;
  // Before the call at `i` is sent on its own, once the one before is included: a fresh call to send instead, and,
  // when it differs from what the review showed, the words that say how, which wait for another click.
  prepare?(i: number): Promise<{ step: Slip; changed?: string } | undefined>;
  // Whether calls sent in one prompt must go through all together or not at all, where the wallet can.
  atomic?: boolean;
};

type Review = ReviewOptions & {
  titles: string[];
  page: number;
  // How the wallet sends them, once known: one prompt for all the calls, or one each.
  capabilities?: Capabilities;
  batch: boolean;
  done: Hex[];
  receipts: Receipt[];
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

const HEX = /^0x([0-9a-fA-F]{40}|[0-9a-fA-F]{64})$/;

function codeOf(text: string, name?: string): HTMLElement {
  const code = document.createElement("code");
  code.translate = false;
  if (name) code.className = name;
  if (HEX.test(text)) showHex(code, text);
  else code.textContent = text;
  return code;
}

function fieldOf({ label, name, code, words, under }: Field): DocumentFragment {
  const row = clone("field");
  row.querySelector("dt")!.textContent = label;
  const value = row.querySelector("dd")!;
  if (code !== undefined) {
    const lines = Array.isArray(code) ? code : [code];
    lines.forEach((line, i) => {
      if (i) value.append(document.createElement("br"));
      value.append(codeOf(line, Array.isArray(code) ? undefined : name));
    });
    if (Array.isArray(code) && name) value.classList.add(name);
    if (!lines.length) value.append("None");
  }
  if (words) {
    const span = document.createElement("span");
    span.className = `words${name ? ` ${name}` : ""}`;
    span.append(...words.map((word) => (typeof word === "string" ? word : codeOf(word.code))));
    value.append(span);
  }
  if (under !== undefined) {
    const below = document.createElement("span");
    below.className = `under${name ? ` ${name}-name` : ""}`;
    below.textContent = under;
    value.append(document.createElement("br"), below);
  }
  return row;
}

// A call as the wallet will show it. In a Safe, the Safe transaction's fields and calldata follow, for co-signers to
// compare with Safe{Wallet}.
function slip(step: Slip, i: number, n: number, safe: boolean, checkHref: string): DocumentFragment {
  const item = clone("step");
  const which = n > 1 ? ` · ${safe ? "call " : ""}${i + 1} of ${n}` : "";
  fill(item, {
    count: safe ? `In a Safe${which || " · one transaction to sign"}` : `Your wallet will ask${which}`,
    says: step.says,
    on: step.on,
    function: step.call,
    call: `The call above, in ${(step.data.length - 2) / 2} bytes:`,
    "slip-note": step.note ?? "The selector, then each 32-byte word on two lines.",
  });
  showHex(item.querySelector(".to")!, step.to);
  showHex(item.querySelector(".data")!, step.data);
  item.querySelector(".value-row")!.before(...step.fields.map(fieldOf));
  item.querySelector(".check-calls")!.setAttribute("href", checkHref);
  show(".raw, .slip-note", safe, item);
  show(".operation", safe && n === 1, item);
  return item;
}

function drawSlips(state: Review): void {
  const { steps, connection, checkHref } = state;
  const safe = !!connection.wallet.propose;
  stepList.replaceChildren(...steps.map((step, i) => slip(step, i, steps.length, safe, checkHref)));
}

// The review shown, while nothing is sent yet, can take other calls, as when its owner picks another way to be paid.
export type Opened = {
  replace(steps: Slip[], options?: Pick<ReviewOptions, "atomic" | "outcomeOf" | "prepare">): void;
};

export function openReview(options: ReviewOptions): Opened {
  // A review opened over another, as a swap from a claim's receipt, ends that one: what it sent still updates the page.
  const previous = current;
  if (previous && !previous.sending) previous.hooks.closed(previous.submitted);
  const state: Review = {
    ...options,
    titles: options.pages.map(({ title }) => title),
    page: 0,
    batch: false,
    done: [],
    receipts: [],
    sending: false,
    submitted: false,
    finished: false,
  };
  current = state;
  pageList.replaceChildren(
    ...options.pages.map(({ body }) => {
      const page = document.createElement("div");
      if (body) page.append(body);
      return page;
    }),
  );
  callsTitle.hidden = !options.pages.at(-1)?.body;
  doneBox.replaceChildren();
  doneBox.hidden = true;
  drawSlips(state);
  progress.replaceChildren();
  showPage(0);
  dialog.showModal();
  // Several calls go in one prompt where the wallet can send them so.
  void capabilities(options.connection).then((found) => {
    if (state !== current || state.sending || state.submitted) return;
    state.capabilities = found;
    state.batch = found.batch && state.steps.length > 1;
    refreshReview();
  });
  return {
    replace(steps, more = {}) {
      if (state !== current || state.sending || state.submitted) return;
      Object.assign(state, { steps, atomic: undefined, outcomeOf: undefined, prepare: undefined, ...more });
      state.batch = !!state.capabilities?.batch && steps.length > 1;
      drawSlips(state);
      refreshReview();
    },
  };
}

function showPage(page: number): void {
  if (!current) return;
  const { name, titles } = current;
  current.page = page;
  title.textContent = titles[page]!;
  stepCount.textContent = `${name}: step ${page + 1} of ${titles.length}`;
  stepCount.hidden = titles.length === 1;
  [...pageList.children].forEach((element, i) => ((element as HTMLElement).hidden = i !== page));
  // A review with nothing to send has no calls to show.
  calls.hidden = page < titles.length - 1 || !current.steps.length;
  refreshReview();
  if (dialog.open) title.focus();
}

const atomic = (state: Review): boolean => !!state.atomic && !!state.capabilities?.atomic;

function howText(state: Review): string {
  const n = state.steps.length;
  if (state.connection.wallet.propose) {
    return n === 1
      ? "One Safe transaction. Safe{Wallet} sets its nonce; its other fields are these:"
      : `One Safe transaction, with ${n} calls. Safe{Wallet} sends them through its MultiSend contract, with operation 1, and sets the nonce. The calls:`;
  }
  if (state.batch) {
    return `One prompt, with ${n} calls${atomic(state) ? ", which go through together or not at all" : ", sent one after the other"}:`;
  }
  return n === 1 ? "One transaction:" : `${count(n, "transaction", "transactions")}, one after the other:`;
}

export function refreshReview(): void {
  if (!current) return;
  const { connection, steps, done, sending, submitted, finished, page, titles, batch } = current;
  const last = page === titles.length - 1;
  const safe = !!connection.wallet.propose;
  const wrongChain = connection.chainId !== CHAIN_ID;
  how.textContent = howText(current);
  confirm.textContent = safe
    ? "Propose in Safe{Wallet}"
    : wrongChain
      ? "Switch to Base"
      : steps.length === 1 || batch
        ? "Confirm in your wallet"
        : `Confirm transaction ${done.length + 1} of ${steps.length}`;
  confirm.disabled = sending || (safe && wrongChain);
  confirm.hidden = !last || finished || !steps.length;
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

const wentThrough = ({ done, steps, batch }: Review): string =>
  done.length && !batch ? ` ${done.length} of ${steps.length} transactions went through.` : "";

function failure(error: unknown): string {
  if (declined(error)) return "You said no in your wallet.";
  console.error(error);
  const message = (error as { message?: string } | undefined)?.message;
  return message ? `Your wallet answered: “${message}”` : "Your wallet did not answer.";
}

// Errors of a wallet that cannot send these calls in one prompt after all: the method, its version's parameters, all
// or nothing, Base, so many calls, or the upgrade of the account it would need, which its owner declined.
const UNBATCHED = [4200, -32601, -32602, 5700, 5710, 5740, 5750, 5760];
const unbatched = (error: unknown): boolean => {
  const { code } = (error ?? {}) as { code?: number };
  return code !== undefined && UNBATCHED.includes(code);
};

async function proposeAll(state: Review, propose: NonNullable<Wallet["propose"]>): Promise<void> {
  const proposing = propose(state.steps);
  say(state, "Waiting for your wallet…");
  await proposing;
  state.submitted = state.finished = true;
  say(state, "Proposed. The Safe's owners sign it in Safe{Wallet}; this page changes once it executes.");
  if (state !== current) return;
  const proposed = clone("proposed");
  proposed.querySelector(".co-signers")!.setAttribute("href", state.checkHref);
  proposed.querySelector(".co-signers-address")!.textContent = `https://metadex.cafe/${state.checkHref}`;
  doneBox.replaceChildren(proposed);
  doneBox.hidden = false;
}

// Once every transaction is included: the outcome, from the receipts where the review reads them.
async function finish(state: Review): Promise<void> {
  say(state, "Done.", state.done);
  const outcome = state.receipts.length
    ? await state.outcomeOf?.(state.receipts).catch((error: unknown) => void console.error(error))
    : undefined;
  const shown = outcome ?? state.outcome;
  if (state === current && shown) {
    doneBox.replaceChildren(shown);
    doneBox.hidden = false;
  }
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
  const receipt = await waitForReceipt(hash);
  const ok = receipt && receipt.status === "0x1";
  if (receipt && ok) {
    done.push(hash);
    state.receipts.push(receipt);
  }
  state.finished = !ok || done.length === steps.length;
  if (!receipt) say(state, "Sent. Your wallet shows when Base includes it; reload this page then.", hashes);
  else if (!ok) say(state, `A transaction failed on Base.${wentThrough(state)}`, hashes);
  else if (state.finished) await finish(state);
  else {
    let next = `Confirm transaction ${done.length + 1} when you are ready; closing stops here.`;
    const fresh = await state.prepare?.(done.length).catch((error: unknown) => void console.error(error));
    if (fresh) {
      steps[done.length] = fresh.step;
      if (state === current) drawSlips(state);
      if (fresh.changed) next = `${fresh.changed} ${next}`;
    }
    say(state, `Transaction ${done.length} of ${steps.length} is included. ${next}`, done);
  }
}

// A batch takes a while to be included, and the wallet reports it: the page asks every two seconds, for ten minutes.
async function waitForCalls(connection: Connection, id: string): Promise<CallsStatus | undefined> {
  const end = Date.now() + 10 * 60_000;
  while (Date.now() < end) {
    const status = await callsStatus(connection, id).catch((error: unknown) => void console.error(error));
    if (status && status.state !== "pending") return status;
    await new Promise((done) => setTimeout(done, 2_000));
  }
  return undefined;
}

async function sendBatch(state: Review): Promise<void> {
  const sending = sendCalls(state.connection, state.steps, atomic(state));
  say(state, "Waiting for your wallet…");
  let id: string;
  try {
    id = await sending;
  } catch (error) {
    if (!unbatched(error)) throw error;
    // The calls then go one by one, from the next click.
    state.batch = false;
    refreshReview();
    return say(state, "Your wallet could not send the calls in one prompt. Confirm them one by one instead.");
  }
  state.submitted = true;
  refreshReview();
  say(state, "Sent in one prompt. Waiting for Base to include it…");
  const status = await waitForCalls(state.connection, id);
  state.finished = true;
  const hashes = status?.receipts.map(({ transactionHash }) => transactionHash) ?? [];
  if (!status) return say(state, "Sent. Your wallet shows when Base includes it; reload this page then.");
  if (status.state === "failed")
    return say(state, "The calls failed on Base, or your wallet did not send them.", hashes);
  state.done = hashes;
  state.receipts = status.receipts;
  await finish(state);
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
        : state.batch
          ? sendBatch(state)
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
