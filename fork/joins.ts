import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { encodeFunctionData, toFunctionSelector, zeroAddress } from "viem";
import { VOTING_ESCROW } from "../src/config.ts";
import {
  CONDUIT,
  SITE,
  RPC_ORIGINS,
  MEMBER,
  NEWCOMER,
  ELSEWHERE,
  LOCK_MAXI,
  USDC,
  RECIPIENT,
  abi,
  anvil,
  send,
  view,
  warm,
  expectApprovals,
  open,
  connected,
  hydrex,
  account,
  group,
  only,
  product,
  review,
  homeTitle,
  appTitle,
  hydrexTitle,
  toHydrex,
  chip,
  toWallet,
  connectButton,
  pick,
  shoot,
  confirm,
  stop,
  hooks,
  startAtBlock,
  UNVOTED,
  earnedLastEpoch,
} from "./harness.ts";

describe("the page against a fork of Base: joining and leaving, and what can fail", { timeout: 1_800_000 }, () => {
  before(startAtBlock);
  after(stop);
  hooks();

  test("join with two accounts from automations that stopped, one transaction at a time", async () => {
    // The review's estimate needs last epoch's figures.
    await warm(() => earnedLastEpoch(CONDUIT));
    const { page, sent, asked, origins, violations } = await open({ owner: ELSEWHERE }, { url: `${SITE}/#hydrex` });
    await hydrex(page).locator("time.matcha-latte-voted").getByText(/Wed/).waitFor();
    assert.deepEqual(asked, [], "the page asks a wallet nothing until it is picked");
    // The one wallet in the browser connects from the header's button at once; the Hydrex accounts list it too.
    await hydrex(page).locator(".wallets").getByRole("button", { name: "Test Wallet" }).waitFor();
    await connectButton(page).click();
    await chip(page, ELSEWHERE).waitFor();
    await account(page, 2439)
      .getByText(/In USDC\s+· stopped since\s+Wed,? 9 Sept?/)
      .waitFor();
    // Both are in automations that stopped: one group, whose buttons are the remedy of each.
    await hydrex(page).getByRole("heading", { name: "In a stopped automation · 2" }).waitFor();
    const needs = group(page, "needs:stopped");
    assert.equal(await needs.locator(".count").innerText(), "· 2");
    // What needs you starts ticked, with what it adds up to.
    assert.equal(await page.getByRole("checkbox", { name: "Pick Hydrex account #2439" }).isChecked(), true);
    await needs
      .locator(".picked")
      .getByText(/^2 of 2 · [\d,]+ votes$/)
      .waitFor();
    await needs.getByRole("checkbox", { name: "All" }).uncheck();
    assert.equal(await needs.getByRole("button", { name: "Join Matcha Latte" }).isDisabled(), true);
    await pick(page, 2435, 2439);
    await shoot(page, "picked-1440-light");
    await needs.getByRole("button", { name: "Join Matcha Latte", exact: true }).click();
    await review(page).getByText("Join Matcha Latte · 1 of 2").waitFor();
    assert.match(await review(page).locator(".pages").innerText(), /Votes from\s+Thu,? 22 Oct,? 00:00 UTC/i);
    await review(page)
      .locator(".estimate-gas")
      .getByText(/^(≈|<)\s\$[\d.]+$/)
      .waitFor({ timeout: 60_000 });
    await review(page)
      .locator(".estimate-week")
      .getByText(/^(≈|<)\s\$[\d.]+$/)
      .waitFor({ timeout: 120_000 });
    await shoot(page, "join-1-1440-light");
    await review(page).getByRole("button", { name: "Continue" }).click();
    await review(page).getByRole("heading", { name: "Transactions", exact: true }).waitFor();
    assert.equal(await review(page).locator(".how").textContent(), "");
    assert.deepEqual(await review(page).locator(".says").allTextContents(), [
      "Account #2439 leaves the USDC automation and joins Matcha Latte.",
      "Account #2435 leaves the Hydrex Lock Maxi automation and joins Matcha Latte.",
    ]);
    assert.deepEqual(await review(page).locator(".conduit-name").allTextContents(), [
      "KlimaVeTokenConduit",
      "KlimaVeTokenConduit",
    ]);
    assert.deepEqual(await review(page).locator(".account").allTextContents(), ["2439", "2435"]);
    assert.deepEqual(await review(page).locator(".approve").allTextContents(), ["true", "true"]);
    // Each call is a bill, its fields in full under what it does, with nothing to open.
    assert.equal(await review(page).locator(".slip .info").count(), 0);
    assert.deepEqual(await review(page).locator(".slip .receipt-name").allTextContents(), [
      "metaDEX Café",
      "metaDEX Café",
    ]);
    // Shown in groups of four, an address still reads and copies as one.
    assert.equal(await review(page).locator(".conduit").first().innerText(), CONDUIT);
    assert.equal(await review(page).locator(".to").first().innerText(), VOTING_ESCROW);
    assert.equal(await review(page).locator(".count").first().textContent(), "Transaction 1 of 2 · Join Matcha Latte");
    assert.equal(await review(page).locator(".data").first().isVisible(), false, "the wallet shows the call's fields");
    await shoot(page, "join-2-1440-light");
    await review(page).getByRole("button", { name: "Sign transaction 1 of 2" }).click();
    await review(page).getByText("Transaction 1 of 2 went through.").waitFor();
    await review(page).getByRole("button", { name: "Sign transaction 2 of 2" }).click();
    await review(page).getByRole("heading", { name: "Done" }).waitFor();
    await review(page).getByText("Joined.").waitFor();
    await review(page).getByRole("button", { name: "Close" }).click();
    assert.equal(sent.length, 2);
    await expectApprovals([2435n, 2439n], CONDUIT, CONDUIT);
    // Lock Maxi's ERC-5725 claim approval stays, but the VotingEscrow does not use it for claims.
    assert.equal(await view(VOTING_ESCROW, "getClaimApproved", [2435n]), LOCK_MAXI);
    const joined = /Joining Matcha Latte:\s+votes from\s+Thu,? 22 Oct/;
    await group(page, "in:matcha-latte").locator("li").filter({ hasText: "#2439" }).getByText(joined).waitFor();
    await account(page, 2435).getByText(joined).waitFor();
    assert.equal(await hydrex(page).locator('.group[data-group^="needs:"]:not([hidden])').count(), 0, "none needs you");
    assert.deepEqual([...new Set(asked)].sort(), [
      "eth_chainId",
      "eth_requestAccounts",
      "eth_sendTransaction",
      "wallet_getCapabilities",
    ]);
    assert.deepEqual([...origins].sort(), [SITE, ...RPC_ORIGINS].filter((o) => origins.has(o)).sort());
    assert.ok(origins.has(SITE));
    assert.deepEqual(violations, []);
  });

  test("join with an account of its own; the header shows the wallet on every view", async () => {
    const { page, sent } = await connected({ owner: NEWCOMER });
    // Its owner last voted before last epoch: it earns nothing, and needs them.
    await group(page, "needs:unvoted").locator("li").filter({ hasText: "#141" }).getByText(UNVOTED).waitFor();
    await account(page, 42877)
      .getByText(/In Liquid Hydrex\s+· stopped since\s+Wed,? 9 Sept?/)
      .waitFor();
    const nothing = group(page, "closed");
    await nothing.locator("summary").click();
    await nothing.locator("li").getByText("Empty", { exact: true }).first().waitFor();
    assert.equal(await nothing.locator(".pick").first().isVisible(), false, "an empty account has no box");
    // #42877, in an automation that stopped, needs another remedy, in a group of its own: alone in its group, #141
    // needs no box.
    await group(page, "needs:stopped").locator("li").filter({ hasText: "#42877" }).waitFor();
    assert.equal(await account(page, 141).locator(".pick").isVisible(), false);
    await group(page, "needs:unvoted")
      .getByRole("link", { name: /Vote on Hydrex/ })
      .waitFor();
    assert.equal(
      await group(page, "needs:stopped")
        .getByRole("link", { name: /Vote on Hydrex/ })
        .count(),
      0,
    );
    // With a wallet connected, the name in the header still leads Home, which stays apart from the App; the wallet's
    // chip leads to the App.
    await page.getByRole("link", { name: "metaDEX Café" }).click();
    await homeTitle(page).waitFor();
    assert.equal(await appTitle(page).isVisible(), false);
    await chip(page, NEWCOMER).waitFor();
    await page
      .locator("header")
      .getByRole("link", { name: /Your wallet, connected as 0x0208…4C95/ })
      .click();
    await appTitle(page).waitFor();
    assert.equal(await homeTitle(page).isVisible(), false);
    await toHydrex(page);
    await only(page, "needs:unvoted", 141);
    await group(page, "needs:unvoted").getByRole("button", { name: "Join Matcha Latte", exact: true }).click();
    await toWallet(page);
    assert.equal(await review(page).locator(".how").isVisible(), false, "one transaction needs no line");
    assert.deepEqual(await review(page).locator(".says").allTextContents(), ["Account #141 joins Matcha Latte."]);
    await confirm(page);
    assert.equal(sent.length, 1);
    await expectApprovals([141n], CONDUIT, CONDUIT);
    await account(page, 141).getByText("Joining Matcha Latte:").waitFor();
    // Double Espresso's page, before it ever voted, has no record, and joining it is on.
    await page.goto(`${SITE}/#hydrex/double-espresso/check`);
    const maxi = product(page, "double-espresso");
    await maxi.locator(".record").getByText("No record yet").waitFor();
    assert.equal(await maxi.locator(".checks-failed").isVisible(), false);
  });

  test("closing between transactions stops there; a link then opens in a new tab", async () => {
    const { page, sent } = await connected({ owner: ELSEWHERE });
    await pick(page, 2435, 2439);
    await group(page, "needs:stopped").getByRole("button", { name: "Join Matcha Latte", exact: true }).click();
    await toWallet(page);
    await review(page).getByRole("button", { name: "Sign transaction 1 of 2" }).click();
    await review(page).getByText("Sign transaction 2 when you are ready.").waitFor();
    // The first page's link to what Matcha Latte can change, which its page no longer shows.
    const [tab] = await Promise.all([
      page.context().waitForEvent("page"),
      review(page).locator('a[href="#hydrex/matcha-latte/control"]').dispatchEvent("click"),
    ]);
    await tab.waitForURL(`${SITE}/#hydrex/matcha-latte/control`);
    await review(page).getByRole("button", { name: "Sign transaction 2 of 2" }).waitFor();
    await review(page).getByRole("button", { name: "Close" }).click();
    await account(page, 2439).getByText("Joining Matcha Latte:").waitFor();
    await account(page, 2435)
      .getByText(/In Hydrex Lock Maxi\s+· stopped/)
      .waitFor();
    assert.equal(sent.length, 1);
    await expectApprovals([2435n], LOCK_MAXI, LOCK_MAXI);
  });

  test("leave with one account", async () => {
    const { page, sent } = await connected({ owner: MEMBER }, { width: 390, height: 844, dark: true });
    await group(page, "in:matcha-latte").getByText("#9540").waitFor();
    assert.equal(await account(page, 9540).locator(".status-line").count(), 0, "its group says it is in");
    await account(page, 14485).getByText(UNVOTED).waitFor();
    await shoot(page, "member-390-dark");
    await group(page, "in:matcha-latte").getByRole("button", { name: "Leave" }).click();
    await review(page).getByRole("heading", { name: "Leave Matcha Latte" }).waitFor();
    assert.equal(await review(page).locator(".how").isVisible(), false, "one transaction needs no line");
    assert.equal(await review(page).locator(".step-count").isVisible(), false, "one step");
    assert.match(await review(page).locator(".pages").innerText(), /Claims stop\s+Now\s+Votes return\s+Thu,? 22 Oct/i);
    await shoot(page, "leave-390-dark");
    await confirm(page);
    await expectApprovals([9540n], MEMBER, zeroAddress);
    await group(page, "other")
      .locator("li")
      .filter({ hasText: "#9540" })
      .getByText(/Leaving Matcha Latte:\s+your votes from\s+Thu,? 22 Oct/)
      .waitFor();
    assert.equal(sent.length, 1);
  });

  test("leave an automation that stopped, to vote yourself", async () => {
    const { page, sent } = await connected({ owner: ELSEWHERE }, { width: 390, height: 844 });
    await account(page, 2439)
      .getByText(/In USDC\s+· stopped/)
      .waitFor();
    await shoot(page, "stopped-390-light");
    await only(page, "needs:stopped", 2439);
    await group(page, "needs:stopped").getByRole("button", { name: "Leave automation", exact: true }).click();
    await review(page).getByRole("heading", { name: "Leave USDC" }).waitFor();
    await review(page).locator(".pages").getByText("Claims stop").waitFor();
    assert.deepEqual(await review(page).locator(".says").allTextContents(), [
      "Account #2439 leaves the USDC automation.",
    ]);
    assert.deepEqual(await review(page).locator(".conduit-name").allTextContents(), ["The USDC automation"]);
    assert.equal(await review(page).locator(".conduit").innerText(), USDC);
    assert.equal(await review(page).locator(".approve").innerText(), "false");
    assert.equal(
      await review(page).locator(".count").textContent(),
      "Transaction · Leave the USDC automation",
      "one transaction has no count",
    );
    await shoot(page, "release-390-light");
    // Once left, the review says its votes are the owner's from the next epoch, to vote with on Hydrex.
    await review(page).getByRole("button", { name: "Sign transaction" }).click();
    await review(page).getByText("its votes are yours", { exact: false }).waitFor({ timeout: 120_000 });
    await review(page)
      .getByRole("link", { name: /Vote on Hydrex/ })
      .waitFor();
    await review(page).getByRole("button", { name: "Close" }).click();
    assert.equal(sent.length, 1);
    await expectApprovals([2439n], ELSEWHERE, zeroAddress);
    await group(page, "other")
      .getByText(/Left USDC:\s+your votes from\s+Thu,? 22 Oct/)
      .waitFor();
    await account(page, 2435)
      .getByText(/In Hydrex Lock Maxi\s+· stopped/)
      .waitFor();
  });

  test("the wrong network, a refusal in the wallet, and a transaction that fails", async () => {
    const { page, wallet, sent } = await connected({ owner: NEWCOMER, chainId: 1, decline: true });
    await hydrex(page).getByText("Wrong network.").waitFor();
    await account(page, 141).getByText(UNVOTED).waitFor();
    await only(page, "needs:unvoted", 141);
    const joinOwn = group(page, "needs:unvoted").getByRole("button", { name: "Join Matcha Latte", exact: true });
    await joinOwn.click();
    await toWallet(page);
    await review(page).getByRole("button", { name: "Switch to Base" }).click();
    await review(page).getByRole("button", { name: "Sign transaction" }).click();
    await review(page).getByText("You said no in your wallet.").waitFor();
    assert.equal(sent.length, 1);
    await expectApprovals([141n], NEWCOMER, zeroAddress);
    await page.keyboard.press("Escape");
    assert.equal(await review(page).isVisible(), false);
    assert.equal(await hydrex(page).getByText("Wrong network.").isVisible(), false);

    const data = encodeFunctionData({ abi, functionName: "transferFrom", args: [NEWCOMER, RECIPIENT, 141n] });
    await send({ from: NEWCOMER, to: VOTING_ESCROW, data });
    wallet.decline = false;
    await joinOwn.click();
    await toWallet(page);
    await review(page).getByRole("button", { name: "Sign transaction" }).click();
    await review(page).getByText("A transaction failed on Base.").waitFor();
    assert.equal(await review(page).locator(".confirm").isVisible(), false);
    assert.equal(sent.length, 2);
  });

  test("Back while the wallet asks closes the review, which still follows what it sent", async () => {
    let answer = () => {};
    const sending = new Promise<void>((resolve) => (answer = resolve));
    const { page, sent } = await connected({ owner: NEWCOMER, sending });
    await account(page, 141).getByText(UNVOTED).waitFor();
    await only(page, "needs:unvoted", 141);
    await group(page, "needs:unvoted").getByRole("button", { name: "Join Matcha Latte", exact: true }).click();
    await toWallet(page);
    await review(page).getByRole("button", { name: "Sign transaction" }).click();
    await review(page).getByText("Waiting for your wallet…").waitFor();
    await review(page).getByRole("button", { name: "Back" }).click();
    assert.equal(await review(page).isVisible(), false);
    answer();
    await account(page, 141).getByText("Joining Matcha Latte:").waitFor();
    assert.equal(sent.length, 1);
    await expectApprovals([141n], CONDUIT, CONDUIT);
  });

  test("when the automation cannot be read, leaving does not wait, Try again keeps the view, and the page reads again", async () => {
    const tonnes = toFunctionSelector("function totalTonnesRetired()").slice(2);
    const opened = await open(
      { owner: MEMBER },
      { width: 390, height: 844, url: `${SITE}/#app`, flowing: true, refuse: (body) => body.includes(tonnes) },
    );
    const { page } = opened;
    await page.locator("#error").getByText("Reading Base failed.").waitFor();
    await shoot(page, "error-390-light");
    await page.getByRole("button", { name: "Test Wallet" }).click();
    await toHydrex(page);
    await group(page, "in:matcha-latte").getByText("#9540").waitFor();
    await group(page, "in:matcha-latte").getByRole("button", { name: "Leave" }).click();
    await review(page).getByRole("heading", { name: "Leave Matcha Latte" }).waitFor();
    await page.keyboard.press("Escape");
    // Without the block's time, the epoch's end is only Thursday's, with no countdown.
    assert.equal(await page.locator("#epoch .countdown-line").isVisible(), false);
    await page.getByRole("button", { name: "Try again" }).click();
    await connectButton(page).waitFor();
    await hydrexTitle(page).waitFor();
    assert.equal(new URL(page.url()).hash, "#hydrex");
    await page.locator("#error").getByText("Reading Base failed.").waitFor();
    // Once Base answers, the page reads it again by itself, and no longer says that reading it failed.
    await connectButton(page).click();
    await group(page, "in:matcha-latte").getByText("#9540").waitFor();
    opened.rpc.refuse = undefined;
    await page.clock.runFor(30_000);
    await page
      .locator("#epoch .countdown")
      .getByText(/^in \d/)
      .waitFor();
    await page.locator("#error").waitFor({ state: "hidden" });
  });

  test("a wallet that cannot switch to Base says so", async () => {
    const { page } = await connected({ owner: NEWCOMER, chainId: 1, switches: false });
    await hydrex(page).locator(".wrong-chain").getByRole("button", { name: "Switch to Base" }).click();
    await hydrex(page).getByText("Switch in your wallet.").waitFor();
  });
});
