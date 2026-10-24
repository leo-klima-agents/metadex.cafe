import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { encodeFunctionData, zeroAddress } from "viem";
import { AUTOMAXI, VOTING_ESCROW } from "../src/config.ts";
import { readEarnings } from "../src/earnings.ts";
import { WEEK, short } from "../src/format.ts";
import { readAccounts } from "../src/hydrex.ts";
import {
  CONDUIT,
  FLIP,
  SITE,
  SAFE_WALLET,
  RPC_ORIGINS,
  MEMBER,
  NEWCOMER,
  LEAVER,
  PAYEE,
  STRANGER,
  abi,
  anvil,
  warm,
  approveConduit,
  autoMaxiReceipts,
  deployAutoMaxi,
  settle,
  claimOne,
  expectApprovals,
  forwarding,
  open,
  connected,
  app,
  hydrex,
  account,
  group,
  product,
  position,
  review,
  appTitle,
  toHydrex,
  chip,
  toWallet,
  nextEpoch,
  pick,
  shoot,
  confirm,
  stop,
  hooks,
  startAtBlock,
} from "./harness.ts";

describe("the page against a fork of Base: a Safe, AutoMaxi, and a new epoch", { timeout: 1_800_000 }, () => {
  before(startAtBlock);
  after(stop);
  hooks();

  test("closing the review before Base includes the transaction still updates the account", async () => {
    const { page } = await connected({ owner: NEWCOMER });
    await group(page, "other").getByRole("button", { name: "Join Carbon Impact", exact: true }).click();
    await toWallet(page);
    await anvil("evm_setAutomine", [false]);
    try {
      await review(page).getByRole("button", { name: "Confirm in your wallet" }).click();
      await review(page).getByText("Waiting for Base to include it").waitFor();
      await review(page).getByRole("button", { name: "Close" }).click();
      await account(page, 141).getByText("You vote with it").waitFor();
      // Mine only after the page has polled again: it polls every two seconds.
      await page.waitForTimeout(5_000);
      await anvil("evm_mine");
    } finally {
      await anvil("evm_setAutomine", [true]);
    }
    await account(page, 141).getByText("Joining Carbon Impact:").waitFor();
  });

  test("inside Safe{Wallet}, a Safe proposes leaving with two accounts as one Safe transaction", async () => {
    const { page, origins, violations } = await open(false, { url: `${SAFE_WALLET}/` });
    const frame = page.frameLocator("iframe");
    const dialog = frame.locator("#review");
    await frame.locator("header").getByText(short(LEAVER)).waitFor();
    assert.equal(await frame.getByRole("heading", { name: "Your Wallet", level: 1, exact: true }).isVisible(), true);
    assert.equal(await frame.getByRole("heading", { name: "Vote, claim and swap on Base" }).isVisible(), false);
    await frame.getByRole("link", { name: "Hydrex automations" }).click();
    await frame.getByRole("checkbox", { name: "Pick Hydrex account #53350" }).check();
    await frame.getByRole("checkbox", { name: "Pick Hydrex account #82206" }).check();
    await frame.getByRole("button", { name: "Leave with 2 Hydrex accounts" }).click();
    await dialog.getByText(/^One Safe transaction, 2 calls$/).waitFor();
    // Co-signers compare each call's fields and calldata, shown in full, with Safe{Wallet}'s.
    const call = dialog.locator(".slip").first();
    assert.equal(await call.locator(".conduit").innerText(), CONDUIT, "co-signers see the address, not only its name");
    assert.equal(await call.locator(".conduit-name").innerText(), "Carbon Impact");
    assert.equal(await call.locator(".call").innerText(), "100 bytes:");
    assert.equal(await call.locator(".count").textContent(), "Safe · Call 1 of 2");
    assert.equal(
      await call.locator(".slip-note").innerText(),
      "The selector, then each 32-byte word on two lines: the conduit, 53350 as d066, and false as 0.",
    );
    assert.equal(await dialog.locator(".operation").first().isVisible(), false, "Safe{Wallet} sets the operation");
    await shoot(page, "safe-calls-1440-light");
    await dialog.getByRole("button", { name: "Propose in Safe{Wallet}" }).click();
    await dialog.getByText("Proposed.").waitFor();
    await dialog.getByRole("link", { name: "https://metadex.cafe/#hydrex/carbon-impact/check" }).waitFor();
    type Received = { method: string; params: { txs: { to: string; data: string; value: string }[] } };
    const received = await page.evaluate(() => (window as unknown as { received: Received[] }).received);
    const leave = (id: bigint) => ({
      to: VOTING_ESCROW,
      data: encodeFunctionData({ abi, functionName: "setConduitApproval", args: [CONDUIT, id, false] }),
      value: "0",
    });
    const proposal = received.find(({ method }) => method === "sendTransactions");
    assert.deepEqual(proposal?.params.txs, [leave(53350n), leave(82206n)]);
    assert.deepEqual(await dialog.locator(".data").allInnerTexts(), [leave(53350n).data, leave(82206n).data]);
    await expectApprovals([53350n, 82206n], CONDUIT, CONDUIT);
    assert.deepEqual(violations, []);
    for (const origin of origins) {
      assert.ok([SITE, SAFE_WALLET, ...RPC_ORIGINS].includes(origin), `unexpected request to ${origin}`);
    }
  });

  test("a second click while the wallet asks does not lose the first", async () => {
    let approve = () => {};
    const approval = new Promise<void>((resolve) => (approve = resolve));
    const { page } = await open({ owner: NEWCOMER, approval }, { url: `${SITE}/#app` });
    const button = page.getByRole("button", { name: "Test Wallet" });
    await button.click();
    await button.click();
    await app(page).getByText("did not connect").waitFor();
    approve();
    await chip(page, NEWCOMER).waitFor();
    await toHydrex(page);
    await account(page, 141).waitFor();
  });

  test("once AutoMaxi is on Base: join it, move between the two automations, and leave it", async () => {
    await deployAutoMaxi();
    // The pages read these at the latest block, which anvil reads from FORK_URL a slot at a time.
    await warm(() =>
      Promise.all([
        readEarnings(CONDUIT),
        readEarnings(AUTOMAXI.address),
        readAccounts(NEWCOMER),
        readAccounts(LEAVER),
      ]),
    );
    const { page, sent } = await connected({ owner: NEWCOMER });
    await group(page, "other").getByRole("button", { name: "Join AutoMaxi", exact: true }).click();
    await review(page).getByText("Join AutoMaxi · 1 of 2").waitFor();
    await review(page)
      .getByText("Anyone can then claim the rewards this Hydrex account has not claimed yet, less 1%.")
      .waitFor();
    await review(page).getByRole("link", { name: "Fixed" }).waitFor();
    await review(page)
      .locator(".estimate-week")
      .getByText("No record yet", { exact: true })
      .waitFor({ timeout: 120_000 });
    assert.equal(await review(page).locator(".fee-facts").count(), 0, "the fee facts are on its page");
    await shoot(page, "automaxi-join-1-1440-light");
    await review(page).getByRole("button", { name: "Continue" }).click();
    assert.deepEqual(await review(page).locator(".says").allTextContents(), ["Account #141 joins AutoMaxi."]);
    assert.deepEqual(await review(page).locator(".conduit-name").allTextContents(), ["AutoMaxi"]);
    assert.equal(await review(page).locator(".conduit").textContent(), AUTOMAXI.address);
    await confirm(page);
    await expectApprovals([141n], AUTOMAXI.address, AUTOMAXI.address);
    await group(page, "in:automaxi").getByText("Joining AutoMaxi:").waitFor();
    assert.equal(sent.length, 1);

    // An account in Carbon Impact moves in one call, and back the same way. LEAVER's were never paid, so the page has
    // no receipt to price for them, which would keep anvil busy.
    const member = await connected({ owner: LEAVER });
    const own = member.page;
    await group(own, "in:carbon-impact").getByText("#53350").waitFor();
    await pick(own, 53350);
    await group(own, "in:carbon-impact")
      .getByRole("button", { name: "Move to AutoMaxi with 1 Hydrex account" })
      .click();
    await toWallet(own);
    assert.deepEqual(await review(own).locator(".says").allTextContents(), [
      "Account #53350 leaves Carbon Impact and joins AutoMaxi.",
    ]);
    await confirm(own);
    await expectApprovals([53350n], AUTOMAXI.address, AUTOMAXI.address);
    await group(own, "in:automaxi").getByText("Joining AutoMaxi:").waitFor();
    await group(own, "in:automaxi").getByRole("button", { name: "Move to Carbon Impact", exact: true }).click();
    await toWallet(own);
    assert.deepEqual(await review(own).locator(".says").allTextContents(), [
      "Account #53350 leaves AutoMaxi and joins Carbon Impact.",
    ]);
    await confirm(own);
    await expectApprovals([53350n], CONDUIT, CONDUIT);
    await group(own, "in:carbon-impact").locator("li").filter({ hasText: "#53350" }).waitFor();
    assert.equal(await group(own, "in:automaxi").isVisible(), false);

    // Leaving AutoMaxi gives the votes back to the owner.
    await group(page, "in:automaxi").getByRole("button", { name: "Leave" }).click();
    await review(page).getByRole("heading", { name: "Leave AutoMaxi" }).waitFor();
    await review(page).locator(".pages").getByText("Claims stop").waitFor();
    await confirm(page);
    await expectApprovals([141n], NEWCOMER, zeroAddress);
    await account(page, 141).getByText("You vote with it").waitFor();
    assert.deepEqual([...sent, ...member.sent].length, 4);
  });

  test("AutoMaxi's receipts: a claim by its keeper, a stranger's dust, and where the page stops reading", async () => {
    // Its standing is read in the pools Carbon Impact voted for, last epoch and the one before, as test 7 reads them.
    const rewards = await autoMaxiReceipts();
    const { page, violations } = await open(
      { owner: PAYEE },
      { width: 390, height: 844, url: `${SITE}/#hydrex/82774` },
    );
    const standing = position(page).locator(".standing");
    const receipt = standing.locator(".receipt");
    await receipt.waitFor({ timeout: 120_000 });
    await position(page).locator(".position-status").getByText("Joining AutoMaxi:").waitFor();
    assert.equal(await receipt.locator(".label").first().textContent(), "Receipt · Account #82774 · AutoMaxi");
    assert.match(await receipt.locator(".receipt-claimed").innerText(), /^(< )?[\d,.]+ USDC$/);
    assert.equal(await receipt.locator(".receipt-fee-share").innerText(), "1%");
    assert.match(await receipt.locator(".receipt-fee").innerText(), /^−[\d,.<\s]+ USDC$/);
    assert.match(await receipt.locator(".receipt-paid").innerText(), /^(< )?[\d,.]+ USDC$/);
    assert.deepEqual(await receipt.locator(".claim-by").allTextContents(), ["by 0x0000…dEaD", "by AutoMaxi"]);
    assert.equal(await receipt.locator(".receipt-stopped").isVisible(), false);
    // USDC counts as a dollar.
    await receipt
      .locator(".receipt-paid-usd")
      .getByText(/^(≈|<)\s\$/)
      .waitFor({ timeout: 120_000 });
    await shoot(page, "automaxi-receipt-390-light", position(page));

    // Dust in many blocks: the page reads ten of them, and says it stopped.
    for (const reward of rewards.filter(({ token }) => token.symbol !== "USDC").slice(0, 10)) {
      await claimOne(STRANGER, 82774n, reward);
    }
    await settle();
    const again = await open({ owner: PAYEE }, { width: 390, height: 844, url: `${SITE}/#hydrex/82774` });
    const longer = position(again.page).locator(".receipt");
    await longer.locator(".receipt-stopped").waitFor({ timeout: 120_000 });
    assert.equal(await longer.locator(".receipt-stopped").innerText(), "Last 10 blocks only");
    assert.equal(await longer.locator(".claim-by").count(), 10);
    assert.deepEqual([...violations, ...again.violations], []);
  });

  test("the menu in the App, a page for each automation, and joining from it", async () => {
    await deployAutoMaxi();
    await warm(() => Promise.all([readEarnings(CONDUIT), readEarnings(AUTOMAXI.address), readAccounts(NEWCOMER)]));
    const { page, violations } = await connected({ owner: NEWCOMER }, { width: 390, height: 844 });
    await account(page, 141).getByText("You vote with it").waitFor();
    const menu = hydrex(page).locator("#menu");
    assert.deepEqual(await menu.locator("h3").allInnerTexts(), ["Carbon Impact", "AutoMaxi", "Vote yourself"]);
    await menu.locator(".automaxi-state").getByText("Not voted yet").waitFor();
    await menu
      .locator('[data-choice="carbon-impact"] .record')
      .getByText(/^≈\s\$0\.\d\d$/)
      .waitFor({ timeout: 120_000 });
    assert.equal(await menu.locator('[data-choice="automaxi"] .record').innerText(), "No record yet");
    assert.equal(await menu.locator('[data-choice="self"] dd').last().innerText(), "Varies");
    await shoot(page, "menu-390-light", menu);
    await menu.getByRole("link", { name: "AutoMaxi" }).click();
    const maxi = product(page, "automaxi");
    await maxi.getByRole("heading", { name: "AutoMaxi", level: 1 }).waitFor();
    assert.equal(await page.title(), "AutoMaxi · metaDEX Café");
    assert.equal(await maxi.locator(".automaxi-absent").isVisible(), false);
    assert.equal(await maxi.locator(".record").innerText(), "No record yet");
    assert.equal(await maxi.locator(".record-unit").innerText(), "");
    await shoot(page, "automaxi-390-light");
    // #141 and #42877 can join it, so its button waits for a tick.
    assert.equal(await maxi.getByRole("button", { name: "Join AutoMaxi", exact: true }).isDisabled(), true);
    await pick(page, 141);
    await maxi.getByRole("button", { name: "Join AutoMaxi with 1 Hydrex account" }).click();
    await review(page).getByText("Join AutoMaxi · 1 of 2").waitFor();
    await page.keyboard.press("Escape");
    // Its title leads back to Hydrex, and to the wallet.
    const trail = maxi.getByRole("navigation", { name: "Breadcrumb" });
    assert.deepEqual(await trail.getByRole("link").allInnerTexts(), ["Your Wallet", "Hydrex"]);
    await trail.getByRole("link", { name: "Your Wallet" }).click();
    await appTitle(page).waitFor();

    await page.goto(`${SITE}/#hydrex/carbon-impact`);
    const impact = product(page, "carbon-impact");
    await impact.getByRole("heading", { name: "Carbon Impact", level: 1 }).waitFor();
    await impact
      .locator(".tonnes")
      .getByText(/^\d[\d,]*$/)
      .waitFor();
    // Its popups start closed, its fee facts among them, and the address of one opens it.
    assert.equal(await page.locator(":popover-open").count(), 0);
    await shoot(page, "carbon-impact-390-light");
    await page.goto(`${SITE}/#hydrex/carbon-impact/fees`);
    const facts = impact.locator(".fee-facts dd");
    await facts.first().getByText("33.33% retired, 0% fee").waitFor();
    assert.equal(await facts.nth(1).innerText(), "100% retired, 1% fee");
    const treasury = "0xd9e966a6Bfa2aE2113a34Bb4dd02ded921DA50aF";
    assert.equal(
      await facts.nth(2).getByRole("link", { name: "its treasury" }).getAttribute("href"),
      `https://basescan.org/address/${treasury}`,
    );
    await page.goto(`${SITE}/#hydrex/carbon-impact/check`);
    const check = impact.locator('[data-section="check"]');
    assert.equal(await check.evaluate((pop) => pop.matches(":popover-open")), true);
    assert.match(await check.locator("a.treasury").innerText(), new RegExp(`^${treasury}$`));
    assert.equal(await check.locator(".check-failed").count(), 0, "every check passed");

    // An account's page: the wallet's own has its actions; another's names its owner.
    await page.goto(`${SITE}/#hydrex/141`);
    await position(page).getByRole("heading", { name: "Account #141", level: 1 }).waitFor();
    await position(page).getByText("You vote with it").waitFor();
    await position(page).getByRole("button", { name: "Join AutoMaxi", exact: true }).waitFor();
    await page.goto(`${SITE}/#hydrex/9540`);
    await position(page).locator(".position-owner-row").getByText(short(MEMBER)).waitFor({ timeout: 60_000 });
    assert.equal(
      await position(page)
        .getByRole("button")
        .filter({ hasText: /Join|Leave|Move/ })
        .count(),
      0,
    );
    await page.goto(`${SITE}/#hydrex/999999999`);
    await position(page).getByText("No such Hydrex account.").waitFor();
    assert.deepEqual(violations, []);
  });

  // Last, as it moves anvil's clock on.
  test("in a new epoch, Join reads again before any review, and the page moves on by itself", async () => {
    await approveConduit(NEWCOMER, CONDUIT, 141n);
    const { page } = await connected({ owner: NEWCOMER }, { flowing: true });
    await account(page, 141).getByText("Joining Carbon Impact:").waitFor();
    await anvil("evm_setNextBlockTimestamp", [FLIP + 60]);
    await anvil("evm_mine");
    await page.clock.setSystemTime((FLIP + 60) * 1000);
    const joinStopped = group(page, "needs").getByRole("button", { name: "Join Carbon Impact" });
    await joinStopped.click();
    await group(page, "in:carbon-impact").locator("li").filter({ hasText: "#141" }).waitFor();
    await account(page, 141).getByText("Joining Carbon Impact:").waitFor({ state: "detached" });
    await nextEpoch(page, /Thu,? 29 Oct/);
    assert.equal(await review(page).isVisible(), false);
    await joinStopped.click();
    assert.match(await review(page).locator(".pages").innerText(), /Thu,? 29 Oct,? 00:00 UTC/);
    await page.keyboard.press("Escape");

    // anvil mines once it has answered what the page sent, such as the review's gas estimate.
    await Promise.allSettled(forwarding);
    await anvil("evm_setNextBlockTimestamp", [FLIP + WEEK + 60]);
    await anvil("evm_mine");
    await page.clock.setSystemTime((FLIP + WEEK + 60) * 1000);
    await page.clock.runFor(30_000);
    await nextEpoch(page, /Thu,? 5 Nov/);
    await page
      .locator("#epoch .countdown")
      .getByText(/^in 6 d 23 h$/)
      .waitFor();
  });
});
