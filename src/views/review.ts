import type { Hex } from "viem";
import { refresh } from "../cache.ts";
import { CHAIN_ID } from "../config.ts";
import { count } from "../format.ts";
import { sleep, waitForReceipt, type Landed } from "../rpc.ts";
import { actions, render, state } from "../state.ts";
import { $, announce, code, fill, frag, hex, link, list, BASESCAN } from "../ui.ts";
import {
  callsStatus,
  capabilities,
  declined,
  sendCalls,
  sendTransaction,
  switchToBase,
  type Capabilities,
  type Field,
  type Slip,
} from "../wallet.ts";

// The review: the pages that say what a change does, then each call as a bill, as the wallet will show it; then the
// wallet signs them, in one prompt where it can, one at a time where not, or as Safe transactions.
export type Review = {
  name: string;
  // The last page shows the calls too; one without a title is the calls'.
  pages: { title?: string; body?: Node }[];
  // The calls; those `sending` are encoded then, with a fresh deadline.
  steps: (sending?: boolean) => Slip[];
  atomic?: boolean;
  // Calls too large for one transaction together, in groups that each fit one: counts of calls, in order.
  groups?: number[] | undefined;
  outcome?: (receipts: Landed[]) => Promise<Node | undefined>;
  // What the calls wait for, if anything: they may change until then, so none is sent.
  waiting?: () => string | undefined;
  // Where the page explains the calls, for a Safe's co-signers.
  checkHref: string;
};
type Sending = Review & {
  page: number;
  capabilities?: Capabilities;
  // Whether the calls go in one prompt: decided as the first is sent, from the wallet and the calls then.
  batch?: boolean;
  done: Hex[];
  receipts: Landed[];
  proposed: number;
  sending: boolean;
  submitted: boolean;
  finished: boolean;
  progress: string;
  result?: Node | undefined;
};

const dialog = $<HTMLDialogElement>("#review");
const refreshAfter = (): void => ["account", "held", "allowances", "payouts"].forEach(refresh);
let current: Sending | undefined;
const apart = (review: Sending): boolean => (review.groups?.length ?? 1) > 1;
const batched = (review: Sending, steps = review.steps()): boolean =>
  review.batch ?? (!!review.capabilities?.batch && !apart(review) && steps.length > 1);

export function openReview(review: Review): void {
  // One opened from another, as the swap after a claim: what the other sent is read again.
  if (current?.submitted && !current.sending) refreshAfter();
  const opened: Sending = {
    ...review,
    page: 0,
    done: [],
    receipts: [],
    proposed: 0,
    sending: false,
    submitted: false,
    finished: false,
    progress: "",
  };
  current = opened;
  dialog.showModal();
  draw();
  $("#review-title").focus();
  if (state.connection)
    void capabilities(state.connection).then((found) => {
      opened.capabilities = found;
      render();
    });
}
export const closeReview = (): void => dialog.close();
export const drawReview = (): void => void (current && draw());

// A field's value: an address as the wallet shows it, a list of them, or words.
function fieldValue({ code: value, tags = [], words }: Field): Node | string {
  if (words !== undefined) return words;
  const one = (text: string) => {
    const el = code(text);
    if (/^0x[0-9a-fA-F]{40}$/.test(text)) hex(el, text, true);
    else if (/^0x[0-9a-fA-F]{64}$/.test(text)) hex(el, text);
    return el;
  };
  if (!Array.isArray(value)) return one(value ?? "");
  if (!value.length) return "None";
  const grid = Object.assign(document.createElement("span"), { className: "row" });
  grid.append(...value.map((text, i) => frag(tags[i] ? code(tags[i]!) : "", one(text))));
  return grid;
}

