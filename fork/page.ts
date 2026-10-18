import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { after, afterEach, before, beforeEach, describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { chromium, type Browser, type BrowserContext, type Locator, type Page, type Route } from "playwright-core";
import {
  decodeFunctionResult,
  encodeFunctionData,
  getAddress,
  parseAbi,
  toFunctionSelector,
  zeroAddress,
  type Address,
  type Hex,
} from "viem";
import { CONDUIT, RPCS, VOTER, VOTING_ESCROW } from "../src/config.ts";
import { readEarnings, sharesOf } from "../src/earnings.ts";
import { WEEK } from "../src/format.ts";
import { readAccounts } from "../src/hydrex.ts";
import { lastRun } from "../src/receipts.ts";

const FORK_URL = process.env.BASE_RPC_URL ?? "https://mainnet.base.org";
const BLOCK = 52_694_000; // Fri 16 Oct 2026, 18:22 UTC
const FLIP = 1_792_627_200; // Thu 22 Oct 2026, 00:00 UTC, when the epoch after BLOCK's starts
const PORT = 8546;
const ANVIL = `http://127.0.0.1:${PORT}`;
const SITE = "https://metadex.cafe";
const SAFE_WALLET = "https://app.safe.global";
const DIST = fileURLToPath(new URL("../dist/", import.meta.url));
const SCREENSHOTS = process.env.SCREENSHOTS;
const RPC_ORIGINS = RPCS.map((url) => new URL(url).origin);
const CORS = { "access-control-allow-origin": "*", "access-control-allow-headers": "content-type" };

// Owners at BLOCK.
const MEMBER = getAddress("0x388b2d29e7919d45b1b8f6e88b8a13a392f97b40"); // #9540 in Carbon Impact, #14485 its own
const NEWCOMER = getAddress("0x0208ddbc05a91e1b937e8b3140b62ef22a274c95"); // #141 its own, #42877 in Liquid Hydrex
const ELSEWHERE = getAddress("0x69707a120ade8239f07595165e180c61395ea655"); // #2435 in Lock Maxi, #2439 in USDC
const LEAVER = getAddress("0x2573264b8e690ca6b2128c113890f42198840b16"); // #53350 and #82206 in Carbon Impact
const ENDED = getAddress("0x2518820268e4079e90446b93020dfad7dd54e84d"); // #123351 ended with HYDX in it, #123364
const PAYEE = getAddress("0x60924601e73ebc5c2bd9244c788d93e0710a6c93"); // #82774 in Carbon Impact, paid Wed 23 Sep
const LIQUID_HYDREX = getAddress("0x809F8175b8F60960dF2bc7a78a7C4Eb04d138AF0");
const LOCK_MAXI = getAddress("0x53388a4E98Bb56F8571433F5461010Fc287929d3");
const USDC = getAddress("0xE57b3Ea02336B9b418cA523aB5aD6f479d93bD1D");
const RECIPIENT = getAddress("0x000000000000000000000000000000000000beef");
// Tokens that Base runs natively, such as GOOGLc and cbZEC. Their code is the byte 0xef, which anvil cannot run: a call
// to one uses all its gas and fails the whole batch of reads. Without their code, they read as tokens the page cannot
// count.
const NATIVE: Address[] = [
  "0xb200000000000000000000c2e324d24d7eecd1fb",
  "0xb20000000000000000000078ee7ce2fe4908108c",
  "0xb2000000000000000000008bc8786b856e61707c",
  "0xb2000000000000000000004c27f6523082f41d01",
  "0xb2000000000000000000002d0ba3164cc74f58b7",
  "0xb2000000000000000000008501b13360000cb2ec",
  "0xb200000000000000000000451d033a5000cb479e",
  "0xb200000000000000000000856a95738c92feed01",
];

// The VotingEscrow's gas use depends on the block time, and anvil estimates gas at another time than it mines at. So
// the test wallet sets a generous limit, as wallets add a margin.
const GAS = "0xf4240";

const abi = parseAbi([
  "function getLockDelegatee(uint256 tokenId) view returns (address)",
  "function getClaimRedirectApproved(uint256 tokenId) view returns (address)",
  "function getClaimApproved(uint256 tokenId) view returns (address)",
  "function transferFrom(address from, address to, uint256 tokenId)",
  "function setConduitApproval(address conduit, uint256 tokenId, bool approve)",
]);

const hex = (n: number) => `0x${n.toString(16)}`;

const post = async (body: string): Promise<string> =>
  (await fetch(ANVIL, { method: "POST", headers: { "content-type": "application/json" }, body })).text();

async function anvil<T>(method: string, params: unknown[] = []): Promise<T> {
  const reply = await post(JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }));
  const { result, error } = JSON.parse(reply) as { result: T; error?: { message: string } };
  if (error) throw new Error(`${method}: ${error.message}`);
  return result;
}

async function view(to: Address, functionName: string, args: unknown[]): Promise<Address> {
  const data = encodeFunctionData({ abi, functionName, args } as never);
  const reply = await anvil<Hex>("eth_call", [{ to, data }, "latest"]);
  return decodeFunctionResult({ abi, functionName, data: reply } as never) as Address;
}

// The page gives each request five seconds, but anvil fetches the state it lacks from FORK_URL one slot at a time. So
// Node makes the slow first reads with no time limit, and the page then finds them cached.
async function warm(reads: () => Promise<unknown>): Promise<void> {
  const original = globalThis.fetch;
  globalThis.fetch = (_, init) => original(ANVIL, { ...init, signal: null });
  try {
    await reads();
  } finally {
    globalThis.fetch = original;
  }
}

async function expectApprovals(ids: bigint[], delegate: Address, claimer: Address): Promise<void> {
  for (const id of ids) {
    const found = {
      delegate: await view(VOTING_ESCROW, "getLockDelegatee", [id]),
      claimer: await view(VOTING_ESCROW, "getClaimRedirectApproved", [id]),
    };
    assert.deepEqual(found, { delegate, claimer }, `#${id}`);
  }
}

