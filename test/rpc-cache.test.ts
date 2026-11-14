import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { gzipSync } from "node:zlib";
import { serveCached } from "../fork/rpc-cache.ts";

const BLOCK = 100;
const AT = "0x64";
const ACCOUNT = "0x00000000000000000000000000000000000000aa";
const INFO = { balance: "0x1", nonce: "0x2", code: "0x60" };

// An upstream that answers `eth_getAccountInfo` if it serves it, and every other method with the method's name.
function upstreamOf(servesInfo: boolean) {
  const asked: string[] = [];
  return {
    asked,
    serves: (method: string) => servesInfo || method !== "eth_getAccountInfo",
    async ask({ method }: { method: string }) {
      asked.push(method);
      return { jsonrpc: "2.0" as const, id: 1, result: method === "eth_getAccountInfo" ? INFO : method };
    },
  };
}
async function served(upstream: ReturnType<typeof upstreamOf>, saved: Record<string, unknown> = {}) {
  const file = join(mkdtempSync(join(tmpdir(), "rpc-cache-")), "cache.json.gz");
  writeFileSync(file, gzipSync(JSON.stringify(saved)));
  const cache = await serveCached(upstream, file, BLOCK);
  const call = async (method: string) => {
    const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method, params: [ACCOUNT, AT] });
    const response = await fetch(cache.url, { method: "POST", body });
    return ((await response.json()) as { result: unknown }).result;
  };
  return { call, close: () => cache.close() };
}

test("the three account requests are asked upstream as one eth_getAccountInfo", async () => {
  const upstream = upstreamOf(true);
  const { call, close } = await served(upstream);
  assert.deepEqual(await Promise.all(["eth_getBalance", "eth_getTransactionCount", "eth_getCode"].map(call)), [
    "0x1",
    "0x2",
    "0x60",
  ]);
  assert.deepEqual(await call("eth_getAccountInfo"), INFO);
  assert.deepEqual(upstream.asked, ["eth_getAccountInfo"]);
  await close();
});

test("eth_getAccountInfo is answered from the three saved account answers", async () => {
  const upstream = upstreamOf(true);
  const saved = Object.fromEntries(
    Object.entries({ eth_getBalance: "0x1", eth_getTransactionCount: "0x2", eth_getCode: "0x60" }).map(
      ([method, result]) => [`${method} ${JSON.stringify([ACCOUNT, AT])}`, result],
    ),
  );
  const { call, close } = await served(upstream, saved);
  assert.deepEqual(await call("eth_getAccountInfo"), INFO);
  assert.deepEqual(upstream.asked, []);
  await close();
});

test("without eth_getAccountInfo upstream, each account request is asked alone", async () => {
  const upstream = upstreamOf(false);
  const { call, close } = await served(upstream);
  assert.equal(await call("eth_getBalance"), "eth_getBalance");
  assert.deepEqual(upstream.asked, ["eth_getBalance"]);
  await close();
});
