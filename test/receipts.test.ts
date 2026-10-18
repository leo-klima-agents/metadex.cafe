import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import {
  encodeAbiParameters,
  encodeEventTopics,
  encodeFunctionResult,
  parseAbi,
  parseAbiParameters,
  type Address,
  type Hex,
} from "viem";
import { forgetLimits } from "../src/chain.ts";
import { RPCS } from "../src/config.ts";
import {
  BLOCKS_PER_WEEK,
  blockTimes,
  changes,
  lastChange,
  lastRun,
  payouts,
  retires,
  type Log,
  type Search,
} from "../src/receipts.ts";

const abi = parseAbi([
  "event CarbonRetired(address indexed creditToken_, uint256 retireTonnes, uint256 kvcmSpent)",
  "event ClaimSwapAndDistributeCompleted(uint256 indexed tokenId, address indexed owner, address indexed recipient, address[] claimedTokens, uint256[] claimedAmounts, address[] distributedTokens, uint256[] distributedAmounts, uint256[] treasuryFees)",
]);
const KVCM: Address = "0x00fBAC94Fec8D4089d3fe979F39454F48c71A65d";
const USDC: Address = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const OWNER: Address = "0x60924601E73EBc5C2Bd9244c788d93e0710a6c93";
const OTHER: Address = "0xa79cd47655156b299762DFE92A67980805ce5a31";
const CREDIT: Address = "0x0000000000000000000000000000000000000c02";

// A total retired that steps up at the given blocks, read one block at a time.
function counter(steps: number[]) {
  const reads: number[] = [];
  const at = async (block: number) => {
    reads.push(block);
    return BigInt(steps.filter((step) => step <= block).length);
  };
  return { at, reads };
}

test("the stretch where a total that only grows last changed, in a few reads", async () => {
  const { at, reads } = counter([1_000, 51_698_051]);
  const found = await lastChange(at, 51_000_000, 52_694_000, 1n, 2n, 100);
  assert.ok(found.lower < 51_698_051 && 51_698_051 <= found.upper, `${found.lower} to ${found.upper}`);
  assert.ok(found.upper - found.lower <= 100);
  assert.equal(found.below, 1n);
  assert.ok(reads.length <= 15, `${reads.length} reads`);
});

test("each stretch in which the total changed, and none where it is the same at both ends", async () => {
  const steps = [100, 105, 160, 900];
  const { at } = counter(steps);
  const stretches = await changes(at, 50, 1_000, await at(50), await at(1_000), 10);
  for (const [first, last] of stretches) {
    assert.ok(last - first < 10, `${first} to ${last}`);
    assert.ok(
      steps.some((step) => first <= step && step <= last),
      `${first} to ${last} holds no change`,
    );
  }
  for (const step of steps)
    assert.equal(stretches.filter(([first, last]) => first <= step && step <= last).length, 1, `${step}`);
  const { at: flat, reads } = counter([10]);
  assert.deepEqual(await changes(flat, 50, 200, 1n, 1n, 10), []);
  assert.deepEqual(reads, []);
});

let index = 0;
const at = (tx: Hex, block: number) => ({
  transactionHash: tx,
  blockNumber: `0x${block.toString(16)}` as Hex,
  logIndex: `0x${(index++).toString(16)}` as Hex,
});

function retired(tx: Hex, block: number, tonnes: bigint, kvcm: bigint): Log {
  return {
    topics: encodeEventTopics({ abi, eventName: "CarbonRetired", args: { creditToken_: CREDIT } }) as [Hex, ...Hex[]],
    data: encodeAbiParameters(parseAbiParameters("uint256, uint256"), [tonnes, kvcm]),
    ...at(tx, block),
  };
}

type Tokens = [Address[], bigint[]];
function paidOut(
  tx: Hex,
  block: number,
  id: bigint,
  owner: Address,
  claimed: Tokens,
  paid: Tokens,
  fees: bigint[],
): Log {
  return {
    topics: encodeEventTopics({
      abi,
      eventName: "ClaimSwapAndDistributeCompleted",
      args: { tokenId: id, owner, recipient: owner },
    }) as [Hex, ...Hex[]],
    data: encodeAbiParameters(parseAbiParameters("address[], uint256[], address[], uint256[], uint256[]"), [
      ...claimed,
      ...paid,
      fees,
    ]),
    ...at(tx, block),
  };
}

