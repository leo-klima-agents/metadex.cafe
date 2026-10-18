import type { Address, Hex } from "viem";
import { day, hexLines } from "./format.ts";

const BASESCAN = "https://basescan.org";

export const txUrl = (hash: Hex): string => `${BASESCAN}/tx/${hash}`;

export function show(selector: string, shown = true, root: ParentNode = document): void {
  for (const element of root.querySelectorAll<HTMLElement>(selector)) element.hidden = !shown;
}

export function clone(id: string): DocumentFragment {
  return (document.getElementById(id) as HTMLTemplateElement).content.cloneNode(true) as DocumentFragment;
}

export function fill(root: ParentNode, textByClass: Record<string, string>): void {
  for (const [name, text] of Object.entries(textByClass)) {
    for (const element of root.querySelectorAll(`.${name}`)) element.textContent = text;
  }
}

export function fillTime(root: ParentNode, name: string, time: number, format = day): void {
  for (const element of root.querySelectorAll<HTMLTimeElement>(`time.${name}`)) {
    element.dateTime = new Date(time * 1000).toISOString();
    element.textContent = format(time);
  }
}

// Writes hex in groups of four. CSS spaces the groups, so a copy is still the plain hex.
export function showHex(element: Element, hex: string): void {
  const fragment = document.createDocumentFragment();
  hexLines(hex).forEach((line, i) =>
    line.forEach((group, j) => {
      if (i || j) fragment.append(document.createElement("wbr"));
      const span = document.createElement("span");
      span.textContent = group;
      if (i && !j) span.className = "line";
      fragment.append(span);
    }),
  );
  element.classList.add("hex");
  element.replaceChildren(fragment);
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

export function txLink(hash: Hex): HTMLAnchorElement {
  const link = document.createElement("a");
  link.href = txUrl(hash);
  link.textContent = `${hash.slice(0, 10)}…`;
  return link;
}
