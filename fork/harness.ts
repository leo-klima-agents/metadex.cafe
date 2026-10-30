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
  hexToBytes,
  keccak256,
  parseAbi,
  toHex,
  type Abi,
  type Address,
  type Hex,
} from "viem";
import { same, showTopics } from "../src/chain.ts";
import {
  AUTOMATIONS,
  DOUBLE_ESPRESSO,
  MATCHA_LATTE,
  DEFAULT_OUTPUT,
  HYDX,
  RPCS,
  SWAPPERS,
  VOTING_ESCROW,
  swapperOf,
} from "../src/config.ts";
import {
  holdersOf,
  lastEpoch,
  readAllEarnings,
  readEarnings,
  readVoterEarnings,
  rewardsFor,
  stakesOf,
  type Earnings,
  type Reward,
} from "../src/earnings.ts";
import { WEEK, short } from "../src/format.ts";
import { readAccounts } from "../src/hydrex.ts";
import { pricesNow, type Token } from "../src/prices.ts";
import { SETTLED, readEarned, readStamps, weighed } from "../src/receipts.ts";
import { MIDDLES, findRoute } from "../src/swap.ts";
import { describe as describeTokens, holdingsOf, known } from "../src/tokens.ts";
import { SAFE_ORIGIN } from "../src/wallet.ts";
import { runsCalls } from "./rpc-cache.ts";

export const CONDUIT = MATCHA_LATTE.address;
export const BLOCK = 52_694_000; // Fri 16 Oct 2026, 19:02 UTC
export const FLIP = 1_792_627_200; // Thu 22 Oct 2026, 00:00 UTC, when the epoch after BLOCK's starts
// After the swappers' deployment in block 52,894,916: Wed 21 Oct 2026, 15:42 UTC. Matcha Latte still owed #82774 the
// epoch from Thu 1 Oct.
export const RECENT = 52_904_000;
// anvil's address, on a port free when it starts, so that no other run's anvil answers in its place; and that of the
// cache it forks through.
let ANVIL = "";
let CACHE_URL = "";
export const SITE = "https://metadex.cafe";
export const SAFE_WALLET = SAFE_ORIGIN;
const DIST = fileURLToPath(new URL("../dist/", import.meta.url));
const SCREENSHOTS = process.env.SCREENSHOTS;
export const RPC_ORIGINS = RPCS.map((url) => new URL(url).origin);
// An answer for the page's RPCs as if they served another chain, Ethereum's: its id to eth_chainId, asked alone, with
// the request's own id. Anything else goes to the fork.
export function elsewhere(body: string): string | undefined {
  let call: { id?: unknown; method?: string };
  try {
    call = JSON.parse(body);
  } catch {
    return undefined;
  }
  return call.method === "eth_chainId"
    ? JSON.stringify({ jsonrpc: "2.0", id: call.id ?? 1, result: "0x1" })
    : undefined;
}
const CORS = { "access-control-allow-origin": "*", "access-control-allow-headers": "content-type" };

// Owners at BLOCK.
export const MEMBER = getAddress("0x388b2d29e7919d45b1b8f6e88b8a13a392f97b40"); // #9540 in Matcha Latte, #14485 its own
export const NEWCOMER = getAddress("0x0208ddbc05a91e1b937e8b3140b62ef22a274c95"); // #141 its own, #42877 in Liquid Hydrex
export const ELSEWHERE = getAddress("0x69707a120ade8239f07595165e180c61395ea655"); // #2435 in Lock Maxi, #2439 in USDC
export const LEAVER = getAddress("0x2573264b8e690ca6b2128c113890f42198840b16"); // #53350 and #82206 in Matcha Latte
export const ENDED = getAddress("0x2518820268e4079e90446b93020dfad7dd54e84d"); // #123351 ended with HYDX in it, #123364
export const PAYEE = getAddress("0x60924601e73ebc5c2bd9244c788d93e0710a6c93"); // #82774 in Matcha Latte, paid Wed 23 Sep
// Matcha Latte's last payout before BLOCK: one transaction, on Wed 23 Sep, that paid these accounts through Thu 17 Sep.
export const PAID = 51_698_051;
export const PAID_THROUGH = 1_789_603_200;
export const PAID_TX = "0x0932e5a24f24e45bfd1021764d94abc1d920754c4dc17128dd89f44bd086e899";
export const PAID_IDS = [26432n, 82774n, 14247n, 35366n];
const LIQUID_HYDREX = getAddress("0x809F8175b8F60960dF2bc7a78a7C4Eb04d138AF0");
export const LOCK_MAXI = getAddress("0x53388a4E98Bb56F8571433F5461010Fc287929d3");
export const USDC = getAddress("0xE57b3Ea02336B9b418cA523aB5aD6f479d93bD1D");
export const RECIPIENT = getAddress("0x000000000000000000000000000000000000beef");
export const STRANGER = getAddress("0x000000000000000000000000000000000000dead");
// Anyone may deploy Double Espresso, and claim through it: this address does, on the forks.
const SOMEONE = getAddress("0x0000000000000000000000000000000000001234");
// Double Espresso deploys through the CREATE2 deployer, with the salt and init code of its script/Deploy.s.sol at tag
// v2, commit 718c107. The init code was compiled from its verification/ input with solc 0.8.37.
const CREATE2_DEPLOYER = getAddress("0x4e59b44847b379578588920cA78FbF26c0B4956C");
const SALT = keccak256(toHex("metadex.cafe/ImmutableVeTokenConduit/v2"));
const INIT_CODE = readFileSync(
  new URL("fixtures/double-espresso-init-code.hex", import.meta.url),
  "utf8",
).trim() as Hex;
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

