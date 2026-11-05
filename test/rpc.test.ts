import assert from "node:assert/strict";
import { test } from "node:test";
import {
  decodeFunctionData,
  encodeAbiParameters,
  encodeFunctionResult,
  erc20Abi,
  multicall3Abi,
  parseAbi,
  type Address,
  type Hex,
} from "viem";
import { RPCS } from "../src/config.ts";
import { BATCH_BYTES, call, codeAt, firstBlockAt, read, rpc, showTags, simulate, timeoutFor } from "../src/rpc.ts";

type Handler = (url: string, body: { method: string; params: unknown[] }) => Response | Promise<Response>;
const serve = (handler: Handler) => {
  globalThis.fetch = (async (url: string, init: RequestInit) => handler(url, JSON.parse(String(init.body)))) as never;
};
const reply = (result: unknown) => Response.json({ jsonrpc: "2.0", id: 1, result });

test("a time's first block, from the blocks' own times, whatever the time between blocks", async () => {
  const GENESIS = 1_686_789_347;
  const timeAt = (block: number) =>
    GENESIS + 2 * Math.min(block, 1e6) + Math.max(0, Math.min(block, 2e6) - 1e6) + 3 * Math.max(0, block - 2e6);
  let reads = 0;
  const reader = async (block: number) => (reads++, timeAt(block));
  const top = 3_000_000;
  for (const block of [10, 999_999, 1_000_000, 1_500_001, 2_000_000, 2_500_000, top]) {
    reads = 0;
    const time = timeAt(block);
    assert.equal(await firstBlockAt(time, top, timeAt(top), reader), block, `block ${block}`);
    const before = timeAt(block - 1) >= time - 1 ? block - 1 : block;
    assert.equal(await firstBlockAt(time - 1, top, timeAt(top), reader), before);
    assert.ok(reads <= 2 * 26, `${reads} reads for block ${block}, in two searches`);
  }
  for (const pace of [2, 1, 3, 12]) {
    reads = 0;
    const evenly = async (block: number) => (reads++, GENESIS + pace * block);
    const time = GENESIS + pace * 52_000_001;
    assert.deepEqual(
      [await firstBlockAt(time, 53_000_000, GENESIS + pace * 53_000_000, evenly), reads],
      [52_000_001, 3],
    );
    reads = 0;
    const above = [53_000_005, GENESIS + pace * 53_000_005] as const;
    assert.deepEqual(
      [await firstBlockAt(time, 53_000_000, GENESIS + pace * 53_000_000, evenly, above), reads],
      [52_000_001, 2],
      "with a newer block given, the pace needs no read",
    );
  }
});

test("a busy RPC hands over to the next; an unwanted answer is taken only when none is wanted", async () => {
  const asked: string[] = [];
  serve((url) => (asked.push(url), url === RPCS[0] ? new Response("", { status: 429 }) : reply("0x1")));
  assert.equal(await rpc("eth_chainId", []), "0x1");
  assert.deepEqual(asked, RPCS.slice(0, 2));
  serve((url) => reply(url === RPCS[2] ? ["log"] : []));
  assert.deepEqual(await rpc("eth_getLogs", [], { want: (logs) => (logs as unknown[]).length > 0 }), ["log"]);
  serve(() => reply([]));
  assert.deepEqual(await rpc("eth_getLogs", [], { want: (logs) => (logs as unknown[]).length > 0 }), []);
  serve(() => reply(null));
  await assert.rejects(rpc("eth_getTransactionReceipt", ["0x"]));
});

test("reads go through Multicall3; a call that fails reads as undefined", async () => {
  const abi = parseAbi(["function aggregate3((address,bool,bytes)[]) returns ((bool success, bytes returnData)[])"]);
  serve((_, { params }) => {
    const { args } = decodeFunctionData({ abi, data: (params[0] as { data: `0x${string}` }).data });
    const results = (args[0] as unknown[]).map((_, i) => ({
      success: i === 0,
      returnData: i === 0 ? encodeAbiParameters([{ type: "uint256" }], [42n]) : ("0x" as const),
    }));
    return reply(encodeFunctionResult({ abi, functionName: "aggregate3", result: results }));
  });
  const balance = call(
    "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    erc20Abi,
    "balanceOf",
    "0x0000000000000000000000000000000000000001",
  );
  assert.deepEqual(await read([balance, balance]), [42n, undefined]);
});

test("reads for the page shown go first; the others never hold more than four slots", async () => {
  const started: string[] = [];
  const pending: (() => void)[] = [];
  serve((_, { params }) => {
    started.push(params[0] as string);
    return new Promise((done) => pending.push(() => done(reply("0x1"))));
  });
  showTags(["swap"]);
  const all = ["a", "b", "c", "d", "e"].map((id) => rpc("x", [id], { tag: "payouts" }));
  all.push(rpc("x", ["shown"], { tag: "swap" }), rpc("x", ["untagged"]));
  await new Promise((done) => setTimeout(done, 300));
  assert.deepEqual(started.sort(), ["a", "b", "c", "d", "shown", "untagged"].sort());
  for (const go of pending) go();
  await new Promise((done) => setTimeout(done, 100));
  pending.splice(0).forEach((go) => go());
  await Promise.all(all);
  assert.equal(started.length, 7);
});

