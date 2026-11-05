import type { Address, Hex } from "viem";
import type { Got } from "./cache.ts";
import { BASESCAN } from "./config.ts";
import { hexLines, walletLines } from "./format.ts";

// What `fill()` does with each value for an element marked `data-text="key"`: a string sets its text; `undefined` shows
// "Loading…" as a bar; `null` hides it; `true` shows it unchanged; a `Node` becomes its content; `{state}` sets
// `data-state`, and CSS shows only the `[data-when]` children that match; `{href, text}` makes a link; `{address}`
// links to Basescan, a hash as a transaction, and shows `text`, or else the hex in groups of four.
export type Value =
  | string
  | undefined
  | null
  | true
  | Node
  | { state: "loading" | "failed" | "empty" | "ready" }
  | { href: string; text: string; external?: boolean }
  | { address: Address | Hex; text?: string };

export const $ = <T extends Element = HTMLElement>(selector: string, root: ParentNode = document): T =>
  root.querySelector<T>(selector)!;

function setAttr(el: Element, name: string, value: string | null): void {
  if (value === null) el.removeAttribute(name);
  else if (el.getAttribute(name) !== value) el.setAttribute(name, value);
}
function setText(el: Element, text: string): void {
  if (el.childNodes.length !== 1 || el.firstChild?.nodeType !== Node.TEXT_NODE || el.textContent !== text)
    el.textContent = text;
}

// Leaves `el` alone when it already holds equal nodes, so a redraw keeps focus where it is and a live region stays
// quiet.
function replace(el: Element, value: Node): void {
  const nodes = value instanceof DocumentFragment ? [...value.childNodes] : [value];
  const held = el.childNodes;
  if (held.length !== nodes.length || nodes.some((node, i) => node !== held[i] && !node.isEqualNode(held[i]!)))
    el.replaceChildren(...nodes);
}

function put(el: HTMLElement, value: Value): void {
  el.hidden = value === null;
  setAttr(el, "data-loading", value === undefined ? "" : null);
  if (value === null || value === true) return;
  if (value === undefined) return setText(el, "Loading…");
  if (typeof value === "string") return setText(el, value);
  if (value instanceof Node) return replace(el, value);
  if ("state" in value) return setAttr(el, "data-state", value.state);
  if ("address" in value) {
    const link = Object.assign(document.createElement("a"), {
      href: `${BASESCAN}/${value.address.length > 42 ? "tx" : "address"}/${value.address}`,
    });
    if (value.text === undefined) hex(link, value.address);
    else link.textContent = value.text;
    return replace(el, link);
  }
  if (el instanceof HTMLAnchorElement) {
    setAttr(el, "href", value.href);
    setAttr(el, "target", value.external ? "_blank" : null);
    setAttr(el, "rel", value.external ? "noopener" : null);
    return setText(el, value.text);
  }
  replace(el, Object.assign(document.createElement("a"), { href: value.href, textContent: value.text }));
}

// Fills `root` and its descendants, except the rows of lists inside it, which `list()` fills.
export function fill(root: ParentNode, values: Record<string, Value>): void {
  const all = [...root.querySelectorAll<HTMLElement>("[data-text]")];
  for (const el of root instanceof HTMLElement && root.dataset.text ? [root, ...all] : all) {
    const list = el.parentElement?.closest("[data-list]");
    if (list && list !== root && root.contains(list)) continue;
    const key = el.dataset.text!;
    if (key in values) put(el, values[key]);
  }
}

export const fromTemplate = (id: string): HTMLElement =>
  $<HTMLTemplateElement>(`#${id}`).content.firstElementChild!.cloneNode(true) as HTMLElement;

// Draws a list's rows from its template, reusing each row by key so focus and ticks survive a redraw. The row saying
// the list is empty has the key `""`.
export function list<T>(
  el: HTMLElement,
  items: T[],
  keyOf: (item: T, i: number) => string,
  fillRow: (row: HTMLElement, item: T, i: number) => void,
): void {
  const old = new Map(
    [...el.children].filter((row) => row instanceof HTMLElement).map((row) => [row.dataset.key ?? "", row]),
  );
  const empty = el.dataset.empty;
  const rows = items.map((item, i) => {
    const key = keyOf(item, i);
    const row = old.get(key) ?? fromTemplate(el.dataset.list!);
    row.dataset.key = key;
    old.delete(key);
    fillRow(row, item, i);
    return row;
  });
  if (!items.length && empty) {
    rows.push(
      old.get("") ?? Object.assign(document.createElement("li"), { className: "u-small u-quiet", textContent: empty }),
    );
    old.delete("");
  }
  const focused = [...old.values()].some((row) => row.contains(document.activeElement));
  rows.forEach((row, i) => el.children[i] !== row && el.insertBefore(row, el.children[i] ?? null));
  for (const row of old.values()) row.remove();
  // If a removed row held focus, move it to the heading of the row's section or dialog so it isn't lost.
  const heading = focused ? el.closest("section, dialog")?.querySelector<HTMLElement>("h1, h2, h3") : undefined;
  if (heading) {
    heading.tabIndex = -1;
    heading.focus();
  }
}

