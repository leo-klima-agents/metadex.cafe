import type { Address, Hex } from "viem";
import { day, hexLines, onCurrency, short, walletLines } from "./format.ts";

const BASESCAN = "https://basescan.org";

export const txUrl = (hash: Hex): string => `${BASESCAN}/tx/${hash}`;

export function show(selector: string, shown = true, root: ParentNode = document): void {
  for (const element of root.querySelectorAll<HTMLElement>(selector)) element.hidden = !shown;
}

// Whether a popup is open. A browser without popups shows them all in the page.
export function isOpen(pop: HTMLElement): boolean {
  try {
    return pop.matches(":popover-open");
  } catch {
    return true;
  }
}

// A template's copy. What it marks pending starts so, with the words screen readers say for it.
export function clone(id: string): DocumentFragment {
  const fragment = (document.getElementById(id) as HTMLTemplateElement).content.cloneNode(true) as DocumentFragment;
  pendAll(fragment);
  return fragment;
}

// A figure being read from Base. Where it will show, a quiet bar of about its width keeps its place, from a moment
// after the read starts, so that a quick read flashes nothing, and screen readers say "Loading" in its place: not
// aria-busy on what holds it, which some screen readers hide whole until it is done. Whatever is written there next
// takes its place. A figure that cannot be read never stays pending: it says so in words, or its line hides.
export const PENDING: unique symbol = Symbol("pending");
export type Text = string | typeof PENDING;

// Writes text, or marks the element pending.
function put(element: Element, text: Text): void {
  if (text !== PENDING) {
    element.textContent = text;
    element.classList.remove("pending");
  } else if (!element.classList.contains("pending")) {
    const words = Object.assign(document.createElement("span"), {
      className: "visually-hidden",
      textContent: "Loading",
    });
    element.replaceChildren(words);
    element.classList.add("pending");
  }
}

// Ends the pending state of an element about to be written other than as text, as with an address.
const unmark = (element: Element): void => void element.classList.remove("pending");

// Marks pending what the page's markup, or a template's, marks so.
export function pendAll(root: ParentNode): void {
  for (const element of root.querySelectorAll(".pending")) {
    element.classList.remove("pending");
    put(element, PENDING);
  }
}

// Text that shows money, with how to write it from what it shows: once another currency is picked, or what it shows
// changes, as prices come, one call writes each again, wherever it is, in a view or a review. Plain text written over
// it ends that. An element gone from memory leaves the set. Until what it shows is read, it may be pending.
const writers = new WeakMap<Element, () => Text>();
const written = new Set<WeakRef<Element>>();
// Each element's one reference in the set, kept while it is there: plain text written over an element, then money
// again, as a line between a pending figure and a sum, does not add another.
const refs = new WeakMap<Element, WeakRef<Element>>();
const gone = new FinalizationRegistry<WeakRef<Element>>((ref) => written.delete(ref));

export function live(element: Element, write: () => Text): void {
  if (!refs.has(element)) {
    const ref = new WeakRef(element);
    refs.set(element, ref);
    written.add(ref);
    gone.register(element, ref);
  }
  writers.set(element, write);
  put(element, write());
}

export function rewrite(): void {
  for (const ref of written) {
    const element = ref.deref();
    const write = element && writers.get(element);
    if (write) put(element, write());
    else {
      written.delete(ref);
      if (element) refs.delete(element);
    }
  }
}

onCurrency(rewrite);

// An exact amount, then what it is worth, if known, quieter, under it: "0.01472 USDC", "≈ $0.01".
export function showWorth(element: Element, exact: string, worth?: () => string): void {
  writers.delete(element);
  unmark(element);
  const amount = Object.assign(document.createElement("span"), { className: "exact", textContent: exact });
  if (!worth) return void element.replaceChildren(amount);
  const quiet = Object.assign(document.createElement("span"), { className: "worth" });
  live(quiet, worth);
  element.replaceChildren(amount, " ", quiet);
}

// An amount and what it is worth, both waiting, under each other: a bar for each line, which screen readers hear once.
export function pendWorth(element: Element): void {
  if (element.querySelector(":scope > .exact.pending")) return;
  writers.delete(element);
  unmark(element);
  const [amount, quiet] = ["exact", "worth"].map((className) =>
    Object.assign(document.createElement("span"), { className }),
  ) as [HTMLElement, HTMLElement];
  put(amount, PENDING);
  put(quiet, PENDING);
  quiet.setAttribute("aria-hidden", "true");
  element.replaceChildren(amount, " ", quiet);
}

// An exact amount and what it is worth, if known, each in an element of its own: as in a bill's line, where what it is
// worth takes the second row, under the amount. Until the amount is read, both wait, each line in its place, and screen
// readers hear it once.
export function showWorthIn(exactElement: Element, worthElement: Element, exact: Text, worth?: () => string): void {
  writers.delete(exactElement);
  put(exactElement, exact);
  if (exact === PENDING) worthElement.setAttribute("aria-hidden", "true");
  else worthElement.removeAttribute("aria-hidden");
  if (worth) live(worthElement, worth);
  else {
    writers.delete(worthElement);
    put(worthElement, exact === PENDING ? PENDING : "");
  }
}

