import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { getAddress } from "viem";
import {
  ACCOUNT_NAMES,
  ALGEBRA_FACTORY,
  ANCHORS,
  APPROVAL_LOGIC,
  APPROVAL_LOGIC_CODE_HASH,
  CONDUIT,
  CONDUIT_CODE_HASH,
  KVCM,
  MULTICALL3,
  PAIR_FACTORY,
  RPCS,
  VOTER,
  VOTING_ESCROW,
  VOTING_ESCROW_IMPLEMENTATION,
  VOTING_ESCROW_IMPLEMENTATION_CODE_HASH,
} from "../src/config.ts";
import { LANG } from "../src/format.ts";
import conduits from "../src/hydrex-conduits.json" with { type: "json" };

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("addresses are checksummed, and code hashes are 32 bytes", () => {
  const contracts = [MULTICALL3, CONDUIT, KVCM, VOTING_ESCROW, VOTING_ESCROW_IMPLEMENTATION, APPROVAL_LOGIC, VOTER];
  const prices = [
    ALGEBRA_FACTORY,
    PAIR_FACTORY,
    ...ANCHORS.flatMap(({ address, feed }) => (feed ? [address, feed] : [address])),
  ];
  const addresses = [...contracts, ACCOUNT_NAMES, ...prices, ...conduits.map(({ address }) => address)];
  for (const address of addresses) assert.equal(getAddress(address), address);
  for (const hash of [CONDUIT_CODE_HASH, VOTING_ESCROW_IMPLEMENTATION_CODE_HASH, APPROVAL_LOGIC_CODE_HASH]) {
    assert.match(hash, /^0x[0-9a-f]{64}$/);
  }
});

test("Hydrex names the conduit Carbon Impact, and the page links to it, the VotingEscrow and the Voter", () => {
  assert.equal(conduits.find(({ address }) => address === CONDUIT)?.name, "Carbon Impact");
  const html = read("index.html");
  assert.ok(html.includes(`<html lang="${LANG}">`), "the page and its numbers and dates use one language");
  for (const address of [CONDUIT, VOTING_ESCROW, VOTER]) assert.ok(html.includes(`/address/${address}"`), address);
});

test("the page may reach its RPCs and nothing else, and the README lists them", () => {
  const csp = /http-equiv="Content-Security-Policy"\s+content="([^"]+)"/.exec(read("index.html"))?.[1] ?? "";
  const connect = (/connect-src ([^;]+)/.exec(csp)?.[1] ?? "").trim().split(/\s+/);
  // The order in which they are asked is RPCS's own; a policy's has no meaning.
  assert.deepEqual([...connect].sort(), [...RPCS].sort());
  assert.ok(RPCS.every((rpc) => rpc === new URL(rpc).origin && rpc.startsWith("https://")));
  const readme = read("README.md");
  for (const origin of connect) assert.ok(readme.includes(`\`${origin}\``), `${origin} is missing from the README`);
});

test("fonts come only from the stylesheet, which the build makes of the files in fonts/", () => {
  const csp = /http-equiv="Content-Security-Policy"\s+content="([^"]+)"/.exec(read("index.html"))?.[1] ?? "";
  assert.ok(csp.split(/;\s*/).includes("font-src data:"));
  const urls = [...read("style.css").matchAll(/url\(([^)]+)\)/g)].map(([, url]) => url!.replace(/^"|"$/g, ""));
  assert.ok(urls.length > 0);
  for (const url of urls) {
    assert.match(url, /^fonts\/[a-z0-9-]+\.woff2$/);
    assert.ok(existsSync(new URL(`../${url}`, import.meta.url)), `${url} is missing`);
  }
});

test("colours have plain values first, and light-dark() only where the browser supports it", () => {
  const css = read("style.css").replace(/\/\*[\s\S]*?\*\//g, "");
  const supported = /@supports \(color: light-dark\(red, red\)\) \{\n[\s\S]*?\n\}\n/.exec(css)?.[0] ?? "";
  assert.match(supported, /light-dark\(/);
  assert.doesNotMatch(css.replace(supported, ""), /light-dark\(|\bCanvas(Text)?\b/);
});

test("the page checks the integrity of its script and stylesheet, and has nothing inline", () => {
  const html = read("index.html");
  assert.doesNotMatch(html, /\sstyle=|<style/);
  assert.deepEqual(html.match(/<(?:link|script)\b[^>]*>/g), [
    '<link rel="icon" href="icon.svg" type="image/svg+xml" />',
    '<link rel="shortcut icon" href="favicon.ico" sizes="32x32" />',
    '<link rel="apple-touch-icon" href="apple-touch-icon.png" />',
    '<link rel="stylesheet" href="style.css" integrity="%STYLE_INTEGRITY%" />',
    '<script type="module" src="main.js" integrity="%MAIN_INTEGRITY%">',
  ]);
});

test("every address within the page has a target, and ids are unique", () => {
  const html = read("index.html");
  const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map(([, id]) => id!);
  assert.deepEqual(ids, [...new Set(ids)]);
  for (const [, id] of html.matchAll(/href="#([^"]+)"/g)) assert.ok(ids.includes(id!), `#${id} has no target`);
  for (const view of html.match(/<[^>]+class="view"[^>]*>/g) ?? []) assert.match(view, /data-title="[^"]+"/);
});

test("How it works lists each of its sections, and every other automation of Hydrex's", () => {
  const html = read("index.html");
  const view = html.slice(html.indexOf('<div id="how-it-works"'));
  const sections = [...view.matchAll(/<section id="([^"]+)"/g)].map(([, id]) => id);
  const contents = /<nav class="contents"[\s\S]*?<\/nav>/.exec(view)?.[0] ?? "";
  assert.deepEqual(
    [...contents.matchAll(/href="#([^"]+)"/g)].map(([, id]) => id),
    sections,
  );
  const rows = [...view.matchAll(/data-automation="([^"]+)"/g)].map(([, address]) => address);
  assert.deepEqual(
    rows,
    conduits.filter(({ address }) => address !== CONDUIT).map(({ address }) => address),
  );
});
