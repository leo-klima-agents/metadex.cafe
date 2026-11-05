// `npm run qa [-- scenario]` or `node qa/qa.ts --list`. Opens the page against a fork of Base, as the browser tests do,
// beside the QA wallet (qa.html), which signs as any address, can ask before it acts, and moves the fork on. anvil
// forks from BASE_RPC_URL, or else the page's first RPC, through the browser tests' caches (fork/rpc-cache.ts);
// CHROMIUM names the browser.
import { readFileSync } from "node:fs";
import { chromium, type BrowserContext, type Page, type Route } from "playwright-core";
import { decodeFunctionData, erc20Abi, getAddress, isAddress, toHex, type Address, type Hex } from "viem";
import { AUTOMATIONS, CHAIN_ID, RPCS, SWAPPERS, VOTING_ESCROW } from "../src/config.ts";
import { WEEK, short } from "../src/format.ts";
import { same } from "../src/rpc.ts";
import { swapperAbi } from "../src/swap.ts";
import { listed } from "../src/tokens.ts";
import { SAFE_ORIGIN } from "../src/wallet.ts";
import {
  FOR_GAS,
  PAGE_SCRIPT,
  SITE,
  abi,
  anvil,
  included,
  send,
  serve,
  settle,
  startAnvil,
  stopAnvil,
  testWallet,
  walletScript,
  type WalletOptions,
} from "../fork/harness.ts";
import { cacheFileOf, forkUrl, serveCached, upstreamOf, type Cache } from "../fork/rpc-cache.ts";
import { SCENARIOS, type Owner, type Scenario } from "./scenarios.ts";

const PANEL = readFileSync(new URL("qa.html", import.meta.url), "utf8");
// Width of the QA wallet's window, at the left of the screen: Chromium makes no window narrower than about 500 pixels.
const PANEL_WIDTH = 520;
const WINDOW = { viewport: null, colorScheme: null } as const;

type Kind = "wallet" | "safe" | "none";
type Prompt = { id: number; text: string; answer: (yes: boolean) => void };

const NAMES: [string, string][] = [
  [VOTING_ESCROW, "Hydrex's VotingEscrow"],
  ...AUTOMATIONS.map(({ address, name }): [string, string] => [address, name]),
  ...SWAPPERS.map(({ address, symbol }): [string, string] => [address, `the contract for ${symbol} swaps`]),
];
const nameOf = (to: string): string =>
  NAMES.find(([address]) => same(address, to))?.[1] ?? listed(to)?.symbol ?? short(to);
function callWords({ to, data }: { to: string; data: Hex }): string {
  let name = data.slice(0, 10);
  try {
    name = decodeFunctionData({ abi: [...abi, ...erc20Abi, ...swapperAbi], data }).functionName;
  } catch {}
  return `${name} on ${nameOf(to)}`;
}
const LOGGED = new Set([
  "eth_requestAccounts",
  "wallet_switchEthereumChain",
  "eth_sendTransaction",
  "wallet_sendCalls",
]);
function requestWords(method: string, params: any[], owner: Address): string {
  const as = short(params[0]?.from ?? owner);
  switch (method) {
    case "eth_requestAccounts":
      return `Connect as ${as}`;
    case "wallet_switchEthereumChain":
      return `Switch to ${Number(params[0].chainId) === CHAIN_ID ? "Base" : `chain ${Number(params[0].chainId)}`}`;
    case "eth_sendTransaction":
      return `Send ${callWords(params[0])} as ${as}`;
    case "wallet_sendCalls":
      return `Send ${params[0].calls.length} calls in one prompt as ${as}: ${params[0].calls.map(callWords).join("; ")}`;
    default:
      return method;
  }
}

type Session = {
  panel: Page;
  command(name: string, ...args: any[]): Promise<unknown>;
  pages(): Page[];
  // Resolves once the first scenario has started, or failed to.
  started: Promise<void>;
  // Resolves once the browser or the QA wallet's window has closed and the caches have saved the fork's answers.
  closed: Promise<void>;
  close(): Promise<void>;
};

