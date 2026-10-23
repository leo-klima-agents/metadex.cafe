import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { type Page } from "playwright-core";
import { encodeFunctionData } from "viem";
import { AUTOMAXI, SWAPPERS, WETH } from "../src/config.ts";
import {
  AVNT,
  HOLDER,
  PAYEE,
  RECENT,
  SELLER,
  SITE,
  STRANGER,
  ZORA,
  approveConduit,
  app,
  balanceOf,
  claimOpens,
  confirm,
  confirmEach,
  connected,
  fund,
  hooks,
  mined,
  readOn,
  review,
  settle,
  shoot,
  start,
  stop,
  swapView,
  tokenAbi,
  warmPayouts,
} from "./harness.ts";

const INTO_USDC = SWAPPERS[0]!;

// Waits until every token has its route, then ticks only those given. A token the page learns from last epoch's
// rewards, such as AVNT, joins the list once those are read: each one asked for is waited for.
async function tickOnly(page: Page, symbols: string[]): Promise<void> {
  const swap = swapView(page);
  try {
    for (const symbol of symbols)
      await swap.getByRole("checkbox", { name: `Sell ${symbol}` }).waitFor({ timeout: 120_000 });
    await swap.locator(".swap-status").waitFor({ state: "hidden", timeout: 120_000 });
  } catch (error) {
    throw new Error(`The swap's page shows: ${await swap.locator(".swap-tokens").innerText()}`, { cause: error });
  }
  for (const box of await swap.locator(".swap-rows .pick").all()) {
    const symbol = ((await box.getAttribute("aria-label")) ?? "").replace(/^Sell /, "");
    if ((await box.isChecked()) !== symbols.includes(symbol)) await box.click();
  }
}

