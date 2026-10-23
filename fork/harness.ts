// What the browser tests share: the owners and blocks they fork, anvil, Chromium and the test wallet, and the page's
// parts. Each test file starts an anvil of its own, on its own port, so that node --test runs the files at once; each
// test starts from the snapshot its file took.
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { createServer } from "node:net";
import { afterEach, beforeEach } from "node:test";
import { fileURLToPath } from "node:url";
import {
  chromium,
  type Browser,
  type BrowserContext,
  type FrameLocator,
  type Locator,
  type Page,
  type Route,
} from "playwright-core";
import {
  concat,
  decodeFunctionResult,
  encodeFunctionData,
  getAddress,
  getContractAddress,
  keccak256,
  parseAbi,
  toHex,
  type Address,
  type Hex,
} from "viem";
import { same } from "../src/chain.ts";
import {
  AUTOMATIONS,
  AUTOMAXI,
  CARBON_IMPACT,
  DEFAULT_OUTPUT,
  KEEPER,
  RPCS,
  SWAPPERS,
  VOTING_ESCROW,
  swapperOf,
} from "../src/config.ts";
import { readEarnings, rewardsFor, type Reward } from "../src/earnings.ts";
import { WEEK, short } from "../src/format.ts";
import { readAccounts } from "../src/hydrex.ts";
import { pricesNow, type Token } from "../src/prices.ts";
import { SETTLED, readEarned, readStamps, weighed } from "../src/receipts.ts";
import { findRoute } from "../src/swap.ts";

export const CONDUIT = CARBON_IMPACT.address;
export const BLOCK = 52_694_000; // Fri 16 Oct 2026, 18:22 UTC
export const FLIP = 1_792_627_200; // Thu 22 Oct 2026, 00:00 UTC, when the epoch after BLOCK's starts
// After the swappers' deployment in block 52,894,916: Wed 21 Oct 2026, 15:42 UTC. Carbon Impact still owed #82774 the
// epoch from Thu 1 Oct.
export const RECENT = 52_904_000;
// anvil's address, on a port free when it starts, so that no other run's anvil answers in its place; and that of the
// cache it forks through.
let ANVIL = "";
let CACHE_URL = "";
export const SITE = "https://metadex.cafe";
export const SAFE_WALLET = "https://app.safe.global";
const DIST = fileURLToPath(new URL("../dist/", import.meta.url));
const SCREENSHOTS = process.env.SCREENSHOTS;
export const RPC_ORIGINS = RPCS.map((url) => new URL(url).origin);
const CORS = { "access-control-allow-origin": "*", "access-control-allow-headers": "content-type" };

// Owners at BLOCK.
export const MEMBER = getAddress("0x388b2d29e7919d45b1b8f6e88b8a13a392f97b40"); // #9540 in Carbon Impact, #14485 its own
export const NEWCOMER = getAddress("0x0208ddbc05a91e1b937e8b3140b62ef22a274c95"); // #141 its own, #42877 in Liquid Hydrex
export const ELSEWHERE = getAddress("0x69707a120ade8239f07595165e180c61395ea655"); // #2435 in Lock Maxi, #2439 in USDC
export const LEAVER = getAddress("0x2573264b8e690ca6b2128c113890f42198840b16"); // #53350 and #82206 in Carbon Impact
export const ENDED = getAddress("0x2518820268e4079e90446b93020dfad7dd54e84d"); // #123351 ended with HYDX in it, #123364
export const PAYEE = getAddress("0x60924601e73ebc5c2bd9244c788d93e0710a6c93"); // #82774 in Carbon Impact, paid Wed 23 Sep
// Carbon Impact's last payout before BLOCK: one transaction, on Wed 23 Sep, that paid these accounts through Thu 17 Sep.
export const PAID = 51_698_051;
export const PAID_THROUGH = 1_789_603_200;
export const PAID_TX = "0x0932e5a24f24e45bfd1021764d94abc1d920754c4dc17128dd89f44bd086e899";
export const PAID_IDS = [26432n, 82774n, 14247n, 35366n];
const LIQUID_HYDREX = getAddress("0x809F8175b8F60960dF2bc7a78a7C4Eb04d138AF0");
export const LOCK_MAXI = getAddress("0x53388a4E98Bb56F8571433F5461010Fc287929d3");
export const USDC = getAddress("0xE57b3Ea02336B9b418cA523aB5aD6f479d93bD1D");
export const RECIPIENT = getAddress("0x000000000000000000000000000000000000beef");
export const STRANGER = getAddress("0x000000000000000000000000000000000000dead");
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
// the test wallet sets a generous limit, as wallets add a margin: 16 million, under the 16.7 million a transaction may
// use on Base, as a claim split into calls can take several million each.
export const GAS = "0xf42400";

