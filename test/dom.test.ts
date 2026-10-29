import assert from "node:assert/strict";
import { after, test } from "node:test";
import { PENDING, fill, fillTime, live, rewrite, setText, showWorth, showWorthIn } from "../src/dom.ts";
import { money, moneyAt, setCurrency } from "../src/format.ts";

// An element as far as text and its classes go, and a root that holds it under one class.
const element = () => pendable() as unknown as Element;
const rootOf = (name: string, held: Element) =>
  ({ querySelectorAll: (selector: string) => (selector === `.${name}` ? [held] : []) }) as unknown as ParentNode;

test("money is written again in the currency picked, wherever it is, until plain text is written over it", () => {
  const then = { unit: "USD", rates: { EUR: 1.25 } } as const;
  const [direct, filled, overwritten] = [element(), element(), element()];
  live(direct, () => money(moneyAt(10, then)));
  fill(rootOf("worth", filled), { worth: () => `${money(moneyAt(250, then))} waiting` });
  fill(rootOf("worth", overwritten), { worth: () => money(moneyAt(1, then)) });
  fill(rootOf("worth", overwritten), { worth: "Nothing waiting" });
  assert.equal(direct.textContent, "≈ $10.00");
  assert.equal(filled.textContent, "≈ $250 waiting");
  setCurrency("EUR");
  try {
    assert.equal(direct.textContent, "≈ €8.00");
    assert.equal(filled.textContent, "≈ €200 waiting");
    assert.equal(overwritten.textContent, "Nothing waiting");
  } finally {
    setCurrency("USD");
  }
  assert.equal(direct.textContent, "≈ $10.00");
});

test("money is written again from what it shows, once that changes", () => {
  const state = { value: 1 };
  const shown = element();
  live(shown, () => money({ value: state.value, unit: "USD" }));
  assert.equal(shown.textContent, "≈\u00a0$1.00");
  state.value = 2;
  rewrite();
  assert.equal(shown.textContent, "≈\u00a0$2.00");
});

test("an element switched between money and plain text is written once a rewrite, however often it switched", () => {
  let writes = 0;
  const counted = {
    set textContent(_: string) {
      writes++;
    },
    classList: { remove: () => {} },
  } as unknown as Element;
  const root = rootOf("line", counted);
  for (let i = 0; i < 3; i++) {
    fill(root, { line: () => "≈ $1.00" });
    fill(root, { line: "Not read" });
  }
  fill(root, { line: () => "≈ $1.00" });
  writes = 0;
  rewrite();
  assert.equal(writes, 1);
});

// An element as far as a pending figure goes: its text, its classes and attributes, and how often its children were
// replaced.
function pendable() {
  const classes = new Set<string>();
  const attributes = new Map<string, string>();
  const element = {
    textContent: "",
    replaced: 0,
    classList: {
      contains: (name: string) => classes.has(name),
      add: (name: string) => void classes.add(name),
      remove: (name: string) => void classes.delete(name),
    },
    getAttribute: (name: string) => attributes.get(name) ?? null,
    setAttribute: (name: string, value: string) => void attributes.set(name, value),
    removeAttribute: (name: string) => void attributes.delete(name),
    replaceChildren(...nodes: { textContent: string }[]) {
      element.replaced++;
      element.textContent = nodes.map((node) => node.textContent).join("");
    },
  };
  return element;
}
// A document that makes the words screen readers say in a pending figure's place, until the tests end.
const documentBefore = Object.getOwnPropertyDescriptor(globalThis, "document");
globalThis.document = { createElement: () => ({ className: "", textContent: "" }) } as unknown as Document;
after(() => {
  if (documentBefore) Object.defineProperty(globalThis, "document", documentBefore);
  else delete (globalThis as { document?: Document }).document;
});

test("a figure being read is pending, with words for screen readers, until text is written over it", () => {
  const figure = pendable();
  const root = rootOf("figure", figure as unknown as Element);
  fill(root, { figure: PENDING });
  assert.equal(figure.classList.contains("pending"), true);
  assert.equal(figure.textContent, "Loading");
  fill(root, { figure: PENDING });
  assert.equal(figure.replaced, 1, "pending again changes nothing");
  fill(root, { figure: "Not read yet" });
  assert.equal(figure.classList.contains("pending"), false);
  assert.equal(figure.textContent, "Not read yet");
  setText(figure as unknown as Element, PENDING);
  assert.equal(figure.classList.contains("pending"), true);
});

test("money stays pending until what it shows is read, and a rewrite then writes it", () => {
  const state: { value?: number } = {};
  const shown = pendable();
  live(shown as unknown as Element, () =>
    state.value === undefined ? PENDING : money({ value: state.value, unit: "USD" }),
  );
  assert.equal(shown.classList.contains("pending"), true);
  rewrite();
  assert.equal(shown.replaced, 1, "still pending, written once");
  state.value = 3;
  rewrite();
  assert.equal(shown.classList.contains("pending"), false);
  assert.equal(shown.textContent, "≈\u00a0$3.00");
});

test("a date, or an amount and what it is worth, ends what was pending where it is written", () => {
  const [time, exact, worth, line] = [pendable(), pendable(), pendable(), pendable()];
  for (const each of [time, exact, worth, line]) setText(each as unknown as Element, PENDING);
  const at = Object.assign(time, { dateTime: "" });
  fillTime({ querySelectorAll: () => [at] } as unknown as ParentNode, "voted", 1_792_540_800);
  assert.equal(time.classList.contains("pending"), false);
  assert.equal(at.dateTime, "2026-10-21T00:00:00.000Z");
  showWorthIn(exact as unknown as Element, worth as unknown as Element, PENDING);
  assert.equal(exact.classList.contains("pending"), true, "an amount still read waits");
  assert.equal(worth.classList.contains("pending"), true, "what it is worth keeps its line meanwhile");
  assert.equal(worth.getAttribute("aria-hidden"), "true", "screen readers hear it wait once");
  showWorthIn(exact as unknown as Element, worth as unknown as Element, "0.5 USDC");
  assert.equal(exact.classList.contains("pending"), false);
  assert.equal(exact.textContent, "0.5 USDC");
  assert.equal(worth.classList.contains("pending"), false, "with no worth, its line goes");
  assert.equal(worth.getAttribute("aria-hidden"), null);
  showWorth(line as unknown as Element, "0.5 USDC");
  assert.equal(line.classList.contains("pending"), false);
  assert.equal(line.textContent, "0.5 USDC");
});
