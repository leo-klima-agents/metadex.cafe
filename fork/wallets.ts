// The page in Chromium, reading a copy of Base in anvil, with a test wallet that acts as real owners. Run with
// `npm run test:fork`, which builds the page first. Needs anvil, and Chromium for playwright-core: set CHROMIUM to its
// path if playwright-core did not install it. BASE_RPC_URL is the archive RPC to fork from.
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { after, afterEach, before, beforeEach, describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { chromium, type Browser, type BrowserContext, type Page, type Route } from "playwright-core";
import { decodeFunctionResult, encodeFunctionData, getAddress, parseAbi, type Address, type Hex } from "viem";
import { CONDUIT, RPCS, VOTING_ESCROW } from "../src/config.ts";

const FORK_URL = process.env.BASE_RPC_URL ?? "https://mainnet.base.org";
const BLOCK = 52_694_000; // Fri 16 Oct 2026, 18:22 UTC
const PORT = 8546;
const ANVIL = `http://127.0.0.1:${PORT}`;
const SITE = "https://metadex.cafe";
const SAFE_WALLET = "https://app.safe.global";
const DIST = fileURLToPath(new URL("../dist/", import.meta.url));
const SCREENSHOTS = process.env.SCREENSHOTS;

// Owners at BLOCK.
const MEMBER = getAddress("0x388b2d29e7919d45b1b8f6e88b8a13a392f97b40"); // #9540 in Carbon Impact, #14485 its own
const NEWCOMER = getAddress("0x0208ddbc05a91e1b937e8b3140b62ef22a274c95"); // #141 its own, #42877 in Liquid Hydrex
const ELSEWHERE = getAddress("0x69707a120ade8239f07595165e180c61395ea655"); // #2435 in Lock Maxi, #2439 in USDC
const LEAVER = getAddress("0x2573264b8e690ca6b2128c113890f42198840b16"); // #53350 and #82206 in Carbon Impact
const ENDED = getAddress("0x2518820268e4079e90446b93020dfad7dd54e84d"); // #123351 ended with HYDX in it, #123364
const LOCK_MAXI = "0x53388a4E98Bb56F8571433F5461010Fc287929d3";
const RECIPIENT = getAddress("0x000000000000000000000000000000000000beef");

const abi = parseAbi([
  "function getLockDelegatee(uint256 tokenId) view returns (address)",
  "function getClaimRedirectApproved(uint256 tokenId) view returns (address)",
  "function getClaimApproved(uint256 tokenId) view returns (address)",
  "function getEffectiveRecipientForOwner(address owner) view returns (address)",
  "function transferFrom(address from, address to, uint256 tokenId)",
]);

async function anvil<T>(method: string, params: unknown[] = []): Promise<T> {
  const response = await fetch(ANVIL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const { result, error } = (await response.json()) as { result: T; error?: { message: string } };
  if (error) throw new Error(`${method}: ${error.message}`);
  return result;
}

async function view(to: Address, functionName: string, args: unknown[]): Promise<Address> {
  const data = encodeFunctionData({ abi, functionName, args } as never);
  const reply = await anvil<Hex>("eth_call", [{ to, data }, "latest"]);
  return decodeFunctionResult({ abi, functionName, data: reply } as never) as Address;
}

/** Waits until anvil has mined a transaction, and returns its receipt. */
async function mined(hash: Hex): Promise<{ status: Hex; transactionHash: Hex }> {
  for (;;) {
    const receipt = await anvil<{ status: Hex; transactionHash: Hex } | null>("eth_getTransactionReceipt", [hash]);
    if (receipt) return receipt;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

/** Where an account's votes and claims go. */
const approvals = async (id: bigint) => ({
  delegate: await view(VOTING_ESCROW, "getLockDelegatee", [id]),
  claimer: await view(VOTING_ESCROW, "getClaimRedirectApproved", [id]),
});

type WalletOptions = { owner: Address; chainId: number; batch: boolean; decline: boolean };
type Sent = { method: string; calls: { to: string; data: string }[] };

// The test wallet in the page. It announces itself (EIP-6963) and hands each request to Node through testWallet,
// which the page's Content Security Policy cannot block.
const WALLET_SCRIPT = `(() => {
  const listeners = {};
  const provider = {
    async request({ method, params }) {
      const { result, error } = await window.testWallet(method, params ?? []);
      if (error) throw Object.assign(new Error(error.message), { code: error.code });
      if (method === "wallet_switchEthereumChain") for (const l of listeners.chainChanged ?? []) l(params[0].chainId);
      return result;
    },
    on(event, listener) { (listeners[event] ??= []).push(listener); },
    removeListener() {},
  };
  const info = { uuid: "6f1e9b4e-0c4b-4d55-9a1d-3a0b5f0e7a11", name: "Test Wallet", rdns: "test.wallet",
    icon: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 1 1'/%3E" };
  const announce = () =>
    window.dispatchEvent(new CustomEvent("eip6963:announceProvider", { detail: Object.freeze({ info, provider }) }));
  window.addEventListener("eip6963:requestProvider", announce);
  announce();
})();`;

// The VotingEscrow's gas depends on the block's time, and anvil estimates at another time than it mines at, so the test
// wallet sets a limit as a wallet's margin would.
const GAS = "0xf4240";

/** Answers the page's wallet requests as the owner, sending transactions to anvil. */
function testWallet(options: WalletOptions, sent: Sent[]) {
  const batches = new Map<string, Hex[]>();
  const declined = { error: { code: 4001, message: "User rejected the request." } };
  return async (method: string, params: any[]): Promise<{ result?: unknown; error?: unknown }> => {
    switch (method) {
      case "eth_requestAccounts":
      case "eth_accounts":
        return { result: [options.owner] };
      case "eth_chainId":
        return { result: `0x${options.chainId.toString(16)}` };
      case "wallet_switchEthereumChain":
        options.chainId = Number(params[0].chainId);
        return { result: null };
      case "wallet_getCapabilities":
        return options.batch
          ? { result: { "0x2105": { atomic: { status: "supported" } } } }
          : { error: { code: -32601, message: "Method not found" } };
      case "eth_sendTransaction": {
        sent.push({ method, calls: [{ to: params[0].to, data: params[0].data }] });
        if (options.decline) return declined;
        return { result: await anvil("eth_sendTransaction", [{ ...params[0], from: options.owner, gas: GAS }]) };
      }
      case "wallet_sendCalls": {
        const { calls, from, atomicRequired } = params[0];
        assert.equal(atomicRequired, true);
        assert.equal(getAddress(from), options.owner);
        sent.push({ method, calls: calls.map(({ to, data }: { to: string; data: string }) => ({ to, data })) });
        if (options.decline) return declined;
        // One transaction per call, in order.
        const hashes: Hex[] = [];
        for (const { to, data } of calls) {
          hashes.push(await anvil<Hex>("eth_sendTransaction", [{ from, to, data, gas: GAS }]));
          await mined(hashes.at(-1)!);
        }
        const id = `0x${batches.size + 1}`;
        batches.set(id, hashes);
        return { result: { id } };
      }
      case "wallet_getCallsStatus": {
        const receipts = await Promise.all((batches.get(params[0]) ?? []).map(mined));
        return { result: { status: receipts.every(({ status }) => status === "0x1") ? 200 : 500, receipts } };
      }
      default:
        return { error: { code: 4200, message: `The test wallet does not answer ${method}.` } };
    }
  };
}

// A stand-in for Safe{Wallet}: it frames the page and answers Safe's SDK as a Safe at LEAVER would, recording what the
// page asks.
const SAFE_PAGE = `<!doctype html><meta charset="utf-8"><title>Safe{Wallet}</title>
<iframe src="${SITE}/" style="inline-size: 100%; block-size: 95vh; border: 0"></iframe>
<script>
  window.received = [];
  addEventListener("message", ({ origin, source, data }) => {
    if (origin !== "${SITE}" || !data?.method) return;
    window.received.push({ method: data.method, params: data.params });
    const answers = {
      getSafeInfo: { safeAddress: "${LEAVER}", chainId: 8453, threshold: 2, owners: [], isReadOnly: false },
      sendTransactions: { safeTxHash: "0x${"ab".repeat(32)}" },
    };
    const reply = data.method in answers
      ? { id: data.id, success: true, version: "9.1.0", data: answers[data.method] }
      : { id: data.id, success: false, version: "9.1.0", error: data.method + " is not answered here" };
    source.postMessage(reply, origin);
  });
</script>`;

const CORS = { "access-control-allow-origin": "*", "access-control-allow-headers": "content-type" };
const RPC_ORIGINS = new Set(RPCS.map((url) => new URL(url).origin));

/** The page's own files from dist/, its RPCs from anvil, Coinbase's window as a stub, and nothing else. */
async function serve(route: Route, origins: Set<string>): Promise<void> {
  const request = route.request();
  const url = new URL(request.url());
  origins.add(url.origin);
  if (url.origin === SITE) {
    const path = `${DIST}${url.pathname === "/" ? "index.html" : url.pathname.slice(1)}`;
    return existsSync(path) ? route.fulfill({ path }) : route.fulfill({ status: 404 });
  }
  if (RPC_ORIGINS.has(url.origin)) {
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: CORS });
    const response = await fetch(ANVIL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: request.postData() ?? "",
    });
    return route.fulfill({ headers: { ...CORS, "content-type": "application/json" }, body: await response.text() });
  }
  if (url.origin === "https://keys.coinbase.com") return route.fulfill({ contentType: "text/html", body: "Coinbase" });
  if (url.origin === SAFE_WALLET) return route.fulfill({ contentType: "text/html", body: SAFE_PAGE });
  return route.abort();
}

type Opened = { page: Page; context: BrowserContext; sent: Sent[]; origins: Set<string>; violations: string[] };

let browser: Browser;
let node: ChildProcess;
let snapshot: Hex;
const contexts: BrowserContext[] = [];

/** Opens the page, with the test wallet acting as an owner unless wallet is false. */
async function open(
  wallet: Partial<WalletOptions> | false,
  { width = 1440, height = 900, dark = false, url = `${SITE}/` } = {},
): Promise<Opened> {
  const context = await browser.newContext({
    viewport: { width, height },
    colorScheme: dark ? "dark" : "light",
    locale: "en-GB",
    timezoneId: "Europe/Paris",
  });
  contexts.push(context);
  const origins = new Set<string>();
  const sent: Sent[] = [];
  const violations: string[] = [];
  await context.route("**/*", (route) => serve(route, origins));
  if (wallet) {
    const options = { owner: NEWCOMER, chainId: 8453, batch: false, decline: false, ...wallet };
    await context.exposeFunction("testWallet", testWallet(options, sent));
    await context.addInitScript(WALLET_SCRIPT);
  }
  const page = await context.newPage();
  page.on("console", (message) => {
    if (/Content Security Policy/i.test(message.text())) violations.push(message.text());
  });
  page.on("pageerror", (error) => violations.push(String(error)));
  // The page's clock at the fork block, for the statuses that depend on the time.
  const { timestamp } = await anvil<{ timestamp: Hex }>("eth_getBlockByNumber", ["latest", false]);
  await page.clock.setFixedTime(Number(timestamp) * 1000);
  await page.goto(url);
  return { page, context, sent, origins, violations };
}

/** Saves a screenshot to $SCREENSHOTS, if set: the whole page, or only the screen while a dialog is open. */
async function shoot(page: Page, name: string): Promise<void> {
  if (!SCREENSHOTS) return;
  mkdirSync(SCREENSHOTS, { recursive: true });
  const fullPage = !(await review(page).isVisible());
  await page.screenshot({ path: `${SCREENSHOTS}/${name}.png`, fullPage });
}

const account = (page: Page, id: number) =>
  page.locator("#full > li, #empty-accounts li").filter({ hasText: `#${id}` });
const review = (page: Page) => page.locator("#review");

/** Waits for the check, confirms, and waits for the end; says what the review shows if that does not come. */
async function confirm(page: Page): Promise<void> {
  try {
    await review(page).getByText("Checked ✓").waitFor({ timeout: 15_000 });
    await review(page).getByRole("button", { name: "Confirm in your wallet" }).click();
    await review(page).getByText("Done.").waitFor({ timeout: 15_000 });
  } catch (error) {
    const shown = await review(page).locator(".check, .progress").allTextContents();
    throw new Error(`The review shows: ${JSON.stringify(shown)}`, { cause: error });
  }
  await review(page).getByRole("button", { name: "Close" }).click();
}

describe("the page against a fork of Base", { timeout: 300_000 }, () => {
  before(async () => {
    node = spawn(
      "anvil",
      ["--fork-url", FORK_URL, "--fork-block-number", String(BLOCK), "--port", String(PORT), "--auto-impersonate"],
      { stdio: "ignore" },
    );
    for (let i = 0; ; i++) {
      try {
        await anvil("eth_chainId");
        break;
      } catch (error) {
        if (i === 60) throw error;
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    }
    for (const owner of [MEMBER, NEWCOMER, ELSEWHERE, LEAVER, ENDED]) {
      await anvil("anvil_setBalance", [owner, "0x16345785d8a0000"]); // 0.1 ETH for gas
    }
    browser = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
  });

  after(async () => {
    await browser?.close();
    node?.kill();
  });

  beforeEach(async () => {
    snapshot = await anvil<Hex>("evm_snapshot");
  });

  afterEach(async () => {
    for (const context of contexts.splice(0)) await context.close();
    await anvil("evm_revert", [snapshot]);
  });

  test("join with two accounts, one from another automation, one transaction at a time", async () => {
    const { page, sent, origins, violations } = await open({ owner: NEWCOMER });
    await page.getByText("Connect a wallet").waitFor();
    await page.getByRole("button", { name: "Test Wallet" }).click();
    await page.getByText("Connected with Test Wallet").waitFor();
    await account(page, 141).getByText("Not in an automation.").waitFor();
    await assert.doesNotReject(
      account(page, 42877).getByText("In another Hydrex automation: Liquid Hydrex.").waitFor(),
    );
    assert.equal(await account(page, 329).locator(".pick").isVisible(), false, "an empty account has no box");
    await page.getByRole("checkbox", { name: "Pick Account #141" }).check();
    await page.getByRole("checkbox", { name: "Pick Account #42877" }).check();
    await shoot(page, "picked-1440-light");
    await page.getByRole("button", { name: "Join with 2 accounts" }).click();
    await review(page).getByText("2 transactions, one after the other:").waitFor();
    assert.deepEqual(await review(page).locator(".says").allTextContents(), [
      "Put #141 in the Carbon Impact automation.",
      "Put #42877 in the Carbon Impact automation.",
    ]);
    await review(page).getByText("Checked ✓").waitFor();
    await shoot(page, "review-1440-light");
    await confirm(page);
    assert.deepEqual(
      sent.map(({ method }) => method),
      ["eth_sendTransaction", "eth_sendTransaction"],
    );
    for (const id of [141n, 42877n]) assert.deepEqual(await approvals(id), { delegate: CONDUIT, claimer: CONDUIT });
    await account(page, 141).getByText("Joined the Carbon Impact automation.").waitFor();
    await account(page, 42877).getByText("Joined the Carbon Impact automation.").waitFor();
    assert.deepEqual([...origins].sort(), [SITE, ...RPC_ORIGINS].filter((o) => origins.has(o)).sort());
    assert.ok(origins.has(SITE));
    assert.deepEqual(violations, []);
  });

  test("join in one batch with accounts from Lock Maxi and USDC", async () => {
    const { page, sent } = await open({ owner: ELSEWHERE, batch: true });
    await page.getByRole("button", { name: "Test Wallet" }).click();
    await page.getByRole("checkbox", { name: "Pick Account #2435" }).check();
    await page.getByRole("checkbox", { name: "Pick Account #2439" }).check();
    await page.getByRole("button", { name: "Join with 2 accounts" }).click();
    await review(page).getByText("One transaction, with 2 calls:").waitFor();
    await confirm(page);
    assert.deepEqual(
      sent.map(({ method, calls }) => [method, calls.length]),
      [["wallet_sendCalls", 2]],
    );
    for (const id of [2435n, 2439n]) assert.deepEqual(await approvals(id), { delegate: CONDUIT, claimer: CONDUIT });
    // Joining leaves Lock Maxi's ERC-5725 claim approval in place; the VotingEscrow's own claim does not accept it.
    assert.equal(await view(VOTING_ESCROW, "getClaimApproved", [2435n]), getAddress(LOCK_MAXI));
  });

  test("leave with one account, then send the payouts elsewhere", async () => {
    const { page, sent } = await open({ owner: MEMBER, batch: true }, { width: 390, height: 844, dark: true });
    await page.getByRole("button", { name: "Test Wallet" }).click();
    await account(page, 9540).getByText("In the Carbon Impact automation.").waitFor();
    await account(page, 14485).getByRole("checkbox").waitFor();
    await shoot(page, "member-390-dark");
    await page.getByRole("checkbox", { name: "Pick Account #9540" }).check();
    assert.equal(await page.getByRole("button", { name: "Join" }).isDisabled(), true);
    await page.getByRole("button", { name: "Leave with 1 account" }).click();
    await review(page).getByText("One transaction:").waitFor();
    await review(page).getByText("Checked ✓").waitFor();
    await shoot(page, "leave-390-dark");
    await confirm(page);
    assert.deepEqual(await approvals(9540n), {
      delegate: MEMBER,
      claimer: "0x0000000000000000000000000000000000000000",
    });
    await account(page, 9540).getByText("Left the Carbon Impact automation.").waitFor();

    await page.getByLabel("Send the payouts to:").fill(RECIPIENT);
    await page.getByRole("button", { name: "Change the payout address" }).click();
    await review(page).getByText(`setMyPayoutRecipient(${RECIPIENT})`).waitFor();
    await confirm(page);
    assert.equal(await view(CONDUIT, "getEffectiveRecipientForOwner", [MEMBER]), RECIPIENT);
    await page.locator("#payout a.payout").getByText(RECIPIENT).waitFor();
    assert.equal(sent.length, 2);
  });

  test("leave with two accounts in one batch", async () => {
    const { page, sent } = await open({ owner: LEAVER, batch: true });
    await page.getByRole("button", { name: "Test Wallet" }).click();
    await page.getByRole("checkbox", { name: "Pick Account #53350" }).check();
    await page.getByRole("checkbox", { name: "Pick Account #82206" }).check();
    await page.getByRole("button", { name: "Leave with 2 accounts" }).click();
    await review(page).getByText("One transaction, with 2 calls:").waitFor();
    await review(page).getByText("can no longer claim the rewards of #53350 and #82206").waitFor();
    await confirm(page);
    assert.deepEqual(
      sent.map(({ method, calls }) => [method, calls.length]),
      [["wallet_sendCalls", 2]],
    );
    for (const id of [53350n, 82206n]) {
      assert.deepEqual(await approvals(id), {
        delegate: LEAVER,
        claimer: "0x0000000000000000000000000000000000000000",
      });
    }
    await account(page, 53350).getByText("Left the Carbon Impact automation.").waitFor();
  });

  test("an ended lock and another owner's accounts offer nothing to tick", async () => {
    const { page } = await open({ owner: ENDED });
    await page.getByRole("button", { name: "Test Wallet" }).click();
    await account(page, 123351).getByText("Lock ended.").waitFor();
    assert.equal(await account(page, 123351).locator(".pick").isVisible(), false);
    assert.equal(await account(page, 123364).locator(".pick").isVisible(), true);
    await page.getByLabel("See the accounts of an address:").fill(MEMBER);
    await page.getByRole("button", { name: "Show the accounts" }).click();
    await page.getByText("Connect as this address to join or leave with its accounts.").waitFor();
    assert.equal(await page.locator(".pick:visible").count(), 0);
    assert.equal(await page.locator("#pick-bar").isVisible(), false);
    assert.equal(await page.locator("#payout-form").isVisible(), false);
  });

  test("the wrong network, a refusal in the wallet, and a call that would fail", async () => {
    const { page, sent } = await open({ owner: NEWCOMER, chainId: 1, decline: true });
    await page.getByRole("button", { name: "Test Wallet" }).click();
    await page.getByText("Your wallet is on another network.").waitFor();
    await page.getByRole("checkbox", { name: "Pick Account #141" }).check();
    await page.getByRole("button", { name: "Join with 1 account" }).click();
    await review(page).getByText("Checked ✓").waitFor();
    await review(page).getByRole("button", { name: "Switch to Base" }).click();
    await review(page).getByRole("button", { name: "Confirm in your wallet" }).click();
    await review(page).getByText("You said no in your wallet.").waitFor();
    assert.equal(sent.length, 1);
    assert.deepEqual(await approvals(141n), {
      delegate: NEWCOMER,
      claimer: "0x0000000000000000000000000000000000000000",
    });
    await review(page).getByRole("button", { name: "Back" }).click();
    assert.equal(await page.getByText("Your wallet is on another network.").isVisible(), false);

    // The account changes hands after the page read it: the check fails, and nothing can be sent.
    const data = encodeFunctionData({ abi, functionName: "transferFrom", args: [NEWCOMER, RECIPIENT, 141n] });
    await anvil("eth_sendTransaction", [{ from: NEWCOMER, to: VOTING_ESCROW, data }]);
    await page.getByRole("button", { name: "Join with 1 account" }).click();
    await review(page).getByText("would fail on Base").waitFor();
    assert.match((await review(page).locator(".check").textContent()) ?? "", /“Not token owner”/);
    assert.equal(await review(page).getByRole("button", { name: "Confirm in your wallet" }).isDisabled(), true);
  });

  test("inside Safe{Wallet}, a Safe proposes leaving with two accounts as one Safe transaction", async () => {
    const { page, origins, violations } = await open(false, { url: `${SAFE_WALLET}/` });
    const app = page.frameLocator("iframe");
    await app.getByText("Connected with Safe{Wallet}").waitFor();
    assert.equal(await app.locator("#disconnect").isVisible(), false);
    await app.getByRole("checkbox", { name: "Pick Account #53350" }).check();
    await app.getByRole("checkbox", { name: "Pick Account #82206" }).check();
    await app.getByRole("button", { name: "Leave with 2 accounts" }).click();
    const dialog = app.locator("#review");
    await dialog.getByText("One Safe transaction, with 2 calls:").waitFor();
    await dialog.getByText("Checked ✓").waitFor();
    await dialog.getByRole("button", { name: "Propose in Safe{Wallet}" }).click();
    await dialog.getByText("Proposed.").waitFor();
    const received = await page.evaluate(() => (window as unknown as { received: Sent[] }).received);
    const proposal = received.find(({ method }) => method === "sendTransactions") as unknown as {
      params: { txs: { to: string; data: string; value: string }[] };
    };
    const leave = (id: bigint) =>
      encodeFunctionData({
        abi: parseAbi(["function setConduitApproval(address, uint256, bool)"]),
        args: [CONDUIT, id, false],
      });
    assert.deepEqual(proposal.params.txs, [
      { to: VOTING_ESCROW, data: leave(53350n), value: "0" },
      { to: VOTING_ESCROW, data: leave(82206n), value: "0" },
    ]);
    // A proposal changes nothing until the owners sign it and it executes.
    for (const id of [53350n, 82206n]) assert.deepEqual(await approvals(id), { delegate: CONDUIT, claimer: CONDUIT });
    assert.deepEqual(violations, []);
    for (const origin of origins) {
      assert.ok([SITE, SAFE_WALLET, ...RPC_ORIGINS].includes(origin), `unexpected request to ${origin}`);
    }
  });

  test("Coinbase Wallet loads its code under the page's policy and opens its window", async () => {
    const { page, context, origins, violations } = await open(false, { width: 390, height: 844 });
    const popup = context.waitForEvent("page");
    await page.getByRole("button", { name: "Coinbase Wallet" }).click();
    const window = await popup;
    await window.waitForURL(/^https:\/\/keys\.coinbase\.com\/connect/);
    assert.deepEqual(violations, []);
    assert.ok(origins.has(SITE));
    for (const origin of origins) {
      assert.ok(
        [SITE, ...RPC_ORIGINS, "https://keys.coinbase.com"].includes(origin),
        `unexpected request to ${origin}`,
      );
    }
  });
});