test("an RPC that answers other than JSON-RPC, even in JSON, or does not answer, is asked again", async () => {
  let asked = 0;
  serve(() => {
    asked++;
    if (asked === 1) return Response.json(null);
    if (asked <= 3)
      return asked % 2 ? new Response("<html>") : Promise.reject(new DOMException("Slow.", "TimeoutError"));
    return reply("0x2");
  });
  assert.equal(await rpc("eth_chainId", []), "0x2");
  assert.equal(asked, 4);
});

test("a simulated call that reverts returns the revert's data, which RPCs put in its error", async () => {
  const refused = "0x77c522ea0000000000000000000000000000000000000000000000000000000000002105";
  serve(() =>
    reply([
      {
        calls: [
          { status: "0x1", returnData: "0x01", gasUsed: "0x10" },
          { status: "0x0", returnData: "0x", gasUsed: "0x20", error: { code: 3, message: "reverted", data: refused } },
          { status: "0x0", returnData: "0x02", gasUsed: "0x30" },
        ],
      },
    ]),
  );
  const to = "0x0000000000000000000000000000000000000001";
  const found = await simulate(to, [
    { to, data: "0x" },
    { to, data: "0x" },
    { to, data: "0x" },
  ]);
  assert.deepEqual(
    found.map(({ ok, returnData, gas }) => [ok, returnData, gas]),
    [
      [true, "0x01", 16n],
      [false, refused, 32n],
      [false, "0x02", 48n],
    ],
  );
});

test("which addresses hold code is one creation's answer for each 2,000 of them, a byte each", async () => {
  const addresses = Array.from({ length: 2_500 }, (_, i): Address => `0x${(i + 1).toString(16).padStart(40, "0")}`);
  const sent: Hex[] = [];
  serve((_, { method, params }) => {
    const [{ to, data }] = params as [{ to?: Address; data: Hex }];
    assert.equal(method, "eth_call");
    assert.equal(to, undefined, "no contract is called");
    sent.push(data);
    // After the 47-byte program, 20 bytes an address; those ending in an odd digit hold code.
    const asked = data.slice(2 + 94).match(/.{40}/g)!;
    return reply(`0x${asked.map((hex) => (parseInt(hex.at(-1)!, 16) % 2 ? "01" : "00")).join("")}`);
  });
  const found = await codeAt(addresses);
  assert.deepEqual(
    sent.map((data) => (data.length - 2 - 94) / 40),
    [2_000, 500],
  );
  assert.deepEqual(
    found,
    addresses.map((address) => parseInt(address.at(-1)!, 16) % 2 === 1),
  );
  serve(() => reply("0x01"));
  assert.deepEqual(
    await codeAt(addresses.slice(0, 3)),
    [undefined, undefined, undefined],
    "an answer of the wrong length",
  );
});

test("a request has 5 seconds, and longer the more it sends, as if six shared an upload of 1 Mbit/s", () => {
  assert.equal(timeoutFor(0), 5_000);
  assert.equal(timeoutFor(125_000), 11_000);
  assert.ok(timeoutFor(576_000) > 30_000, "a batch of a thousand lookups");
});

test("reads go in batches of at most 200 calls, and of at most 100 kB of calldata", async () => {
  const abi = parseAbi(["function f(bytes) view returns (uint256)"]);
  const sizes: number[] = [];
  serve((_, { params }) => {
    const [{ data }] = params as [{ data: Hex }];
    const { args } = decodeFunctionData({ abi: multicall3Abi, data });
    const calls = args[0] as readonly unknown[];
    sizes.push(calls.length);
    assert.ok((data.length - 2) / 2 <= BATCH_BYTES + 100, "within the cap, but for the batch's own few words");
    return reply(
      encodeFunctionResult({
        abi: multicall3Abi,
        functionName: "aggregate3",
        result: calls.map(() => ({ success: true, returnData: encodeAbiParameters([{ type: "uint256" }], [7n]) })),
      }),
    );
  });
  const to: Address = "0x0000000000000000000000000000000000000001";
  const small = await read(Array.from({ length: 450 }, () => call(to, abi, "f", "0x")));
  assert.deepEqual(sizes, [200, 200, 50]);
  sizes.length = 0;
  // Each call sends 1,092 bytes, padded to 1,120, and Multicall3 160 more: 78 of them fit in 100 kB.
  const large = await read(Array.from({ length: 200 }, () => call(to, abi, "f", `0x${"ab".repeat(1_024)}`)));
  assert.deepEqual(sizes, [78, 78, 44]);
  assert.ok([...small, ...large].every((value) => value === 7n));
});
