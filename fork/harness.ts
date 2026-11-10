// Shared by the browser tests and the QA wallet (qa/qa.ts). Each test file starts its own anvil, and each test starts
// from the snapshot its file took.
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { createServer } from "node:net";
import { after, afterEach, before, beforeEach } from "node:test";
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
  BaseError,
  concat,
  ContractFunctionRevertedError,
  createPublicClient,
  encodeFunctionData,
  getAddress,
  getContract,
  getContractAddress,
  hexToBytes,
  http,
  keccak256,
  pad,
  parseAbi,
  testActions,
  toHex,
  WaitForTransactionReceiptTimeoutError,
  walletActions,
  type Address,
  type Hex,
} from "viem";
import { DOUBLE_ESPRESSO, MATCHA_LATTE, MATCHA_LATTE_ADMIN, RPCS, VOTER, VOTING_ESCROW } from "../src/config.ts";
import { WEEK, weekStart } from "../src/format.ts";
import { lastEpoch, votesEarned, type Reward } from "../src/rewards.ts";
import { settledBelow } from "../src/rpc.ts";
import { SAFE_ORIGIN } from "../src/wallet.ts";
import { runsCalls } from "./rpc-cache.ts";

export const CONDUIT = MATCHA_LATTE.address;
export const BLOCK = 55_388_000; // Mon 9 Nov 2026, 23:46 UTC, after Base Denim made five blocks a second
export const FLIP = 1_794_441_600; // Thu 12 Nov 2026, 00:00 UTC, when the epoch after BLOCK's starts
// Matcha Latte paid every account up to Thu 5 Nov, before Denim, so no block since holds a payout late, with rewards
// left to claim. The tests of one keep to blocks before Denim that do, until a block after it does: Fri 16 Oct 2026,
// 19:02 UTC, with #82774 unpaid since Thu 17 Sept, and Wed 21 Oct 2026, after the swappers' deployment, still unpaid.
export const UNPAID = 52_694_000;
export const UNPAID_SWAPS = 52_904_000;
export const SITE = "https://metadex.cafe";
const DIST = fileURLToPath(new URL("../dist/", import.meta.url));
export const RPC_ORIGINS = RPCS.map((url) => new URL(url).origin);
const CORS = { "access-control-allow-origin": "*", "access-control-allow-headers": "content-type" };

// What each owner holds at `BLOCK`, and at the payout tests' blocks unless said.
export const MEMBER = getAddress("0x388b2d29e7919d45b1b8f6e88b8a13a392f97b40"); // #9540 in Matcha Latte, #14485 its own
export const NEWCOMER = getAddress("0x0208ddbc05a91e1b937e8b3140b62ef22a274c95"); // #141 its own, #42877 in Liquid Hydrex
export const ELSEWHERE = getAddress("0x69707a120ade8239f07595165e180c61395ea655"); // #2435 in Lock Maxi, #2439 in USDC
export const LEAVER = getAddress("0x2573264b8e690ca6b2128c113890f42198840b16"); // #53350 and #82206 in Matcha Latte
export const ENDED = getAddress("0x2518820268e4079e90446b93020dfad7dd54e84d"); // #123351 (ended, holds HYDX), #123364
export const PAYEE = getAddress("0x60924601e73ebc5c2bd9244c788d93e0710a6c93"); // #82774 in Matcha Latte
// #82774's last payout at `UNPAID`, on Wed 23 Sept, up to Thu 17 Sept.
export const PAID_TX = "0x0932e5a24f24e45bfd1021764d94abc1d920754c4dc17128dd89f44bd086e899";
export const LOCK_MAXI = getAddress("0x53388a4E98Bb56F8571433F5461010Fc287929d3");
export const STRANGER = getAddress("0x000000000000000000000000000000000000dead");
const SOMEONE = getAddress("0x0000000000000000000000000000000000001234");
// Matcha Latte's fee recipient. It holds many of the tokens its fee took, so the tests take tokens to sell from it.
export const HOLDER = getAddress("0xd9e966a6bfa2ae2113a34bb4dd02ded921da50af");
export const AVNT = getAddress("0x696f9436b67233384889472cd7cd58a6fb5df4f1");
export const ZORA = getAddress("0x1111111111166b7fe7bd91427724b487980afc69");
export const SELLER = getAddress("0x0000000000000000000000000000000000c0ffee");

