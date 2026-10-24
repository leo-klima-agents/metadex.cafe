import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { encodeFunctionData, toFunctionSelector, zeroAddress } from "viem";
import { VOTING_ESCROW } from "../src/config.ts";
import { readEarnings } from "../src/earnings.ts";
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
} from "./harness.ts";

describe("the page against a fork of Base: joining and leaving, and what can fail", { timeout: 1_800_000 }, () => {
  before(startAtBlock);
  after(stop);
  hooks();

  test("join with two accounts from automations that stopped, one transaction at a time", async () => {
    // The review's estimate needs last epoch's figures.
    await warm(() => readEarnings(CONDUIT));
    const { page, sent, asked, origins, violations } = await open({ owner: ELSEWHERE }, { url: `${SITE}/#hydrex` });
    await hydrex(page).locator("time.impact-voted").getByText(/Wed/).waitFor();
    assert.deepEqual(asked, [], "the page asks a wallet nothing until it is picked");
    // The one wallet in the browser connects from the header's button at once: the page has no list of wallets.
    assert.equal(await hydrex(page).getByRole("button", { name: "Test Wallet" }).count(), 0);
    await connectButton(page).click();
    await chip(page, ELSEWHERE).waitFor();
    await account(page, 2439)
      .getByText(/In USDC\s+· stopped since\s+Wed,? 9 Sept?/)
      .waitFor();
    const needs = group(page, "needs");
    await needs.getByRole("heading", { name: "Needs you · 2" }).waitFor();
    assert.equal(await needs.getByRole("button", { name: "Join Carbon Impact" }).isDisabled(), true);
    await pick(page, 2435, 2439);
    await shoot(page, "picked-1440-light");
    await needs.getByRole("button", { name: "Join Carbon Impact with 2 Hydrex accounts" }).click();
    await review(page).getByText("Join Carbon Impact · 1 of 2").waitFor();
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
    await review(page).getByRole("heading", { name: "What your wallet will ask" }).waitFor();
    await review(page).locator(".how").getByText("2 transactions", { exact: true }).waitFor();
    assert.deepEqual(await review(page).locator(".says").allTextContents(), [
      "Account #2439 leaves the USDC automation and joins Carbon Impact.",
      "Account #2435 leaves the Hydrex Lock Maxi automation and joins Carbon Impact.",
    ]);
    assert.deepEqual(await review(page).locator(".conduit-name").allTextContents(), ["Carbon Impact", "Carbon Impact"]);
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
    assert.equal(await review(page).locator(".count").first().textContent(), "Call 1 of 2");
    assert.equal(await review(page).locator(".data").first().isVisible(), false, "the wallet shows the call's fields");
    await shoot(page, "join-2-1440-light");
    await review(page).getByRole("button", { name: "Confirm transaction 1 of 2" }).click();
    await review(page).getByText("Transaction 1 of 2 is included.").waitFor();
    await review(page).getByRole("button", { name: "Confirm transaction 2 of 2" }).click();
    await review(page).getByText("Done.").waitFor();
    await review(page).getByText("Joined.").waitFor();
    await review(page).getByRole("button", { name: "Close" }).click();
    assert.equal(sent.length, 2);
    await expectApprovals([2435n, 2439n], CONDUIT, CONDUIT);
    // Lock Maxi's ERC-5725 claim approval stays, but the VotingEscrow does not use it for claims.
    assert.equal(await view(VOTING_ESCROW, "getClaimApproved", [2435n]), LOCK_MAXI);
    const joined = /Joining Carbon Impact:\s+votes from\s+Thu,? 22 Oct/;
    await group(page, "in:carbon-impact").locator("li").filter({ hasText: "#2439" }).getByText(joined).waitFor();
    await account(page, 2435).getByText(joined).waitFor();
    assert.equal(await group(page, "needs").isVisible(), false);
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
    await account(page, 141).getByText("You vote with it").waitFor();
    await account(page, 42877)
      .getByText(/In Liquid Hydrex\s+· stopped since\s+Wed,? 9 Sept?/)
      .waitFor();
    const nothing = group(page, "closed");
    await nothing.locator("summary").click();
    await nothing.locator("li").getByText("Empty", { exact: true }).first().waitFor();
    assert.equal(await nothing.locator(".pick").first().isVisible(), false, "an empty account has no box");
    assert.equal(await account(page, 141).locator(".pick").isVisible(), false, "a group of one has no box");
    // With a wallet connected, the name in the header still leads Home, which stays apart from the App; the wallet's
    // chip leads to the App.
    await page.getByRole("link", { name: "metaDEX Café" }).click();
    await homeTitle(page).waitFor();
    assert.equal(await appTitle(page).isVisible(), false);
    await chip(page, NEWCOMER).waitFor();
    await page
      .locator("header")
      .getByRole("link", { name: /Your Wallet, connected as 0x0208…4C95/ })
      .click();
    await appTitle(page).waitFor();
    assert.equal(await homeTitle(page).isVisible(), false);
    await toHydrex(page);
    assert.equal(await page.getByRole("button", { name: /AutoMaxi/ }).count(), 0, "AutoMaxi is not on Base yet");
    assert.equal(await page.locator('[data-needs="automaxi"]:not([hidden])').count(), 0);
    await group(page, "other").getByRole("button", { name: "Join Carbon Impact", exact: true }).click();
    await toWallet(page);
    assert.equal(await review(page).locator(".how").isVisible(), false, "one transaction needs no line");
    assert.deepEqual(await review(page).locator(".says").allTextContents(), ["Account #141 joins Carbon Impact."]);
    await confirm(page);
    assert.equal(sent.length, 1);
    await expectApprovals([141n], CONDUIT, CONDUIT);
    await account(page, 141).getByText("Joining Carbon Impact:").waitFor();
    // AutoMaxi's page, before it is on Base, says so, and marks none of its checks failed.
    await page.goto(`${SITE}/#hydrex/automaxi/check`);
    const maxi = product(page, "automaxi");
    await maxi.locator(".automaxi-absent").waitFor();
    assert.equal(await maxi.locator(".check-failed").count(), 0);
    assert.equal(await maxi.locator(".record").innerText(), "No record yet");
    assert.equal(await maxi.locator('[data-section="record"] .record-waiting').textContent(), "Not on Base yet.");
  });

  test("closing between transactions stops there; a link then opens in a new tab", async () => {
    const { page, sent } = await connected({ owner: ELSEWHERE });
    await pick(page, 2435, 2439);
    await page.getByRole("button", { name: "Join Carbon Impact with 2 Hydrex accounts" }).click();
    await toWallet(page);
    await review(page).getByRole("button", { name: "Confirm transaction 1 of 2" }).click();
    await review(page).getByText("closing stops here").waitFor();
    const [tab] = await Promise.all([
      page.context().waitForEvent("page"),
      review(page).getByRole("link", { name: "How to check" }).first().click(),
    ]);
    await tab.waitForURL(`${SITE}/#hydrex/carbon-impact/check`);
    await review(page).getByRole("button", { name: "Confirm transaction 2 of 2" }).waitFor();
    await review(page).getByRole("button", { name: "Close" }).click();
    await account(page, 2439).getByText("Joining Carbon Impact:").waitFor();
    await account(page, 2435)
      .getByText(/In Hydrex Lock Maxi\s+· stopped/)
      .waitFor();
    assert.equal(sent.length, 1);
    await expectApprovals([2435n], LOCK_MAXI, LOCK_MAXI);
  });

  test("leave with one account", async () => {
    const { page, sent } = await connected({ owner: MEMBER }, { width: 390, height: 844, dark: true });
    await group(page, "in:carbon-impact").getByText("#9540").waitFor();
    assert.equal(await account(page, 9540).locator(".status-line").count(), 0, "its group says it is in");
    await account(page, 14485).getByText("You vote with it").waitFor();
    await shoot(page, "member-390-dark");
    await group(page, "in:carbon-impact").getByRole("button", { name: "Leave" }).click();
    await review(page).getByRole("heading", { name: "Leave Carbon Impact" }).waitFor();
    assert.equal(await review(page).locator(".how").isVisible(), false, "one transaction needs no line");
    assert.equal(await review(page).locator(".step-count").isVisible(), false, "one step");
    assert.match(await review(page).locator(".pages").innerText(), /Claims stop\s+Now\s+Votes return\s+Thu,? 22 Oct/i);
    await shoot(page, "leave-390-dark");
    await confirm(page);
    await expectApprovals([9540n], MEMBER, zeroAddress);
    await group(page, "other")
      .locator("li")
      .filter({ hasText: "#9540" })
      .getByText(/Leaving Carbon Impact:\s+your votes from\s+Thu,? 22 Oct/)
      .waitFor();
    assert.equal(sent.length, 1);
  });

  test("leave an automation that stopped, to vote yourself", async () => {
    const { page, sent } = await connected({ owner: ELSEWHERE }, { width: 390, height: 844 });
    await account(page, 2439)
      .getByText(/In USDC\s+· stopped/)
      .waitFor();
    await shoot(page, "stopped-390-light");
    await pick(page, 2439);
    await group(page, "needs").getByRole("button", { name: "Leave with 1 Hydrex account" }).click();
    await review(page).getByRole("heading", { name: "Leave USDC" }).waitFor();
    await review(page).locator(".pages").getByText("Claims stop").waitFor();
    assert.deepEqual(await review(page).locator(".says").allTextContents(), [
      "Account #2439 leaves the USDC automation.",
    ]);
    assert.deepEqual(await review(page).locator(".conduit-name").allTextContents(), ["The USDC automation"]);
    assert.equal(await review(page).locator(".conduit").innerText(), USDC);
    assert.equal(await review(page).locator(".approve").innerText(), "false");
    assert.equal(await review(page).locator(".count").textContent(), "Call", "one call has no count");
    await shoot(page, "release-390-light");
    await confirm(page);
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
    const joinOwn = group(page, "other").getByRole("button", { name: "Join Carbon Impact", exact: true });
    await joinOwn.click();
    await toWallet(page);
    await review(page).getByRole("button", { name: "Switch to Base" }).click();
    await review(page).getByRole("button", { name: "Confirm in your wallet" }).click();
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
    await review(page).getByRole("button", { name: "Confirm in your wallet" }).click();
    await review(page).getByText("A transaction failed on Base.").waitFor();
    assert.equal(await review(page).locator(".confirm").isVisible(), false);
    assert.equal(sent.length, 2);
  });

  test("Back while the wallet asks closes the review, which still follows what it sent", async () => {
    let answer = () => {};
    const sending = new Promise<void>((resolve) => (answer = resolve));
    const { page, sent } = await connected({ owner: NEWCOMER, sending });
    await group(page, "other").getByRole("button", { name: "Join Carbon Impact", exact: true }).click();
    await toWallet(page);
    await review(page).getByRole("button", { name: "Confirm in your wallet" }).click();
    await review(page).getByText("Waiting for your wallet…").waitFor();
    await review(page).getByRole("button", { name: "Back" }).click();
    assert.equal(await review(page).isVisible(), false);
    answer();
    await account(page, 141).getByText("Joining Carbon Impact:").waitFor();
    assert.equal(sent.length, 1);
    await expectApprovals([141n], CONDUIT, CONDUIT);
  });

  test("when the automation cannot be read, leaving does not wait, the page reads again, and Try again keeps the view", async () => {
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
    await group(page, "in:carbon-impact").getByText("#9540").waitFor();
    await group(page, "in:carbon-impact").getByRole("button", { name: "Leave" }).click();
    await review(page).getByRole("heading", { name: "Leave Carbon Impact" }).waitFor();
    await page.keyboard.press("Escape");
    assert.equal(await page.locator("#epoch .countdown").innerText(), "soon");
    opened.rpc.refuse = undefined;
    await page.clock.runFor(30_000);
    await page
      .locator("#epoch .countdown")
      .getByText(/^in \d/)
      .waitFor();
    await page.getByRole("button", { name: "Try again" }).click();
    await connectButton(page).waitFor();
    await hydrexTitle(page).waitFor();
    assert.equal(new URL(page.url()).hash, "#hydrex");
  });

  test("a wallet that cannot switch to Base says so", async () => {
    const { page } = await connected({ owner: NEWCOMER, chainId: 1, switches: false });
    await hydrex(page).locator(".wrong-chain").getByRole("button", { name: "Switch to Base" }).click();
    await hydrex(page).getByText("Switch in your wallet.").waitFor();
  });
});
