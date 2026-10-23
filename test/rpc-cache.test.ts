import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { serveCached, upstreamOf } from "../fork/rpc-cache.ts";

type Answer = { status?: number; headers?: Record<string, string>; body: unknown };
// An upstream RPC that counts what it is asked, and how many requests it had at once, and answers each method as
// `answers` says, after `delay` milliseconds: in turn, for a list, with its last answer from then on.
async function upstream(answers: Record<string, Answer | Answer[]>, delay = 0) {
  const asked: string[] = [];
  const seen = { now: 0, most: 0 };
  const server = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk: Buffer) => (body += chunk));
    request.on("end", async () => {
      const { id, method } = JSON.parse(body) as { id: number; method: string };
      const all = [answers[method]!].flat();
      const {
        status = 200,
        headers = {},
        body: reply,
      } = all[Math.min(asked.filter((each) => each === method).length, all.length - 1)]!;
      asked.push(method);
      seen.most = Math.max(seen.most, ++seen.now);
      await new Promise((resolve) => setTimeout(resolve, delay));
      seen.now--;
      response.writeHead(status, { "content-type": "application/json", ...headers });
      response.end(JSON.stringify(typeof reply === "object" && reply ? { jsonrpc: "2.0", id, ...reply } : reply));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as { port: number };
  return {
    url: `http://127.0.0.1:${port}`,
    asked,
    seen,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

const fileOf = () => join(mkdtempSync(join(tmpdir(), "fork-cache-")), "base.json.gz");

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
    eth_gasPrice: { body: { result: "0x4c4b40" } },
    eth_call: { body: { error: { code: 3, message: "execution reverted" } } },
  });
  const file = fileOf();
  const through = upstreamOf(rpc.url);
  const cache = await serveCached(through, file);
  const slot = ["0x25B2ED7149fb8A05f6eF9407d9c8F878f59cd1e1", "0x0", "0x3240a70"];
  // The same request at once, then again: one request upstream, and each answer with its own id.
  const [one, two] = await Promise.all([
    ask(cache.url, "eth_getStorageAt", slot, 1),
    ask(cache.url, "eth_getStorageAt", slot, 2),
  ]);
  assert.deepEqual([one.reply.id, one.reply.result, two.reply.id, two.reply.result], [1, "0x01", 2, "0x01"]);
  assert.equal((await ask(cache.url, "eth_getStorageAt", slot)).reply.result, "0x01");
  // The newest block moves, and an error is not an answer: each is asked again. A receipt not found, as of a
  // transaction sent on the fork, and the gas price, which a fork of a past block needs once, are asked once a run.
  for (let i = 0; i < 2; i++) {
    await ask(cache.url, "eth_getBlockByNumber", ["latest", false]);
    assert.equal((await ask(cache.url, "eth_getTransactionReceipt", ["0xab"])).reply.result, null);
    assert.equal((await ask(cache.url, "eth_gasPrice", [])).reply.result, "0x4c4b40");
    assert.deepEqual((await ask(cache.url, "eth_call", [{}, "0x3240a70"])).reply.error, {
      code: 3,
      message: "execution reverted",
    });
  }
  assert.deepEqual([...rpc.asked].sort(), [
    "eth_call",
    "eth_call",
    "eth_gasPrice",
    "eth_getBlockByNumber",
    "eth_getBlockByNumber",
    "eth_getStorageAt",
    "eth_getTransactionReceipt",
  ]);
  assert.deepEqual([cache.asked, through.fetched], [11, 7]);
  await cache.close();
  // The next run reads the slot from the file, and asks for the receipt again.
  const again = upstreamOf(rpc.url);
  const next = await serveCached(again, file);
  assert.equal((await ask(next.url, "eth_getStorageAt", slot)).reply.result, "0x01");
  assert.equal(again.fetched, 0);
  await ask(next.url, "eth_getTransactionReceipt", ["0xab"]);
  assert.equal(again.fetched, 1);
  await next.close();
  await rpc.close();
});

test("an upstream over its limit is asked again, once for all the requests for the same answer", async () => {
  const busy = { status: 429, body: { error: { code: -32011, message: "request limit reached" } } };
  const rpc = await upstream({ eth_getLogs: [busy, busy, { body: { result: [] } }], eth_getCode: busy });
  const through = upstreamOf(rpc.url, { patience: 200, backoff: 1, maxBackoff: 10 });
  const cache = await serveCached(through, fileOf());
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
  // Still over its limit once its patience runs out: anvil is answered as the upstream answered.
  const start = Date.now();
  const { status, reply } = await ask(cache.url, "eth_getCode", ["0x01", "0x10"]);
  assert.equal(status, 429);
  assert.deepEqual(reply.error, { code: -32011, message: "request limit reached" });
  assert.ok(Date.now() - start >= 200, "asked again for as long as its patience");
  const code = rpc.asked.filter((method) => method === "eth_getCode").length;
  assert.ok(code > 2, `asked ${code} times`);
  // Two answers over its limit for the logs, each but the last for the code, then asked again.
  assert.equal(through.busy, 2 + code - 1);
  await cache.close();
  await rpc.close();
});