// What each wallet the tests and the QA wallet sign as gets for gas: 0.1 ETH.
export const FOR_GAS = 10n ** 17n;

// The fetch there was before warm() replaced it.
const nodeFetch = globalThis.fetch;

// What a request to anvil reads is fetched from FORK_URL meanwhile, all at once: see rpc-cache.ts. A request that runs
// no transaction, such as a poll of the newest block, reads nothing to fetch.
const prefetch = (body: string): void => {
  if (runsCalls(body)) void nodeFetch(`${CACHE_URL}/prefetch`, { method: "POST", body }).catch(() => {});
};

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
// it: see rpc-cache.ts. Without `to`, it deploys `data`.
export type Sendable = {
  from: string;
  to?: string;
  data: string;
  gas?: string;
  value?: string;
  accessList?: { address: string; storageKeys: string[] }[];
};

export async function send(tx: Sendable): Promise<Hex> {
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
  // No page shows here: every read is Node's own, and may use every slot.
  showTopics(["earnings", "average", "shares", "payouts", "swap"]);
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

export type Receipt = { status: Hex; contractAddress: Address | null };

// Waits for anvil to include a transaction, named `what` if it fails. One that failed, or that anvil has not mined in
// two minutes, even reading its state from FORK_URL, fails its test there and then, rather than at the suite's timeout.
export async function included(hash: Hex, what: string = hash): Promise<Receipt> {
  for (const deadline = Date.now() + 120_000; Date.now() < deadline;) {
    const receipt = await anvil<Receipt | null>("eth_getTransactionReceipt", [hash]);
    if (receipt?.status === "0x1") return receipt;
    // In words the QA wallet can show.
    if (receipt) throw new Error(`${what} failed on the fork.`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`${what} was not mined in two minutes.`);
}

// Sends a transaction, and waits for anvil to include it.
export async function mined(from: Address, to: Address, data: Hex): Promise<void> {
  await included(await send({ from, to, data, gas: GAS }));
}

// Has the VotingEscrow approve `conduit` for account `id`, or no longer: as joining or leaving an automation does.
export const approveConduit = (owner: Address, conduit: Address, id: bigint, approve = true) =>
  mined(
    owner,
    VOTING_ESCROW,
    encodeFunctionData({ abi, functionName: "setConduitApproval", args: [conduit, id, approve] }),
  );

// Double Espresso on a fork of a block before its deployment, on Tue 20 Oct 2026, as the page takes it to be on Base;
// nothing on a fork that has it already. Its constructor needs fresh Chainlink prices and Base's sequencer up. anvil's
// clock runs on from the fork's, so it deploys a minute after BLOCK.
export async function deployDoubleEspresso(): Promise<void> {
  if ((await anvil<Hex>("eth_getCode", [DOUBLE_ESPRESSO.address, "latest"])) !== "0x") return;
  const { timestamp } = await anvil<{ timestamp: Hex }>("eth_getBlockByNumber", [toHex(BLOCK), false]);
  await anvil("evm_setNextBlockTimestamp", [Number(timestamp) + 60]);
  await anvil("anvil_setBalance", [SOMEONE, toHex(FOR_GAS)]);
  await mined(SOMEONE, CREATE2_DEPLOYER, concat([SALT, INIT_CODE]));
  const at = getContractAddress({ opcode: "CREATE2", from: CREATE2_DEPLOYER, salt: SALT, bytecode: INIT_CODE });
  assert.equal(at, DOUBLE_ESPRESSO.address);
}

// The page reads a few blocks before the latest, which on the fork can be before the last transactions. Blocks after
// BLOCK make anvil read the state it lacks a slot at a time, so only the tests that need them mine them.
export const settle = () => anvil("anvil_mine", [toHex(SETTLED + 1)]);

// A claim through Double Espresso of one reward, from its fees or incentives contract.
export async function claimOne(from: Address, id: bigint, { contract, token, fee }: Reward): Promise<void> {
  const args = [id, fee ? [contract] : [], fee ? [] : [contract], [token.address]];
  await mined(from, DOUBLE_ESPRESSO.address, encodeFunctionData({ abi, functionName: "claim", args } as never));
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

export type WalletOptions = {
  owner: Address;
  chainId: number;
  decline: boolean;
  switches: boolean;
  approval?: Promise<void>;
  // Holds back the answer to a transaction until it settles, as a wallet does while its window is open.
  sending?: Promise<void>;
  // Sends several calls in one prompt, with EIP-5792, as Coinbase Wallet and MetaMask do: all or nothing, unless
  // `atomic` is false.
  batch?: boolean;
  atomic?: boolean;
  // Asks before it connects, switches or sends, as a wallet's window asks its owner, and says no where the answer is
  // false. The QA wallet asks the person trying the page: see qa.ts.
  ask?: (method: string, params: any[]) => Promise<boolean>;
  // How many of the next transactions to send with too little gas, so that they fail on Base.
  failing?: number;
  // The tokens it lists with ERC-7811's wallet_getAssets. A wallet that answers wallet_getCapabilities, as one that
  // lists its tokens does, sends several calls in one prompt too.
  assets?: Address[];
};
// Whether the wallet sends several calls in one prompt: as asked, or as a wallet that lists its tokens does.
export const sendsBatches = (options: Pick<WalletOptions, "batch" | "assets">): boolean =>
  !!options.batch || !!options.assets;
// Fails the reads of Base whose request body `refuse` matches, and gives those `answer` answers its own reply.
// `rewrite` changes anvil's reply to a request, where it gives another.
export type Rpc = {
  refuse?: ((body: string) => boolean) | undefined;
  answer?: ((body: string) => string | undefined) | undefined;
  rewrite?: ((body: string, reply: string) => string | undefined) | undefined;
};
type OpenOptions = {
  width?: number;
  height?: number;
  dark?: boolean;
  url?: string;
  flowing?: boolean;
  script?: boolean;
  refuse?: Rpc["refuse"];
  answer?: Rpc["answer"];
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
  // The chain Safe{Wallet} says the Safe is on, Base unless set.
  safeChainId?: number;
};

// A wallet that announces itself to the page and hands each request to Node through testWallet, which the page's
// Content Security Policy cannot block. With several names, it announces itself as that many wallets, which all hand
// their requests to the same testWallet.
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
  const infos = ${JSON.stringify(names)}.map((name, i) =>
    ({ uuid: "6f1e9b4e-0c4b-4d55-9a1d-3a0b5f0e7a1" + (i + 1), name, rdns: i ? "test.wallet" + i : "test.wallet", icon }));
  const announce = () => {
    for (const info of infos)
      window.dispatchEvent(new CustomEvent("eip6963:announceProvider", { detail: Object.freeze({ info, provider }) }));
  };
  window.addEventListener("eip6963:requestProvider", announce);
  announce();
})();`;
const WALLET_SCRIPT = walletScript(["Test Wallet"]);

const POLICY_SCRIPT = `document.addEventListener("securitypolicyviolation", (event) =>
  console.error("Content Security Policy: " + event.violatedDirective + " " + event.blockedURI));`;

const safePage = (safe: Address, chainId = 8453) => `<!doctype html><meta charset="utf-8"><title>Safe{Wallet}</title>
<iframe src="${SITE}/" style="inline-size: 100%; block-size: 95vh; border: 0"></iframe>
<script>
  window.received = [];
  addEventListener("message", ({ origin, source, data }) => {
    if (origin !== "${SITE}" || !data?.method) return;
    window.received.push({ method: data.method, params: data.params });
    const answers = {
      getSafeInfo: { safeAddress: "${safe}", chainId: ${chainId}, threshold: 2, owners: [], isReadOnly: false },
      sendTransactions: { safeTxHash: "0x${"ab".repeat(32)}" },
    };
    const reply = data.method in answers
      ? { id: data.id, success: true, version: "9.1.0", data: answers[data.method] }
      : { id: data.id, success: false, version: "9.1.0", error: data.method + " is not answered here" };
    source.postMessage(reply, origin);
  });
</script>`;

// Gas enough for Base to take the transaction, and too little to run it: what its calldata costs at least (EIP-7623).
// That floor leaves the call some gas, 24 for each nonzero byte of calldata and 6 for each zero: a call that runs on so
// little would go through, so the wallet refuses to send it rather than report a failure that did not happen. A call
// that reverts fails whatever its gas.
async function starved(from: Address, to: Address, data: Hex): Promise<string> {
  const bytes = hexToBytes(data);
  const nonzero = bytes.filter(Boolean).length;
  const floor = 21_000n + 40n * BigInt(nonzero) + 10n * BigInt(bytes.length - nonzero);
  const needed = await anvil<Hex>("eth_estimateGas", [{ from, to, data }]).then(BigInt, () => undefined);
  if (needed !== undefined && needed <= floor)
    throw new Error(
      `A call to ${to} runs on ${needed} gas, which its calldata's floor already gives it: it cannot fail.`,
    );
  return toHex(floor);
}