// Double Espresso, as deployed through the CREATE2 deployer from hydrex-conduit v2, commit 718c107.
const CREATE2_DEPLOYER = getAddress("0x4e59b44847b379578588920cA78FbF26c0B4956C");
const SALT = keccak256(toHex("metadex.cafe/ImmutableVeTokenConduit/v2"));
const INIT_CODE = readFileSync(
  new URL("fixtures/double-espresso-init-code.hex", import.meta.url),
  "utf8",
).trim() as Hex;
// Tokens Base runs natively. anvil cannot run their code, so `startAnvil` removes it.
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
// A generous gas limit, like a wallet's margin: anvil estimates gas at a different time from when it mines the
// transaction.
const GAS = 16_000_000n;
export const FOR_GAS = 10n ** 17n;
export const abi = parseAbi([
  "function getLockDelegatee(uint256 tokenId) view returns (address)",
  "function getClaimRedirectApproved(uint256 tokenId) view returns (address)",
  "function setConduitApproval(address conduit, uint256 tokenId, bool approve)",
  "function claim(uint256 tokenId, address[] feeAddresses, address[] bribeAddresses, address[] tokens) returns (uint256[])",
  "function balanceOf(address owner) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function transfer(address to, uint256 amount) returns (bool)",
  "function lastClaimBlock(uint256 tokenId) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function minter() view returns (address)",
  "function update_period() returns (uint256)",
  "function gauges(address pool) view returns (address)",
  "function external_bribes(address gauge) view returns (address)",
  "function notifyRewardAmount(address token, uint256 amount)",
  "function vote(address[] pools, uint256[] weights)",
  "function setTreasuryFeeBps(uint256 bps)",
]);

let ANVIL = "";
let CACHE_URL = "";
const nodeFetch = globalThis.fetch;
// While anvil runs a request, the cache fetches everything it reads from the upstream at once: see rpc-cache.ts.
const prefetch = (body: string): void =>
  void (runsCalls(body) && nodeFetch(`${CACHE_URL}/prefetch`, { method: "POST", body }).catch(() => {}));
async function post(body: string): Promise<string> {
  prefetch(body);
  return (await nodeFetch(ANVIL, { method: "POST", headers: { "content-type": "application/json" }, body })).text();
}
// Each request waits up to ten minutes, as anvil does for Base: a first run reads Base one slot at a time.
const clientOf = (url: string) =>
  createPublicClient({
    transport: http(url, {
      fetchFn: nodeFetch,
      onFetchRequest: (_, init) => prefetch(String(init.body)),
      retryCount: 0,
      timeout: 600_000,
    }),
  })
    .extend(testActions({ mode: "anvil" }))
    .extend(walletActions);
export let anvil: ReturnType<typeof clientOf>;
export const at = (address: Address) => getContract({ address, abi, client: anvil });
async function onFork<T>(reads: () => Promise<T>): Promise<T> {
  globalThis.fetch = (_, init) => {
    prefetch(String(init?.body));
    return nodeFetch(ANVIL, { ...init, signal: null });
  };
  try {
    return await reads();
  } finally {
    globalThis.fetch = nodeFetch;
  }
}

// Sends from any account, as anvil impersonates them all. The cache is told the hash, so that it never asks the
// upstream for that transaction or its receipt.
type Sendable = { from: Address; to?: Address | null; data: Hex; gas?: bigint };
export async function send({ from, ...tx }: Sendable): Promise<Hex> {
  const hash = await anvil.sendTransaction({ account: from, chain: null, maxPriorityFeePerGas: 0n, ...tx });
  await nodeFetch(`${CACHE_URL}/sent`, { method: "POST", body: hash });
  return hash;
}
export async function included(hash: Hex, what: string = hash): Promise<void> {
  const { status } = await anvil
    .waitForTransactionReceipt({ hash, pollingInterval: 100, timeout: 120_000 })
    .catch((error: unknown) => {
      if (!(error instanceof WaitForTransactionReceiptTimeoutError)) throw error;
      throw new Error(`${what} was not mined in two minutes.`, { cause: error });
    });
  if (status !== "success") throw new Error(`${what} failed on the fork.`);
}
export const mined = async (from: Address, to: Address, data: Hex): Promise<void> =>
  included(await send({ from, to, data, gas: GAS }));
