import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { encodeFunctionData, zeroAddress } from "viem";
import { DOUBLE_ESPRESSO, VOTING_ESCROW } from "../src/config.ts";
import { short } from "../src/format.ts";
import * as h from "./harness.ts";
import {
  BLOCK,
  CONDUIT,
  ELSEWHERE,
  LEAVER,
  LOCK_MAXI,
  MEMBER,
  NEWCOMER,
  SITE,
  connected,
  expectApprovals,
  group,
  heading,
  review,
  row,
} from "./harness.ts";

const UNVOTED = /Not voted since/;
const says = (page: h.Opened["page"]) => review(page).locator("[data-text=says]").allTextContents();

describe("joining and leaving against a fork of Base", { timeout: 1_800_000 }, () => {
  h.fork(BLOCK, [MEMBER, NEWCOMER, ELSEWHERE, LEAVER], h.deployDoubleEspresso);

  test("join Matcha Latte with two accounts from stopped automations, one transaction at a time", async () => {
    const { page, sent, asked, violations } = await connected({ owner: ELSEWHERE });
    const needs = group(page, "needs:stopped");
    await heading(page, "In a stopped automation 2", 3)
      .or(needs.getByRole("heading", { name: /In a stopped automation/ }))
      .first()
      .waitFor();
    await row(page, 2439)
      .getByText(/In USDC · stopped since Wed,? 9 Sept?/)
      .waitFor();
    await needs.getByText(/^2 of 2 · [\d,]+ votes$/).waitFor();
    assert.equal(
      await page.getByRole("checkbox", { name: "Pick Hydrex account #2439" }).isChecked(),
      true,
      "what needs its owner starts ticked",
    );
    await needs.getByRole("checkbox", { name: "All" }).uncheck();
    await needs.getByRole("button", { name: "Join Matcha Latte", disabled: true }).waitFor();
    await h.pick(page, 2435, 2439);
    await needs.getByRole("button", { name: "Join Matcha Latte" }).click();
    await review(page).getByText("Join Matcha Latte · 1 of 2").waitFor();
    assert.match(await review(page).innerText(), /Votes from\s+Thu,? 22 Oct,? 00:00 UTC/i);
    await review(page)
      .getByText(/^(≈|<)\s\$[\d.]+$/)
      .first()
      .waitFor();
    await h.toCalls(page);
    assert.deepEqual(await says(page), [
      "Account #2439 leaves the USDC automation and joins Matcha Latte.",
      "Account #2435 leaves the Hydrex Lock Maxi automation and joins Matcha Latte.",
    ]);
    const slip = review(page).locator("[data-list=slip] > li").first();
    assert.equal(await slip.locator("[data-text=count]").textContent(), "Transaction 1 of 2 · Join Matcha Latte");
    assert.equal((await h.field(slip, "To").innerText()).replace(/\s/g, ""), VOTING_ESCROW);
    assert.match(await slip.innerText(), /KlimaVeTokenConduit/);
    await review(page).getByRole("button", { name: "Sign transaction 1 of 2" }).click();
    await review(page)
      .getByText(/Transaction 1 of 2 went through\./)
      .waitFor();
    await review(page).getByRole("button", { name: "Sign transaction 2 of 2" }).click();
    await heading(review(page), "Done", 2).waitFor();
    await review(page)
      .getByText(/^Joined\./)
      .waitFor();
    await review(page).getByRole("button", { name: "Close" }).click();
    assert.equal(sent.length, 2);
    await expectApprovals([2435n, 2439n], CONDUIT, CONDUIT);
    await row(page, 2439)
      .getByText(/Joining Matcha Latte: votes from Thu,? 22 Oct/)
      .waitFor();
    assert.deepEqual([...new Set(asked)].sort(), [
      "eth_chainId",
      "eth_requestAccounts",
      "eth_sendTransaction",
      "wallet_getCapabilities",
    ]);
    assert.deepEqual(violations, []);
  });

  test("with a wallet that batches: join Double Espresso, move to Matcha Latte, and leave", async () => {
    const { page, sent } = await connected({ owner: NEWCOMER, batch: true });
    await row(page, 141).getByText(UNVOTED).waitFor();
    await h.only(page, "needs:unvoted", 141);
    await group(page, "needs:unvoted")
      .getByRole("link", { name: /Vote on Hydrex/ })
      .waitFor();
    await group(page, "needs:unvoted").getByRole("button", { name: "Join Double Espresso" }).click();
    await h.toCalls(page);
    await h.confirm(page);
    await review(page).getByRole("button", { name: "Close" }).click();
    await expectApprovals([141n], DOUBLE_ESPRESSO.address, DOUBLE_ESPRESSO.address);
    await row(page, 141)
      .getByText(/Joining Double Espresso/)
      .waitFor();
    await group(page, "in:double-espresso").getByRole("button", { name: "Move to Matcha Latte" }).click();
    await h.toCalls(page);
    assert.deepEqual(await says(page), ["Account #141 leaves Double Espresso and joins Matcha Latte."]);
    await h.confirm(page);
    await review(page).getByRole("button", { name: "Close" }).click();
    await expectApprovals([141n], CONDUIT, CONDUIT);
    await group(page, "in:matcha-latte").getByRole("button", { name: "Leave" }).click();
    await heading(review(page), "Leave Matcha Latte", 2).waitFor();
    assert.match(await review(page).innerText(), /Claims stop\s+Now\s+Votes return\s+Thu,? 22 Oct/i);
    await review(page).getByRole("button", { name: "Sign transaction" }).click();
    await review(page)
      .getByText(/^Left\./)
      .waitFor();
    await expectApprovals([141n], NEWCOMER, zeroAddress);
    assert.equal(sent.length, 3);
  });

  test("leave a stopped automation to vote yourself", async () => {
    const { page } = await connected({ owner: ELSEWHERE }, { width: 390, height: 844, dark: true });
    await h.only(page, "needs:stopped", 2439);
    await group(page, "needs:stopped").getByRole("button", { name: "Leave automation" }).click();
    await heading(review(page), "Leave USDC", 2).waitFor();
    assert.deepEqual(await says(page), ["Account #2439 leaves the USDC automation."]);
    await h.shoot(page, "leave-390-dark");
    await h.confirm(page);
    await review(page).getByRole("button", { name: "Close" }).click();
    await row(page, 2439)
      .getByText(/Left USDC: your votes from Thu,? 22 Oct/)
      .waitFor();
    await row(page, 2435)
      .getByText(/In Hydrex Lock Maxi · stopped/)
      .waitFor();
    await expectApprovals([2435n], LOCK_MAXI, LOCK_MAXI);
  });

  test("on an account's own page, its buttons act at once, and it leaves a stopped automation", async () => {
    const { page, violations } = await connected({ owner: ELSEWHERE }, { url: `${SITE}/#hydrex/2439` });
    const account = h.view(page, "account");
    await account.getByRole("button", { name: "Join Matcha Latte" }).click();
    await heading(review(page), "Before you join", 2).waitFor();
    await review(page).getByRole("button", { name: "Back" }).click();
    await account.getByRole("button", { name: "Leave automation" }).click();
    await heading(review(page), "Leave USDC", 2).waitFor();
    assert.deepEqual(await says(page), ["Account #2439 leaves the USDC automation."]);
    await h.confirm(page);
    await review(page).getByRole("button", { name: "Close" }).click();
    await account.getByText(/Left USDC: your votes from Thu,? 22 Oct/).waitFor();
    assert.deepEqual(violations, []);
  });

  test("the wrong network, a refusal, a failing transaction, Back while the wallet asks, and closing between two", async () => {
    const { page, wallet, sent } = await connected({ owner: NEWCOMER, chainId: 1, decline: true });
    await page.getByText("Wrong network.").waitFor();
    await h.only(page, "needs:unvoted", 141);
    const join = group(page, "needs:unvoted").getByRole("button", { name: "Join Matcha Latte" });
    await join.click();
    await h.toCalls(page);
    await review(page).getByRole("button", { name: "Switch to Base" }).click();
    await review(page).getByRole("button", { name: "Sign transaction" }).click();
    await review(page).getByText("You said no in your wallet.").waitFor();
    await page.keyboard.press("Escape");
    assert.equal(await page.getByText("Wrong network.").isVisible(), false);
    wallet.decline = false;
    wallet.failing = 1;
    await join.click();
    await h.toCalls(page);
    await review(page).getByRole("button", { name: "Sign transaction" }).click();
    await review(page).getByText("A transaction failed on Base.").waitFor();
    assert.equal(sent.length, 2);
    let answer = () => {};
    const other = await connected({ owner: ELSEWHERE, sending: new Promise<void>((resolve) => (answer = resolve)) });
    await h.pick(other.page, 2435, 2439);
    await group(other.page, "needs:stopped").getByRole("button", { name: "Join Matcha Latte" }).click();
    await h.toCalls(other.page);
    await review(other.page).getByRole("button", { name: "Sign transaction 1 of 2" }).click();
    await review(other.page).getByText("Waiting for your wallet…").waitFor();
    await review(other.page).getByRole("button", { name: "Back" }).click();
    assert.equal(await review(other.page).isVisible(), false);
    answer();
    await row(other.page, 2439)
      .getByText(/Joining Matcha Latte/)
      .waitFor();
    await expectApprovals([2435n], LOCK_MAXI, LOCK_MAXI);
    const stuck = await connected({ owner: NEWCOMER, chainId: 1, switches: false });
    await stuck.page.getByRole("button", { name: "Switch to Base" }).first().click();
    await stuck.page.getByText("Switch to Base in your wallet.").first().waitFor();
  });

  test("inside Safe{Wallet}, a Safe proposes leaving with two accounts as one Safe transaction", async () => {
    const { page, origins, violations } = await h.open(false, { url: `${SAFE_ORIGIN}/` });
    const frame = page.frameLocator("iframe");
    await frame.getByRole("banner").getByText(short(LEAVER)).waitFor();
    await heading(frame, "Your wallet").waitFor();
    await frame.getByRole("link", { name: "Hydrex", exact: true }).click();
    await frame.getByRole("checkbox", { name: "Pick Hydrex account #53350" }).check();
    await frame.getByRole("checkbox", { name: "Pick Hydrex account #82206" }).check();
    await frame.locator('[data-group="in:matcha-latte"]').getByRole("button", { name: "Leave", exact: true }).click();
    const dialog = frame.locator("#review");
    await dialog.getByText(/^One Safe transaction, 2 calls$/).waitFor();
    const slip = dialog.locator("[data-list=slip] > li").first();
    assert.equal(await slip.locator("[data-text=count]").textContent(), "Safe · Call 1 of 2 · Leave Matcha Latte");
    assert.equal(await h.field(slip, "Data", "description").innerText(), "100 bytes");
    await dialog.getByRole("button", { name: "Propose in Safe{Wallet}" }).click();
    await dialog.getByText("Proposed. Sign it in Safe{Wallet}.").waitFor();
    await dialog.getByRole("link", { name: "https://metadex.cafe/#hydrex/matcha-latte/check" }).waitFor();
    type Received = { method: string; params: { txs: { to: string; data: string; value: string }[] } };
    const received = await page.evaluate(() => (window as unknown as { received: Received[] }).received);
    const leave = (id: bigint) => ({
      to: VOTING_ESCROW,
      data: encodeFunctionData({ abi: h.abi, functionName: "setConduitApproval", args: [CONDUIT, id, false] }),
      value: "0",
    });
    assert.deepEqual(received.find(({ method }) => method === "sendTransactions")?.params.txs, [
      leave(53350n),
      leave(82206n),
    ]);
    assert.deepEqual(violations, []);
    for (const origin of origins) assert.ok([SITE, SAFE_ORIGIN, ...h.RPC_ORIGINS].includes(origin), origin);
  });
});
import { SAFE_ORIGIN } from "../src/wallet.ts";