// Whether each of the calls goes through, one after the other, as a wallet that runs them in one transaction finds.
async function together(from: Address, calls: Sent[]): Promise<boolean> {
  const [block] = await anvil<{ calls: { status: Hex }[] }[]>("eth_simulateV1", [
    { blockStateCalls: [{ calls: calls.map(({ to, data }) => ({ from, to, data })) }], validation: false },
    "latest",
  ]);
  return !!block && block.calls.every(({ status }) => status === "0x1");
}

// Where given, `asked` gets the method of each request, and `sent` each call the page sent: the tests count them.
export function testWallet(options: WalletOptions, sent?: Sent[], asked?: string[]) {
  let asking = false;
  // Each batch's transactions, by its id.
  const batches = new Map<string, Hex[]>();
  let nextBatch = 1;
  const rejected = { error: { code: 4001, message: "User rejected the request." } };
  const allows = async (method: string, params: any[]) =>
    !options.decline && ((await options.ask?.(method, params)) ?? true);
  const gasFor = async (from: Address, to: Address, data: Hex) => {
    if (!options.failing) return GAS;
    options.failing--;
    return starved(from, to, data);
  };
  return async (method: string, params: any[]): Promise<{ result?: unknown; error?: unknown }> => {
    asked?.push(method);
    // The account picked as the page asks, which a wallet connects as, and sends from unless the page names another,
    // even if its owner picks another meanwhile.
    const picked = options.owner;
    const signer = ((params[0] as { from?: Address } | undefined)?.from ?? picked) as Address;
    switch (method) {
      case "eth_requestAccounts": {
        // As MetaMask does while its window is open.
        if (asking) return { error: { code: -32002, message: "Request already pending." } };
        asking = true;
        await options.approval;
        const allowed = (await options.ask?.(method, params)) ?? true;
        asking = false;
        return allowed ? { result: [picked] } : rejected;
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
        // As MetaMask does.
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
        // Those the account asked about holds, as a wallet lists them.
        const { account } = params[0] as { account: Address };
        const held = await Promise.all(options.assets.map(async (token) => (await balanceOf(token, account)) > 0n));
        const listed = options.assets.filter((_, i) => held[i]);
        return { result: { [toHex(8453)]: listed.map((address) => ({ address, type: "erc20" })) } };
      }
      case "wallet_sendCalls": {
        if (!sendsBatches(options)) return { error: { code: 4200, message: "The test wallet does not batch." } };
        const { calls } = params[0] as { calls: Sent[] };
        if (!(await allows(method, params))) return rejected;
        // Its id at once, before another batch can take the same.
        const id = `0x${(nextBatch++).toString(16).padStart(64, "0")}`;
        const hashes: Hex[] = [];
        batches.set(id, hashes);
        if (options.atomic !== false && (options.failing || !(await together(signer, calls)))) {
          // All or nothing: a batch that fails, as asked or as one of its calls fails after the others, changes nothing
          // but the gas of its one transaction.
          const [{ to, data }] = calls as [Sent];
          sent?.push(...calls);
          if (options.failing) options.failing--;
          hashes.push(await send({ to, data, from: signer, gas: await starved(signer, to as Address, data as Hex) }));
        } else {
          // One after the other, each in its own block: anvil has no account code to run them together.
          for (const { to, data } of calls) {
            sent?.push({ to, data });
            hashes.push(await send({ to, data, from: signer, gas: await gasFor(signer, to as Address, data as Hex) }));
          }
        }
        return { result: { id } };
      }
      case "wallet_getCallsStatus": {
        const hashes = batches.get(params[0] as string) ?? [];
        const receipts = await Promise.all(
          hashes.map((hash) => anvil<{ status: Hex } | null>("eth_getTransactionReceipt", [hash])),
        );
        if (receipts.some((receipt) => !receipt)) return { result: { status: 100 } };
        // EIP-5792's codes: 200 included, 500 reverted whole, 600 reverted in part.
        const failed = receipts.filter((receipt) => receipt!.status !== "0x1").length;
        const status = !failed ? 200 : failed === receipts.length ? 500 : 600;
        return { result: { status, atomic: options.atomic !== false, receipts } };
      }
      default:
        return { error: { code: 4200, message: `The test wallet does not answer ${method}.` } };
    }
  };
}

