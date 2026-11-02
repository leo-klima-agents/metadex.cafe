import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { toFunctionSelector } from "viem";
import { VOTER } from "../src/config.ts";
import { short } from "../src/format.ts";
import * as h from "./harness.ts";
import {
  BLOCK,
  ELSEWHERE,
  FLIP,
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
  h.fork(BLOCK, [MEMBER, NEWCOMER, ELSEWHERE, LEAVER, ENDED], h.deployDoubleEspresso);

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
    await page.getByRole("contentinfo").getByRole("link", { name: "About" }).click();
    await heading(page, "About").waitFor();
    assert.equal(await page.title(), "About · metaDEX Café");
    const footer = (await page.getByRole("contentinfo").boundingBox())!;
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
    const chip = page.getByRole("banner").getByRole("link", { name: `Your wallet, connected as ${short(NEWCOMER)}` });
    assert.equal(await chip.getAttribute("aria-current"), "page");
    const hydrexFirst = await open({ owner: NEWCOMER }, { url: `${SITE}/#hydrex` });
    await connectButton(hydrexFirst.page).click();
    await hydrexFirst.page.getByRole("banner").getByText(short(NEWCOMER)).waitFor();
    assert.equal(new URL(hydrexFirst.page.url()).hash, "#hydrex");
    await hydrexFirst.page.evaluate(() =>
      (window as unknown as { testWalletEmit: (e: string, v: unknown) => void }).testWalletEmit("accountsChanged", []),
    );
    await connectButton(hydrexFirst.page).waitFor();
    const none = await open(false);
    await connectButton(none.page).click();
    await none.page
      .getByRole("dialog", { name: "Connect a wallet" })
      .getByRole("button", { name: "Browser wallet" })
      .click();
    await none.page.getByRole("link", { name: "MetaMask" }).waitFor();
    for (const each of [violations, hydrexFirst.violations, none.violations]) assert.deepEqual(each, []);
  });

  test("what votes earned last epoch: on the menu, for each account, and when all of Hydrex cannot be read", async () => {
    // Refuse the reads of all of Hydrex, which its average needs; the rest of the page must still show.
    const everyPool = toFunctionSelector("function totalWeightAt(uint256)").slice(2);
    const { page, violations } = await h.connected(
      { owner: MEMBER },
      { width: 390, height: 844, refuse: (body) => body.includes(everyPool) },
    );
    await h
      .row(page, 9540)
      .getByText(/≈\s\$6\.1\d last epoch/)
      .waitFor();
    const menu = view(page, "hydrex").locator('[data-kind="matcha-latte"]');
    await menu.getByText(/^≈\s\$\d+\.\d\d \/ 1k votes$/).waitFor();
    await menu.getByText("Yours: 1 Hydrex account").waitFor();
    await h.text(view(page, "hydrex"), "average").getByText("Not read", { exact: true }).waitFor();
    assert.equal(await h.text(menu, "versus").isVisible(), false, "nothing to compare with");
    await page.getByText("Some figures could not be read.").waitFor();
    await h.shoot(page, "member-390");
    await page.goto(`${SITE}/#hydrex/matcha-latte/record`);
    const popup = page.getByRole("dialog", { name: "Performance" });
    await popup.getByText("897k").waitFor();
    await popup.getByText("27 pools").waitFor();
    await popup.getByText("All of Hydrex could not be read.").waitFor();
    await popup.getByRole("row").filter({ hasText: "AVNT / USDC" }).waitFor();
    await h.shoot(page, "record-390");
    assert.deepEqual(violations, []);
  });

  test("if the Voter cannot be read, the accounts still show, and nothing stays loading", async () => {
    await h.anvil.setCode({ address: VOTER, bytecode: "0x" });
    const { page } = await h.connected({ owner: ELSEWHERE });
    await h.row(page, 2439).getByText("In USDC", { exact: true }).waitFor();
    const hydrex = view(page, "hydrex");
    await hydrex.locator('[data-kind="matcha-latte"]').getByText("Not read yet").waitFor();
    await h.text(hydrex, "average").getByText("Not read", { exact: true }).waitFor();
    await page.getByText("Some figures could not be read.").waitFor();
    assert.equal(await hydrex.locator("[data-loading]:visible").count(), 0);
    await page.goto(`${SITE}/#hydrex/double-espresso/record`);
    await page.getByRole("dialog", { name: "Performance" }).getByText("Last epoch could not be read.").waitFor();
    assert.equal(await view(page, "product").locator("[data-loading]:visible").count(), 0);
  });

  test("a redraw leaves focus where it was", async () => {
    const { page, violations } = await h.connected({ owner: ELSEWHERE }, { url: `${SITE}/#app` });
    const change = view(page, "app")
      .locator("[data-list=need] > li")
      .filter({ hasText: /stopped automations?/ })
      .getByRole("link", { name: "Change" });
    await change.focus();
    const focused = (await change.elementHandle())!;
    await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
    await page.evaluate(() => new Promise(requestAnimationFrame));
    assert.equal(await focused.evaluate((el) => el === document.activeElement), true);
    assert.deepEqual(violations, []);
  });

  test("in a new epoch, the page moves on by itself", async () => {
    await h.approveConduit(NEWCOMER, h.CONDUIT, 141n);
    const { page } = await h.connected({ owner: NEWCOMER }, { flowing: true });
    await h.row(page, 141).getByText("Joining Matcha Latte:").waitFor();
    await page.getByText(/moves the votes from Thu,? 22 Oct/).waitFor();
    await Promise.allSettled(h.forwarding);
    await h.anvil.setNextBlockTimestamp({ timestamp: BigInt(FLIP + 60) });
    await h.anvil.mine({ blocks: 1 });
    await page.clock.setSystemTime((FLIP + 60) * 1000);
    await page.clock.runFor(30_000);
    await page.getByText(/moves the votes from Thu,? 29 Oct/).waitFor();
    await h.group(page, "in:matcha-latte").getByRole("link", { name: "Hydrex account #141" }).waitFor();
    await h.row(page, 141).getByText("Joining Matcha Latte:").waitFor({ state: "hidden" });
    // Last epoch's payouts are final only once someone calls Hydrex's minter; the page then reads them.
    await h.row(page, 141).getByRole("link", { name: "Hydrex account #141" }).click();
    const standing = view(page, "account").locator("[data-list=standing] > article");
    await standing.getByText("Not final yet").waitFor();
    await h.moveOn();
    await page.clock.runFor(5 * 60_000);
    await standing.getByText(/^(Paid up to|Not paid yet|Nothing to pay)/).waitFor();
  });
});