export const balanceOf = (token: Address, owner: Address) => at(token).read.balanceOf([owner]);
export const approveConduit = (owner: Address, conduit: Address, id: bigint, approve = true) =>
  mined(
    owner,
    VOTING_ESCROW,
    encodeFunctionData({ abi, functionName: "setConduitApproval", args: [conduit, id, approve] }),
  );
export async function expectApprovals(ids: bigint[], delegate: Address, claimer: Address): Promise<void> {
  for (const id of ids)
    assert.deepEqual(
      {
        delegate: await at(VOTING_ESCROW).read.getLockDelegatee([id]),
        claimer: await at(VOTING_ESCROW).read.getClaimRedirectApproved([id]),
      },
      { delegate, claimer },
      `#${id}`,
    );
}
// The page reads a few blocks behind the latest (`settledBelow`), so mine as many and one more to let it see the last
// transactions.
export async function settle(): Promise<void> {
  const newest = Number(await anvil.getBlockNumber());
  await anvil.mine({ blocks: newest - settledBelow(newest) + 1 });
}

// Moves Hydrex on to the current epoch, as anyone may once the epoch has flipped. What the previous epoch earned is
// then final.
export async function moveOn(): Promise<void> {
  await anvil.setBalance({ address: STRANGER, value: FOR_GAS });
  const minter = await at(VOTER).read.minter();
  await mined(STRANGER, minter, encodeFunctionData({ abi, functionName: "update_period" }));
}
export async function nextEpoch(after = 60): Promise<void> {
  const { timestamp } = await anvil.getBlock();
  await anvil.setNextBlockTimestamp({ timestamp: BigInt(weekStart(Number(timestamp)) + WEEK + after) });
  await anvil.mine({ blocks: 1 });
  await moveOn();
  await settle();
}
// Adds `amount` of `token` from HOLDER as incentives for this epoch's votes for `pool`, as anyone may.
export async function incentive(pool: Address, token: Address, amount: bigint): Promise<void> {
  const bribe = await at(VOTER).read.external_bribes([await at(VOTER).read.gauges([pool])]);
  await mined(HOLDER, token, encodeFunctionData({ abi, functionName: "approve", args: [bribe, amount] }));
  await mined(HOLDER, bribe, encodeFunctionData({ abi, functionName: "notifyRewardAmount", args: [token, amount] }));
}

const feedAbi = parseAbi([
  "function pricedTokens(uint256) view returns (address token, address feed, uint256 maxAge, uint256 mul, uint256 div)",
  "function latestRoundData() view returns (uint80, int256, uint256, uint256, uint80)",
]);
// Double Espresso values a vote only with feeds updated within their maxAge, but on a fork moved on days, nothing
// updates them. This keeps each of its feeds at its last answer, as if updated in every block: their code becomes one
// that answers any call with (1, answer, now, now, 1).
export async function freshenFeeds(): Promise<void> {
  for (let i = 0n; ; i++) {
    const priced = await anvil
      .readContract({ address: DOUBLE_ESPRESSO.address, abi: feedAbi, functionName: "pricedTokens", args: [i] })
      .catch((error: unknown) => {
        if (error instanceof BaseError && error.walk((cause) => cause instanceof ContractFunctionRevertedError)) return;
        throw error;
      });
    if (!priced) return;
    const [, feed] = priced;
    const [, answer] = await anvil.readContract({ address: feed, abi: feedAbi, functionName: "latestRoundData" });
    const bytecode = concat(["0x60015f527f", pad(toHex(answer)), "0x6020524260405242606052600160805260a05ff3"]);
    await anvil.setCode({ address: feed, bytecode });
  }
}

