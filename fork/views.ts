import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { short } from "../src/format.ts";
import * as h from "./harness.ts";
import {
  BLOCK,
  ELSEWHERE,
  ENDED,
  LEAVER,
  MEMBER,
  NEWCOMER,
  SITE,
  connectButton,
  heading,
  open,
  view,
} from "./harness.ts";

describe("the page's views against a fork of Base", { timeout: 1_800_000 }, () => {
  before(async () => {
    await h.start(BLOCK, [MEMBER, NEWCOMER, ELSEWHERE, LEAVER, ENDED]);
    await h.deployDoubleEspresso();
  });
  after(h.stop);

  test("Home, the App, Back and Forward, About, an unknown address; and the page without its script", async () => {
    const { page, asked, violations } = await open({ owner: NEWCOMER }, { width: 390, height: 844 });
    await heading(page, "Vote, claim and swap on Base").waitFor();
    assert.equal(await page.title(), "metaDEX Café");
    assert.equal(await page.evaluate(() => document.documentElement.scrollHeight), 844, "Home fits one screen");
    await h.shoot(page, "home");
    await page.getByRole("link", { name: "Open app" }).click();
    await heading(page, "Your wallet").waitFor();
    assert.equal(await page.title(), "Your wallet · metaDEX Café");
    assert.equal(await page.evaluate(() => document.activeElement?.textContent), "Your wallet");
    assert.deepEqual(await view(page, "app").getByRole("heading", { level: 2 }).allInnerTexts(), [
      "Swap",
      "Hydrex",
      "Aero",
    ]);
    await page.goBack();
    await heading(page, "Vote, claim and swap on Base").waitFor();
    await page.goForward();
    await heading(page, "Your wallet").waitFor();
    await page.locator("footer").getByRole("link", { name: "About" }).click();
    await heading(page, "About").waitFor();
    assert.equal(await page.title(), "About · metaDEX Café");
    const footer = (await page.locator("footer").boundingBox())!;
    assert.equal(Math.round(footer.y + footer.height), 844, "the footer is at the foot of the screen");
    for (const unknown of ["#about/check", "#how-it-works", "#%E0%A4"]) {
      await page.goto(`${SITE}/${unknown}`);
      await heading(page, "Vote, claim and swap on Base").waitFor();
    }
    assert.deepEqual(asked, [], "the page asks a wallet nothing until it is picked");
    assert.deepEqual(violations, []);
    const bare = await open(false, { url: `${SITE}/#app`, script: false });
    await heading(bare.page, "Vote, claim and swap on Base").waitFor();
    assert.match(await bare.page.locator("noscript").innerHTML(), /This page needs JavaScript\./);
  });

  test("a wallet connected on Home or About leads to the App; one that locks is let go", async () => {
    const { page, violations } = await open({ owner: NEWCOMER });
    await connectButton(page).click();
    await heading(page, "Your wallet").waitFor();
    assert.equal(new URL(page.url()).hash, "#app");
    const chip = page.locator("header").getByRole("link", { name: `Your wallet, connected as ${short(NEWCOMER)}` });
    assert.equal(await chip.getAttribute("aria-current"), "page");
    const hydrexFirst = await open({ owner: NEWCOMER }, { url: `${SITE}/#hydrex` });
    await connectButton(hydrexFirst.page).click();
    await hydrexFirst.page.locator("header").getByText(short(NEWCOMER)).waitFor();
    assert.equal(new URL(hydrexFirst.page.url()).hash, "#hydrex");
    await hydrexFirst.page.evaluate(() =>
      (window as unknown as { testWalletEmit: (e: string, v: unknown) => void }).testWalletEmit("accountsChanged", []),
    );
    await connectButton(hydrexFirst.page).waitFor();
    // Without a wallet in the browser, the picker offers wallet apps.
    const none = await open(false);
    await connectButton(none.page).click();
    await none.page
      .getByRole("dialog", { name: "Connect a wallet" })
      .getByRole("button", { name: "Browser wallet" })
      .click();
    await none.page.getByRole("link", { name: "MetaMask" }).waitFor();
    for (const each of [violations, hydrexFirst.violations, none.violations]) assert.deepEqual(each, []);
  });
});
