import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { type Page } from "playwright-core";
import { encodeFunctionData, getAddress, type Address } from "viem";
import { AUTOMATIONS, AUTOMAXI, HYDX, SWAPPERS, VOTING_ESCROW } from "../src/config.ts";
import { readEarnings } from "../src/earnings.ts";
import { pricesNow } from "../src/prices.ts";
import { MIDDLES, findRoute, swapChecks } from "../src/swap.ts";
import { describe as describeTokens, holdingsOf, known } from "../src/tokens.ts";
import {
  PAYEE,
  RECENT,
  SITE,
  STRANGER,
  abi,
  anvil,
  app,
  balanceOf,
  claimOpens,
  confirm,
  confirmEach,
  connected,
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
  warm,
  warmPayouts,
} from "./harness.ts";

// Carbon Impact's treasury, a Safe that holds many of the tokens its fee took.
const HOLDER = getAddress("0xd9e966a6bfa2ae2113a34bb4dd02ded921da50af");
const AVNT = getAddress("0x696f9436b67233384889472cd7cd58a6fb5df4f1");
const ZORA = getAddress("0x1111111111166b7fe7bd91427724b487980afc69");
const WETH = getAddress("0x4200000000000000000000000000000000000006");
const [INTO_USDC, INTO_EURC] = SWAPPERS as [(typeof SWAPPERS)[number], (typeof SWAPPERS)[number]];
// A wallet of the test's own, which the treasury gives three of its tokens, so that the page has only those to route.
const SELLER = getAddress("0x0000000000000000000000000000000000c0ffee");

// Gives SELLER the treasury's whole balance of each token, then reads what the page will: the swappers' checks, which
// Review waits for, the balances, the prices, and each token's route into USDC, with no time limit, as anvil reads the
// pools from FORK_URL a slot at a time.
async function fund(tokens: Address[]): Promise<void> {
  for (const token of tokens) {
    const amount = await balanceOf(token, HOLDER);
    await mined(HOLDER, token, encodeFunctionData({ abi: tokenAbi, functionName: "transfer", args: [SELLER, amount] }));
  }
  await warm(async () => {
    // The page reads the balance of every token it knows, and adds last epoch's rewards, such as AVNT, once it has read
    // each automation's.
    await Promise.all([swapChecks(), ...AUTOMATIONS.map(({ address }) => readEarnings(address))]);
    const held = await holdingsOf(SELLER, [...known(), ...tokens], INTO_USDC.address);
    // The page prices the tokens its routes name too.
    const described = await describeTokens([...tokens, INTO_USDC.token, ...MIDDLES, HYDX]);
    const amounts = new Map(tokens.map((token) => [token.toLowerCase(), held.get(token.toLowerCase())!.balance]));
    await pricesNow([...described.values()], amounts);
    for (const token of tokens) await findRoute(token, amounts.get(token.toLowerCase())!, INTO_USDC, false);
  });
}

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
    await swap
      .locator(".swap-sells")
      .getByText(/^≈ [\d,.]+ USDC, at least [\d,.]+$/)
      .waitFor();
    assert.match(await swap.locator(".swap-ticked").innerText(), /^· 3 of \d+$/);
    await swap
      .locator(".swap-costs")
      .getByText(/^Fee ≈ [\d,.]+ USDC · Gas /)
      .waitFor();
    await shoot(page, "swap-390-light");
    await swap.getByRole("button", { name: "Review" }).click();
    await review(page).getByRole("heading", { name: "What you swap" }).waitFor({ timeout: 300_000 });
    assert.equal(await review(page).locator(".swap-simulated").isVisible(), false, "run through Base");
    assert.equal(await review(page).locator(".swap-lines li").count(), 3);
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

  test("a swapper whose checks fail turns its output off, and says which check failed", async () => {
    await anvil("anvil_setCode", [INTO_EURC.address, "0x00"]);
    const { page } = await connected({ owner: HOLDER }, { url: `${SITE}/#swap/eurc` });
    const swap = swapView(page);
    await swap.getByText("Swaps into EURC are off.").waitFor();
    assert.equal(await swap.getByRole("radio", { name: /EURC/ }).isDisabled(), true);
    assert.equal(await swap.getByRole("radio", { name: "USDC" }).isDisabled(), false);
    assert.equal(await swap.getByRole("button", { name: "Review" }).isDisabled(), true);
    await page.goto(`${SITE}/#swap/eurc/check`);
    const failed = swap.locator('[data-check="swap-code"] .check-failed');
    await failed.waitFor();
    assert.equal(await failed.innerText(), "Failed for EURC: ");
    assert.equal(await swap.locator('[data-check="chain"] .check-failed').count(), 0);
  });

  test("claim, then swap what it brought into USDC in one prompt", async () => {
    await mined(
      PAYEE,
      VOTING_ESCROW,
      encodeFunctionData({ abi, functionName: "setConduitApproval", args: [AUTOMAXI.address, 82774n, true] }),
    );
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
