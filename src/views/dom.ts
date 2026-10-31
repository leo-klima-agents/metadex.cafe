import type { Address, Hex } from "viem";
import { ADDRESSES, BASESCAN } from "../config.ts";
import { day, hexLines, short, walletLines } from "../format.ts";

export const $ = <T extends Element = HTMLElement>(selector: string, root: ParentNode = document): T =>
  root.querySelector<T>(selector)!;
export const $$ = <T extends Element = HTMLElement>(selector: string, root: ParentNode = document): T[] => [
  ...root.querySelectorAll<T>(selector),
];
export const txUrl = (hash: Hex): string => `${BASESCAN}/tx/${hash}`;
export const addressUrl = (address: Address): string => `${BASESCAN}/address/${address}`;

// A value: text; undefined while being read, as a quiet bar that screen readers hear as "Loading"; or with a link or a
// time. An element marked data-v-row hides while its value is "" or null.
export type Value = string | null | undefined | { text: string; href?: string; time?: number; hex?: string };

function put(element: HTMLElement, value: Value): void {
  if (value === undefined) {
    if (element.hasAttribute("data-pending")) return;
    element.setAttribute("data-pending", "");
    element.replaceChildren(Object.assign(document.createElement("span"), { className: "sr", textContent: "Loading" }));
    return;
  }
  element.removeAttribute("data-pending");
  const { text = "", href, time, hex } = typeof value === "object" && value ? value : { text: value ?? "" };
  if (href !== undefined) element.setAttribute("href", href);
  if (time !== undefined) element.setAttribute("datetime", new Date(time * 1000).toISOString());
  if (hex) return showHex(element, hex);
  if (element.textContent !== text || element.children.length) element.textContent = text;
}

export function fill(root: ParentNode, values: Record<string, Value>): void {
  for (const [name, value] of Object.entries(values)) {
    for (const element of $$(`[data-v="${name}"]`, root)) put(element, value);
    for (const row of $$(`[data-v-row="${name}"]`, root)) row.hidden = value === "" || value === null;
  }
}
export const time = (seconds: number, format = day): Value => ({ text: format(seconds), time: seconds });
export const link = (href: string, text: string): Value => ({ text, href });
export const addressLink = (address: Address): Value => ({ text: address, href: addressUrl(address), hex: address });

export const setState = (element: HTMLElement, state: string): void => void (element.dataset.state = state);
export const show = (element: Element, shown: boolean): void => void ((element as HTMLElement).hidden = !shown);

export const clone = (id: string): HTMLElement =>
  $<HTMLTemplateElement>(`#${id}`).content.firstElementChild!.cloneNode(true) as HTMLElement;

// The items as rows of a template, reusing each row by key, so ticks and focus stay where they were.
export function list<T>(
  container: Element,
  template: string,
  items: T[],
  key: (item: T) => string,
  draw: (row: HTMLElement, item: T) => void,
): void {
  const kept = new Map($$<HTMLElement>(":scope > [data-key]", container).map((row) => [row.dataset.key!, row]));
  const rows = items.map((item) => {
    const name = key(item);
    const row = kept.get(name) ?? clone(template);
    row.dataset.key = name;
    draw(row, item);
    return row;
  });
  if (rows.some((row, i) => container.children[i] !== row) || container.children.length !== rows.length)
    container.replaceChildren(...rows);
}

// A status: a shape before the words, never colour alone.
export function status(element: HTMLElement, shape: string | undefined, title: Value, rest: Value = ""): void {
  if (!element.querySelector(".shape"))
    element.replaceChildren($<HTMLTemplateElement>("#status").content.cloneNode(true));
  const mark = $(".shape", element);
  if (shape) mark.dataset.shape = shape;
  else delete mark.dataset.shape;
  fill(element, { title, rest });
}

// A button's action under way: it keeps its place and focus, shows a spinner, and takes no second click.
export function busy(button: HTMLElement, on = true): void {
  button.setAttribute("aria-busy", String(on));
  button.setAttribute("aria-disabled", String(on));
}
export const isBusy = (button: HTMLElement): boolean => button.getAttribute("aria-disabled") === "true";

// Hex in groups of four that CSS spaces, so a copy is still plain hex: an address or a hash on one line, calldata a word
// a line; or an address on three lines, as hardware wallets show it.
export function showHex(element: Element, hex: string, wallet = false): void {
  const lines = wallet ? walletLines(hex) : hexLines(hex);
  element.classList.add("hex");
  element.replaceChildren(
    ...lines.flatMap((line, i) =>
      line.map((group, j) =>
        Object.assign(document.createElement("span"), { textContent: group, className: i && !j ? "line" : "" }),
      ),
    ),
  );
}

// Every contract link in the page, from config.ts.
export function linkAddresses(): void {
  for (const element of $$<HTMLAnchorElement>("[data-address]")) {
    const address = ADDRESSES[element.dataset.address!]!;
    element.href = `${addressUrl(address)}${"code" in element.dataset ? "#code" : ""}`;
    element.setAttribute("aria-label", `${short(address)} on Basescan`);
    element.translate = false;
    showHex(element, address);
  }
}
