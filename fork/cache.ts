import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { homedir } from "node:os";
import { gunzipSync, gzipSync } from "node:zlib";
import { RPCS } from "../src/config.ts";

// anvil forks through this: each answer about the fork's past is fetched from BASE_RPC_URL once, then kept on disk in
// FORK_CACHE, so later runs ask nothing. At most 8 requests go upstream at a time; one refused is asked again after an
// exponential backoff, for up to 5 minutes.
const UPSTREAM = process.env.BASE_RPC_URL || RPCS[0]!;
const DIR = process.env.FORK_CACHE ?? `${homedir()}/.cache/metadex.cafe/fork`;
// Transactions the tests send: anvil asks upstream for those it has not mined yet, which Base never knew.
const LOCAL = ["eth_getTransactionReceipt", "eth_getTransactionByHash"];

type Request = { id: unknown; method: string; params: unknown[] };
let running = 0;
const waiting: (() => void)[] = [];
export let fetched = 0;

async function upstream(request: Request): Promise<unknown> {
  while (running >= 8) await new Promise<void>((go) => waiting.push(go));
  running++;
  try {
    for (let attempt = 0, start = Date.now(); ; attempt++) {
      try {
        const response = await fetch(UPSTREAM, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ ...request, jsonrpc: "2.0" }),
        });
        const reply = (await response.json()) as { result?: unknown; error?: { code: number; message: string } };
        const busy =
          response.status === 429 || response.status >= 500 || /limit|too many/i.test(reply.error?.message ?? "");
        if (!busy) return (fetched++, reply);
      } catch {
        // A network error: asked again.
      }
      if (Date.now() - start > 300_000) throw new Error(`${UPSTREAM} did not answer ${request.method}.`);
      await new Promise((done) => setTimeout(done, Math.min(30_000, 250 * 2 ** attempt * (1 + Math.random()))));
    }
  } finally {
    running--;
    waiting.shift()?.();
  }
}

async function answer(request: Request): Promise<unknown> {
  if (LOCAL.includes(request.method)) return { jsonrpc: "2.0", id: request.id, result: null };
  const path = `${DIR}/${createHash("sha256")
    .update(JSON.stringify([request.method, request.params]))
    .digest("hex")}.json.gz`;
  if (existsSync(path))
    return { jsonrpc: "2.0", id: request.id, result: JSON.parse(gunzipSync(readFileSync(path)).toString()) };
  const reply = (await upstream(request)) as { result?: unknown };
  // Errors and nulls, as of what Base has not seen yet, are asked again next time.
  if (reply.result !== undefined && reply.result !== null) {
    const temporary = `${path}.${Math.random()}`;
    writeFileSync(temporary, gzipSync(JSON.stringify(reply.result)));
    renameSync(temporary, path);
  }
  return { ...reply, jsonrpc: "2.0", id: request.id };
}

export async function serveCache(): Promise<{ url: string; close(): void }> {
  mkdirSync(DIR, { recursive: true });
  const server = createServer(async (incoming, response) => {
    let body = "";
    for await (const chunk of incoming) body += chunk;
    const parsed = JSON.parse(body) as Request | Request[];
    const replies = Array.isArray(parsed) ? await Promise.all(parsed.map(answer)) : await answer(parsed);
    response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(replies));
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const { port } = server.address() as { port: number };
  return { url: `http://127.0.0.1:${port}`, close: () => server.close() };
}
