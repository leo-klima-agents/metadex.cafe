import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { getAddress } from "viem";
import {
  ACCOUNT_NAMES,
  ALGEBRA_FACTORY,
  ANCHORS,
  APPROVAL_LOGIC,
  AUTOMATIONS,
  DOUBLE_ESPRESSO,
  DOUBLE_ESPRESSO_FEE_BPS,
  DOUBLE_ESPRESSO_FEE_RECIPIENT,
  MATCHA_LATTE,
  MATCHA_LATTE_OPERATOR,
  KVCM,
  MULTICALL3,
  PAIR_FACTORY,
  RPCS,
  VOTER,
  VOTING_ESCROW,
  VOTING_ESCROW_IMPLEMENTATION,
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

test("addresses are checksummed", () => {
  const contracts = [
    MULTICALL3,
    ...AUTOMATIONS.map(({ address }) => address),
    DOUBLE_ESPRESSO_FEE_RECIPIENT,
    MATCHA_LATTE_OPERATOR,
    KVCM,
    VOTING_ESCROW,
    VOTING_ESCROW_IMPLEMENTATION,
    APPROVAL_LOGIC,
    VOTER,
  ];
  const prices = [ALGEBRA_FACTORY, PAIR_FACTORY, ...ANCHORS.flatMap(({ address, feed }) => [address, feed.address])];
  const addresses = [...contracts, ACCOUNT_NAMES, ...prices, ...conduits.map(({ address }) => address)];
  for (const address of addresses) assert.equal(getAddress(address), address);
});

test("Matcha Latte is Hydrex's Carbon Impact automation, as its popup says, with each contract's name", () => {
  assert.equal(conduits.find(({ address }) => address === MATCHA_LATTE.address)?.name, "Carbon Impact");
  const html = read("index.html");
  assert.match(
    productOf(html, "matcha-latte"),
    /Matcha Latte is the "Carbon Impact" automation from Hydrex\.\s+Its smart contract is named\s+KlimaVeTokenConduit\./,
  );
  assert.match(
    productOf(html, "double-espresso"),
    /Double Espresso is an immutable automation with no owner\.\s+Its smart contract is named\s+ImmutableVeTokenConduit\./,
  );
  // In a review, beside its address, each goes by its smart contract's name.
  assert.deepEqual(
    AUTOMATIONS.map(({ contract }) => contract),
    ["KlimaVeTokenConduit", "ImmutableVeTokenConduit"],
  );
  assert.ok(html.includes(`<html lang="${LANG}">`), "the page and its numbers and dates use one language");
});

test("each automation has a kind, a name, its approvals and its costs, Double Espresso's as its code", () => {
  assert.deepEqual(
    AUTOMATIONS.map(({ kind, name, actions }) => [kind, name, actions]),
    [
      ["matcha-latte", "Matcha Latte", [3, 5]],
      ["double-espresso", "Double Espresso", [3, 5]],
    ],
  );
  const html = read("index.html");
  const rows = (part: string) => [...part.matchAll(/<dt>([^<]+)<\/dt>/g)].map(([, row]) => row);
  const factsOf = (kind: string) => /<dl class="fee-facts">[\s\S]*?<\/dl>/.exec(productOf(html, kind))?.[0] ?? "";
  // Each one's costs: what it takes of the rewards.
  assert.deepEqual(rows(factsOf("matcha-latte")), ["Retirements", "Payout fee", "Swap costs"]);
  assert.deepEqual(rows(factsOf("double-espresso")), ["Claim fee"]);
  assert.equal(bps(DOUBLE_ESPRESSO_FEE_BPS), "1%");
  assert.match(factsOf("double-espresso"), /<dd>1%<\/dd>/);
  // Who can change it: Hydrex and the operator Matcha Latte; nobody Double Espresso, whose votes are anyone's.
  const controlOf = (kind: string) =>
    /<div data-section="control">[\s\S]*?<\/dl>/.exec(productOf(html, kind))?.[0] ?? "";
  assert.deepEqual(rows(controlOf("matcha-latte")), ["Hydrex admin", "Operator"]);
  assert.deepEqual(rows(controlOf("double-espresso")), ["Immutable", "Permissionless"]);
  assert.match(controlOf("double-espresso"), /It cannot be changed or upgraded/);
  // Then its contract and where its fee goes.
  const contractsOf = (kind: string) =>
    /<div data-section="check">[\s\S]*?<\/dl>/.exec(productOf(html, kind))?.[0] ?? "";
  assert.deepEqual(rows(contractsOf("matcha-latte")), ["Matcha Latte", "Fee recipient", "Operator"]);
  assert.deepEqual(rows(contractsOf("double-espresso")), ["Double Espresso", "Fee recipient"]);
  assert.ok(contractsOf("matcha-latte").includes(`/address/${MATCHA_LATTE_OPERATOR}"`));
  assert.ok(contractsOf("double-espresso").includes(`/address/${DOUBLE_ESPRESSO_FEE_RECIPIENT}"`));
  // Each automation's address leads to its code, verified on Basescan.
  for (const { kind, address } of AUTOMATIONS) {
    assert.ok(productOf(html, kind).includes(`/address/${address}#code"`), `${kind}'s page links its code`);
  }
  assert.equal(DOUBLE_ESPRESSO.address, getAddress(DOUBLE_ESPRESSO.address));
});

test("each automation's page has the same parts, in the same order, and Hydrex's names each check that can fail", () => {
  const html = read("index.html");
  // Every check that can fail: Hydrex's page says why joining is off, and an automation's page only that it is.
  const hydrex = viewOf(html, 'data-view="hydrex"');
  assert.deepEqual(
    [...hydrex.matchAll(/data-check="([^"]+)"/g)].map(([, check]) => check),
    ["chain", "upgrade", "logic", "approvals", "double-espresso-approvals"],
  );
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
    assert.doesNotMatch(page, /data-check=/, kind);
    assert.match(page, /is off\.\s*<a href="#hydrex">Why<\/a>/, `${kind}'s page leads to why`);
  }
  // About is its rows alone, with no popup, and the footer leads to it, without the version, beside the currency picked
  // for the visit.
  const about = viewOf(html, 'data-view="about"');
  assert.doesNotMatch(about, /data-section=|popover/);
  assert.deepEqual(
    [...about.matchAll(/<dt>([^<]+)<\/dt>/g)].map(([, row]) => row),
    ["Official address", "ENS address", "Cookies stored", "Version"],
  );
  const footer = /<footer>([\s\S]*?)<\/footer>/.exec(html)?.[1] ?? "";
  assert.match(footer, /<a href="#about">About<\/a>/);
  assert.doesNotMatch(footer, /version/i);
  assert.deepEqual(
    [...footer.matchAll(/<option value="([^"]+)"/g)].map(([, value]) => value),
    ["USD", "EUR", "GBP", "CHF", "AUD", "CAD"],
  );
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

test("the page names nobody who runs it, links to no repository but Hydrex's, and shows no commit", () => {
  const html = read("index.html");
  const repositories = [...html.matchAll(/https:\/\/github\.com\/[^"\s<]+/g)].map(([url]) => url);
  for (const url of repositories) assert.match(url, /^https:\/\/github\.com\/hydrexfi\//);
  assert.doesNotMatch(html, /ldeso|leo-klima|%COMMIT%/);
  assert.doesNotMatch(read("scripts/build.ts"), /COMMIT|rev-parse/);
  // Double Espresso's source, where it is verified.
  const doubleEspresso = productOf(html, "double-espresso");
  assert.ok(doubleEspresso.includes(`https://basescan.org/address/${DOUBLE_ESPRESSO.address}#code`));
});

test("each swapper has its output and a checksummed address, and the swap's page links them all", async () => {
  const { SWAPPERS, EXCHANGES, DOUBLE_ESPRESSO_FEE_RECIPIENT } = await import("../src/config.ts");
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
    SWAPPERS.map(({ symbol, address }) => `Swap ${symbol} ${address}`),
  );
  // The page's list of tokens: checksummed, each once.
  for (const { address } of tokens) assert.equal(getAddress(address), address);
  assert.equal(new Set(tokens.map(({ address }) => address)).size, tokens.length);
  // Its sections, its costs, each as one row, and every check that can fail. Its fee is in its code: no row says who
  // can change it, or where it goes.
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
  assert.match(slippage, /The token isn't swapped/);
  // The swap's own summary sets the slippage on the line of the least that may reach you.
  assert.match(swap, /<label\s*>Minimum at\s*<select class="swap-margin">/);
  assert.ok(!swap.includes(DOUBLE_ESPRESSO_FEE_RECIPIENT) && !swap.includes("2-of-3"));
  // The swappers are immutable: the page checks only that its RPCs serve Base, and says nothing of it.
  assert.doesNotMatch(swap, /data-check=|>Checks<\/h4>|serves Base/);
});

test("the header holds the logo and the name, and a button to connect a wallet; the pages below the App lead back one level", () => {
  const html = read("index.html");
  const header = /<header class="site">[\s\S]*?<\/header>/.exec(html)?.[0] ?? "";
  assert.match(header, /<a class="name" href="#"><img src="icon\.svg" alt="" [^>]*\/> metaDEX Café<\/a>/);
  assert.match(header, /<button type="button" class="connect">Connect a wallet<\/button>/);
  // The wallet's chip is outlined, so that it does not read as the page's main action.
  assert.match(header, /<a class="to-app button secondary wallet-state" href="#app" hidden/);
  // Home and About are the page's own; the App is "Your wallet". Hydrex and the swap lead back to it, with or without a
  // wallet, and the pages within Hydrex lead back to Hydrex.
  const trail = (view: string) => /<nav class="trail[^"]*" aria-label="Back"[^>]*>(.*?)<\/nav>/.exec(view)?.[1];
  for (const name of ["home", "about"]) assert.equal(trail(viewOf(html, `data-view="${name}"`)), undefined, name);
  assert.match(viewOf(html, 'data-view="app"'), /<h1 tabindex="-1">Your wallet<\/h1>/);
  for (const name of ["hydrex", "swap"]) {
    const view = viewOf(html, `data-view="${name}"`);
    assert.equal(trail(view), '<a href="#app">Your wallet</a>', name);
    assert.match(view, /<nav class="trail" aria-label="Back">/, `${name}'s way back always shows`);
  }
  for (const view of [
    productOf(html, "matcha-latte"),
    productOf(html, "double-espresso"),
    viewOf(html, 'data-view="position"'),
  ]) {
    assert.equal(trail(view), '<a href="#hydrex">Hydrex</a>');
  }
  // The header's popup holds the wallet buttons, as do the App, under its products, the lists of what a wallet holds
  // (its Hydrex accounts, and the tokens to sell) and each automation's page, where its accounts would be.
  assert.equal(html.match(/<div class="wallet-slot"><\/div>/g)?.length, 6);
  const app = viewOf(html, 'data-view="app"');
  assert.ok(app.indexOf('<div class="wallet-slot"></div>') > app.indexOf('id="products"'));
  assert.ok(header.includes('<div class="wallet-slot"></div>'));
  assert.match(viewOf(html, 'data-view="hydrex"'), /id="yours-title"[\s\S]*?<div class="wallet-slot"><\/div>/);
  assert.match(viewOf(html, 'data-view="swap"'), /id="swap-tokens-title"[\s\S]*?<div class="wallet-slot"><\/div>/);
  for (const kind of ["matcha-latte", "double-espresso"])
    assert.match(productOf(html, kind), /<div class="wallet-slot"><\/div>/);
  assert.ok(!html.includes("No wallet connected."));
});

test("on Hydrex's page, the automations, then voting yourself apart, come before the Hydrex accounts, whose groups are a level below", () => {
  const hydrex = viewOf(read("index.html"), 'data-view="hydrex"');
  const headings = [...hydrex.matchAll(/<(h[1-3])[^>]*>([\s\S]*?)<\/\1>/g)].map(
    ([, level, inner]) => `${level} ${inner!.replace(/<[^>]+>/g, "").trim()}`,
  );
  assert.deepEqual(headings, [
    "h1 Hydrex",
    "h2 Automations",
    "h3 Matcha Latte",
    "h3 Double Espresso",
    "h2 Vote yourself",
    "h2 Your Hydrex accounts",
    "h3 Didn't vote last epoch",
    "h3 In a stopped automation",
    "h3 Partly in an automation",
    "h3 In Matcha Latte",
    "h3 In Double Espresso",
    "h3 Other Hydrex accounts",
  ]);
});

test("each automation's page says what it does, and that the account stays in the wallet, before its figures", () => {
  const html = read("index.html");
  for (const { kind } of AUTOMATIONS) {
    const page = productOf(html, kind);
    const [lead, custody, figures] = ['class="lead"', 'class="custody small"', 'class="facts tiles"'].map((part) =>
      page.indexOf(part),
    ) as [number, number, number];
    assert.ok(lead > 0 && lead < custody && custody < figures, kind);
    assert.match(page.slice(custody, figures), /Your Hydrex account stays in your wallet/);
  }
  // Hydrex's word, not the market's.
  assert.doesNotMatch(html, /\bbribes?\b/i);
});
