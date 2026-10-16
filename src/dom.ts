import type { Address, Hex } from "viem";

/** Sets the text of every element with this class in root. */
export function fill(root: ParentNode, name: string, text: string): void {
  for (const element of root.querySelectorAll(`.${name}`)) element.textContent = text;
}

/** Sets every <time> with this class to a time: its datetime, and its text in a given format. */
export function fillTime(root: ParentNode, name: string, time: number, format: (time: number) => string): void {
  for (const element of root.querySelectorAll<HTMLTimeElement>(`time.${name}`)) {
    element.dateTime = new Date(time * 1000).toISOString();
    element.textContent = format(time);
  }
}

/** Sets every link with this class to an address: its page on Basescan, and the text shown. */
export function fillAddress(root: ParentNode, name: string, address: Address, text: string): void {
  for (const link of root.querySelectorAll<HTMLAnchorElement>(`a.${name}`)) {
    link.href = `https://basescan.org/address/${address}`;
    link.textContent = text;
  }
}

/** Picks the singular or plural word of every element with data-one and data-many in root. */
export function fillPlural(root: ParentNode, n: number): void {
  for (const element of root.querySelectorAll<HTMLElement>("[data-one]")) {
    element.textContent = (n === 1 ? element.dataset.one : element.dataset.many) ?? "";
  }
}

/** A link to a transaction on Basescan. */
export function txLink(hash: Hex, text: string): HTMLAnchorElement {
  const link = document.createElement("a");
  link.href = `https://basescan.org/tx/${hash}`;
  link.textContent = text;
  return link;
}

export function show(id: string, shown = true): void {
  document.getElementById(id)!.hidden = !shown;
}

/** Shows or hides every element with this class. */
export function showAll(name: string, shown: boolean): void {
  for (const element of document.querySelectorAll<HTMLElement>(`.${name}`)) element.hidden = !shown;
}

export function clone(template: string): DocumentFragment {
  return (document.getElementById(template) as HTMLTemplateElement).content.cloneNode(true) as DocumentFragment;
}
