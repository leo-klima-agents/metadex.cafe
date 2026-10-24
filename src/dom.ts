import type { Address, Hex } from "viem";
import { day, hexLines, onCurrency, walletLines } from "./format.ts";

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

export function clone(id: string): DocumentFragment {
  return (document.getElementById(id) as HTMLTemplateElement).content.cloneNode(true) as DocumentFragment;
}

// Text that shows money, with how to write it from what it shows: once another currency is picked, or what it shows
// changes, as prices come, one call writes each again, wherever it is, in a view or a review. Plain text written over
// it ends that. An element gone from memory leaves the set.
const writers = new WeakMap<Element, () => string>();
const written = new Set<WeakRef<Element>>();
const gone = new FinalizationRegistry<WeakRef<Element>>((ref) => written.delete(ref));

export function live(element: Element, write: () => string): void {
  if (!writers.has(element)) {
    const ref = new WeakRef(element);
    written.add(ref);
    gone.register(element, ref);
  }
  writers.set(element, write);
  element.textContent = write();
}

export function rewrite(): void {
  for (const ref of written) {
    const element = ref.deref();
    const write = element && writers.get(element);
    if (write) element.textContent = write();
    else written.delete(ref);
  }
}

onCurrency(rewrite);

// An exact amount, then what it is worth, if known, quieter, under it: "0.01472 USDC", "≈ $0.01".
export function showWorth(element: Element, exact: string, worth?: () => string): void {
  writers.delete(element);
  const amount = Object.assign(document.createElement("span"), { className: "exact", textContent: exact });
  if (!worth) return void element.replaceChildren(amount);
  const quiet = Object.assign(document.createElement("span"), { className: "worth" });
  live(quiet, worth);
  element.replaceChildren(amount, " ", quiet);
}

// Each element of each class gets its text, or, for money, how to write it.
export function fill(root: ParentNode, textByClass: Record<string, string | (() => string)>): void {
  for (const [name, text] of Object.entries(textByClass)) {
    for (const element of root.querySelectorAll(`.${name}`)) {
      if (typeof text === "function") live(element, text);
      else {
        writers.delete(element);
        element.textContent = text;
      }
    }
  }
}

export function fillTime(root: ParentNode, name: string, time: number, format = day): void {
  for (const element of root.querySelectorAll<HTMLTimeElement>(`time.${name}`)) {
    element.dateTime = new Date(time * 1000).toISOString();
    element.textContent = format(time);
  }
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
  element.classList.add("hex");
  element.classList.remove("wallet");
  element.classList.toggle("halves", lines.length === 1);
  element.replaceChildren(fragment);
}

// Lines of groups, a span each; CSS starts a line at each "line" span. With `breaks`, a line may also wrap between
// groups.
function linesOf(lines: string[][], breaks: boolean): DocumentFragment {
  const fragment = document.createDocumentFragment();
  lines.forEach((line, i) =>
    line.forEach((text, j) => {
      if (breaks && (i || j)) fragment.append(document.createElement("wbr"));
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
    else link.textContent = text;
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
  link.textContent = `${hash.slice(0, 10)}…`;
  return link;
}
