import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { resetRateLimits, rpc } from "../src/chain.ts";
import { RPCS } from "../src/config.ts";

type Answer = { status?: number; body?: unknown; fail?: Error };
const original = { fetch: globalThis.fetch, random: Math.random, setTimeout: globalThis.setTimeout };
beforeEach(() => resetRateLimits());
afterEach(() => {
  globalThis.fetch = original.fetch;
  Math.random = original.random;
  globalThis.setTimeout = original.setTimeout;
});

type Asked = { url: string; method: string; at: number };

// Answers each RPC's requests with its answers in turn, then repeats the last one.
function answering(answers: Record<string, Answer[]>) {
  const asked: Asked[] = [];
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    asked.push({ url, method: JSON.parse(String(init?.body)).method, at: performance.now() });
    const queue = answers[url] ?? [];
    const { status = 200, body, fail } = (queue.length > 1 ? queue.shift() : queue[0]) ?? {};
    if (fail) throw fail;
    return new Response(typeof body === "string" ? body : JSON.stringify(body), { status });
  };
  return asked;
}

const result = (value: unknown): Answer => ({ body: { jsonrpc: "2.0", id: 1, result: value } });
const error = (code: number, message: string): Answer => ({
  body: { jsonrpc: "2.0", id: 1, error: { code, message } },
});
const everywhere = (...answers: Answer[]) => Object.fromEntries(RPCS.map((url) => [url, [...answers]]));
const [first, second, third] = RPCS as [string, string, string];
const urls = (asked: Asked[]) => asked.map(({ url }) => url);

test("a refused request goes to the next RPC at once", async () => {
  const asked = answering({
    [first]: [error(-32007, "25/second request limit reached")],
    [second]: [{ status: 429, ...error(15, "You reached Public endpoint rate limit, please upgrade to paid plan") }],
    [third]: [result("0x10")],
  });
  assert.equal(await rpc("eth_blockNumber", []), "0x10");
  assert.deepEqual(urls(asked), [first, second, third]);
});

test("only the RPCs that were busy are asked again, once they have rested", async () => {
  const asked = answering({
    [first]: [error(-32011, "request limit reached")],
    [second]: [{ status: 429 }, result("0x10")],
    [third]: [{ status: 403, ...error(-32602, "Archive requests require a personal token.") }],
  });
  assert.equal(await rpc("eth_getLogs", []), "0x10");
  assert.deepEqual(urls(asked), [first, second, third, first, second]);
  assert.ok(asked[3]!.at - asked[0]!.at >= 990, "the first RPC rested a second");
});

test("an RPC that refused is left alone for a second by the requests that follow", async () => {
  const asked = answering({ [first]: [{ status: 429 }, result("0x1")], [second]: [result("0x2")] });
  assert.equal(await rpc("eth_chainId", []), "0x2");
  assert.equal(await rpc("eth_chainId", []), "0x2");
  assert.deepEqual(urls(asked), [first, second, second]);
});

test("an answer an RPC would give again is not asked again", async () => {
  for (const answer of [
    error(3, "execution reverted"),
    error(-32000, "header not found"),
    error(-32000, "execution timeout"),
    { body: "<html>Bad gateway</html>" },
    { body: null },
    result(null),
  ]) {
    resetRateLimits();
    const asked = answering(everywhere(answer));
    await assert.rejects(rpc("eth_call", []), /No Base RPC answered eth_call\./);
    assert.equal(asked.length, RPCS.length, JSON.stringify(answer.body));
  }
});

test("a request too slow for every RPC fails over, and is not asked again", async () => {
  const asked = answering(everywhere({ fail: new DOMException("The operation timed out.", "TimeoutError") }));
  await assert.rejects(rpc("eth_call", []));
  assert.equal(asked.length, RPCS.length);
});

test("an RPC out of reach, or cut off in its answer, is asked again", async () => {
  const asked = answering({
    [first]: [{ fail: new TypeError("fetch failed") }, result("0x10")],
    [second]: [{ fail: new TypeError("fetch failed") }],
    [third]: [{ fail: new TypeError("fetch failed") }],
  });
  assert.equal(await rpc("eth_blockNumber", []), "0x10");
  assert.equal(asked.length, 4);
  resetRateLimits();
  const cut = new Response(
    new ReadableStream({ start: (controller) => controller.error(new TypeError("terminated")) }),
  );
  let reads = 0;
  globalThis.fetch = async () =>
    reads++ < RPCS.length ? cut.clone() : new Response(JSON.stringify(result("0x11").body));
  assert.equal(await rpc("eth_blockNumber", []), "0x11");
  assert.equal(reads, RPCS.length + 1);
});

