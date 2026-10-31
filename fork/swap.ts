import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { encodeFunctionData } from "viem";
import { DOUBLE_ESPRESSO, SWAPPERS, WETH } from "../src/config.ts";
import { SAFE_ORIGIN } from "../src/wallet.ts";
import * as h from "./harness.ts";
import {
  AVNT,
  HOLDER,
  PAYEE,
  RECENT,
  SELLER,
  SITE,
  STRANGER,
  ZORA,
  balanceOf,
  connected,
  heading,
  review,
  view,
} from "./harness.ts";

const INTO_USDC = SWAPPERS[0]!;
const says = (root: h.Opened["page"] | ReturnType<h.Opened["page"]["frameLocator"]>) =>
  review(root).locator("[data-text=says]").allTextContents();
// An answer as if the page's RPCs served another chain: Ethereum's id to eth_chainId.
const elsewhere = (body: string): string | undefined => {
  const call = JSON.parse(body) as { id?: unknown; method?: string };
  return call.method === "eth_chainId"
    ? JSON.stringify({ jsonrpc: "2.0", id: call.id ?? 1, result: "0x1" })
    : undefined;
};

// Waits until each token has its quote, then ticks only those given.
async function tickOnly(page: h.Opened["page"], symbols: string[]): Promise<void> {
  const swap = view(page, "swap");
  for (const symbol of symbols) await swap.getByRole("checkbox", { name: `Sell ${symbol}` }).waitFor();
  await swap.locator("[data-list=token] [data-loading]").first().waitFor({ state: "hidden" });
  for (const box of await swap.locator("[data-list=token] input").all()) {
    const symbol = ((await box.getAttribute("aria-label")) ?? "").replace(/^Sell /, "");
    if ((await box.isChecked()) !== symbols.includes(symbol)) await box.click();
  }
}