test("an upstream that says when to ask again is asked no sooner", async () => {
  const busy = { status: 429, headers: { "retry-after": "1" }, body: { error: { code: 429, message: "rate limit" } } };
  const rpc = await upstream({ eth_getCode: [busy, { body: { result: "0x60" } }] });
  const cache = await serveCached(upstreamOf(rpc.url, { backoff: 1 }), fileOf());
  const start = Date.now();
  assert.equal((await ask(cache.url, "eth_getCode", ["0x01", "0x10"])).reply.result, "0x60");
  assert.ok(Date.now() - start >= 1_000, "a second, as Retry-After said");
  await cache.close();
  await rpc.close();
});

test("the caches of a run ask the upstream through one queue, at most so many at a time", async () => {
  const rpc = await upstream({ eth_getStorageAt: { body: { result: "0x01" } } }, 30);
  const through = upstreamOf(rpc.url, { inFlight: 2 });
  const caches = await Promise.all([fileOf(), fileOf()].map((file) => serveCached(through, file)));
  await Promise.all(
    Array.from({ length: 10 }, (_, i) =>
      ask(caches[i % 2]!.url, "eth_getStorageAt", ["0x01", `0x${i.toString(16)}`, "0x10"]),
    ),
  );
  assert.deepEqual([rpc.asked.length, rpc.seen.most], [10, 2]);
  for (const cache of caches) await cache.close();
  await rpc.close();
});

