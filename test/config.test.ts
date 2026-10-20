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
  AUTOMATIONS,
  AUTOMAXI,
  AUTOMAXI_FEE_BPS,
  AUTOMAXI_TREASURY,
  CARBON_IMPACT,
  KEEPER,
  KVCM,
  MULTICALL3,
  PAIR_FACTORY,
  RPCS,
  VOTER,
  VOTING_ESCROW,
  VOTING_ESCROW_IMPLEMENTATION,
  VOTING_ESCROW_IMPLEMENTATION_CODE_HASH,
} from "../src/config.ts";
import { LANG, bps } from "../src/format.ts";
import conduits from "../src/hydrex-conduits.json" with { type: "json" };

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("addresses are checksummed, and code hashes are 32 bytes", () => {
  const contracts = [
    MULTICALL3,
    ...AUTOMATIONS.map(({ address }) => address),
    AUTOMAXI_TREASURY,
    KEEPER,
    KVCM,
    VOTING_ESCROW,
    VOTING_ESCROW_IMPLEMENTATION,
    APPROVAL_LOGIC,
    VOTER,
  ];
  const prices = [
    ALGEBRA_FACTORY,
    PAIR_FACTORY,
    ...ANCHORS.flatMap(({ address, feed }) => (feed ? [address, feed] : [address])),
  ];
  const addresses = [...contracts, ACCOUNT_NAMES, ...prices, ...conduits.map(({ address }) => address)];
  for (const address of addresses) assert.equal(getAddress(address), address);
  const hashes = [...AUTOMATIONS.map(({ codeHash }) => codeHash), VOTING_ESCROW_IMPLEMENTATION_CODE_HASH];
  for (const hash of [...hashes, APPROVAL_LOGIC_CODE_HASH]) {
    assert.match(hash, /^0x[0-9a-f]{64}$/);
  }
});

test("Hydrex names the conduit Carbon Impact, and the page links to it, the VotingEscrow and the Voter", () => {
  assert.equal(conduits.find(({ address }) => address === CARBON_IMPACT.address)?.name, "Carbon Impact");
  const html = read("index.html");
  assert.ok(html.includes(`<html lang="${LANG}">`), "the page and its numbers and dates use one language");
  for (const address of [CARBON_IMPACT.address, VOTING_ESCROW, VOTER]) {
    assert.ok(html.includes(`/address/${address}"`), address);
  }
});

test("each automation has a kind, a name and the approvals of its own, and AutoMaxi's fee facts match its code", () => {
  assert.deepEqual(
    AUTOMATIONS.map(({ kind, name, actions }) => [kind, name, actions]),
    [
      ["carbon-impact", "Carbon Impact", [3, 5]],
      ["automaxi", "AutoMaxi", [3, 5]],
    ],
  );
  const html = read("index.html");
  // Each automation's page has the same six rows, in the same order.
  const page = (id: string) => html.slice(html.indexOf(`<div id="${id}" class="view"`)).split('class="view"')[1] ?? "";
  const rows = (facts: string) => [...facts.matchAll(/<dt>([^<]+)<\/dt>/g)].map(([, row]) => row);
  const SIX = ["Taken", "The most it can become", "Goes to", "When", "Other costs", "Who can change it"];
  const factsOf = (id: string) => /<dl class="fee-facts">[\s\S]*?<\/dl>/.exec(page(id))?.[0] ?? "";
  assert.deepEqual(rows(factsOf("carbon-impact")), SIX);
  const facts = factsOf("automaxi");
  assert.deepEqual(rows(facts), SIX);
  assert.equal(bps(AUTOMAXI_FEE_BPS), "1%");
  assert.match(facts, /<dd>1% of each claim<\/dd>/);
  assert.match(facts, /<dd[^>]*>1%, fixed in its code<\/dd>/);
  assert.ok(facts.includes(`/address/${AUTOMAXI_TREASURY}"`));
  assert.ok(page("automaxi").includes(AUTOMAXI.codeHash), "its page shows the code hash the page checks");
  assert.equal(AUTOMAXI.address, getAddress(AUTOMAXI.address));
});

test("Choose finds each fact of each choice on the page: on its card in the menu, or in its page's fee facts", () => {
  const html = read("index.html");
  const card = /<article class="choice" data-choice="([^"]+)"[\s\S]*?<\/article>/g;
  const cards = new Map([...html.matchAll(card)].map(([text, choice]) => [choice!, text]));
  const page = (id: string) => html.slice(html.indexOf(`<div id="${id}" class="view"`)).split('class="view"')[1] ?? "";
  const factsOf = (id: string) => /<dl class="fee-facts">[\s\S]*?<\/dl>/.exec(page(id))?.[0] ?? "";
  assert.deepEqual([...cards.keys()], [...AUTOMATIONS.map(({ kind }) => kind), "self"]);
  for (const [choice, text] of cards) {
    for (const fact of ["pays", "taken", "most", "leaving"]) {
      const has = (source: string) => new RegExp(`data-fact="[^"]*\\b${fact}\\b`).test(source);
      assert.ok(has(text) || has(factsOf(choice)), `${choice} states "${fact}"`);
    }
  }
});

test("the page may reach its RPCs and nothing else, and the README lists them", () => {
  const csp = /http-equiv="Content-Security-Policy"\s+content="([^"]+)"/.exec(read("index.html"))?.[1] ?? "";
  const connect = (/connect-src ([^;]+)/.exec(csp)?.[1] ?? "").trim().split(/\s+/);
  // The order in the policy does not matter.
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
    conduits
      .filter(({ address }) => !AUTOMATIONS.some((automation) => automation.address === address))
      .map(({ address }) => address),
  );
});
