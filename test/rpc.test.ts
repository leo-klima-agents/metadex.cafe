import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { RPCS } from "../src/config.ts";
import { resetRpc, rpc } from "../src/rpc.ts";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
  resetRpc();
});
const answering = (reply: (url: string, attempt: number) => object | number) => {
  const asked: string[] = [];
  globalThis.fetch = (async (url: string) => {
    asked.push(url);
    const body = reply(url, asked.length);
    return typeof body === "number" ? new Response("", { status: body }) : Response.json(body);
  }) as typeof fetch;
  return asked;
};

test("a refused or failing request goes to the next RPC", async () => {
  const asked = answering((url) =>
    url === RPCS[0] ? { error: { code: -32000, message: "execution reverted" } } : { result: "0x1" },
  );
  assert.equal(await rpc("eth_chainId", []), "0x1");
  assert.deepEqual(asked, RPCS.slice(0, 2));
});

test("busy RPCs are asked again after a wait; the others are not", async () => {
  const asked = answering((url, n) =>
    url === RPCS[1] && n > 3 ? { result: "0x2" } : url === RPCS[1] ? 429 : { error: { message: "nope" } },
  );
  assert.equal(await rpc("eth_blockNumber", []), "0x2");
  assert.deepEqual(asked, [...RPCS, RPCS[1]]);
});

test("an answer the caller does not accept goes to the next RPC; a doubtful one is a last resort", async () => {
  answering((url) => ({ result: url === RPCS[2] ? [1] : [] }));
  assert.deepEqual(await rpc("eth_getLogs", [], { accept: (logs) => (logs as unknown[]).length > 0 }), [1]);
  answering(() => ({ result: [] }));
  assert.deepEqual(await rpc("eth_getLogs", [], { doubt: (logs) => !(logs as unknown[]).length }), []);
});
