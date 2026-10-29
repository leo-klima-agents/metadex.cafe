import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { type Locator, type Page } from "playwright-core";
import { encodeFunctionData } from "viem";
import { DOUBLE_ESPRESSO, SWAPPERS, WETH } from "../src/config.ts";
import {
  AVNT,
  HOLDER,
  PAYEE,
  RECENT,
  SELLER,
  SITE,
  STRANGER,
  ZORA,
  elsewhere,
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
    // Each row's quote is pending until its route is found.
    await swap.locator(".swap-fetches.pending").first().waitFor({ state: "hidden", timeout: 120_000 });
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
    await swap.getByRole("heading", { name: "Swap", exact: true, level: 1 }).waitFor();
    assert.equal(
      await swap.getByRole("radio", { name: "USDC" }).isChecked(),
      true,
      "USDC unless the address names another",
    );
    await tickOnly(page, ["WETH", "ZORA", "AVNT"]);
    // What they fetch, line by line: the quote, less the 1%, is what reaches you; the slippage picked sets the least
    // that may; and gas is paid apart, in ETH. Each in tokens, then what it is worth, quieter.
    const summary = swap.locator(".breakdown");
    await summary
      .locator(".swap-paid .exact")
      .getByText(/^[\d,.]+ USDC$/)
      .waitFor();
    const labels = await summary.locator("dt").allInnerTexts();
    assert.deepEqual(
      [labels[0], labels[1], labels[2], labels[4]],
      ["Quote", "Swap fee (1%)", "Reaches you", "Estimated gas"],
    );
    assert.match(labels[3]!, /^Minimum at/);
    assert.equal(await summary.getByRole("combobox", { name: /Minimum at/ }).inputValue(), "50");
    // Each figure exactly, then what it is worth.
    const figure = async (root: Locator, name: string): Promise<[string, string]> => [
      await root.locator(`.${name} .exact`).innerText(),
      await root.locator(`.${name} .worth`).innerText(),
    ];
    const worth = /^(≈|<)\s\$[\d,.]+$/;
    for (const [name, exact, inMoney] of [
      ["swap-quoted", /^[\d,.]+ USDC$/, worth],
      ["swap-fee", /^−[\d,.]+ USDC$/, /^(≈|>)\s−\$[\d,.]+$/],
      ["swap-paid", /^[\d,.]+ USDC$/, worth],
      ["swap-least", /^[\d,.]+ USDC$/, worth],
      ["swap-gas", /^[\d.]+ ETH$/, worth],
    ] as const) {
      const [shown, value] = await figure(summary, name);
      assert.match(shown, exact, name);
      assert.match(value, inMoney, name);
    }
    assert.match(await swap.locator(".swap-ticked").innerText(), /^· 3 of \d+$/);
    await shoot(page, "swap-390-light");
    await swap.getByRole("button", { name: "Review" }).click();
    await review(page).getByRole("heading", { name: "Quote", exact: true }).waitFor({ timeout: 300_000 });
    assert.equal(await review(page).locator(".swap-simulated").isVisible(), false, "run through Base");
    // A bill: each token with its route by tokens and pools, no addresses, under the gas; then the least, which the
    // slippage set.
    const bill = review(page).locator(".pages .receipt");
    assert.equal(await bill.locator(".receipt-name").innerText(), "metaDEX Café");
    assert.equal(await bill.locator(".label code").innerText(), "USDC");
    assert.equal(await review(page).locator(".step-count code").innerText(), "USDC");
    assert.match(await bill.locator(".receipt-day").innerText(), /^Estimated gas /);
    const [gasShown, gasValue] = await figure(bill, "swap-gas");
    assert.match(gasShown, /^[\d.]+ ETH$/);
    assert.match(gasValue, worth);
    // A line a token, or a line each for a token sold in parts.
    const sold = await bill.locator(".swap-lines .line-symbol").allInnerTexts();
    assert.deepEqual([...new Set(sold)].sort(), ["AVNT", "WETH", "ZORA"]);
    // "ZORA → WETH → USDC via Aerodrome, Uniswap": the tokens, then who runs the pools, each once.
    for (const route of await bill.locator(".line-route").allInnerTexts()) {
      assert.match(
        route,
        /^\S+( → \S+){1,3} via (Aero|Aerodrome|Uniswap|Hydrex)(, (Aero|Aerodrome|Uniswap|Hydrex))*$/,
        route,
      );
      assert.doesNotMatch(route, /0x|tick spacing|%/, route);
    }
    // The total's label shows in capitals; its text is as written.
    assert.equal(await bill.locator(".swap-slippage").textContent(), "Minimum at 0.5% slippage");
    await review(page).getByRole("button", { name: "Continue" }).click();
    await review(page).getByText("All 4 in one prompt, all or nothing").waitFor();
    const says = await review(page).locator(".says").allTextContents();
    assert.equal(says.length, 4);
    assert.match(says[0]!, /^Let the USDC swapper take [\d,.]+ \S+ from you$/);
    assert.match(says[3]!, /^Sell 3 tokens for at least [\d,.]+ USDC$/);
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
    await review(page).getByRole("button", { name: "Sign 4 transactions" }).click();
    await review(page).getByRole("heading", { name: "Done" }).waitFor({ timeout: 120_000 });
    assert.doesNotMatch(await review(page).locator(".progress").innerText(), /went through/);
    assert.equal(sent.length, 4);
    // The receipt on the Done screen, not the bill on its hidden page, nor the calls' slips.
    const receipt = review(page).locator(".done .receipt");
    // When, the gas the wallet paid, then each token sold, what it fetched, and how that compares with the quote.
    assert.match(await receipt.locator(".swap-receipt-time").innerText(), / UTC$/);
    assert.match(await receipt.locator(".swap-receipt-gas .exact").innerText(), /^[\d.]+ ETH$/);
    const lines = receipt.locator(".swap-lines li");
    assert.equal(await lines.count(), 2);
    for (const compared of await lines.locator(".line-route").allInnerTexts())
      assert.match(compared, /^(As quoted|[+−][\d.]+% vs quote)$/);
    const paid = await receipt.locator(".swap-receipt-paid .exact").innerText();
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
      "Reset AVNT's approval of the USDC swapper",
    ]);
    await confirm(page);
    assert.equal(await readOn<bigint>(AVNT, tokenAbi, "allowance", [SELLER, INTO_USDC.address]), 0n);
    assert.deepEqual(violations, []);
  });

  test("if the page's RPCs serve another chain, no swap is offered, and the page says so", async () => {
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
    await approveConduit(PAYEE, DOUBLE_ESPRESSO.address, 82774n);
    await settle();
    await warmPayouts(PAYEE);
    const { page, sent } = await connected({ owner: PAYEE, batch: true }, { url: `${SITE}/#app` });
    const line = app(page).locator("#needs li").filter({ hasText: "#82774: payout overdue" });
    await line.getByRole("button", { name: "Claim now" }).click({ timeout: 600_000 });
    await claimOpens(page);
    await review(page).getByRole("radio", { name: "Into" }).check();
    // Once every token's route is found, the quote, or why there is none.
    const into = review(page).locator(".claim-into");
    await review(page).locator(".claim-into:not(.pending)").waitFor({ timeout: 600_000 });
    assert.match(await into.innerText(), /^[\d,.]+ USDC, at least [\d,.]+, from /);
    await shoot(page, "claim-into-390-light", review(page));
    await review(page).getByRole("button", { name: "Continue" }).click();
    // Its calls need more gas than one transaction may use, so the swap cannot join them: they go one at a time, even
    // from a wallet that sends several in one prompt, and the swap follows, of what they brought.
    const claims = await review(page).locator(".says").allTextContents();
    assert.ok(claims.length > 1 && claims.every((each) => /^Claims account #82774's rewards from /.test(each)));
    assert.equal(await review(page).locator(".how").textContent(), "");
    const before = await balanceOf(INTO_USDC.token, PAYEE);
    await confirmEach(page, PAYEE);
    await review(page).getByRole("button", { name: "Review the swap into USDC" }).click();
    await review(page).getByRole("heading", { name: "Quote", exact: true }).waitFor({ timeout: 300_000 });
    await review(page).getByRole("button", { name: "Continue" }).click();
    await review(page)
      .getByText(/^All \d+ in one prompt, all or nothing$/)
      .waitFor();
    // The approvals, then the swap: in several calls, as here, when one would need more gas than a swap may use.
    const says = await review(page).locator(".says").allTextContents();
    const sells = says.findIndex((each) => /^Sell /.test(each));
    assert.ok(sells > 0, JSON.stringify(says));
    assert.ok(
      says.every((each, i) =>
        i < sells
          ? /^Let the USDC swapper take /.test(each)
          : /^Sell \d+ tokens? for at least [\d,.]+ USDC$/.test(each),
      ),
      JSON.stringify(says),
    );
    await review(page)
      .getByRole("button", { name: /^Sign \d+ transactions$/ })
      .click();
    await review(page).getByRole("heading", { name: "Done" }).waitFor({ timeout: 300_000 });
    assert.equal(sent.length, claims.length + says.length);
    await review(page)
      .locator(".swap-receipt-paid")
      .getByText(/^[\d,.]+ USDC$/)
      .first()
      .waitFor();
    assert.ok((await balanceOf(INTO_USDC.token, PAYEE)) > before);
  });
});