// Requests the page sent to anvil that it has not answered yet. A test can end while the page waits on one, and once
// anvil stops, the request fails in a handler that nobody awaits any more. So anvil answers them all before it stops.
export const forwarding = new Set<Promise<string>>();

export async function serve(
  route: Route,
  { origins, rpc, safe, safeChainId }: Pick<Opened, "origins" | "rpc" | "safe" | "safeChainId">,
): Promise<void> {
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
    const answered = rpc.answer?.(request.postData() ?? "");
    if (answered !== undefined)
      return route.fulfill({ headers: { ...CORS, "content-type": "application/json" }, body: answered });
    const reply = post(request.postData() ?? "");
    forwarding.add(reply);
    const answer = await reply.finally(() => forwarding.delete(reply));
    const body = rpc.rewrite?.(request.postData() ?? "", answer) ?? answer;
    return route.fulfill({ headers: { ...CORS, "content-type": "application/json" }, body });
  }
  if (origin === SAFE_WALLET) return route.fulfill({ contentType: "text/html", body: safePage(safe, safeChainId) });
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
    answer,
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
    rpc: { refuse, answer } as Rpc,
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

// The header's button, which connects the one wallet in the browser at once.
export const connectButton = (page: Page) => page.locator("header").getByRole("button", { name: "Connect a wallet" });

