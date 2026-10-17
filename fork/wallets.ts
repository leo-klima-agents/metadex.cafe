// The page in Chromium, reading a copy of Base in anvil, with a test wallet that acts as real owners. Run with
// `npm run test:fork`, which builds the page first. Needs anvil, and Chromium for playwright-core: set CHROMIUM to its
// path if playwright-core did not install it. BASE_RPC_URL is the archive RPC to fork from.
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { after, afterEach, before, beforeEach, describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { chromium, type Browser, type BrowserContext, type Page, type Route } from "playwright-core";
import {
  decodeFunctionResult,
  encodeFunctionData,
  getAddress,
  parseAbi,
  zeroAddress,
  type Address,
  type Hex,
} from "viem";
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

/** Where an account's votes and claims go. */
const approvals = async (id: bigint) => ({
  delegate: await view(VOTING_ESCROW, "getLockDelegatee", [id]),
  claimer: await view(VOTING_ESCROW, "getClaimRedirectApproved", [id]),
});

/** The owner the wallet acts as, its chain, whether it refuses, and whether it can switch to Base. */
type WalletOptions = { owner: Address; chainId: number; decline: boolean; switches: boolean };
type Sent = { method: string; calls: { to: string; data: string }[] };

// The test wallet in the page. It announces itself (EIP-6963) and hands each request to Node through testWallet,
// which the page's Content Security Policy cannot block. Tests make it emit events, as when it locks, with
// testWalletEmit.
const WALLET_SCRIPT = `(() => {
  const listeners = {};
  window.testWalletEmit = (event, value) => { for (const l of listeners[event] ?? []) l(value); };
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

// Every breach of the page's Content Security Policy, Trusted Types included, in the console of each frame.
const POLICY_SCRIPT = `document.addEventListener("securitypolicyviolation", (event) =>
  console.error("Content Security Policy: " + event.violatedDirective + " " + event.blockedURI));`;

// The VotingEscrow's gas depends on the block's time, and anvil estimates at another time than it mines at, so the test
// wallet sets a limit as a wallet's margin would.
const GAS = "0xf4240";

/** Answers the page's wallet requests as the owner, sending transactions to anvil, and notes every method asked. */
function testWallet(options: WalletOptions, sent: Sent[], asked: string[]) {
  const declined = { error: { code: 4001, message: "User rejected the request." } };
  return async (method: string, params: any[]): Promise<{ result?: unknown; error?: unknown }> => {
    asked.push(method);
    switch (method) {
      case "eth_requestAccounts":
        return { result: [options.owner] };
      case "eth_chainId":
        return { result: `0x${options.chainId.toString(16)}` };
      case "wallet_switchEthereumChain":
        if (!options.switches) return { error: { code: -32603, message: "Unrecognized chain ID." } };
        options.chainId = Number(params[0].chainId);
        return { result: null };
      case "eth_sendTransaction": {
        sent.push({ method, calls: [{ to: params[0].to, data: params[0].data }] });
        if (options.decline) return declined;
        // As MetaMask does, refuse a transaction meant for another chain than the wallet's.
        if (params[0].chainId !== `0x${options.chainId.toString(16)}`) {
          return { error: { code: -32602, message: "The transaction is for another chain." } };
        }
        return { result: await anvil("eth_sendTransaction", [{ ...params[0], from: options.owner, gas: GAS }]) };
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

/** The page's own files from dist/, its RPCs from anvil, and nothing else. */
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
  if (url.origin === SAFE_WALLET) return route.fulfill({ contentType: "text/html", body: SAFE_PAGE });
  return route.abort();
}

/** The page, what the test wallet sent and was asked, its options to change on the way, and where the page went. */
type Opened = {
  page: Page;
  context: BrowserContext;
  wallet: WalletOptions;
  sent: Sent[];
  asked: string[];
  origins: Set<string>;
  violations: string[];
};

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
  const asked: string[] = [];
  const violations: string[] = [];
  await context.route("**/*", (route) => serve(route, origins));
  await context.addInitScript(POLICY_SCRIPT);
  const options: WalletOptions = { owner: NEWCOMER, chainId: 8453, decline: false, switches: true, ...wallet };
  if (wallet) {
    await context.exposeFunction("testWallet", testWallet(options, sent, asked));
    await context.addInitScript(WALLET_SCRIPT);
  }
  const page = await context.newPage();
  page.on("console", (message) => {
    if (/Content Security Policy/i.test(message.text())) violations.push(message.text());
  });
  page.on("pageerror", (error) => violations.push(String(error)));
  // The page's clock at the fork block, for the ten minutes it follows a transaction.
  const { timestamp } = await anvil<{ timestamp: Hex }>("eth_getBlockByNumber", ["latest", false]);
  await page.clock.setFixedTime(Number(timestamp) * 1000);
  await page.goto(url);
  return { page, context, wallet: options, sent, asked, origins, violations };
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

/** Confirms, and waits for the end; says what the review shows if that does not come. */
async function confirm(page: Page): Promise<void> {
  try {
    await review(page).getByRole("button", { name: "Confirm in your wallet" }).click();
    await review(page).getByText("Done.").waitFor({ timeout: 15_000 });
  } catch (error) {
    const shown = await review(page).locator(".progress").allTextContents();
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
    const { page, sent, asked, origins, violations } = await open({ owner: NEWCOMER });
    await page.getByText("Connect a wallet").waitFor();
    // The page asks the wallet nothing until someone picks it.
    await page.locator("time.week-start").getByText(/Thu/).waitFor();
    assert.deepEqual(asked, []);
    await page.getByRole("button", { name: "Test Wallet" }).click();
    await page.getByText("Connected with Test Wallet").waitFor();
    await account(page, 141).getByText("Not in an automation.").waitFor();
    await assert.doesNotReject(
      account(page, 42877).getByText("In another Hydrex automation: Liquid Hydrex.").waitFor(),
    );
    await page.locator("#empty-accounts summary").click();
    await page.locator("#empty-accounts li").getByText("Empty.").waitFor();
    assert.equal(await page.locator("#empty-accounts .pick").isVisible(), false, "an empty account has no box");
    await page.getByRole("checkbox", { name: "Pick Account #141" }).check();
    await page.getByRole("checkbox", { name: "Pick Account #42877" }).check();
    await shoot(page, "picked-1440-light");
    await page.getByRole("button", { name: "Join with 2 accounts" }).click();
    await review(page).getByText("2 transactions, one after the other:").waitFor();
    assert.deepEqual(await review(page).locator(".says").allTextContents(), [
      "#141 joins the Carbon Impact automation.",
      "#42877 leaves the Liquid Hydrex automation and joins the Carbon Impact automation.",
    ]);
    await shoot(page, "review-1440-light");
    // Each transaction takes a click of its own.
    await review(page).getByRole("button", { name: "Confirm transaction 1 of 2" }).click();
    await review(page).getByText("Transaction 1 of 2 is included.").waitFor();
    await review(page).getByRole("button", { name: "Confirm transaction 2 of 2" }).click();
    await review(page).getByText("Done.").waitFor();
    await review(page).getByRole("button", { name: "Close" }).click();
    assert.deepEqual(
      sent.map(({ method }) => method),
      ["eth_sendTransaction", "eth_sendTransaction"],
    );
    for (const id of [141n, 42877n]) assert.deepEqual(await approvals(id), { delegate: CONDUIT, claimer: CONDUIT });
    await account(page, 141).getByText("Joined the Carbon Impact automation.").waitFor();
    await account(page, 42877).getByText("Joined the Carbon Impact automation.").waitFor();
    // The page asks the wallet for its account and chain, and sends transactions, nothing more.
    assert.deepEqual([...new Set(asked)].sort(), ["eth_chainId", "eth_requestAccounts", "eth_sendTransaction"]);
    assert.deepEqual([...origins].sort(), [SITE, ...RPC_ORIGINS].filter((o) => origins.has(o)).sort());
    assert.ok(origins.has(SITE));
    assert.deepEqual(violations, []);
  });

  test("closing between transactions stops there", async () => {
    const { page, sent } = await open({ owner: NEWCOMER });
    await page.getByRole("button", { name: "Test Wallet" }).click();
    await page.getByRole("checkbox", { name: "Pick Account #141" }).check();
    await page.getByRole("checkbox", { name: "Pick Account #42877" }).check();
    await page.getByRole("button", { name: "Join with 2 accounts" }).click();
    await review(page).getByRole("button", { name: "Confirm transaction 1 of 2" }).click();
    await review(page).getByText("closing stops here").waitFor();
    await review(page).getByRole("button", { name: "Close" }).click();
    await account(page, 141).getByText("Joined the Carbon Impact automation.").waitFor();
    await account(page, 42877).getByText("In another Hydrex automation: Liquid Hydrex.").waitFor();
    assert.equal(sent.length, 1);
    assert.deepEqual((await approvals(42877n)).delegate, getAddress("0x809F8175b8F60960dF2bc7a78a7C4Eb04d138AF0"));
  });

  test("a wallet that locks is let go, and connects again from a click", async () => {
    const { page } = await open({ owner: NEWCOMER });
    await page.getByRole("button", { name: "Test Wallet" }).click();
    await account(page, 141).waitFor();
    await page.evaluate(() => (window as any).testWalletEmit("accountsChanged", []));
    await page.getByText("Connect a wallet").waitFor();
    assert.equal(await page.locator("#accounts").isVisible(), false);
    assert.equal(await page.locator("#payout").isVisible(), false);
    await page.getByRole("button", { name: "Test Wallet" }).click();
    await account(page, 141).waitFor();
  });

  test("closing the review before Base includes the transaction still updates the account", async () => {
    const { page } = await open({ owner: NEWCOMER });
    await page.getByRole("button", { name: "Test Wallet" }).click();
    await page.getByRole("checkbox", { name: "Pick Account #141" }).check();
    await page.getByRole("button", { name: "Join with 1 account" }).click();
    await anvil("evm_setAutomine", [false]);
    try {
      await review(page).getByRole("button", { name: "Confirm in your wallet" }).click();
      await review(page).getByText("Waiting for Base to include it").waitFor();
      await review(page).getByRole("button", { name: "Close" }).click();
      await account(page, 141).getByText("Not in an automation.").waitFor();
      // Base includes it later than the page's next look, two seconds on, which a page that stopped following used to
      // take as its last.
      await page.waitForTimeout(5_000);
      await anvil("evm_mine");
    } finally {
      await anvil("evm_setAutomine", [true]);
    }
    await account(page, 141).getByText("Joined the Carbon Impact automation.").waitFor();
  });

  test("join with accounts from Lock Maxi and USDC", async () => {
    const { page, sent } = await open({ owner: ELSEWHERE });
    await page.getByRole("button", { name: "Test Wallet" }).click();
    await page.getByRole("checkbox", { name: "Pick Account #2435" }).check();
    await page.getByRole("checkbox", { name: "Pick Account #2439" }).check();
    await page.getByRole("button", { name: "Join with 2 accounts" }).click();
    await review(page).getByRole("button", { name: "Confirm transaction 1 of 2" }).click();
    await review(page).getByRole("button", { name: "Confirm transaction 2 of 2" }).click();
    await review(page).getByText("Done.").waitFor();
    assert.equal(sent.length, 2);
    for (const id of [2435n, 2439n]) assert.deepEqual(await approvals(id), { delegate: CONDUIT, claimer: CONDUIT });
    // Joining leaves Lock Maxi's ERC-5725 claim approval in place; the VotingEscrow's own claim does not accept it.
    assert.equal(await view(VOTING_ESCROW, "getClaimApproved", [2435n]), getAddress(LOCK_MAXI));
  });

  test("leave with one account", async () => {
    const { page, sent } = await open({ owner: MEMBER }, { width: 390, height: 844, dark: true });
    await page.getByRole("button", { name: "Test Wallet" }).click();
    await account(page, 9540).getByText("In the Carbon Impact automation.").waitFor();
    await account(page, 14485).getByRole("checkbox").waitFor();
    await shoot(page, "member-390-dark");
    await page.getByRole("checkbox", { name: "Pick Account #9540" }).check();
    assert.equal(await page.getByRole("button", { name: "Join" }).isDisabled(), true);
    await page.getByRole("button", { name: "Leave with 1 account" }).click();
    await review(page).getByText("One transaction:").waitFor();
    await shoot(page, "leave-390-dark");
    await confirm(page);
    assert.deepEqual(await approvals(9540n), {
      delegate: MEMBER,
      claimer: zeroAddress,
    });
    await account(page, 9540).getByText("Left the Carbon Impact automation.").waitFor();
    assert.equal(sent.length, 1);
  });

  test("an ended lock offers nothing to tick", async () => {
    const { page } = await open({ owner: ENDED });
    await page.getByRole("button", { name: "Test Wallet" }).click();
    await account(page, 123351).getByText("Lock ended.").waitFor();
    assert.equal(await account(page, 123351).locator(".pick").isVisible(), false);
    assert.equal(await account(page, 123364).locator(".pick").isVisible(), true);
    // A click on the row cannot tick its hidden box.
    await account(page, 123351).click();
    assert.equal(await account(page, 123351).locator(".pick").isChecked(), false);
  });

  test("without a wallet in the browser, Browser wallet says how to get one", async () => {
    const { page } = await open(false, { width: 390, height: 844 });
    await page.getByRole("button", { name: "Browser wallet" }).click();
    await page.getByText("No wallet was found in this browser.").waitFor();
    await shoot(page, "no-wallet-390-light");
    assert.equal(await page.locator("#accounts").isVisible(), false);
  });

  test("the wrong network, a refusal in the wallet, and a transaction that fails", async () => {
    const { page, wallet, sent } = await open({ owner: NEWCOMER, chainId: 1, decline: true });
    await page.getByRole("button", { name: "Test Wallet" }).click();
    await page.getByText("Your wallet is on another network.").waitFor();
    await page.getByRole("checkbox", { name: "Pick Account #141" }).check();
    await page.getByRole("button", { name: "Join with 1 account" }).click();
    await review(page).getByRole("button", { name: "Switch to Base" }).click();
    await review(page).getByRole("button", { name: "Confirm in your wallet" }).click();
    await review(page).getByText("You said no in your wallet.").waitFor();
    assert.equal(sent.length, 1);
    assert.deepEqual(await approvals(141n), {
      delegate: NEWCOMER,
      claimer: zeroAddress,
    });
    await review(page).getByRole("button", { name: "Back" }).click();
    assert.equal(await page.getByText("Your wallet is on another network.").isVisible(), false);

    // The account changes hands after the page read it: the transaction fails on Base, and the review says so.
    const data = encodeFunctionData({ abi, functionName: "transferFrom", args: [NEWCOMER, RECIPIENT, 141n] });
    await anvil("eth_sendTransaction", [{ from: NEWCOMER, to: VOTING_ESCROW, data }]);
    wallet.decline = false;
    await page.getByRole("button", { name: "Join with 1 account" }).click();
    await review(page).getByRole("button", { name: "Confirm in your wallet" }).click();
    await review(page).getByText("A transaction failed on Base.").waitFor();
    assert.equal(await review(page).locator(".confirm").isVisible(), false);
    assert.equal(sent.length, 2);
  });

  test("a wallet that cannot switch to Base says so", async () => {
    const { page } = await open({ owner: NEWCOMER, chainId: 1, switches: false });
    await page.getByRole("button", { name: "Test Wallet" }).click();
    await page.locator("#wrong-chain").getByRole("button", { name: "Switch to Base" }).click();
    await page.getByText("Your wallet did not switch.").waitFor();
  });

  test("inside Safe{Wallet}, a Safe proposes leaving with two accounts as one Safe transaction", async () => {
    const { page, origins, violations } = await open(false, { url: `${SAFE_WALLET}/` });
    const app = page.frameLocator("iframe");
    await app.getByText("Connected with Safe{Wallet}").waitFor();
    await app.getByRole("checkbox", { name: "Pick Account #53350" }).check();
    await app.getByRole("checkbox", { name: "Pick Account #82206" }).check();
    await app.getByRole("button", { name: "Leave with 2 accounts" }).click();
    const dialog = app.locator("#review");
    await dialog.getByText("One Safe transaction, with 2 calls:").waitFor();
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
});