const TX = `0x${"09".repeat(32)}` as Hex;
const t = (n: number) => BigInt(Math.round(n * 1e6)) * 10n ** 12n;

test("each account's payout, with the retirement just before it in the same transaction", () => {
  index = 0;
  const logs = [
    retired(TX, 51_698_051, t(65.26), t(326.8)),
    paidOut(
      TX,
      51_698_051,
      82774n,
      OWNER,
      [
        [USDC, KVCM],
        [12_000_000n, 0n],
      ],
      [
        [KVCM, USDC],
        [t(727.11), 0n],
      ],
      [0n, 0n],
    ),
    paidOut(TX, 51_698_051, 14247n, OTHER, [[], []], [[KVCM], [t(5)]], [t(0.05)]),
  ];
  const found = payouts([...logs].reverse());
  assert.deepEqual(
    found.map(({ id, owner, block, tonnes, retiredKvcm, earned, paid, fees }) => ({
      id,
      owner,
      block,
      tonnes,
      retiredKvcm,
      earned,
      paid,
      fees,
    })),
    [
      {
        id: 82774n,
        owner: OWNER,
        block: 51_698_051,
        tonnes: t(65.26),
        retiredKvcm: t(326.8),
        earned: [{ token: USDC, amount: 12_000_000n }],
        paid: [{ token: KVCM, amount: t(727.11) }],
        fees: [],
      },
      {
        id: 14247n,
        owner: OTHER,
        block: 51_698_051,
        tonnes: 0n,
        retiredKvcm: 0n,
        earned: [],
        paid: [{ token: KVCM, amount: t(5) }],
        fees: [{ token: KVCM, amount: t(0.05) }],
      },
    ],
    "in the order of the logs, whatever order they come in, and a retirement only for the account it precedes",
  );
  assert.equal(found[0]!.tx, TX);
});

test("a stretch's logs hold a retirement, or an RPC has lost them", () => {
  index = 0;
  assert.equal(retires([retired(TX, 1, 1n, 1n), paidOut(TX, 1, 1n, OWNER, [[], []], [[], []], [])]), true);
  assert.equal(retires([paidOut(TX, 1, 1n, OWNER, [[], []], [[], []], [])]), false);
  assert.equal(retires([]), false);
  assert.equal(retires(null), false);
});

// A Base that answers the search's reads: the total retired at any block, from the payouts that retired; their logs;
// and each block's time, two seconds a block.
const multicallAbi = parseAbi([
  "function aggregate3((address target, bool allowFailure, bytes callData)[] calls) payable returns ((bool success, bytes returnData)[])",
]);
type Paid = { id: bigint; block: number; retires: boolean };
type Read = { url: string; method: string; block?: number; from?: number; to?: number };

function base(head: number, paid: Paid[], lost: (read: Read) => boolean = () => false) {
  const chain = { head, paid, reads: [] as Read[] };
  const logsOf = () =>
    chain.paid.flatMap(({ id, block, retires: retiring }) => {
      const tx = `0x${id.toString(16).padStart(64, "0")}` as Hex;
      const paidLog = paidOut(tx, block, id, OWNER, [[USDC], [1_000_000n]], [[KVCM], [t(10)]], [0n]);
      return retiring ? [retired(tx, block, t(1), t(5)), paidLog] : [paidLog];
    });
  globalThis.fetch = async (input, init) => {
    const { method, params } = JSON.parse(String(init?.body)) as { method: string; params: any[] };
    const url = String(input);
    const reply = (result: unknown) => new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result }));
    if (method === "eth_blockNumber") return reply(`0x${chain.head.toString(16)}`);
    if (method === "eth_call") {
      const block = params[1] === "latest" ? chain.head : Number(params[1]);
      chain.reads.push({ url, method, block });
      const total = BigInt(chain.paid.filter((payout) => payout.retires && payout.block <= block).length);
      return reply(
        encodeFunctionResult({
          abi: multicallAbi,
          functionName: "aggregate3",
          result: [{ success: true, returnData: encodeAbiParameters([{ type: "uint256" }], [total]) }],
        }),
      );
    }
    if (method === "eth_getLogs") {
      const read = { url, method, from: Number(params[0].fromBlock), to: Number(params[0].toBlock) };
      chain.reads.push(read);
      const logs = logsOf().filter(
        ({ blockNumber }) => Number(blockNumber) >= read.from && Number(blockNumber) <= read.to,
      );
      return reply(lost(read) ? [] : logs);
    }
    if (method === "eth_getBlockByNumber") {
      chain.reads.push({ url, method, block: Number(params[0]) });
      return reply({ timestamp: `0x${(1_700_000_000 + 2 * Number(params[0])).toString(16)}` });
    }
    return reply(null);
  };
  return chain;
}

