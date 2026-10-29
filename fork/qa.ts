// Opens the page in a browser of its own against a fork of Base, to try its flows by hand: `npm run qa`, or `npm run qa
// -- claim` to start from another scenario (scenarios.ts; QA.md says which flow each is for). The page runs as in the
// browser tests, at https://metadex.cafe, its RPCs answered by anvil, with the test wallet, which signs as any address.
// A second window, the QA wallet, picks that address and how the wallet answers, starts the scenarios, moves Base's
// clock on, and makes Base fail as visitors may find it.
//
// anvil forks through the same caches as the browser tests, in FORK_CACHE, from BASE_RPC_URL: after `npm run
// test:fork`, each scenario starts in seconds. CHROMIUM names the browser, as for the tests.
import { readFileSync } from "node:fs";
import { chromium, type BrowserContext, type Page, type Route } from "playwright-core";
import {
  decodeFunctionData,
  decodeFunctionResult,
  encodeAbiParameters,
  encodeDeployData,
  encodeFunctionData,
  encodeFunctionResult,
  getAbiItem,
  getAddress,
  isAddress,
  numberToHex,
  parseAbi,
  parseUnits,
  toFunctionSelector,
  toHex,
  type Address,
  type Hex,
} from "viem";
import tokens from "../src/base-tokens.json" with { type: "json" };
import { EIP1967_IMPLEMENTATION_SLOT, multicall3Abi, same } from "../src/chain.ts";
import {
  AUTOMATIONS,
  DOUBLE_ESPRESSO,
  MATCHA_LATTE,
  CHAIN_ID,
  MULTICALL3,
  RPCS,
  SWAPPERS,
  USDC,
  VOTER,
  VOTING_ESCROW,
} from "../src/config.ts";
import conduits from "../src/hydrex-conduits.json" with { type: "json" };
import { forgetClaims } from "../src/claims.ts";
import { forgetRewards, readEarnings, rewardsFor } from "../src/earnings.ts";
import { WEEK, short } from "../src/format.ts";
import { others } from "../src/hydrex.ts";
import { forgetReads, readEarned, weighed } from "../src/receipts.ts";
import { erc20Abi, swapperAbi } from "../src/swap.ts";
import {
  AVNT,
  FOR_GAS,
  RPC_ORIGINS,
  SAFE_WALLET,
  SITE,
  HOLDER,
  STRANGER,
  ZORA,
  elsewhere,
  abi,
  anvil,
  balanceOf,
  included,
  mined,
  readOn,
  send,
  sendsBatches,
  serve,
  settle,
  startAnvil,
  stopAnvil,
  testWallet,
  tokenAbi,
  walletScript,
  warm,
  type Rpc,
  type Sendable,
  type WalletOptions,
} from "./harness.ts";
import { cacheFileOf, forkUrl, serveCached, upstreamOf, type Cache } from "./rpc-cache.ts";
import { SCENARIOS, scenario as named, type Owner, type Scenario } from "./scenarios.ts";

// As fork/run.ts has it.
const FORK_URL = forkUrl(RPCS[0]!);
const PANEL = readFileSync(new URL("qa.html", import.meta.url), "utf8");
// The QA wallet's window, at the left of the screen. Chromium makes no window narrower than about 500 pixels.
const PANEL_WIDTH = 520;

// The windows that show the page: with the test wallet, with two wallets, or without any, as Safe{Wallet} shows it.
type Kind = "wallet" | "wallets" | "none";
type Prompt = { id: number; text: string; answer: (yes: boolean) => void };
// A change to Base that the QA wallet can make and undo: a failure of Base, a check of the page's that fails, or a
// state of Hydrex's.
type Fault = { group: "base" | "check" | "hydrex"; label: string; on(): Promise<void>; off(): Promise<void> };
// How the wallet sends several calls: one per prompt, in one prompt all or nothing, or in one prompt one by one.
type Calls = "one" | "atomic" | "each";

const QA_ABI = parseAbi([
  "function getConduitApprovalConfig(address conduit) view returns (uint8[] actions, bool active, string name)",
  "function approvalLogic() view returns (address)",
  "function lastVoted(address voter) view returns (uint256)",
  "function ownerOf(uint256 tokenId) view returns (address)",
  "function delegate(uint256 tokenId, address delegatee)",
  "function transferFrom(address from, address to, uint256 tokenId)",
  "function minter() view returns (address)",
  "function update_period() returns (uint256)",
  "function _epochTimestamp() view returns (uint256)",
  "function claimFees(address[] fees, address[][] tokens, uint256 tokenId)",
  "function claimBribes(address[] bribes, address[][] tokens, uint256 tokenId)",
  "function setMyPayoutRecipient(address newRecipient)",
  "function KEEPER() view returns (address)",
  "function vote(address[] pools, uint256[] weights)",
  "function poolVoteLength(address voter) view returns (uint256)",
  "function poolVote(address voter, uint256 index) view returns (address)",
  "function votes(address voter, address pool) view returns (uint256)",
  "function gauges(address pool) view returns (address)",
  "function external_bribes(address gauge) view returns (address)",
  "function notifyRewardAmount(address token, uint256 amount)",
]);
// Matcha Latte's executor module, through which its operator votes and pays: see the README of
// https://github.com/ldeso/hydrex-keeper.
const MATCHA_LATTE_MODULE: Address = "0x750973E0CB728C3112561Bc8E9b235afA9B17E81";
// A token of the QA wallet's own, deployed with a name and symbol: see fixtures/QaToken.sol.
const QA_TOKEN_ABI = parseAbi(["constructor(string name, string symbol, uint8 decimals, uint256 supply)"]);
const QA_TOKEN = readFileSync(new URL("fixtures/qa-token-init-code.hex", import.meta.url), "utf8").trim() as Hex;
const QUOTE = toFunctionSelector(getAbiItem({ abi: swapperAbi, name: "quote" }));
const SWAPPER_ADDRESSES = new Set(SWAPPERS.map(({ address }) => address.toLowerCase()));
const SYMBOL = toFunctionSelector("function symbol()");
// What the owner's own claim on Hydrex takes at most of each of the last two epochs' rewards: the most valuable.
const OWN_CLAIM_PAIRS = 10;
// The QA wallet's commands that send transactions of their own.
const SENDS = new Set([
  "delegate",
  "give",
  "claim-on-hydrex",
  "pay-to",
  "move-on",
  "replay",
  "operator-votes",
  "incentive",
  "mint",
  "send-away",
]);
// Hydrex's automations, the page's own and the others, by name.
const AUTOMATION_NAMES = [...conduits, ...AUTOMATIONS].map(({ name, address }) => ({
  name,
  address: getAddress(address),
}));