// Deploys Double Espresso at the address the page expects, for forks of blocks before its deployment on Base.
export async function deployDoubleEspresso(): Promise<void> {
  if (await anvil.getCode({ address: DOUBLE_ESPRESSO.address })) return;
  const { timestamp } = await anvil.getBlock();
  await anvil.setNextBlockTimestamp({ timestamp: timestamp + 60n });
  await anvil.setBalance({ address: SOMEONE, value: FOR_GAS });
  await mined(SOMEONE, CREATE2_DEPLOYER, concat([SALT, INIT_CODE]));
  assert.equal(
    getContractAddress({ opcode: "CREATE2", from: CREATE2_DEPLOYER, salt: SALT, bytecode: INIT_CODE }),
    DOUBLE_ESPRESSO.address,
  );
}
// Sets Matcha Latte's payout fee as its Hydrex admin can, up to its MAX_TREASURY_FEE_BPS, 1%.
export async function setMatchaLatteFee(bps: bigint): Promise<void> {
  await anvil.setBalance({ address: MATCHA_LATTE_ADMIN, value: FOR_GAS });
  await mined(
    MATCHA_LATTE_ADMIN,
    MATCHA_LATTE.address,
    encodeFunctionData({ abi, functionName: "setTreasuryFeeBps", args: [bps] }),
  );
  await settle();
}
export async function doubleEspressoReceipts(): Promise<Reward[]> {
  await deployDoubleEspresso();
  const { rewards } = await onFork(async () => votesEarned(CONDUIT, await lastEpoch(), true));
  for (const who of [PAYEE, STRANGER, SOMEONE]) await anvil.setBalance({ address: who, value: FOR_GAS });
  await approveConduit(PAYEE, DOUBLE_ESPRESSO.address, 82774n);
  const usdc = rewards.filter(({ token }) => token.symbol === "USDC");
  for (const [who, { contract, token, fee }] of [
    [SOMEONE, usdc[0]!],
    [STRANGER, usdc[1]!],
  ] as const) {
    await mined(who, DOUBLE_ESPRESSO.address, claimOne(82774n, { contract, token, fee }));
  }
  await settle();
  return rewards;
}
export const claimOne = (id: bigint, { contract, token, fee }: Pick<Reward, "contract" | "token" | "fee">): Hex =>
  encodeFunctionData({
    abi,
    functionName: "claim",
    args: [id, fee ? [contract] : [], fee ? [] : [contract], [token.address]],
  });
export async function fund(tokens: Address[]): Promise<void> {
  for (const token of tokens)
    await mined(
      HOLDER,
      token,
      encodeFunctionData({ abi, functionName: "transfer", args: [SELLER, await balanceOf(token, HOLDER)] }),
    );
}

// The test wallet announces itself by EIP-6963 and hands each request to Node, which the page's CSP cannot block.
export type WalletOptions = {
  owner: Address;
  chainId: number;
  decline: boolean;
  switches: boolean;
  // Holds back its answer to a transaction until this settles, as a wallet does while its window is open.
  sending?: Promise<void>;
  // Sends several calls in one prompt (EIP-5792): all or nothing, unless `atomic` is false.
  batch?: boolean;
  atomic?: boolean;
  ask?: (method: string, params: any[]) => Promise<boolean>;
  // How many of the next transactions to send with too little gas, so that they fail.
  failing?: number;
  // The tokens it lists with ERC-7811's wallet_getAssets.
  assets?: Address[];
};
const sendsBatches = (options: Pick<WalletOptions, "batch" | "assets">): boolean => !!options.batch || !!options.assets;
type Rpc = {
  refuse?: ((body: string) => boolean) | undefined;
  answer?: ((body: string) => string | undefined) | undefined;
  rewrite?: ((body: string, reply: string) => string | undefined) | undefined;
};
type Sent = { to: Address; data: Hex };
export const walletScript = (names: string[]) => `(() => {
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
  const icon = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 1 1'/%3E";
  const infos = ${JSON.stringify(names)}.map((name, i) => ({ uuid: "6f1e9b4e-0c4b-4d55-9a1d-3a0b5f0e7a1" + (i + 1), name, rdns: "test.wallet" + i, icon }));
  const announce = () => { for (const info of infos) window.dispatchEvent(new CustomEvent("eip6963:announceProvider", { detail: Object.freeze({ info, provider }) })); };
  window.addEventListener("eip6963:requestProvider", announce);
  announce();
})();`;
// Makes `AbortSignal.timeout` never fire, as a first run reads Base one slot at a time, and logs each Content Security
// Policy violation.
export const PAGE_SCRIPT = `AbortSignal.timeout = () => new AbortController().signal;
document.addEventListener("securitypolicyviolation", (event) => console.error("Content Security Policy: " + event.violatedDirective + " " + event.blockedURI));`;
const safePage = (safe: Address) => `<!doctype html><meta charset="utf-8"><title>Safe{Wallet}</title>
<iframe src="${SITE}/" style="inline-size: 100%; block-size: 95vh; border: 0"></iframe>
<script>
  window.received = [];
  addEventListener("message", ({ origin, source, data }) => {
    if (origin !== "${SITE}" || !data?.method) return;
    window.received.push({ method: data.method, params: data.params });
    const answers = { getSafeInfo: { safeAddress: "${safe}", chainId: 8453, threshold: 2, owners: [], isReadOnly: false }, sendTransactions: { safeTxHash: "0x${"ab".repeat(32)}" } };
    source.postMessage(data.method in answers ? { id: data.id, success: true, version: "9.1.0", data: answers[data.method] } : { id: data.id, success: false, version: "9.1.0", error: data.method + " is not answered here" }, origin);
  });
</script>`;

