import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { serveCached } from "../fork/rpc-cache.ts";

type Answer = { status?: number; body: unknown };
// An upstream RPC that counts what it is asked, and answers each method as `answers` says: in turn, for a list, with
// its last answer from then on.
async function upstream(answers: Record<string, Answer | Answer[]>) {
  const asked: string[] = [];
  const server = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk: Buffer) => (body += chunk));
    request.on("end", () => {
      const { id, method } = JSON.parse(body) as { id: number; method: string };
      const all = [answers[method]!].flat();
      const { status = 200, body: reply } =
        all[Math.min(asked.filter((each) => each === method).length, all.length - 1)]!;
      asked.push(method);
      response.writeHead(status, { "content-type": "application/json" });
      response.end(JSON.stringify(typeof reply === "object" && reply ? { jsonrpc: "2.0", id, ...reply } : reply));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as { port: number };
  return { url: `http://127.0.0.1:${port}`, asked, close: () => new Promise((resolve) => server.close(resolve)) };
}

const ask = async (url: string, method: string, params: unknown[], id = 7) => {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
  });
  return {
    status: response.status,
    reply: (await response.json()) as { id: number; result?: unknown; error?: unknown },
  };
};

test("the fork's cache asks the upstream once for an answer about a block, and keeps it for the next run", async () => {
  const rpc = await upstream({
    eth_getStorageAt: { body: { result: "0x01" } },
    eth_getBlockByNumber: { body: { result: { number: "0x10" } } },
    eth_getTransactionReceipt: { body: { result: null } },
    eth_call: { body: { error: { code: 3, message: "execution reverted" } } },
  });
  const file = join(mkdtempSync(join(tmpdir(), "fork-cache-")), "base.json.gz");
  const cache = await serveCached(rpc.url, file);
  const slot = ["0x25B2ED7149fb8A05f6eF9407d9c8F878f59cd1e1", "0x0", "0x3240a70"];
  // The same request at once, then again: one request upstream, and each answer with its own id.
  const [one, two] = await Promise.all([
    ask(cache.url, "eth_getStorageAt", slot, 1),
    ask(cache.url, "eth_getStorageAt", slot, 2),
  ]);
  assert.deepEqual([one.reply.id, one.reply.result, two.reply.id, two.reply.result], [1, "0x01", 2, "0x01"]);
  assert.equal((await ask(cache.url, "eth_getStorageAt", slot)).reply.result, "0x01");
  // The newest block moves, a receipt not found may be found later, and an error is not an answer: each is asked again.
  for (let i = 0; i < 2; i++) {
    await ask(cache.url, "eth_getBlockByNumber", ["latest", false]);
    await ask(cache.url, "eth_getTransactionReceipt", ["0xab"]);
    assert.deepEqual((await ask(cache.url, "eth_call", [{}, "0x3240a70"])).reply.error, {
      code: 3,
      message: "execution reverted",
    });
  }
  assert.deepEqual([...rpc.asked].sort(), [
    "eth_call",
    "eth_call",
    "eth_getBlockByNumber",
    "eth_getBlockByNumber",
    "eth_getStorageAt",
    "eth_getTransactionReceipt",
    "eth_getTransactionReceipt",
  ]);
  assert.deepEqual([cache.asked, cache.fetched], [9, 7]);
  await cache.close();
  // The next run reads it from the file.
  const next = await serveCached(rpc.url, file);
  assert.equal((await ask(next.url, "eth_getStorageAt", slot)).reply.result, "0x01");
  assert.equal(next.fetched, 0);
  await next.close();
  await rpc.close();
});

test("an upstream over its limit is asked again, once for all the requests for the same answer", async () => {
  const busy = { status: 429, body: { error: { code: -32011, message: "request limit reached" } } };
  const rpc = await upstream({ eth_getLogs: [busy, busy, { body: { result: [] } }], eth_getCode: busy });
  const cache = await serveCached(rpc.url, join(mkdtempSync(join(tmpdir(), "fork-cache-")), "base.json.gz"), {
    retries: 3,
    backoff: 1,
  });
  const logs = [{ fromBlock: "0x10", toBlock: "0x10", address: "0x01", topics: [] }];
  const replies = await Promise.all([1, 2, 3].map((id) => ask(cache.url, "eth_getLogs", logs, id)));
  assert.deepEqual(
    replies.map(({ status, reply }) => [status, reply.id, reply.result]),
    [
      [200, 1, []],
      [200, 2, []],
      [200, 3, []],
    ],
  );
  assert.deepEqual(rpc.asked, ["eth_getLogs", "eth_getLogs", "eth_getLogs"]);
  // Still over its limit after every try: anvil is answered as the upstream answered.
  const { status, reply } = await ask(cache.url, "eth_getCode", ["0x01", "0x10"]);
  assert.equal(status, 429);
  assert.deepEqual(reply.error, { code: -32011, message: "request limit reached" });
  assert.equal(rpc.asked.filter((method) => method === "eth_getCode").length, 4);
  await cache.close();
  await rpc.close();
});

test("requests for logs go to the upstream at most so many a second", async () => {
  const rpc = await upstream({ eth_getLogs: { body: { result: [] } } });
  const cache = await serveCached(rpc.url, join(mkdtempSync(join(tmpdir(), "fork-cache-")), "base.json.gz"), {
    logsPerSecond: 2,
  });
  const start = Date.now();
  await Promise.all(
    ["0x1", "0x2", "0x3"].map((block) =>
      ask(cache.url, "eth_getLogs", [{ fromBlock: block, toBlock: block, topics: [] }]),
    ),
  );
  assert.ok(Date.now() - start >= 900, "the third waits for a second after the first");
  await cache.close();
  await rpc.close();
});

test("a method the upstream does not serve is asked of it once", async () => {
  const rpc = await upstream({
    eth_getAccountInfo: { status: 401, body: { error: { code: -32611, message: "rejected due to request filter" } } },
  });
  const cache = await serveCached(rpc.url, join(mkdtempSync(join(tmpdir(), "fork-cache-")), "base.json.gz"));
  for (const block of ["0x10", "0x11"]) {
    const { status, reply } = await ask(cache.url, "eth_getAccountInfo", ["0x01", block]);
    assert.equal(status, 401);
    assert.deepEqual(reply.error, { code: -32611, message: "rejected due to request filter" });
  }
  assert.deepEqual(rpc.asked, ["eth_getAccountInfo"]);
  await cache.close();
  await rpc.close();
});

test("the upstream is asked through the fetch there was when the cache was loaded, as the tests replace it", async () => {
  const rpc = await upstream({ eth_getCode: { body: { result: "0x60" } } });
  const cache = await serveCached(rpc.url, join(mkdtempSync(join(tmpdir(), "fork-cache-")), "base.json.gz"));
  const original = globalThis.fetch;
  const elsewhere: string[] = [];
  globalThis.fetch = (input, init) => {
    if (String(input) !== cache.url) elsewhere.push(String(input));
    return original(input, init);
  };
  try {
    assert.equal((await ask(cache.url, "eth_getCode", ["0x01", "0x10"])).reply.result, "0x60");
  } finally {
    globalThis.fetch = original;
  }
  assert.deepEqual(elsewhere, []);
  await cache.close();
  await rpc.close();
});