function draw(): void {
  const review = current!;
  const { connection } = state;
  const steps = review.steps();
  const batch = batched(review, steps);
  const pages = review.pages.length ? review.pages : [{}];
  const last = review.page === pages.length - 1;
  const shown = pages[review.page]!;
  const safe = !!connection?.wallet.propose;
  const wrongChain = connection?.chainId !== CHAIN_ID;
  const groups = review.groups ?? [steps.length];
  const groupOf = groups.flatMap((size, g) => Array.from({ length: size }, () => g));
  const next = safe || batch || review.finished || steps.length < 2 ? -1 : review.done.length;
  const callsName = steps.length === 1 ? "Transaction" : "Transactions";
  const atomic = !!review.atomic && !!review.capabilities?.atomic;
  const waiting = review.finished ? undefined : review.waiting?.();
  fill(dialog, {
    step: `${review.name}${pages.length > 1 ? ` · ${review.page + 1} of ${pages.length}` : ""}`,
    title: review.result ? "Done" : (shown.title ?? callsName),
    page: review.result ? null : (shown.body ?? null),
    calls: (!review.result && last && steps.length > 0) || null,
    "calls-title": shown.title ? callsName : null,
    how: waiting
      ? waiting
      : safe
        ? apart(review)
          ? `${count(groups.length, "Safe transaction", "Safe transactions")}, ${steps.length} calls`
          : steps.length === 1
            ? "One Safe transaction"
            : `One Safe transaction, ${steps.length} calls`
        : batch
          ? `All ${steps.length} in one prompt${atomic ? ", all or nothing" : ""}`
          : null,
    done:
      review.result ??
      (safe && review.finished
        ? frag("For co-signers: ", link(review.checkHref, `https://metadex.cafe/${review.checkHref}`))
        : null),
    progress: frag(review.progress, ...hashes(review)),
    confirm:
      last && !review.finished && steps.length > 0
        ? safe
          ? "Propose in Safe{Wallet}"
          : wrongChain
            ? "Switch to Base"
            : steps.length === 1
              ? "Sign transaction"
              : batch
                ? `Sign ${steps.length} transactions`
                : `Sign transaction ${review.done.length + 1} of ${steps.length}`
        : null,
    back: review.submitted ? "Close" : "Back",
  });
  $<HTMLButtonElement>("[data-action=confirm]", dialog).disabled = review.sending || (safe && wrongChain) || !!waiting;
  $("[data-action=next]", dialog).hidden = last || !!review.result;
  list(
    $("[data-list=slip]", dialog),
    steps,
    (_, i) => String(i),
    (row, step, i) => {
      const g = groupOf[i] ?? 0;
      const where = safe ? `${apart(review) ? `Safe ${g + 1} of ${groups.length}` : "Safe"} · Call` : "Transaction";
      fill(row, {
        count: `${where}${steps.length > 1 ? ` ${i + 1} of ${steps.length}` : ""} · ${step.title}`,
        says: step.says,
        on: step.on,
        to: { wallet: step.to },
        call: step.call,
        "data-row": safe || null,
        bytes: `${(step.data.length - 2) / 2} bytes`,
        data: safe ? fieldValue({ label: "", code: step.data }) : null,
        operation: (safe && groups[g] === 1) || null,
      });
      list(
        $("[data-list=field]", row),
        step.fields,
        ({ label }) => label,
        (field, value) =>
          fill(field, { label: value.label, description: value.description ?? null, value: fieldValue(value) }),
      );
      row.toggleAttribute("aria-current", i === next);
    },
  );
}

function hashes(review: Sending): (Node | string)[] {
  if (!review.done.length) return [];
  const words = review.done.length === 1 ? " Transaction: " : " Transactions: ";
  return [
    words,
    ...review.done.flatMap((hash, i) => [i ? ", " : "", link(`${BASESCAN}/tx/${hash}`, `${hash.slice(0, 10)}…`, true)]),
    ".",
  ];
}
function say(review: Sending, words: string): void {
  review.progress = words;
  if (review === current) draw();
}
const wentThrough = ({ done, batch, proposed, groups, steps }: Sending): string =>
  proposed
    ? ` ${proposed} of ${groups?.length ?? 1} Safe transactions proposed.`
    : done.length && !batch
      ? ` ${done.length} of ${steps().length} transactions went through.`
      : "";

async function finish(review: Sending): Promise<void> {
  const n = review.steps().length;
  say(review, n === 1 ? "It went through." : `All ${n} went through.`);
  announce(review.progress);
  const outcome = await review.outcome?.(review.receipts).catch((error: unknown) => void console.error(error));
  // Kept in an element of its own: a fragment empties once shown, and would be shown empty the next time.
  if (outcome) {
    const box = Object.assign(document.createElement("div"), { className: "stack" });
    box.append(outcome);
    review.result = box;
  }
  if (review !== current) return;
  draw();
  if (review.result) $("#review-title").focus();
}

async function proposeAll(review: Sending): Promise<void> {
  const steps = review.steps(true);
  const groups = review.groups ?? [steps.length];
  for (; review.proposed < groups.length; review.proposed++) {
    const start = groups.slice(0, review.proposed).reduce((sum, size) => sum + size, 0);
    say(
      review,
      apart(review)
        ? `Waiting for your wallet: Safe transaction ${review.proposed + 1} of ${groups.length}…`
        : "Waiting for your wallet…",
    );
    await state.connection!.wallet.propose!(steps.slice(start, start + groups[review.proposed]!));
    review.submitted = true;
  }
  review.finished = true;
  say(
    review,
    apart(review)
      ? `Proposed ${groups.length} Safe transactions. Sign them in Safe{Wallet}.`
      : "Proposed. Sign it in Safe{Wallet}.",
  );
}

