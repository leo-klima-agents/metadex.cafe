// Opens the page in a browser of its own against a fork of Base, to try its flows by hand: `npm run qa`, or
// `npm run qa -- claim` to start from another scenario (scenarios.ts; QA.md says which flow each is for). The page runs
// as in the browser tests, at https://metadex.cafe, its RPCs answered by anvil, with the test wallet, which signs as any
// address. A second window, the QA wallet, picks that address and how the wallet answers, starts the scenarios, moves
// Base's clock on, and makes Base fail as visitors may find it.
//
// anvil forks through the same caches as the browser tests, in FORK_CACHE, from BASE_RPC_URL: after `npm run
// test:fork`, each scenario starts in seconds. CHROMIUM names the browser, as for the tests.
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
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
  type Address,
  type Hex,
} from "viem";
import tokens from "../src/base-tokens.json" with { type: "json" };
import { same } from "../src/chain.ts";
import {
  APPROVAL_LOGIC,
  AUTOMATIONS,
  AUTOMAXI,
  CARBON_IMPACT,
  CHAIN_ID,
  MULTICALL3,
  RPCS,
  SWAPPERS,
  USDC,
  VOTER,
  VOTING_ESCROW,
  VOTING_ESCROW_IMPLEMENTATION,
} from "../src/config.ts";
import conduits from "../src/hydrex-conduits.json" with { type: "json" };
import { readEarnings, rewardsFor } from "../src/earnings.ts";
import { WEEK, short } from "../src/format.ts";
import { readEarned, weighed } from "../src/receipts.ts";
import { erc20Abi, swapperAbi } from "../src/swap.ts";
import {
  AVNT,
  RPC_ORIGINS,
  SAFE_WALLET,
  SITE,
  HOLDER,
  STRANGER,
  ZORA,
  abi,
  anvil,
  balanceOf,
  mined,
  send,
  serve,
  settle,
  startAnvil,
  stopAnvil,
  testWallet,
  tokenAbi,
  walletScript,
  warm,
  type Rpc,
  type WalletOptions,
} from "./harness.ts";
import { serveCached, upstreamOf, type Cache } from "./rpc-cache.ts";
import { SCENARIOS, scenario as named, type Owner, type Scenario } from "./scenarios.ts";

// As fork/run.ts has them.
const FORK_URL = process.env.BASE_RPC_URL || RPCS[0]!;
const CACHE = process.env.FORK_CACHE || join(homedir(), ".cache", "metadex.cafe", "fork");
const PANEL = readFileSync(new URL("qa.html", import.meta.url), "utf8");
const ETH = 10n ** 17n; // 0.1 ETH, for gas
// The QA wallet's window, at the left of the screen. Chromium makes no window narrower than about 500 pixels.
const PANEL_WIDTH = 520;
const hex = (n: number | bigint) => `0x${n.toString(16)}`;
// Waits, then answers null, as a receipt not found yet.
const sleep = (ms: number) => new Promise<null>((resolve) => setTimeout(() => resolve(null), ms));

// The windows that show the page: with the test wallet, with two wallets, or without any, as Safe{Wallet} shows it.
type Kind = "wallet" | "wallets" | "none";
type Prompt = { id: number; text: string; answer: (yes: boolean) => void };
// A change to Base that the QA wallet can make and undo: a failure of Base, a check of the page's that fails, or a state
// of Hydrex's.
type Fault = { group: "base" | "check" | "hydrex"; label: string; on(): Promise<void>; off(): Promise<void> };
// How the wallet sends several calls: one per prompt, in one prompt all or nothing, or in one prompt one by one.
type Calls = "one" | "atomic" | "each";