// Connected on the Hydrex accounts' page, unless `options` says where.
export async function connected(wallet: Partial<WalletOptions>, options?: OpenOptions): Promise<Opened> {
  const opened = await open(wallet, { url: `${SITE}/#hydrex`, ...options });
  await connectButton(opened.page).click();
  return opened;
}

export const app = (page: Page) => page.locator('.view[data-view="app"]');
export const hydrex = (page: Page) => page.locator('.view[data-view="hydrex"]');
export const account = (page: Page, id: number) =>
  hydrex(page)
    .locator("#accounts li")
    .filter({ hasText: `#${id}` });
// The Hydrex accounts' groups: those that need their owner, "needs:unvoted", "needs:stopped" and "needs:partly";
// "in:matcha-latte", "in:double-espresso", "other" and "closed".
export const group = (page: Page, key: string) => hydrex(page).locator(`.group[data-group="${key}"]`);
export const product = (page: Page, kind: string) => page.locator(`.view[data-kind="${kind}"]`);
export const position = (page: Page) => page.locator('.view[data-view="position"]');
export const review = (page: Page | FrameLocator) => page.locator("#review");
export const homeTitle = (page: Page) => page.getByRole("heading", { name: "Vote, claim and swap on Base" });
export const appTitle = (page: Page) => page.getByRole("heading", { name: "Your wallet", level: 1, exact: true });
export const hydrexTitle = (page: Page) => page.getByRole("heading", { name: "Hydrex", level: 1, exact: true });
export const toHydrex = (page: Page) => page.goto(`${SITE}/#hydrex`);
export const chip = (page: Page, owner: Address) => page.locator("header").getByText(short(owner));

// Goes through the join's first step, to the calls.
export async function toWallet(page: Page): Promise<void> {
  await review(page).getByRole("heading", { name: "Before you join" }).waitFor();
  await review(page).getByRole("button", { name: "Continue" }).click();
  // "Transaction" for one, "Transactions" for several.
  await review(page)
    .getByRole("heading", { name: /^Transactions?$/ })
    .waitFor();
}

// Waits until the page names the next epoch's start, as Hydrex's page does when a change made now moves the votes.
export async function nextEpoch(page: Page, day: RegExp): Promise<void> {
  await page.waitForFunction(
    (source) => new RegExp(source).test(document.querySelector("time.epoch-end")?.textContent ?? ""),
    day.source,
  );
}

