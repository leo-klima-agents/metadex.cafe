import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { encodeFunctionData } from "viem";
import { AUTOMAXI, VOTING_ESCROW } from "../src/config.ts";
import {
  PAYEE,
  RECENT,
  SAFE_WALLET,
  SITE,
  abi,
  app,
  autoMaxiAbi,
  claimOpens,
  confirmEach,
  connected,
  hooks,
  mined,
  open,
  position,
  readOn,
  review,
  settle,
  shoot,
  start,
  stop,
  warmPayouts,
} from "./harness.ts";

describe("an overdue claim against a fork after the swappers' deployment", { timeout: 1_800_000 }, () => {
  before(() => start(RECENT, [PAYEE]));
  after(stop);
  hooks();

  test("an overdue payout in AutoMaxi: the App and the account say so, and Claim now claims it as it is", async () => {
    // #82774 moves to AutoMaxi, which now holds its claims, while what Carbon Impact's votes earned for it waits.
    await mined(
      PAYEE,
      VOTING_ESCROW,
      encodeFunctionData({ abi, functionName: "setConduitApproval", args: [AUTOMAXI.address, 82774n, true] }),
    );
    await settle();
    await warmPayouts(PAYEE);
    const { page, sent, violations } = await connected(
      { owner: PAYEE },
      { url: `${SITE}/#app`, width: 390, height: 844 },
    );
    const needs = app(page).locator("#needs");
    const line = needs.locator("li").filter({ hasText: "#82774: payout overdue" });
    await line.waitFor({ timeout: 600_000 });
    assert.match(await line.innerText(), /^#82774: payout overdue, at least (≈|<)\s\$[\d,.]+ in \d+ tokens?/);
    await shoot(page, "needs-overdue-390-light");
    await page.goto(`${SITE}/#hydrex/82774`);
    await position(page).getByText("Payout overdue:").waitFor();
    await position(page).getByRole("button", { name: "Claim now" }).click();
    await claimOpens(page);
    await review(page).getByText("Claim for #82774 · 1 of 2").waitFor();
    assert.equal(
      await review(page)
        .getByRole("radio", { name: /As they are/ })
        .isChecked(),
      true,
      "nothing sold unasked",
    );
    assert.match(await review(page).locator(".claim-paid").innerText(), /^(≈|<)\s\$/);
    await shoot(page, "claim-1-390-light", review(page));
    await review(page).getByRole("button", { name: "Continue" }).click();
    // It waits in 71 contracts, in 37 tokens: asking each contract for every token would need a billion gas, so the
    // claim is split into calls that each fit a transaction, which go one at a time.
    const says = await review(page).locator(".says").allTextContents();
    assert.ok(says.length > 1);
    assert.ok(
      says.every((each) =>
        /^Claims #82774's rewards from \d+ reward contracts? through AutoMaxi, which pays them to you, less 1%\.$/.test(
          each,
        ),
      ),
    );
    assert.deepEqual(
      await review(page).locator(".function").allTextContents(),
      says.map(() => "claim"),
    );
    assert.deepEqual(
      await review(page).locator(".to").allTextContents(),
      says.map(() => AUTOMAXI.address),
    );
    assert.equal(await review(page).locator(".how").textContent(), `${says.length} transactions`);
    await confirmEach(page, PAYEE);
    const receipt = review(page).locator(".receipt");
    assert.equal(await receipt.locator(".claim-receipt-id").innerText(), "#82774");
    assert.notEqual(await receipt.locator(".claim-receipt-paid").innerText(), "Nothing");
    assert.match(await receipt.locator(".claim-receipt-fee").innerText(), /^−/);
    await review(page).getByRole("link", { name: "Swap these" }).waitFor();
    assert.equal(sent.length, says.length);
    assert.ok((await readOn<bigint>(AUTOMAXI.address, autoMaxiAbi, "lastClaimBlock", [82774n])) > 0n);
    assert.deepEqual(violations, []);
  });

  test("inside Safe{Wallet}, a Safe proposes a claim too large for one transaction as several Safe transactions", async () => {
    await mined(
      PAYEE,
      VOTING_ESCROW,
      encodeFunctionData({ abi, functionName: "setConduitApproval", args: [AUTOMAXI.address, 82774n, true] }),
    );
    await settle();
    await warmPayouts(PAYEE);
    const { page, violations } = await open(false, { url: `${SAFE_WALLET}/`, safe: PAYEE });
    const frame = page.frameLocator("iframe");
    const dialog = review(frame);
    await frame
      .locator('.view[data-view="app"] #needs li')
      .filter({ hasText: "#82774: payout overdue" })
      .getByRole("button", { name: "Claim now" })
      .click({ timeout: 600_000 });
    await claimOpens(frame);
    // The swap would follow the claims' receipts, which come once the Safe's owners sign.
    assert.equal(await dialog.getByRole("radio", { name: "Into" }).isDisabled(), true);
    assert.equal(await dialog.locator(".claim-into").innerText(), "Swap them once the claims go through.");
    await dialog.getByRole("button", { name: "Continue" }).click();
    // As few Safe transactions as the calls' gas allows, each under what a transaction may use.
    const how = (await dialog.locator(".how").textContent()) ?? "";
    const [, safeTxs = "", calls = ""] = /^(\d+) Safe transactions, (\d+) calls$/.exec(how) ?? [];
    assert.ok(Number(safeTxs) > 1 && Number(calls) > Number(safeTxs), how);
    const counts = await dialog.locator(".count").allTextContents();
    assert.equal(counts[0], `Safe 1 of ${safeTxs} · 1 of ${calls}`);
    assert.equal(counts.at(-1), `Safe ${safeTxs} of ${safeTxs} · ${calls} of ${calls}`);
    await shoot(page, "safe-claim-1440-light");
    await dialog.getByRole("button", { name: "Propose in Safe{Wallet}" }).click();
    await dialog.getByText(`Proposed ${safeTxs} Safe transactions. Sign them in Safe{Wallet}.`).waitFor();
    // One proposal for each Safe transaction, with the calls the review shows in it, in order.
    type Received = { method: string; params: { txs: { to: string; data: string; value: string }[] } };
    const received = await page.evaluate(() => (window as unknown as { received: Received[] }).received);
    const proposals = received.filter(({ method }) => method === "sendTransactions").map(({ params }) => params.txs);
    assert.deepEqual(
      proposals.map((txs) => txs.length),
      Array.from(
        { length: Number(safeTxs) },
        (_, i) => counts.filter((each) => each.startsWith(`Safe ${i + 1} of`)).length,
      ),
    );
    const datas = await dialog.locator(".data").allTextContents();
    assert.deepEqual(
      proposals.flat(),
      datas.map((data) => ({ to: AUTOMAXI.address, data, value: "0" })),
    );
    assert.deepEqual(violations, []);
  });
});