// The tokens the QA wallet can send away by symbol: the page's list, and those the scenarios give that it lacks, each
// once.
const TOKENS: { symbol: string; address: string }[] = [
  ...tokens,
  ...[
    { symbol: "AVNT", address: AVNT },
    { symbol: "ZORA", address: ZORA },
  ].filter(({ address }) => !tokens.some((listed) => listed.address.toLowerCase() === address.toLowerCase())),
];
// Names for the contracts the wallet is asked to call.
const NAMES = new Map<string, string>([
  ...TOKENS.map(({ address, symbol }): [string, string] => [address.toLowerCase(), symbol]),
  ...SWAPPERS.map(({ address, symbol }): [string, string] => [address.toLowerCase(), `the ${symbol} swapper`]),
  [VOTING_ESCROW.toLowerCase(), "Hydrex's VotingEscrow"],
  [VOTER.toLowerCase(), "Hydrex's Voter"],
  [MATCHA_LATTE.address.toLowerCase(), "Matcha Latte"],
  [DOUBLE_ESPRESSO.address.toLowerCase(), "Double Espresso"],
]);
const CALLS = [...abi, ...erc20Abi, ...swapperAbi];

function callWords({ to, data }: { to: string; data: Hex }): string {
  let name: string = data.slice(0, 10);
  try {
    name = decodeFunctionData({ abi: CALLS, data }).functionName;
  } catch {}
  return `${name} on ${NAMES.get(to.toLowerCase()) ?? short(getAddress(to))}`;
}

function requestWords(method: string, params: any[], owner: Address): string {
  switch (method) {
    case "eth_requestAccounts":
      return `Connect as ${short(owner)}`;
    case "wallet_switchEthereumChain":
      return `Switch to ${Number(params[0].chainId) === CHAIN_ID ? "Base" : `chain ${Number(params[0].chainId)}`}`;
    // As the address the page names, as the test wallet sends.
    case "eth_sendTransaction":
      return `Send ${callWords(params[0])} as ${short(params[0].from ?? owner)}`;
    case "wallet_sendCalls": {
      const calls = params[0].calls as { to: string; data: Hex }[];
      const from = short(params[0].from ?? owner);
      return `Send ${calls.length} calls in one prompt as ${from}: ${calls.map(callWords).join("; ")}`;
    }
    default:
      return method;
  }
}
const LOGGED = new Set([
  "eth_requestAccounts",
  "wallet_switchEthereumChain",
  "wallet_addEthereumChain",
  "eth_sendTransaction",
  "wallet_sendCalls",
]);

export type Session = {
  panel: Page;
  // The QA wallet's commands, as its window sends them.
  command(name: string, ...args: any[]): Promise<unknown>;
  // The windows that show the page now.
  sites(): BrowserContext[];
  // Resolves once the first scenario has started, or failed to.
  started: Promise<void>;
  // Resolves once the browser closes, or its QA wallet does.
  closed: Promise<void>;
  close(): Promise<void>;
};