const QA_ABI = parseAbi([
  "function aggregate3((address target, bool allowFailure, bytes callData)[] calls) payable returns ((bool success, bytes returnData)[])",
  "function veToken() view returns (address)",
  "function kvcm() view returns (address)",
  "function getConduitApprovalConfig(address conduit) view returns (uint8[] actions, bool active, string name)",
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
  "function poolVote(address voter, uint256 index) view returns (address)",
  "function votes(address voter, address pool) view returns (uint256)",
  "function gauges(address pool) view returns (address)",
  "function external_bribes(address gauge) view returns (address)",
  "function notifyRewardAmount(address token, uint256 amount)",
]);
// Carbon Impact's executor module, through which its keeper votes and pays: see the README of
// https://github.com/ldeso/hydrex-keeper.
const CARBON_IMPACT_MODULE: Address = "0x750973E0CB728C3112561Bc8E9b235afA9B17E81";
// A token of the QA wallet's own, deployed with a name and symbol: see fixtures/QaToken.sol.
const QA_TOKEN_ABI = parseAbi(["constructor(string name, string symbol, uint8 decimals, uint256 supply)"]);
const QA_TOKEN = readFileSync(new URL("fixtures/qa-token-init-code.hex", import.meta.url), "utf8").trim() as Hex;
const QUOTE = toFunctionSelector(getAbiItem({ abi: swapperAbi, name: "quote" }));
const SWAPPER_ADDRESSES = new Set(SWAPPERS.map(({ address }) => address.toLowerCase()));
const SYMBOL = toFunctionSelector("function symbol()").slice(2);
// What the owner's own claim on Hydrex takes at most, of each epoch's rewards: the most valuable.
const OWN_CLAIM_PAIRS = 10;
// The QA wallet's commands that send transactions of their own.
const SENDS = new Set([
  "delegate",
  "give",
  "claim-on-hydrex",
  "pay-to",
  "move-on",
  "replay",
  "keeper-votes",
  "incentive",
  "mint",
  "send-away",
]);
// Hydrex's automations, the page's own and the others, by name.
const AUTOMATION_NAMES = [...conduits, ...AUTOMATIONS].map(({ name, address }) => ({
  name,
  address: getAddress(address),
}));
const OTHERS = conduits.filter(({ address }) => !AUTOMATIONS.some((automation) => same(automation.address, address)));