// The calldata's floor cost under EIP-7623: enough gas for Base to accept the transaction, too little to run it.
async function starved(from: Address, to: Address, data: Hex): Promise<bigint> {
  const bytes = hexToBytes(data);
  const nonzero = bytes.filter(Boolean).length;
  const floor = 21_000n + 40n * BigInt(nonzero) + 10n * BigInt(bytes.length - nonzero);
  const needed = await anvil.estimateGas({ account: from, to, data }).catch(() => undefined);
  if (needed !== undefined && needed <= floor)
    throw new Error(`A call to ${to} runs on ${needed} gas: it cannot fail.`);
  return floor;
}
async function together(from: Address, calls: Sent[]): Promise<boolean> {
  const [block] = await anvil.simulateBlocks({
    blocks: [{ calls: calls.map((call) => ({ account: from, ...call })) }],
  });
  return !!block && block.calls.every(({ status }) => status === "success");
}

export function testWallet(options: WalletOptions, sent?: Sent[], asked?: string[]) {
  let asking = false;
  const batches = new Map<string, Hex[]>();
  let nextBatch = 1;
  const rejected = { error: { code: 4001, message: "User rejected the request." } };
  const allows = async (method: string, params: any[]) =>
    !options.decline && ((await options.ask?.(method, params)) ?? true);
  const gasFor = async (from: Address, to: Address, data: Hex) =>
    options.failing ? (options.failing--, starved(from, to, data)) : GAS;
  return async (method: string, params: any[]): Promise<{ result?: unknown; error?: unknown }> => {
    asked?.push(method);
    const signer = ((params[0] as { from?: Address } | undefined)?.from ?? options.owner) as Address;
    switch (method) {
      case "eth_requestAccounts": {
        if (asking) return { error: { code: -32002, message: "Request already pending." } };
        asking = true;
        const allowed = (await options.ask?.(method, params)) ?? true;
        asking = false;
        return allowed ? { result: [options.owner] } : rejected;
      }
      case "eth_chainId":
        return { result: toHex(options.chainId) };
      case "wallet_switchEthereumChain":
        if (!options.switches) return { error: { code: -32603, message: "Unrecognized chain ID." } };
        if (!((await options.ask?.(method, params)) ?? true)) return rejected;
        options.chainId = Number(params[0].chainId);
        return { result: null };
      case "eth_sendTransaction": {
        const { to, data, chainId } = params[0];
        sent?.push({ to, data });
        await options.sending;
        if (!(await allows(method, params))) return rejected;
        if (chainId !== toHex(options.chainId)) return { error: { code: -32602, message: "Wrong chain." } };
        return { result: await send({ to, data, from: signer, gas: await gasFor(signer, to, data) }) };
      }
      case "wallet_getCapabilities":
        if (!sendsBatches(options)) return { error: { code: 4200, message: "The test wallet does not batch." } };
        return {
          result: {
            [toHex(8453)]: {
              atomic: { status: options.atomic === false ? "unsupported" : "supported" },
              ...(options.assets && { assetDiscovery: { supported: true } }),
            },
          },
        };
      case "wallet_getAssets": {
        if (!options.assets) return { error: { code: 4200, message: "The test wallet does not list its tokens." } };
        const { account } = params[0] as { account: Address };
        const held = await Promise.all(options.assets.map(async (token) => (await balanceOf(token, account)) > 0n));
        return {
          result: {
            [toHex(8453)]: options.assets.filter((_, i) => held[i]).map((address) => ({ address, type: "erc20" })),
          },
        };
      }
      case "wallet_sendCalls": {
        if (!sendsBatches(options)) return { error: { code: 4200, message: "The test wallet does not batch." } };
        const { calls } = params[0] as { calls: Sent[] };
        if (!(await allows(method, params))) return rejected;
        const id = `0x${(nextBatch++).toString(16).padStart(64, "0")}`;
        const hashes: Hex[] = [];
        batches.set(id, hashes);
        if (options.atomic !== false && (options.failing || !(await together(signer, calls)))) {
          // All or nothing: a failing batch is mined as one failed transaction, which changes nothing but the gas it
          // spends.
          const { to, data } = calls[0]!;
          sent?.push(...calls);
          if (options.failing) options.failing--;
          hashes.push(await send({ to, data, from: signer, gas: await starved(signer, to, data) }));
        } else
          for (const { to, data } of calls) {
            sent?.push({ to, data });
            hashes.push(await send({ to, data, from: signer, gas: await gasFor(signer, to, data) }));
          }
        return { result: { id } };
      }
      case "wallet_getCallsStatus": {
        const receipts = await Promise.all(
          (batches.get(params[0] as string) ?? []).map((hash) =>
            anvil.request({ method: "eth_getTransactionReceipt", params: [hash] }),
          ),
        );
        if (receipts.some((receipt) => !receipt)) return { result: { status: 100 } };
        const failed = receipts.filter((receipt) => receipt!.status !== "0x1").length;
        return {
          result: {
            status: !failed ? 200 : failed === receipts.length ? 500 : 600,
            atomic: options.atomic !== false,
            receipts,
          },
        };
      }
      default:
        return { error: { code: 4200, message: `The test wallet does not answer ${method}.` } };
    }
  };
}

