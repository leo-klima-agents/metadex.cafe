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
import { PRODUCT_SECTIONS, parse } from "../src/routes.ts";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

// A view of the page, from its opening tag to the next view's, or to the end of <main>.
function viewOf(html: string, ...attributes: string[]): string {
  const tags = [...html.matchAll(/<div\s+class="view[^"]*"[^>]*>/g)];
  const i = tags.findIndex(([tag]) => attributes.every((attribute) => tag.includes(attribute)));
  assert.ok(i >= 0, `no view with ${attributes.join(" ")}`);
  return html.slice(tags[i]!.index, tags[i + 1]?.index ?? html.indexOf("</main>"));
}
const productOf = (html: string, kind: string) => viewOf(html, 'data-view="product"', `data-kind="${kind}"`);

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
  const prices = [ALGEBRA_FACTORY, PAIR_FACTORY, ...ANCHORS.flatMap(({ address, feed }) => [address, feed.address])];
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
  const rows = (facts: string) => [...facts.matchAll(/<dt>([^<]+)<\/dt>/g)].map(([, row]) => row);
  const SIX = ["Taken", "The most it can become", "Goes to", "When", "Other costs", "Who can change it"];
  const factsOf = (kind: string) => /<dl class="fee-facts">[\s\S]*?<\/dl>/.exec(productOf(html, kind))?.[0] ?? "";
  // Each automation's page has the same six rows, in the same order.
  for (const { kind } of AUTOMATIONS) assert.deepEqual(rows(factsOf(kind)), SIX, kind);
  const facts = factsOf("automaxi");
  assert.equal(bps(AUTOMAXI_FEE_BPS), "1%");
  assert.match(facts, /<dd>1% of each claim<\/dd>/);
  assert.match(facts, /<dd[^>]*>1%, fixed in its code<\/dd>/);
  assert.ok(facts.includes(`/address/${AUTOMAXI_TREASURY}"`));
  // The page checks each automation's code hash, and shows only its address: the hash is no use to read.
  for (const { kind, codeHash, address } of AUTOMATIONS) {
    assert.ok(!html.includes(codeHash), `${kind}'s code hash is not on the page`);
    assert.ok(productOf(html, kind).includes(`/address/${address}"`), `${kind}'s page links its address`);
  }
  assert.equal(AUTOMAXI.address, getAddress(AUTOMAXI.address));
});

