import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { Page } from "playwright-core";
import { DOUBLE_ESPRESSO, MATCHA_LATTE, VOTING_ESCROW, WETH } from "../src/config.ts";
import {
  AVNT,
  ELSEWHERE,
  HOLDER,
  LEAVER,
  PAYEE,
  SELLER,
  ZORA,
  approveConduit,
  fund,
  open,
  settle,
  tabTo,
  useFork,
  view,
  violations,
} from "./harness.ts";

// A first run reads the fork's state from Base, slot by slot; later ones find it cached.
const LONG = { timeout: 1_500_000 };
const dialog = (page: Page) => page.getByRole("dialog");
const connect = (page: Page) => page.getByRole("banner").getByRole("button", { name: "Connect a wallet" }).click();
// Signs each transaction the review asks for, until it is done.
async function signAll(page: Page): Promise<void> {
  const done = dialog(page).getByRole("heading", { name: "Done" });
  const sign = dialog(page).getByRole("button", { name: /^(Sign|Propose)/ });
  while (!(await done.isVisible())) {
    if ((await sign.isVisible()) && (await sign.getAttribute("aria-disabled")) === "false") await sign.click();
    await page.waitForTimeout(500);
  }
}
const approved = async (id: bigint) => [
  await view(VOTING_ESCROW, "getLockDelegatee", [id]),
  await view(VOTING_ESCROW, "getClaimRedirectApproved", [id]),
];

describe("the page against a fork of Base", { timeout: 7_200_000 }, () => {
  useFork([ELSEWHERE, LEAVER, PAYEE, SELLER, HOLDER]);

  test("join two accounts from stopped automations, by keyboard alone, one transaction at a time", async () => {
    const { page, sent, errors } = await open({ owner: ELSEWHERE }, "#hydrex");
    await tabTo(page, page.getByRole("banner").getByRole("button", { name: "Connect a wallet" }));
    await page.keyboard.press("Enter");
    const group = page.getByRole("region", { name: /^In a stopped automation · 2/ });
    await group.waitFor(LONG);
    assert.equal(
      await page.getByRole("checkbox", { name: /#2439$/ }).isChecked(),
      true,
      "what needs you starts ticked",
    );
    await tabTo(page, group.getByRole("button", { name: "Join Matcha Latte" }));
    await page.keyboard.press("Enter");
    await dialog(page).getByRole("heading", { name: "Before you join" }).waitFor(LONG);
    await tabTo(page, dialog(page).getByRole("button", { name: "Continue" }));
    await page.keyboard.press("Enter");
    await dialog(page).getByRole("heading", { name: "Transactions" }).waitFor();
    for (const n of [1, 2]) {
      await tabTo(page, dialog(page).getByRole("button", { name: `Sign transaction ${n} of 2` }));
      await page.keyboard.press("Enter");
      await dialog(page)
        .getByText(n === 1 ? /Transaction 1 of 2 went through/ : "Done")
        .first()
        .waitFor(LONG);
    }
    await dialog(page)
      .getByText(/^Joined\. Votes from/)
      .waitFor();
    await page.keyboard.press("Escape");
    assert.equal(sent.length, 2);
    for (const id of [2435n, 2439n])
      assert.deepEqual(await approved(id), [MATCHA_LATTE.address.toLowerCase(), MATCHA_LATTE.address.toLowerCase()]);
    assert.deepEqual(errors, []);
  });

  test("leave Matcha Latte from an account's page", async () => {
    const { page, errors } = await open({ owner: LEAVER }, "#hydrex/53350");
    await connect(page);
    await page.getByRole("button", { name: "Leave", exact: true }).click(LONG);
    await dialog(page).getByRole("heading", { name: "Leave Matcha Latte" }).waitFor(LONG);
    await dialog(page).getByRole("button", { name: "Continue" }).click();
    await signAll(page);
    await dialog(page)
      .getByText(/^Left\./)
      .waitFor();
    assert.notEqual((await approved(53350n))[0], MATCHA_LATTE.address.toLowerCase());
    assert.deepEqual(errors, []);
  });

  test("an overdue payout in Double Espresso: Claim now claims it as it is", async () => {
    await approveConduit(PAYEE, DOUBLE_ESPRESSO.address, 82774n);
    await settle();
    const { page, errors } = await open({ owner: PAYEE }, "#hydrex/82774");
    await connect(page);
    await page.getByText("Payout overdue:").waitFor(LONG);
    await page.getByRole("button", { name: "Claim now" }).click();
    await dialog(page).getByRole("heading", { name: "What waits" }).waitFor(LONG);
    assert.equal(
      await dialog(page)
        .getByRole("radio", { name: /As they are/ })
        .isChecked(),
      true,
    );
    await dialog(page).getByRole("button", { name: "Continue" }).click();
    await signAll(page);
    await dialog(page).getByText("Receipt · Account #82774 · Double Espresso").waitFor();
    assert.deepEqual(errors, []);
  });

  test("swap three tokens into USDC in one prompt", async () => {
    await fund([WETH, ZORA, AVNT]);
    const { page, sent, errors } = await open({ owner: SELLER, batch: true }, "#swap");
    await connect(page);
    for (const symbol of ["WETH", "ZORA", "AVNT"])
      await page.getByRole("checkbox", { name: `Sell ${symbol}` }).waitFor(LONG);
    for (const box of await page.getByRole("checkbox", { name: /^Sell / }).all()) {
      const symbol = (await box.getAttribute("aria-label"))!.slice(5);
      if ((await box.isChecked()) !== ["WETH", "ZORA", "AVNT"].includes(symbol)) await box.click();
    }
    await page.getByText(/^Sell · 3 of/).waitFor();
    await page.getByRole("button", { name: "Review" }).click();
    await dialog(page).getByRole("heading", { name: "Quote" }).waitFor(LONG);
    await dialog(page).getByRole("button", { name: "Continue" }).click();
    await signAll(page);
    await dialog(page).getByText("Receipt · swap into USDC").waitFor();
    assert.ok(sent.length >= 2, "approvals and the swap, in one prompt");
    assert.deepEqual(errors, []);
  });

  test("every view, popup and review page passes axe's WCAG 2.2 AA rules, light and dark, desktop and phone", async () => {
    for (const [width, dark] of [
      [1440, false],
      [390, true],
    ] as const) {
      const { page } = await open({ owner: PAYEE }, "#app", { width, dark });
      await connect(page);
      await page.getByText(/^\d+ Hydrex accounts? ·|^\d+ Hydrex accounts?$/).waitFor(LONG);
      for (const route of [
        "#app",
        "#app/allows",
        "#hydrex",
        "#hydrex/matcha-latte",
        "#hydrex/matcha-latte/fees",
        "#hydrex/double-espresso",
        "#hydrex/82774",
        "#swap",
        "#swap/fees",
        "#about",
        "#",
      ]) {
        await page.evaluate((hash) => (location.hash = hash), route);
        await page.waitForTimeout(1_500);
        assert.deepEqual(await violations(page), [], `${route} at ${width}px${dark ? ", dark" : ""}`);
      }
      await page.evaluate(() => (location.hash = "#hydrex/double-espresso"));
      const can = page.getByRole("region", { name: /^Can join/ });
      if (await can.isVisible()) {
        const all = can.getByRole("checkbox", { name: "All" });
        if (await all.isVisible()) await all.check();
        await can.getByRole("button", { name: "Join Double Espresso" }).click();
        await dialog(page).getByRole("heading", { name: "Before you join" }).waitFor();
        assert.deepEqual(await violations(page), [], "the review");
        await page.keyboard.press("Escape");
      }
    }
  });
});
