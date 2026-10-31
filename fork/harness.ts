import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { after, afterEach, before, beforeEach } from "node:test";
import { chromium, type Browser, type BrowserContext, type Locator, type Page } from "playwright-core";
import { encodeFunctionData, getAddress, parseAbi, toHex, type Address, type Hex } from "viem";
import { RPCS, VOTING_ESCROW } from "../src/config.ts";
import { serveCache } from "./cache.ts";

// The page in Chromium against anvil's fork of Base, at a block after Double Espresso's and the swappers' deployments
// (Wed 21 Oct 2026), with a test wallet that signs as any address.
export const BLOCK = 52_904_000;
export const SITE = "https://metadex.cafe";
const DIST = new URL("../dist/", import.meta.url).pathname;
const RPC_ORIGINS = RPCS.map((url) => new URL(url).origin);
export const ELSEWHERE = getAddress("0x69707a120ade8239f07595165e180c61395ea655"); // #2435 in Lock Maxi, #2439 in USDC
export const LEAVER = getAddress("0x2573264b8e690ca6b2128c113890f42198840b16"); // #53350 and #82206 in Matcha Latte
export const PAYEE = getAddress("0x60924601e73ebc5c2bd9244c788d93e0710a6c93"); // #82774 in Matcha Latte
export const HOLDER = getAddress("0xd9e966a6bfa2ae2113a34bb4dd02ded921da50af");
export const SELLER = getAddress("0x0000000000000000000000000000000000c0ffee");
export const ZORA = getAddress("0x1111111111166b7fe7bd91427724b487980afc69");
export const AVNT = getAddress("0x696f9436b67233384889472cd7cd58a6fb5df4f1");
// Tokens Base runs natively, whose code 0xef anvil cannot run: without it, they read as no token.
const NATIVE = [
  "0xb200000000000000000000c2e324d24d7eecd1fb",
  "0xb20000000000000000000078ee7ce2fe4908108c",
  "0xb2000000000000000000008bc8786b856e61707c",
  "0xb2000000000000000000004c27f6523082f41d01",
  "0xb2000000000000000000002d0ba3164cc74f58b7",
  "0xb2000000000000000000008501b13360000cb2ec",
  "0xb200000000000000000000451d033a5000cb479e",
  "0xb200000000000000000000856a95738c92feed01",
];
export const abi = parseAbi([
  "function getLockDelegatee(uint256 tokenId) view returns (address)",
  "function getClaimRedirectApproved(uint256 tokenId) view returns (address)",
  "function setConduitApproval(address conduit, uint256 tokenId, bool approve)",
  "function balanceOf(address owner) view returns (uint256)",
  "function transfer(address to, uint256 amount) returns (bool)",
]);

let ANVIL = "";
let node: ChildProcess;
let closeCache: () => void;
let browser: Browser;
let snapshot: Hex;
const contexts: BrowserContext[] = [];