const original = globalThis.fetch;
beforeEach(() => forgetLimits());
afterEach(() => (globalThis.fetch = original));

const HEAD = 1_000_000;
// A run of four payouts over some 9,000 blocks, more than a week back, one paying out without retiring; and an older one.
const RUN: Paid[] = [
  { id: 1n, block: 598_800, retires: true },
  { id: 2n, block: 599_350, retires: true },
  { id: 3n, block: 600_120, retires: true },
  { id: 4n, block: 600_120, retires: false },
  { id: 5n, block: 607_800, retires: true },
];
const OLDER: Paid[] = [{ id: 9n, block: 300_000, retires: true }];
const ids = (search: Search) => search.run?.payouts.map(({ id }) => id);

test("the last run, whole, read in the background, without reading the week it has no change in", async () => {
  const chain = base(HEAD, [...OLDER, ...RUN]);
  const search = await lastRun();
  assert.deepEqual(ids(search), [1n, 2n, 3n, 4n, 5n]);
  assert.equal(search.run!.block, 607_800);
  assert.equal(search.run!.time, 1_700_000_000 + 2 * 607_800);
  assert.equal(search.total, 5n);
  // The total at HEAD - 1 week is the same as now: the change is before it, and nothing after it is read again.
  const calls = chain.reads.filter(({ method }) => method === "eth_call").map(({ block }) => block!);
  assert.ok(
    calls.slice(1).every((block) => block <= HEAD - 5 - BLOCKS_PER_WEEK),
    calls.join(", "),
  );
});

test("logs an RPC has lost go to the next RPC", async () => {
  const [first, second] = RPCS as [string, string];
  const chain = base(HEAD, RUN, ({ url, from, to }) => url === first && from! <= 607_800 && 607_800 <= to!);
  const search = await lastRun();
  assert.deepEqual(ids(search), [1n, 2n, 3n, 4n, 5n]);
  assert.ok(
    chain.reads.some(
      ({ url, method, from, to }) => url === second && method === "eth_getLogs" && from! <= 607_800 && 607_800 <= to!,
    ),
  );
  forgetLimits();
  base(HEAD, RUN, ({ from, to }) => from! <= 607_800 && 607_800 <= to!);
  await assert.rejects(lastRun(), /No Base RPC answered eth_getLogs/);
});

test("once the total has grown, only the new blocks are searched: a run goes on, or a new one begins", async () => {
  const going: Paid[] = [
    { id: 11n, block: HEAD - 3_000, retires: true },
    { id: 12n, block: HEAD - 1_000, retires: true },
  ];
  const chain = base(HEAD, [...OLDER, ...going]);
  const first = await lastRun();
  assert.deepEqual(ids(first), [11n, 12n]);
  chain.paid.push({ id: 13n, block: HEAD + 400, retires: true }, { id: 14n, block: HEAD + 900, retires: true });
  chain.head = HEAD + 2_000;
  chain.reads.length = 0;
  const next = await lastRun(first);
  assert.deepEqual(ids(next), [11n, 12n, 13n, 14n], "the same run, going on");
  assert.equal(next.total, 5n);
  assert.ok(
    chain.reads.every(({ block, from }) => (block ?? from!) > first.top),
    "nothing before the last search is read again",
  );
  // A week later, past a day: a full search, and a new run.
  chain.paid.push({ id: 15n, block: HEAD + BLOCKS_PER_WEEK, retires: true });
  chain.head = HEAD + BLOCKS_PER_WEEK + 1_000;
  assert.deepEqual(ids(await lastRun(next)), [15n]);
});

test("a block's time is read once", async () => {
  const chain = base(HEAD, RUN);
  await blockTimes([123_456, 123_457]);
  await blockTimes([123_456]);
  assert.equal(chain.reads.filter(({ method }) => method === "eth_getBlockByNumber").length, 2);
});
