import type { Address, Hex } from "viem";
import { day, short } from "./format.ts";

const BASESCAN = "https://basescan.org";

export function show(selector: string, shown = true, root: ParentNode = document): void {
  for (const element of root.querySelectorAll<HTMLElement>(selector)) element.hidden = !shown;
}

export function clone(id: string): DocumentFragment {
  return (document.getElementById(id) as HTMLTemplateElement).content.cloneNode(true) as DocumentFragment;
}

export function fill(root: ParentNode, texts: Record<string, string>): void {
  for (const [name, text] of Object.entries(texts)) {
    for (const element of root.querySelectorAll(`.${name}`)) element.textContent = text;
  }
}

export function fillTime(root: ParentNode, name: string, time: number, format = day): void {
  for (const element of root.querySelectorAll<HTMLTimeElement>(`time.${name}`)) {
    element.dateTime = new Date(time * 1000).toISOString();
    element.textContent = format(time);
  }
}

export function fillAddress(root: ParentNode, name: string, address: Address, text = short(address)): void {
  for (const link of root.querySelectorAll<HTMLAnchorElement>(`a.${name}`)) {
    link.href = `${BASESCAN}/address/${address}`;
    link.textContent = text;
  }
}

export function fillPlural(root: ParentNode, n: number): void {
  for (const element of root.querySelectorAll<HTMLElement>("[data-one]")) {
    element.textContent = (n === 1 ? element.dataset.one : element.dataset.many) ?? "";
  }
}

export function txLink(hash: Hex): HTMLAnchorElement {
  const link = document.createElement("a");
  link.href = `${BASESCAN}/tx/${hash}`;
  link.textContent = `${hash.slice(0, 10)}…`;
  return link;
}
