import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { getAddress } from "viem";
import {
  ACCOUNT_NAMES,
  APPROVAL_LOGIC,
  APPROVAL_LOGIC_CODE_HASH,
  CONDUIT,
  CONDUIT_CODE_HASH,
  KVCM,
  MULTICALL3,
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
  const addresses = [...contracts, ACCOUNT_NAMES, ...conduits.map(({ address }) => address)];
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
  assert.deepEqual(connect, RPCS);
  assert.ok(RPCS.every((rpc) => rpc === new URL(rpc).origin && rpc.startsWith("https://")));
  const readme = read("README.md");
  for (const origin of connect) assert.ok(readme.includes(`\`${origin}\``), `${origin} is missing from the README`);
});

test("the page checks the integrity of its script and stylesheet, and has nothing inline", () => {
  const html = read("index.html");
  assert.doesNotMatch(html, /\sstyle=|<style/);
  assert.deepEqual(html.match(/<(?:link|script)\b[^>]*>/g), [
    '<link rel="icon" href="icon.svg" type="image/svg+xml" />',
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