type WalletOptions = {
  owner: Address;
  chainId: number;
  decline: boolean;
  switches: boolean;
  approval?: Promise<void>;
  // Holds back the answer to a transaction until it settles, as a wallet does while its window is open.
  sending?: Promise<void>;
};
// Fails the reads of Base whose request body it matches.
type Rpc = { refuse?: ((body: string) => boolean) | undefined };
type OpenOptions = {
  width?: number;
  height?: number;
  dark?: boolean;
  url?: string;
  flowing?: boolean;
  script?: boolean;
  refuse?: Rpc["refuse"];
};
type Sent = { to: string; data: string };
type Opened = {
  page: Page;
  wallet: WalletOptions;
  sent: Sent[];
  asked: string[];
  origins: Set<string>;
  violations: string[];
  rpc: Rpc;
};

// A wallet that announces itself to the page and hands each request to Node through testWallet, which the page's
// Content Security Policy cannot block.
const WALLET_SCRIPT = `(() => {
  const listeners = {};
  window.testWalletEmit = (event, value) => { for (const l of listeners[event] ?? []) l(value); };
  const provider = {
    async request({ method, params }) {
      const { result, error } = await window.testWallet(method, params ?? []);
      if (error) throw Object.assign(new Error(error.message), { code: error.code });
      if (method === "wallet_switchEthereumChain") testWalletEmit("chainChanged", params[0].chainId);
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

const POLICY_SCRIPT = `document.addEventListener("securitypolicyviolation", (event) =>
  console.error("Content Security Policy: " + event.violatedDirective + " " + event.blockedURI));`;

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

function testWallet(options: WalletOptions, sent: Sent[], asked: string[]) {
  let asking = false;
  return async (method: string, params: any[]): Promise<{ result?: unknown; error?: unknown }> => {
    asked.push(method);
    switch (method) {
      case "eth_requestAccounts":
        // As MetaMask does while its window is open.
        if (asking) return { error: { code: -32002, message: "Request already pending." } };
        asking = true;
        await options.approval;
        asking = false;
        return { result: [options.owner] };
      case "eth_chainId":
        return { result: hex(options.chainId) };
      case "wallet_switchEthereumChain":
        if (!options.switches) return { error: { code: -32603, message: "Unrecognized chain ID." } };
        options.chainId = Number(params[0].chainId);
        return { result: null };
      case "eth_sendTransaction": {
        const { to, data, chainId } = params[0];
        sent.push({ to, data });
        await options.sending;
        if (options.decline) return { error: { code: 4001, message: "User rejected the request." } };
        // As MetaMask does.
        if (chainId !== hex(options.chainId)) return { error: { code: -32602, message: "Wrong chain." } };
        return { result: await anvil("eth_sendTransaction", [{ to, data, from: options.owner, gas: GAS }]) };
      }
      default:
        return { error: { code: 4200, message: `The test wallet does not answer ${method}.` } };
    }
  };
}

async function serve(route: Route, { origins, rpc }: Pick<Opened, "origins" | "rpc">): Promise<void> {
  const request = route.request();
  const { origin, pathname } = new URL(request.url());
  origins.add(origin);
  if (origin === SITE) {
    const path = `${DIST}${pathname === "/" ? "index.html" : pathname.slice(1)}`;
    return route.fulfill(existsSync(path) ? { path } : { status: 404 });
  }
  if (RPC_ORIGINS.includes(origin)) {
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: CORS });
    if (rpc.refuse?.(request.postData() ?? "")) return route.abort();
    const body = await post(request.postData() ?? "");
    return route.fulfill({ headers: { ...CORS, "content-type": "application/json" }, body });
  }
  if (origin === SAFE_WALLET) return route.fulfill({ contentType: "text/html", body: SAFE_PAGE });
  return route.abort();
}

let browser: Browser;
let node: ChildProcess;
let snapshot: Hex;
const contexts: BrowserContext[] = [];

async function open(
  wallet: Partial<WalletOptions> | false,
  {
    width = 1440,
    height = 900,
    dark = false,
    url = `${SITE}/`,
    flowing = false,
    script = true,
    refuse,
  }: OpenOptions = {},
): Promise<Opened> {
  const context = await browser.newContext({
    viewport: { width, height },
    colorScheme: dark ? "dark" : "light",
    locale: "en-GB",
    timezoneId: "Europe/Paris",
    javaScriptEnabled: script,
  });
  contexts.push(context);
  const options: WalletOptions = { owner: NEWCOMER, chainId: 8453, decline: false, switches: true, ...wallet };
  const opened = {
    wallet: options,
    sent: [] as Sent[],
    asked: [] as string[],
    origins: new Set<string>(),
    violations: [] as string[],
    rpc: { refuse } as Rpc,
  };
  await context.route("**/*", (route) => serve(route, opened));
  await context.addInitScript(POLICY_SCRIPT);
  if (wallet) {
    await context.exposeFunction("testWallet", testWallet(options, opened.sent, opened.asked));
    await context.addInitScript(WALLET_SCRIPT);
  }
  const page = await context.newPage();
  page.on("console", (message) => {
    if (/Content Security Policy/i.test(message.text())) opened.violations.push(message.text());
  });
  page.on("pageerror", (error) => opened.violations.push(String(error)));
  const { timestamp } = await anvil<{ timestamp: Hex }>("eth_getBlockByNumber", ["latest", false]);
  const time = Number(timestamp) * 1000;
  if (script) await (flowing ? page.clock.install({ time }) : page.clock.setFixedTime(time));
  await page.goto(url);
  return { page, ...opened };
}

async function connected(wallet: Partial<WalletOptions>, options?: OpenOptions): Promise<Opened> {
  const opened = await open(wallet, { url: `${SITE}/#app`, ...options });
  await opened.page.getByRole("button", { name: "Test Wallet" }).click();
  return opened;
}

