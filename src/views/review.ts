import type { Hex } from "viem";
import { waitForReceipt, type Receipt } from "../chain.ts";
import { CHAIN_ID } from "../config.ts";
import { clone, fill, show, showHex, showWalletAddress, txLink } from "../dom.ts";
import { count } from "../format.ts";
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
} from "../wallet.ts";

// A field of a call as the wallet shows it: an address, a number or a list of them, in the mono face, or words.
// `description` says what the field holds, above it, such as the contract an address is; a list's items can each have a
// tag above them too, such as a token's symbol. `name` is the class of its value, and of its description with "-name"
// after it.
export type Field = {
  label: string;
  name?: string;
  code?: string | string[];
  tags?: string[];
  words?: string;
  description?: string;
};
// A call: what it is, as "Token approval" or "Swap into USDC", the page's own words, the contract it goes to, and its
// fields.
export type Slip = Tx & { title: string; says: string; on: string; call: string; fields: Field[] };

export type Hooks = { closed(submitted: boolean): void; switched(): void };
// The last page also shows the calls and the Sign button. A page without a title is the calls': "Transactions", or
// "Transaction" for one.
export type ReviewPage = { title?: string; body?: DocumentFragment };

export type ReviewOptions = {
  // Above each page's title, in capitals, but for the code in it, such as a token's symbol: "Swap into cbBTC".
  name: string | (string | { code: string })[];
  pages: ReviewPage[];
  steps: Slip[];
  // Where the product's page explains the calls, for the co-signers.
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
  // Calls that need more gas together than one transaction may use, as the parts of a large claim, go in groups that
  // each fit one: `groups` counts the calls of each, in order. A wallet then sends the calls one at a time, as it may
  // run the calls of one prompt as one transaction, and a Safe proposes a Safe transaction for each group.
  groups?: number[];
};