export async function launch(first: Scenario, { headless = false } = {}): Promise<Session> {
  const upstream = upstreamOf(FORK_URL);
  const caches = new Map<number, Promise<Cache>>();
  // A cache that failed to start is tried again the next time.
  const cacheAt = async (block: number): Promise<string> => {
    if (!caches.has(block)) {
      const cache = serveCached(upstream, cacheFileOf(block), block);
      caches.set(block, cache);
      cache.catch(() => caches.get(block) === cache && caches.delete(block));
    }
    return (await caches.get(block)!).url;
  };

  // Stopped, as by Ctrl-C, the session closes itself, so that the fork's answers are kept: see close.
  const browser = await chromium.launch({
    headless,
    handleSIGINT: false,
    handleSIGTERM: false,
    ...(process.env.CHROMIUM && { executablePath: process.env.CHROMIUM }),
  });
  let current = first;
  let busy = "";
  let failure = "";
  // Addresses typed in, which the list keeps.
  const typed: Owner[] = [];
  const prompts: Prompt[] = [];
  let prompted = 0;
  const log: string[] = [];
  let asks = false;
  // Once the session closes; and the scenario's start that runs or waits its turn, which never fails.
  let closing: Promise<void> | undefined;
  let starting: Promise<void> = Promise.resolve();

  const note = (line: string) => {
    const time = new Date().toISOString().slice(11, 19);
    log.unshift(`${time} ${line}`);
    log.length = Math.min(log.length, 40);
    console.log(`QA wallet: ${line}`);
  };

  // Its window: Node answers each call to qa().
  const panelContext = await browser.newContext({ viewport: null, colorScheme: null });
  await panelContext.route("**/*", (route) => route.fulfill({ contentType: "text/html", body: PANEL }));
  const panel = await panelContext.newPage();

  const wallet: WalletOptions = {
    owner: first.owners[0]!.address,
    chainId: CHAIN_ID,
    decline: false,
    switches: true,
    batch: false,
    failing: 0,
    // As a wallet's window does, the QA wallet comes to the front with each request it asks about.
    ask: (method, params) =>
      !asks
        ? Promise.resolve(true)
        : new Promise((answer) => {
            prompts.push({ id: ++prompted, text: requestWords(method, params, wallet.owner), answer });
            void panel.bringToFront().catch(() => {});
          }),
  };
  const handle = testWallet(wallet);
  // The wallet's requests that Node has not answered yet: a scenario's start waits for them, so that none sends what is
  // left of it to the next scenario's fork.
  const requests = new Set<Promise<unknown>>();
  function walletRequest(method: string, params: any[]) {
    const reply = respond(method, params);
    requests.add(reply);
    void reply.catch(() => {}).finally(() => requests.delete(reply));
    return reply;
  }
  async function respond(method: string, params: any[]) {
    // The account picked as the page asks, as the reply's note names it, even if another is picked meanwhile.
    const owner = wallet.owner;
    const reply = await handle(method, params);
    if (LOGGED.has(method)) {
      const { result, error } = reply as { result?: unknown; error?: { message: string } };
      const outcome = error ? error.message : typeof result === "string" ? `sent ${result.slice(0, 10)}…` : "done";
      note(`${requestWords(method, params, owner)}: ${outcome}`);
    }
    return reply;
  }

  // The page's own requests go to the fork; a link out of it opens as it would anywhere.
  const rpc: Rpc = { rewrite: (body, reply) => rewrite(body, reply) };
  const shared = {
    origins: new Set<string>(),
    rpc,
    // Safe{Wallet} holds the address signed as, on the wallet's network.
    get safe() {
      return wallet.owner;
    },
    get safeChainId() {
      return wallet.chainId;
    },
  };
  function routeSite(route: Route): Promise<void> {
    const request = route.request();
    const { origin } = new URL(request.url());
    if ([SITE, SAFE_WALLET, ...RPC_ORIGINS].includes(origin))
      return serve(route, shared).catch(() => route.abort().catch(() => {}));
    return request.isNavigationRequest() ? route.continue() : route.abort();
  }

  const latest = async () => {
    const { number, timestamp } = await anvil<{ number: Hex; timestamp: Hex }>("eth_getBlockByNumber", [
      "latest",
      false,
    ]);
    return { block: Number(number), time: Number(timestamp) };
  };
  // A contract's answer on the fork, at its newest block. One without code there, as a failure ticked below may leave
  // it, says so rather than that its empty answer cannot be decoded.
  const view = async <T>(to: Address, functionName: string, args: unknown[] = []): Promise<T> => {
    try {
      return await readOn<T>(to, QA_ABI, functionName, args);
    } catch (error) {
      if ((await anvil<Hex>("eth_getCode", [to, "latest"])) !== "0x") throw error;
      throw new Error(`${NAMES.get(to.toLowerCase()) ?? short(to)} has no code on the fork: is a failure ticked?`);
    }
  };

  // Each window's clock starts at Base's time on the fork, then runs, as in the browser tests.
  const sites = new Map<Kind, BrowserContext>();
  async function site(kind: Kind): Promise<BrowserContext> {
    const open = sites.get(kind);
    if (open) return open;
    const context = await browser.newContext({ viewport: null, colorScheme: null });
    // Kept once it is set up: one that fails to be is closed, and the next open sets up another.
    try {
      await context.route("**/*", routeSite);
      if (kind !== "none") {
        await context.exposeFunction("testWallet", walletRequest);
        await context.addInitScript(
          walletScript(kind === "wallets" ? ["Test Wallet", "Other Wallet"] : ["Test Wallet"]),
        );
      }
      await context.clock.install({ time: (await latest()).time * 1000 });
    } catch (error) {
      await context.close().catch(() => {});
      throw error;
    }
    sites.set(kind, context);
    context.on("close", () => sites.get(kind) === context && sites.delete(kind));
    return context;
  }

  // The page's windows go beside the QA wallet's.
  async function place(page: Page, left: number): Promise<void> {
    if (headless) return;
    try {
      const { width, height } = await panel.evaluate(() => ({ width: screen.availWidth, height: screen.availHeight }));
      const session = await page.context().newCDPSession(page);
      const { windowId } = (await session.send("Browser.getWindowForTarget")) as { windowId: number };
      const bounds = left
        ? { left, top: 0, width: Math.max(width - left, 800), height }
        : { left, top: 0, width: PANEL_WIDTH, height };
      await session.send("Browser.setWindowBounds", { windowId, bounds });
      await session.detach();
    } catch {}
  }

  async function open(kind: Kind | "safe"): Promise<void> {
    // Safe{Wallet} shows the page in a frame, without the test wallet, as the browser tests do.
    const context = await site(kind === "safe" ? "none" : kind);
    const page = await context.newPage();
    await place(page, PANEL_WIDTH);
    await page.goto(kind === "safe" ? `${SAFE_WALLET}/` : `${SITE}/${current.hash}`);
    await page.bringToFront();
  }

  // The test wallet's events reach the page in every window and frame it is in.
  async function emit(event: string, value: unknown): Promise<void> {
    for (const context of sites.values())
      for (const page of context.pages())
        for (const frame of page.frames())
          await frame
            .evaluate(([event, value]) => (window as any).testWalletEmit?.(event, value), [event, value] as const)
            .catch(() => {});
  }

  // What changed code, by address, to put back.
  const codes = new Map<Address, Hex>();
  const code = (address: Address, change: (code: Hex) => Hex) => ({
    async on() {
      const was = await anvil<Hex>("eth_getCode", [address, "latest"]);
      codes.set(address, was);
      await anvil("anvil_setCode", [address, change(was)]);
    },
    async off() {
      await anvil("anvil_setCode", [address, codes.get(address)!]);
    },
  });

  // Reads whose answer is changed, by the contract and calldata of each, inside the page's Multicall3 batches: so one
  // read answers otherwise, and Base stays as it is. Those that `failing` matches fail on their own, as a call that
  // reverts, while the batch's other reads still answer; and the swappers' quotes come in under, when they do.
  const answers = new Map<string, (data: Hex) => Hex>();
  const failing = new Set<(target: Address, callData: Hex) => boolean>();
  const callKey = (target: string, data: string) => `${target} ${data}`.toLowerCase();
  type Result = { success: boolean; returnData: Hex };
  function changeOf(target: Address, callData: Hex): ((result: Result) => Result) | undefined {
    if ([...failing].some((fails) => fails(target, callData))) return () => ({ success: false, returnData: "0x" });
    const change =
      answers.get(callKey(target, callData)) ??
      (quotesUnder && SWAPPER_ADDRESSES.has(target.toLowerCase()) && callData.startsWith(QUOTE) ? under : undefined);
    return change && ((result) => (result.success ? { ...result, returnData: change(result.returnData) } : result));
  }
  function rewrite(body: string, reply: string): string | undefined {
    if (!answers.size && !failing.size && !quotesUnder) return undefined;
    const { method, params = [] } = JSON.parse(body) as { method: string; params?: { to?: string; data?: Hex }[] };
    const [{ to = "", data = "0x" } = {}] = params;
    if (method !== "eth_call" || !same(to, MULTICALL3)) return undefined;
    const { functionName, args } = decodeFunctionData({ abi: multicall3Abi, data });
    if (functionName !== "aggregate3") return undefined;
    const changes = args[0].map(({ target, callData }) => changeOf(target, callData));
    const answer = JSON.parse(reply) as { result?: Hex };
    if (!changes.some(Boolean) || !answer.result) return undefined;
    const results = decodeFunctionResult({ abi: multicall3Abi, functionName: "aggregate3", data: answer.result });
    const result = results.map((each, i) => changes[i]?.(each) ?? each);
    return JSON.stringify({
      ...answer,
      result: encodeFunctionResult({ abi: multicall3Abi, functionName: "aggregate3", result }),
    });
  }
  const answered = (target: Address, functionName: string, args: unknown[], change: (data: Hex) => Hex) => {
    const key = callKey(target, encodeFunctionData({ abi: QA_ABI, functionName, args } as never));
    return {
      on: async () => void answers.set(key, change),
      off: async () => void answers.delete(key),
    };
  };
  const another = (): Hex => encodeAbiParameters([{ type: "address" }], [STRANGER]);
  // What joining an automation approves, no longer active.
  const inactive = (data: Hex): Hex => {
    const [actions, , name] = decodeFunctionResult({ abi: QA_ABI, functionName: "getConduitApprovalConfig", data });
    return encodeFunctionResult({
      abi: QA_ABI,
      functionName: "getConduitApprovalConfig",
      result: [actions, false, name],
    });
  };
  // Each swapper's quotes, a tenth under what its pools give: far under the page's own prices, which it says.
  let quotesUnder = false;
  const under = (data: Hex): Hex => {
    const results = decodeFunctionResult({ abi: swapperAbi, functionName: "quote", data });
    const lower = results.map((each) => ({ ...each, amountOut: (each.amountOut * 9n) / 10n }));
    return encodeFunctionResult({ abi: swapperAbi, functionName: "quote", result: lower });
  };
  // The requests to Base that fail, each by what it holds.
  const refusing = new Set<(body: string) => boolean>();
  rpc.refuse = (body) => [...refusing].some((refuses) => refuses(body));
  const refused = (refuses: (body: string) => boolean) => ({
    on: async () => void refusing.add(refuses),
    off: async () => void refusing.delete(refuses),
  });
  // Answers in place of the fork's, each to the requests it knows: the first that answers does.
  const answering = new Set<(body: string) => string | undefined>();
  rpc.answer = (body) =>
    [...answering].reduce<string | undefined>((reply, answers) => reply ?? answers(body), undefined);
  const answer = (answers: (body: string) => string | undefined) => ({
    on: async () => void answering.add(answers),
    off: async () => void answering.delete(answers),
  });
  // The VotingEscrow's implementation, as if Hydrex had upgraded it: another address in its EIP-1967 slot, told to the
  // page alone, so that the fork's VotingEscrow still works.
  const upgraded = (body: string): string | undefined => {
    let call: { id?: unknown; method?: string; params?: unknown[] };
    try {
      call = JSON.parse(body);
    } catch {
      return undefined;
    }
    const [to, slot] = (call.params ?? []) as string[];
    if (call.method !== "eth_getStorageAt" || !same(String(to), VOTING_ESCROW)) return undefined;
    if (slot?.toLowerCase() !== EIP1967_IMPLEMENTATION_SLOT) return undefined;
    return JSON.stringify({ jsonrpc: "2.0", id: call.id ?? 1, result: another() });
  };
  // The reads that fail on their own.
  const fail = (fails: (target: Address, callData: Hex) => boolean) => ({
    on: async () => void failing.add(fails),
    off: async () => void failing.delete(fails),
  });
  // An automation's figures: what the Voter answers about it.
  const figuresOf = (automation: Address) => {
    const word = automation.slice(2).toLowerCase();
    return fail((target, callData) => same(target, VOTER) && callData.toLowerCase().includes(word));
  };

  // When each of Hydrex's other automations last voted, kept in the Voter's storage, by the slot that holds it.
  const voted = new Map<Hex, Hex>();
  async function voteAgain(): Promise<void> {
    const { time } = await latest();
    // What it changed, put back if it fails; and the automations that never voted, which have no record to move on.
    const changed = new Map<Hex, Hex>();
    const left: string[] = [];
    try {
      for (const { address, name } of others) {
        const was = await view<bigint>(VOTER, "lastVoted", [getAddress(address)]);
        const data = encodeFunctionData({ abi: QA_ABI, functionName: "lastVoted", args: [getAddress(address)] });
        const { accessList } = await anvil<{ accessList: { address: string; storageKeys: Hex[] }[] }>(
          "eth_createAccessList",
          [{ to: VOTER, data }, "latest"],
        );
        const keys = accessList.filter((each) => same(each.address, VOTER)).flatMap((each) => each.storageKeys);
        const stored = await Promise.all(keys.map((key) => anvil<Hex>("eth_getStorageAt", [VOTER, key, "latest"])));
        const at = stored.findIndex((value) => BigInt(value) === was);
        if (!was || at < 0) {
          left.push(name);
          continue;
        }
        changed.set(keys[at]!, stored[at]!);
        await anvil("anvil_setStorageAt", [VOTER, keys[at]!, numberToHex(time, { size: 32 })]);
      }
      if (!changed.size) throw new Error("The Voter has no record of when Hydrex's other automations voted.");
    } catch (error) {
      for (const [slot, was] of changed) await anvil("anvil_setStorageAt", [VOTER, slot, was]);
      throw error;
    }
    for (const [slot, was] of changed) voted.set(slot, was);
    if (left.length) note(`${left.join(", ")}: never voted, and still look stopped`);
  }

  const FAULTS: Record<string, Fault> = {
    "rpc-down": { group: "base", label: "Base's RPCs fail", ...refused(() => true) },
    symbols: {
      group: "base",
      label: "Tokens' symbols cannot be read",
      ...fail((_, callData) => callData.startsWith(SYMBOL)),
    },
    "matcha-latte-figures": {
      group: "base",
      label: "Matcha Latte's figures cannot be read",
      // Its votes, read from the Voter for Matcha Latte's address: Double Espresso's still read.
      ...figuresOf(MATCHA_LATTE.address),
    },
    "double-espresso-figures": {
      group: "base",
      label: "Double Espresso's figures cannot be read",
      ...figuresOf(DOUBLE_ESPRESSO.address),
    },
    "quotes-under": {
      group: "base",
      label: "Swap quotes come in a tenth under price",
      on: async () => void (quotesUnder = true),
      off: async () => void (quotesUnder = false),
    },
    chain: {
      group: "base",
      label: "Base's RPCs serve another chain",
      ...answer(elsewhere),
    },
    "voter-gone": { group: "base", label: "Hydrex's Voter cannot be read", ...code(VOTER, () => "0x") },
    // As the README's table names them, by the ids of their messages on the page.
    upgrade: {
      group: "check",
      label: "upgrade: the VotingEscrow's implementation",
      ...answer(upgraded),
    },
    logic: {
      group: "check",
      label: "logic: the VotingEscrow's approval logic",
      ...answered(VOTING_ESCROW, "approvalLogic", [], another),
    },
    approvals: {
      group: "check",
      label: "approvals: what joining Matcha Latte approves",
      ...answered(VOTING_ESCROW, "getConduitApprovalConfig", [MATCHA_LATTE.address], inactive),
    },
    "double-espresso-approvals": {
      group: "check",
      label: "double-espresso-approvals: what joining Double Espresso approves",
      ...answered(VOTING_ESCROW, "getConduitApprovalConfig", [DOUBLE_ESPRESSO.address], inactive),
    },
    "others-vote": {
      group: "hydrex",
      label: "Hydrex's other automations vote again",
      on: voteAgain,
      async off() {
        for (const [slot, was] of voted) await anvil("anvil_setStorageAt", [VOTER, slot, was]);
        voted.clear();
      },
    },
  };
  const faults = new Set<string>();

  // Never fails: what goes wrong shows in the QA wallet, which can start a scenario again. Each starts as the first
  // did, with the wallet as it was then. Once the session closes, a start stops at its next step, and stops any anvil
  // it started.
  async function start(next: Scenario): Promise<void> {
    if (closing) return;
    failure = "";
    busy = `Starting ${next.name}…`;
    for (const prompt of prompts.splice(0)) prompt.answer(false);
    const windows = [...sites.values()];
    sites.clear();
    current = next;
    faults.clear();
    codes.clear();
    answers.clear();
    failing.clear();
    voted.clear();
    refusing.clear();
    quotesUnder = false;
    answering.clear();
    replayed = 0;
    created.length = 0;
    typed.length = 0;
    // What Node read of the last fork, which this one may not hold.
    forgetRewards();
    forgetReads();
    forgetClaims();
    asks = false;
    // The wallet signs as the new scenario's first owner from the start, even if it fails to start: never as the last
    // one's, on a fork where its owners mean nothing.
    Object.assign(wallet, {
      owner: next.owners[0]!.address,
      chainId: CHAIN_ID,
      switches: true,
      batch: false,
      failing: 0,
    });
    delete wallet.atomic;
    delete wallet.assets;
    console.log(`Starting ${next.name}: ${next.title}`);
    try {
      await Promise.all(windows.map((context) => context.close().catch(() => {})));
      await Promise.allSettled(requests);
      // What the closed windows asked of anvil is not answered.
      await stopAnvil(false);
      busy = `Forking Base at block ${next.block.toLocaleString("en-GB")}…`;
      const cache = await cacheAt(next.block);
      if (closing) return;
      await startAnvil(next.block, cache, () => !!closing);
      if (closing) return void (await stopAnvil(false));
      for (const { address } of next.owners) await anvil("anvil_setBalance", [address, toHex(FOR_GAS)]);
      busy = `Setting up ${next.name}. The first time, reading Base can take several minutes…`;
      await next.setup(next.owners.map(({ address }) => address));
      // A block every 2 seconds, as on Base: the page reads a few blocks back, and so sees each transaction.
      await anvil("evm_setIntervalMining", [2]);
      await open("wallet");
      busy = "";
      console.log(`Ready: ${next.name}.`);
    } catch (error) {
      busy = "";
      failure = `${next.name} did not start: ${(error as Error).message}`;
      console.error(failure);
    }
  }

  async function gas(address: Address): Promise<void> {
    if (BigInt(await anvil<Hex>("eth_getBalance", [address, "latest"])) >= FOR_GAS / 10n) return;
    await anvil("anvil_setBalance", [address, toHex(FOR_GAS)]);
    note(`Gave ${short(address)} 0.1 ETH for gas`);
  }

  async function setOwner(address: string): Promise<void> {
    if (!isAddress(address, { strict: false })) throw new Error(`${address} is not an address.`);
    const owner = getAddress(address);
    if (![...current.owners, ...typed].some((each) => each.address === owner))
      typed.push({ address: owner, holds: "an address you typed" });
    await gas(owner);
    wallet.owner = owner;
    await emit("accountsChanged", [owner]);
  }

  // As if spent elsewhere, as the swap test does to a token between the review and the wallet. By symbol, the token the
  // wallet holds of those the list names so: two are AERO.
  async function sendAway(token: string): Promise<void> {
    const named = isAddress(token, { strict: false })
      ? [getAddress(token)]
      : TOKENS.filter(({ symbol }) => symbol.toLowerCase() === token.toLowerCase()).map(({ address }) =>
          getAddress(address),
        );
    if (!named.length) throw new Error(`The QA wallet knows no token ${token}: give its address.`);
    const balances = await Promise.all(named.map((address) => balanceOf(address, wallet.owner)));
    const held = named.filter((_, i) => balances[i]! > 0n);
    if (held.length > 1)
      throw new Error(`${short(wallet.owner)} holds ${held.length} tokens named ${token}: give the address of one.`);
    const [address] = held;
    if (!address)
      throw new Error(`${short(wallet.owner)} holds none of ${NAMES.get(named[0]!.toLowerCase()) ?? token}.`);
    const amount = balances[named.indexOf(address)]!;
    const data = encodeFunctionData({ abi: tokenAbi, functionName: "transfer", args: [STRANGER, amount] });
    await mined(wallet.owner, address, data);
    note(
      `Sent all of ${short(wallet.owner)}'s ${NAMES.get(address.toLowerCase()) ?? short(address)} to ${short(STRANGER)}`,
    );
  }

  // As its owner can on Hydrex: to an automation by its name, back to the owner, or to any address.
  async function delegate(account: string, to: string): Promise<void> {
    const { id, owner } = await accountOf(account);
    const named = AUTOMATION_NAMES.find(({ name }) => name.toLowerCase() === to.toLowerCase());
    const delegatee = /^(its )?owner$/i.test(to)
      ? owner
      : isAddress(to, { strict: false })
        ? getAddress(to)
        : named?.address;
    if (!delegatee) throw new Error(`${to} is neither an address nor one of Hydrex's automations.`);
    await as(owner, VOTING_ESCROW, "delegate", [id, delegatee]);
    note(`#${id}'s votes delegated to ${named?.name ?? (same(delegatee, owner) ? "its owner" : short(delegatee))}`);
  }

  // An account by its number, and its owner.
  async function accountOf(account: string): Promise<{ id: bigint; owner: Address }> {
    const id = BigInt(account.replace(/^#/, ""));
    const owner = await view<Address>(VOTING_ESCROW, "ownerOf", [id]).catch(() => undefined);
    if (!owner) throw new Error(`Hydrex has no account #${id}.`);
    await gas(owner);
    return { id, owner };
  }
  const as = (from: Address, to: Address, functionName: string, args: unknown[]) =>
    mined(from, to, encodeFunctionData({ abi: QA_ABI, functionName, args } as never));

  // As its owner can: the new owner then votes with it, and no automation claims for it until it joins one again.
  async function give(account: string): Promise<void> {
    const { id, owner } = await accountOf(account);
    if (same(owner, wallet.owner)) throw new Error(`#${id} is already ${short(owner)}'s.`);
    await as(owner, VOTING_ESCROW, "transferFrom", [owner, wallet.owner, id]);
    note(`Gave #${id} from ${short(owner)} to ${short(wallet.owner)}`);
  }

  // As its owner can on Hydrex: the most valuable of what waits in the pools its automations voted for in each of the
  // last two epochs, as a payout claims, so that the page finds the record of the payout moved by a claim of another's.
  async function claimOnHydrex(account: string): Promise<void> {
    const { id, owner } = await accountOf(account);
    type Owed = { contract: Address; token: Address; fee: boolean; value: number };
    const pairKey = ({ contract, token }: Owed) => `${contract} ${token}`.toLowerCase();
    // What waits in each epoch's pools, by contract and token. The automations' pools are mostly the same, and so are
    // the two epochs': a claim takes what waits for every epoch at once.
    const epochs = [new Map<string, Owed>(), new Map<string, Owed>()];
    // Each automation's, and each epoch's, at once.
    await warm(() =>
      Promise.all(
        AUTOMATIONS.map(async ({ address }) => {
          const earnings = await readEarnings(address).catch(() => undefined);
          if (!earnings) return;
          const both = [earnings.rewards, await rewardsFor(address, earnings.start - WEEK)];
          await Promise.all(
            both.map(async (rewards, epoch) => {
              const pairs = weighed(rewards, earnings.prices);
              const [amounts = []] = await readEarned([id], pairs, "latest");
              const fees = new Set(rewards.filter(({ fee }) => fee).map(({ contract }) => contract.toLowerCase()));
              for (const [i, pair] of pairs.entries()) {
                const owed = { ...pair, fee: fees.has(pair.contract.toLowerCase()) };
                if ((amounts[i] ?? 0n) > 0n) epochs[epoch]!.set(pairKey(owed), owed);
              }
            }),
          );
        }),
      ),
    );
    const most = (pairs: Map<string, Owed>) =>
      [...pairs.values()].sort((a, b) => b.value - a.value).slice(0, OWN_CLAIM_PAIRS);
    const claimed = [...new Map(epochs.flatMap(most).map((owed) => [pairKey(owed), owed])).values()];
    if (!claimed.length) throw new Error(`Nothing waits for #${id} in the pools of the last two epochs.`);
    // A few rewards a transaction, as each reads the account's past epochs.
    for (const fee of [true, false]) {
      const kind = claimed.filter((each) => each.fee === fee);
      for (let i = 0; i < kind.length; i += OWN_CLAIM_PAIRS / 2) {
        const these = kind.slice(i, i + OWN_CLAIM_PAIRS / 2);
        const contracts = [...new Set(these.map(({ contract }) => contract))];
        const tokens = contracts.map((contract) =>
          these.filter((each) => each.contract === contract).map((each) => each.token),
        );
        await as(owner, VOTER, fee ? "claimFees" : "claimBribes", [contracts, tokens, id]);
      }
    }
    note(`#${id}'s owner claimed ${claimed.length} of its rewards on Hydrex`);
  }

  // Matcha Latte pays an owner's accounts where the owner says, or Hydrex: setMyPayoutRecipient.
  async function payTo(to: string): Promise<void> {
    const recipient = /^(its )?owner$|^$/i.test(to)
      ? wallet.owner
      : isAddress(to, { strict: false })
        ? getAddress(to)
        : undefined;
    if (!recipient) throw new Error(`${to} is not an address.`);
    await as(wallet.owner, MATCHA_LATTE.address, "setMyPayoutRecipient", [recipient]);
    note(
      `Matcha Latte pays ${short(wallet.owner)}'s accounts to ${same(recipient, wallet.owner) ? "it" : short(recipient)}`,
    );
  }

  // As anyone may once the epoch has flipped, and someone soon does on Base: Hydrex's Voter moves on to it, and what
  // the epoch before earned is final.
  async function moveOn(): Promise<void> {
    const before = Number(await view<bigint>(VOTER, "_epochTimestamp"));
    await gas(STRANGER);
    await as(STRANGER, await view<Address>(VOTER, "minter"), "update_period", []);
    const after = Number(await view<bigint>(VOTER, "_epochTimestamp"));
    if (after === before) throw new Error("Hydrex is already in this epoch: move to the next one first.");
    note(`Hydrex moved on to the epoch from ${new Date(after * 1000).toUTCString()}`);
  }

  // Matcha Latte's vote now, pool by pool: the Voter keeps it until it votes again.
  async function lastVote(): Promise<{ pools: Address[]; weights: bigint[] }> {
    const length = await view<bigint>(VOTER, "poolVoteLength", [MATCHA_LATTE.address]);
    const pools = await Promise.all(
      Array.from({ length: Number(length) }, (_, i) =>
        view<Address>(VOTER, "poolVote", [MATCHA_LATTE.address, BigInt(i)]),
      ),
    );
    const weights = await Promise.all(pools.map((pool) => view<bigint>(VOTER, "votes", [MATCHA_LATTE.address, pool])));
    return { pools, weights };
  }

  // As its operator does each week, which it does not on the fork: the vote it cast last, in the epoch now.
  async function operatorVotes(): Promise<void> {
    const { pools, weights } = await lastVote();
    if (!pools.length) throw new Error("Matcha Latte has no vote to cast again.");
    const operator = await view<Address>(MATCHA_LATTE_MODULE, "KEEPER");
    await gas(operator);
    await as(operator, MATCHA_LATTE_MODULE, "vote", [pools, weights.map((weight) => (weight > 0n ? weight : 1n))]);
    note(`Matcha Latte's operator voted for ${pools.length} pools`);
  }

  // As anyone may: 100 USDC of incentives, from Matcha Latte's fee recipient, for the votes of this epoch in the pool that
  // Matcha Latte votes for most, so that its votes earn something on the fork.
  async function incentive(): Promise<void> {
    const { pools, weights } = await lastVote();
    if (!pools.length) throw new Error("Matcha Latte votes for no pool.");
    const top = pools[weights.indexOf(weights.reduce((a, b) => (b > a ? b : a)))]!;
    const contract = await view<Address>(VOTER, "external_bribes", [await view<Address>(VOTER, "gauges", [top])]);
    const amount = 100_000_000n;
    if ((await balanceOf(USDC, HOLDER)) < amount)
      throw new Error("Matcha Latte's fee recipient holds too little USDC.");
    await gas(HOLDER);
    await mined(HOLDER, USDC, encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [contract, amount] }));
    await as(HOLDER, contract, "notifyRewardAmount", [USDC, amount]);
    note(`Added 100 USDC of incentives to the pool ${short(top)}, which Matcha Latte votes for most`);
  }

  // Transactions that Base included after the fork's block, sent again in their order, as their senders.
  let replayed = 0;
  async function replay(): Promise<void> {
    const next = current.replays?.[replayed];
    if (!next) throw new Error("Every transaction of this scenario was sent.");
    const tx = await anvil<{
      from: Address;
      to: Address | null;
      input: Hex;
      gas: Hex;
      value: Hex;
      accessList?: Sendable["accessList"];
    } | null>("eth_getTransactionByHash", [next.hash]);
    if (!tx) throw new Error(`Base's RPC does not know ${short(next.hash)}, the transaction that ${next.does}.`);
    await gas(tx.from);
    // Enough ETH for what it carried too, whatever its sender spent on the fork meanwhile.
    const balance = BigInt(await anvil<Hex>("eth_getBalance", [tx.from, "latest"]));
    if (balance < BigInt(tx.value) + FOR_GAS / 10n)
      await anvil("anvil_setBalance", [tx.from, toHex(BigInt(tx.value) + FOR_GAS)]);
    // As Base included it: what it sent, with the ETH and the access list it carried.
    const hash = await send({
      from: tx.from,
      ...(tx.to && { to: tx.to }),
      data: tx.input,
      gas: tx.gas,
      value: tx.value,
      ...(tx.accessList?.length && { accessList: tx.accessList }),
    });
    // Sent, it is the next one's turn, even if this one fails on a fork that the QA wallet changed.
    replayed++;
    await included(hash, `The operator's transaction that ${next.does}`);
    note(`The operator ${next.does}`);
  }

  // A token of the QA wallet's own, with a listed token's symbol, or any: it holds 1,000.
  const created: Address[] = [];
  async function mint(symbol: string): Promise<void> {
    if (!symbol) throw new Error("Give the token a symbol.");
    const listed = TOKENS.find((each) => each.symbol.toLowerCase() === symbol.toLowerCase());
    const decimals = (listed as { decimals?: number } | undefined)?.decimals ?? 18;
    const data = encodeDeployData({
      abi: QA_TOKEN_ABI,
      bytecode: QA_TOKEN,
      args: [`${symbol} of the QA wallet`, symbol, decimals, parseUnits("1000", decimals)],
    });
    const receipt = await included(
      await send({ from: wallet.owner, data, gas: "0x1e8480" }),
      `The deployment of ${symbol}`,
    );
    const address = getAddress(receipt.contractAddress!);
    created.push(address);
    NAMES.set(address.toLowerCase(), `${symbol} of the QA wallet`);
    note(`Gave ${short(wallet.owner)} 1,000 ${symbol}, a token of the QA wallet's own, at ${address}`);
  }

  async function travel(to: "epoch" | "half-day"): Promise<void> {
    const { time } = await latest();
    const at = to === "epoch" ? (Math.floor(time / WEEK) + 1) * WEEK + 60 : time + 12 * 3600;
    await anvil("evm_setNextBlockTimestamp", [at]);
    await anvil("evm_mine");
    // As the browser tests do, the page's clock follows, and its timers of the next half minute run.
    for (const context of sites.values()) {
      await context.clock.setSystemTime(at * 1000);
      await context.clock.runFor(30_000);
    }
    note(`Moved Base's clock to ${new Date(at * 1000).toUTCString()}`);
  }

  async function state() {
    const now = busy ? undefined : await latest().catch(() => undefined);
    return {
      busy,
      failure,
      scenario: current.name,
      scenarios: SCENARIOS.map(({ name, title }) => ({ name, title })),
      owners: [...current.owners, ...typed].map(({ address, holds }) => ({ address, holds, short: short(address) })),
      owner: wallet.owner,
      chainId: wallet.chainId,
      asks,
      switches: wallet.switches,
      // A wallet that lists its tokens sends several calls in one prompt too: see harness.ts.
      calls: (!sendsBatches(wallet) ? "one" : wallet.atomic === false ? "each" : "atomic") satisfies Calls,
      failing: wallet.failing ?? 0,
      lists: !!wallet.assets,
      replays: current.replays && {
        sent: replayed,
        total: current.replays.length,
        ...(current.replays[replayed] && { next: current.replays[replayed]!.does }),
      },
      prompts: prompts.map(({ id, text }) => ({ id, text })),
      ...now,
      faults: Object.entries(FAULTS).map(([id, { group, label }]) => ({ id, group, label, on: faults.has(id) })),
      log,
    };
  }

  // The commands run one at a time, each once the one before is done: none then acts on a fork that a scenario's start
  // replaced, nor reads Base through warm() while another does, as warm() changes the process's fetch.
  let queue: Promise<unknown> = Promise.resolve();
  function inTurn<T>(run: () => Promise<T>): Promise<T> {
    const result = queue.then(run);
    queue = result.catch(() => {});
    return result;
  }

  async function command(name: string, ...args: any[]): Promise<unknown> {
    // What the panel asks each second, and the answers to the wallet's prompts, which a command may be waiting for.
    if (name === "state") return state();
    if (name === "answer") {
      const [id, yes] = args as [number, boolean];
      const index = prompts.findIndex((prompt) => prompt.id === id);
      if (index >= 0) prompts.splice(index, 1)[0]!.answer(yes);
      return state();
    }
    if (busy) throw new Error("Wait until the scenario has started.");
    // How the wallet answers: flags, set at once rather than behind a command that may take minutes.
    if (name === "set" || name === "calls") {
      configure(name, args);
      return state();
    }
    if (name === "start") {
      const next = named(args[0]);
      if (!next) throw new Error(`No scenario is named ${args[0]}.`);
      // At once, so that no command is taken until it has started; the commands taken before it finish first.
      busy = `Starting ${next.name}…`;
      starting = inTurn(() => start(next));
      return state();
    }
    await inTurn(() => run(name, args));
    return state();
  }

  // A wallet that lists its tokens answers wallet_getCapabilities, and so, by EIP-5792, sends several calls in one
  // prompt: lists and one call per prompt do not go together, and picking one turns the other off, saying so.
  function configure(name: string, args: any[]): void {
    if (name === "calls") {
      const calls = args[0] as Calls;
      wallet.batch = calls !== "one";
      wallet.atomic = calls !== "each";
      if (calls === "one" && wallet.assets) {
        delete wallet.assets;
        note("One call per prompt: the wallet no longer lists its tokens, as a wallet that does sends calls together");
      }
      return;
    }
    const [key, on] = args as [string, boolean];
    if (key === "asks") asks = on;
    if (key === "switches") wallet.switches = on;
    if (key === "lists" && !on) delete wallet.assets;
    if (key === "lists" && on) {
      wallet.assets = created;
      if (!wallet.batch) {
        wallet.batch = true;
        wallet.atomic = true;
        note("Lists its tokens: the wallet now sends several calls in one prompt, all or nothing");
      }
    }
  }

  async function run(name: string, args: any[]): Promise<void> {
    switch (name) {
      case "owner":
        await setOwner(args[0]);
        break;
      case "chain":
        wallet.chainId = Number(args[0]);
        await emit("chainChanged", toHex(wallet.chainId));
        break;
      case "give":
        await give(String(args[0]).trim());
        break;
      case "claim-on-hydrex":
        await claimOnHydrex(String(args[0]).trim());
        break;
      case "pay-to":
        await payTo(String(args[0]).trim());
        break;
      case "move-on":
        await moveOn();
        break;
      case "replay":
        await replay();
        break;
      case "operator-votes":
        await operatorVotes();
        break;
      case "incentive":
        await incentive();
        break;
      case "mint":
        await mint(String(args[0]).trim());
        break;
      case "delegate":
        await delegate(String(args[0]).trim(), String(args[1]).trim());
        break;
      case "fail":
        wallet.failing = (wallet.failing ?? 0) + 1;
        break;
      case "send-away":
        await sendAway(String(args[0]).trim());
        break;
      case "lock":
        await emit("accountsChanged", []);
        note("Locked");
        break;
      case "open":
        await open(args[0]);
        break;
      case "travel":
        await travel(args[0]);
        break;
      case "fault": {
        const [id, on] = args as [string, boolean];
        const fault = FAULTS[id];
        if (!fault || faults.has(id) === on) break;
        await (on ? fault.on() : fault.off());
        if (on) faults.add(id);
        else faults.delete(id);
        note(`${fault.label}: ${on ? "on" : "off"}`);
        break;
      }
      default:
        throw new Error(`The QA wallet has no command ${name}.`);
    }
    // The page reads payouts a few blocks back, as Base's newest may not be on every RPC yet: the blocks after a change
    // come at once, so that the page shows it as soon as it reads again.
    if (SENDS.has(name)) await settle();
  }

  await panelContext.exposeFunction("qa", command);
  await place(panel, 0);
  await panel.goto("https://qa.test/");

  const close = () =>
    (closing ??= (async () => {
      for (const prompt of prompts.splice(0)) prompt.answer(false);
      await browser.close().catch(() => {});
      await stopAnvil(false);
      // A start under way stops at its next step: the process may exit once it has.
      await starting;
      for (const cache of caches.values())
        await cache.then((each) => each.close()).catch((error: unknown) => console.error(error));
      console.log(`${upstream.fetched} requests asked of FORK_URL, ${upstream.busy} of them over its limit.`);
    })());
  const closed = new Promise<void>((resolve) => {
    browser.on("disconnected", () => resolve());
    panel.on("close", () => resolve());
  }).then(close);

  const started = (starting = inTurn(() => start(first)));
  return { panel, command, sites: () => [...sites.values()], started, closed, close };
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const name = args.find((arg) => !arg.startsWith("-")) ?? SCENARIOS[0]!.name;
  const first = named(name);
  if (args.includes("--list") || !first) {
    if (!first) console.error(`No scenario is named ${name}.`);
    for (const { name, title } of SCENARIOS) console.log(`${name.padEnd(10)}${title}`);
    process.exit(first ? 0 : 1);
  }
  console.log("The page opens beside the QA wallet. Close the QA wallet, or press Ctrl-C, to stop.");
  let session: Session | undefined;
  for (const signal of ["SIGINT", "SIGTERM"] as const)
    process.on(signal, () => (session ? void session.close() : process.exit(130)));
  session = await launch(first);
  await session.closed;
  process.exit(0);
}