// The page's requests that anvil has not answered yet. They are awaited before anvil stops or reverts.
export const forwarding = new Set<Promise<string>>();
type Served = { origins: Set<string>; rpc: Rpc; safe: Address };
export async function serve(route: Route, { origins, rpc, safe }: Served): Promise<void> {
  const request = route.request();
  const { origin, pathname } = new URL(request.url());
  origins.add(origin);
  if (origin === SITE) {
    const path = `${DIST}${pathname === "/" ? "index.html" : pathname.slice(1)}`;
    return route.fulfill(existsSync(path) ? { path } : { status: 404 });
  }
  if (RPC_ORIGINS.includes(origin)) {
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: CORS });
    const body = request.postData() ?? "";
    if (rpc.refuse?.(body)) return route.abort();
    const answered = rpc.answer?.(body);
    if (answered !== undefined)
      return route.fulfill({ headers: { ...CORS, "content-type": "application/json" }, body: answered });
    const reply = post(body);
    forwarding.add(reply);
    // anvil can drop a connection ("fetch failed"). The request then fails as on a flaky network, and the page asks
    // again, rather than the rejection escaping this handler, which fails the whole test file.
    const answer = await reply.finally(() => forwarding.delete(reply)).catch(() => undefined);
    if (answer === undefined) return route.abort("connectionreset").catch(() => {});
    return route.fulfill({
      headers: { ...CORS, "content-type": "application/json" },
      body: rpc.rewrite?.(body, answer) ?? answer,
    });
  }
  if (origin === SAFE_ORIGIN) return route.fulfill({ contentType: "text/html", body: safePage(safe) });
  return route.abort();
}