type Review = ReviewOptions & {
  titles: (string | undefined)[];
  page: number;
  // How the wallet sends them, once known: one prompt for all the calls, or one each.
  capabilities?: Capabilities;
  batch: boolean;
  done: Hex[];
  // How many of the groups a Safe proposed.
  proposed: number;
  receipts: Receipt[];
  sending: boolean;
  submitted: boolean;
  finished: boolean;
  // The call the Sign button sends next, as its slip is marked, once scrolled to.
  shown: number;
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

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const HASH = /^0x[0-9a-fA-F]{64}$/;

function newCode(name?: string): HTMLElement {
  const code = document.createElement("code");
  code.translate = false;
  if (name) code.className = name;
  return code;
}

// A field's address is laid out as the wallet will show it, for the two to be compared line by line.
function codeOf(text: string, name?: string): HTMLElement {
  const code = newCode(name);
  if (ADDRESS.test(text)) showWalletAddress(code, text);
  else if (HASH.test(text)) showHex(code, text);
  else code.textContent = text;
  return code;
}

// Code within words, such as a token's symbol in the review's name, keeps to the text's lines.
function inlineCode(text: string): HTMLElement {
  const code = newCode();
  if (ADDRESS.test(text) || HASH.test(text)) showHex(code, text);
  else code.textContent = text;
  return code;
}

// A list of addresses, in as many columns as fit, each under its tag when it has one.
function listOf(items: string[], tags: string[] = []): HTMLElement {
  const list = document.createElement("span");
  list.className = "code-list";
  list.append(
    ...items.map((item, i) => {
      const cell = document.createElement("span");
      const tag = tags[i];
      if (tag) cell.append(Object.assign(newCode("tag"), { textContent: tag }));
      cell.append(codeOf(item));
      return cell;
    }),
  );
  return list;
}

function fieldOf({ label, name, code, tags, words, description }: Field): DocumentFragment {
  const row = clone("field");
  row.querySelector("dt")!.textContent = label;
  const value = row.querySelector("dd")!;
  if (description !== undefined) {
    const above = document.createElement("span");
    above.className = `description${name ? ` ${name}-name` : ""}`;
    above.textContent = description;
    value.append(above);
  }
  if (Array.isArray(code)) {
    if (name) value.classList.add(name);
    value.append(code.length ? listOf(code, tags) : "None");
  } else if (code !== undefined) value.append(codeOf(code, name));
  if (words)
    value.append(
      Object.assign(document.createElement("span"), {
        className: `words${name ? ` ${name}` : ""}`,
        textContent: words,
      }),
    );
  return row;
}

// Calls in several groups, each a transaction of its own.
const apart = ({ groups }: Pick<Review, "groups">): boolean => (groups?.length ?? 1) > 1;

// A call as the wallet will show it, as a bill, with the addresses the wallet shows. In a Safe, the Safe transaction's
// fields and calldata follow, for co-signers to compare with Safe{Wallet}; `safe` names the Safe transaction it is in,
// and `alone` whether it is its only call.
function slip(step: Slip, i: number, n: number, safe: string | undefined, alone: boolean) {
  const item = clone("step");
  // In a Safe, the calls are in its transactions; otherwise each is a transaction of its own.
  const which = `${safe ? "Call" : "Transaction"}${n > 1 ? ` ${i + 1} of ${n}` : ""}`;
  fill(item, {
    count: `${safe ? `${safe} · ` : ""}${which} · ${step.title}`,
    says: step.says,
    on: step.on,
    function: step.call,
    call: `${(step.data.length - 2) / 2} bytes`,
  });
  showWalletAddress(item.querySelector(".to")!, step.to);
  showHex(item.querySelector(".data")!, step.data);
  item.querySelector(".value-row")!.before(...step.fields.map(fieldOf));
  show(".raw", !!safe, item);
  show(".operation", !!safe && alone, item);
  return item;
}

function drawSlips(state: Review): void {
  const { steps, connection } = state;
  const groups = state.groups ?? [steps.length];
  // The Safe transaction each call is in.
  const group = groups.flatMap((size, g) => Array.from({ length: size }, () => g));
  stepList.replaceChildren(
    ...steps.map((step, i) => {
      const g = group[i] ?? 0;
      const safe = connection.wallet.propose && (apart(state) ? `Safe ${g + 1} of ${groups.length}` : "Safe");
      return slip(step, i, steps.length, safe || undefined, groups[g] === 1);
    }),
  );
  markNext(state);
}

// Which call the Sign button sends next, when it sends them one at a time: its slip is marked, and scrolled to once
// the one before is included.
function markNext(state: Review): void {
  const { steps, done, batch, finished, connection } = state;
  const next = connection.wallet.propose || batch || finished || steps.length < 2 ? undefined : done.length;
  [...stepList.children].forEach((item, i) => {
    item.classList.toggle("next-call", i === next);
    if (i === next) item.setAttribute("aria-current", "step");
    else item.removeAttribute("aria-current");
  });
  if (next === undefined || next === state.shown) return;
  state.shown = next;
  if (next && !calls.hidden) stepList.children[next]?.scrollIntoView({ behavior: "smooth", block: "start" });
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
    proposed: 0,
    receipts: [],
    sending: false,
    submitted: false,
    finished: false,
    shown: 0,
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
  pageList.hidden = false;
  drawSlips(state);
  progress.replaceChildren();
  showPage(0);
  dialog.showModal();
  // Several calls go in one prompt where the wallet can send them so.
  void capabilities(options.connection).then((found) => {
    if (state !== current || state.sending || state.submitted) return;
    state.capabilities = found;
    state.batch = found.batch && state.steps.length > 1 && !apart(state);
    refreshReview();
  });
  return {
    replace(steps, more = {}) {
      if (state !== current || state.sending || state.submitted) return;
      Object.assign(state, { steps, atomic: undefined, outcomeOf: undefined, prepare: undefined, ...more });
      state.batch = !!state.capabilities?.batch && steps.length > 1 && !apart(state);
      drawSlips(state);
      refreshReview();
    },
  };
}

function showPage(page: number): void {
  if (!current) return;
  const { name, titles } = current;
  current.page = page;
  title.textContent = titles[page] ?? callsName(current);
  const words = typeof name === "string" ? [name] : name;
  stepCount.replaceChildren(
    ...words.map((word) => (typeof word === "string" ? word : inlineCode(word.code))),
    ` · ${page + 1} of ${titles.length}`,
  );
  stepCount.hidden = titles.length === 1;
  [...pageList.children].forEach((element, i) => ((element as HTMLElement).hidden = i !== page));
  // A review with nothing to send has no calls to show.
  calls.hidden = page < titles.length - 1 || !current.steps.length;
  refreshReview();
  if (dialog.open) title.focus();
}

const callsName = ({ steps }: Review): string => (steps.length === 1 ? "Transaction" : "Transactions");

const atomic = (state: Review): boolean => !!state.atomic && !!state.capabilities?.atomic;

function howText(state: Review): string {
  const n = state.steps.length;
  if (state.connection.wallet.propose) {
    if (apart(state)) return `${count(state.groups!.length, "Safe transaction", "Safe transactions")}, ${n} calls`;
    return n === 1 ? "One Safe transaction" : `One Safe transaction, ${n} calls`;
  }
  if (state.batch) return `All ${n} in one prompt${atomic(state) ? ", all or nothing" : ""}`;
  // One prompt each, as the button counts them, goes without saying.
  return "";
}

export function refreshReview(): void {
  if (!current) return;
  const { connection, steps, done, sending, submitted, finished, page, titles, batch } = current;
  const last = page === titles.length - 1;
  const safe = !!connection.wallet.propose;
  const wrongChain = connection.chainId !== CHAIN_ID;
  how.textContent = howText(current);
  callsTitle.textContent = callsName(current);
  if (!titles[page] && !pageList.hidden) title.textContent = callsName(current);
  confirm.textContent = safe
    ? "Propose in Safe{Wallet}"
    : wrongChain
      ? "Switch to Base"
      : steps.length === 1
        ? "Sign transaction"
        : batch
          ? `Sign ${steps.length} transactions`
          : `Sign transaction ${done.length + 1} of ${steps.length}`;
  confirm.disabled = sending || (safe && wrongChain);
  confirm.hidden = !last || finished || !steps.length;
  next.hidden = last;
  back.textContent = submitted ? "Close" : "Back";
  markNext(current);
}

export const closeReview = (): void => dialog.close();

// The review may have closed, or another opened, by the time the wallet answers. The transactions follow on a line of
// their own; of several, those until the last are so far.
function say(state: Review, message: string, hashes: Hex[] = []): void {
  if (state !== current) return;
  progress.replaceChildren(message);
  if (!hashes.length) return;
  const heading =
    state.steps.length > 1 && !state.finished
      ? "Transactions so far: "
      : hashes.length === 1
        ? "Transaction: "
        : "Transactions: ";
  const line = Object.assign(document.createElement("span"), { className: "hashes" });
  hashes.forEach((hash, i) => line.append(i ? ", " : heading, txLink(hash)));
  line.append(".");
  progress.append(line);
}

const wentThrough = ({ done, steps, batch, proposed, groups }: Review): string =>
  proposed
    ? ` ${proposed} of ${groups?.length ?? 1} Safe transactions proposed.`
    : done.length && !batch
      ? ` ${done.length} of ${steps.length} transactions went through.`
      : "";

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

// Each group of calls as a Safe transaction of its own, one after the other, each once Safe{Wallet} took the one before;
// after a refusal, a click goes on from there.
async function proposeAll(state: Review, propose: NonNullable<Wallet["propose"]>): Promise<void> {
  const groups = state.groups ?? [state.steps.length];
  while (state.proposed < groups.length) {
    const start = groups.slice(0, state.proposed).reduce((sum, size) => sum + size, 0);
    const proposing = propose(state.steps.slice(start, start + groups[state.proposed]!));
    say(
      state,
      apart(state)
        ? `Waiting for your wallet: Safe transaction ${state.proposed + 1} of ${groups.length}…`
        : "Waiting for your wallet…",
    );
    await proposing;
    state.proposed++;
    state.submitted = true;
  }
  state.finished = true;
  say(
    state,
    apart(state)
      ? `Proposed ${groups.length} Safe transactions. Sign them in Safe{Wallet}.`
      : "Proposed. Sign it in Safe{Wallet}.",
  );
  if (state !== current) return;
  const proposed = clone("proposed");
  proposed.querySelector(".co-signers")!.setAttribute("href", state.checkHref);
  proposed.querySelector(".co-signers-address")!.textContent = `https://metadex.cafe/${state.checkHref}`;
  doneBox.replaceChildren(proposed);
  doneBox.hidden = false;
}

// Once every transaction is included: the outcome, from the receipts where the review reads them, on a screen of its
// own in place of the pages and the calls. What was sent stays in the foot.
async function finish(state: Review): Promise<void> {
  const n = state.steps.length;
  say(state, n === 1 ? "It went through." : `All ${n} went through.`, state.done);
  const outcome = state.receipts.length
    ? await state.outcomeOf?.(state.receipts).catch((error: unknown) => void console.error(error))
    : undefined;
  const shown = outcome ?? state.outcome;
  if (state !== current || !shown) return;
  // The screen says it is done: the foot keeps only the transactions.
  say(state, "", state.done);
  pageList.hidden = calls.hidden = stepCount.hidden = true;
  title.textContent = "Done";
  doneBox.replaceChildren(shown);
  doneBox.hidden = false;
  dialog.scrollTop = 0;
  title.focus();
}

async function sendNext(state: Review): Promise<void> {
  const { steps, done } = state;
  const sending = sendTransaction(state.connection, steps[done.length]!);
  say(state, "Waiting for your wallet…", done);
  const hash = await sending;
  const hashes = [...done, hash];
  const which = `Transaction${steps.length === 1 ? "" : ` ${hashes.length} of ${steps.length}`} signed`;
  state.submitted = true;
  refreshReview();
  // Only the transactions that went through are linked: one waiting to, once it does, once it failed, or once the page
  // stops waiting for it, so that it can still be looked up.
  say(state, `${which}. Waiting for it to go through…`, done);
  const receipt = await waitForReceipt(hash);
  const ok = receipt && receipt.status === "0x1";
  if (receipt && ok) {
    done.push(hash);
    state.receipts.push(receipt);
  }
  state.finished = !ok || done.length === steps.length;
  if (!receipt) say(state, `${which}. Reload the page in a minute to see if it went through.`, hashes);
  else if (!ok) say(state, `A transaction failed on Base.${wentThrough(state)}`, hashes);
  else if (state.finished) await finish(state);
  else {
    let next = `Sign transaction ${done.length + 1} when you are ready.`;
    const fresh = await state.prepare?.(done.length).catch((error: unknown) => void console.error(error));
    if (fresh) {
      steps[done.length] = fresh.step;
      if (state === current) drawSlips(state);
      if (fresh.changed) next = `${fresh.changed} ${next}`;
    }
    say(state, `Transaction ${done.length} of ${steps.length} went through. ${next}`, done);
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
    return say(state, "Your wallet can't sign these in one prompt: sign them one by one.");
  }
  state.submitted = true;
  refreshReview();
  say(state, "Transactions signed. Waiting for them to go through…");
  const status = await waitForCalls(state.connection, id);
  state.finished = true;
  const hashes = status?.receipts.map(({ transactionHash }) => transactionHash) ?? [];
  if (!status) return say(state, "Transactions signed. Reload the page in a minute to see if they went through.");
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
