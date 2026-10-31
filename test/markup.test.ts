import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { getAddress } from "viem";
import * as config from "../src/config.ts";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const css = readFileSync(new URL("../style.css", import.meta.url), "utf8");
const page = html.replace(/<template[\s\S]*?<\/template>/g, "");
const all = (pattern: RegExp, text = html) => [...text.matchAll(pattern)].map((match) => match[1]!);

test("addresses are checksummed, and every one the page links to is in the config", () => {
  const addresses = JSON.stringify(config, (_, value) => (typeof value === "bigint" ? `${value}` : value)).match(
    /0x[0-9a-fA-F]{40}/g,
  )!;
  for (const address of addresses) assert.equal(address, getAddress(address));
  for (const name of all(/data-address="([^"]+)"/g)) assert.ok(name in config.ADDRESSES, name);
});

test("the page reaches its RPCs and nothing else, and checks its script and stylesheet", () => {
  const csp = /content="(default-src[^"]+)"/.exec(html)![1]!;
  assert.deepEqual(/connect-src ([^;]+)/.exec(csp)![1]!.split(" "), config.RPCS);
  assert.match(html, /<script type="module" src="main.js" integrity="%MAIN_INTEGRITY%"><\/script>/);
  assert.doesNotMatch(page, /<script>|style="/);
});

test("ids are unique, and every reference points to one", () => {
  const ids = all(/\sid="([^"]+)"/g);
  assert.deepEqual(
    ids.filter((id, i) => ids.indexOf(id) !== i),
    [],
  );
  for (const id of all(/(?:aria-labelledby|aria-describedby|for|popovertarget)="([^"]+)"/g))
    for (const each of id.split(" ")) assert.ok(ids.includes(each), each);
  for (const id of all(/clone\("([a-z-]+)"\)/g, readSources())) assert.ok(ids.includes(id), id);
});

test("every view has one h1; every popup and dialog a name; every control a name; new tabs say so", () => {
  for (const view of page.split('<div class="view').slice(1)) assert.equal(view.match(/<h1/g)?.length, 1);
  for (const tag of page.match(/<(div|dialog)[^>]*\b(popover|<dialog)\b[^>]*>/g) ?? [])
    assert.match(tag, /aria-labelledby=/);
  for (const [, attributes, text] of html.matchAll(/<button([^>]*)>([\s\S]*?)<\/button>/g))
    assert.ok(/aria-label=|data-v=/.test(attributes! + text!) || text!.replace(/<[^>]+>/g, "").trim(), attributes);
  for (const [control, at] of page
    .matchAll(/<(?:input|select)\b[^>]*>/g)
    .map((match) => [match[0], match.index] as const)) {
    const id = /\sid="([^"]+)"/.exec(control)?.[1];
    const inLabel = page.lastIndexOf("<label", at) > page.lastIndexOf("</label>", at);
    assert.ok(inLabel || (id && page.includes(`for="${id}"`)), control);
  }
  for (const link of html.match(/<a [^>]*target="_blank"[\s\S]*?<\/a>/g) ?? [])
    assert.match(link, /opens in a new tab/);
});

// WCAG 2.2: 4.5:1 for text, 3:1 for edges and the focus ring.
test("colour pairs meet their contrast in light and dark", () => {
  const tokens = Object.fromEntries(
    [...css.matchAll(/--([a-z-]+): light-dark\((#[0-9a-f]{6}), (#[0-9a-f]{6})\)/g)].map(([, name, light, dark]) => [
      name!,
      [light!, dark!],
    ]),
  );
  const luminance = (hex: string) => {
    const [r, g, b] = [1, 3, 5].map((i) => {
      const c = parseInt(hex.slice(i, i + 2), 16) / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
  };
  const ratio = (a: string, b: string) => {
    const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
    return (x! + 0.05) / (y! + 0.05);
  };
  const pairs: [string, string, number][] = [
    ["ink", "paper", 4.5],
    ["ink", "card", 4.5],
    ["ink", "tint", 4.5],
    ["ink", "notice", 4.5],
    ["quiet", "paper", 4.5],
    ["quiet", "card", 4.5],
    ["quiet", "tint", 4.5],
    ["accent", "paper", 4.5],
    ["accent", "card", 4.5],
    ["on-accent", "accent", 4.5],
    ["warn", "card", 4.5],
    ["danger", "notice", 3],
    ["edge", "card", 3],
    ["edge", "paper", 3],
    ["accent", "tint", 3],
  ];
  for (const [fore, back, least] of pairs)
    for (const theme of [0, 1]) {
      const found = ratio(tokens[fore]![theme]!, tokens[back]![theme]!);
      assert.ok(found >= least, `${fore} on ${back}, ${theme ? "dark" : "light"}: ${found.toFixed(2)}`);
    }
});

function readSources(): string {
  return ["dom", "connect", "app", "hydrex", "account", "claim", "swap", "review"]
    .map((name) => {
      try {
        return readFileSync(new URL(`../src/views/${name}.ts`, import.meta.url), "utf8");
      } catch {
        return "";
      }
    })
    .join("\n");
}