let browser: Browser;
let node: ChildProcess;
let snapshot: Hex;
const contexts: BrowserContext[] = [];
type OpenOptions = {
  width?: number;
  height?: number;
  dark?: boolean;
  url?: string;
  flowing?: boolean;
  script?: boolean;
  refuse?: Rpc["refuse"];
  answer?: Rpc["answer"];
  safe?: Address;
  names?: string[];
};
export type Opened = Served & {
  page: Page;
  wallet: WalletOptions;
  sent: Sent[];
  asked: string[];
  violations: string[];
};

export async function open(wallet: Partial<WalletOptions> | false, options: OpenOptions = {}): Promise<Opened> {
  const {
    width = 1440,
    height = 900,
    dark = false,
    url = `${SITE}/`,
    flowing = false,
    script = true,
    refuse,
    answer,
    safe = LEAVER,
    names = ["Test Wallet"],
  } = options;
  const context = await browser.newContext({
    viewport: { width, height },
    colorScheme: dark ? "dark" : "light",
    locale: "en-GB",
    timezoneId: "Europe/Paris",
    javaScriptEnabled: script,
  });
  contexts.push(context);
  const settings: WalletOptions = { owner: NEWCOMER, chainId: 8453, decline: false, switches: true, ...wallet };
  const opened = {
    wallet: settings,
    sent: [] as Sent[],
    asked: [] as string[],
    origins: new Set<string>(),
    violations: [] as string[],
    rpc: { refuse, answer } as Rpc,
    safe,
  };
  await context.route("**/*", (route) => serve(route, opened));
  // Playwright's clock fakes `AbortSignal.timeout` too, so PAGE_SCRIPT must be added after it to undo that.
  const { timestamp } = await anvil.getBlock();
  if (script)
    await (flowing
      ? context.clock.install({ time: Number(timestamp) * 1000 })
      : context.clock.setFixedTime(Number(timestamp) * 1000));
  await context.addInitScript(PAGE_SCRIPT);
  if (wallet) {
    await context.exposeFunction("testWallet", testWallet(settings, opened.sent, opened.asked));
    await context.addInitScript(walletScript(names));
  }
  const page = await context.newPage();
  page.setDefaultTimeout(Number(process.env.FORK_TIMEOUT ?? 300_000));
  page.on(
    "console",
    (message) => /Content Security Policy|^\w*Error\b/.test(message.text()) && opened.violations.push(message.text()),
  );
  page.on("pageerror", (error) => opened.violations.push(String(error)));
  await page.goto(url);
  return { page, ...opened };
}
export async function connected(wallet: Partial<WalletOptions>, options?: OpenOptions): Promise<Opened> {
  const opened = await open(wallet, { url: `${SITE}/#hydrex`, ...options });
  await connectButton(opened.page).click();
  return opened;
}

export const connectButton = (page: Page) => page.getByRole("banner").getByRole("button", { name: "Connect a wallet" });
export const view = (page: Page | FrameLocator, name: string) => page.locator(`main > [data-view="${name}"]`);
export const group = (page: Page, key: string, where = "hydrex") => view(page, where).locator(`[data-group="${key}"]`);
export const row = (page: Page, id: number, where = "hydrex") =>
  view(page, where).locator(`[data-list=account] > [data-key="${id}"]`);
export const review = (page: Page | FrameLocator) => page.locator("#review");
export const heading = (page: Page | FrameLocator | Locator, name: string | RegExp, level = 1) =>
  page.getByRole("heading", { name, level, exact: typeof name === "string" });
export const text = (page: Page | Locator, key: string) => page.locator(`[data-text="${key}"]`);
export const field = (slip: Locator, label: string, part: "value" | "description" = "value") =>
  slip
    .locator("[data-list=field] > div")
    .filter({ has: slip.page().locator("dt", { hasText: new RegExp(`^${label}$`) }) })
    .locator(`[data-text=${part}]`);
