import type { Hex } from "viem";
import { CHAIN_ID } from "../config.ts";
import { count, short } from "../format.ts";
import { waitForReceipt, type Receipt } from "../rpc.ts";
import { update } from "../state.ts";
import { sleep } from "../util.ts";
import {
  callsStatus,
  capabilities,
  declined,
  sendCalls,
  sendTransaction,
  switchToBase,
  type Capabilities,
  type Connection,
  type Tx,
} from "../wallet.ts";
import { $, $$, fill, list, showHex, txUrl } from "./dom.ts";

// A call's field, as the wallet shows it: an address, a number or a list, or words; with what it holds above it.
export type Field = { label: string; code?: string | string[]; tags?: string[]; words?: string; description?: string };
export type Slip = Tx & { title: string; says: string; on: string; call: string; fields: Field[] };
export type ReviewOptions = {
  // Above each title: "Join Matcha Latte · 1 of 2".
  name: string;
  // The page before the calls, if any, which the caller fills: its state in #pages, and its title.
  intro?: { kind: "join" | "leave" | "claim" | "swap"; title: string };
  steps: Slip[];
  // Where the automation's page explains the calls, for a Safe's co-signers.
  checkHref: string;
  connection: Connection;
  // Once all went through: what to say, and what fills #receipts from the receipts.
  outcome?: string;
  finish?(receipts: Receipt[]): Promise<void>;
  // Before the call at `i` goes on its own: a fresh call, and words when it differs, which wait for another click.
  prepare?(i: number): Promise<{ step: Slip; changed?: string } | undefined>;
  atomic?: boolean;
  // Calls too large together for one transaction go in groups that each fit: a Safe transaction each.
  groups?: number[];
};
type Review = ReviewOptions & {
  page: number;
  capabilities?: Capabilities;
  batch: boolean;
  done: Hex[];
  proposed: number;
  receipts: Receipt[];
  sending: boolean;
  submitted: boolean;
  finished: boolean;
  message: string;
  hashes: Hex[];
};

const dialog = $<HTMLDialogElement>("#review");
const [pages, calls, slips, doneBox, next, confirm, back] = [
  "#pages",
  "#calls",
  "#slips",
  "#done",
  "#next",
  "#confirm",
  "#back",
].map((selector) => $(selector, dialog)) as [
  HTMLElement,
  HTMLElement,
  HTMLElement,
  HTMLElement,
  HTMLElement,
  HTMLElement,
  HTMLElement,
];
let current: Review | undefined;
// After a review closes: whether it sent something.
export const closed: ((submitted: boolean) => void)[] = [];
let opener: Element | null = null;

const apart = ({ groups }: Review) => (groups?.length ?? 1) > 1;
const safe = (state: Review) => !!state.connection.wallet.propose;
const atomic = (state: Review) => !!state.atomic && !!state.capabilities?.atomic;
// With a page of its own, a review shows it first, then the calls.
const onCalls = (state: Review) => !state.intro || state.page === 1;

// Addresses as the wallet shows them, for the two to be compared line by line.
function codeOf(text: string): HTMLElement {
  const code = Object.assign(document.createElement("code"), { translate: false });
  if (/^0x[0-9a-fA-F]{40}$/.test(text)) showHex(code, text, true);
  else if (/^0x[0-9a-fA-F]{64}$/.test(text)) showHex(code, text);
  else code.textContent = text;
  return code;
}

function drawSlips(state: Review): void {
  const { steps, groups = [steps.length] } = state;
  const group = groups.flatMap((size, g) => Array.from({ length: size }, () => g));
  list(
    slips,
    "slip",
    steps,
    (step) => `${steps.indexOf(step)}`,
    (row, step) => {
      const i = steps.indexOf(step);
      const g = group[i] ?? 0;
      const inSafe = safe(state) && (apart(state) ? `Safe ${g + 1} of ${groups.length} · ` : "Safe · ");
      const which = `${inSafe ? "Call" : "Transaction"}${steps.length > 1 ? ` ${i + 1} of ${steps.length}` : ""}`;
      fill(row, { count: `${inSafe || ""}${which} · ${step.title}`, says: step.says });
      const fields: Field[] = [
        { label: "To", description: step.on, code: step.to },
        { label: "Call", code: step.call },
        ...step.fields,
        { label: "Value", code: "0", words: " ETH" },
        ...(inSafe ? [{ label: "Data", description: `${(step.data.length - 2) / 2} bytes`, code: step.data }] : []),
        ...(inSafe && groups[g] === 1 ? [{ label: "Operation", code: "0", words: " · call" }] : []),
      ];
      list(
        $("dl", row),
        "field",
        fields,
        ({ label }) => label,
        (line, { label, code, tags, words, description }) => {
          fill(line, { label, description: description ?? "" });
          const value = $("dd", line);
          const codes = (Array.isArray(code) ? code : code === undefined ? [] : [code]).map((each, k) => {
            const item = codeOf(each);
            if (tags?.[k])
              item.prepend(
                Object.assign(document.createElement("span"), { className: "quiet", textContent: `${tags[k]} ` }),
              );
            return item;
          });
          value.replaceChildren(
            $("[data-v=description]", line),
            ...(Array.isArray(code) && !code.length ? ["None"] : codes),
            words ?? "",
          );
        },
      );
      row.classList.toggle(
        "next-call",
        !safe(state) && !state.batch && !state.finished && steps.length > 1 && i === state.done.length,
      );
    },
  );
}

