import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { DOUBLE_ESPRESSO } from "../src/config.ts";
import { short } from "../src/format.ts";
import * as h from "./harness.ts";
import { BLOCK, LATE, MEMBER, SITE, STRANGER, connected, heading, open, row, view } from "./harness.ts";

// #26432's last payout as of `BLOCK`: sent on Thu 11 June, paying up to Thu 11 June.
const PAID_TX = "0x8a833ea75c2293d09be8ea474c1ef2e1b16535da0b825ed3e9fbe1e7dcdef9c6";
// Lower case, with every kind of space as a plain one: the page keeps some figures together with non-breaking spaces.
const flat = (text: string) => text.toLowerCase().replace(/\s/g, " ");
const standing = (page: h.Opened["page"]) => view(page, "account").locator("[data-list=standing] > article");

describe("payouts against a fork of Base, with payouts late", { timeout: 1_800_000 }, () => {
  h.fork(BLOCK, [MEMBER, LATE]);

  test("an account paid late: the App marks it, and its page shows its standing and its last receipt", async () => {
    const { page, violations } = await connected({ owner: LATE }, { width: 390, height: 844, dark: true });
    await row(page, 26432).getByText("Payout late").waitFor();
    await row(page, 26432).getByRole("link", { name: "Hydrex Main Protocol Account #26432" }).click();
    await heading(page, "Hydrex Main Protocol Account #26432").waitFor();
    const article = standing(page);
    await article.getByText(/^Late · paid up to Thu,? 11 June?, 00:00 UTC$/).waitFor();
    await article.getByText(/^(At least )?\$\d[\d,.]* in \d+ tokens waiting$/).waitFor();
    const bill = article.locator("article.Slip");
    await bill.getByText("Receipt · Account #26432 · Matcha Latte").waitFor();
    const text = await bill.innerText();
    for (const shown of [
      "0.04 WETH, < 0.01 cbBTC and 33.02 USDC",
      "3,163.46 kVCM",
      "−579.49 kVCM",
      "192.66 t of carbon credits",
      "2,583.97 kVCM and 54.13 AZUSD",
      "18.32%",
      "Paid to you",
    ])
      assert.ok(flat(text).includes(flat(shown)), `${shown} in ${text}`);
    assert.match(text, /Thu,? 4 June? to Thu,? 11 June?/);
    assert.match(text, /Thu,? 11 June?,? 14:28 UTC/);
    assert.equal(
      await bill.getByRole("link", { name: "Transaction" }).getAttribute("href"),
      `https://basescan.org/tx/${PAID_TX}`,
    );
    await bill.getByText(/^\$\d/).first().waitFor();
    await h.shoot(page, "receipt-390-dark");
    const other = await open(false, { url: `${SITE}/#hydrex/14247` });
    await standing(other.page)
      .getByText(/^Late · paid up to Thu,? 27 Aug/)
      .waitFor();
    await view(other.page, "account").getByText(short(LATE)).waitFor();
    await other.page.goto(`${SITE}/#hydrex/14485`);
    await view(other.page, "account")
      .getByText(/Not voted since/)
      .waitFor();
    assert.equal(await view(other.page, "account").getByRole("heading", { name: "Last payout" }).isVisible(), false);
    assert.deepEqual([...violations, ...other.violations], []);
  });

  test("Double Espresso's receipts: anyone's claims, a stranger's dust, and where the page stops reading", async () => {
    const rewards = await h.doubleEspressoReceipts();
    const { page, violations } = await open({ owner: LATE }, { width: 390, height: 844, url: `${SITE}/#hydrex/26432` });
    await view(page, "account")
      .getByText(/Joining Double Espresso:/)
      .waitFor();
    const bill = standing(page).locator("article.Slip");
    await bill.getByText("Receipt · Account #26432 · Double Espresso").waitFor();
    const lines = await bill.locator("[data-list=claim] [data-text=words]").allTextContents();
    assert.deepEqual(
      lines.map((line) => line.replace(/^.* · /, "")),
      ["sent by 0x0000…dEaD", "sent by 0x0000…1234"],
    );
    assert.match(await bill.innerText(), /Fee 1%/i);
    // Claim dust in many blocks: the page reads only ten of those blocks and says that it stopped.
    for (const reward of rewards.filter(({ token }) => token.symbol !== "USDC").slice(0, 10))
      await h.mined(STRANGER, DOUBLE_ESPRESSO.address, h.claimOne(26432n, reward));
    await h.settle();
    const again = await open({ owner: LATE }, { width: 390, height: 844, url: `${SITE}/#hydrex/26432` });
    await standing(again.page).getByText("Last 10 blocks only").waitFor();
    assert.equal(await standing(again.page).locator("[data-list=claim] > li").count(), 10);
    assert.deepEqual([...violations, ...again.violations], []);
  });
});