export const pick = async (page: Page, ...ids: number[]) => {
  for (const id of ids) await page.getByRole("checkbox", { name: new RegExp(`#${id}$`) }).check();
};
// Ticks only these accounts of the group and unticks the rest, as accounts that need their owner start ticked.
export async function only(page: Page, key: string, ...ids: number[]): Promise<void> {
  const rows = group(page, key).locator("[data-list=account] > li");
  await rows.first().waitFor();
  for (const li of await rows.all()) {
    const box = li.locator("input");
    if (await box.isVisible()) await box.setChecked(ids.includes(Number(await li.getAttribute("data-key"))));
  }
}
export async function toCalls(page: Page): Promise<void> {
  await heading(review(page), "Before you join", 2).waitFor();
  await review(page).getByRole("button", { name: "Continue" }).click();
  await heading(review(page), /^Transactions?$/, 2).waitFor();
}
const progress = (page: Page) => review(page).locator("[data-text=progress]").innerText();
export async function confirm(page: Page): Promise<void> {
  const done = heading(review(page), "Done", 2).or(review(page).getByText(/(It|All \d+) went through\./));
  const next = review(page)
    .getByRole("button", { name: /^Sign (transaction|\d+ transactions|transaction \d+ of \d+)$/ })
    .and(review(page).locator("button:enabled"));
  for (let confirmed = 0; ; confirmed++) {
    try {
      await done.or(next).first().waitFor({ timeout: 120_000 });
    } catch (error) {
      throw new Error(`After ${confirmed} confirmed, the review shows: ${await progress(page)}`, { cause: error });
    }
    if (await done.first().isVisible()) return;
    await next.click();
  }
}
export async function shoot(page: Page, name: string): Promise<void> {
  if (!process.env.SCREENSHOTS) return;
  mkdirSync(process.env.SCREENSHOTS, { recursive: true });
  await page.screenshot({
    path: `${process.env.SCREENSHOTS}/${name}.png`,
    fullPage: !(await review(page).isVisible()),
  });
}

export function fork(block: number, owners: Address[], setup?: () => Promise<unknown>): void {
  before(async () => {
    const cached = (JSON.parse(process.env.FORK_CACHES ?? "{}") as Record<string, string>)[block];
    if (!cached)
      throw new Error("Run the browser tests through fork/run.ts, which serves the caches anvil forks through.");
    await startAnvil(block, cached);
    for (const owner of owners) await anvil.setBalance({ address: owner, value: FOR_GAS });
    browser = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
    await setup?.();
  });
  after(async () => {
    await browser?.close();
    await stopAnvil();
  });
  beforeEach(async () => void (snapshot = await anvil.snapshot()));
  afterEach(async () => {
    for (const context of contexts.splice(0)) await context.close();
    await Promise.allSettled(forwarding);
    await anvil.revert({ id: snapshot });
  });
}
export async function startAnvil(block: number, cached: string, stopping = () => false): Promise<void> {
  CACHE_URL = cached;
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as { port: number };
  await new Promise((resolve) => server.close(resolve));
  ANVIL = `http://127.0.0.1:${port}`;
  anvil = clientOf(ANVIL);
  const args = [
    "--fork-url",
    CACHE_URL,
    "--fork-block-number",
    String(block),
    "--port",
    String(port),
    "--auto-impersonate",
  ];
  args.push("--no-storage-caching", "--disable-min-priority-fee", "--timeout", "600000", "--prune-history", "100");
  const child = (node = spawn("anvil", args, {
    stdio: ["ignore", "ignore", process.env.ANVIL_LOG ? "inherit" : "ignore"],
  }));
  // A missing binary emits `error`, not `exit`, and an unhandled `error` event throws.
  let failed: Error | undefined;
  child.once("error", (error) => (failed = error));
  for (;;) {
    try {
      await anvil.getChainId();
      break;
    } catch {
      if (failed) throw new Error(`anvil did not start (${failed.message}): is Foundry on the PATH?`);
      if (stopping()) await stopAnvil(false);
      if (child.exitCode !== null || child.signalCode !== null)
        throw new Error(`anvil stopped as it started, with ${child.exitCode ?? child.signalCode}.`);
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  for (const token of NATIVE) await anvil.setCode({ address: token, bytecode: "0x" });
}
export async function stopAnvil(drain = true): Promise<void> {
  if (drain) await Promise.allSettled(forwarding);
  const child = node;
  if (child && child.exitCode === null && child.signalCode === null) {
    const exited = new Promise((resolve) => child.once("exit", resolve));
    child.kill();
    const late = setTimeout(() => child.kill("SIGKILL"), 5_000);
    await exited;
    clearTimeout(late);
  }
}
