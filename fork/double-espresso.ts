import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { encodeFunctionData, zeroAddress } from "viem";
import { DOUBLE_ESPRESSO, VOTING_ESCROW } from "../src/config.ts";
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
  doubleEspressoReceipts,
  settle,
  claimOne,
  expectApprovals,
  forwarding,
  open,
  connected,
  app,
  hydrex,
  hydrexTitle,
  account,
  group,
  only,
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
  UNVOTED,
  earnedLastEpoch,
} from "./harness.ts";

describe("the page against a fork of Base: a Safe, Double Espresso, and a new epoch", { timeout: 1_800_000 }, () => {
  before(startAtBlock);
  after(stop);
  hooks();

  test("closing the review before Base includes the transaction still updates the account", async () => {
    const { page } = await connected({ owner: NEWCOMER });
    await account(page, 141).getByText(UNVOTED).waitFor();
    await only(page, "needs:unvoted", 141);
    await group(page, "needs:unvoted").getByRole("button", { name: "Join Matcha Latte", exact: true }).click();
    await toWallet(page);
    await anvil("evm_setAutomine", [false]);
    try {
      await review(page).getByRole("button", { name: "Sign transaction" }).click();
      await review(page).getByText("Waiting for it to go through").waitFor();
      await review(page).getByRole("button", { name: "Close" }).click();
      await account(page, 141).getByText(UNVOTED).waitFor();
      // Mine only after the page has polled again: it polls every two seconds.
      await page.waitForTimeout(5_000);
      await anvil("evm_mine");
    } finally {
      await anvil("evm_setAutomine", [true]);
    }
    await account(page, 141).getByText("Joining Matcha Latte:").waitFor();
  });

  test("inside Safe{Wallet}, a Safe proposes leaving with two accounts as one Safe transaction", async () => {
    const { page, origins, violations } = await open(false, { url: `${SAFE_WALLET}/` });
    const frame = page.frameLocator("iframe");
    const dialog = frame.locator("#review");
    await frame.locator("header").getByText(short(LEAVER)).waitFor();
    assert.equal(await frame.getByRole("heading", { name: "Your wallet", level: 1, exact: true }).isVisible(), true);
    assert.equal(await frame.getByRole("heading", { name: "Vote, claim and swap on Base" }).isVisible(), false);
    await frame.getByRole("link", { name: "Hydrex", exact: true }).click();
    await frame.getByRole("checkbox", { name: "Pick Hydrex account #53350" }).check();
    await frame.getByRole("checkbox", { name: "Pick Hydrex account #82206" }).check();
    await frame
      .locator('.group[data-group="in:matcha-latte"] .picked')
      .getByText(/^2 of 2 · /)
      .waitFor();
    await frame
      .locator('.group[data-group="in:matcha-latte"]')
      .getByRole("button", { name: "Leave", exact: true })
      .click();
    await dialog.getByText(/^One Safe transaction, 2 calls$/).waitFor();
    // Co-signers compare each call's fields and calldata, shown in full, with Safe{Wallet}'s.
    const call = dialog.locator(".slip").first();
    assert.equal(await call.locator(".conduit").innerText(), CONDUIT, "co-signers see the address, not only its name");
    assert.equal(await call.locator(".conduit-name").innerText(), "KlimaVeTokenConduit");
    assert.equal(await call.locator(".call").innerText(), "100 bytes");
    assert.equal(await call.locator(".count").textContent(), "Safe · Call 1 of 2 · Leave Matcha Latte");
    assert.equal(await dialog.locator(".operation").first().isVisible(), false, "Safe{Wallet} sets the operation");
    await shoot(page, "safe-calls-1440-light");
    await dialog.getByRole("button", { name: "Propose in Safe{Wallet}" }).click();
    await dialog.getByText("Proposed.").waitFor();
    await dialog.getByRole("link", { name: "https://metadex.cafe/#hydrex/matcha-latte/check" }).waitFor();
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

  test("join Double Espresso, move between the two automations, and leave it", async () => {
    // The pages read these at the latest block, which anvil reads from FORK_URL a slot at a time.
    await warm(() =>
      Promise.all([
        earnedLastEpoch(CONDUIT),
        earnedLastEpoch(DOUBLE_ESPRESSO.address),
        readAccounts(NEWCOMER),
        readAccounts(LEAVER),
      ]),
    );
    const { page, sent } = await connected({ owner: NEWCOMER });
    await account(page, 141).getByText(UNVOTED).waitFor();
    await only(page, "needs:unvoted", 141);
    await group(page, "needs:unvoted").getByRole("button", { name: "Join Double Espresso", exact: true }).click();
    await review(page).getByText("Join Double Espresso · 1 of 2").waitFor();
    await review(page)
      .getByText("Unclaimed rewards on this Hydrex account will be paid to you with its next payout, less the 1% fee.")
      .waitFor();
    await review(page).getByRole("link", { name: "Immutable" }).waitFor();
    await review(page)
      .locator(".estimate-week")
      .getByText("No record yet", { exact: true })
      .waitFor({ timeout: 120_000 });
    assert.equal(await review(page).locator(".fee-facts").count(), 0, "the fee facts are on its page");
    await shoot(page, "double-espresso-join-1-1440-light");
    await review(page).getByRole("button", { name: "Continue" }).click();
    assert.deepEqual(await review(page).locator(".says").allTextContents(), ["Account #141 joins Double Espresso."]);
    assert.deepEqual(await review(page).locator(".conduit-name").allTextContents(), ["ImmutableVeTokenConduit"]);
    assert.equal(await review(page).locator(".conduit").textContent(), DOUBLE_ESPRESSO.address);
    await confirm(page);
    await expectApprovals([141n], DOUBLE_ESPRESSO.address, DOUBLE_ESPRESSO.address);
    await group(page, "in:double-espresso").getByText("Joining Double Espresso:").waitFor();
    assert.equal(sent.length, 1);

    // An account in Matcha Latte moves in one call, and back the same way. LEAVER's were never paid, so the page has
    // no receipt to price for them, which would keep anvil busy.
    const member = await connected({ owner: LEAVER });
    const own = member.page;
    await group(own, "in:matcha-latte").getByText("#53350").waitFor();
    await pick(own, 53350);
    await group(own, "in:matcha-latte").getByRole("button", { name: "Move to Double Espresso", exact: true }).click();
    await toWallet(own);
    assert.deepEqual(await review(own).locator(".says").allTextContents(), [
      "Account #53350 leaves Matcha Latte and joins Double Espresso.",
    ]);
    await confirm(own);
    await expectApprovals([53350n], DOUBLE_ESPRESSO.address, DOUBLE_ESPRESSO.address);
    await group(own, "in:double-espresso").getByText("Joining Double Espresso:").waitFor();
    await group(own, "in:double-espresso").getByRole("button", { name: "Move to Matcha Latte", exact: true }).click();
    await toWallet(own);
    assert.deepEqual(await review(own).locator(".says").allTextContents(), [
      "Account #53350 leaves Double Espresso and joins Matcha Latte.",
    ]);
    await confirm(own);
    await expectApprovals([53350n], CONDUIT, CONDUIT);
    await group(own, "in:matcha-latte").locator("li").filter({ hasText: "#53350" }).waitFor();
    assert.equal(await group(own, "in:double-espresso").isVisible(), false);

    // Leaving Double Espresso gives the votes back to the owner.
    await group(page, "in:double-espresso").getByRole("button", { name: "Leave" }).click();
    await review(page).getByRole("heading", { name: "Leave Double Espresso" }).waitFor();
    await review(page).locator(".pages").getByText("Claims stop").waitFor();
    await confirm(page);
    await expectApprovals([141n], NEWCOMER, zeroAddress);
    await account(page, 141).getByText(UNVOTED).waitFor();
    assert.deepEqual([...sent, ...member.sent].length, 4);
  });

  test("Double Espresso's receipts: anyone's claims, a stranger's dust, and where the page stops reading", async () => {
    // Its standing is read in the pools Matcha Latte voted for, last epoch and the one before, as test 7 reads them.
    const rewards = await doubleEspressoReceipts();
    const { page, violations } = await open(
      { owner: PAYEE },
      { width: 390, height: 844, url: `${SITE}/#hydrex/82774` },
    );
    const standing = position(page).locator(".standing");
    const receipt = standing.locator(".receipt");
    await receipt.waitFor({ timeout: 120_000 });
    await position(page).locator(".position-status").getByText("Joining Double Espresso:").waitFor();
    assert.equal(await receipt.locator(".label").first().textContent(), "Receipt · Account #82774 · Double Espresso");
    assert.match(await receipt.locator(".receipt-claimed").innerText(), /^(< )?[\d,.]+ USDC$/);
    assert.equal(await receipt.locator(".receipt-fee-share").innerText(), "1%");
    assert.match(await receipt.locator(".receipt-fee").innerText(), /^−[\d,.<\s]+ USDC$/);
    assert.match(await receipt.locator(".receipt-paid").innerText(), /^(< )?[\d,.]+ USDC$/);
    assert.deepEqual(await receipt.locator(".claim-by").allTextContents(), [
      "sent by 0x0000…dEaD",
      "sent by 0x0000…1234",
    ]);
    assert.equal(await receipt.locator(".receipt-stopped").isVisible(), false);
    // USDC counts as a dollar.
    await receipt
      .locator(".receipt-paid-worth")
      .getByText(/^(≈|<)\s\$/)
      .waitFor({ timeout: 120_000 });
    await shoot(page, "double-espresso-receipt-390-light", position(page));

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
    await warm(() =>
      Promise.all([earnedLastEpoch(CONDUIT), earnedLastEpoch(DOUBLE_ESPRESSO.address), readAccounts(NEWCOMER)]),
    );
    const { page, violations } = await connected({ owner: NEWCOMER }, { width: 390, height: 844 });
    await account(page, 141).getByText(UNVOTED).waitFor();
    const menu = hydrex(page).locator("#menu");
    assert.deepEqual(await menu.locator("h3").allInnerTexts(), ["Matcha Latte", "Double Espresso"]);
    // Double Espresso, deployed on the fork, has not voted there yet: as Matcha Latte would, it shows as running.
    await menu.locator(".double-espresso-state").getByText("Running").waitFor();
    assert.equal(await menu.locator(".double-espresso-voted-line").isVisible(), false);
    await menu
      .locator('[data-choice="matcha-latte"] .record')
      .getByText(/^≈\s\$\d+\.\d\d$/)
      .waitFor({ timeout: 120_000 });
    assert.equal(await menu.locator('[data-choice="double-espresso"] .record').innerText(), "No record yet");
    // Matcha Latte against the average, in words; none of the wallet's accounts is in it.
    await menu
      .locator('[data-choice="matcha-latte"] .record-versus')
      .getByText(/^(\d[\d.]*% (above|below) the average|About the average)$/)
      .waitFor({ timeout: 300_000 });
    assert.equal(await menu.locator('[data-choice="matcha-latte"] .yours-count').isVisible(), false);
    // Voting yourself: Hydrex's average, and the wallet's own votes, which did not vote last epoch.
    const self = hydrex(page).locator("#vote-yourself");
    await self
      .locator(".average")
      .getByText(/^≈\s\$\d+\.\d\d$/)
      .waitFor({ timeout: 300_000 });
    await self.locator(".yours-average").getByText("Didn't vote", { exact: true }).waitFor({ timeout: 120_000 });
    assert.equal(await self.locator(".yours-versus").innerText(), "", "no figure to compare");
    await shoot(page, "menu-390-light", menu);
    await menu.getByRole("link", { name: "Double Espresso" }).click();
    const maxi = product(page, "double-espresso");
    await maxi.getByRole("heading", { name: "Double Espresso", level: 1 }).waitFor();
    assert.equal(await page.title(), "Double Espresso · metaDEX Café");
    assert.equal(await maxi.locator(".record").innerText(), "No record yet");
    assert.equal(await maxi.locator(".record-unit").isVisible(), false);
    await shoot(page, "double-espresso-390-light");
    // #141 and #42877 can join it, so its button waits for a tick.
    assert.equal(await maxi.getByRole("button", { name: "Join Double Espresso", exact: true }).isDisabled(), true);
    await pick(page, 141);
    await maxi.getByRole("button", { name: "Join Double Espresso", exact: true }).click();
    await review(page).getByText("Join Double Espresso · 1 of 2").waitFor();
    await page.keyboard.press("Escape");
    // It says what it does, with no record to compare, and leads back to Hydrex, which leads back to the wallet.
    await maxi
      .locator(".lead")
      .getByText(/most rewards/)
      .waitFor();
    assert.equal(await maxi.locator(".facts .record-versus-line").isVisible(), false, "no record to compare");
    const back = maxi.getByRole("navigation", { name: "Back" });
    assert.deepEqual(await back.getByRole("link").allInnerTexts(), ["Hydrex"]);
    await back.getByRole("link", { name: "Hydrex" }).click();
    await hydrexTitle(page).waitFor();
    await hydrex(page).getByRole("navigation", { name: "Back" }).getByRole("link", { name: "Your wallet" }).click();
    await appTitle(page).waitFor();

    await page.goto(`${SITE}/#hydrex/matcha-latte`);
    const matcha = product(page, "matcha-latte");
    await matcha.getByRole("heading", { name: "Matcha Latte", level: 1 }).waitFor();
    await matcha
      .locator(".tonnes")
      .getByText(/^\d[\d,]* t$/)
      .waitFor();
    // Its popups start closed, its costs and contracts among them, and the address of one opens it.
    assert.equal(await page.locator(":popover-open").count(), 0);
    await shoot(page, "matcha-latte-390-light");
    await page.goto(`${SITE}/#hydrex/matcha-latte/fees`);
    const info = matcha.locator(".pop:popover-open");
    const costs = info.locator(".fee-facts dd");
    await costs.first().getByText("Up to 33.33% of each payout").waitFor();
    assert.deepEqual(await costs.allInnerTexts(), ["Up to 33.33% of each payout", "0%", "Part of the payout"]);
    // Who can change what, with the most the fee can become, as read; then where the fee goes, short, in full on hover.
    await info.locator('[data-section="control"]').getByText("the payout fee (up to 1%)").waitFor();
    const recipient = "0xd9e966a6Bfa2aE2113a34Bb4dd02ded921DA50aF";
    const recipientLink = info.locator("a.fee-recipient");
    assert.equal(await recipientLink.innerText(), "0xd9e9…50aF");
    assert.equal(await recipientLink.getAttribute("href"), `https://basescan.org/address/${recipient}`);
    assert.equal(await recipientLink.getAttribute("title"), recipient);
    // Its contracts, as co-signers' links lead to them.
    await page.goto(`${SITE}/#hydrex/matcha-latte/check`);
    await matcha.locator('.pop:popover-open [data-section="check"]').getByText("Fee recipient").waitFor();

    // An account's page: the wallet's own has its actions; another's names its owner.
    await page.goto(`${SITE}/#hydrex/141`);
    await position(page).getByRole("heading", { name: "Account #141", level: 1 }).waitFor();
    await position(page).getByText(UNVOTED).waitFor();
    await position(page).getByRole("button", { name: "Join Double Espresso", exact: true }).waitFor();
    await position(page)
      .getByRole("link", { name: /Vote on Hydrex/ })
      .waitFor();
    await position(page)
      .locator(".position-gas")
      .getByText(/^A change costs (≈|<)\s\$[\d.]+ in gas\.$/)
      .waitFor({ timeout: 60_000 });
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
    await account(page, 141).getByText("Joining Matcha Latte:").waitFor();
    await anvil("evm_setNextBlockTimestamp", [FLIP + 60]);
    await anvil("evm_mine");
    await page.clock.setSystemTime((FLIP + 60) * 1000);
    const joinStopped = group(page, "needs:stopped").getByRole("button", { name: "Join Matcha Latte" });
    await joinStopped.click();
    await group(page, "in:matcha-latte").locator("li").filter({ hasText: "#141" }).waitFor();
    await account(page, 141).getByText("Joining Matcha Latte:").waitFor({ state: "detached" });
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
