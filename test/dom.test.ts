import assert from "node:assert/strict";
import { test } from "node:test";
import { fill, live, rewrite } from "../src/dom.ts";
import { money, moneyAt, setCurrency } from "../src/format.ts";

// An element as far as text goes, and a root that holds it under one class.
const element = () => ({ textContent: "" }) as unknown as Element;
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