test("a request is asked five times at most, waiting longer each time", async () => {
  Math.random = () => 1;
  const asked = answering(everywhere({ status: 503 }));
  await assert.rejects(rpc("eth_getLogs", []));
  assert.equal(asked.length, 5 * RPCS.length);
  const rounds = asked.filter((_, i) => i % RPCS.length === 0).map(({ at }) => at);
  const waits = rounds.slice(1).map((at, i) => Math.round(at - rounds[i]!));
  // Each RPC rests a second after refusing, so the first three waits are about a second. The fourth backoff is longer.
  assert.ok(
    waits.slice(0, 3).every((wait) => wait >= 990 && wait < 1_500),
    waits.join(", "),
  );
  assert.ok(waits[3]! >= 1_990, waits.join(", "));
});

test("each RPC is asked 25 times a second at most, 5 of them for logs; the next RPC takes the rest", async () => {
  const asked = answering(everywhere(result("0x1")));
  await Promise.all(Array.from({ length: 30 }, () => rpc("eth_chainId", [])));
  assert.equal(asked.filter(({ url }) => url === first).length, 25);
  assert.equal(asked.filter(({ url }) => url === second).length, 5);
  resetRateLimits();
  asked.length = 0;
  await Promise.all(Array.from({ length: 12 }, () => rpc("eth_getLogs", [])));
  assert.deepEqual(
    RPCS.map((url) => asked.filter((request) => request.url === url).length),
    [5, 5, 2],
  );
});

test("a request waits for a free RPC only when none is, and sets no timer otherwise", async () => {
  let timers = 0;
  globalThis.setTimeout = ((...args: Parameters<typeof setTimeout>) => {
    timers++;
    return original.setTimeout(...args);
  }) as typeof setTimeout;
  const asked = answering(everywhere(result("0x1")));
  await Promise.all(Array.from({ length: 15 }, () => rpc("eth_getLogs", [])));
  assert.equal(timers, 0, "15 reads of logs fit in the three RPCs' windows");
  await rpc("eth_getLogs", []);
  assert.ok(timers > 0);
  assert.ok(asked.at(-1)!.at - asked[0]!.at >= 990, "the 16th waited for a window to free");
});

test("six requests at a time at most, the page's own before those in the background", async () => {
  let open = 0;
  let most = 0;
  const order: string[] = [];
  globalThis.fetch = async (_, init) => {
    order.push(JSON.parse(String(init?.body)).method);
    most = Math.max(most, ++open);
    await new Promise((done) => original.setTimeout(done, 100));
    open--;
    return new Response(JSON.stringify(result("0x1").body));
  };
  const busy = Array.from({ length: 6 }, () => rpc("first", []));
  const later = rpc("later", [], { later: true });
  const now = rpc("now", []);
  await Promise.all([...busy, later, now]);
  assert.equal(most, 6);
  assert.deepEqual(order.slice(6), ["now", "later"]);
});

test("an answer the caller does not take goes to the next RPC; a pending receipt's null is one it takes", async () => {
  const asked = answering({ [first]: [result([])], [second]: [result([{ topics: ["0x1"] }])] });
  const logs = await rpc<unknown[]>("eth_getLogs", [], { accept: (found) => (found as unknown[]).length > 0 });
  assert.equal(logs.length, 1);
  assert.deepEqual(urls(asked), [first, second]);
  resetRateLimits();
  const polled = answering(everywhere(result(null)));
  assert.equal(await rpc("eth_getTransactionReceipt", [], { accept: () => true }), null);
  assert.equal(polled.length, 1, "one RPC a poll");
});

test("a doubtful answer is taken only once no RPC answers otherwise", async () => {
  const doubt = (found: unknown) => (found as unknown[]).length === 0;
  const asked = answering({ [first]: [result([])], [second]: [result(["0x1"])] });
  assert.deepEqual(await rpc("eth_getLogs", [], { doubt }), ["0x1"], "the RPC behind is passed over");
  assert.deepEqual(urls(asked), [first, second]);
  resetRateLimits();
  answering({ [first]: [result([])], [second]: [result([])], [third]: [error(-32602, "unknown block")] });
  assert.deepEqual(await rpc("eth_getLogs", [], { doubt }), [], "no RPC answers otherwise");
  resetRateLimits();
  answering(everywhere(error(-32602, "unknown block")));
  await assert.rejects(rpc("eth_getLogs", [], { doubt }), /No Base RPC answered/);
});

test("a request waiting for room gives its turn to others", async () => {
  const asked = answering(everywhere(result("0x1")));
  // This uses up all three RPCs' limits for logs for a second.
  await Promise.all(Array.from({ length: 15 }, () => rpc("eth_getLogs", [], { later: true })));
  const waiting = Array.from({ length: 6 }, () => rpc("eth_getLogs", [], { later: true }));
  const before = performance.now();
  await rpc("eth_chainId", []);
  assert.ok(performance.now() - before < 200, "the page's read did not wait for the six");
  await Promise.all(waiting);
  assert.equal(asked.length, 22);
});