export function openReview(options: ReviewOptions): { replace(steps: Slip[], more?: Partial<ReviewOptions>): void } {
  const previous = current;
  if (previous && !previous.sending) for (const hook of closed) hook(previous.submitted);
  const state: Review = {
    ...options,
    page: 0,
    batch: false,
    done: [],
    proposed: 0,
    receipts: [],
    sending: false,
    submitted: false,
    finished: false,
    message: "",
    hashes: [],
  };
  current = state;
  if (options.intro) pages.dataset.state = options.intro.kind;
  doneBox.hidden = true;
  opener = document.activeElement;
  drawSlips(state);
  showPage(0);
  dialog.showModal();
  void capabilities(options.connection).then((found) => {
    if (state !== current || state.sending || state.submitted) return;
    state.capabilities = found;
    state.batch = found.batch && state.steps.length > 1 && !apart(state);
    refreshReview();
  });
  return {
    replace(steps, more = {}) {
      if (state !== current || state.sending || state.submitted) return;
      Object.assign(state, { steps, atomic: undefined, finish: undefined, prepare: undefined, ...more });
      state.batch = !!state.capabilities?.batch && steps.length > 1 && !apart(state);
      drawSlips(state);
      refreshReview();
    },
  };
}

function showPage(page: number): void {
  if (!current) return;
  current.page = page;
  refreshReview();
  $("h2", dialog).focus();
}

const callsName = ({ steps }: Review) => (steps.length === 1 ? "Transaction" : "Transactions");
function howText(state: Review): string {
  const n = state.steps.length;
  if (safe(state))
    return apart(state)
      ? `${count(state.groups!.length, "Safe transaction", "Safe transactions")}, ${n} calls`
      : n === 1
        ? "One Safe transaction"
        : `One Safe transaction, ${n} calls`;
  return state.batch ? `All ${n} in one prompt${atomic(state) ? ", all or nothing" : ""}` : "";
}

export function refreshReview(): void {
  const state = current;
  if (!state) return;
  const { connection, steps, page, finished, sending, submitted, batch } = state;
  const isDone = !doneBox.hidden;
  const showCalls = onCalls(state) && !!steps.length && !isDone;
  const wrong = connection.chainId !== CHAIN_ID;
  fill(dialog, {
    step: state.intro && !isDone ? `${state.name} · ${page + 1} of 2` : "",
    title: isDone ? "Done" : state.intro && !page ? state.intro.title : callsName(state),
    how: howText(state),
    progress: state.message,
  });
  calls.hidden = !showCalls;
  pages.hidden = !state.intro || page !== 0 || isDone;
  confirm.textContent = safe(state)
    ? "Propose in Safe{Wallet}"
    : wrong
      ? "Switch to Base"
      : steps.length === 1
        ? "Sign transaction"
        : batch
          ? `Sign ${steps.length} transactions`
          : `Sign transaction ${state.done.length + 1} of ${steps.length}`;
  confirm.setAttribute("aria-disabled", String(sending || (safe(state) && wrong)));
  confirm.hidden = !showCalls || finished;
  next.hidden = !state.intro || page !== 0 || isDone;
  back.textContent = submitted ? "Close" : "Back";
  const progress = $("[data-v=progress]", dialog);
  if (state.hashes.length)
    progress.append(
      " ",
      ...state.hashes.flatMap((hash, i) => [
        i ? ", " : "",
        Object.assign(document.createElement("a"), { href: txUrl(hash), textContent: short(hash) }),
      ]),
    );
}

export const closeReview = (): void => dialog.close();