// One element's text, or that it waits, pending.
export function setText(element: Element, text: Text): void {
  writers.delete(element);
  put(element, text);
}

// Each element of each class gets its text, or, for money, how to write it, or waits, pending.
export function fill(root: ParentNode, textByClass: Record<string, Text | (() => Text)>): void {
  for (const [name, text] of Object.entries(textByClass)) {
    for (const element of root.querySelectorAll(`.${name}`)) {
      if (typeof text === "function") live(element, text);
      else {
        writers.delete(element);
        put(element, text);
      }
    }
  }
}

export function fillTime(root: ParentNode, name: string, time: number, format = day): void {
  for (const element of root.querySelectorAll<HTMLTimeElement>(`time.${name}`)) {
    element.dateTime = new Date(time * 1000).toISOString();
    put(element, format(time));
  }
}

// A button whose action is under way, as its review is prepared: it keeps its place, size and name, shows a spinner
// over its words, and takes no second click. Its words are its own again once it is not.
export function busy(button: HTMLButtonElement, on = true): void {
  button.classList.toggle("busy", on);
  button.disabled = on;
  if (on) button.setAttribute("aria-busy", "true");
  else button.removeAttribute("aria-busy");
}

// Writes hex in groups of four. CSS spaces the groups, so a copy is still the plain hex. An address or a hash is "0x" and
// two halves, which wrap only between them, their groups one above the other; longer hex, such as calldata, a word a
// line.
export function showHex(element: Element, hex: string): void {
  const fragment = document.createDocumentFragment();
  const group = (text: string): HTMLSpanElement => Object.assign(document.createElement("span"), { textContent: text });
  const lines = hexLines(hex);
  if (lines.length === 1) {
    const [prefix = "", ...groups] = lines[0]!;
    const middle = Math.ceil(groups.length / 2);
    [[prefix, ...groups.slice(0, middle)], groups.slice(middle)].forEach((half, i) => {
      if (i) fragment.append(document.createElement("wbr"));
      const span = Object.assign(document.createElement("span"), { className: "half" });
      span.append(...half.map(group));
      fragment.append(span);
    });
  } else fragment.append(linesOf(lines, true));
  unmark(element);
  element.classList.add("hex");
  element.classList.remove("wallet");
  element.classList.toggle("halves", lines.length === 1);
  element.replaceChildren(fragment);
}

// Lines of groups, a span each; CSS starts a line at each "line" span. With `breaks`, a line wraps only after every
// fourth group, so that calldata, a 32-byte word a line, shows 32 hex digits a line where they fit, as on a desktop, and
// 16 where they do not.
function linesOf(lines: string[][], breaks: boolean): DocumentFragment {
  const fragment = document.createDocumentFragment();
  lines.forEach((line, i) =>
    line.forEach((text, j) => {
      if (breaks && j && j % 4 === 0) fragment.append(document.createElement("wbr"));
      const span = Object.assign(document.createElement("span"), { textContent: text });
      if (i && !j) span.className = "line";
      fragment.append(span);
    }),
  );
  return fragment;
}

// Writes an address as the wallet will show it, on three lines, as hardware wallets do: see walletLines(). As with
// showHex(), CSS lays out the groups, so a copy is still the plain address.
export function showWalletAddress(element: Element, address: string): void {
  unmark(element);
  element.classList.add("hex", "wallet");
  element.classList.remove("halves");
  element.replaceChildren(linesOf(walletLines(address), false));
}

export function groupAllHex(root: ParentNode): void {
  for (const element of root.querySelectorAll("code, code > a")) {
    const text = element.childNodes.length === 1 ? element.firstChild : null;
    if (text?.nodeType === Node.TEXT_NODE && /^0x([0-9a-fA-F]{40}|[0-9a-fA-F]{64})$/.test(text.textContent ?? "")) {
      showHex(element, text.textContent!);
    }
  }
}

export function fillAddress(root: ParentNode, name: string, address: Address, text?: string): void {
  for (const link of root.querySelectorAll<HTMLAnchorElement>(`a.${name}`)) {
    link.href = `${BASESCAN}/address/${address}`;
    if (text === undefined) showHex(link, address);
    else put(link, text);
  }
}

export function fillPlural(root: ParentNode, n: number): void {
  for (const element of root.querySelectorAll<HTMLElement>("[data-one]")) {
    element.textContent = (n === 1 ? element.dataset.one : element.dataset.many) ?? "";
  }
}

// Words said to an account's owner, or about its owner to anyone else, from data-own and data-theirs, as fillPlural
// does for counts. What only the owner can do has data-own-only.
export function fillOwn(root: ParentNode, own: boolean): void {
  for (const element of root.querySelectorAll<HTMLElement>("[data-own]")) {
    element.textContent = (own ? element.dataset.own : element.dataset.theirs) ?? "";
  }
  for (const element of root.querySelectorAll<HTMLElement>("[data-own-only]")) element.hidden = !own;
}

export function txLink(hash: Hex): HTMLAnchorElement {
  const link = document.createElement("a");
  link.href = txUrl(hash);
  link.textContent = short(hash);
  return link;
}