async function launch(first: Scenario, { headless = false } = {}): Promise<Session> {
  const upstream = upstreamOf(forkUrl(RPCS[0]!));
  const caches = new Map<number, Promise<Cache>>();
  async function cacheAt(block: number): Promise<string> {
    if (!caches.has(block)) caches.set(block, serveCached(upstream, cacheFileOf(block), block));
    try {
      return (await caches.get(block)!).url;
    } catch (error) {
      caches.delete(block);
      throw error;
    }
  }
  // Playwright would close the browser on Ctrl-C; the session closes it instead, so that the caches save the fork's
  // answers (see `close`).
  const browser = await chromium.launch({
    headless,
    handleSIGINT: false,
    handleSIGTERM: false,
    ...(process.env.CHROMIUM && { executablePath: process.env.CHROMIUM }),
  });

  let current = first;
  let busy = "";
  let failure = "";
  let asks = false;
  let replayed = 0;
  let prompted = 0;
  let closing: Promise<void> | undefined;
  let starting: Promise<void> = Promise.resolve();
  const typed: Owner[] = [];
  const prompts: Prompt[] = [];
  const log: string[] = [];
  const note = (line: string) => {
    log.unshift(`${new Date().toISOString().slice(11, 19)} ${line}`);
    log.length = Math.min(log.length, 40);
    console.log(`QA wallet: ${line}`);
  };

  const panelContext = await browser.newContext(WINDOW);
  await panelContext.route("**/*", (route) => route.fulfill({ contentType: "text/html", body: PANEL }));
  const panel = await panelContext.newPage();

  const wallet: WalletOptions = {
    owner: first.owners[0]!.address,
    chainId: CHAIN_ID,
    decline: false,
    switches: true,
    batch: false,
    ask: (method, params) =>
      !asks
        ? Promise.resolve(true)
        : new Promise((answer) => {
            prompts.push({ id: ++prompted, text: requestWords(method, params, wallet.owner), answer });
            void panel.bringToFront().catch(() => {});
          }),
  };
  const handle = testWallet(wallet);
  // Wallet requests not answered yet. A scenario's start waits for them, so that none reaches the next fork.
  const requests = new Set<Promise<unknown>>();
  async function respond(method: string, params: any[]) {
    const words = LOGGED.has(method) && requestWords(method, params, wallet.owner);
    try {
      const reply = await handle(method, params);
      if (words) note(`${words}: ${(reply.error as Error | undefined)?.message ?? "done"}`);
      return reply;
    } catch (error) {
      if (words) note(`${words}: ${(error as Error).message}`);
      throw error;
    }
  }
  function walletRequest(method: string, params: any[]) {
    const reply = respond(method, params);
    requests.add(reply);
    void reply.catch(() => {}).finally(() => requests.delete(reply));
    return reply;
  }

  const served = {
    origins: new Set<string>(),
    rpc: {},
    get safe() {
      return wallet.owner;
    },
  };
  function routeSite(route: Route): Promise<void> {
    const request = route.request();
    if (request.isNavigationRequest() && ![SITE, SAFE_ORIGIN].includes(new URL(request.url()).origin))
      return route.continue();
    return serve(route, served).catch(() => route.abort().catch(() => {}));
  }

  const latest = async () => {
    const block = await anvil.getBlock();
    return { block: Number(block.number), time: Number(block.timestamp) };
  };
  async function gas(address: Address): Promise<void> {
    if ((await anvil.getBalance({ address })) < FOR_GAS / 10n) await anvil.setBalance({ address, value: FOR_GAS });
  }

  const sites = new Map<"wallet" | "none", BrowserContext>();
  async function site(kind: "wallet" | "none"): Promise<BrowserContext> {
    const open = sites.get(kind);
    if (open) return open;
    const context = await browser.newContext(WINDOW);
    await context.route("**/*", routeSite);
    await context.clock.install({ time: (await latest()).time * 1000 });
    await context.addInitScript(PAGE_SCRIPT);
    if (kind === "wallet") {
      await context.exposeFunction("testWallet", walletRequest);
      await context.addInitScript(walletScript(["Test Wallet"]));
    }
    sites.set(kind, context);
    return context;
  }
  async function place(page: Page, left: number): Promise<void> {
    if (headless) return;
    try {
      const { width, height } = await panel.evaluate(() => ({ width: screen.availWidth, height: screen.availHeight }));
      const cdp = await page.context().newCDPSession(page);
      const { windowId } = await cdp.send("Browser.getWindowForTarget");
      const bounds = { left, top: 0, width: left ? Math.max(width - left, 800) : PANEL_WIDTH, height };
      await cdp.send("Browser.setWindowBounds", { windowId, bounds });
      await cdp.detach();
    } catch {}
  }
  async function open(kind: Kind): Promise<void> {
    const page = await (await site(kind === "wallet" ? "wallet" : "none")).newPage();
    await place(page, PANEL_WIDTH);
    await page.goto(kind === "safe" ? `${SAFE_ORIGIN}/` : `${SITE}/${current.hash}`);
  }
  async function emit(event: string, value: unknown): Promise<void> {
    for (const context of sites.values())
      for (const page of context.pages())
        for (const frame of page.frames())
          await frame
            .evaluate(([event, value]) => (window as any).testWalletEmit?.(event, value), [event, value] as const)
            .catch(() => {});
  }

  // Forks Base afresh, undoing every change, and resets the wallet. Never throws: the panel shows what failed.
  async function start(next: Scenario): Promise<void> {
    busy = `Starting ${next.name}…`;
    failure = "";
    for (const prompt of prompts.splice(0)) prompt.answer(false);
    const windows = [...sites.values()];
    sites.clear();
    current = next;
    replayed = 0;
    typed.length = 0;
    asks = false;
    Object.assign(wallet, { owner: next.owners[0]!.address, chainId: CHAIN_ID, batch: false, atomic: true });
    console.log(`Starting ${next.name}: ${next.title}`);
    try {
      await Promise.all(windows.map((context) => context.close().catch(() => {})));
      await Promise.allSettled(requests);
      await stopAnvil(false);
      busy = `Forking Base at block ${next.block.toLocaleString("en-GB")}. The first time, it takes minutes…`;
      const cache = await cacheAt(next.block);
      if (closing) return;
      await startAnvil(next.block, cache, () => !!closing);
      if (closing) return void (await stopAnvil(false));
      for (const { address } of next.owners) await anvil.setBalance({ address, value: FOR_GAS });
      busy = `Setting up ${next.name}…`;
      await next.setup?.();
      // A block every 2 seconds, as on Base.
      await anvil.setIntervalMining({ interval: 2 });
      await open("wallet");
      console.log(`Ready: ${next.name}.`);
    } catch (error) {
      failure = `${next.name} did not start: ${(error as Error).message}`;
      console.error(failure);
    } finally {
      busy = "";
    }
  }

  async function signAs(address: string): Promise<void> {
    if (!isAddress(address, { strict: false })) throw new Error(`${address} is not an address.`);
    const owner = getAddress(address);
    if (![...current.owners, ...typed].some((each) => each.address === owner))
      typed.push({ address: owner, holds: "typed in" });
    await gas(owner);
    wallet.owner = owner;
    await emit("accountsChanged", [owner]);
  }

  async function travel(): Promise<void> {
    const at = (Math.floor((await latest()).time / WEEK) + 1) * WEEK + 60;
    await anvil.setNextBlockTimestamp({ timestamp: BigInt(at) });
    await anvil.mine({ blocks: 1 });
    for (const context of sites.values()) {
      await context.clock.setSystemTime(at * 1000);
      await context.clock.runFor(30_000);
    }
    note(`Moved Base's clock to ${new Date(at * 1000).toUTCString()}`);
  }

  // Sends the scenario's next transaction from Base again, as its sender. A failure on the fork still moves on to the
  // next.
  async function replay(): Promise<void> {
    const next = current.replays?.[replayed];
    if (!next) throw new Error("No transaction is left to send.");
    const tx = await anvil.getTransaction({ hash: next.hash }).catch(() => undefined);
    if (!tx) throw new Error(`Base's RPC does not know ${short(next.hash)}.`);
    await gas(tx.from);
    replayed++;
    await included(await send({ from: tx.from, to: tx.to, data: tx.input, gas: tx.gas }), `What ${next.does}`);
    await settle();
    note(`The operator ${next.does}`);
  }

  async function state() {
    return {
      busy,
      failure,
      scenario: current.name,
      scenarios: SCENARIOS.map(({ name, title }) => ({ name, title })),
      owners: [...current.owners, ...typed].map(({ address, holds }) => ({ address, holds, short: short(address) })),
      owner: wallet.owner,
      chainId: wallet.chainId,
      asks,
      calls: !wallet.batch ? "one" : wallet.atomic === false ? "each" : "atomic",
      replays: current.replays && {
        sent: replayed,
        total: current.replays.length,
        next: current.replays[replayed]?.does,
      },
      prompts: prompts.map(({ id, text }) => ({ id, text })),
      ...(busy ? {} : await latest().catch(() => ({}))),
      log,
    };
  }

  // Commands run one at a time, so that none acts on a fork that a start replaces.
  let queue: Promise<unknown> = Promise.resolve();
  function inTurn<T>(run: () => Promise<T>): Promise<T> {
    const result = queue.then(run);
    queue = result.catch(() => {});
    return result;
  }
  async function command(name: string, ...args: any[]): Promise<unknown> {
    if (name === "answer") {
      const index = prompts.findIndex(({ id }) => id === args[0]);
      if (index >= 0) prompts.splice(index, 1)[0]!.answer(!!args[1]);
    } else if (name !== "state") {
      if (busy) throw new Error("Wait until the scenario has started.");
      if (name === "asks") asks = !!args[0];
      else if (name === "calls") Object.assign(wallet, { batch: args[0] !== "one", atomic: args[0] !== "each" });
      else if (name === "start") {
        const next = SCENARIOS.find((each) => each.name === args[0]);
        if (!next) throw new Error(`No scenario is named ${args[0]}.`);
        busy = `Starting ${next.name}…`;
        starting = inTurn(() => start(next));
      } else await inTurn(() => run(name, args));
    }
    return state();
  }
  async function run(name: string, args: any[]): Promise<void> {
    switch (name) {
      case "owner":
        return signAs(String(args[0]).trim());
      case "chain":
        wallet.chainId = Number(args[0]);
        return emit("chainChanged", toHex(wallet.chainId));
      case "open":
        return open(args[0]);
      case "travel":
        return travel();
      case "replay":
        return replay();
      default:
        throw new Error(`The QA wallet has no command ${name}.`);
    }
  }

  await panelContext.exposeFunction("qa", command);
  await place(panel, 0);
  await panel.goto("https://qa.test/");

  const close = () =>
    (closing ??= (async () => {
      for (const prompt of prompts.splice(0)) prompt.answer(false);
      await browser.close().catch(() => {});
      await stopAnvil(false);
      await starting;
      for (const cache of caches.values()) await cache.then((each) => each.close()).catch(console.error);
    })());
  const closed = new Promise<void>((resolve) => {
    browser.on("disconnected", () => resolve());
    panel.on("close", () => resolve());
  }).then(close);
  const started = (starting = inTurn(() => start(first)));
  return { panel, command, pages: () => [...sites.values()].flatMap((each) => each.pages()), started, closed, close };
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const name = args.find((arg) => !arg.startsWith("-")) ?? SCENARIOS[0]!.name;
  const first = SCENARIOS.find((each) => each.name === name);
  if (args.includes("--list") || !first) {
    if (!first) console.error(`No scenario is named ${name}.`);
    for (const { name, title } of SCENARIOS) console.log(`${name.padEnd(16)}${title}`);
    process.exit(first ? 0 : 1);
  }
  console.log("The page opens beside the QA wallet. Close the QA wallet, or press Ctrl-C, to stop.");
  const session = await launch(first);
  for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => void session.close());
  await session.closed;
  process.exit(0);
}
