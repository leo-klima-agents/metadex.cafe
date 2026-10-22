import { createServer, type Server } from "node:http";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";

// What anvil forks from: a JSON-RPC server that asks the upstream RPC once for each answer about a fixed block, and keeps
// it. anvil reads Base's state one slot at a time, and reads it again after each test's snapshot is reverted: most of
// its requests repeat one it made before. The answers go to `file` once anvil stops, so that the next run starts with
// them. Requests about the newest block, such as "latest", go to the upstream each time.
//
// The page spreads its reads over three RPCs, which the tests all send to anvil, and so to one upstream: requests for
// logs go to it at most `logsPerSecond` a second, as Base's public RPC allows five. One over its limit is asked again
// after a wait that doubles, while the requests for the same answer wait on it.

type Call = { jsonrpc: "2.0"; id: unknown; method: string; params?: unknown[] };
type Reply = { jsonrpc: "2.0"; id: unknown; result?: unknown; error?: unknown };

const MOVING = /"(latest|pending|safe|finalized|earliest)"/;
const MOVING_METHODS = new Set(["eth_blockNumber", "eth_gasPrice", "eth_maxPriorityFeePerGas", "eth_feeHistory"]);
const fixed = ({ method, params = [] }: Call): boolean =>
  !MOVING_METHODS.has(method) && !MOVING.test(JSON.stringify(params));
const keyOf = ({ method, params = [] }: Call): string => `${method} ${JSON.stringify(params)}`;
// The tests replace globalThis.fetch while they warm anvil up, to send the page's reads to it: the upstream is asked
// through the one there was before.
const upstreamFetch = globalThis.fetch;
// A method the upstream does not serve, as Base's public RPC refuses eth_getAccountInfo, which anvil then asks for in
// three requests.
const UNSERVED_STATUS = [401, 403, 405];
const UNSERVED_CODES = [-32601, -32611];

const BUSY_CODES = [429, -32005, -32007, -32011, -32090];
const BUSY = /request limit|rate limit|too many requests/i;

// An answer the upstream gave over its limit after every try, or with a failure, goes back to anvil as it came.
class Refused extends Error {
  status: number;
  body: string;
  constructor(status: number, body: string) {
    super(`The upstream RPC answered ${status}.`);
    this.status = status;
    this.body = body;
  }
}

// Over the upstream's limit: asked again.
class Busy extends Error {
  refused: Refused;
  constructor(refused: Refused) {
    super(refused.message);
    this.refused = refused;
  }
}

export type Cache = { url: string; asked: number; fetched: number; close(): Promise<void> };
type Options = { retries?: number; backoff?: number; logsPerSecond?: number };

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function serveCached(
  upstream: string,
  file: string,
  { retries = 8, backoff = 500, logsPerSecond = 4 }: Options = {},
): Promise<Cache> {
  const answers = new Map<string, unknown>(Object.entries(read(file)));
  const pending = new Map<string, Promise<Reply>>();
  const unserved = new Map<string, Refused | Reply>();
  const known = answers.size;
  let logsStarted: number[] = [];
  let asked = 0;
  let fetched = 0;

  async function paceLogs(): Promise<void> {
    for (;;) {
      const now = Date.now();
      logsStarted = logsStarted.filter((start) => start > now - 1_000);
      if (logsStarted.length < logsPerSecond) return void logsStarted.push(now);
      await sleep(logsStarted[0]! + 1_000 - now);
    }
  }

  async function fetchOne(call: Call): Promise<Reply> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await fetchOnce(call);
      } catch (error) {
        if (!(error instanceof Busy) || attempt === retries) throw error instanceof Busy ? error.refused : error;
        await sleep(Math.min(backoff * 2 ** attempt, 10_000) * (0.5 + Math.random()));
      }
    }
  }

  async function fetchOnce(call: Call): Promise<Reply> {
    const before = unserved.get(call.method);
    if (before instanceof Refused) throw before;
    if (before) return before;
    if (call.method === "eth_getLogs") await paceLogs();
    fetched++;
    let response: Response;
    let body: string;
    try {
      response = await upstreamFetch(upstream, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...call, id: 1 }),
      });
      body = await response.text();
    } catch (error) {
      // Out of reach for now, as when the connection drops.
      throw new Busy(new Refused(502, JSON.stringify({ jsonrpc: "2.0", id: null, error: { message: String(error) } })));
    }
    let reply: Reply | undefined;
    try {
      reply = JSON.parse(body) as Reply;
    } catch {}
    // With FORK_LOG set, each request asked of the upstream, and how it answered.
    if (process.env.FORK_LOG)
      console.error(`${response.status} ${call.method} ${JSON.stringify(call.params)} ${body.slice(0, 160)}`);
    const { code, message = "" } = (reply?.error ?? {}) as { code?: number; message?: string };
    const refusesMethod = UNSERVED_STATUS.includes(response.status) || UNSERVED_CODES.includes(code ?? 0);
    const busy =
      response.status === 429 || response.status >= 500 || BUSY_CODES.includes(code ?? 0) || BUSY.test(message);
    if (!response.ok || !reply || !("result" in reply || "error" in reply)) {
      const refused = new Refused(response.status === 200 ? 503 : response.status, body);
      if (refusesMethod) unserved.set(call.method, refused);
      throw busy ? new Busy(refused) : refused;
    }
    if (busy) throw new Busy(new Refused(429, body));
    if (refusesMethod) unserved.set(call.method, reply);
    return reply;
  }

  async function answer(call: Call): Promise<Reply> {
    asked++;
    const key = keyOf(call);
    const cacheable = fixed(call);
    if (cacheable && answers.has(key)) return { jsonrpc: "2.0", id: call.id, result: answers.get(key) };
    // Requests in flight for the same answer share the upstream's one.
    let reply = cacheable ? pending.get(key) : undefined;
    if (!reply) {
      reply = fetchOne(call);
      if (cacheable) pending.set(key, reply);
    }
    try {
      const { result, error } = await reply;
      // null, as for a receipt not found, may change: it is not kept.
      if (cacheable && !error && result !== null) answers.set(key, result);
      return { jsonrpc: "2.0", id: call.id, ...(error ? { error } : { result }) };
    } finally {
      pending.delete(key);
    }
  }

  const server: Server = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk: Buffer) => (body += chunk));
    request.on("end", async () => {
      try {
        const calls = JSON.parse(body) as Call | Call[];
        const replies = await Promise.all((Array.isArray(calls) ? calls : [calls]).map(answer));
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify(Array.isArray(calls) ? replies : replies[0]));
      } catch (error) {
        const refused = error instanceof Refused;
        response.writeHead(refused ? error.status : 502, { "content-type": "application/json" });
        response.end(
          refused ? error.body : JSON.stringify({ jsonrpc: "2.0", id: null, error: { message: String(error) } }),
        );
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as { port: number };
  return {
    url: `http://127.0.0.1:${port}`,
    get asked() {
      return asked;
    },
    get fetched() {
      return fetched;
    },
    async close() {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
      // Another run may have kept answers of its own meanwhile: both are kept.
      if (answers.size > known) write(file, { ...read(file), ...Object.fromEntries(answers) });
    },
  };
}

function read(file: string): Record<string, unknown> {
  try {
    return JSON.parse(gunzipSync(readFileSync(file)).toString()) as Record<string, unknown>;
  } catch {
    return {};
  }
}

// Written whole to a file beside it, then moved over it, so that a run that stops halfway leaves the last one whole.
function write(file: string, answers: Record<string, unknown>): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(`${file}.new`, gzipSync(JSON.stringify(answers)));
  renameSync(`${file}.new`, file);
}