const account = (page: Page, id: number) => page.locator("#accounts li").filter({ hasText: `#${id}` });
const group = (page: Page, name: string) =>
  page.locator(".group").filter({ has: page.getByRole("heading", { name, exact: true }) });
const review = (page: Page) => page.locator("#review");
const homeTitle = (page: Page) =>
  page.getByRole("heading", { name: "Your Hydrex votes, retiring carbon credits and paying you" });
const appTitle = (page: Page) => page.getByRole("heading", { name: "Your accounts", level: 1 });
const howTitle = (page: Page) => page.getByRole("heading", { name: "How it works", level: 1 });

// Goes through the join's first two steps, to the calls.
async function toWallet(page: Page): Promise<void> {
  await review(page).getByRole("heading", { name: "Before you join" }).waitFor();
  await review(page).getByRole("button", { name: "Continue" }).click();
  await review(page).getByRole("button", { name: "Continue" }).click();
  await review(page).getByRole("heading", { name: "What your wallet will ask" }).waitFor();
}

async function pick(page: Page, ...ids: number[]): Promise<void> {
  for (const id of ids) await page.getByRole("checkbox", { name: `Pick Account #${id}` }).check();
}

async function shoot(page: Page, name: string, part?: Locator): Promise<void> {
  if (!SCREENSHOTS) return;
  mkdirSync(SCREENSHOTS, { recursive: true });
  if (part) return void (await part.screenshot({ path: `${SCREENSHOTS}/${name}.png` }));
  const fullPage = !(await review(page).isVisible());
  await page.screenshot({ path: `${SCREENSHOTS}/${name}.png`, fullPage });
}

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