export async function pick(page: Page, ...ids: number[]): Promise<void> {
  for (const id of ids) await page.getByRole("checkbox", { name: `Pick Hydrex account #${id}` }).check();
}

// Ticks these accounts of a group, and only these: what needs you starts ticked.
export async function only(page: Page, key: string, ...ids: number[]): Promise<void> {
  for (const box of await group(page, key).locator(".pick:not([hidden])").all()) {
    await box.setChecked(ids.includes(Number(await box.getAttribute("value"))));
  }
}

// An account its owner votes with, who has not voted since before last epoch.
export const UNVOTED = /Not voted since/;

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
    await review(page)
      .getByRole("button", { name: /^Sign (transaction|\d+ transactions)$/ })
      .click();
    await review(page)
      .getByRole("heading", { name: "Done" })
      .or(review(page).getByText(/^(It|All \d+) went through\./))
      .first()
      .waitFor({ timeout: 120_000 });
  } catch (error) {
    const shown = await review(page).locator(".progress").allTextContents();
    throw new Error(`The review shows: ${JSON.stringify(shown)}`, { cause: error });
  }
  await review(page).getByRole("button", { name: "Close" }).click();
}

// Confirms the review's transactions one by one, each once the one before is included, until the last is. anvil first
// runs them all at once, as `from`, with no time limit: so it reads the state they need in parallel, rather than for
// one transaction after another, which on a first run can take minutes each.
export async function confirmEach(page: Page, from: Address): Promise<void> {
  const hexes = (selector: string) =>
    review(page)
      .locator(selector)
      .evaluateAll((elements) => elements.map((element) => element.textContent!.replace(/\s/g, "")));
  const [tos, datas] = await Promise.all([hexes(".to"), hexes(".data")]);
  await Promise.all(
    tos.map((to, i) => anvil("eth_call", [{ from, to, data: datas[i], gas: GAS }, "latest"]).catch(() => {})),
  );
  // The Done screen, or, without an outcome to show, the words in the foot.
  const done = review(page)
    .getByRole("heading", { name: "Done" })
    .or(review(page).getByText(/^(It|All \d+) went through\./));
  const next = review(page)
    .getByRole("button", { name: /^Sign (transaction|\d+ transactions|transaction \d+ of \d+)$/ })
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
  await startAnvil(block, cached);
  for (const owner of owners) await anvil("anvil_setBalance", [owner, toHex(FOR_GAS)]);
  browser = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
}