test("a method the upstream does not serve is asked of it once", async () => {
  const rpc = await upstream({
    eth_getAccountInfo: { status: 401, body: { error: { code: -32611, message: "rejected due to request filter" } } },
  });
  const cache = await serveCached(upstreamOf(rpc.url), fileOf());
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
  const cache = await serveCached(upstreamOf(rpc.url), fileOf());
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

test("what a call reads is asked of the upstream at once, from its access list, before anvil asks for it", async () => {
  const rpc = await upstream({
    eth_createAccessList: {
      body: {
        result: {
          accessList: [
            {
              address: "0x25B2ED7149fb8A05f6eF9407d9c8F878f59cd1e1",
              storageKeys: [`0x${"0".repeat(63)}1`, `0x${"ab".repeat(32)}`],
            },
          ],
          gasUsed: "0x5208",
        },
      },
    },
    eth_getAccountInfo: { status: 401, body: { error: { code: -32611, message: "rejected due to request filter" } } },
    eth_getBalance: { body: { result: "0x0" } },
    eth_getTransactionCount: { body: { result: "0x1" } },
    eth_getCode: { body: { result: "0x" } },
    eth_getStorageAt: { body: { result: `0x${"0".repeat(63)}5` } },
  });
  const through = upstreamOf(rpc.url);
  const cache = await serveCached(through, fileOf(), 16);
  const from = "0x0000000000000000000000000000000000c0FFEE";
  const to = "0x4200000000000000000000000000000000000006";
  await cache.prefetch(
    JSON.stringify([
      { jsonrpc: "2.0", id: 1, method: "eth_call", params: [{ from, to, data: "0x" }, "latest"] },
      { jsonrpc: "2.0", id: 2, method: "eth_blockNumber", params: [] },
    ]),
  );
  const fetched = through.fetched;
  // Two slots, and three accounts, each in three requests once the upstream refuses the one anvil asks first.
  assert.equal(fetched, 1 + 1 + 3 * 3 + 2);
  // anvil then finds each kept, as it asks: a slot as a number, an address in lower case.
  const contract = "0x25b2ed7149fb8a05f6ef9407d9c8f878f59cd1e1";
  assert.equal(
    (await ask(cache.url, "eth_getStorageAt", [contract, "0x1", "0x10"])).reply.result,
    `0x${"0".repeat(63)}5`,
  );
  await ask(cache.url, "eth_getStorageAt", [contract, `0x${"ab".repeat(32)}`, "0x10"]);
  await ask(cache.url, "eth_getCode", [from.toLowerCase(), "0x10"]);
  await ask(cache.url, "eth_getBalance", [to, "0x10"]);
  assert.equal(through.fetched, fetched);
  // The same call again asks nothing.
  await cache.prefetch(
    JSON.stringify({ jsonrpc: "2.0", id: 3, method: "eth_estimateGas", params: [{ from, to, data: "0x" }] }),
  );
  assert.equal(through.fetched, fetched);
  await cache.close();
  await rpc.close();
});

test("a request that names the fork's block by its hash is answered as one that names it by its number", async () => {
  const hash = `0x${"68".repeat(32)}`;
  const rpc = await upstream({
    eth_getBlockByNumber: { body: { result: { number: "0x10", hash } } },
    eth_getStorageAt: { body: { result: "0x01" } },
  });
  const cache = await serveCached(upstreamOf(rpc.url), fileOf(), 16);
  const contract = "0x25b2ed7149fb8a05f6ef9407d9c8f878f59cd1e1";
  await ask(cache.url, "eth_getBlockByNumber", ["0x10", false]);
  assert.equal((await ask(cache.url, "eth_getStorageAt", [contract, "0x0", "0x10"])).reply.result, "0x01");
  assert.equal((await ask(cache.url, "eth_getStorageAt", [contract, "0x0", { blockHash: hash }])).reply.result, "0x01");
  // Another block's hash names that block.
  await ask(cache.url, "eth_getStorageAt", [contract, "0x0", { blockHash: `0x${"ab".repeat(32)}` }]);
  assert.deepEqual(rpc.asked, ["eth_getBlockByNumber", "eth_getStorageAt", "eth_getStorageAt"]);
  await cache.close();
  await rpc.close();
});

test("a transaction sent on the fork is not found without asking the upstream", async () => {
  const rpc = await upstream({ eth_getTransactionReceipt: { body: { result: { status: "0x1" } } } });
  const cache = await serveCached(upstreamOf(rpc.url), fileOf(), 16);
  const hash = `0x${"5d".repeat(32)}`;
  await fetch(`${cache.url}/sent`, { method: "POST", body: hash });
  assert.equal(
    (await ask(cache.url, "eth_getTransactionReceipt", [hash.toUpperCase().replace("0X", "0x")])).reply.result,
    null,
  );
  assert.equal((await ask(cache.url, "eth_getTransactionByHash", [hash])).reply.result, null);
  // Base's own transactions are still asked for.
  assert.deepEqual((await ask(cache.url, "eth_getTransactionReceipt", [`0x${"ab".repeat(32)}`])).reply.result, {
    status: "0x1",
  });
  assert.deepEqual(rpc.asked, ["eth_getTransactionReceipt"]);
  await cache.close();
  await rpc.close();
});

test("runs that close at once each keep their answers", async () => {
  const rpc = await upstream({ eth_getStorageAt: { body: { result: "0x01" } } });
  const file = fileOf();
  const caches = await Promise.all([1, 2, 3].map(() => serveCached(upstreamOf(rpc.url), file)));
  await Promise.all(caches.map((cache, i) => ask(cache.url, "eth_getStorageAt", ["0x01", `0x${i}`, "0x10"])));
  await Promise.all(caches.map((cache) => cache.close()));
  const again = upstreamOf(rpc.url);
  const next = await serveCached(again, file);
  for (const i of [0, 1, 2]) await ask(next.url, "eth_getStorageAt", ["0x01", `0x${i}`, "0x10"]);
  assert.equal(again.fetched, 0);
  await next.close();
  await rpc.close();
});

test("anvil's requests go to the upstream before the prefetch's", async () => {
  const slots = Array.from({ length: 12 }, (_, i) => `0x${i.toString(16).padStart(64, "0")}`);
  const rpc = await upstream(
    {
      eth_createAccessList: {
        body: { result: { accessList: [{ address: "0x01", storageKeys: slots }], gasUsed: "0x0" } },
      },
      eth_getAccountInfo: { body: { result: { balance: "0x0", nonce: "0x0", code: "0x" } } },
      eth_getStorageAt: { body: { result: "0x00" } },
      eth_getCode: { body: { result: "0x60" } },
    },
    100,
  );
  const cache = await serveCached(upstreamOf(rpc.url, { inFlight: 1 }), fileOf(), 16);
  const prefetched = cache.prefetch(
    JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_call", params: [{ to: "0x01" }, "latest"] }),
  );
  // While the first slot is asked, the others wait their turn; anvil then asks for code, which goes next.
  while (!rpc.asked.includes("eth_getStorageAt")) await new Promise((resolve) => setTimeout(resolve, 5));
  await ask(cache.url, "eth_getCode", ["0x02", "0x10"]);
  assert.equal(rpc.asked.indexOf("eth_getCode"), rpc.asked.indexOf("eth_getStorageAt") + 1, rpc.asked.join(" "));
  await prefetched;
  assert.equal(rpc.asked.filter((method) => method === "eth_getStorageAt").length, 12);
  await cache.close();
  await rpc.close();
});