export const abi = parseAbi([
  "function getLockDelegatee(uint256 tokenId) view returns (address)",
  "function getClaimRedirectApproved(uint256 tokenId) view returns (address)",
  "function getClaimApproved(uint256 tokenId) view returns (address)",
  "function transferFrom(address from, address to, uint256 tokenId)",
  "function setConduitApproval(address conduit, uint256 tokenId, bool approve)",
  "function claim(uint256 tokenId, address[] feeAddresses, address[] bribeAddresses, address[] tokens) returns (uint256[])",
]);

const hex = (n: number) => `0x${n.toString(16)}`;

// The fetch there was before warm() replaced it.
const nodeFetch = globalThis.fetch;

// What a request to anvil reads is fetched from FORK_URL meanwhile, all at once: see rpc-cache.ts.
const prefetch = (body: string): void =>
  void nodeFetch(`${CACHE_URL}/prefetch`, { method: "POST", body }).catch(() => {});

async function post(body: string): Promise<string> {
  prefetch(body);
  return (await nodeFetch(ANVIL, { method: "POST", headers: { "content-type": "application/json" }, body })).text();
}

export async function anvil<T>(method: string, params: unknown[] = []): Promise<T> {
  const reply = await post(JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }));
  const { result, error } = JSON.parse(reply) as { result: T; error?: { message: string } };
  if (error) throw new Error(`${method}: ${error.message}`);
  return result;
}

// Sends a transaction from an account anvil impersonates, with no tip, as anvil 1.5 filled it in. anvil 1.8 tips 1 gwei
// over a fee cap it takes from the base fee alone under --disable-min-priority-fee, and so refuses its own transaction.
// The cache hears of it before anyone asks for its receipt, which anvil would otherwise ask FORK_URL for until it mines
// it: see rpc-cache.ts.
export async function send(tx: { from: string; to: string; data: string; gas?: string }): Promise<Hex> {
  const hash = await anvil<Hex>("eth_sendTransaction", [{ ...tx, maxPriorityFeePerGas: "0x0" }]);
  await nodeFetch(`${CACHE_URL}/sent`, { method: "POST", body: hash });
  return hash;
}

export async function view(to: Address, functionName: string, args: unknown[]): Promise<Address> {
  const data = encodeFunctionData({ abi, functionName, args } as never);
  const reply = await anvil<Hex>("eth_call", [{ to, data }, "latest"]);
  return decodeFunctionResult({ abi, functionName, data: reply } as never) as Address;
}

// The page gives each request five seconds, but anvil fetches the state it lacks from FORK_URL one slot at a time. So
// Node makes the slow first reads with no time limit, and the page then finds them cached.
export async function warm(reads: () => Promise<unknown>): Promise<void> {
  globalThis.fetch = (_, init) => {
    prefetch(String(init?.body));
    return nodeFetch(ANVIL, { ...init, signal: null });
  };
  try {
    await reads();
  } finally {
    globalThis.fetch = nodeFetch;
  }
}

