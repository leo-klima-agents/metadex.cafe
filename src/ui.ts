import type { Address, Hex } from "viem";
import type { Got } from "./cache.ts";
import { hexLines, walletLines } from "./format.ts";

// The page's markup holds every view, popup and row; this fills it. An element marked data-text="key" takes a value:
//   string: its text; undefined: "Loading…", drawn as a bar; null or false: hidden; true: shown as it is;
//   a Node: its content; {state}: a data-state its [data-when] children follow, shown or hidden by CSS;
//   {href, text}: a link; {address}: hex in groups of four, a link to Basescan; {wallet}: as a wallet shows it.
export type Value =
  | string
  | undefined
  | null
  | boolean
  | Node
  | { state: "loading" | "failed" | "empty" | "ready" }
  | { href: string; text: string; external?: boolean }
  | { address: Address | Hex; text?: string }
  | { wallet: Address };

export const $ = <T extends Element = HTMLElement>(selector: string, root: ParentNode = document): T =>
  root.querySelector<T>(selector)!;
export const BASESCAN = "https://basescan.org";

function setAttr(el: Element, name: string, value: string | null): void {
  if (value === null) el.removeAttribute(name);
  else if (el.getAttribute(name) !== value) el.setAttribute(name, value);
}
function setText(el: Element, text: string): void {
  if (el.childNodes.length !== 1 || el.firstChild?.nodeType !== Node.TEXT_NODE || el.textContent !== text)
    el.textContent = text;
}

export function put(el: HTMLElement, value: Value): void {
  el.hidden = value === null || value === false;
  setAttr(el, "data-loading", value === undefined ? "" : null);
  if (value === null || value === false || value === true) return;
  if (value === undefined) return setText(el, "Loading…");
  if (typeof value === "string") return setText(el, value);
  if (value instanceof Node) return void (el.firstChild !== value && el.replaceChildren(value));
  if ("state" in value) return setAttr(el, "data-state", value.state);
  if ("wallet" in value) return hex(el, value.wallet, true);
  if ("address" in value) {
    const link = Object.assign(document.createElement("a"), {
      href: `${BASESCAN}/${value.address.length > 42 ? "tx" : "address"}/${value.address}`,
    });
    if (value.text === undefined) hex(link, value.address);
    else link.textContent = value.text;
    el.replaceChildren(link);
    return;
  }
  if (el instanceof HTMLAnchorElement) {
    setAttr(el, "href", value.href);
    setAttr(el, "target", value.external ? "_blank" : null);
    setAttr(el, "rel", value.external ? "noopener" : null);
    return setText(el, value.text);
  }
  const link = Object.assign(document.createElement("a"), { href: value.href, textContent: value.text });
  el.replaceChildren(link);
}

// Fills `root` and what it holds, but not its lists' rows, which their own fill() fills.
export function fill(root: ParentNode, values: Record<string, Value>): void {
  const all = [...root.querySelectorAll<HTMLElement>("[data-text]")];
  for (const el of root instanceof HTMLElement && root.dataset.text ? [root, ...all] : all) {
    const list = el.parentElement?.closest("[data-list]");
    if (list && list !== root && root.contains(list)) continue;
    const key = el.dataset.text!;
    if (key in values) put(el, values[key]);
  }
}

// A list's rows, from its template, kept by key so that focus and ticks survive each draw.
export function list<T>(
  el: Element,
  items: T[],
  keyOf: (item: T, i: number) => string,
  fillRow: (row: HTMLElement, item: T, i: number) => void,
): void {
  const template = document.getElementById((el as HTMLElement).dataset.list!) as HTMLTemplateElement;
  const old = new Map([...el.children].map((row) => [(row as HTMLElement).dataset.key, row as HTMLElement]));
  const empty = (el as HTMLElement).dataset.empty;
  const rows = items.map((item, i) => {
    const key = keyOf(item, i);
    const row = old.get(key) ?? (template.content.firstElementChild!.cloneNode(true) as HTMLElement);
    row.dataset.key = key;
    old.delete(key);
    fillRow(row, item, i);
    return row;
  });
  if (!items.length && empty)
    rows.push(
      old.get("") ?? Object.assign(document.createElement("li"), { className: "small quiet", textContent: empty }),
    );
  const focused = [...old.values()].some((row) => row.contains(document.activeElement));
  rows.forEach((row, i) => el.children[i] !== row && el.insertBefore(row, el.children[i] ?? null));
  for (const row of old.values()) row.remove();
  if (focused) el.closest("section, dialog")?.querySelector<HTMLElement>("h1, h2, h3")?.focus();
}

// A read's value as text: loading while read, "Not read" once failed.
export const shown = <T>(got: Got<T>, text: (value: T) => Value): Value =>
  got.value !== undefined ? text(got.value) : got.failed ? "Not read" : undefined;
export const stateOf = (got: Got<unknown>, empty?: boolean): Value => ({
  state: got.value !== undefined ? (empty ? "empty" : "ready") : got.failed ? "failed" : "loading",
});

// A status: a shape before the words, so that it never depends on colour alone.
export function status(shape: string, strong: string, ...rest: (string | Node)[]): HTMLElement {
  const span = document.createElement("span");
  const mark = Object.assign(document.createElement("span"), { className: "shape" });
  mark.dataset.shape = shape;
  mark.setAttribute("aria-hidden", "true");
  span.append(mark, Object.assign(document.createElement("strong"), { textContent: strong }), ...rest);
  return span;
}
export const link = (href: string, text: string, external = false): HTMLAnchorElement =>
  Object.assign(document.createElement("a"), {
    href,
    textContent: text,
    ...(external && { target: "_blank", rel: "noopener" }),
  });
export const code = (text: string): HTMLElement =>
  Object.assign(document.createElement("code"), { textContent: text, translate: false });
export function frag(...parts: (string | Node)[]): DocumentFragment {
  const fragment = document.createDocumentFragment();
  fragment.append(...parts);
  return fragment;
}

// Hex in groups of four, a span each, which CSS spaces, so that a copy is the plain hex: an address on two lines where
// it does not fit one, as the wallet shows it on three, calldata a line per 32-byte word.
export function hex(el: HTMLElement, value: string, wallet = false): void {
  if (el.dataset.hex === `${wallet} ${value}`) return;
  el.dataset.hex = `${wallet} ${value}`;
  el.classList.add("hex");
  el.classList.toggle("wallet", wallet);
  el.classList.toggle("block", wallet || hexLines(value).length > 1);
  el.translate = false;
  const lines = wallet
    ? walletLines(value)
    : hexLines(value).length === 1
      ? halves(hexLines(value)[0]!)
      : hexLines(value);
  el.replaceChildren(
    ...lines.map((groups) => {
      const line = Object.assign(document.createElement("span"), { className: "line" });
      line.append(...groups.map((group) => Object.assign(document.createElement("span"), { textContent: group })));
      return line;
    }),
  );
}
const halves = (groups: string[]): string[][] => [
  groups.slice(0, Math.ceil(groups.length / 2)),
  groups.slice(Math.ceil(groups.length / 2)),
];

// One polite live region says what changed: never what is loading.
export function announce(text: string): void {
  const region = $("#status");
  region.textContent = "";
  queueMicrotask(() => (region.textContent = text));
}
// A button whose action is under way keeps its size and its name, with a spinner over it.
export function busy(button: HTMLButtonElement, on = true): void {
  button.disabled = on;
  setAttr(button, "aria-busy", on ? "true" : null);
}
export const toggle = (name: string, on: boolean, value = ""): void =>
  setAttr(document.documentElement, `data-${name}`, on ? value : null);
