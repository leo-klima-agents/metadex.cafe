import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { DOUBLE_ESPRESSO } from "../src/config.ts";
import { short } from "../src/format.ts";
import * as h from "./harness.ts";
import { MEMBER, PAID_TX, PAYEE, SITE, STRANGER, UNPAID, connected, heading, open, row, view } from "./harness.ts";

const standing = (page: h.Opened["page"]) => view(page, "account").locator("[data-list=standing] > article");

describe("payouts against a fork of Base before Denim, with a payout late", { timeout: 1_800_000 }, () => {
  h.fork(UNPAID, [MEMBER, PAYEE]);

  test("an account paid late: the App marks it, and its page shows its standing and its last receipt", async () => {
    const { page, violations } = await connected({ owner: PAYEE }, { width: 390, height: 844, dark: true });
    await row(page, 82774).getByText("Payout late").waitFor();
    await row(page, 82774).getByRole("link", { name: "Hydrex account #82774" }).click();
    await heading(page, "Hydrex account #82774").waitFor();
    const article = standing(page);
    await article.getByText(/^Late · paid up to Thu,? 17 Sept?, 00:00 UTC$/).waitFor();
    await article.getByText(/^(At least )?\$\d[\d,.]* in \d+ tokens waiting$/).waitFor();
    const bill = article.locator("article.Slip");
    await bill.getByText("Receipt · Account #82774 · Matcha Latte").waitFor();
    const text = await bill.innerText();
    for (const shown of [
      "8.56 USDC and 89.04 HYDX",
      "1,053.92 kVCM",
      "−326.80 kVCM",
      "65.26 t of carbon credits",
      "727.11 kVCM",
      "31.01%",
      "Paid to you",
    ])
      assert.ok(text.toLowerCase().includes(shown.toLowerCase()), `${shown} in ${text}`);
    assert.match(text, /Thu,? 10 Sept? to Thu,? 17 Sept?/);
    assert.match(text, /Wed,? 23 Sept?,? 17:44 UTC/);
    assert.equal(
      await bill.getByRole("link", { name: "Transaction" }).getAttribute("href"),
      `https://basescan.org/tx/${PAID_TX}`,
    );
    await bill.getByText(/^\$\d/).first().waitFor();
    await h.shoot(page, "receipt-390-dark");
    const other = await open(false, { url: `${SITE}/#hydrex/9540` });
    await standing(other.page)
      .getByText(/^Late · paid up to Thu,? 27 Aug/)
      .waitFor();
    await view(other.page, "account").getByText(short(MEMBER)).waitFor();
    await other.page.goto(`${SITE}/#hydrex/14485`);
    await view(other.page, "account")
      .getByText(/Not voted since/)
      .waitFor();
    assert.equal(await view(other.page, "account").getByRole("heading", { name: "Last payout" }).isVisible(), false);
    assert.deepEqual([...violations, ...other.violations], []);
  });

  test("Double Espresso's receipts: anyone's claims, a stranger's dust, and where the page stops reading", async () => {
    const rewards = await h.doubleEspressoReceipts();
    const { page, violations } = await open(
      { owner: PAYEE },
      { width: 390, height: 844, url: `${SITE}/#hydrex/82774` },
    );
    await view(page, "account")
      .getByText(/Joining Double Espresso:/)
      .waitFor();
    const bill = standing(page).locator("article.Slip");
    await bill.getByText("Receipt · Account #82774 · Double Espresso").waitFor();
    const lines = await bill.locator("[data-list=claim] [data-text=words]").allTextContents();
    assert.deepEqual(
      lines.map((line) => line.replace(/^.* · /, "")),
      ["sent by 0x0000…dEaD", "sent by 0x0000…1234"],
    );
    assert.match(await bill.innerText(), /Fee 1%/i);
    // Claims of dust in many blocks: the page reads only ten of those blocks and says it stopped.
    for (const reward of rewards.filter(({ token }) => token.symbol !== "USDC").slice(0, 10))
      await h.mined(STRANGER, DOUBLE_ESPRESSO.address, h.claimOne(82774n, reward));
    await h.settle();
    const again = await open({ owner: PAYEE }, { width: 390, height: 844, url: `${SITE}/#hydrex/82774` });
    await standing(again.page).getByText("Last 10 blocks only").waitFor();
    assert.equal(await standing(again.page).locator("[data-list=claim] > li").count(), 10);
    assert.deepEqual([...violations, ...again.violations], []);
  });
});