// Turns a read into a `Value`: loading while it reads, "Not read" if it failed, hidden when it read `null` (nothing to
// show).
export const shown = <T>(got: Got<T>, text: (value: NonNullable<T>) => Value): Value =>
  got.value === null ? null : got.value !== undefined ? text(got.value) : got.failed ? "Not read" : undefined;
export const stateOf = (got: Got<unknown>, empty?: boolean): Value => ({
  state: got.value !== undefined ? (empty ? "empty" : "ready") : got.failed ? "failed" : "loading",
});

type Line = { symbol: string; amount: string; value: string; worth: string; route: string; note: Value };
export function bill(
  label: Value,
  day: Value,
  lines: Line[],
  sums: [string, Value, Value?][],
  [total, value, worth, detail = null]: [Value, Value, Value, Value?],
  foot: Value = null,
  after: Value = null,
): HTMLElement {
  const node = fromTemplate("bill");
  fill(node, {
    label,
    day,
    total,
    "total-value": value,
    "total-worth": worth,
    "total-detail": detail,
    foot,
    after,
    closing: foot === null && after === null ? null : true,
  });
  list(
    $("[data-list=line]", node),
    lines,
    (_, i) => String(i),
    (li, line) => fill(li, { ...line }),
  );
  list(
    $("[data-list=sum]", node),
    sums,
    (_, i) => String(i),
    (row, [label, value, detail]) => fill(row, { label, value, detail: detail || null }),
  );
  return node;
}

// Puts a shape before the words so a status never relies on colour alone.
export function status(shape: string, strong: string, ...rest: (string | Node)[]): HTMLElement {
  const span = document.createElement("span");
  const mark = Object.assign(document.createElement("span"), { className: "Shape" });
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
// Keeps words such as "cbBTC" as written in a label that CSS uppercases.
export const asWritten = (text: string): DocumentFragment =>
  frag(...text.split(/(\S*[a-z][A-Z]\S*)/).map((part, i) => (i % 2 ? code(part) : part)));

// Splits hex into spans of four digits that CSS spaces apart, so a copy is still plain hex. An address or hash splits
// into two halves that break where one line doesn't fit; with `wallet`, an address takes three lines, as the wallet
// shows it; calldata gets a line per 32-byte word.
export function hex(el: HTMLElement, value: string, wallet = false): void {
  if (el.dataset.hex === `${wallet} ${value}`) return;
  el.dataset.hex = `${wallet} ${value}`;
  const link = el instanceof HTMLAnchorElement;
  el.classList.add("Hex");
  el.classList.toggle("Hex--link", link);
  el.translate = false;
  const block = wallet || hexLines(value).length > 1;
  el.classList.toggle("Hex--halves", !block);
  const lines = wallet
    ? walletLines(value)
    : hexLines(value).length === 1
      ? halves(hexLines(value)[0]!)
      : hexLines(value);
  el.replaceChildren(
    ...lines.map((groups, i) => {
      const className = !block
        ? `Hex-half${link ? " Hex-half--link" : ""}`
        : wallet && i === 0
          ? "Hex-line Hex-line--indent"
          : "Hex-line";
      const line = Object.assign(document.createElement("span"), { className });
      line.append(
        ...groups.map((group) =>
          Object.assign(document.createElement("span"), {
            className: wallet ? "Hex-quad Hex-quad--wallet" : "Hex-quad",
            textContent: group,
          }),
        ),
      );
      return line;
    }),
  );
}
const halves = (groups: string[]): string[][] => [
  groups.slice(0, Math.ceil(groups.length / 2)),
  groups.slice(Math.ceil(groups.length / 2)),
];

// Announces a change in the page's one polite live region, `#status`. Never use it for loading.
export function announce(text: string): void {
  const region = $("#status");
  region.textContent = "";
  queueMicrotask(() => (region.textContent = text));
}
// A busy button keeps its size and name under a spinner and stays disabled until its action is done. Draws set
// `disabled` through `enable()`, which leaves a busy button disabled.
export function busy(button: HTMLButtonElement, on = true): void {
  button.disabled = on;
  setAttr(button, "aria-busy", on ? "true" : null);
}
export const enable = (button: HTMLButtonElement, can: boolean): void =>
  void (button.disabled = !can || button.getAttribute("aria-busy") === "true");
export const toggle = (name: string, on: boolean, value = ""): void =>
  setAttr(document.documentElement, `data-${name}`, on ? value : null);
