import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { rpc } from "../src/chain.ts";
import { RPCS } from "../src/config.ts";

type Answer = { status?: number; body?: unknown; headers?: Record<string, string> };
const original = globalThis.fetch;
afterEach(() => (globalThis.fetch = original));

// Each request answered by the next answer for its RPC, the last one again once they run out.
function answering(answers: Record<string, Answer[]>) {
  const asked: { url: string; at: number }[] = [];
  globalThis.fetch = async (input) => {
    const url = String(input);
    asked.push({ url, at: performance.now() });
    const queue = answers[url] ?? [];
    const { status = 200, body, headers } = (queue.length > 1 ? queue.shift() : queue[0]) ?? {};
    return new Response(JSON.stringify(body), { status, headers: headers ?? {} });
  };
  return asked;
}

const result = (value: unknown): Answer => ({ body: { jsonrpc: "2.0", id: 1, result: value } });
const error = (code: number, message: string): Answer => ({
  body: { jsonrpc: "2.0", id: 1, error: { code, message } },
});
const everywhere = (...answers: Answer[]) => Object.fromEntries(RPCS.map((url) => [url, [...answers]]));
const [first, second, third] = RPCS as [string, string, string];

test("a refused request goes to the next RPC at once", async () => {
  const asked = answering({
    [first]: [error(-32007, "25/second request limit reached")],
    [second]: [error(-32602, "Archive requests require a personal token.")],
    [third]: [result("0x10")],
  });
  assert.equal(await rpc("eth_blockNumber", []), "0x10");
  assert.deepEqual(
    asked.map(({ url }) => url),
    [first, second, third],
  );
});

test("when every RPC is busy, the request is asked again, after a wait", async () => {
  const asked = answering({
    [first]: [{ status: 429, body: "Too Many Requests" }, result("0x10")],
    [second]: [error(-32011, "request limit reached")],
    [third]: [{ status: 503 }],
  });
  assert.equal(await rpc("eth_blockNumber", []), "0x10");
  assert.equal(asked.length, 4);
});

test("only the RPCs that were busy are asked again", async () => {
  const asked = answering({
    [first]: [error(-32011, "request limit reached")],
    [second]: [error(-32602, "Archive requests require a personal token.")],
    [third]: [{ status: 429 }, result("0x10")],
  });
  assert.equal(await rpc("eth_getLogs", []), "0x10");
  assert.deepEqual(
    asked.map(({ url }) => url),
    [first, second, third, first, third],
  );
});

test("an answer an RPC would give again is not asked again", async () => {
  const asked = answering(everywhere(error(3, "execution reverted")));
  await assert.rejects(rpc("eth_call", []), /No Base RPC answered eth_call\./);
  assert.equal(asked.length, RPCS.length);
});

test("a request is asked five times at most, waiting longer each time", async () => {
  const asked = answering(everywhere({ status: 429 }));
  await assert.rejects(rpc("eth_getLogs", []));
  assert.equal(asked.length, 5 * RPCS.length);
});

test("an RPC's Retry-After is waited for", async () => {
  const asked = answering({
    [first]: [{ status: 429, headers: { "retry-after": "1" } }, result("0x10")],
    [second]: [{ status: 429 }],
    [third]: [{ status: 429 }],
  });
  assert.equal(await rpc("eth_blockNumber", []), "0x10");
  assert.ok(asked[3]!.at - asked[2]!.at >= 1_000, `${Math.round(asked[3]!.at - asked[2]!.at)} ms`);
});

test("every request waits its turn: six at a time at most, started 50 ms apart", async () => {
  let open = 0;
  let most = 0;
  const started: number[] = [];
  globalThis.fetch = async () => {
    started.push(performance.now());
    most = Math.max(most, ++open);
    await new Promise((done) => setTimeout(done, 400));
    open--;
    return new Response(JSON.stringify(result("0x1").body));
  };
  await Promise.all(Array.from({ length: 12 }, () => rpc("eth_chainId", [])));
  assert.equal(most, 6);
  const gaps = started.slice(1).map((at, i) => at - started[i]!);
  assert.ok(
    gaps.every((gap) => gap >= 45),
    gaps.map(Math.round).join(", "),
  );
});