// Sends a transaction, and waits for Base, or anvil, to include it.
// A transaction that anvil has not mined in two minutes, even reading its state from FORK_URL, fails its test there
// and then, rather than at the suite's timeout.
export async function mined(from: Address, to: Address, data: Hex): Promise<void> {
  const hash = await send({ from, to, data, gas: GAS });
  for (const deadline = Date.now() + 120_000; Date.now() < deadline;) {
    const receipt = await anvil<{ status: Hex } | null>("eth_getTransactionReceipt", [hash]);
    if (receipt) return assert.equal(receipt.status, "0x1", `${hash} failed`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.fail(`${hash} was not mined in two minutes`);
}

// AutoMaxi's constructor needs fresh Chainlink prices and Base's sequencer up. anvil's clock runs on from the fork's,
// so it deploys a minute after BLOCK.
export async function deployAutoMaxi(): Promise<void> {
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
export const settle = () => anvil("anvil_mine", [hex(SETTLED + 1)]);

// A claim through AutoMaxi of one reward, from its fees or incentives contract.
export async function claimOne(from: Address, id: bigint, { contract, token, fee }: Reward): Promise<void> {
  const args = [id, fee ? [contract] : [], fee ? [] : [contract], [token.address]];
  await mined(from, AUTOMAXI.address, encodeFunctionData({ abi, functionName: "claim", args } as never));
}

export async function expectApprovals(ids: bigint[], delegate: Address, claimer: Address): Promise<void> {
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
  // The Safe that Safe{Wallet}'s page holds.
  safe?: Address;
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
  safe: Address;
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

const safePage = (safe: Address) => `<!doctype html><meta charset="utf-8"><title>Safe{Wallet}</title>
<iframe src="${SITE}/" style="inline-size: 100%; block-size: 95vh; border: 0"></iframe>
<script>
  window.received = [];
  addEventListener("message", ({ origin, source, data }) => {
    if (origin !== "${SITE}" || !data?.method) return;
    window.received.push({ method: data.method, params: data.params });
    const answers = {
      getSafeInfo: { safeAddress: "${safe}", chainId: 8453, threshold: 2, owners: [], isReadOnly: false },
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
        return { result: await send({ to, data, from: options.owner, gas: GAS }) };
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
          hashes.push(await send({ to, data, from: options.owner, gas: GAS }));
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
export const forwarding = new Set<Promise<string>>();

async function serve(route: Route, { origins, rpc, safe }: Pick<Opened, "origins" | "rpc" | "safe">): Promise<void> {
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
  if (origin === SAFE_WALLET) return route.fulfill({ contentType: "text/html", body: safePage(safe) });
  return route.abort();
}

let browser: Browser;
let node: ChildProcess;
let snapshot: Hex;
const contexts: BrowserContext[] = [];

export async function open(
  wallet: Partial<WalletOptions> | false,
  {
    width = 1440,
    height = 900,
    dark = false,
    url = `${SITE}/`,
    flowing = false,
    script = true,
    refuse,
    safe = LEAVER,
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
    safe,
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
export async function connected(wallet: Partial<WalletOptions>, options?: OpenOptions): Promise<Opened> {
  const opened = await open(wallet, { url: `${SITE}/#hydrex`, ...options });
  await opened.page.getByRole("button", { name: "Test Wallet" }).click();
  return opened;
}

export const app = (page: Page) => page.locator('.view[data-view="app"]');
export const hydrex = (page: Page) => page.locator('.view[data-view="hydrex"]');
export const account = (page: Page, id: number) =>
  hydrex(page)
    .locator("#accounts li")
    .filter({ hasText: `#${id}` });
// The Hydrex accounts' groups: "needs", "in:carbon-impact", "in:automaxi", "other" and "closed".
export const group = (page: Page, key: string) => hydrex(page).locator(`.group[data-group="${key}"]`);
export const product = (page: Page, kind: string) => page.locator(`.view[data-kind="${kind}"]`);
export const position = (page: Page) => page.locator('.view[data-view="position"]');
export const review = (page: Page | FrameLocator) => page.locator("#review");
export const homeTitle = (page: Page) => page.getByRole("heading", { name: "Vote, claim and swap on Base" });
export const appTitle = (page: Page) => page.getByRole("heading", { name: "Your wallet", level: 1 });
export const hydrexTitle = (page: Page) => page.getByRole("heading", { name: "Hydrex", level: 1 });
export const toHydrex = (page: Page) => page.goto(`${SITE}/#hydrex`);
export const chip = (page: Page, owner: Address) => page.locator("header").getByText(short(owner));

// Goes through the join's first step, to the calls.
export async function toWallet(page: Page): Promise<void> {
  await review(page).getByRole("heading", { name: "Before you join" }).waitFor();
  await review(page).getByRole("button", { name: "Continue" }).click();
  await review(page).getByRole("heading", { name: "What your wallet will ask" }).waitFor();
}

// Waits until the page names the next epoch's start, as it does in each automation's popup on joining.
export async function nextEpoch(page: Page, day: RegExp): Promise<void> {
  await page.waitForFunction(
    (source) => new RegExp(source).test(document.querySelector("time.next-epoch")?.textContent ?? ""),
    day.source,
  );
}

// Opens each call's fields in the review, as someone checking them would.
export async function openCalls(page: Page): Promise<void> {
  const closed = review(page).locator(".slip-details:not([open]) > summary");
  while (await closed.count()) await closed.first().click();
}

export async function pick(page: Page, ...ids: number[]): Promise<void> {
  for (const id of ids) await page.getByRole("checkbox", { name: `Pick Account #${id}` }).check();
}

export async function shoot(page: Page, name: string, part?: Locator): Promise<void> {
  if (!SCREENSHOTS) return;
  mkdirSync(SCREENSHOTS, { recursive: true });
  if (part) return void (await part.screenshot({ path: `${SCREENSHOTS}/${name}.png` }));
  const fullPage = !(await review(page).isVisible());
  await page.screenshot({ path: `${SCREENSHOTS}/${name}.png`, fullPage });
}

// Waits for the review's one prompt to be included, for two minutes at most, as mined() does.
export async function confirm(page: Page): Promise<void> {
  try {
    await review(page).getByRole("button", { name: "Confirm in your wallet" }).click();
    await review(page).getByText("Done.").waitFor({ timeout: 120_000 });
  } catch (error) {
    const shown = await review(page).locator(".progress").allTextContents();
    throw new Error(`The review shows: ${JSON.stringify(shown)}`, { cause: error });
  }
  await review(page).getByRole("button", { name: "Close" }).click();
}

// Confirms the review's transactions one by one, each once the one before is included, until the last is. anvil first
// runs them all at once, as `from`, with no time limit: so it reads the state they need in parallel, rather than for one
// transaction after another, which on a first run can take minutes each.
export async function confirmEach(page: Page, from: Address): Promise<void> {
  const hexes = (selector: string) =>
    review(page)
      .locator(selector)
      .evaluateAll((elements) => elements.map((element) => element.textContent!.replace(/\s/g, "")));
  const [tos, datas] = await Promise.all([hexes(".to"), hexes(".data")]);
  await Promise.all(
    tos.map((to, i) => anvil("eth_call", [{ from, to, data: datas[i], gas: GAS }, "latest"]).catch(() => {})),
  );
  const done = review(page).getByText("Done.");
  const next = review(page)
    .getByRole("button", { name: /^Confirm (in your wallet|transaction \d+ of \d+)$/ })
    .and(review(page).locator("button:enabled"));
  for (let confirmed = 0; ; confirmed++) {
    try {
      await done.or(next).first().waitFor({ timeout: 120_000 });
    } catch (error) {
      const shown = await review(page).locator(".progress").allTextContents();
      throw new Error(`After ${confirmed} confirmed, the review shows: ${JSON.stringify(shown)}`, { cause: error });
    }
    if (await done.isVisible()) return;
    await next.click();
  }
}

// Starts anvil on a fork of Base at `block`, and Chromium; and the hooks that put anvil back after each test. anvil
// forks through the cache that fork/run.ts serves for `block`, in FORK_CACHES, so that every request of the run goes
// to FORK_URL through one queue, however many files run at once.
export async function start(block: number, owners: Address[]): Promise<void> {
  const cached = (JSON.parse(process.env.FORK_CACHES ?? "{}") as Record<string, string>)[block];
  if (!cached)
    throw new Error("Run the browser tests through fork/run.ts, which serves the caches anvil forks through.");
  CACHE_URL = cached;
  const port = await freePort();
  ANVIL = `http://127.0.0.1:${port}`;
  node = spawn(
    "anvil",
    // anvil keeps no answers of its own, so that the cache sees each request. Its gas price is the block's base fee, as
    // on Base, where tips are next to nothing: anvil's own least tip, 1 gwei, would price gas 200 times higher. It waits
    // for the cache as long as the cache waits for FORK_URL, up to 5 minutes for an answer, rather than its own 45 s.
    [
      ...["--fork-url", CACHE_URL, "--fork-block-number", String(block), "--port", String(port), "--auto-impersonate"],
      ...["--no-storage-caching", "--disable-min-priority-fee", "--timeout", "600000"],
    ],
    { stdio: ["ignore", "ignore", process.env.ANVIL_LOG ? "inherit" : "ignore"] },
  );
  // anvil listens once it has read the fork's block, which a busy FORK_URL may take minutes to answer.
  for (;;) {
    try {
      await anvil("eth_chainId");
      break;
    } catch {
      if (node.exitCode !== null) throw new Error(`anvil stopped as it started, with code ${node.exitCode}.`);
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  for (const token of NATIVE) await anvil("anvil_setCode", [token, "0x"]);
  for (const owner of owners) await anvil("anvil_setBalance", [owner, "0x16345785d8a0000"]); // 0.1 ETH
  browser = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
}

// Starts a fork at BLOCK, for the owners there, and reads with no time limit what the page reads first, which a first
// run fetches from FORK_URL for minutes: each owner's accounts, and what each automation earned last epoch. And as
// Carbon Impact paid nothing from Wed 23 Sep, for any account in it the payouts also read the pools of the epoch from
// Thu 1 Oct, among every pool's reward contracts.
export async function startAtBlock(): Promise<void> {
  const owners = [MEMBER, NEWCOMER, ELSEWHERE, LEAVER, ENDED];
  await start(BLOCK, owners);
  await warm(() =>
    Promise.all([
      ...owners.map((owner) => readAccounts(owner)),
      ...AUTOMATIONS.map(({ address }) => readEarnings(address)),
      rewardsFor(CONDUIT, FLIP - 3 * WEEK),
    ]),
  );
}

// A port nothing listens on now.
async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as { port: number };
  await new Promise((resolve) => server.close(resolve));
  return port;
}

// anvil busy with a request can take long to stop: after five seconds, it is made to.
export async function stop(): Promise<void> {
  await browser?.close();
  await Promise.allSettled(forwarding);
  if (node && node.exitCode === null && node.signalCode === null) {
    const exited = new Promise((resolve) => node.once("exit", resolve));
    node.kill();
    const late = setTimeout(() => node.kill("SIGKILL"), 5_000);
    await exited;
    clearTimeout(late);
  }
}

export function hooks(): void {
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

export const tokenAbi = parseAbi([
  "function balanceOf(address owner) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function transfer(address to, uint256 amount) returns (bool)",
]);
export const autoMaxiAbi = parseAbi(["function lastClaimBlock(uint256 tokenId) view returns (uint256)"]);

export async function readOn<T>(
  to: Address,
  abi: typeof tokenAbi | typeof autoMaxiAbi,
  functionName: string,
  args: unknown[],
): Promise<T> {
  const data = encodeFunctionData({ abi, functionName, args } as never);
  const reply = await anvil<Hex>("eth_call", [{ to, data }, "latest"]);
  return decodeFunctionResult({ abi, functionName, data: reply } as never) as T;
}
export const balanceOf = (token: Address, owner: Address) => readOn<bigint>(token, tokenAbi, "balanceOf", [owner]);

export const swapView = (page: Page) => page.locator('.view[data-view="swap"]');

// Reads, with no time limit, what the page reads of an owner's payouts, what the claim of #82774 reads, and the routes
// into the default output and the prices now for what it brings, which the claim's review reads as it opens.
export async function warmPayouts(owner: Address): Promise<void> {
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
    const [[owed]] = await Promise.all([
      readEarned([82774n], pairs, "latest"),
      readStamps(ids, last, top),
      readEarned(ids, last, top),
      readStamps(ids, before, top),
    ]);
    const brought = new Map<Address, bigint>();
    pairs.forEach(({ token }, i) => brought.set(token, (brought.get(token) ?? 0n) + (owed![i] ?? 0n)));
    const into = swapperOf(DEFAULT_OUTPUT)!;
    const tokens = new Map<Address, Token>(
      [...earnings.rewards, ...earlier].map(({ token }) => [token.address, token]),
    );
    const owing = [...brought].filter(([, amount]) => amount > 0n);
    await Promise.all([
      ...owing
        .filter(([token]) => !same(token, into.token))
        .map(([token, amount]) => findRoute(token, amount, into, true).catch(() => undefined)),
      pricesNow(
        [
          ...owing.map(([token]) => tokens.get(token)!),
          ...SWAPPERS.map(({ token, decimals, symbol }) => ({ address: token, decimals, symbol })),
        ],
        new Map(owing.map(([token, amount]) => [token.toLowerCase(), amount])),
      ).catch(() => undefined),
    ]);
  });
}

// A claim's review opens on what waits, unless the page found nothing to claim, or Base refused the claim: the test then
// fails at once, with the page's words.
export async function claimOpens(page: Page | FrameLocator): Promise<void> {
  const waits = review(page).getByRole("heading", { name: "What waits" });
  const refused = review(page)
    .locator(".pages p")
    .filter({ hasText: /^(Nothing to claim|Base refused the claim)/ });
  await waits.or(refused).first().waitFor({ timeout: 300_000 });
  if (!(await waits.isVisible())) assert.fail(`The claim's review says: ${await refused.innerText()}`);
}
