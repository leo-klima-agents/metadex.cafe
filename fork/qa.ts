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
import { decodeFunctionData, encodeFunctionData, getAddress, isAddress, type Address, type Hex } from "viem";
import tokens from "../src/base-tokens.json" with { type: "json" };
import {
  AUTOMAXI,
  CARBON_IMPACT,
  CHAIN_ID,
  RPCS,
  SWAPPERS,
  VOTER,
  VOTING_ESCROW,
  VOTING_ESCROW_IMPLEMENTATION,
} from "../src/config.ts";
import { WEEK, short } from "../src/format.ts";
import { erc20Abi, swapperAbi } from "../src/swap.ts";
import {
  AVNT,
  RPC_ORIGINS,
  SAFE_WALLET,
  SITE,
  STRANGER,
  ZORA,
  abi,
  anvil,
  balanceOf,
  mined,
  serve,
  startAnvil,
  stopAnvil,
  testWallet,
  tokenAbi,
  walletScript,
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

// The windows that show the page: with the test wallet, with two wallets, or without any, as Safe{Wallet} shows it.
type Kind = "wallet" | "wallets" | "none";
type Prompt = { id: number; text: string; answer: (yes: boolean) => void };
type Fault = { label: string; on(): Promise<void>; off(): Promise<void> };

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
  const rpc: Rpc = {};
  const shared = {
    origins: new Set<string>(),
    rpc,
    get safe() {
      return wallet.owner;
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
  const code = (address: Address, change: (code: Hex) => Hex) => ({
    async on() {
      const was = await anvil<Hex>("eth_getCode", [address, "latest"]);
      if (was === "0x") throw new Error("There is no code there in this scenario.");
      codes.set(address, was);
      await anvil("anvil_setCode", [address, change(was)]);
    },
    async off() {
      await anvil("anvil_setCode", [address, codes.get(address)!]);
    },
  });
  // A byte after the code changes its hash, not what it does.
  const longer = (code: Hex): Hex => `${code}00`;
  const FAULTS: Record<string, Fault> = {
    "rpc-down": {
      label: "Base's RPCs fail",
      on: async () => void (rpc.refuse = () => true),
      off: async () => void (rpc.refuse = undefined),
    },
    "other-chain": {
      label: "Base's RPCs serve another chain",
      on: async () =>
        void (rpc.answer = (body) =>
          body.includes('"eth_chainId"') ? JSON.stringify({ jsonrpc: "2.0", id: 1, result: "0x1" }) : undefined),
      off: async () => void (rpc.answer = undefined),
    },
    "carbon-impact-code": { label: "Carbon Impact's code changed", ...code(CARBON_IMPACT.address, longer) },
    "automaxi-code": { label: "AutoMaxi's code changed", ...code(AUTOMAXI.address, longer) },
    "escrow-code": { label: "The VotingEscrow's code changed", ...code(VOTING_ESCROW_IMPLEMENTATION, longer) },
    "voter-gone": { label: "Hydrex's Voter cannot be read", ...code(VOTER, () => "0x") },
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
    rpc.refuse = rpc.answer = undefined;
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
      busy = "";
      await open("wallet");
      console.log(`Ready: ${next.name}.`);
    } catch (error) {
      busy = "";
      failure = `${next.name} did not start: ${(error as Error).message}`;
      console.error(failure);
    }
  }

  async function setOwner(address: string): Promise<void> {
    if (!isAddress(address, { strict: false })) throw new Error(`${address} is not an address.`);
    const owner = getAddress(address);
    if (![...current.owners, ...typed].some((each) => each.address === owner))
      typed.push({ address: owner, holds: "an address you typed" });
    if (BigInt(await anvil<Hex>("eth_getBalance", [owner, "latest"])) < ETH / 10n) {
      await anvil("anvil_setBalance", [owner, hex(ETH)]);
      note(`Gave ${short(owner)} 0.1 ETH for gas`);
    }
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
      batch: !!wallet.batch,
      failing: wallet.failing ?? 0,
      prompts: prompts.map(({ id, text }) => ({ id, text })),
      ...now,
      faults: Object.entries(FAULTS).map(([id, { label }]) => ({ id, label, on: faults.has(id) })),
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
        if (key === "batch") wallet.batch = on;
        break;
      }
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