async function sendNext(review: Sending): Promise<void> {
  const steps = review.steps();
  const sending = sendTransaction(state.connection!, review.steps(true)[review.done.length]!);
  say(review, "Waiting for your wallet…");
  const hash = await sending;
  const which = `Transaction${steps.length === 1 ? "" : ` ${review.done.length + 1} of ${steps.length}`} signed`;
  review.submitted = true;
  say(review, `${which}. Waiting for it to go through…`);
  const receipt = await waitForReceipt(hash);
  const ok = receipt?.status === "0x1";
  if (ok) {
    review.done.push(hash);
    review.receipts.push(receipt!);
  }
  review.finished = !ok || review.done.length === steps.length;
  if (!receipt) say(review, `${which}. Reload the page in a minute to see if it went through.`);
  else if (!ok) say(review, `A transaction failed on Base.${wentThrough(review)}`);
  else if (review.finished) await finish(review);
  else
    say(
      review,
      `Transaction ${review.done.length} of ${steps.length} went through. Sign transaction ${review.done.length + 1} when you are ready.`,
    );
  if (receipt && !ok) announce(review.progress);
}

// Wallets that cannot batch say so with one of these codes: the calls then go one at a time.
const UNBATCHED = [4200, -32601, -32602, 5700, 5710, 5740, 5750, 5760];
async function sendBatch(review: Sending): Promise<void> {
  const sending = sendCalls(state.connection!, review.steps(true), !!review.atomic && !!review.capabilities?.atomic);
  say(review, "Waiting for your wallet…");
  let id: string;
  try {
    id = await sending;
  } catch (error) {
    if (!UNBATCHED.includes((error as { code?: number })?.code ?? 0)) throw error;
    review.batch = false;
    return say(review, "Your wallet can't sign these in one prompt: sign them one by one.");
  }
  review.submitted = true;
  say(review, "Transactions signed. Waiting for them to go through…");
  for (const end = Date.now() + 600_000; Date.now() < end; await sleep(2_000)) {
    const status = await callsStatus(state.connection!, id).catch((error: unknown) => void console.error(error));
    if (!status || status.state === "pending") continue;
    review.finished = true;
    review.done = status.receipts.map(({ transactionHash }) => transactionHash);
    if (status.state === "failed") return say(review, "The calls failed on Base, or your wallet did not send them.");
    review.receipts = status.receipts;
    return finish(review);
  }
  review.finished = true;
  say(review, "Transactions signed. Reload the page in a minute to see if they went through.");
}

// The wallet is asked at once, within the click: some wallets need it.
actions.confirm = () => {
  const review = current;
  const connection = state.connection;
  if (!review || !connection || review.sending || review.waiting?.()) return;
  const sending =
    connection.chainId !== CHAIN_ID
      ? switchToBase(connection)
      : connection.wallet.propose
        ? proposeAll(review)
        : (review.batch ??= batched(review))
          ? sendBatch(review)
          : sendNext(review);
  review.sending = true;
  draw();
  sending
    .catch((error: unknown) => {
      if (!declined(error)) console.error(error);
      const message = (error as { message?: string } | undefined)?.message;
      say(
        review,
        `${declined(error) ? "You said no in your wallet." : message ? `Your wallet answered: “${message}”` : "Your wallet did not answer."}${wentThrough(review)}`,
      );
      announce(review.progress);
    })
    .finally(() => {
      review.sending = false;
      if (review !== current && review.submitted) refreshAfter();
      render();
    });
};
actions.next = () => {
  if (!current) return;
  current.page++;
  draw();
  $("#review-title").focus();
};
actions.back = () => {
  if (current && !current.sending && !current.submitted && current.page > 0) {
    current.page--;
    draw();
    $("#review-title").focus();
  } else closeReview();
};
// A link within the review closes it, unless calls are under way: then it opens in a new tab.
dialog.addEventListener("click", (event) => {
  const anchor = (event.target as Element).closest<HTMLAnchorElement>('a[href^="#"]');
  if (!anchor || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
  if (current && (current.sending || (current.submitted && !current.finished))) {
    event.preventDefault();
    open(anchor.href, "_blank", "noopener");
  } else closeReview();
});
// Once closed after sending, what the calls changed is read again; one under way is still followed.
dialog.addEventListener("close", () => {
  const review = current;
  current = undefined;
  if (review?.submitted && !review.sending) refreshAfter();
  render();
});