describe("the swap and the claim against a fork after the swappers' deployment", { timeout: 2_400_000 }, () => {
  before(() => h.start(RECENT, [HOLDER, PAYEE, SELLER]));
  after(h.stop);

  test("swap three tokens into USDC in one prompt; one is skipped, and its approval is reset", async () => {
    await h.fund([WETH, ZORA, AVNT]);
    const { page, sent, violations } = await connected({ owner: SELLER, batch: true }, { url: `${SITE}/#swap` });
    const swap = view(page, "swap");
    await heading(page, "Swap").waitFor();
    assert.equal(await swap.getByRole("radio", { name: "USDC" }).isChecked(), true);
    await tickOnly(page, ["WETH", "ZORA", "AVNT"]);
    await swap
      .locator("[data-text=paid]")
      .getByText(/^[\d,.]+ USDC/)
      .waitFor();
    assert.match(await swap.locator("[data-text=ticked]").innerText(), /^3 of \d+$/);
    assert.equal(await swap.getByRole("combobox", { name: /Minimum at/ }).inputValue(), "50");
    await h.shoot(page, "swap");
    await swap.getByRole("button", { name: "Review" }).click();
    await heading(review(page), "Quote", 2).waitFor();
    const bill = review(page).locator("article.slip");
    assert.match(await bill.innerText(), /Estimated gas/);
    for (const route of await bill.locator("[data-text=route]").allInnerTexts())
      assert.match(
        route,
        /^\S+( → \S+){1,3} via (Aero|Aerodrome|Uniswap|Hydrex)(, (Aero|Aerodrome|Uniswap|Hydrex))*$/,
        route,
      );
    assert.match(await bill.innerText(), /Minimum at 0.5% slippage/i);
    await review(page).getByRole("button", { name: "Continue" }).click();
    await review(page).getByText("All 4 in one prompt, all or nothing").waitFor();
    const calls = await says(page);
    assert.match(calls[0]!, /^Let the USDC swapper take [\d,.]+ \S+ from you$/);
    assert.match(calls[3]!, /^Sell 3 tokens for at least [\d,.]+ USDC$/);
    // AVNT leaves the wallet before the swap: its route fails, and the swap skips it.
    const avnt = await balanceOf(AVNT, SELLER);
    await h.mined(SELLER, AVNT, encodeFunctionData({ abi: h.abi, functionName: "transfer", args: [STRANGER, avnt] }));
    const before = await balanceOf(INTO_USDC.token, SELLER);
    await review(page).getByRole("button", { name: "Sign 4 transactions" }).click();
    await heading(review(page), "Done", 2).waitFor();
    assert.equal(sent.length, 4);
    const receipt = review(page).locator("[data-text=done] article.slip");
    for (const compared of await receipt.locator("[data-text=route]").allInnerTexts())
      assert.match(compared, /^(As quoted|[+−][\d.]+% vs quote)$/);
    assert.ok((await balanceOf(INTO_USDC.token, SELLER)) > before);
    assert.equal(await balanceOf(WETH, SELLER), 0n);
    await review(page)
      .getByText(/AVNT kept: its token refused the transfer/)
      .waitFor();
    assert.ok((await h.readOn<bigint>(AVNT, "allowance", [SELLER, INTO_USDC.address])) > 0n);
    await review(page).getByRole("button", { name: "Reset its approval" }).click();
    await heading(review(page), "Transaction", 2).waitFor();
    assert.deepEqual(await says(page), ["Reset AVNT's approval of the USDC swapper"]);
    await h.confirm(page);
    assert.equal(await h.readOn<bigint>(AVNT, "allowance", [SELLER, INTO_USDC.address]), 0n);
    assert.deepEqual(violations, []);
  });

  test("if the page's RPCs serve another chain, no swap is offered, and the page says so", async () => {
    const { page } = await connected({ owner: HOLDER }, { url: `${SITE}/#swap`, answer: elsewhere });
    const swap = view(page, "swap");
    await swap.getByText("Swaps are off.").waitFor();
    for (const { symbol } of SWAPPERS)
      assert.equal(await swap.getByRole("radio", { name: new RegExp(`^${symbol}`) }).isDisabled(), true, symbol);
    assert.equal(await swap.getByRole("button", { name: "Review" }).isDisabled(), true);
    await page.goto(`${SITE}/#hydrex`);
    await page.getByText("Joining is off: the page reached another network than Base.").waitFor();
  });

  test("an overdue payout in Double Espresso: claimed, then what it brought swapped into USDC", async () => {
    await h.approveConduit(PAYEE, DOUBLE_ESPRESSO.address, 82774n);
    await h.settle();
    const { page, sent } = await connected({ owner: PAYEE, batch: true }, { url: `${SITE}/#app` });
    const line = view(page, "app").locator("[data-list=need] > li").filter({ hasText: "#82774: payout overdue" });
    await line.filter({ hasText: /payout overdue, at least (≈|<)\s\$[\d,.]+ in \d+ tokens?/ }).waitFor();
    await line.getByRole("button", { name: "Claim now" }).click();
    await heading(review(page), "What waits", 2).waitFor();
    assert.equal(
      await review(page)
        .getByRole("radio", { name: /As they are/ })
        .isChecked(),
      true,
      "nothing sold unasked",
    );
    await review(page).getByRole("radio", { name: "Into" }).check();
    await review(page)
      .getByText(/^[\d,.]+ USDC, at least [\d,.]+, from /)
      .waitFor();
    await review(page).getByRole("button", { name: "Continue" }).click();
    // Its calls need more gas than one transaction may use: they go one at a time, and the swap follows.
    const claims = await says(page);
    assert.ok(
      claims.length > 1 && claims.every((each) => /^Claims account #82774's rewards from /.test(each)),
      JSON.stringify(claims),
    );
    const before = await balanceOf(INTO_USDC.token, PAYEE);
    await h.confirm(page);
    await review(page).getByRole("button", { name: "Review the swap into USDC" }).click();
    await heading(review(page), "Quote", 2).waitFor();
    await review(page).getByRole("button", { name: "Continue" }).click();
    await review(page)
      .getByText(/^All \d+ in one prompt, all or nothing$/)
      .waitFor();
    const swaps = await says(page);
    await review(page)
      .getByRole("button", { name: /^Sign \d+ transactions$/ })
      .click();
    await heading(review(page), "Done", 2).waitFor();
    assert.equal(sent.length, claims.length + swaps.length);
    assert.ok((await balanceOf(INTO_USDC.token, PAYEE)) > before);
    assert.ok((await h.readOn<bigint>(DOUBLE_ESPRESSO.address, "lastClaimBlock", [82774n])) > 0n);
  });

  test("inside Safe{Wallet}, a Safe proposes a claim too large for one transaction as several Safe transactions", async () => {
    await h.approveConduit(PAYEE, DOUBLE_ESPRESSO.address, 82774n);
    await h.settle();
    const { page, violations } = await h.open(false, { url: `${SAFE_ORIGIN}/`, safe: PAYEE });
    const frame = page.frameLocator("iframe");
    const dialog = review(frame);
    await frame
      .locator('[data-view="app"] [data-list=need] > li')
      .filter({ hasText: "#82774: payout overdue" })
      .getByRole("button", { name: "Claim now" })
      .click();
    await heading(dialog, "What waits", 2).waitFor();
    assert.equal(await dialog.getByRole("radio", { name: "Into" }).isDisabled(), true);
    await dialog.getByText("Swap them once the claims go through.").waitFor();
    await dialog.getByRole("button", { name: "Continue" }).click();
    const how = (await dialog.locator("[data-text=how]").textContent()) ?? "";
    const [, safeTxs = "", calls = ""] = /^(\d+) Safe transactions, (\d+) calls$/.exec(how) ?? [];
    assert.ok(Number(safeTxs) > 1 && Number(calls) > Number(safeTxs), how);
    const counts = await dialog.locator("[data-text=count]").allTextContents();
    assert.equal(counts[0], `Safe 1 of ${safeTxs} · Call 1 of ${calls} · Claim`);
    await dialog.getByRole("button", { name: "Propose in Safe{Wallet}" }).click();
    await dialog.getByText(`Proposed ${safeTxs} Safe transactions. Sign them in Safe{Wallet}.`).waitFor();
    type Received = { method: string; params: { txs: unknown[] } };
    const received = await page.evaluate(() => (window as unknown as { received: Received[] }).received);
    assert.equal(received.filter(({ method }) => method === "sendTransactions").length, Number(safeTxs));
    assert.deepEqual(violations, []);
  });
});
