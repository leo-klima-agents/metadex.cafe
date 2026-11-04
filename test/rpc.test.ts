import assert from "node:assert/strict";
import { test } from "node:test";
import { decodeFunctionData, encodeAbiParameters, encodeFunctionResult, erc20Abi, parseAbi } from "viem";
import { RPCS } from "../src/config.ts";
import { call, firstBlockAt, read, rpc, showTags } from "../src/rpc.ts";

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
