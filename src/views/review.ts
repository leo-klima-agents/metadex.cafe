import { isAddress, isHash, size, type Hex } from "viem";
import { refresh } from "../cache.ts";
import { BASESCAN, CHAIN_ID } from "../config.ts";
import { count } from "../format.ts";
import { poll, waitForReceipt, type Landed } from "../rpc.ts";
import { actions, render, state } from "../state.ts";
import { $, announce, asWritten, code, fill, frag, hex, link, list } from "../ui.ts";
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

type Review = {
  name: string;
  // The last page also shows the calls. A page without a title is titled after the calls, rather than giving them a
  // heading of their own.
  pages: { title?: string; body?: Node }[];
  // The calls. With `sending`, they are encoded to be sent, with a fresh deadline.
  steps: (sending?: boolean) => Slip[];
  atomic?: boolean;
  // When the calls don't fit in one transaction: how many go in each, in order. A Safe proposes one transaction per
  // group; other wallets then sign each call alone.
  groups?: number[] | undefined;
  outcome?: (receipts: Landed[]) => Promise<Node | undefined>;
  // What the calls wait for, if anything. They may change until then, so nothing is sent while this returns text.
  waiting?: () => string | undefined;
  // Where the page explains the calls, for a Safe's co-signers.
  checkHref: string;
};
type Sending = Review & {
  page: number;
  capabilities?: Capabilities;
  // Whether the calls go in one prompt. Set when the first is sent, from the wallet's capabilities and the calls at
  // that moment.
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
const refreshAfter = (): void =>
  ["account", "held", "allowances", "payouts", "aero stake", "aero pending"].forEach(refresh);
let current: Sending | undefined;
const apart = (review: Sending): boolean => (review.groups?.length ?? 1) > 1;
const batched = (review: Sending, steps = review.steps()): boolean =>
  review.batch ?? (!!review.capabilities?.batch && !apart(review) && steps.length > 1);

export function openReview(review: Review): void {
  // A review opened from another, such as the swap after a claim, first re-reads what the other one sent.
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

function fieldValue({ code: value, tags = [], words, after, calldata, lines }: Field): Node | string {
  if (words !== undefined) return words;
  const one = (text: string) => {
    const el = code(text);
    if (calldata) el.className = "Slip-calldata";
    else if (isAddress(text, { strict: false })) hex(el, text, true);
    else if (isHash(text)) hex(el, text);
    return el;
  };
  if (!Array.isArray(value)) return after ? frag(one(value ?? ""), after) : one(value ?? "");
  if (!value.length) return "None";
  const grid = Object.assign(document.createElement("span"), { className: lines ? "u-stackTight" : "u-row" });
  const item = (text: string, i: number): Node => frag(tags[i] ? code(tags[i]!) : "", one(text));
  const line = (text: string, i: number): Node => {
    const row = Object.assign(document.createElement("span"), { className: "u-spread" });
    row.append(item(text, i));
    return row;
  };
  grid.append(...value.map(lines ? line : item));
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
    step: asWritten(`${review.name}${pages.length > 1 ? ` · ${review.page + 1} of ${pages.length}` : ""}`),
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
        count: asWritten(`${where}${steps.length > 1 ? ` ${i + 1} of ${steps.length}` : ""} · ${step.title}`),
        says: step.says,
      });
      // These fields mirror what the wallet shows: destination, function, arguments and a value of 0 ETH. A Safe also
      // shows the data and, for a lone call, operation 0 (a plain call).
      const fields: Field[] = [
        { label: "To", description: step.on, code: step.to },
        { label: "Call", code: step.call },
        ...step.fields,
        { label: "Value", code: "0", after: " ETH" },
        ...(safe ? [{ label: "Data", description: `${size(step.data)} bytes`, code: step.data, calldata: true }] : []),
        ...(safe && groups[g] === 1 ? [{ label: "Operation", code: "0", after: " · call" }] : []),
      ];
      list(
        $("[data-list=field]", row),
        fields,
        ({ label }) => label,
        (field, value) =>
          fill(field, {
            label: asWritten(value.label),
            description: value.description ?? null,
            value: fieldValue(value),
          }),
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
  // Wrapped in an element because a fragment empties once inserted, and would show empty on the next draw.
  if (outcome) {
    const box = Object.assign(document.createElement("div"), { className: "u-stack" });
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
  const status = await poll(() =>
    callsStatus(state.connection!, id).then(
      (status) => (status.state === "pending" ? undefined : status),
      (error: unknown) => void console.error(error),
    ),
  );
  review.finished = true;
  if (!status) return say(review, "Transactions signed. Reload the page in a minute to see if they went through.");
  review.done = status.receipts.map(({ transactionHash }) => transactionHash);
  if (status.state === "failed") return say(review, "The calls failed on Base, or your wallet did not send them.");
  review.receipts = status.receipts;
  finish(review);
}

// Asks the wallet within the click, before any `await`, because some wallets require that.
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
dialog.addEventListener("click", (event) => {
  const anchor = (event.target as Element).closest<HTMLAnchorElement>('a[href^="#"]');
  if (!anchor || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
  if (current && (current.sending || (current.submitted && !current.finished))) {
    event.preventDefault();
    open(anchor.href, "_blank", "noopener");
  } else closeReview();
});
// Closing after sending re-reads what the calls changed. A review still sending keeps being followed, and re-reads when
// it settles.
dialog.addEventListener("close", () => {
  const review = current;
  current = undefined;
  if (review?.submitted && !review.sending) refreshAfter();
  render();
});
