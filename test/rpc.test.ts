import assert from "node:assert/strict";
import { test } from "node:test";
import { decodeFunctionData, encodeAbiParameters, encodeFunctionResult, erc20Abi, parseAbi } from "viem";
import { RPCS } from "../src/config.ts";
import { call, read, rpc, showTags } from "../src/rpc.ts";

type Handler = (url: string, body: { method: string; params: unknown[] }) => Response | Promise<Response>;
const serve = (handler: Handler) => {
  globalThis.fetch = (async (url: string, init: RequestInit) => handler(url, JSON.parse(String(init.body)))) as never;
};
const reply = (result: unknown) => Response.json({ jsonrpc: "2.0", id: 1, result });

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