// Starts anvil on a fork of Base at `block`, through the cache at `cached`. Once `stopping` says so, as when the QA
// wallet closes, it stops anvil rather than wait for it to listen.
export async function startAnvil(block: number, cached: string, stopping = () => false): Promise<void> {
  CACHE_URL = cached;
  const port = await freePort();
  ANVIL = `http://127.0.0.1:${port}`;
  const child = (node = spawn(
    "anvil",
    // anvil keeps no answers of its own, so that the cache sees each request. Its gas price is the block's base fee, as
    // on Base, where tips are next to nothing: anvil's own least tip, 1 gwei, would price gas 200 times higher. It
    // waits for the cache as long as the cache waits for FORK_URL, up to 5 minutes for an answer, rather than its own
    // 45 s. It keeps the state of its last 100 blocks in memory, and none on disk: otherwise it writes the whole state
    // of each older block to ~/.foundry/anvil/tmp, as the QA wallet mines one every 2 seconds, and leaves it there once
    // stopped.
    [
      ...["--fork-url", CACHE_URL, "--fork-block-number", String(block), "--port", String(port), "--auto-impersonate"],
      ...["--no-storage-caching", "--disable-min-priority-fee", "--timeout", "600000", "--prune-history", "100"],
    ],
    { stdio: ["ignore", "ignore", process.env.ANVIL_LOG ? "inherit" : "ignore"] },
  ));
  // anvil listens once it has read the fork's block, which a busy FORK_URL may take minutes to answer. Stopped by a
  // signal, as stopAnvil stops it, it has no exit code, only the signal.
  for (;;) {
    try {
      await anvil("eth_chainId");
      break;
    } catch {
      if (stopping()) await stopAnvil(false);
      if (child.exitCode !== null || child.signalCode !== null)
        throw new Error(`anvil stopped as it started, with ${child.exitCode ?? child.signalCode}.`);
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  for (const token of NATIVE) await anvil("anvil_setCode", [token, "0x"]);
}

// Starts a fork at BLOCK, for the owners there, with Double Espresso on it, and reads what the page reads first.
export async function startAtBlock(): Promise<void> {
  const owners = [MEMBER, NEWCOMER, ELSEWHERE, LEAVER, ENDED];
  await start(BLOCK, owners);
  await deployDoubleEspresso();
  await warmAtBlock(owners);
}

// What an automation's votes earned in the last epoch to have ended on Hydrex, as the page reads it.
export const earnedLastEpoch = async (automation: Address): Promise<Earnings> =>
  readEarnings(automation, (await lastEpoch()).start);

// What Hydrex's page reads beside the accounts: all of Hydrex last epoch, for its average, and what the votes of each
// owner's accounts earned through whoever held them, chosen as the page chooses them. Inside warm(), as each of these
// is thousands of reads of state that anvil fetches from FORK_URL a slot at a time, longer than the page waits for an
// answer.
async function votesOf(owners: Address[]): Promise<void> {
  const { start } = await earnedLastEpoch(CONDUIT);
  const stakes = await Promise.all(
    owners.map(async (owner) => {
      const { accounts } = await readAccounts(owner);
      return stakesOf(
        accounts.filter(({ amount }) => amount > 0n).map(({ id }) => id),
        start,
      );
    }),
  );
  const holders = holdersOf(stakes.flatMap((found) => [...found.values()]));
  await Promise.all([readAllEarnings(start), ...holders.map((holder) => readVoterEarnings(holder, start))]);
}

// Reads with no time limit what the page reads first at BLOCK, which a first run fetches from FORK_URL for minutes:
// each owner's accounts, and what each automation earned last epoch. And as Matcha Latte paid nothing from Wed 23 Sep,
// for any account in it the payouts also read the pools of the epoch from Thu 1 Oct, among every pool's reward
// contracts.
export const warmAtBlock = (owners: Address[]) =>
  warm(() =>
    Promise.all([
      ...owners.map((owner) => readAccounts(owner)),
      ...AUTOMATIONS.map(({ address }) => earnedLastEpoch(address)),
      rewardsFor(CONDUIT, FLIP - 3 * WEEK),
      votesOf(owners),
    ]),
  );

// Reads with no time limit what the page reads first of each automation and of `owners`, and what an account's page
// reads of the payouts of `ids` in Matcha Latte's pools, last epoch's and the one before's. A revert drops what anvil
// fetched, so a test reads them again after its own transactions.
export const warmStandings = (owners: Address[], ids: bigint[]) =>
  warm(async () => {
    const [earnings] = await Promise.all([
      earnedLastEpoch(CONDUIT),
      earnedLastEpoch(DOUBLE_ESPRESSO.address),
      ...owners.map((owner) => readAccounts(owner)),
      votesOf(owners),
    ]);
    const top = Number(await anvil<Hex>("eth_blockNumber")) - SETTLED;
    const last = weighed(earnings!.rewards, earnings!.prices);
    const before = weighed(await rewardsFor(CONDUIT, earnings!.start - WEEK), earnings!.prices);
    await Promise.all([readStamps(ids, last, top), readEarned(ids, last, top), readStamps(ids, before, top)]);
  });

// Double Espresso on Base, with #82774 in it, claimed by someone and then by a stranger, a USDC reward each; and
// what the page reads of it, and of `owners`, read with no time limit. It answers Matcha Latte's rewards of last epoch,
// which Double Espresso's accounts earn in the same pools.
export async function doubleEspressoReceipts(owners: Address[] = []): Promise<Reward[]> {
  await deployDoubleEspresso();
  let rewards: Reward[] = [];
  await warm(async () => {
    rewards = (await earnedLastEpoch(CONDUIT)).rewards;
    await readAccounts(PAYEE);
  });
  await anvil("anvil_setBalance", [PAYEE, toHex(FOR_GAS)]);
  await anvil("anvil_setBalance", [STRANGER, toHex(FOR_GAS)]);
  await anvil("anvil_setBalance", [SOMEONE, toHex(FOR_GAS)]);
  await approveConduit(PAYEE, DOUBLE_ESPRESSO.address, 82774n);
  const usdc = rewards.filter(({ token }) => token.symbol === "USDC");
  await claimOne(SOMEONE, 82774n, usdc[0]!);
  await claimOne(STRANGER, 82774n, usdc[1]!);
  await settle();
  await warmStandings(owners, [82774n]);
  return rewards;
}

// A port nothing listens on now.
async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as { port: number };
  await new Promise((resolve) => server.close(resolve));
  return port;
}

export async function stop(): Promise<void> {
  await browser?.close();
  await stopAnvil();
}

// anvil busy with a request can take long to stop: after five seconds, it is made to. It first answers what the page
// sent it, unless `drain` is false, as when the page's window has closed: see forwarding.
export async function stopAnvil(drain = true): Promise<void> {
  if (drain) await Promise.allSettled(forwarding);
  // This anvil, though another may start meanwhile.
  const child = node;
  if (child && child.exitCode === null && child.signalCode === null) {
    const exited = new Promise((resolve) => child.once("exit", resolve));
    child.kill();
    const late = setTimeout(() => child.kill("SIGKILL"), 5_000);
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
export const doubleEspressoAbi = parseAbi(["function lastClaimBlock(uint256 tokenId) view returns (uint256)"]);

// A contract's answer on the fork, at its newest block.
export async function readOn<T>(to: Address, abi: Abi, functionName: string, args: unknown[] = []): Promise<T> {
  const data = encodeFunctionData({ abi, functionName, args } as never);
  const reply = await anvil<Hex>("eth_call", [{ to, data }, "latest"]);
  return decodeFunctionResult({ abi, functionName, data: reply } as never) as T;
}
export const balanceOf = (token: Address, owner: Address) => readOn<bigint>(token, tokenAbi, "balanceOf", [owner]);

export const swapView = (page: Page) => page.locator('.view[data-view="swap"]');

// Matcha Latte's fee recipient, a Safe that holds many of the tokens its fee took.
export const HOLDER = getAddress("0xd9e966a6bfa2ae2113a34bb4dd02ded921da50af");
export const AVNT = getAddress("0x696f9436b67233384889472cd7cd58a6fb5df4f1");
export const ZORA = getAddress("0x1111111111166b7fe7bd91427724b487980afc69");
// A wallet of the test's own, which the fee recipient gives three of its tokens, so that the page has only those to route.
export const SELLER = getAddress("0x0000000000000000000000000000000000c0ffee");

// Gives SELLER the fee recipient's whole balance of each token, then reads what the page will: the balances, the prices, and
// each token's route into USDC, with no time limit, as anvil reads the pools from FORK_URL a slot at a time.
export async function fund(tokens: Address[]): Promise<void> {
  const into = SWAPPERS[0]!;
  for (const token of tokens) {
    const amount = await balanceOf(token, HOLDER);
    await mined(HOLDER, token, encodeFunctionData({ abi: tokenAbi, functionName: "transfer", args: [SELLER, amount] }));
  }
  await warm(async () => {
    // The page reads the balance of every token it knows, and adds last epoch's rewards, such as AVNT, once it has read
    // each automation's.
    await Promise.all(AUTOMATIONS.map(({ address }) => earnedLastEpoch(address)));
    const held = await holdingsOf(SELLER, [...known(), ...tokens], into.address);
    // The page prices the tokens its routes name too.
    const described = await describeTokens([...tokens, into.token, ...MIDDLES, HYDX]);
    const amounts = new Map(tokens.map((token) => [token.toLowerCase(), held.get(token.toLowerCase())!.balance]));
    await pricesNow([...described.values()], amounts);
    for (const token of tokens) await findRoute(token, amounts.get(token.toLowerCase())!, into, false);
  });
}

// Reads, with no time limit, what the page reads of an owner's payouts, what the claim of #82774 reads, and the routes
// into the default output and the prices now for what it brings, which the claim's review reads as it opens.
export async function warmPayouts(owner: Address): Promise<void> {
  await warm(async () => {
    const holdings = await readAccounts(owner);
    const ids = holdings.accounts
      .filter((account) =>
        [account.delegate, account.claimer, account.delegateAtStart].some(
          (address) => same(address, CONDUIT) || same(address, DOUBLE_ESPRESSO.address),
        ),
      )
      .map(({ id }) => id);
    const earnings = await earnedLastEpoch(CONDUIT);
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
      votesOf([owner]),
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

// A claim's review opens on what waits, unless the page found nothing to claim, or Base refused the claim: the test
// then fails at once, with the page's words.
export async function claimOpens(page: Page | FrameLocator): Promise<void> {
  const waits = review(page).getByRole("heading", { name: "What waits" });
  const refused = review(page)
    .locator(".pages p")
    .filter({ hasText: /^(Nothing to claim|Base refused the claim)/ });
  await waits.or(refused).first().waitFor({ timeout: 300_000 });
  if (!(await waits.isVisible())) assert.fail(`The claim's review says: ${await refused.innerText()}`);
}