describe("the swap and the claim against a fork after the swappers' deployment", { timeout: 2_400_000 }, () => {
  before(() => start(RECENT, [HOLDER, PAYEE, SELLER]));
  after(stop);
  hooks();

  test("swap three tokens into USDC in one prompt; one is skipped, and its approval is reset", async () => {
    await fund([WETH, ZORA, AVNT]);
    const { page, sent, violations } = await connected({ owner: SELLER, batch: true }, { url: `${SITE}/#swap` });
    const swap = swapView(page);
    await swap.getByRole("heading", { name: "Swap tokens", level: 1 }).waitFor();
    assert.equal(
      await swap.getByRole("radio", { name: "USDC" }).isChecked(),
      true,
      "USDC unless the address names another",
    );
    await tickOnly(page, ["WETH", "ZORA", "AVNT"]);
    // What they fetch, line by line: the quote, less the 1%, is what reaches you; the slippage picked sets the least
    // that may; and gas is paid apart, in ETH.
    const summary = swap.locator(".breakdown");
    await summary
      .locator(".swap-paid")
      .getByText(/^≈ [\d,.]+ USDC$/)
      .waitFor();
    const labels = await summary.locator("dt").allInnerTexts();
    assert.deepEqual(
      [labels[0], labels[1], labels[2], labels[4]],
      ["Quote", "Fee 1%", "Reaches you", "Gas, paid in ETH"],
    );
    assert.match(labels[3]!, /^At least, with/);
    assert.equal(await summary.getByRole("combobox", { name: /At least, with/ }).inputValue(), "50");
    assert.match(await summary.locator(".swap-quoted").innerText(), /^≈ [\d,.]+ USDC$/);
    assert.match(await summary.locator(".swap-fee").innerText(), /^− [\d,.]+ USDC$/);
    assert.match(await summary.locator(".swap-least").innerText(), /^[\d,.]+ USDC$/);
    await summary
      .locator(".swap-gas")
      .getByText(/^(≈|<)\s\$/)
      .waitFor();
    assert.match(await swap.locator(".swap-ticked").innerText(), /^· 3 of \d+$/);
    await shoot(page, "swap-390-light");
    await swap.getByRole("button", { name: "Review" }).click();
    await review(page).getByRole("heading", { name: "What you swap" }).waitFor({ timeout: 300_000 });
    assert.equal(await review(page).locator(".swap-simulated").isVisible(), false, "run through Base");
    // A bill: each token with its route by tokens and pools, no addresses, under the gas; then the least, which the
    // slippage set.
    const bill = review(page).locator(".pages .receipt");
    assert.equal(await bill.locator(".receipt-name").innerText(), "metaDEX Café");
    assert.equal(await bill.locator(".label code").innerText(), "USDC");
    assert.equal(await review(page).locator(".step-count code").innerText(), "USDC");
    assert.match(await bill.locator(".receipt-day").innerText(), /^Gas (≈|<)\s\$[\d.]+, paid in ETH$/);
    assert.equal(await bill.locator(".swap-lines li").count(), 3);
    for (const route of await bill.locator(".line-route").allInnerTexts()) {
      assert.match(route, /^(→ \S+ via [^→]+?)( → \S+ via [^→]+?)*$/, route);
      assert.doesNotMatch(route, /0x|tick spacing/, route);
    }
    assert.equal(await bill.locator(".swap-slippage").innerText(), "Your slippage: 0.5%");
    await review(page).getByRole("button", { name: "Continue" }).click();
    await review(page).getByText("One prompt, 4 calls, all or nothing").waitFor();
    const says = await review(page).locator(".says").allTextContents();
    assert.equal(says.length, 4);
    assert.match(says[0]!, /^Lets the USDC swapper take [\d,.]+ \S+ from you\.$/);
    assert.match(says[3]!, /^Sells 3 tokens for at least [\d,.]+ USDC, less any token skipped\.$/);
    assert.deepEqual(await review(page).locator(".function").allTextContents(), [
      "approve",
      "approve",
      "approve",
      "swap",
    ]);
    assert.equal(await review(page).locator(".to").last().textContent(), INTO_USDC.address);
    // AVNT leaves the wallet before the swap, so its route fails, and the swap skips it.
    const avnt = await balanceOf(AVNT, SELLER);
    assert.ok(avnt > 0n);
    await mined(SELLER, AVNT, encodeFunctionData({ abi: tokenAbi, functionName: "transfer", args: [STRANGER, avnt] }));
    const before = await balanceOf(INTO_USDC.token, SELLER);
    await review(page).getByRole("button", { name: "Confirm in your wallet" }).click();
    await review(page).getByText("Done.").waitFor({ timeout: 120_000 });
    assert.equal(sent.length, 4);
    const receipt = review(page).locator(".receipt");
    assert.equal(await receipt.locator(".swap-receipt-sold").innerText(), "2 tokens");
    const paid = await receipt.locator(".swap-receipt-paid").innerText();
    assert.match(paid, /^[\d,.]+ USDC$/);
    assert.ok((await balanceOf(INTO_USDC.token, SELLER)) > before);
    assert.equal(await balanceOf(WETH, SELLER), 0n);
    assert.equal(await balanceOf(ZORA, SELLER), 0n);
    const skipped = receipt.locator(".swap-receipt-skipped li");
    assert.match(await skipped.innerText(), /AVNT kept: its token refused the transfer/);
    await shoot(page, "swap-receipt-390-light", review(page));
    assert.ok((await readOn<bigint>(AVNT, tokenAbi, "allowance", [SELLER, INTO_USDC.address])) > 0n);
    await skipped.getByRole("button", { name: "Reset its approval" }).click();
    await review(page).getByRole("heading", { name: "Reset an approval" }).waitFor();
    assert.deepEqual(await review(page).locator(".says").allTextContents(), [
      "Resets AVNT's approval of the USDC swapper to nothing.",
    ]);
    await confirm(page);
    assert.equal(await readOn<bigint>(AVNT, tokenAbi, "allowance", [SELLER, INTO_USDC.address]), 0n);
    assert.deepEqual(violations, []);
  });

  test("if the page's RPCs serve another chain, no swap is offered, and the page says so", async () => {
    const elsewhere = (body: string) =>
      body.includes('"eth_chainId"') ? JSON.stringify({ jsonrpc: "2.0", id: 1, result: "0x1" }) : undefined;
    const { page } = await connected({ owner: HOLDER }, { url: `${SITE}/#swap`, answer: elsewhere });
    const swap = swapView(page);
    await swap.getByText("Swaps are off.").waitFor();
    for (const { symbol } of SWAPPERS)
      assert.equal(await swap.getByRole("radio", { name: new RegExp(`^${symbol}`) }).isDisabled(), true, symbol);
    assert.equal(await swap.getByRole("button", { name: "Review" }).isDisabled(), true);
    // The check itself is not named anywhere.
    assert.doesNotMatch(await page.locator("body").innerText(), /serves Base|Checks/);
  });

  test("claim, then swap what it brought into USDC in one prompt", async () => {
    await approveConduit(PAYEE, AUTOMAXI.address, 82774n);
    await settle();
    await warmPayouts(PAYEE);
    const { page, sent } = await connected({ owner: PAYEE, batch: true }, { url: `${SITE}/#app` });
    const line = app(page).locator("#needs li").filter({ hasText: "#82774: payout overdue" });
    await line.getByRole("button", { name: "Claim now" }).click({ timeout: 600_000 });
    await claimOpens(page);
    await review(page).getByRole("radio", { name: "Into" }).check();
    // Once every token's route is found, the quote, or why there is none.
    const into = review(page).locator(".claim-into");
    await into.getByText(/^[^…]/).waitFor({ timeout: 600_000 });
    assert.match(await into.innerText(), /^≈ [\d,.]+ USDC, at least [\d,.]+, from /);
    await shoot(page, "claim-into-390-light", review(page));
    await review(page).getByRole("button", { name: "Continue" }).click();
    // Its calls need more gas than one transaction may use, so the swap cannot join them: they go one at a time, even
    // from a wallet that sends several in one prompt, and the swap follows, of what they brought.
    const claims = await review(page).locator(".says").allTextContents();
    assert.ok(claims.length > 1 && claims.every((each) => /^Claims #82774's rewards from /.test(each)));
    assert.equal(await review(page).locator(".how").textContent(), `${claims.length} transactions`);
    const before = await balanceOf(INTO_USDC.token, PAYEE);
    await confirmEach(page, PAYEE);
    await review(page).getByRole("button", { name: "Review the swap into USDC" }).click();
    await review(page).getByRole("heading", { name: "What you swap" }).waitFor({ timeout: 300_000 });
    await review(page).getByRole("button", { name: "Continue" }).click();
    await review(page)
      .getByText(/^One prompt, \d+ calls, all or nothing$/)
      .waitFor();
    // The approvals, then the swap: in several calls, as here, when one would need more gas than a swap may use.
    const says = await review(page).locator(".says").allTextContents();
    const sells = says.findIndex((each) => /^Sells /.test(each));
    assert.ok(sells > 0, JSON.stringify(says));
    assert.ok(
      says.every((each, i) =>
        i < sells
          ? /^Lets the USDC swapper take /.test(each)
          : /^Sells \d+ tokens? for at least [\d,.]+ USDC, less any token skipped\.$/.test(each),
      ),
      JSON.stringify(says),
    );
    await review(page).getByRole("button", { name: "Confirm in your wallet" }).click();
    await review(page).getByText("Done.").waitFor({ timeout: 300_000 });
    assert.equal(sent.length, claims.length + says.length);
    await review(page)
      .locator(".swap-receipt-paid")
      .getByText(/^[\d,.]+ USDC$/)
      .first()
      .waitFor();
    assert.ok((await balanceOf(INTO_USDC.token, PAYEE)) > before);
  });
});