export async function anvil<T>(method: string, params: unknown[] = []): Promise<T> {
  const response = await fetch(ANVIL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const { result, error } = (await response.json()) as { result: T; error?: { message: string } };
  if (error) throw new Error(`${method}: ${error.message}`);
  return result;
}
// anvil impersonates any sender. A generous gas limit, as the VotingEscrow's gas depends on the block's time.
export async function send(from: Address, to: Address, data: Hex): Promise<Hex> {
  const hash = await anvil<Hex>("eth_sendTransaction", [
    { from, to, data, gas: "0xf42400", maxPriorityFeePerGas: "0x0" },
  ]);
  for (let tries = 0; tries < 1200; tries++) {
    const receipt = await anvil<{ status: Hex } | null>("eth_getTransactionReceipt", [hash]);
    if (receipt) return receipt.status === "0x1" ? hash : Promise.reject(new Error(`${hash} failed on the fork.`));
    await new Promise((done) => setTimeout(done, 100));
  }
  throw new Error(`${hash} was not mined.`);
}
export const view = async (to: Address, functionName: string, args: unknown[]): Promise<Hex> =>
  `0x${(await anvil<Hex>("eth_call", [{ to, data: encodeFunctionData({ abi, functionName, args } as never) }, "latest"])).slice(26)}` as Hex;
export const approveConduit = (owner: Address, conduit: Address, id: bigint, approve = true) =>
  send(
    owner,
    VOTING_ESCROW,
    encodeFunctionData({ abi, functionName: "setConduitApproval", args: [conduit, id, approve] }),
  );
// The page reads a few blocks behind the latest, as an RPC may lag.
export const settle = () => anvil("anvil_mine", [toHex(6)]);
// Moves HOLDER's whole balance of each token to SELLER.
export async function fund(tokens: Address[]): Promise<void> {
  for (const token of tokens) {
    const balance = BigInt(
      await anvil<Hex>("eth_call", [
        { to: token, data: encodeFunctionData({ abi, functionName: "balanceOf", args: [HOLDER] }) },
        "latest",
      ]),
    );
    await send(HOLDER, token, encodeFunctionData({ abi, functionName: "transfer", args: [SELLER, balance] }));
  }
}

export function useFork(owners: Address[]): void {
  before(async () => {
    const cache = await serveCache();
    closeCache = cache.close;
    const port = 18_545 + Math.floor(Math.random() * 1000);
    ANVIL = `http://127.0.0.1:${port}`;
    // No storage cache of its own, so that ours sees every request; Base's tips, next to nothing; its timeouts, ours.
    node = spawn(
      "anvil",
      [
        "--fork-url",
        cache.url,
        "--fork-block-number",
        `${BLOCK}`,
        "--port",
        `${port}`,
        "--auto-impersonate",
        "--no-storage-caching",
        "--disable-min-priority-fee",
        "--timeout",
        "600000",
        "--prune-history",
        "100",
      ],
      { stdio: ["ignore", "ignore", process.env.ANVIL_LOG ? "inherit" : "ignore"] },
    );
    for (;;) {
      try {
        await anvil("eth_chainId");
        break;
      } catch {
        if (node.exitCode !== null) throw new Error(`anvil stopped with ${node.exitCode}.`);
        await new Promise((done) => setTimeout(done, 500));
      }
    }
    for (const token of NATIVE) await anvil("anvil_setCode", [token, "0x"]);
    for (const owner of owners) await anvil("anvil_setBalance", [owner, toHex(10n ** 17n)]);
    browser = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
  });
  beforeEach(async () => void (snapshot = await anvil<Hex>("evm_snapshot")));
  afterEach(async () => {
    for (const context of contexts.splice(0)) await context.close();
    await anvil("evm_revert", [snapshot]);
  });
  after(async () => {
    await browser?.close();
    node?.kill();
    closeCache?.();
  });
}

// A wallet the page finds (EIP-6963), which hands each request to Node; with `batch`, EIP-5792 too.
const WALLET = `(() => {
  const listeners = {};
  const provider = {
    async request({ method, params }) {
      const { result, error } = await window.testWallet(method, params ?? []);
      if (error) throw Object.assign(new Error(error.message), { code: error.code });
      return result;
    },
    on(event, listener) { (listeners[event] ??= []).push(listener); },
  };
  const info = { uuid: "6f1e9b4e-0c4b-4d55-9a1d-3a0b5f0e7a10", name: "Test Wallet", rdns: "test.wallet", icon: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 1 1'/%3E" };
  const announce = () => window.dispatchEvent(new CustomEvent("eip6963:announceProvider", { detail: Object.freeze({ info, provider }) }));
  window.addEventListener("eip6963:requestProvider", announce);
  announce();
  // anvil fetches what it lacks from Base slot by slot: the page waits for it rather than give up after 5 seconds.
  AbortSignal.timeout = () => new AbortController().signal;
  document.addEventListener("securitypolicyviolation", (event) => console.error("CSP " + event.violatedDirective));
})();`;

export type Wallet = { owner: Address; batch?: boolean };
function testWallet({ owner, batch }: Wallet, sent: unknown[]) {
  const batches = new Map<string, Hex[]>();
  return async (method: string, params: any[]): Promise<{ result?: unknown; error?: unknown }> => {
    switch (method) {
      case "eth_requestAccounts":
        return { result: [owner] };
      case "eth_chainId":
        return { result: "0x2105" };
      case "eth_sendTransaction":
        sent.push(params[0]);
        return { result: await send(owner, params[0].to, params[0].data) };
      case "wallet_getCapabilities":
        return batch
          ? { result: { "0x2105": { atomic: { status: "supported" } } } }
          : { error: { code: 4200, message: "No batches." } };
      case "wallet_sendCalls": {
        const id = `0x${(batches.size + 1).toString(16).padStart(64, "0")}`;
        const hashes: Hex[] = [];
        batches.set(id, hashes);
        for (const call of params[0].calls) {
          sent.push(call);
          hashes.push(await send(owner, call.to, call.data));
        }
        return { result: { id } };
      }
      case "wallet_getCallsStatus": {
        const receipts = await Promise.all(
          batches.get(params[0])!.map((hash) => anvil("eth_getTransactionReceipt", [hash])),
        );
        return { result: { status: 200, receipts } };
      }
      default:
        return { error: { code: 4200, message: `The test wallet does not answer ${method}.` } };
    }
  };
}

// The page at `url`, its files from dist/, its RPCs answered by anvil, with the test wallet unless none.
export async function open(wallet: Wallet | undefined, url: string, { width = 1440, dark = false } = {}) {
  const context = await browser.newContext({
    viewport: { width, height: 900 },
    colorScheme: dark ? "dark" : "light",
    locale: "en-GB",
  });
  contexts.push(context);
  const sent: unknown[] = [];
  const errors: string[] = [];
  await context.route("**/*", async (route) => {
    const request = route.request();
    const { origin, pathname } = new URL(request.url());
    if (origin === SITE) {
      const path = `${DIST}${pathname === "/" ? "index.html" : pathname.slice(1)}`;
      return route.fulfill(existsSync(path) ? { path } : { status: 404 });
    }
    const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "content-type" };
    if (!RPC_ORIGINS.includes(origin)) return route.abort();
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
    const reply = await fetch(ANVIL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: request.postData() ?? "",
    }).then(
      (response) => response.text(),
      () => undefined,
    );
    return reply === undefined
      ? route.abort()
      : route.fulfill({ headers: { ...cors, "content-type": "application/json" }, body: reply });
  });
  if (wallet) await context.exposeFunction("testWallet", testWallet(wallet, sent));
  await context.addInitScript(WALLET);
  const page = await context.newPage();
  page.on("console", (message) => /CSP/.test(message.text()) && errors.push(message.text()));
  page.on("pageerror", (error) => errors.push(String(error)));
  const { timestamp } = await anvil<{ timestamp: Hex }>("eth_getBlockByNumber", ["latest", false]);
  await page.clock.install({ time: Number(timestamp) * 1000 });
  await page.goto(`${SITE}/${url}`);
  return { page, sent, errors };
}

// Presses Tab until `target` has focus, as someone with a keyboard only would reach it.
export async function tabTo(page: Page, target: Locator): Promise<void> {
  for (let i = 0; i < 80; i++) {
    if (await target.evaluate((element) => element === document.activeElement).catch(() => false)) return;
    await page.keyboard.press("Tab");
  }
  throw new Error(`Tab never reached ${target}.`);
}

// axe-core's WCAG 2.2 A and AA rules, run through page.evaluate, which the page's CSP does not cover.
const AXE = readFileSync(new URL("../node_modules/axe-core/axe.min.js", import.meta.url), "utf8");
export async function violations(page: Page): Promise<string[]> {
  await page.evaluate(AXE);
  const result = await page.evaluate(() =>
    (
      window as unknown as {
        axe: {
          run(
            context: Document,
            options: object,
          ): Promise<{ violations: { id: string; nodes: { target: string[] }[] }[] }>;
        };
      }
    ).axe.run(document, {
      runOnly: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"],
    }),
  );
  return result.violations.map(({ id, nodes }) => `${id}: ${nodes.map(({ target }) => target.join(" ")).join(", ")}`);
}