function say(state: Review, message: string, hashes: Hex[] = []): void {
  [state.message, state.hashes] = [message, hashes];
  if (state === current) refreshReview();
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
// A wallet that cannot send these calls in one prompt after all: the method, its params, atomicity, the chain, the count.
const UNBATCHED = [4200, -32601, -32602, 5700, 5710, 5740, 5750, 5760];

async function proposeAll(state: Review): Promise<void> {
  const groups = state.groups ?? [state.steps.length];
  while (state.proposed < groups.length) {
    const start = groups.slice(0, state.proposed).reduce((total, size) => total + size, 0);
    const proposing = state.connection.wallet.propose!(state.steps.slice(start, start + groups[state.proposed]!));
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
  fill(doneBox, { done: "", proposed: { text: `https://metadex.cafe/${state.checkHref}`, href: state.checkHref } });
  showDone(false);
}

function showDone(receipts = true): void {
  $("#receipts").hidden = $("#done-actions").hidden = !receipts;
  doneBox.hidden = false;
  refreshReview();
  dialog.scrollTop = 0;
  $("h2", dialog).focus();
}

async function sendNext(state: Review): Promise<void> {
  const { steps, done: sent } = state;
  const sending = sendTransaction(state.connection, steps[sent.length]!);
  say(state, "Waiting for your wallet…", sent);
  const hash = await sending;
  const which = `Transaction${steps.length === 1 ? "" : ` ${sent.length + 1} of ${steps.length}`} signed`;
  state.submitted = true;
  say(state, `${which}. Waiting for it to go through…`, sent);
  const receipt = await waitForReceipt(hash);
  const ok = receipt?.status === "0x1";
  if (receipt && ok) {
    sent.push(hash);
    state.receipts.push(receipt);
  }
  state.finished = !ok || sent.length === steps.length;
  if (!receipt) return say(state, `${which}. Reload the page in a minute to see if it went through.`, [...sent, hash]);
  if (!ok) return say(state, `A transaction failed on Base.${wentThrough(state)}`, [...sent, hash]);
  if (state.finished) return complete(state);
  let words = `Sign transaction ${sent.length + 1} when you are ready.`;
  const fresh = await state.prepare?.(sent.length).catch((error: unknown) => void console.error(error));
  if (fresh) {
    steps[sent.length] = fresh.step;
    if (fresh.changed) words = `${fresh.changed} ${words}`;
  }
  drawSlips(state);
  say(state, `Transaction ${sent.length} of ${steps.length} went through. ${words}`, sent);
}

async function sendBatch(state: Review): Promise<void> {
  const sending = sendCalls(state.connection, state.steps, atomic(state));
  say(state, "Waiting for your wallet…");
  let id: string;
  try {
    id = await sending;
  } catch (error) {
    if (!UNBATCHED.includes((error as { code?: number } | undefined)?.code ?? 0)) throw error;
    state.batch = false;
    return say(state, "Your wallet can't sign these in one prompt: sign them one by one.");
  }
  state.submitted = true;
  say(state, "Transactions signed. Waiting for them to go through…");
  let status;
  for (
    const end = Date.now() + 600_000;
    Date.now() < end && (!status || status.state === "pending");
    await sleep(2_000)
  )
    status = await callsStatus(state.connection, id).catch((error: unknown) => void console.error(error));
  state.finished = true;
  const hashes = status?.receipts.map(({ transactionHash }) => transactionHash) ?? [];
  if (!status || status.state === "pending")
    return say(state, "Transactions signed. Reload the page in a minute to see if they went through.");
  if (status.state === "failed")
    return say(state, "The calls failed on Base, or your wallet did not send them.", hashes);
  state.done = hashes;
  state.receipts = status.receipts as Receipt[];
  return complete(state);
}

// The outcome, on a screen of its own; the foot keeps the transactions.
async function complete(state: Review): Promise<void> {
  const n = state.steps.length;
  say(state, n === 1 ? "It went through." : `All ${n} went through.`, state.done);
  $("#receipts").replaceChildren();
  for (const action of $$("[data-action]", doneBox)) action.hidden = true;
  fill(doneBox, { done: state.outcome ?? "", proposed: "" });
  const finished = await state.finish?.(state.receipts).then(
    () => true,
    (error: unknown) => void console.error(error),
  );
  if (state !== current || (!finished && !state.outcome)) return;
  say(state, "", state.done);
  showDone();
}

confirm.addEventListener("click", () => {
  const state = current;
  if (!state || confirm.getAttribute("aria-disabled") === "true") return;
  // Asked at once: some wallets open only in answer to a click, so each transaction takes one.
  const sending =
    state.connection.chainId !== CHAIN_ID
      ? switchToBase(state.connection).then(update)
      : safe(state)
        ? proposeAll(state)
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
      else for (const hook of closed) hook(state.submitted);
    });
});
next.addEventListener("click", () => current && showPage(current.page + 1));
// Once something was sent, or while the wallet is asked, Back closes: the page sends no more, but follows what it sent.
back.addEventListener("click", () => {
  if (current && !current.sending && !current.submitted && current.page > 0) showPage(current.page - 1);
  else closeReview();
});
// A link to a section closes the review; while it sends, it opens in a new tab rather than stop the rest.
dialog.addEventListener("click", (event) => {
  const anchor = (event.target as Element).closest<HTMLAnchorElement>('a[href^="#"]');
  if (!anchor || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
  if (current && (current.sending || (current.submitted && !current.finished))) {
    event.preventDefault();
    open(anchor.href, "_blank", "noopener");
  } else closeReview();
});
dialog.addEventListener("close", () => {
  const state = current;
  current = undefined;
  if (state && !state.sending) for (const hook of closed) hook(state.submitted);
  (opener as HTMLElement | null)?.focus?.();
});
