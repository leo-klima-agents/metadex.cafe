import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { after, afterEach, before, beforeEach, describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { chromium, type Browser, type BrowserContext, type Locator, type Page, type Route } from "playwright-core";
import {
  concat,
  decodeFunctionResult,
  encodeFunctionData,
  getAddress,
  getContractAddress,
  keccak256,
  parseAbi,
  toFunctionSelector,
  toHex,
  zeroAddress,
  type Address,
  type Hex,
} from "viem";
import { blockTime, read, same } from "../src/chain.ts";
import { AUTOMAXI, CARBON_IMPACT, KEEPER, RPCS, SWAPPERS, VOTER, VOTING_ESCROW } from "../src/config.ts";
import { readEarnings, rewardsFor, sharesOf, type Reward } from "../src/earnings.ts";
import { WEEK, short } from "../src/format.ts";
import { readAccounts } from "../src/hydrex.ts";
import { pricesAt } from "../src/prices.ts";
import { SETTLED, payoutBlocks, payoutsIn, readEarned, readStamps, standingOf, weighed } from "../src/receipts.ts";
import { findRoute } from "../src/swap.ts";
import { describe as describeTokens, holdingsOf, known } from "../src/tokens.ts";

const CONDUIT = CARBON_IMPACT.address;
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
// Carbon Impact's last payout before BLOCK: one transaction, on Wed 23 Sep, that paid these accounts through Thu 17 Sep.
const PAID = 51_698_051;
const PAID_THROUGH = 1_789_603_200;
const PAID_TX = "0x0932e5a24f24e45bfd1021764d94abc1d920754c4dc17128dd89f44bd086e899";
const PAID_IDS = [26432n, 82774n, 14247n, 35366n];
const LIQUID_HYDREX = getAddress("0x809F8175b8F60960dF2bc7a78a7C4Eb04d138AF0");
const LOCK_MAXI = getAddress("0x53388a4E98Bb56F8571433F5461010Fc287929d3");
const USDC = getAddress("0xE57b3Ea02336B9b418cA523aB5aD6f479d93bD1D");
const RECIPIENT = getAddress("0x000000000000000000000000000000000000beef");
const STRANGER = getAddress("0x000000000000000000000000000000000000dead");
// AutoMaxi deploys through the CREATE2 deployer, with the salt and init code of its script/Deploy.s.sol at tag v2,
// commit 718c107. The init code was compiled from its verification/ input with solc 0.8.37.
const CREATE2_DEPLOYER = getAddress("0x4e59b44847b379578588920cA78FbF26c0B4956C");
const SALT = keccak256(toHex("metadex.cafe/ImmutableVeTokenConduit/v2"));
const INIT_CODE = readFileSync(new URL("fixtures/automaxi-init-code.hex", import.meta.url), "utf8").trim() as Hex;
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
  "function claim(uint256 tokenId, address[] feeAddresses, address[] bribeAddresses, address[] tokens) returns (uint256[])",
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

// Sends a transaction, and waits for Base, or anvil, to include it.
// A transaction that anvil has not mined in two minutes, even reading its state from FORK_URL, fails its test there
// and then, rather than at the suite's timeout.
async function mined(from: Address, to: Address, data: Hex): Promise<void> {
  const hash = await anvil<Hex>("eth_sendTransaction", [{ from, to, data, gas: "0xf42400" }]);
  for (const deadline = Date.now() + 120_000; Date.now() < deadline;) {
    const receipt = await anvil<{ status: Hex } | null>("eth_getTransactionReceipt", [hash]);
    if (receipt) return assert.equal(receipt.status, "0x1", `${hash} failed`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.fail(`${hash} was not mined in two minutes`);
}

// AutoMaxi's constructor needs fresh Chainlink prices and Base's sequencer up. anvil's clock runs on from the fork's,
// so it deploys a minute after BLOCK.
async function deployAutoMaxi(): Promise<void> {
  const { timestamp } = await anvil<{ timestamp: Hex }>("eth_getBlockByNumber", [hex(BLOCK), false]);
  await anvil("evm_setNextBlockTimestamp", [Number(timestamp) + 60]);
  await anvil("anvil_setBalance", [KEEPER, "0x16345785d8a0000"]);
  await mined(KEEPER, CREATE2_DEPLOYER, concat([SALT, INIT_CODE]));
  const at = getContractAddress({ opcode: "CREATE2", from: CREATE2_DEPLOYER, salt: SALT, bytecode: INIT_CODE });
  assert.equal(at, AUTOMAXI.address);
  assert.equal(keccak256(await anvil<Hex>("eth_getCode", [at, "latest"])), AUTOMAXI.codeHash);
}

// The page reads a few blocks before the latest, which on the fork can be before the last transactions. Blocks after
// BLOCK make anvil read the state it lacks a slot at a time, so only the tests that need them mine them.
const settle = () => anvil("anvil_mine", [hex(SETTLED + 1)]);

// A claim through AutoMaxi of one reward, from its fees or incentives contract.
async function claimOne(from: Address, id: bigint, { contract, token, fee }: Reward): Promise<void> {
  const args = [id, fee ? [contract] : [], fee ? [] : [contract], [token.address]];
  await mined(from, AUTOMAXI.address, encodeFunctionData({ abi, functionName: "claim", args } as never));
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
  // Sends several calls in one prompt, with EIP-5792, as Coinbase Wallet and MetaMask do.
  batch?: boolean;
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
  const batches = new Map<string, Hex[]>();
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
      case "wallet_getCapabilities":
        if (!options.batch) return { error: { code: 4200, message: "The test wallet does not batch." } };
        return { result: { [hex(8453)]: { atomic: { status: "supported" } } } };
      case "wallet_sendCalls": {
        if (!options.batch) return { error: { code: 4200, message: "The test wallet does not batch." } };
        const { calls } = params[0] as { calls: Sent[] };
        if (options.decline) return { error: { code: 4001, message: "User rejected the request." } };
        // One after the other, each in its own block: anvil has no account code to run them together.
        const hashes: Hex[] = [];
        for (const { to, data } of calls) {
          sent.push({ to, data });
          hashes.push(await anvil<Hex>("eth_sendTransaction", [{ to, data, from: options.owner, gas: "0xf42400" }]));
        }
        const id = `0x${(batches.size + 1).toString(16).padStart(64, "0")}`;
        batches.set(id, hashes);
        return { result: { id } };
      }
      case "wallet_getCallsStatus": {
        const hashes = batches.get(params[0] as string) ?? [];
        const receipts = await Promise.all(
          hashes.map((hash) => anvil<{ status: Hex } | null>("eth_getTransactionReceipt", [hash])),
        );
        if (receipts.some((receipt) => !receipt)) return { result: { status: 100 } };
        return { result: { status: 200, atomic: true, receipts } };
      }
      default:
        return { error: { code: 4200, message: `The test wallet does not answer ${method}.` } };
    }
  };
}

// Requests the page sent to anvil that it has not answered yet. A test can end while the page waits on one, and once
// anvil stops, the request fails in a handler that nobody awaits any more. So anvil answers them all before it stops.
const forwarding = new Set<Promise<string>>();

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
    const reply = post(request.postData() ?? "");
    forwarding.add(reply);
    const body = await reply.finally(() => forwarding.delete(reply));
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

// Connected on the Hydrex accounts' page, unless `options` says where.
async function connected(wallet: Partial<WalletOptions>, options?: OpenOptions): Promise<Opened> {
  const opened = await open(wallet, { url: `${SITE}/#hydrex`, ...options });
  await opened.page.getByRole("button", { name: "Test Wallet" }).click();
  return opened;
}

const app = (page: Page) => page.locator('.view[data-view="app"]');
const hydrex = (page: Page) => page.locator('.view[data-view="hydrex"]');
const account = (page: Page, id: number) =>
  hydrex(page)
    .locator("#accounts li")
    .filter({ hasText: `#${id}` });
// The Hydrex accounts' groups: "needs", "in:carbon-impact", "in:automaxi", "other" and "closed".
const group = (page: Page, key: string) => hydrex(page).locator(`.group[data-group="${key}"]`);
const product = (page: Page, kind: string) => page.locator(`.view[data-kind="${kind}"]`);
const position = (page: Page) => page.locator('.view[data-view="position"]');
const review = (page: Page) => page.locator("#review");
const homeTitle = (page: Page) =>
  page.getByRole("heading", { name: "Vote, claim and swap on Base, from your own wallet" });
const appTitle = (page: Page) => page.getByRole("heading", { name: "Your wallet", level: 1 });
const hydrexTitle = (page: Page) => page.getByRole("heading", { name: "Your Hydrex accounts", level: 1 });
const toHydrex = (page: Page) => page.goto(`${SITE}/#hydrex`);
const chip = (page: Page, owner: Address) => page.locator("header").getByText(short(owner));

// Goes through the join's first step, to the calls.
async function toWallet(page: Page): Promise<void> {
  await review(page).getByRole("heading", { name: "Before you join" }).waitFor();
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
// Starts anvil on a fork of Base at `block`, and Chromium; and the hooks that put anvil back after each test.
async function start(block: number, owners: Address[]): Promise<void> {
  node = spawn(
    "anvil",
    // A free archive RPC times out now and then: anvil asks it again, after a second, up to twenty times.
    [
      ...["--fork-url", FORK_URL, "--fork-block-number", String(block), "--port", String(PORT), "--auto-impersonate"],
      ...["--retries", "20", "--fork-retry-backoff", "1000"],
    ],
    { stdio: ["ignore", "ignore", process.env.ANVIL_LOG ? "inherit" : "ignore"] },
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
  for (const owner of owners) await anvil("anvil_setBalance", [owner, "0x16345785d8a0000"]); // 0.1 ETH
  browser = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
}

async function stop(): Promise<void> {
  await browser?.close();
  await Promise.allSettled(forwarding);
  node?.kill();
  // The next fork reuses the port once this one has let it go.
  await new Promise((resolve) => setTimeout(resolve, 1_000));
}

function hooks(): void {
  beforeEach(async () => {
    snapshot = await anvil<Hex>("evm_snapshot");
  });
  afterEach(async () => {
    for (const context of contexts.splice(0)) await context.close();
    // anvil hangs on a revert while it estimates gas, as for the join review, so it first answers what the page sent.
    await Promise.allSettled(forwarding);
    await anvil("evm_revert", [snapshot]);
  });
}

describe("the page against a fork of Base", { timeout: 1_800_000 }, () => {
  before(async () => {
    await start(BLOCK, [MEMBER, NEWCOMER, ELSEWHERE, LEAVER, ENDED]);
    // Carbon Impact paid nothing from Wed 23 Sep, so for any account in it, the payouts also read the pools of the epoch
    // from Thu 1 Oct among every pool's reward contracts. Through anvil, that takes minutes the first time, and would
    // hold up each test's own reads.
    await warm(() => rewardsFor(CONDUIT, FLIP - 3 * WEEK));
  });
  after(stop);
  hooks();

  test("Home first, the App at its address, Back and Forward, About, and an address the page does not know", async () => {
    const { page, asked, violations } = await open({ owner: NEWCOMER }, { width: 390, height: 844 });
    await homeTitle(page).waitFor();
    assert.equal(await appTitle(page).isVisible(), false);
    assert.equal(await page.title(), "metaDEX Café");
    // Home holds a heading, a line, its one button and the line on the stopped automations: no figures.
    const home = page.locator('.view[data-view="home"]');
    assert.deepEqual(await home.locator(".buttons a").allTextContents(), ["Open the app"]);
    await home.getByText("Many of Hydrex's automations, such as USDC, stopped voting on Wed 9 Sep.").waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.scrollHeight), 844, "Home fits one screen");
    await shoot(page, "home-390-light");
    await home.getByRole("link", { name: "Open the app" }).click();
    await appTitle(page).waitFor();
    assert.equal(await homeTitle(page).isVisible(), false);
    assert.equal(await page.title(), "Your wallet · metaDEX Café");
    assert.equal(await page.evaluate(() => document.activeElement?.textContent), "Your wallet");
    // The App lists the products: the Hydrex automations, and the swap.
    assert.deepEqual(await app(page).locator("#products h3").allInnerTexts(), [
      "Hydrex automations",
      "Swap many tokens into one",
    ]);
    assert.equal(await page.locator("header .to-app").getAttribute("aria-current"), "page");
    await app(page).getByRole("button", { name: "Test Wallet" }).waitFor();
    await shoot(page, "app-390-light");
    await page.goBack();
    await homeTitle(page).waitFor();
    assert.equal(await page.title(), "metaDEX Café");
    assert.equal(await page.locator("header .to-app").getAttribute("aria-current"), null);
    await page.goForward();
    await appTitle(page).waitFor();
    await page.locator("footer").getByRole("link", { name: "About" }).click();
    await page.getByRole("heading", { name: "About", level: 1 }).waitFor();
    assert.equal(await page.title(), "About · metaDEX Café");
    await page.goto(`${SITE}/#about/figures`);
    await page.getByRole("heading", { name: "How the figures are read" }).waitFor();
    await page.getByText("Earning Power is shown as on Hydrex: 1.3 times the votes the contracts count.").waitFor();
    await page.goto(`${SITE}/#how-it-works`);
    await homeTitle(page).waitFor();
    assert.deepEqual(asked, [], "the page asks a wallet nothing until it is picked");
    assert.deepEqual(violations, []);
  });

  test("without the script, Home shows and says that the page needs it", async () => {
    const { page } = await open(false, { url: `${SITE}/#app`, script: false });
    await homeTitle(page).waitFor();
    // Chromium still parses <noscript> as if scripts ran when Playwright turns them off, so its words are read raw.
    assert.match(await page.locator("noscript").innerHTML(), /This page needs its script\./);
    assert.equal(await appTitle(page).isVisible(), false);
  });

  test("a link in the review opens its section, Back keeps the ticks, and an account's page says what stopped", async () => {
    const { page, violations } = await connected({ owner: ELSEWHERE }, { width: 390, height: 844 });
    await pick(page, 2435, 2439);
    await page.getByRole("button", { name: "Join Carbon Impact with 2 accounts" }).click();
    await review(page).getByRole("heading", { name: "Before you join" }).waitFor();
    await review(page).getByRole("link", { name: "Who controls what" }).click();
    assert.equal(await review(page).isVisible(), false);
    await page.getByRole("heading", { name: "The admin key" }).waitFor();
    assert.equal(await page.title(), "Carbon Impact · metaDEX Café");
    assert.equal(new URL(page.url()).hash, "#hydrex/carbon-impact/control");
    assert.equal(await appTitle(page).isVisible(), false);
    await page.goBack();
    await hydrexTitle(page).waitFor();
    assert.equal(await page.getByRole("checkbox", { name: "Pick Account #2439" }).isChecked(), true);
    await page.getByRole("button", { name: "Join Carbon Impact with 2 accounts" }).waitFor();
    await account(page, 2439).getByRole("link", { name: "Account #2439" }).click();
    await position(page).getByRole("heading", { name: "Account #2439", level: 1 }).waitFor();
    assert.equal(new URL(page.url()).hash, "#hydrex/2439");
    assert.equal(await page.evaluate(() => document.activeElement?.textContent?.trim()), "Account #2439");
    await position(page).getByText("Its votes count for nothing").waitFor();
    await position(page)
      .getByText(/It has earned nothing from voting since\s+Thu,? 10 Sept?\./)
      .waitFor();
    await position(page).getByRole("button", { name: "Join Carbon Impact", exact: true }).waitFor();
    await position(page).getByRole("button", { name: "Leave", exact: true }).waitFor();
    assert.equal(await position(page).locator(".position-owner-row").isVisible(), false, "its own account");
    await shoot(page, "stopped-account-390-light");
    await position(page).getByRole("navigation", { name: "Breadcrumb" }).getByRole("link", { name: "Hydrex" }).click();
    await hydrexTitle(page).waitFor();
    await hydrex(page).getByRole("navigation", { name: "Breadcrumb" }).getByRole("link", { name: "App" }).click();
    await appTitle(page).waitFor();
    // The App says what needs you across the products: here, the accounts in automations that stopped.
    const needs = app(page).locator("#needs");
    await needs.getByRole("heading", { name: "Needs you · 2" }).waitFor();
    await needs.getByText(/^#2439 is in USDC, which stopped on Wed,? 9 Sept?\. It earns nothing\.$/).waitFor();
    assert.equal(
      await needs
        .locator("li")
        .filter({ hasText: "#2439" })
        .getByRole("link", { name: "Change it" })
        .getAttribute("href"),
      "#hydrex/2439",
    );
    await app(page).locator(".hydrex-yours").getByText("Yours: 2 accounts").waitFor();
    assert.deepEqual(violations, []);
  });

  test("what the votes earned last epoch: on the menu, for a member's account, and all of Hydrex once its fold opens", async () => {
    await warm(async () => {
      const found = (await readEarnings(CONDUIT))!;
      await sharesOf([9540n, 14485n], found.start, found.votes, CONDUIT);
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
      .getByText(/≈\s\$6\.1\d last epoch/)
      .waitFor({ timeout: 60_000 });
    assert.equal(await account(page, 14485).locator(".earned").isVisible(), false, "its own account voted itself");
    await shoot(page, "member-earned-390-light");
    const menu = hydrex(page).locator('.choice[data-choice="carbon-impact"]');
    assert.match(
      await menu.locator(".record").innerText(),
      /^≈\s\$0\.5\d earned per 1,000 Earning Power, ≈\s\$0\.\d\d paid to you$/,
    );
    await page.goto(`${SITE}/#hydrex/carbon-impact`);
    const impact = product(page, "carbon-impact");
    assert.match(await impact.locator(".record-when").innerText(), /^Thu,? 8 Oct to Thu,? 15 Oct:/);
    assert.equal(compared, false, "all of Hydrex waits until its fold opens");
    await page.goto(`${SITE}/#hydrex/carbon-impact/record`);
    const table = impact.locator(".earnings");
    assert.equal(await table.locator(".ours.earning-power").innerText(), "1.17M");
    assert.equal(await table.locator(".ours.pools").innerText(), "27 pools");
    assert.match(await table.locator(".ours.per-power").innerText(), /^≈\s\$0\.5\d$/);
    await impact.locator(".all-failed").getByText("Reading all of Hydrex failed.").waitFor();
    assert.equal(compared, true);
    assert.equal(await page.locator("#error").isVisible(), false, "the rest of the page is as it was");
    await impact.locator(".earned-pools tr").filter({ hasText: "AVNT / USDC" }).waitFor();
    await shoot(page, "record-390-light");
    // An account's page keeps what its votes earned once the wallet locks.
    await page.goto(`${SITE}/#hydrex/9540`);
    const earnedRow = position(page).locator(".position-earned-row");
    await earnedRow.getByText(/≈\s\$6\.1\d/).waitFor();
    await page.evaluate(() => (window as any).testWalletEmit("accountsChanged", []));
    await position(page).locator(".position-owner-row").getByText(short(MEMBER)).waitFor();
    assert.equal(await earnedRow.isVisible(), true);
    assert.deepEqual(violations, []);
  });

  test("an address the page cannot decode opens Home, and the script still runs", async () => {
    const { page, violations } = await open(false, { url: `${SITE}/#100%` });
    await homeTitle(page).waitFor();
    await page.goto(`${SITE}/#%E0%A4`);
    await homeTitle(page).waitFor();
    await page.locator('.view[data-view="home"]').getByRole("link", { name: "Open the app" }).click();
    await appTitle(page).waitFor();
    await app(page).getByRole("button", { name: "Browser wallet" }).waitFor();
    await toHydrex(page);
    await hydrex(page)
      .locator(".impact-state")
      .getByText(/^(Running|Stopped)$/)
      .waitFor();
    assert.deepEqual(violations, []);
  });

  test("join with two accounts from automations that stopped, one transaction at a time", async () => {
    // The review's estimate needs last epoch's figures.
    await warm(() => readEarnings(CONDUIT));
    const { page, sent, asked, origins, violations } = await open({ owner: ELSEWHERE }, { url: `${SITE}/#hydrex` });
    await hydrex(page).locator("time.impact-voted").getByText(/Wed/).waitFor();
    assert.deepEqual(asked, [], "the page asks a wallet nothing until it is picked");
    await page.getByRole("button", { name: "Test Wallet" }).click();
    await chip(page, ELSEWHERE).waitFor();
    await account(page, 2439)
      .getByText(/In USDC\s+· stopped\s+Wed,? 9 Sept?/)
      .waitFor();
    const needs = group(page, "needs");
    await needs.getByRole("heading", { name: "Needs you · 2" }).waitFor();
    assert.equal(await needs.getByRole("button", { name: "Join Carbon Impact" }).isDisabled(), true);
    await pick(page, 2435, 2439);
    await shoot(page, "picked-1440-light");
    await needs.getByRole("button", { name: "Join Carbon Impact with 2 accounts" }).click();
    await review(page).getByText("Join Carbon Impact: step 1 of 2").waitFor();
    await review(page)
      .getByText(/#2439 is in USDC and #2435 is in Hydrex Lock Maxi:/)
      .waitFor();
    assert.match(
      await review(page).locator(".pages").innerText(),
      /Thu,? 22 Oct,? 00:00 UTC \(Thu,? 22 Oct,? 02:00 your time\)\. It votes with them/,
    );
    await review(page)
      .locator(".estimate-gas")
      .getByText(/^The change costs (≈|<)\s\$[\d.]+ in gas\.$/)
      .waitFor({ timeout: 60_000 });
    await review(page)
      .locator(".estimate-week")
      .getByText(/^At last epoch's rate, (≈|<)\s\$[\d.]+ a week would reach you: an estimate, not a promise\.$/)
      .waitFor({ timeout: 120_000 });
    await shoot(page, "join-1-1440-light");
    await review(page).getByRole("button", { name: "Continue" }).click();
    await review(page).getByRole("heading", { name: "What your wallet will ask" }).waitFor();
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
    await shoot(page, "join-2-1440-light");
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
    const joined = /Joining Carbon Impact:\s+votes from\s+Thu,? 22 Oct\./;
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

  test("each account's last payout, found through Hydrex's reward contracts, and its receipt on its page", async () => {
    // PAYEE has 93 accounts: anvil reads them from FORK_URL for most of a minute the first time. #82774 was not paid in
    // last epoch's pools, so the page also reads the pools of the epoch before, among every pool's reward contracts.
    await warm(async () => {
      const [earnings] = await Promise.all([readEarnings(CONDUIT), readAccounts(PAYEE)]);
      const last = { start: earnings!.start, pairs: weighed(earnings!.rewards, earnings!.prices) };
      const top = BLOCK - SETTLED;
      const [[time], stamps, earned, rewards] = await Promise.all([
        read([blockTime], top) as Promise<[bigint]>,
        readStamps(PAID_IDS, last.pairs, top),
        readEarned(PAID_IDS, last.pairs, top),
        rewardsFor(CONDUIT, earnings!.start - WEEK),
      ]);
      const before = { start: earnings!.start - WEEK, pairs: weighed(rewards, earnings!.prices) };
      const stampsBefore = await readStamps(PAID_IDS, before.pairs, top);
      const standings = PAID_IDS.map((id, i) =>
        standingOf(
          id,
          last,
          before,
          { last: stamps[i]!, earned: earned[i]!, before: stampsBefore[i]! },
          { last: true, before: true },
        ),
      );
      assert.deepEqual(
        standings.map(({ through, late }) => [through, late]),
        PAID_IDS.map(() => [PAID_THROUGH, true]),
        "they were paid for neither epoch since",
      );
      const blocks = await payoutBlocks(standings, top, Number(time));
      assert.deepEqual(
        PAID_IDS.map((id) => blocks.get(id)),
        PAID_IDS.map(() => PAID),
      );
      const paid = await payoutsIn([PAID]);
      assert.deepEqual(
        PAID_IDS.map((id) => paid.find((payout) => payout.id === id)?.tx),
        PAID_IDS.map(() => PAID_TX),
      );
    });
    const { page, violations, rpc } = await connected(
      { owner: PAYEE },
      { width: 390, height: 844, dark: true, flowing: true },
    );
    // The App marks the account paid late.
    await account(page, 82774).getByText("Payout late.").waitFor({ timeout: 120_000 });
    // Its receipt needs the name Carbon Impact retired in at the payout's block. If that read fails, the page says so,
    // and does not show the payouts as read.
    const entityName = toFunctionSelector("function retiringEntityName()").slice(2);
    const paidBlock = toHex(PAID);
    rpc.refuse = (body) => body.includes(entityName) && body.includes(paidBlock);
    await account(page, 82774).getByRole("link", { name: "Account #82774" }).click();
    const payoutsSection = position(page).locator(".position-payouts");
    await payoutsSection.getByText("Its payouts could not be read from Base.").waitFor({ timeout: 120_000 });
    await page.waitForTimeout(500);
    assert.equal(await payoutsSection.locator(".receipts-failed").isVisible(), true, "the failure stays");
    assert.equal(await payoutsSection.locator(".receipts-found").isVisible(), false);
    rpc.refuse = undefined;
    await payoutsSection.getByRole("button", { name: "Read them again" }).click();
    const standing = position(page).locator(".standing");
    const receipt = standing.locator(".receipt");
    await receipt.first().waitFor({ timeout: 120_000 });
    assert.equal(await standing.count(), 1);
    assert.equal(await position(page).locator("h1").innerText(), "Account #82774");
    // On Fri 16 Oct, Carbon Impact owed it the epoch from Thu 1 Oct, and had paid nothing since Wed 23 Sep.
    assert.match(
      await standing.locator(".standing-late").innerText(),
      /^Late\. Paid up to Thu,? 17 Sept? only\. Carbon Impact voted with it from Thu,? 1 Oct to Thu,? 8 Oct, and it has not been paid for that epoch yet\.$/,
    );
    assert.equal(await standing.locator(".standing-paid").isVisible(), false);
    assert.match(
      await standing.locator(".standing-waiting").innerText(),
      /^≈\s\$\d[\d,.]* waits to be claimed in last epoch's pools\.$/,
    );
    assert.equal(await standing.locator(".standing-outside").isVisible(), false);
    assert.equal(await position(page).locator(".position-underway").isVisible(), false);
    assert.equal(await receipt.count(), 1);
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
      `https://basescan.org/tx/${PAID_TX}`,
    );
    await receipt
      .locator(".receipt-paid-usd")
      .getByText(/^≈\s\$\d/)
      .waitFor({ timeout: 120_000 });
    // Its payout address is its owner's own, so its fold stays closed.
    assert.equal(await position(page).locator(".position-payout").isVisible(), true);
    assert.equal(await position(page).locator(".position-payout").getAttribute("open"), null);
    await shoot(page, "receipt-390-dark", position(page));
    // After the flip, the page reads Carbon Impact again and fills its figures, such as .tonnes, across the page. The
    // receipts keep their own.
    const readAgain = page.waitForResponse((response) => !!response.request().postData()?.includes(entityName));
    await page.clock.setSystemTime((FLIP + 60) * 1000);
    await page.clock.runFor(30_000);
    await readAgain;
    await page.waitForTimeout(500);
    assert.equal(await receipt.locator(".receipt-retired").innerText(), "−326.80 kVCM");
    assert.equal(await receipt.locator(".receipt-tonnes").innerText(), "65.26 t of carbon credits");
    // A member's account last paid in an earlier payout has the receipt of that one; its own account has none.
    const member = await open({ owner: MEMBER }, { width: 390, height: 844, url: `${SITE}/#hydrex/9540` });
    const own = position(member.page).locator(".standing");
    await own.locator(".receipt").waitFor({ timeout: 120_000 });
    assert.match(await own.locator(".standing-late").innerText(), /^Late\. Paid up to Thu,? 27 Aug only\./);
    assert.match((await own.locator("time.receipt-time").textContent()) ?? "", /^Thu,? 27 Aug,? 01:47 UTC$/);
    await position(member.page).locator(".position-owner-row").getByText(short(MEMBER)).waitFor();
    // Without the owner's wallet, its page speaks of its owner.
    await member.page.goto(`${SITE}/#hydrex/14485`);
    await position(member.page).getByText("Its owner votes with it.").waitFor({ timeout: 60_000 });
    assert.equal(await position(member.page).locator(".position-payouts").isVisible(), false, "not in an automation");
    assert.deepEqual([...violations, ...member.violations], []);
  });

  test("join with an account of its own; the header shows the wallet on every view", async () => {
    const { page, sent } = await connected({ owner: NEWCOMER });
    await account(page, 141).getByText("You vote with it.").waitFor();
    await account(page, 42877)
      .getByText(/In Liquid Hydrex\s+· stopped\s+Wed,? 9 Sept?/)
      .waitFor();
    const nothing = group(page, "closed");
    await nothing.locator("summary").click();
    await nothing.locator("li").getByText("Empty: no HYDX in it.").first().waitFor();
    assert.equal(await nothing.locator(".pick").first().isVisible(), false, "an empty account has no box");
    assert.equal(await account(page, 141).locator(".pick").isVisible(), false, "a group of one has no box");
    await page.getByRole("link", { name: "metaDEX Café" }).click();
    await homeTitle(page).waitFor();
    await chip(page, NEWCOMER).waitFor();
    await page
      .locator("header")
      .getByRole("link", { name: /Your wallet, connected as 0x0208…4C95/ })
      .click();
    await appTitle(page).waitFor();
    await toHydrex(page);
    assert.equal(await page.getByRole("button", { name: /AutoMaxi/ }).count(), 0, "AutoMaxi is not on Base yet");
    assert.equal(await page.locator('[data-needs="automaxi"]:not([hidden])').count(), 0);
    await group(page, "other").getByRole("button", { name: "Join Carbon Impact", exact: true }).click();
    await toWallet(page);
    await review(page).getByText("One transaction:").waitFor();
    assert.deepEqual(await review(page).locator(".says").allTextContents(), ["#141 joins Carbon Impact."]);
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
    assert.equal(
      await maxi.locator('[data-section="record"] .record-waiting').textContent(),
      "No record yet: AutoMaxi is not on Base yet.",
    );
  });

  test("closing between transactions stops there; a link then opens in a new tab", async () => {
    const { page, sent } = await connected({ owner: ELSEWHERE });
    await pick(page, 2435, 2439);
    await page.getByRole("button", { name: "Join Carbon Impact with 2 accounts" }).click();
    await toWallet(page);
    await review(page).getByRole("button", { name: "Confirm transaction 1 of 2" }).click();
    await review(page).getByText("closing stops here").waitFor();
    const [tab] = await Promise.all([
      page.context().waitForEvent("page"),
      review(page).getByRole("link", { name: "How to check these calls" }).first().click(),
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

  test("a wallet that locks is let go, and connects again from a click", async () => {
    const { page } = await connected({ owner: NEWCOMER });
    await account(page, 141).waitFor();
    // An account's page stays when the wallet moves to another address or locks: about its owner, without actions.
    await page.goto(`${SITE}/#hydrex/141`);
    const actions = position(page).locator(".position-actions");
    await actions.getByRole("button", { name: "Join Carbon Impact", exact: true }).waitFor();
    await page.evaluate((other) => (window as any).testWalletEmit("accountsChanged", [other]), MEMBER);
    await position(page).getByText("Its owner votes with it.").waitFor();
    await position(page).locator(".position-owner-row").getByText(short(NEWCOMER)).waitFor();
    assert.equal(await actions.isVisible(), false);
    await page.evaluate(() => (window as any).testWalletEmit("accountsChanged", []));
    await page.locator("header").getByText("Open the app").waitFor();
    assert.equal(await position(page).getByText("Its owner votes with it.").isVisible(), true);
    assert.equal(await actions.isVisible(), false);
    await page.goto(`${SITE}/#app`);
    await app(page).getByText("Pick your wallet").waitFor();
    for (const part of ["#accounts", "#none", "#epoch"]) assert.equal(await page.locator(part).isVisible(), false);
    await page.locator("header").getByText("Open the app").waitFor();
    await page.getByRole("button", { name: "Test Wallet" }).click();
    await toHydrex(page);
    await account(page, 141).waitFor();
  });

  test("closing the review before Base includes the transaction still updates the account", async () => {
    const { page } = await connected({ owner: NEWCOMER });
    await group(page, "other").getByRole("button", { name: "Join Carbon Impact", exact: true }).click();
    await toWallet(page);
    await anvil("evm_setAutomine", [false]);
    try {
      await review(page).getByRole("button", { name: "Confirm in your wallet" }).click();
      await review(page).getByText("Waiting for Base to include it").waitFor();
      await review(page).getByRole("button", { name: "Close" }).click();
      await account(page, 141).getByText("You vote with it.").waitFor();
      // Mine only after the page has polled again: it polls every two seconds.
      await page.waitForTimeout(5_000);
      await anvil("evm_mine");
    } finally {
      await anvil("evm_setAutomine", [true]);
    }
    await account(page, 141).getByText("Joining Carbon Impact:").waitFor();
  });

  test("leave with one account", async () => {
    const { page, sent } = await connected({ owner: MEMBER }, { width: 390, height: 844, dark: true });
    await group(page, "in:carbon-impact").getByText("#9540").waitFor();
    assert.equal(await account(page, 9540).locator(".status-line").count(), 0, "its group says it is in");
    await account(page, 14485).getByText("You vote with it.").waitFor();
    await shoot(page, "member-390-dark");
    await group(page, "in:carbon-impact").getByRole("button", { name: "Leave" }).click();
    await review(page).getByRole("heading", { name: "Leave Carbon Impact" }).waitFor();
    await review(page).getByText("One transaction:").waitFor();
    assert.equal(await review(page).locator(".step-count").isVisible(), false, "one step");
    assert.equal(
      await review(page).getByRole("link", { name: "More on leaving" }).getAttribute("href"),
      "#hydrex/carbon-impact/joining",
    );
    await shoot(page, "leave-390-dark");
    await confirm(page);
    await expectApprovals([9540n], MEMBER, zeroAddress);
    await group(page, "other")
      .locator("li")
      .filter({ hasText: "#9540" })
      .getByText(/Leaving Carbon Impact:\s+your votes from\s+Thu,? 22 Oct\./)
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
    await group(page, "needs").getByRole("button", { name: "Leave with 1 account" }).click();
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
    await group(page, "other")
      .getByText(/Left USDC:\s+your votes from\s+Thu,? 22 Oct\./)
      .waitFor();
    await account(page, 2435)
      .getByText(/In Hydrex Lock Maxi\s+· stopped/)
      .waitFor();
  });

  test("an ended lock offers nothing to tick", async () => {
    const { page } = await connected({ owner: ENDED });
    const nothing = group(page, "closed");
    await nothing.locator("summary").click();
    await account(page, 123351).getByText("Lock ended.").waitFor();
    assert.equal(await account(page, 123351).locator(".pick").isVisible(), false);
    assert.equal(await nothing.getByRole("button").count(), 0);
    // Playwright refuses a click on a label whose box is disabled, which is the point: force it, as a person would.
    await account(page, 123351).locator(".small").click({ force: true });
    assert.equal(await account(page, 123351).locator(".pick").isChecked(), false);
    await account(page, 123364).waitFor();
    // An automation's page lists those that can join it, and says when the wallet has none, as an address with no
    // account has.
    await page.goto(`${SITE}/#hydrex/carbon-impact`);
    const impact = product(page, "carbon-impact");
    await impact.getByRole("button", { name: "Join Carbon Impact", exact: true }).waitFor();
    assert.equal(await impact.locator(".mine-none").isVisible(), false);
    await page.evaluate((other) => (window as any).testWalletEmit("accountsChanged", [other]), RECIPIENT);
    await impact.getByText("None of this wallet's accounts is in Carbon Impact or can join it.").waitFor();
  });

  test("without a wallet in the browser, Browser wallet links to wallet apps", async () => {
    const { page } = await open(false, { width: 390, height: 844, url: `${SITE}/#app` });
    await app(page).getByRole("button", { name: "Browser wallet" }).click();
    await app(page).getByText("No wallet was found in this browser.").waitFor();
    const links = app(page).locator(".no-wallet a");
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
    await hydrex(page).getByText("Your wallet is on another network.").waitFor();
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
    assert.equal(await hydrex(page).getByText("Your wallet is on another network.").isVisible(), false);

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
    await account(page, 2439).getByText("In Hydrex's USDC automation.").waitFor();
    await group(page, "other").getByText("#2435").waitFor();
    assert.equal(await page.locator("#error").isVisible(), false);
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
    assert.equal(await page.locator("#epoch time.next-epoch").innerText(), "on Thursday at 00:00 UTC");
    opened.rpc.refuse = undefined;
    await page.clock.runFor(30_000);
    await page
      .locator("#epoch time.next-epoch")
      .getByText(/Thu,? 22 Oct/)
      .waitFor();
    await page.getByRole("button", { name: "Try again" }).click();
    await page.getByRole("button", { name: "Test Wallet" }).waitFor();
    await hydrexTitle(page).waitFor();
    assert.equal(new URL(page.url()).hash, "#hydrex");
  });

  test("a wallet that cannot switch to Base says so", async () => {
    const { page } = await connected({ owner: NEWCOMER, chainId: 1, switches: false });
    await hydrex(page).locator(".wrong-chain").getByRole("button", { name: "Switch to Base" }).click();
    await hydrex(page).getByText("Your wallet did not switch.").waitFor();
  });

  test("inside Safe{Wallet}, a Safe proposes leaving with two accounts as one Safe transaction", async () => {
    const { page, origins, violations } = await open(false, { url: `${SAFE_WALLET}/` });
    const frame = page.frameLocator("iframe");
    const dialog = frame.locator("#review");
    await frame.locator("header").getByText(short(LEAVER)).waitFor();
    assert.equal(await frame.getByRole("heading", { name: "Your wallet", level: 1 }).isVisible(), true);
    assert.equal(
      await frame.getByRole("heading", { name: "Vote, claim and swap on Base, from your own wallet" }).isVisible(),
      false,
    );
    await frame.getByRole("link", { name: "Hydrex automations" }).click();
    await frame.getByRole("checkbox", { name: "Pick Account #53350" }).check();
    await frame.getByRole("checkbox", { name: "Pick Account #82206" }).check();
    await frame.getByRole("button", { name: "Leave with 2 accounts" }).click();
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
    await review(page).getByText("Join AutoMaxi: step 1 of 2").waitFor();
    await review(page)
      .getByText("Anyone can claim the rewards this account has not claimed yet through AutoMaxi")
      .waitFor();
    await review(page).getByText("It takes 1% of each claim. Nobody can change that.").waitFor();
    await review(page)
      .locator(".estimate-week")
      .getByText("AutoMaxi has no record yet, so the page gives no estimate.")
      .waitFor({ timeout: 120_000 });
    assert.equal(await review(page).locator(".fee-facts").count(), 0, "the fee facts are on its page");
    await shoot(page, "automaxi-join-1-1440-light");
    await review(page).getByRole("button", { name: "Continue" }).click();
    assert.deepEqual(await review(page).locator(".says").allTextContents(), ["#141 joins AutoMaxi."]);
    assert.deepEqual(await review(page).locator(".conduit-name").allTextContents(), ["AutoMaxi"]);
    assert.equal(await review(page).locator(".conduit").innerText(), AUTOMAXI.address);
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
    await group(own, "in:carbon-impact").getByRole("button", { name: "Move to AutoMaxi with 1 account" }).click();
    await toWallet(own);
    assert.deepEqual(await review(own).locator(".says").allTextContents(), [
      "#53350 leaves Carbon Impact and joins AutoMaxi.",
    ]);
    await confirm(own);
    await expectApprovals([53350n], AUTOMAXI.address, AUTOMAXI.address);
    await group(own, "in:automaxi").getByText("Joining AutoMaxi:").waitFor();
    await group(own, "in:automaxi").getByRole("button", { name: "Move to Carbon Impact", exact: true }).click();
    await toWallet(own);
    assert.deepEqual(await review(own).locator(".says").allTextContents(), [
      "#53350 leaves AutoMaxi and joins Carbon Impact.",
    ]);
    await confirm(own);
    await expectApprovals([53350n], CONDUIT, CONDUIT);
    await group(own, "in:carbon-impact").locator("li").filter({ hasText: "#53350" }).waitFor();
    assert.equal(await group(own, "in:automaxi").isVisible(), false);

    // Leaving AutoMaxi gives the votes back to the owner.
    await group(page, "in:automaxi").getByRole("button", { name: "Leave" }).click();
    await review(page).getByRole("heading", { name: "Leave AutoMaxi" }).waitFor();
    await review(page).getByText("AutoMaxi can no longer claim the rewards of #141.").waitFor();
    await confirm(page);
    await expectApprovals([141n], NEWCOMER, zeroAddress);
    await account(page, 141).getByText("You vote with it.").waitFor();
    assert.deepEqual([...sent, ...member.sent].length, 4);
  });

  test("AutoMaxi's receipts: a claim by its keeper, a stranger's dust, and where the page stops reading", async () => {
    await deployAutoMaxi();
    let rewards: Reward[] = [];
    await warm(async () => {
      rewards = (await readEarnings(CONDUIT))!.rewards;
      await readAccounts(PAYEE);
    });
    const move = encodeFunctionData({
      abi,
      functionName: "setConduitApproval",
      args: [AUTOMAXI.address, 82774n, true],
    });
    await anvil("anvil_setBalance", [PAYEE, "0x16345785d8a0000"]);
    await anvil("anvil_setBalance", [STRANGER, "0x16345785d8a0000"]);
    await mined(PAYEE, VOTING_ESCROW, move);
    const usdc = rewards.filter(({ token }) => token.symbol === "USDC");
    await claimOne(KEEPER, 82774n, usdc[0]!);
    await claimOne(STRANGER, 82774n, usdc[1]!);
    await settle();
    // Its standing is read in the pools Carbon Impact voted for, last epoch and the one before, as test 7 reads them.
    // A revert drops what anvil fetched, so they are read again here, with no time limit.
    await warm(async () => {
      const earnings = (await readEarnings(CONDUIT))!;
      const top = Number(await anvil<Hex>("eth_blockNumber")) - SETTLED;
      const last = weighed(earnings.rewards, earnings.prices);
      const before = weighed(await rewardsFor(CONDUIT, earnings.start - WEEK), earnings.prices);
      await Promise.all([
        readStamps([82774n], last, top),
        readEarned([82774n], last, top),
        readStamps([82774n], before, top),
      ]);
    });
    const { page, violations } = await open(
      { owner: PAYEE },
      { width: 390, height: 844, url: `${SITE}/#hydrex/82774` },
    );
    const standing = position(page).locator(".standing");
    const receipt = standing.locator(".receipt");
    await receipt.waitFor({ timeout: 120_000 });
    await position(page).locator(".position-status").getByText("Joining AutoMaxi:").waitFor();
    assert.equal(await receipt.locator(".label").first().textContent(), "Receipt · #82774 · AutoMaxi");
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
    assert.equal(
      await longer.locator(".receipt-stopped").innerText(),
      "The page stopped after 10 blocks of claims. Older claims of this epoch are not shown.",
    );
    assert.equal(await longer.locator(".claim-by").count(), 10);
    assert.deepEqual([...violations, ...again.violations], []);
  });

  test("the menu in the App, a page for each automation, and joining from it", async () => {
    await deployAutoMaxi();
    await warm(() => Promise.all([readEarnings(CONDUIT), readEarnings(AUTOMAXI.address), readAccounts(NEWCOMER)]));
    const { page, violations } = await connected({ owner: NEWCOMER }, { width: 390, height: 844 });
    await account(page, 141).getByText("You vote with it.").waitFor();
    const menu = hydrex(page).locator("#menu");
    assert.deepEqual(await menu.locator("h3").allInnerTexts(), ["Carbon Impact", "AutoMaxi", "Vote yourself"]);
    await menu.locator(".automaxi-state").getByText("Not voted yet").waitFor();
    await menu
      .locator('[data-choice="carbon-impact"] .record')
      .getByText(/^≈\s\$0\.5\d earned per 1,000 Earning Power, ≈\s\$0\.\d\d paid to you$/)
      .waitFor({ timeout: 120_000 });
    assert.equal(await menu.locator('[data-choice="automaxi"] .record').innerText(), "No record yet");
    assert.equal(
      await menu.getByText("If you only want the most, and have time each week, vote yourself.").count(),
      1,
      "said once",
    );
    await shoot(page, "menu-390-light", menu);
    await menu.getByRole("link", { name: "AutoMaxi" }).click();
    const maxi = product(page, "automaxi");
    await maxi.getByRole("heading", { name: "AutoMaxi", level: 1 }).waitFor();
    assert.equal(await page.title(), "AutoMaxi · metaDEX Café");
    assert.equal(await maxi.locator(".automaxi-absent").isVisible(), false);
    assert.equal(await maxi.locator(".record").innerText(), "No record yet");
    assert.equal(await maxi.locator(".record-when").innerText(), "");
    await shoot(page, "automaxi-390-light");
    // #141 and #42877 can join it, so its button waits for a tick.
    assert.equal(await maxi.getByRole("button", { name: "Join AutoMaxi", exact: true }).isDisabled(), true);
    await pick(page, 141);
    await maxi.getByRole("button", { name: "Join AutoMaxi with 1 account" }).click();
    await review(page).getByText("Join AutoMaxi: step 1 of 2").waitFor();
    await page.keyboard.press("Escape");
    await maxi.getByRole("navigation", { name: "Breadcrumb" }).getByRole("link", { name: "App" }).click();
    await appTitle(page).waitFor();

    await page.goto(`${SITE}/#hydrex/carbon-impact`);
    const impact = product(page, "carbon-impact");
    await impact.getByRole("heading", { name: "Carbon Impact", level: 1 }).waitFor();
    const facts = impact.locator(".fee-facts dd");
    await facts.first().getByText("Of the rewards: 33.33% retired as carbon credits, and a fee of 0%").waitFor();
    assert.equal(await facts.nth(1).innerText(), "100% retired, and a fee of 1%");
    const treasury = "0xd9e966a6Bfa2aE2113a34Bb4dd02ded921DA50aF";
    assert.equal(
      await facts.nth(2).getByRole("link", { name: "its treasury" }).getAttribute("href"),
      `https://basescan.org/address/${treasury}`,
    );
    await impact
      .locator(".tonnes")
      .getByText(/^\d[\d,]*$/)
      .waitFor();
    // Its folds start closed, and the address of one opens it.
    assert.equal(await impact.locator("details.fold[open]").count(), 0);
    await shoot(page, "carbon-impact-390-light");
    await page.goto(`${SITE}/#hydrex/carbon-impact/check`);
    const check = impact.locator('[data-section="check"]');
    assert.equal(await check.getAttribute("open"), "");
    assert.match(await check.locator("a.treasury").innerText(), new RegExp(`^${treasury}$`));
    assert.equal(await check.locator(".check-failed").count(), 0, "every check passed");

    // An account's page: the wallet's own has its actions; another's names its owner.
    await page.goto(`${SITE}/#hydrex/141`);
    await position(page).getByRole("heading", { name: "Account #141", level: 1 }).waitFor();
    await position(page).getByText("You vote with it.").waitFor();
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
    await position(page).getByText("Hydrex has no account with this number.").waitFor();
    assert.deepEqual(violations, []);
  });

  // Last, as it moves anvil's clock on.
  test("in a new epoch, Join reads again before any review, and the page moves on by itself", async () => {
    const data = encodeFunctionData({ abi, functionName: "setConduitApproval", args: [CONDUIT, 141n, true] });
    await anvil("eth_sendTransaction", [{ from: NEWCOMER, to: VOTING_ESCROW, data, gas: GAS }]);
    const { page } = await connected({ owner: NEWCOMER }, { flowing: true });
    await account(page, 141).getByText("Joining Carbon Impact:").waitFor();
    await anvil("evm_setNextBlockTimestamp", [FLIP + 60]);
    await anvil("evm_mine");
    await page.clock.setSystemTime((FLIP + 60) * 1000);
    const joinStopped = group(page, "needs").getByRole("button", { name: "Join Carbon Impact" });
    await joinStopped.click();
    await group(page, "in:carbon-impact").locator("li").filter({ hasText: "#141" }).waitFor();
    await account(page, 141).getByText("Joining Carbon Impact:").waitFor({ state: "detached" });
    await page
      .locator("#epoch time.next-epoch")
      .getByText(/Thu,? 29 Oct,? 00:00 UTC/)
      .waitFor();
    assert.equal(await review(page).isVisible(), false);
    await joinStopped.click();
    assert.match(await review(page).locator(".pages").innerText(), /Thu,? 29 Oct,? 00:00 UTC/);
    await page.keyboard.press("Escape");

    await anvil("evm_setNextBlockTimestamp", [FLIP + WEEK + 60]);
    await anvil("evm_mine");
    await page.clock.setSystemTime((FLIP + WEEK + 60) * 1000);
    await page.clock.runFor(30_000);
    await page
      .locator("#epoch time.next-epoch")
      .getByText(/Thu,? 5 Nov,? 00:00 UTC/)
      .waitFor();
    await page
      .locator("#epoch .countdown")
      .getByText(/^in 6 d 23 h$/)
      .waitFor();
  });
});

// After the swappers' deployment in block 52,894,916: Wed 21 Oct 2026, 15:42 UTC. Carbon Impact still owed #82774 the
// epoch from Thu 1 Oct.
const RECENT = 52_904_000;
// Carbon Impact's treasury, a Safe that holds many of the tokens its fee took.
const HOLDER = getAddress("0xd9e966a6bfa2ae2113a34bb4dd02ded921da50af");
const AVNT = getAddress("0x696f9436b67233384889472cd7cd58a6fb5df4f1");
const ZORA = getAddress("0x1111111111166b7fe7bd91427724b487980afc69");
const WETH = getAddress("0x4200000000000000000000000000000000000006");
const [INTO_USDC, INTO_EURC] = SWAPPERS as [(typeof SWAPPERS)[number], (typeof SWAPPERS)[number]];
const tokenAbi = parseAbi([
  "function balanceOf(address owner) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function transfer(address to, uint256 amount) returns (bool)",
]);
const autoMaxiAbi = parseAbi(["function lastClaimBlock(uint256 tokenId) view returns (uint256)"]);
// A wallet of the test's own, which the treasury gives three of its tokens, so that the page has only those to route.
const SELLER = getAddress("0x0000000000000000000000000000000000c0ffee");

// Gives SELLER the treasury's whole balance of each token, then reads what the page will: the balances, the prices, and
// each token's route into USDC, with no time limit, as anvil reads the pools from FORK_URL a slot at a time.
async function fund(tokens: Address[]): Promise<void> {
  for (const token of tokens) {
    const amount = await balanceOf(token, HOLDER);
    await mined(HOLDER, token, encodeFunctionData({ abi: tokenAbi, functionName: "transfer", args: [SELLER, amount] }));
  }
  await warm(async () => {
    // The page reads the balance of every token it knows.
    const held = await holdingsOf(SELLER, [...known(), ...tokens], INTO_USDC.address);
    const described = await describeTokens([...tokens, INTO_USDC.token]);
    const amounts = new Map(tokens.map((token) => [token.toLowerCase(), held.get(token.toLowerCase())!.balance]));
    const time = Number((await anvil<{ timestamp: Hex }>("eth_getBlockByNumber", ["latest", false])).timestamp);
    await pricesAt([...described.values()], amounts, time, time);
    for (const token of tokens) await findRoute(token, amounts.get(token.toLowerCase())!, INTO_USDC, false);
  });
}

async function readOn<T>(
  to: Address,
  abi: typeof tokenAbi | typeof autoMaxiAbi,
  functionName: string,
  args: unknown[],
): Promise<T> {
  const data = encodeFunctionData({ abi, functionName, args } as never);
  const reply = await anvil<Hex>("eth_call", [{ to, data }, "latest"]);
  return decodeFunctionResult({ abi, functionName, data: reply } as never) as T;
}
const balanceOf = (token: Address, owner: Address) => readOn<bigint>(token, tokenAbi, "balanceOf", [owner]);

const swapView = (page: Page) => page.locator('.view[data-view="swap"]');

// Reads, with no time limit, what the page reads of an owner's payouts, and what the claim of #82774 reads.
async function warmPayouts(owner: Address): Promise<void> {
  await warm(async () => {
    const holdings = await readAccounts(owner);
    const ids = holdings.accounts
      .filter((account) =>
        [account.delegate, account.claimer, account.delegateAtStart].some(
          (address) => same(address, CONDUIT) || same(address, AUTOMAXI.address),
        ),
      )
      .map(({ id }) => id);
    const earnings = (await readEarnings(CONDUIT))!;
    const top = Number(await anvil<Hex>("eth_blockNumber")) - SETTLED;
    const last = weighed(earnings.rewards, earnings.prices);
    const earlier = await rewardsFor(CONDUIT, earnings.start - WEEK);
    const before = weighed(earlier, earnings.prices);
    const pairs = [...earnings.rewards, ...earlier].map(({ contract, token }) => ({ contract, token: token.address }));
    await Promise.all([
      readStamps(ids, last, top),
      readEarned(ids, last, top),
      readStamps(ids, before, top),
      readEarned([82774n], pairs, "latest"),
    ]);
  });
}

// Waits until every token has its route, then ticks only those given.
async function tickOnly(page: Page, symbols: string[]): Promise<void> {
  const swap = swapView(page);
  try {
    await swap.locator(".swap-rows li").first().waitFor({ timeout: 300_000 });
    await swap.locator(".swap-status").waitFor({ state: "hidden", timeout: 600_000 });
  } catch (error) {
    throw new Error(`The swap's page shows: ${await swap.locator(".swap-tokens").innerText()}`, { cause: error });
  }
  for (const box of await swap.locator(".swap-rows .pick").all()) {
    const symbol = ((await box.getAttribute("aria-label")) ?? "").replace(/^Sell /, "");
    if ((await box.isChecked()) !== symbols.includes(symbol)) await box.click();
  }
}

describe("the swap and the claim against a fork after the swappers' deployment", { timeout: 2_400_000 }, () => {
  before(() => start(RECENT, [HOLDER, PAYEE, SELLER]));
  after(stop);
  hooks();

  test("swap three tokens into USDC in one prompt; one is skipped, and its approval is reset", async () => {
    await fund([WETH, ZORA, AVNT]);
    const { page, sent, violations } = await connected({ owner: SELLER, batch: true }, { url: `${SITE}/#swap` });
    const swap = swapView(page);
    await swap.getByRole("heading", { name: "Swap many tokens into one", level: 1 }).waitFor();
    assert.equal(
      await swap.getByRole("radio", { name: "USDC" }).isChecked(),
      true,
      "USDC unless the address names another",
    );
    await tickOnly(page, ["WETH", "ZORA", "AVNT"]);
    await swap
      .locator(".swap-sells")
      .getByText(/^Sells 3 tokens for ≈ [\d,.]+ USDC, at least [\d,.]+ USDC\.$/)
      .waitFor();
    await swap
      .locator(".swap-costs")
      .getByText(/4 calls: 3 approvals, 1 swap$/)
      .waitFor();
    await shoot(page, "swap-390-light");
    await swap.getByRole("button", { name: "Review" }).click();
    await review(page).getByRole("heading", { name: "What you swap" }).waitFor({ timeout: 300_000 });
    await review(page).getByText("these figures are the swap's own").waitFor();
    assert.equal(await review(page).locator(".swap-lines li").count(), 3);
    await review(page).getByRole("button", { name: "Continue" }).click();
    await review(page).getByText("One prompt, with 4 calls, which go through together or not at all:").waitFor();
    const says = await review(page).locator(".says").allTextContents();
    assert.equal(says.length, 4);
    assert.match(says[0]!, /^Lets the USDC swapper take [\d,.]+ \S+ from you\.$/);
    assert.match(says[3]!, /^Sells 3 tokens for at least [\d,.]+ USDC, less any token skipped\.$/);
    assert.deepEqual(await review(page).locator(".function").allTextContents(), [
      "approve",
      "approve",
      "approve",
      "swap",
    ]);
    assert.equal(await review(page).locator(".to").last().innerText(), INTO_USDC.address);
    // AVNT leaves the wallet before the swap, so its route fails, and the swap skips it.
    const avnt = await balanceOf(AVNT, SELLER);
    assert.ok(avnt > 0n);
    await mined(SELLER, AVNT, encodeFunctionData({ abi: tokenAbi, functionName: "transfer", args: [STRANGER, avnt] }));
    const before = await balanceOf(INTO_USDC.token, SELLER);
    await review(page).getByRole("button", { name: "Confirm in your wallet" }).click();
    await review(page).getByText("Done.").waitFor({ timeout: 120_000 });
    assert.equal(sent.length, 4);
    const receipt = review(page).locator(".receipt");
    assert.equal(await receipt.locator(".swap-receipt-sold").innerText(), "2 tokens");
    const paid = await receipt.locator(".swap-receipt-paid").innerText();
    assert.match(paid, /^[\d,.]+ USDC$/);
    assert.ok((await balanceOf(INTO_USDC.token, SELLER)) > before);
    assert.equal(await balanceOf(WETH, SELLER), 0n);
    assert.equal(await balanceOf(ZORA, SELLER), 0n);
    const skipped = receipt.locator(".swap-receipt-skipped li");
    assert.match(
      await skipped.innerText(),
      /AVNT stayed in your wallet: its token refused the transfer\. Its approval stays\./,
    );
    await shoot(page, "swap-receipt-390-light", review(page));
    assert.ok((await readOn<bigint>(AVNT, tokenAbi, "allowance", [SELLER, INTO_USDC.address])) > 0n);
    await skipped.getByRole("button", { name: "Reset its approval" }).click();
    await review(page).getByRole("heading", { name: "Reset an approval" }).waitFor();
    assert.deepEqual(await review(page).locator(".says").allTextContents(), [
      "Resets AVNT's approval of the USDC swapper to nothing.",
    ]);
    await confirm(page);
    assert.equal(await readOn<bigint>(AVNT, tokenAbi, "allowance", [SELLER, INTO_USDC.address]), 0n);
    assert.deepEqual(violations, []);
  });

  test("a swapper whose checks fail turns its output off, and says which check failed", async () => {
    await anvil("anvil_setCode", [INTO_EURC.address, "0x00"]);
    const { page } = await connected({ owner: HOLDER }, { url: `${SITE}/#swap/eurc` });
    const swap = swapView(page);
    await swap.getByText("Swaps into EURC are off: this page's checks of their swappers failed.").waitFor();
    assert.equal(await swap.getByRole("radio", { name: /EURC/ }).isDisabled(), true);
    assert.equal(await swap.getByRole("radio", { name: "USDC" }).isDisabled(), false);
    assert.equal(await swap.getByRole("button", { name: "Review" }).isDisabled(), true);
    await page.goto(`${SITE}/#swap/eurc/check`);
    const failed = swap.locator('[data-check="swap-code"] .check-failed');
    await failed.waitFor();
    assert.equal(await failed.innerText(), "Failed for EURC: ");
    assert.equal(await swap.locator('[data-check="chain"] .check-failed').count(), 0);
  });

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
    const line = needs.locator("li").filter({ hasText: "#82774's payout is overdue" });
    await line.waitFor({ timeout: 600_000 });
    assert.match(
      await line.innerText(),
      /^#82774's payout is overdue: At least (≈|<)\s\$[\d,.]+ waits in \d+ tokens?\./,
    );
    await shoot(page, "needs-overdue-390-light");
    await page.goto(`${SITE}/#hydrex/82774`);
    await position(page).getByText("Its payout is overdue.").waitFor();
    await position(page).getByRole("button", { name: "Claim now" }).click();
    await review(page).getByText("Claim for #82774: step 1 of 2").waitFor({ timeout: 300_000 });
    await review(page).getByRole("heading", { name: "What waits" }).waitFor();
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
    assert.deepEqual(await review(page).locator(".says").allTextContents(), [
      "Claims #82774's rewards through AutoMaxi, which pays them to you, less 1%.",
    ]);
    assert.deepEqual(await review(page).locator(".function").allTextContents(), ["claim"]);
    assert.equal(await review(page).locator(".to").innerText(), AUTOMAXI.address);
    await review(page).getByRole("button", { name: "Confirm in your wallet" }).click();
    await review(page).getByText("Done.").waitFor({ timeout: 120_000 });
    const receipt = review(page).locator(".receipt");
    assert.equal(await receipt.locator(".claim-receipt-id").innerText(), "#82774");
    assert.notEqual(await receipt.locator(".claim-receipt-paid").innerText(), "Nothing");
    assert.match(await receipt.locator(".claim-receipt-fee").innerText(), /^−/);
    await review(page).getByRole("link", { name: "Swap these into one token" }).waitFor();
    assert.equal(sent.length, 1);
    assert.ok((await readOn<bigint>(AUTOMAXI.address, autoMaxiAbi, "lastClaimBlock", [82774n])) > 0n);
    assert.deepEqual(violations, []);
  });

  test("claim and swap into USDC in one prompt", async () => {
    await mined(
      PAYEE,
      VOTING_ESCROW,
      encodeFunctionData({ abi, functionName: "setConduitApproval", args: [AUTOMAXI.address, 82774n, true] }),
    );
    await settle();
    await warmPayouts(PAYEE);
    const { page, sent } = await connected({ owner: PAYEE, batch: true }, { url: `${SITE}/#app` });
    const line = app(page).locator("#needs li").filter({ hasText: "#82774's payout is overdue" });
    await line.getByRole("button", { name: "Claim now" }).click({ timeout: 600_000 });
    await review(page).getByRole("heading", { name: "What waits" }).waitFor({ timeout: 300_000 });
    await review(page).getByRole("radio", { name: "Into" }).check();
    await review(page)
      .locator(".claim-into")
      .getByText(/^≈ [\d,.]+ USDC, at least [\d,.]+\./)
      .waitFor({ timeout: 600_000 });
    await shoot(page, "claim-into-390-light", review(page));
    await review(page).getByRole("button", { name: "Continue" }).click();
    await review(page)
      .getByText(/^One prompt, with \d+ calls, which go through together or not at all:$/)
      .waitFor();
    const says = await review(page).locator(".says").allTextContents();
    assert.equal(says[0], "Claims #82774's rewards through AutoMaxi, which pays them to you, less 1%.");
    assert.match(says.at(-1)!, /^Sells \d+ tokens? for at least [\d,.]+ USDC, less any token skipped\.$/);
    assert.ok(says.slice(1, -1).every((each) => /^Lets the USDC swapper take /.test(each)));
    const before = await balanceOf(INTO_USDC.token, PAYEE);
    await review(page).getByRole("button", { name: "Confirm in your wallet" }).click();
    await review(page).getByText("Done.").waitFor({ timeout: 300_000 });
    assert.equal(sent.length, says.length);
    await review(page)
      .locator(".swap-receipt-paid")
      .getByText(/^[\d,.]+ USDC$/)
      .waitFor();
    assert.ok((await balanceOf(INTO_USDC.token, PAYEE)) > before);
  });
});
