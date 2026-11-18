import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { getAddress } from "viem";
import { RPCS } from "../src/config.ts";
import { parse } from "../src/routes.ts";

const html = readFileSync(new URL("../site/index.html", import.meta.url), "utf8");
const css = readFileSync(new URL("../site/style.css", import.meta.url), "utf8");

test("the page reaches its RPCs and nothing else, checks its script and stylesheet, and has nothing inline", () => {
  const csp = /http-equiv="Content-Security-Policy"\s+content="([^"]+)"/.exec(html)?.[1] ?? "";
  assert.equal(/connect-src ([^;]+)/.exec(csp)?.[1], RPCS.join(" "));
  assert.match(csp, /default-src 'none'; script-src 'self'; style-src 'self'; font-src data:/);
  assert.match(html, /<link rel="stylesheet" href="style.css" integrity="%STYLE_INTEGRITY%" \/>/);
  assert.match(html, /<script type="module" src="main.js" integrity="%MAIN_INTEGRITY%"><\/script>/);
  assert.doesNotMatch(html, /<style|style="|<script>|\son[a-z]+="/);
  assert.doesNotMatch(css, /url\((?!"fonts\/)/, "fonts come only from fonts/, inlined by the build");
});

test("ids are unique, every address in the page is one of its routes, and each view has a title", () => {
  const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map(([, id]) => id);
  assert.deepEqual(ids, [...new Set(ids)]);
  for (const [, href = ""] of html.matchAll(/href="(#[^"]*)"/g))
    if (href !== "#" && href !== "#main") assert.notEqual(parse(href).view, "home", href);
  for (const [section] of html.matchAll(/<section data-view="[^"]+"[^>]*>/g))
    assert.match(section!, /data-title="[^"]+"/);
});

test("addresses are checksummed, and the page names nobody who runs it", () => {
  const source = readFileSync(new URL("../src/config.ts", import.meta.url), "utf8");
  // Whole addresses, not the start of a longer hex string such as a hash.
  const addresses = source.match(/0x[0-9a-fA-F]{40}(?![0-9a-fA-F])/g) ?? [];
  assert.ok(addresses.length > 30);
  for (const address of addresses) assert.equal(address, getAddress(address));
  assert.doesNotMatch(html, /github\.com|ldeso|léo/i);
});

test("llms.txt links only to the page's routes and to contracts the page trusts, and names nobody who runs it", () => {
  const llms = readFileSync(new URL("../site/llms.txt", import.meta.url), "utf8");
  const source = readFileSync(new URL("../src/config.ts", import.meta.url), "utf8");
  assert.match(llms, /^# metaDEX Café\n\n> .+\n\n/);
  const routes = [...llms.matchAll(/\]\(https:\/\/metadex\.cafe\/(#[^)]*)\)/g)].map(([, href = ""]) => href);
  // The sections and examples in backticks, such as `#app/allows` and `#hydrex/9540`, but not the patterns.
  const examples = [...llms.matchAll(/`(#[^`<]+)`/g)].map(([, href = ""]) => href);
  assert.ok(routes.length > 5 && examples.length > 5);
  for (const href of [...routes, ...examples]) assert.notEqual(parse(href).view, "home", href);
  const addresses = llms.match(/0x[0-9a-fA-F]{40}(?![0-9a-fA-F])/g) ?? [];
  assert.ok(addresses.length > 10);
  for (const address of addresses) assert.ok(source.includes(`"${address}"`), address);
  for (const rpc of RPCS) assert.ok(llms.includes(`\`${rpc}\``), rpc);
  assert.doesNotMatch(llms, /github\.com|ldeso|léo/i);
});