// The first reads through anvil are slow.
describe("the page against a fork of Base", { timeout: 600_000 }, () => {
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
    for (const token of NATIVE) await anvil("anvil_setCode", [token, "0x"]);
    for (const owner of [MEMBER, NEWCOMER, ELSEWHERE, LEAVER, ENDED]) {
      await anvil("anvil_setBalance", [owner, "0x16345785d8a0000"]); // 0.1 ETH
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

  test("Home first, the App at its address, Back and Forward, and the address of a section", async () => {
    const { page, asked, violations } = await open({ owner: NEWCOMER }, { width: 390, height: 844 });
    await homeTitle(page).waitFor();
    assert.equal(await appTitle(page).isVisible(), false);
    assert.equal(await page.title(), "metaDEX Café");
    const numbers = page.locator(".numbers");
    assert.equal(await numbers.locator(".needs-script").isVisible(), false);
    await numbers.getByText(/a third \(33\.33%\) retired,\s+two thirds \(66\.67%\) paid to you/).waitFor();
    await numbers
      .locator(".countdown")
      .getByText(/^in 5 d \d+ h$/)
      .waitFor();
    assert.match(await numbers.locator(".tonnes").innerText(), /^\d[\d,]*$/);
    assert.match(
      await numbers.locator("time.week-end-when").innerText(),
      /^Thu,? 22 Oct,? 00:00 UTC \(Thu,? 22 Oct,? 02:00 your time\)$/,
    );
    const states = page.locator(".promise .states");
    assert.equal(await states.locator(".impact-state").textContent(), "Running");
    assert.match((await states.locator("time.impact-voted").textContent()) ?? "", /^Wed,? 14 Oct,? 23:59 UTC$/);
    assert.equal(
      await page.locator("header").getByRole("link", { name: "How it works" }).isVisible(),
      false,
      "on Home on a phone, How it works is under the heading",
    );
    await shoot(page, "home-390-light");
    await page.locator(".promise").getByRole("link", { name: "Open the app" }).click();
    await appTitle(page).waitFor();
    assert.equal(await homeTitle(page).isVisible(), false);
    assert.equal(await page.title(), "Your accounts · metaDEX Café");
    assert.equal(await page.evaluate(() => document.activeElement?.textContent), "Your accounts");
    await shoot(page, "app-390-light");
    await page.goBack();
    await homeTitle(page).waitFor();
    assert.equal(await page.title(), "metaDEX Café");
    await page.goForward();
    await appTitle(page).waitFor();
    await page.getByRole("navigation", { name: "Help" }).getByRole("link", { name: "Questions" }).click();
    await page.getByRole("heading", { name: "Questions" }).waitFor();
    assert.equal(await appTitle(page).isVisible(), false);
    await page.goto(`${SITE}/#if-your-automation-stopped`);
    await page.getByText("Its votes count for nothing.").waitFor();
    assert.deepEqual(asked, [], "the page asks a wallet nothing until it is picked");
    assert.deepEqual(violations, []);
  });

  test("the views switch without the script", async () => {
    const { page } = await open(false, { url: `${SITE}/#app`, script: false });
    await appTitle(page).waitFor();
    await page.getByText("This part of the page needs its script").waitFor();
    assert.equal(await homeTitle(page).isVisible(), false);
    await page.getByRole("navigation", { name: "Help" }).getByRole("link", { name: "Questions" }).click();
    await page.getByRole("heading", { name: "Questions" }).waitFor();
    assert.equal(await appTitle(page).isVisible(), false);
    await page.goBack();
    await appTitle(page).waitFor();
    await page.getByRole("link", { name: "metaDEX Café" }).click();
    await homeTitle(page).waitFor();
    assert.equal(await appTitle(page).isVisible(), false);
    await page.getByText("These numbers are read from Base by the page's script, which has not run.").waitFor();
    await page.goto(`${SITE}/#carbon`);
    await page.getByRole("heading", { name: "Whose name is on them" }).waitFor();
    assert.equal(await homeTitle(page).isVisible(), false);
    assert.equal(await howTitle(page).isVisible(), true, "a section's address shows its view");
    await page.getByText("What the votes earned is read from Base by the page's script, which has not run.").waitFor({
      state: "attached",
    });
  });

  test("How it works at its address; a link in the review closes it, and Back keeps the ticks", async () => {
    const { page, violations } = await connected({ owner: ELSEWHERE }, { width: 390, height: 844 });
    await pick(page, 2435, 2439);
    await page.getByRole("button", { name: "Join with 2 accounts" }).click();
    await review(page).getByRole("heading", { name: "Before you join" }).waitFor();
    await review(page).getByRole("link", { name: "More on unclaimed rewards" }).click();
    assert.equal(await review(page).isVisible(), false);
    await page.getByRole("heading", { name: /^It can claim the account's rewards at once/ }).waitFor();
    assert.equal(await page.title(), "How it works · metaDEX Café");
    assert.equal(new URL(page.url()).hash, "#unclaimed-rewards");
    assert.equal(await appTitle(page).isVisible(), false);
    await page.goBack();
    await appTitle(page).waitFor();
    assert.equal(await page.getByRole("checkbox", { name: "Pick Account #2439" }).isChecked(), true);
    await page.getByRole("button", { name: "Join with 2 accounts" }).waitFor();
    await page.locator("header").getByRole("link", { name: "How it works" }).click();
    await howTitle(page).waitFor();
    assert.equal(await page.evaluate(() => document.activeElement?.textContent), "How it works");
    await page
      .locator("#if-your-automation-stopped tr")
      .filter({ hasText: "USDC" })
      .locator(".still-in")
      .getByText(/^\d[\d,]*$/)
      .waitFor();
    await shoot(page, "how-it-works-390-light");
    await page.getByRole("navigation", { name: "Sections" }).getByRole("link", { name: "Who controls what" }).click();
    await page.getByRole("heading", { name: "The admin key" }).waitFor();
    assert.equal(new URL(page.url()).hash, "#who-controls-what");
    assert.deepEqual(violations, []);
  });

  test("what the votes earned last epoch: on Home, for a member's account, and all of Hydrex once it shows", async () => {
    await warm(async () => {
      const found = (await readEarnings())!;
      await sharesOf([9540n, 14485n], found.start, found.votes);
    });
    // All of Hydrex takes too many reads for the fork to answer in time, so they are refused, and noted.
    const everyPool = toFunctionSelector("function totalWeightAt(uint256)").slice(2);
    let compared = false;
    const refuse = (body: string) => {
      const all = body.includes(everyPool);
      compared ||= all;
      return all;
    };
    const { page, violations } = await connected({ owner: MEMBER }, { width: 390, height: 844, refuse });
    // 7,919 of the automation's 897,043 votes.
    await account(page, 9540)
      .getByText(/Last epoch, its votes earned ≈\s\$6\.1\d\./)
      .waitFor({ timeout: 60_000 });
    assert.equal(await account(page, 14485).locator(".earned").isVisible(), false, "its own account voted itself");
    await shoot(page, "member-earned-390-light");
    await page.getByRole("link", { name: "metaDEX Café" }).click();
    const numbers = page.locator(".numbers");
    assert.match(await numbers.locator(".last-per-power").innerText(), /^≈\s\$0\.5\d$/);
    assert.match((await numbers.locator("time.last-start").textContent()) ?? "", /^Thu,? 8 Oct$/);
    assert.match(await page.locator("#compared .last-per-power").innerText(), /^≈\s\$0\.\d\d$/);
    assert.equal(compared, false, "all of Hydrex waits until its table is on the screen");
    await page.goto(`${SITE}/#last-epoch`);
    const table = page.locator("#last-epoch .earnings");
    assert.equal(await table.locator(".ours.earning-power").innerText(), "1.17M");
    assert.equal(await table.locator(".ours.pools").innerText(), "27 pools");
    assert.match(await table.locator(".ours.per-power").innerText(), /^≈\s\$0\.5\d$/);
    await page.locator("#last-epoch .all-failed").getByText("Reading all of Hydrex failed.").waitFor();
    assert.equal(compared, true);
    assert.equal(await page.locator("#error").isVisible(), false, "the rest of the page is as it was");
    await page.locator("#last-epoch .earned-pools summary").click();
    await page.locator("#last-epoch .earned-pools tr").filter({ hasText: "AVNT / USDC" }).waitFor();
    await shoot(page, "last-epoch-390-light");
    assert.deepEqual(violations, []);
  });

  test("an address the page cannot decode opens Home, and the script still runs", async () => {
    const { page, violations } = await open(false, { url: `${SITE}/#100%` });
    await homeTitle(page).waitFor();
    await page
      .locator(".numbers .tonnes")
      .filter({ hasText: /^\d[\d,]*$/ })
      .waitFor();
    await page.goto(`${SITE}/#%E0%A4`);
    await page.locator(".promise").getByRole("link", { name: "Open the app" }).click();
    await appTitle(page).waitFor();
    await page.getByRole("button", { name: "Browser wallet" }).waitFor();
    assert.deepEqual(violations, []);
  });

  test("join with two accounts from automations that stopped, one transaction at a time", async () => {
    const { page, sent, asked, origins, violations } = await open({ owner: ELSEWHERE }, { url: `${SITE}/#app` });
    await page.locator("time.week-start").getByText(/Thu/).waitFor();
    assert.deepEqual(asked, [], "the page asks a wallet nothing until it is picked");
    await page.getByRole("button", { name: "Test Wallet" }).click();
    await page.getByText("Connected with Test Wallet").waitFor();
    await page.getByText(/^2 accounts · 2 in automations that stopped · \d+ Earning Power$/).waitFor();
    await account(page, 2439)
      .getByText(/In USDC, which has not voted since\s+Wed,? 9 Sept?\./)
      .waitFor();
    await account(page, 2439)
      .getByText(/earned nothing from voting since\s+Thu,? 10 Sept?,/)
      .waitFor();
    const stopped = group(page, "In an automation that stopped");
    assert.equal(await stopped.getByRole("button", { name: "Join" }).isDisabled(), true);
    await pick(page, 2435, 2439);
    await shoot(page, "picked-1440-light");
    await stopped.getByRole("button", { name: "Join with 2 accounts" }).click();
    await review(page).getByText("Join Carbon Impact: step 1 of 3").waitFor();
    await review(page)
      .getByText(/#2439 is in USDC and #2435 is in Hydrex Lock Maxi:/)
      .waitFor();
    await shoot(page, "join-1-1440-light");
    await review(page).getByRole("button", { name: "Continue" }).click();
    await review(page).getByRole("heading", { name: "What changes" }).waitFor();
    assert.match(
      await review(page).locator(".pages").innerText(),
      /Thu,? 22 Oct,? 00:00 UTC \(Thu,? 22 Oct,? 02:00 your time\)\. It votes with them/,
    );
    await review(page).getByRole("button", { name: "Back" }).click();
    await toWallet(page);
    await review(page).getByText("2 transactions, one after the other:").waitFor();
    assert.deepEqual(await review(page).locator(".says").allTextContents(), [
      "#2439 leaves the USDC automation and joins Carbon Impact.",
      "#2435 leaves the Hydrex Lock Maxi automation and joins Carbon Impact.",
    ]);
    assert.deepEqual(await review(page).locator(".conduit-name").allTextContents(), ["Carbon Impact", "Carbon Impact"]);
    assert.deepEqual(await review(page).locator(".account").allTextContents(), ["2439", "2435"]);
    assert.deepEqual(await review(page).locator(".approve").allTextContents(), ["true", "true"]);
    // Shown in groups of four, an address still reads and copies as one.
    assert.equal(await review(page).locator(".conduit").first().innerText(), CONDUIT);
    assert.equal(await review(page).locator(".to").first().innerText(), VOTING_ESCROW);
    assert.equal(await review(page).locator(".count").first().textContent(), "Your wallet will ask · 1 of 2");
    assert.equal(await review(page).locator(".data").first().isVisible(), false, "the wallet shows the call's fields");
    await shoot(page, "join-3-1440-light");
    await review(page).getByRole("button", { name: "Confirm transaction 1 of 2" }).click();
    await review(page).getByText("Transaction 1 of 2 is included.").waitFor();
    await review(page).getByRole("button", { name: "Confirm transaction 2 of 2" }).click();
    await review(page).getByText("Done.").waitFor();
    await review(page).getByText("You can leave at any time from this page.").waitFor();
    await review(page).getByRole("button", { name: "Close" }).click();
    assert.equal(sent.length, 2);
    await expectApprovals([2435n, 2439n], CONDUIT, CONDUIT);
    // Lock Maxi's ERC-5725 claim approval stays, but the VotingEscrow does not use it for claims.
    assert.equal(await view(VOTING_ESCROW, "getClaimApproved", [2435n]), LOCK_MAXI);
    await group(page, "Joining").getByText("Joined Carbon Impact.").first().waitFor();
    await account(page, 2439).getByText("Joined Carbon Impact.").waitFor();
    await account(page, 2435).getByText("Joined Carbon Impact.").waitFor();
    assert.deepEqual([...new Set(asked)].sort(), ["eth_chainId", "eth_requestAccounts", "eth_sendTransaction"]);
    assert.deepEqual([...origins].sort(), [SITE, ...RPC_ORIGINS].filter((o) => origins.has(o)).sort());
    assert.ok(origins.has(SITE));
    assert.deepEqual(violations, []);
  });

  test("a receipt for each of the owner's accounts in the last payout, read from the automation's events", async () => {
    // PAYEE has 93 accounts: anvil reads them from FORK_URL for most of a minute the first time.
    await warm(() => Promise.all([readAccounts(PAYEE), lastRun()]));
    const { page, violations } = await connected(
      { owner: PAYEE },
      { width: 390, height: 844, dark: true, flowing: true },
    );
    const receipt = page.locator("#receipts .receipt");
    await receipt.first().waitFor({ timeout: 120_000 });
    assert.equal(await receipt.count(), 1);
    assert.match(
      await page.locator("#receipts .receipts-found").innerText(),
      /^For #82774, in Carbon Impact's payout of Wed,? 23 Sept?\./,
    );
    assert.equal(await receipt.locator(".receipt-id").innerText(), "#82774");
    assert.equal(await receipt.locator(".receipt-earned").innerText(), "8.56 USDC and 89.04 HYDX");
    assert.equal(await receipt.locator(".receipt-swapped").innerText(), "1,053.92 kVCM");
    assert.equal(await receipt.locator(".receipt-retired").innerText(), "−326.80 kVCM");
    assert.equal(await receipt.locator(".receipt-tonnes").innerText(), "65.26 t of carbon credits");
    assert.equal(await receipt.locator(".receipt-fee").innerText(), "0 kVCM");
    assert.equal(await receipt.locator(".receipt-paid").innerText(), "727.11 kVCM");
    // The epoch it paid for. The time is a label, which CSS shows in capitals, so it is read with textContent.
    assert.match((await receipt.locator(".receipt-day").textContent()) ?? "", /^Thu,? 10 Sept? to Thu,? 17 Sept?$/);
    assert.equal(await receipt.locator(".receipt-retired-share").innerText(), "31.01%");
    assert.equal(await receipt.locator(".receipt-fee-share").innerText(), "0%");
    assert.equal(await receipt.locator(".receipt-entity").innerText(), "Hydrex");
    assert.equal(await receipt.locator(".total dt").textContent(), "Paid to you");
    assert.equal(await receipt.locator(".receipt-elsewhere").isVisible(), false, "paid to the owner itself");
    assert.match((await receipt.locator("time.receipt-time").textContent()) ?? "", /^Wed,? 23 Sept?,? 17:44 UTC$/);
    assert.equal(
      await receipt.locator(".through img").isVisible(),
      true,
      "Klima Protocol's mark, beside the retirement",
    );
    assert.equal(
      await receipt.getByRole("link", { name: "Transaction" }).getAttribute("href"),
      "https://basescan.org/tx/0x0932e5a24f24e45bfd1021764d94abc1d920754c4dc17128dd89f44bd086e899",
    );
    await shoot(page, "receipt-390-dark", page.locator("#receipts"));
    // After the flip, the page reads Carbon Impact again and fills its figures, such as .tonnes, across the page. The
    // receipts keep their own.
    const entityName = toFunctionSelector("function retiringEntityName()").slice(2);
    const readAgain = page.waitForResponse((response) => !!response.request().postData()?.includes(entityName));
    await page.clock.setSystemTime((FLIP + 60) * 1000);
    await page.clock.runFor(30_000);
    await readAgain;
    await page.waitForTimeout(500);
    assert.equal(await receipt.locator(".receipt-retired").innerText(), "−326.80 kVCM");
    assert.equal(await receipt.locator(".receipt-tonnes").innerText(), "65.26 t of carbon credits");
    const member = await connected({ owner: MEMBER }, { width: 390, height: 844 });
    await member.page
      .locator("#receipts")
      .getByText(/Carbon Impact's last payout, on Wed,? 23 Sept?, paid none of your accounts\./)
      .waitFor({ timeout: 120_000 });
    assert.deepEqual([...violations, ...member.violations], []);
  });

  test("join with an account of its own; the header shows the wallet on every view", async () => {
    const { page, sent } = await connected({ owner: NEWCOMER });
    await account(page, 141).getByText("Not in an automation.").waitFor();
    await account(page, 42877)
      .getByText(/In Liquid Hydrex, which has not voted since\s+Wed,? 9 Sept?\./)
      .waitFor();
    await page.locator(".empty-accounts summary").click();
    await page.locator(".empty-accounts li").getByText("Empty.").waitFor();
    assert.equal(await page.locator(".empty-accounts .pick").isVisible(), false, "an empty account has no box");
    assert.equal(await account(page, 141).locator(".pick").isVisible(), false, "a group of one has no box");
    await page.getByRole("link", { name: "metaDEX Café" }).click();
    await homeTitle(page).waitFor();
    await page.locator("header").getByText("0x0208…4C95").waitFor();
    await page
      .locator("header")
      .getByRole("link", { name: /connected as 0x0208…4C95/ })
      .click();
    await appTitle(page).waitFor();
    await group(page, "Can join").getByRole("button", { name: "Join", exact: true }).click();
    await toWallet(page);
    await review(page).getByText("One transaction:").waitFor();
    assert.deepEqual(await review(page).locator(".says").allTextContents(), ["#141 joins Carbon Impact."]);
    await confirm(page);
    assert.equal(sent.length, 1);
    await expectApprovals([141n], CONDUIT, CONDUIT);
    await account(page, 141).getByText("Joined Carbon Impact.").waitFor();
  });

  test("closing between transactions stops there; a link then opens in a new tab", async () => {
    const { page, sent } = await connected({ owner: ELSEWHERE });
    await pick(page, 2435, 2439);
    await page.getByRole("button", { name: "Join with 2 accounts" }).click();
    await toWallet(page);
    await review(page).getByRole("button", { name: "Confirm transaction 1 of 2" }).click();
    await review(page).getByText("closing stops here").waitFor();
    const [tab] = await Promise.all([
      page.context().waitForEvent("page"),
      review(page).getByRole("link", { name: "How to check these calls" }).first().click(),
    ]);
    await tab.waitForURL(`${SITE}/#verify`);
    await review(page).getByRole("button", { name: "Confirm transaction 2 of 2" }).waitFor();
    await review(page).getByRole("button", { name: "Close" }).click();
    await account(page, 2439).getByText("Joined Carbon Impact.").waitFor();
    await account(page, 2435)
      .getByText(/In Hydrex Lock Maxi, which has not voted/)
      .waitFor();
    assert.equal(sent.length, 1);
    await expectApprovals([2435n], LOCK_MAXI, LOCK_MAXI);
  });

  test("a wallet that locks is let go, and connects again from a click", async () => {
    const { page } = await connected({ owner: NEWCOMER });
    await account(page, 141).waitFor();
    await page.evaluate(() => (window as any).testWalletEmit("accountsChanged", []));
    await page.getByText("Pick your wallet").waitFor();
    for (const part of ["#accounts", "#summary", "#payout"]) assert.equal(await page.locator(part).isVisible(), false);
    await page.locator("header").getByText("Open the app").waitFor();
    await page.getByRole("button", { name: "Test Wallet" }).click();
    await account(page, 141).waitFor();
  });

  test("closing the review before Base includes the transaction still updates the account", async () => {
    const { page } = await connected({ owner: NEWCOMER });
    await group(page, "Can join").getByRole("button", { name: "Join", exact: true }).click();
    await toWallet(page);
    await anvil("evm_setAutomine", [false]);
    try {
      await review(page).getByRole("button", { name: "Confirm in your wallet" }).click();
      await review(page).getByText("Waiting for Base to include it").waitFor();
      await review(page).getByRole("button", { name: "Close" }).click();
      await account(page, 141).getByText("Not in an automation.").waitFor();
      // Mine only after the page has polled again: it polls every two seconds.
      await page.waitForTimeout(5_000);
      await anvil("evm_mine");
    } finally {
      await anvil("evm_setAutomine", [true]);
    }
    await account(page, 141).getByText("Joined Carbon Impact.").waitFor();
  });

  test("leave with one account", async () => {
    const { page, sent } = await connected({ owner: MEMBER }, { width: 390, height: 844, dark: true });
    await account(page, 9540).getByText("In Carbon Impact.").waitFor();
    await account(page, 14485).getByText("Not in an automation.").waitFor();
    await shoot(page, "member-390-dark");
    await group(page, "In Carbon Impact").getByRole("button", { name: "Leave" }).click();
    await review(page).getByRole("heading", { name: "Leave Carbon Impact" }).waitFor();
    await review(page).getByText("One transaction:").waitFor();
    assert.equal(await review(page).locator(".step-count").isVisible(), false, "one step");
    await shoot(page, "leave-390-dark");
    await confirm(page);
    await expectApprovals([9540n], MEMBER, zeroAddress);
    await account(page, 9540).getByText("Left Carbon Impact.").waitFor();
    assert.equal(sent.length, 1);
  });

  test("leave an automation that stopped, to vote yourself", async () => {
    const { page, sent } = await connected({ owner: ELSEWHERE }, { width: 390, height: 844 });
    await account(page, 2439)
      .getByText(/In USDC, which has not voted/)
      .waitFor();
    await shoot(page, "stopped-390-light");
    await pick(page, 2439);
    await group(page, "In an automation that stopped").getByRole("button", { name: "Leave with 1 account" }).click();
    await review(page).getByRole("heading", { name: "Leave USDC" }).waitFor();
    await review(page).getByText("USDC can no longer claim the rewards of #2439.").waitFor();
    assert.deepEqual(await review(page).locator(".says").allTextContents(), ["#2439 leaves the USDC automation."]);
    assert.deepEqual(await review(page).locator(".conduit-name").allTextContents(), ["The USDC automation"]);
    assert.equal(await review(page).locator(".conduit").innerText(), USDC);
    assert.equal(await review(page).locator(".approve").innerText(), "false");
    assert.equal(await review(page).locator(".count").textContent(), "Your wallet will ask", "one call has no count");
    await shoot(page, "release-390-light");
    await confirm(page);
    assert.equal(sent.length, 1);
    await expectApprovals([2439n], ELSEWHERE, zeroAddress);
    await group(page, "Can join")
      .getByText(/Left USDC\.\s+You vote with it from\s+Thu,? 22 Oct\./)
      .waitFor();
    await account(page, 2435)
      .getByText(/In Hydrex Lock Maxi, which has not voted/)
      .waitFor();
  });

  test("an ended lock offers nothing to tick", async () => {
    const { page } = await connected({ owner: ENDED });
    await account(page, 123351).getByText("Lock ended.").waitFor();
    await group(page, "Can't join").getByText("#123351").waitFor();
    assert.equal(await account(page, 123351).locator(".pick").isVisible(), false);
    assert.equal(await group(page, "Can't join").getByRole("button").count(), 0);
    await account(page, 123351).click();
    assert.equal(await account(page, 123351).locator(".pick").isChecked(), false);
    await account(page, 123364).waitFor();
  });

  test("without a wallet in the browser, Browser wallet links to wallet apps", async () => {
    const { page } = await open(false, { width: 390, height: 844, url: `${SITE}/#app` });
    await page.getByRole("button", { name: "Browser wallet" }).click();
    await page.getByText("No wallet was found in this browser.").waitFor();
    const links = page.locator("#no-wallet a");
    assert.deepEqual(await links.allTextContents(), ["Coinbase Wallet", "MetaMask"]);
    assert.deepEqual(await links.evaluateAll((found) => found.map((link) => (link as HTMLAnchorElement).href)), [
      "https://go.cb-w.com/dapp?cb_url=https%3A%2F%2Fmetadex.cafe%2F%23app",
      "https://link.metamask.io/dapp/metadex.cafe/#app",
    ]);
    await shoot(page, "no-wallet-390-light");
    assert.equal(await page.locator("#accounts").isVisible(), false);
  });

  test("the wrong network, a refusal in the wallet, and a transaction that fails", async () => {
    const { page, wallet, sent } = await connected({ owner: NEWCOMER, chainId: 1, decline: true });
    await page.getByText("Your wallet is on another network.").waitFor();
    const joinOwn = group(page, "Can join").getByRole("button", { name: "Join", exact: true });
    await joinOwn.click();
    await toWallet(page);
    await review(page).getByRole("button", { name: "Switch to Base" }).click();
    await review(page).getByRole("button", { name: "Confirm in your wallet" }).click();
    await review(page).getByText("You said no in your wallet.").waitFor();
    assert.equal(sent.length, 1);
    await expectApprovals([141n], NEWCOMER, zeroAddress);
    await page.keyboard.press("Escape");
    assert.equal(await review(page).isVisible(), false);
    assert.equal(await page.getByText("Your wallet is on another network.").isVisible(), false);

    const data = encodeFunctionData({ abi, functionName: "transferFrom", args: [NEWCOMER, RECIPIENT, 141n] });
    await anvil("eth_sendTransaction", [{ from: NEWCOMER, to: VOTING_ESCROW, data }]);
    wallet.decline = false;
    await joinOwn.click();
    await toWallet(page);
    await review(page).getByRole("button", { name: "Confirm in your wallet" }).click();
    await review(page).getByText("A transaction failed on Base.").waitFor();
    assert.equal(await review(page).locator(".confirm").isVisible(), false);
    assert.equal(sent.length, 2);
  });

  test("if the Voter cannot be read, the accounts still show", async () => {
    await anvil("anvil_setCode", [VOTER, "0x"]);
    const { page } = await connected({ owner: ELSEWHERE });
    await account(page, 2439).getByText("In another Hydrex automation: USDC.").waitFor();
    await group(page, "Can join").getByText("#2435").waitFor();
    assert.equal(await page.locator("#error").isVisible(), false);
  });

  test("Back while the wallet asks closes the review, which still follows what it sent", async () => {
    let answer = () => {};
    const sending = new Promise<void>((resolve) => (answer = resolve));
    const { page, sent } = await connected({ owner: NEWCOMER, sending });
    await group(page, "Can join").getByRole("button", { name: "Join", exact: true }).click();
    await toWallet(page);
    await review(page).getByRole("button", { name: "Confirm in your wallet" }).click();
    await review(page).getByText("Waiting for your wallet…").waitFor();
    await review(page).getByRole("button", { name: "Back" }).click();
    assert.equal(await review(page).isVisible(), false);
    answer();
    await account(page, 141).getByText("Joined Carbon Impact.").waitFor();
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
    await account(page, 9540).getByText("In Carbon Impact.").waitFor();
    await group(page, "In Carbon Impact").getByRole("button", { name: "Leave" }).click();
    await review(page).getByRole("heading", { name: "Leave Carbon Impact" }).waitFor();
    await page.keyboard.press("Escape");
    assert.equal(await page.locator("#epoch time.week-start").innerText(), "…");
    opened.rpc.refuse = undefined;
    await page.clock.runFor(30_000);
    await page.locator("#epoch time.week-start").getByText(/Thu/).waitFor();
    await page.getByRole("button", { name: "Try again" }).click();
    await page.getByRole("button", { name: "Test Wallet" }).waitFor();
    await appTitle(page).waitFor();
    assert.equal(new URL(page.url()).hash, "#app");
  });

  test("a wallet that cannot switch to Base says so", async () => {
    const { page } = await connected({ owner: NEWCOMER, chainId: 1, switches: false });
    await page.locator("#wrong-chain").getByRole("button", { name: "Switch to Base" }).click();
    await page.getByText("Your wallet did not switch.").waitFor();
  });

  test("inside Safe{Wallet}, a Safe proposes leaving with two accounts as one Safe transaction", async () => {
    const { page, origins, violations } = await open(false, { url: `${SAFE_WALLET}/` });
    const app = page.frameLocator("iframe");
    const dialog = app.locator("#review");
    await app.getByText("Connected with Safe{Wallet}").waitFor();
    assert.equal(await app.getByRole("heading", { name: "Your accounts", level: 1 }).isVisible(), true);
    assert.equal(
      await app.getByRole("heading", { name: "Your Hydrex votes, retiring carbon credits and paying you" }).isVisible(),
      false,
    );
    await app.getByRole("checkbox", { name: "Pick Account #53350" }).check();
    await app.getByRole("checkbox", { name: "Pick Account #82206" }).check();
    await app.getByRole("button", { name: "Leave with 2 accounts" }).click();
    await dialog
      .getByText(/^One Safe transaction, with 2 calls\. Safe\{Wallet\} sends them through its MultiSend contract/)
      .waitFor();
    const call = dialog.locator(".slip").first();
    assert.equal(await call.locator(".conduit").innerText(), CONDUIT, "co-signers see the address, not only its name");
    assert.equal(await call.locator(".conduit-name").innerText(), "Carbon Impact");
    assert.equal(await call.locator(".call").innerText(), "The call above, in 100 bytes:");
    assert.equal(await call.locator(".count").textContent(), "In a Safe · call 1 of 2");
    assert.equal(
      await call.locator(".slip-note").innerText(),
      "The selector, then each 32-byte word on two lines: the conduit, 53350 as d066, and false as 0.",
    );
    assert.equal(await dialog.locator(".operation").first().isVisible(), false, "Safe{Wallet} sets the operation");
    await shoot(page, "safe-calls-1440-light");
    await dialog.getByRole("button", { name: "Propose in Safe{Wallet}" }).click();
    await dialog.getByText("Proposed.").waitFor();
    await dialog.getByRole("link", { name: "https://metadex.cafe/#for-co-signers" }).waitFor();
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
    await page.getByText("did not connect").waitFor();
    approve();
    await page.getByText("Connected with Test Wallet").waitFor();
    await account(page, 141).waitFor();
  });

  // Last, as it moves anvil's clock on.
  test("in a new epoch, Join reads again before any review, and the page moves on by itself", async () => {
    const data = encodeFunctionData({ abi, functionName: "setConduitApproval", args: [CONDUIT, 141n, true] });
    await anvil("eth_sendTransaction", [{ from: NEWCOMER, to: VOTING_ESCROW, data, gas: GAS }]);
    const { page } = await connected({ owner: NEWCOMER }, { flowing: true });
    await account(page, 141).getByText("Joined Carbon Impact.").waitFor();
    await anvil("evm_setNextBlockTimestamp", [FLIP + 60]);
    await anvil("evm_mine");
    await page.clock.setSystemTime((FLIP + 60) * 1000);
    const joinStopped = group(page, "In an automation that stopped").getByRole("button", { name: "Join" });
    await joinStopped.click();
    await account(page, 141).getByText("In Carbon Impact.").waitFor();
    await page.getByText(/Thu,? 22 Oct to Thu,? 29 Oct, 00:00 UTC/).waitFor();
    assert.equal(await review(page).isVisible(), false);
    await joinStopped.click();
    await review(page).getByRole("button", { name: "Continue" }).click();
    assert.match(await review(page).locator(".pages").innerText(), /Thu,? 29 Oct,? 00:00 UTC/);
    await page.keyboard.press("Escape");

    await anvil("evm_setNextBlockTimestamp", [FLIP + WEEK + 60]);
    await anvil("evm_mine");
    await page.clock.setSystemTime((FLIP + WEEK + 60) * 1000);
    await page.clock.runFor(30_000);
    await page.getByText(/Thu,? 29 Oct to Thu,? 5 Nov, 00:00 UTC/).waitFor();
    await page
      .locator("#epoch .countdown")
      .getByText(/^in 6 d 23 h$/)
      .waitFor();
  });
});