test("each automation's page has the same parts, in the same order, and lists every check that can fail", () => {
  const html = read("index.html");
  // Every check that can fail but the RPC's, which the page runs without naming.
  const failing: Record<string, string[]> = {
    "carbon-impact": ["code", "contracts", "token", "approvals", "upgrade", "logic"],
    automaxi: ["automaxi-code", "automaxi-contracts", "automaxi-approvals", "upgrade", "logic"],
  };
  for (const { kind } of AUTOMATIONS) {
    const page = productOf(html, kind);
    const sections = [...page.matchAll(/data-section="([^"]+)"/g)].map(([, section]) => section);
    assert.deepEqual(sections, PRODUCT_SECTIONS[kind], kind);
    const parts = [...page.matchAll(/<(h1|h2)[^>]*>([^<]+)</g)].map(([, , text]) => text!.trim());
    // Only the name and the Hydrex accounts are headings: the rest of the page is its key figures, and popups.
    assert.deepEqual(parts, [AUTOMATIONS.find((each) => each.kind === kind)!.name, "Your Hydrex accounts", "Can join"]);
    // Each popup opens from an info button, and holds a section or none: each section is in one.
    const pops = [...page.matchAll(/<div\s+class="pop[^"]*"\s+id="([^"]+)"\s+popover\b/g)].map(([, id]) => id!);
    for (const id of pops) assert.match(page, new RegExp(`popovertarget="${id}"\\s+aria-label=`), `${id} has a button`);
    const inPops = pops.flatMap((id) => {
      const pop = page.slice(page.indexOf(`id="${id}"`)).split(/<div\s+class="pop[\s"]/)[0]!;
      return [...pop.matchAll(/data-section="([^"]+)"/g)].map(([, section]) => section);
    });
    assert.deepEqual(inPops, PRODUCT_SECTIONS[kind], `${kind}'s sections are in its popups`);
    const checks = [...page.matchAll(/data-check="([^"]+)"/g)].map(([, check]) => check);
    assert.deepEqual([...checks].sort(), [...failing[kind]!].sort(), kind);
  }
  // About is its rows alone, with no popup, and the footer leads to it, without the version.
  const about = viewOf(html, 'data-view="about"');
  assert.doesNotMatch(about, /data-section=|popover/);
  assert.deepEqual(
    [...about.matchAll(/<dt>([^<]+)<\/dt>/g)].map(([, row]) => row),
    ["Official address", "Cookies stored", "Version"],
  );
  assert.equal(/<footer>([\s\S]*?)<\/footer>/.exec(html)?.[1]?.trim(), '<p><a href="#about">About</a></p>');
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

test("ids are unique, every address within the page is one of its routes, and each view has a title", () => {
  const html = read("index.html");
  const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map(([, id]) => id!);
  assert.deepEqual(ids, [...new Set(ids)]);
  for (const [, hash] of html.matchAll(/href="(#[^"]*)"/g)) {
    assert.ok(hash === "#" || parse(hash!).view !== "home", `${hash} is not a route`);
  }
  for (const view of html.match(/<[^>]+class="view[^"]*"[^>]*>/g) ?? []) assert.match(view, /data-title="[^"]+"/);
});

test("the page names no operator, links to no repository but Hydrex's, and shows no commit", () => {
  const html = read("index.html");
  const repositories = [...html.matchAll(/https:\/\/github\.com\/[^"\s<]+/g)].map(([url]) => url);
  assert.ok(repositories.length > 0);
  for (const url of repositories) assert.match(url, /^https:\/\/github\.com\/hydrexfi\//);
  assert.doesNotMatch(html, /ldeso|leo-klima|%COMMIT%/);
  assert.doesNotMatch(read("scripts/build.ts"), /COMMIT|rev-parse/);
  // AutoMaxi's source, where it is verified.
  const automaxi = productOf(html, "automaxi");
  assert.ok(automaxi.includes(`https://basescan.org/address/${AUTOMAXI.address}#code`));
  assert.ok(automaxi.includes(`https://repo.sourcify.dev/8453/${AUTOMAXI.address}`));
});

test("each swapper has its output and a checksummed address, and the swap's page links them all", async () => {
  const { SWAPPERS, EXCHANGES, AUTOMAXI_TREASURY } = await import("../src/config.ts");
  const tokens = (await import("../src/base-tokens.json", { with: { type: "json" } })).default;
  const html = read("index.html");
  const swap = viewOf(html, 'data-view="swap"');
  assert.deepEqual(
    SWAPPERS.map(({ output }) => output),
    ["usdc", "eurc", "weth", "cbbtc", "aero", "hydx"],
  );
  for (const { address, token, symbol } of SWAPPERS) {
    assert.equal(getAddress(address), address);
    assert.equal(getAddress(token), token);
    assert.ok(swap.includes(`/address/${address}#code`), `${symbol}'s swapper is linked to its verified source`);
    // Every output is on the page's list of tokens.
    assert.ok(
      tokens.some((listed) => listed.address === token && listed.symbol === symbol),
      symbol,
    );
  }
  assert.equal(EXCHANGES.length, 12);
  // The page lists only the swappers, each under its output's name.
  for (const { factory } of EXCHANGES) assert.equal(getAddress(factory), factory);
  const listed = [...swap.matchAll(/<dt>([^<]+)<\/dt>\s*<dd>([\s\S]*?)<\/dd>/g)].flatMap(([, name, value]) =>
    [...value!.matchAll(/\/address\/(0x[0-9a-fA-F]{40})[#"]/g)].map(([, address]) => `${name} ${address}`),
  );
  assert.deepEqual(
    listed,
    SWAPPERS.map(({ symbol, address }) => `${symbol} Swapper ${address}`),
  );
  // The page's list of tokens: checksummed, each once.
  for (const { address } of tokens) assert.equal(getAddress(address), address);
  assert.equal(new Set(tokens.map(({ address }) => address)).size, tokens.length);
  // Its sections, its costs, each as one row, and every check that can fail. Its fee is in its code: no row says who can
  // change it, or where it goes.
  const { SWAP_SECTIONS } = await import("../src/routes.ts");
  assert.deepEqual(
    [...swap.matchAll(/data-section="([^"]+)"/g)].map(([, section]) => section),
    SWAP_SECTIONS,
  );
  const facts = /<dl class="fee-facts">[\s\S]*?<\/dl>/.exec(swap)?.[0] ?? "";
  assert.deepEqual(
    [...facts.matchAll(/<dt>([^<]+)<\/dt>/g)].map(([, row]) => row),
    ["Swap fee", "Pool fees", "Price impact", "Gas"],
  );
  // What the slippage picked is, right after the costs, and what happens to a token that falls short of it.
  const slippage = /<h4 class="label">Slippage<\/h4>\s*<dl class="rows">[\s\S]*?<\/dl>/.exec(swap)?.[0] ?? "";
  assert.deepEqual(
    [...slippage.matchAll(/<dt>([^<]+)<\/dt>/g)].map(([, row]) => row),
    ["What it is", "When unmet"],
  );
  assert.match(slippage, /How much less than quoted you accept/);
  assert.match(slippage, /The input token stays in your wallet/);
  // The swap's own summary sets the slippage on the line of the least that may reach you.
  assert.match(swap, /<label\s*>At least, with\s*<select class="swap-margin">/);
  assert.ok(!swap.includes(AUTOMAXI_TREASURY) && !swap.includes("2-of-3"));
  // The swappers are immutable: the page checks only that its RPCs serve Base, and says nothing of it.
  assert.doesNotMatch(swap, /data-check=|>Checks<\/h4>|serves Base/);
});

test("the header holds the logo and the name, and a button to connect a wallet; the wallet's pages lead back to it", () => {
  const html = read("index.html");
  const header = /<header class="site">[\s\S]*?<\/header>/.exec(html)?.[0] ?? "";
  assert.match(header, /<a class="name" href="#"><img src="icon\.svg" alt="" [^>]*\/> metaDEX Café<\/a>/);
  assert.match(header, /<button type="button" class="connect">Connect a wallet<\/button>/);
  assert.match(header, /<a class="to-app button wallet-state" href="#app" hidden/);
  // Home and About are the page's own; the App is "Your Wallet", and every other view names the way back to it first.
  const trail = (view: string) => /<nav class="trail" aria-label="Breadcrumb">(.*?)<\/nav>/.exec(view)?.[1];
  for (const name of ["home", "about"]) assert.equal(trail(viewOf(html, `data-view="${name}"`)), undefined, name);
  assert.match(viewOf(html, 'data-view="app"'), /<h1 tabindex="-1">Your Wallet<\/h1>/);
  for (const name of ["hydrex", "swap"]) {
    assert.equal(trail(viewOf(html, `data-view="${name}"`)), '<a href="#app">Your Wallet</a>', name);
  }
  for (const view of [
    productOf(html, "carbon-impact"),
    productOf(html, "automaxi"),
    viewOf(html, 'data-view="position"'),
  ]) {
    assert.equal(trail(view), '<a href="#app">Your Wallet</a><a href="#hydrex">Hydrex</a>');
  }
  // Only the App and the header's popup hold the wallet buttons.
  assert.equal(html.match(/<div class="wallet-slot"><\/div>/g)?.length, 2);
  assert.ok(viewOf(html, 'data-view="app"').includes('<div class="wallet-slot"></div>'));
  assert.ok(header.includes('<div class="wallet-slot"></div>'));
});

test("on Hydrex's page, the automations come before the Hydrex accounts, whose groups are a level below", () => {
  const hydrex = viewOf(read("index.html"), 'data-view="hydrex"');
  const headings = [...hydrex.matchAll(/<(h[1-3])[^>]*>([\s\S]*?)<\/\1>/g)].map(
    ([, level, inner]) => `${level} ${inner!.replace(/<[^>]+>/g, "").trim()}`,
  );
  assert.deepEqual(headings, [
    "h1 Hydrex",
    "h2 Automations",
    "h3 Carbon Impact",
    "h3 AutoMaxi",
    "h3 Vote yourself",
    "h2 Your Hydrex accounts",
    "h3 Needs you",
    "h3 In Carbon Impact",
    "h3 In AutoMaxi",
    "h3 Other Hydrex accounts",
  ]);
});

test("AutoMaxi's page no longer says that owners can claim on Hydrex without its fee, but still does for leaving", () => {
  const joining = /data-section="joining"[\s\S]*?<\/dl>/.exec(productOf(read("index.html"), "automaxi"))?.[0] ?? "";
  assert.doesNotMatch(joining, /claim on Hydrex yourself/);
  assert.match(joining, /what\s+nobody\s+has\s+claimed\s+through\s+it\s+is\s+yours\s+to\s+claim\s+on\s+Hydrex/);
});