// The tokens the QA wallet can send away by symbol: the page's list, and those the scenarios give.
const TOKENS: { symbol: string; address: string }[] = [
  ...tokens,
  { symbol: "AVNT", address: AVNT },
  { symbol: "ZORA", address: ZORA },
];
// Names for the contracts the wallet is asked to call.
const NAMES = new Map<string, string>([
  ...TOKENS.map(({ address, symbol }): [string, string] => [address.toLowerCase(), symbol]),
  ...SWAPPERS.map(({ address, symbol }): [string, string] => [address.toLowerCase(), `the ${symbol} swapper`]),
  [VOTING_ESCROW.toLowerCase(), "Hydrex's VotingEscrow"],
  [CARBON_IMPACT.address.toLowerCase(), "Carbon Impact"],
  [AUTOMAXI.address.toLowerCase(), "AutoMaxi"],
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
    case "eth_sendTransaction":
      return `Send ${callWords(params[0])}`;
    case "wallet_sendCalls": {
      const calls = params[0].calls as { to: string; data: Hex }[];
      return `Send ${calls.length} calls in one prompt: ${calls.map(callWords).join("; ")}`;
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
  const cacheAt = async (block: number): Promise<string> => {
    if (!caches.has(block)) caches.set(block, serveCached(upstream, join(CACHE, `base-${block}.json.gz`), block));
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
  const handle = testWallet(wallet, [], []);
  async function walletRequest(method: string, params: any[]) {
    const reply = await handle(method, params);
    if (LOGGED.has(method)) {
      const { result, error } = reply as { result?: unknown; error?: { message: string } };
      const outcome = error ? error.message : typeof result === "string" ? `sent ${result.slice(0, 10)}…` : "done";
      note(`${requestWords(method, params, wallet.owner)}: ${outcome}`);
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

  // Each window's clock starts at Base's time on the fork, then runs, as in the browser tests.
  const sites = new Map<Kind, BrowserContext>();
  async function site(kind: Kind): Promise<BrowserContext> {
    const open = sites.get(kind);
    if (open) return open;
    const context = await browser.newContext({ viewport: null, colorScheme: null });
    sites.set(kind, context);
    context.on("close", () => sites.get(kind) === context && sites.delete(kind));
    await context.route("**/*", routeSite);
    if (kind !== "none") {
      await context.exposeFunction("testWallet", walletRequest);
      await context.addInitScript(walletScript(kind === "wallets" ? ["Test Wallet", "Other Wallet"] : ["Test Wallet"]));
    }
    await context.clock.install({ time: (await latest()).time * 1000 });
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
  const present = async (address: Address, name: string): Promise<Hex> => {
    const found = await anvil<Hex>("eth_getCode", [address, "latest"]);
    if (found === "0x") throw new Error(`${name} is not on Base in this scenario.`);
    return found;
  };
  const code = (address: Address, name: string, change: (code: Hex) => Hex) => ({
    async on() {
      const was = await present(address, name);
      codes.set(address, was);
      await anvil("anvil_setCode", [address, change(was)]);
    },
    async off() {
      await anvil("anvil_setCode", [address, codes.get(address)!]);
    },
  });
  // A byte after the code changes its hash, not what it does.
  const longer = (code: Hex): Hex => `${code}00`;

  // Reads whose answer is changed, by the contract and calldata of each, inside the page's Multicall3 batches: so one
  // read answers otherwise, and Base stays as it is.
  const answers = new Map<string, (data: Hex) => Hex>();
  const callKey = (target: string, data: string) => `${target} ${data}`.toLowerCase();
  function rewrite(body: string, reply: string): string | undefined {
    if (!answers.size && !quotesUnder) return undefined;
    const { method, params = [] } = JSON.parse(body) as { method: string; params?: { to?: string; data?: Hex }[] };
    const [{ to = "", data = "0x" } = {}] = params;
    if (method !== "eth_call" || !same(to, MULTICALL3)) return undefined;
    const [calls] = decodeFunctionData({ abi: QA_ABI, data }).args as readonly unknown[] as [
      { target: Address; callData: Hex }[],
    ];
    const changes = calls.map(
      ({ target, callData }) =>
        answers.get(callKey(target, callData)) ??
        (quotesUnder && SWAPPER_ADDRESSES.has(target.toLowerCase()) && callData.startsWith(QUOTE) ? under : undefined),
    );
    const answer = JSON.parse(reply) as { result?: Hex };
    if (!changes.some(Boolean) || !answer.result) return undefined;
    const results = decodeFunctionResult({ abi: QA_ABI, functionName: "aggregate3", data: answer.result });
    const result = results.map((each, i) =>
      each.success && changes[i] ? { ...each, returnData: changes[i](each.returnData) } : each,
    );
    return JSON.stringify({
      ...answer,
      result: encodeFunctionResult({ abi: QA_ABI, functionName: "aggregate3", result }),
    });
  }
  const answered = (
    target: Address,
    name: string,
    functionName: string,
    args: unknown[],
    change: (data: Hex) => Hex,
  ) => {
    const key = callKey(target, encodeFunctionData({ abi: QA_ABI, functionName, args } as never));
    return {
      async on() {
        await present(target, name);
        answers.set(key, change);
      },
      off: async () => void answers.delete(key),
    };
  };
  const another = (): Hex => encodeAbiParameters([{ type: "address" }], [STRANGER]);
  // Each swapper's quotes, a tenth under what its pools give: far under the page's own prices, which it says.
  let quotesUnder = false;
  const under = (data: Hex): Hex => {
    const results = decodeFunctionResult({ abi: swapperAbi, functionName: "quote", data });
    const lower = results.map((each) => ({ ...each, amountOut: (each.amountOut * 9n) / 10n }));
    return encodeFunctionResult({ abi: swapperAbi, functionName: "quote", result: lower });
  };
  // The reads of Base that fail, each by what its request holds.
  const refusing = new Set<(body: string) => boolean>();
  rpc.refuse = (body) => [...refusing].some((refuses) => refuses(body));
  const refused = (refuses: (body: string) => boolean) => ({
    on: async () => void refusing.add(refuses),
    off: async () => void refusing.delete(refuses),
  });
  const inactive = (data: Hex): Hex => {
    const [actions, , name] = decodeFunctionResult({ abi: QA_ABI, functionName: "getConduitApprovalConfig", data });
    return encodeFunctionResult({
      abi: QA_ABI,
      functionName: "getConduitApprovalConfig",
      result: [actions, false, name],
    });
  };

  // When each of Hydrex's other automations last voted, kept in the Voter's storage, by the slot that holds it.
  const voted = new Map<Hex, Hex>();
  async function voteAgain(): Promise<void> {
    const { time } = await latest();
    for (const { address, name } of OTHERS) {
      const data = encodeFunctionData({ abi: QA_ABI, functionName: "lastVoted", args: [getAddress(address)] });
      const was = await anvil<Hex>("eth_call", [{ to: VOTER, data }, "latest"]);
      const { accessList } = await anvil<{ accessList: { address: string; storageKeys: Hex[] }[] }>(
        "eth_createAccessList",
        [{ to: VOTER, data }, "latest"],
      );
      let slot: Hex | undefined;
      for (const key of accessList.filter((each) => same(each.address, VOTER)).flatMap((each) => each.storageKeys))
        if (BigInt(await anvil<Hex>("eth_getStorageAt", [VOTER, key, "latest"])) === BigInt(was)) slot = key;
      if (!slot || BigInt(was) === 0n) throw new Error(`The Voter's record of when ${name} voted was not found.`);
      voted.set(slot, was);
      await anvil("anvil_setStorageAt", [VOTER, slot, numberToHex(time, { size: 32 })]);
    }
  }

  const FAULTS: Record<string, Fault> = {
    "rpc-down": { group: "base", label: "Base's RPCs fail", ...refused(() => true) },
    symbols: {
      group: "base",
      label: "Tokens' symbols cannot be read",
      ...refused((body) => body.includes(SYMBOL)),
    },
    "automaxi-figures": {
      group: "base",
      label: "AutoMaxi's figures cannot be read",
      // Its votes, read from the Voter for AutoMaxi's address: Carbon Impact's still read.
      ...refused(
        (body) => body.includes(VOTER.slice(2).toLowerCase()) && body.includes(AUTOMAXI.address.slice(2).toLowerCase()),
      ),
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
      on: async () =>
        void (rpc.answer = (body) =>
          body.includes('"eth_chainId"') ? JSON.stringify({ jsonrpc: "2.0", id: 1, result: "0x1" }) : undefined),
      off: async () => void (rpc.answer = undefined),
    },
    "voter-gone": { group: "base", label: "Hydrex's Voter cannot be read", ...code(VOTER, "The Voter", () => "0x") },
    // As the README's table names them, by the ids of their messages on the page.
    code: {
      group: "check",
      label: "code: Carbon Impact's code",
      ...code(CARBON_IMPACT.address, "Carbon Impact", longer),
    },
    contracts: {
      group: "check",
      label: "contracts: Carbon Impact's VotingEscrow",
      ...answered(CARBON_IMPACT.address, "Carbon Impact", "veToken", [], another),
    },
    token: {
      group: "check",
      label: "token: Carbon Impact's payout token",
      ...answered(CARBON_IMPACT.address, "Carbon Impact", "kvcm", [], another),
    },
    approvals: {
      group: "check",
      label: "approvals: what joining Carbon Impact approves",
      ...answered(VOTING_ESCROW, "The VotingEscrow", "getConduitApprovalConfig", [CARBON_IMPACT.address], inactive),
    },
    "automaxi-code": {
      group: "check",
      label: "automaxi-code: AutoMaxi's code",
      ...code(AUTOMAXI.address, "AutoMaxi", longer),
    },
    "automaxi-contracts": {
      group: "check",
      label: "automaxi-contracts: AutoMaxi's VotingEscrow",
      ...answered(AUTOMAXI.address, "AutoMaxi", "veToken", [], another),
    },
    "automaxi-approvals": {
      group: "check",
      label: "automaxi-approvals: what joining AutoMaxi approves",
      ...answered(VOTING_ESCROW, "AutoMaxi", "getConduitApprovalConfig", [AUTOMAXI.address], inactive),
    },
    upgrade: {
      group: "check",
      label: "upgrade: the VotingEscrow's code",
      ...code(VOTING_ESCROW_IMPLEMENTATION, "The VotingEscrow", longer),
    },
    logic: {
      group: "check",
      label: "logic: the VotingEscrow's approval logic",
      ...code(APPROVAL_LOGIC, "The approval logic", longer),
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

  async function start(next: Scenario): Promise<void> {
    failure = "";
    busy = `Starting ${next.name}…`;
    for (const prompt of prompts.splice(0)) prompt.answer(false);
    const closing = [...sites.values()];
    sites.clear();
    await Promise.all(closing.map((context) => context.close()));
    await stopAnvil();
    current = next;
    faults.clear();
    codes.clear();
    answers.clear();
    voted.clear();
    refusing.clear();
    quotesUnder = false;
    rpc.answer = undefined;
    replayed = 0;
    created.length = 0;
    delete wallet.assets;
    wallet.failing = 0;
    console.log(`Starting ${next.name}: ${next.title}`);
    try {
      busy = `Forking Base at block ${next.block.toLocaleString("en-GB")}…`;
      await startAnvil(next.block, await cacheAt(next.block));
      for (const { address } of next.owners) await anvil("anvil_setBalance", [address, hex(ETH)]);
      busy = `Setting up ${next.name}. The first time, reading Base can take several minutes…`;
      await next.setup();
      // A block every 2 seconds, as on Base: the page reads a few blocks back, and so sees each transaction.
      await anvil("evm_setIntervalMining", [2]);
      wallet.owner = next.owners[0]!.address;
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
    if (BigInt(await anvil<Hex>("eth_getBalance", [address, "latest"])) >= ETH / 10n) return;
    await anvil("anvil_setBalance", [address, hex(ETH)]);
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

  // As if spent elsewhere, as the swap test does to a token between the review and the wallet.
  async function sendAway(token: string): Promise<void> {
    const found = isAddress(token, { strict: false })
      ? getAddress(token)
      : TOKENS.find(({ symbol }) => symbol.toLowerCase() === token.toLowerCase())?.address;
    if (!found) throw new Error(`The QA wallet knows no token ${token}: give its address.`);
    const address = getAddress(found);
    const amount = await balanceOf(address, wallet.owner);
    if (!amount) throw new Error(`${short(wallet.owner)} holds none of ${NAMES.get(address.toLowerCase()) ?? token}.`);
    const data = encodeFunctionData({ abi: tokenAbi, functionName: "transfer", args: [STRANGER, amount] });
    await mined(wallet.owner, address, data);
    note(
      `Sent all of ${short(wallet.owner)}'s ${NAMES.get(address.toLowerCase()) ?? short(address)} to ${short(STRANGER)}`,
    );
  }

  // As its owner can on Hydrex: to an automation by its name, back to the owner, or to any address.
  async function delegate(account: string, to: string): Promise<void> {
    const id = BigInt(account.replace(/^#/, ""));
    const data = encodeFunctionData({ abi: QA_ABI, functionName: "ownerOf", args: [id] });
    const reply = await anvil<Hex>("eth_call", [{ to: VOTING_ESCROW, data }, "latest"]).catch(() => undefined);
    if (!reply) throw new Error(`Hydrex has no account #${id}.`);
    const owner = decodeFunctionResult({ abi: QA_ABI, functionName: "ownerOf", data: reply });
    const named = AUTOMATION_NAMES.find(({ name }) => name.toLowerCase() === to.toLowerCase());
    const delegatee = /^(its )?owner$/i.test(to)
      ? owner
      : isAddress(to, { strict: false })
        ? getAddress(to)
        : named?.address;
    if (!delegatee) throw new Error(`${to} is neither an address nor one of Hydrex's automations.`);
    await gas(owner);
    await mined(
      owner,
      VOTING_ESCROW,
      encodeFunctionData({ abi: QA_ABI, functionName: "delegate", args: [id, delegatee] }),
    );
    note(`#${id}'s votes delegated to ${named?.name ?? (same(delegatee, owner) ? "its owner" : short(delegatee))}`);
  }

  // An account by its number, and its owner.
  async function accountOf(account: string): Promise<{ id: bigint; owner: Address }> {
    const id = BigInt(account.replace(/^#/, ""));
    const data = encodeFunctionData({ abi: QA_ABI, functionName: "ownerOf", args: [id] });
    const reply = await anvil<Hex>("eth_call", [{ to: VOTING_ESCROW, data }, "latest"]).catch(() => undefined);
    if (!reply) throw new Error(`Hydrex has no account #${id}.`);
    const owner = decodeFunctionResult({ abi: QA_ABI, functionName: "ownerOf", data: reply });
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
    const claimed: { contract: Address; token: Address; fee: boolean }[] = [];
    await warm(async () => {
      for (const { address } of AUTOMATIONS) {
        const earnings = await readEarnings(address).catch(() => undefined);
        if (!earnings) continue;
        for (const rewards of [earnings.rewards, await rewardsFor(address, earnings.start - WEEK)]) {
          const pairs = weighed(rewards, earnings.prices);
          const [amounts = []] = await readEarned([id], pairs, "latest");
          const fees = new Set(rewards.filter(({ fee }) => fee).map(({ contract }) => contract.toLowerCase()));
          claimed.push(
            ...pairs
              .map((pair, i) => ({ ...pair, fee: fees.has(pair.contract.toLowerCase()), owed: amounts[i] ?? 0n }))
              .filter(({ owed }) => owed > 0n)
              .sort((a, b) => b.usd - a.usd)
              .slice(0, OWN_CLAIM_PAIRS),
          );
        }
      }
    });
    if (!claimed.length) throw new Error(`Nothing waits for #${id} in the pools of the last two epochs.`);
    // A few rewards a transaction, as each reads the account's past epochs.
    for (const fee of [true, false])
      for (let i = 0; i < claimed.length; i += OWN_CLAIM_PAIRS / 2) {
        const these = claimed.slice(i, i + OWN_CLAIM_PAIRS / 2).filter((each) => each.fee === fee);
        const contracts = [...new Set(these.map(({ contract }) => contract))];
        if (!contracts.length) continue;
        const tokens = contracts.map((contract) =>
          these.filter((each) => each.contract === contract).map((each) => each.token),
        );
        await as(owner, VOTER, fee ? "claimFees" : "claimBribes", [contracts, tokens, id]);
      }
    note(`#${id}'s owner claimed ${claimed.length} of its rewards on Hydrex`);
  }

  // Carbon Impact pays an owner's accounts where the owner says, or the admin key: setMyPayoutRecipient.
  async function payTo(to: string): Promise<void> {
    const recipient = /^(its )?owner$|^$/i.test(to)
      ? wallet.owner
      : isAddress(to, { strict: false })
        ? getAddress(to)
        : undefined;
    if (!recipient) throw new Error(`${to} is not an address.`);
    await as(wallet.owner, CARBON_IMPACT.address, "setMyPayoutRecipient", [recipient]);
    note(
      `Carbon Impact pays ${short(wallet.owner)}'s accounts to ${same(recipient, wallet.owner) ? "it" : short(recipient)}`,
    );
  }

  // As anyone may once the epoch has flipped, and someone soon does on Base: Hydrex's Voter moves on to it, and what the
  // epoch before earned is final.
  async function moveOn(): Promise<void> {
    const read = async (to: Address, functionName: string) =>
      decodeFunctionResult({
        abi: QA_ABI,
        functionName,
        data: await anvil<Hex>("eth_call", [
          { to, data: encodeFunctionData({ abi: QA_ABI, functionName } as never) },
          "latest",
        ]),
      } as never) as unknown;
    const before = Number(await read(VOTER, "_epochTimestamp"));
    await gas(STRANGER);
    await as(STRANGER, (await read(VOTER, "minter")) as Address, "update_period", []);
    const after = Number(await read(VOTER, "_epochTimestamp"));
    if (after === before) throw new Error("Hydrex is already in this epoch: move to the next one first.");
    note(`Hydrex moved on to the epoch from ${new Date(after * 1000).toUTCString()}`);
  }

  const view = async <T>(to: Address, functionName: string, args: unknown[] = []): Promise<T> => {
    const data = encodeFunctionData({ abi: QA_ABI, functionName, args } as never);
    const reply = await anvil<Hex>("eth_call", [{ to, data }, "latest"]);
    return decodeFunctionResult({ abi: QA_ABI, functionName, data: reply } as never) as T;
  };
  // Carbon Impact's vote now, pool by pool: the Voter keeps it until it votes again.
  async function lastVote(): Promise<{ pools: Address[]; weights: bigint[] }> {
    const pools: Address[] = [];
    for (;;) {
      const pool = await view<Address>(VOTER, "poolVote", [CARBON_IMPACT.address, BigInt(pools.length)]).catch(
        () => undefined,
      );
      if (!pool) break;
      pools.push(pool);
    }
    const weights = await Promise.all(pools.map((pool) => view<bigint>(VOTER, "votes", [CARBON_IMPACT.address, pool])));
    return { pools, weights };
  }

  // As its keeper does each week, which it does not on the fork: the vote it cast last, in the epoch now.
  async function keeperVotes(): Promise<void> {
    const { pools, weights } = await lastVote();
    if (!pools.length) throw new Error("Carbon Impact has no vote to cast again.");
    const keeper = await view<Address>(CARBON_IMPACT_MODULE, "KEEPER");
    await gas(keeper);
    await as(keeper, CARBON_IMPACT_MODULE, "vote", [pools, weights.map((weight) => (weight > 0n ? weight : 1n))]);
    note(`Carbon Impact's keeper voted for ${pools.length} pools`);
  }

  // As anyone may: 100 USDC of incentives, from Carbon Impact's treasury, for the votes of this epoch in the pool that
  // Carbon Impact votes for most, so that its votes earn something on the fork.
  async function incentive(): Promise<void> {
    const { pools, weights } = await lastVote();
    if (!pools.length) throw new Error("Carbon Impact votes for no pool.");
    const top = pools[weights.indexOf(weights.reduce((a, b) => (b > a ? b : a)))]!;
    const contract = await view<Address>(VOTER, "external_bribes", [await view<Address>(VOTER, "gauges", [top])]);
    const amount = 100_000_000n;
    if ((await balanceOf(USDC, HOLDER)) < amount) throw new Error("Carbon Impact's treasury holds too little USDC.");
    await gas(HOLDER);
    await mined(HOLDER, USDC, encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [contract, amount] }));
    await as(HOLDER, contract, "notifyRewardAmount", [USDC, amount]);
    note(`Added 100 USDC of incentives to the pool ${short(top)}, which Carbon Impact votes for most`);
  }

  // Transactions that Base included after the fork's block, sent again in their order, as their senders.
  let replayed = 0;
  async function replay(): Promise<void> {
    const next = current.replays?.[replayed];
    if (!next) throw new Error("Every transaction of this scenario was sent.");
    const tx = await anvil<{ from: Address; to: Address; input: Hex; gas: Hex }>("eth_getTransactionByHash", [
      next.hash,
    ]);
    await gas(tx.from);
    const hash = await send({ from: tx.from, to: tx.to, data: tx.input, gas: tx.gas });
    let receipt: { status: Hex } | null = null;
    for (const deadline = Date.now() + 120_000; !receipt && Date.now() < deadline;)
      receipt = (await anvil<{ status: Hex } | null>("eth_getTransactionReceipt", [hash])) ?? (await sleep(250));
    if (receipt?.status !== "0x1") throw new Error(`The keeper's transaction that ${next.does} failed on the fork.`);
    replayed++;
    note(`The keeper ${next.does}`);
  }

  // A token of the QA wallet's own, with a listed token's symbol, or any: it holds 1,000.
  const created: Address[] = [];
  async function mint(symbol: string): Promise<void> {
    if (!symbol) throw new Error("Give the token a symbol.");
    const listed = TOKENS.find((each) => each.symbol === symbol);
    const decimals = (listed as { decimals?: number } | undefined)?.decimals ?? 18;
    const data = encodeDeployData({
      abi: QA_TOKEN_ABI,
      bytecode: QA_TOKEN,
      args: [`${symbol} of the QA wallet`, symbol, decimals, parseUnits("1000", decimals)],
    });
    const hash = await send({ from: wallet.owner, data, gas: "0x1e8480" });
    let receipt: { contractAddress: Address | null } | null = null;
    while (!receipt) receipt = (await anvil("eth_getTransactionReceipt", [hash])) ?? (await sleep(250));
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
      calls: (!wallet.batch ? "one" : wallet.atomic === false ? "each" : "atomic") satisfies Calls,
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

  async function command(name: string, ...args: any[]): Promise<unknown> {
    if (name !== "state" && name !== "answer" && busy) throw new Error("Wait until the scenario has started.");
    switch (name) {
      case "state":
        break;
      case "start": {
        const next = named(args[0]);
        if (!next) throw new Error(`No scenario is named ${args[0]}.`);
        void start(next);
        break;
      }
      case "owner":
        await setOwner(args[0]);
        break;
      case "chain":
        wallet.chainId = Number(args[0]);
        await emit("chainChanged", hex(wallet.chainId));
        break;
      case "set": {
        const [key, on] = args as [string, boolean];
        if (key === "asks") asks = on;
        if (key === "switches") wallet.switches = on;
        if (key === "lists" && on) wallet.assets = created;
        if (key === "lists" && !on) delete wallet.assets;
        break;
      }
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
      case "keeper-votes":
        await keeperVotes();
        break;
      case "incentive":
        await incentive();
        break;
      case "mint":
        await mint(String(args[0]).trim());
        break;
      case "calls": {
        const calls = args[0] as Calls;
        wallet.batch = calls !== "one";
        wallet.atomic = calls !== "each";
        break;
      }
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
      case "answer": {
        const [id, yes] = args as [number, boolean];
        const index = prompts.findIndex((prompt) => prompt.id === id);
        if (index >= 0) prompts.splice(index, 1)[0]!.answer(yes);
        break;
      }
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
    return state();
  }

  await panelContext.exposeFunction("qa", command);
  await place(panel, 0);
  await panel.goto("https://qa.test/");

  let closing: Promise<void> | undefined;
  const close = () =>
    (closing ??= (async () => {
      for (const prompt of prompts.splice(0)) prompt.answer(false);
      await browser.close().catch(() => {});
      await stopAnvil();
      for (const cache of caches.values()) await (await cache).close();
      console.log(`${upstream.fetched} requests asked of FORK_URL, ${upstream.busy} of them over its limit.`);
    })());
  const closed = new Promise<void>((resolve) => {
    browser.on("disconnected", () => resolve());
    panel.on("close", () => resolve());
  }).then(close);

  const started = start(first);
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
