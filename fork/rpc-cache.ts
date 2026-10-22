import { createServer, type Server } from "node:http";
import { closeSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";

// What anvil forks from: a JSON-RPC server that asks the upstream RPC once for each answer about a fixed block, and keeps
// it. anvil reads Base's state one slot at a time, and reads it again after each test's snapshot is reverted: most of
// its requests repeat one it made before. The answers go to `file` once anvil stops, so that the next run starts with
// them. Requests about the newest block, such as "latest", go to the upstream each time.
//
// The page spreads its reads over three RPCs, which the tests all send to anvil, and so to one upstream: requests for
// logs go to it at most `logsPerSecond` a second, as Base's public RPC allows five, and all requests at most
// `requestsPerSecond`, or as many as the upstream answers, found as it goes. anvil's go before the prefetch's. One over
// its limit is asked again after a wait that doubles, while the requests for the same answer wait on it.
//
// anvil asks for what a call reads one slot at a time, as it runs it. `prefetch`, or a request posted to /prefetch, as
// the tests post each one they send anvil, has it asked for all at once instead, before anvil gets to it: the upstream
// says which accounts and slots the call reads at the fork's block, through eth_createAccessList, and each is asked of
// it in parallel, as anvil's own requests leave room. What a call reads only on the fork, as after a test's own
// transactions, anvil still asks for itself.

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

export type Cache = {
  url: string;
  asked: number;
  fetched: number;
  // Of those, how many the upstream answered over its limit, to be asked again.
  busy: number;
  // The JSON-RPC request, or batch, about to go to anvil: what its calls read is fetched, without holding it up.
  prefetch(body: string): Promise<void>;
  close(): Promise<void>;
};
type Options = {
  retries?: number;
  backoff?: number;
  logsPerSecond?: number;
  requestsPerSecond?: number;
  // The fork's block, at which `prefetch` reads, and how many of its requests go at once, for all the calls it reads.
  block?: number;
  inFlight?: number;
};
type Tx = { from?: string; to?: string; data?: string; input?: string; value?: string; gas?: string };
type AccessList = { address: string; storageKeys: string[] }[];

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Turns to ask the upstream, at most `perSecond` a second, anvil's first, then the prefetch's (`later`). Without
// `perSecond`, the rate is found as the upstream answers: it falls by a fifth at each answer over the upstream's limit,
// and rises a little at each other.
function turns(perSecond?: number) {
  let rate = perSecond ?? 50;
  const waiting: [(() => void)[], (() => void)[]] = [[], []];
  let next = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const release = () => {
    timer = undefined;
    const now = Date.now();
    if (now < next) return void (timer = setTimeout(release, next - now));
    const go = waiting[0].shift() ?? waiting[1].shift();
    if (!go) return;
    next = now + 1_000 / rate;
    go();
    if (waiting[0].length || waiting[1].length) timer = setTimeout(release, next - now);
  };
  return {
    take: (later: boolean) =>
      new Promise<void>((resolve) => {
        waiting[later ? 1 : 0].push(resolve);
        if (!timer) release();
      }),
    answered(busy: boolean): void {
      if (perSecond === undefined) rate = busy ? Math.max(5, rate * 0.8) : Math.min(500, rate + 0.1);
    },
  };
}

// Waits, if need be, so that at most `perSecond` start in any second.
function paced(perSecond: number): () => Promise<void> {
  let started: number[] = [];
  return async () => {
    for (;;) {
      const now = Date.now();
      started = started.filter((start) => start > now - 1_000);
      if (started.length < perSecond) return void started.push(now);
      await sleep(started[0]! + 1_000 - now);
    }
  };
}

// The transactions a request runs: eth_simulateV1's are each read on their own, though some read what an earlier one
// wrote.
function txsOf({ method, params = [] }: Call): Tx[] {
  if (["eth_call", "eth_estimateGas", "eth_createAccessList", "eth_sendTransaction"].includes(method))
    return [params[0] as Tx];
  if (method === "eth_simulateV1")
    return ((params[0] as { blockStateCalls?: { calls?: Tx[] }[] })?.blockStateCalls ?? []).flatMap(
      ({ calls = [] }) => calls,
    );
  return [];
}

export async function serveCached(
  upstream: string,
  file: string,
  { retries = 8, backoff = 500, logsPerSecond = 4, requestsPerSecond, block, inFlight = 16 }: Options = {},
): Promise<Cache> {
  const answers = new Map<string, unknown>(Object.entries(read(file)));
  const pending = new Map<string, { reply: Promise<Reply>; later: boolean }>();
  const unserved = new Map<string, Refused | Reply>();
  const known = answers.size;
  const paceLogs = paced(logsPerSecond);
  const turn = turns(requestsPerSecond);
  const prefetching = new Set<Promise<void>>();
  const queued: (() => void)[] = [];
  let free = inFlight;
  let closing = false;
  let asked = 0;
  let fetched = 0;
  let busy = 0;

  async function fetchOne(call: Call, later: boolean): Promise<Reply> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await fetchOnce(call, later);
      } catch (error) {
        if (!(error instanceof Busy) || attempt === retries) throw error instanceof Busy ? error.refused : error;
        busy++;
        await sleep(Math.min(backoff * 2 ** attempt, 10_000) * (0.5 + Math.random()));
      }
    }
  }

  async function fetchOnce(call: Call, later: boolean): Promise<Reply> {
    const before = unserved.get(call.method);
    if (before instanceof Refused) throw before;
    if (before) return before;
    if (call.method === "eth_getLogs") await paceLogs();
    await turn.take(later);
    // anvil may have asked for it meanwhile.
    const key = keyOf(call);
    if (later && answers.has(key)) return { jsonrpc: "2.0", id: call.id, result: answers.get(key) };
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
    turn.answered(busy);
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
    return answerOf(call);
  }

  async function answerOf(call: Call, later = false): Promise<Reply> {
    const key = keyOf(call);
    const cacheable = fixed(call);
    if (cacheable && answers.has(key)) return { jsonrpc: "2.0", id: call.id, result: answers.get(key) };
    // Requests in flight for the same answer share the upstream's one, but anvil's does not wait for the prefetch's turn.
    const shared = cacheable ? pending.get(key) : undefined;
    let reply = shared && (later || !shared.later) ? shared.reply : undefined;
    if (!reply) {
      reply = fetchOne(call, later);
      if (cacheable) pending.set(key, { reply, later });
    }
    try {
      const { result, error } = await reply;
      // null, as for a receipt not found, may change: it is not kept.
      if (cacheable && !error && result !== null) answers.set(key, result);
      return { jsonrpc: "2.0", id: call.id, ...(error ? { error } : { result }) };
    } finally {
      if (pending.get(key)?.reply === reply) pending.delete(key);
    }
  }

  const ask = (method: string, params: unknown[]): Call => ({ jsonrpc: "2.0", id: 0, method, params });

  // anvil asks for an account's balance, nonce and code in one request, or in three from an upstream that does not
  // serve it, as Base's public RPC.
  const accountCalls = (address: string, at: string): Call[] =>
    (unserved.has("eth_getAccountInfo")
      ? ["eth_getBalance", "eth_getTransactionCount", "eth_getCode"]
      : ["eth_getAccountInfo"]
    ).map((method) => ask(method, [address, at]));

  // Asks for the answers not kept yet, at most `inFlight` at a time for all the calls prefetched, until the cache closes.
  // anvil may ask for one meanwhile. A failure is anvil's to meet.
  async function fetchAll(calls: Call[]): Promise<void> {
    await Promise.all(
      calls.map(async (call) => {
        if (free) free--;
        else await new Promise<void>((resolve) => queued.push(resolve));
        try {
          if (!closing && !answers.has(keyOf(call))) await answerOf(call, true).catch(() => {});
        } finally {
          const next = queued.shift();
          if (next) next();
          else free++;
        }
      }),
    );
  }

  async function prefetchTx(tx: Tx, at: string): Promise<void> {
    const { from, to, data, input, value, gas } = tx ?? {};
    const call = ask("eth_createAccessList", [{ from, to, data: data ?? input, value, gas }, at]);
    const reply = await answerOf(call, true);
    // A call the upstream cannot trace there, as one to a contract deployed on the fork, reads as nothing, which is
    // kept, so that the next run does not ask again.
    if (reply.error) answers.set(keyOf(call), { accessList: [] });
    const list = ((reply.result as { accessList?: AccessList } | undefined)?.accessList ?? []).map(
      ({ address, storageKeys }) => ({ address: address.toLowerCase(), storageKeys }),
    );
    const accounts = [...new Set([from, to, ...list.map(({ address }) => address)].filter(Boolean))].map((address) =>
      address!.toLowerCase(),
    );
    // The first account's answer says how the upstream serves accounts.
    if (accounts.length) await fetchAll(accountCalls(accounts[0]!, at));
    await fetchAll([
      ...accounts.flatMap((address) => accountCalls(address, at)),
      // As anvil asks for a slot: a number, without leading zeros.
      ...list.flatMap(({ address, storageKeys }) =>
        storageKeys.map((key) => ask("eth_getStorageAt", [address, `0x${BigInt(key).toString(16)}`, at])),
      ),
    ]);
  }

  function prefetch(body: string): Promise<void> {
    if (block === undefined || closing) return Promise.resolve();
    let calls: Call[];
    try {
      calls = [JSON.parse(body) as Call | Call[]].flat();
    } catch {
      return Promise.resolve();
    }
    const at = `0x${block.toString(16)}`;
    const running = Promise.all(calls.flatMap(txsOf).map((tx) => prefetchTx(tx, at)))
      .then(() => {})
      .catch(() => {})
      .finally(() => prefetching.delete(running));
    prefetching.add(running);
    return running;
  }

  const server: Server = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk: Buffer) => (body += chunk));
    request.on("end", async () => {
      // Asked to prefetch: what the request reads is fetched without holding the request up.
      if (request.url === "/prefetch") {
        response.writeHead(202).end();
        return void prefetch(body);
      }
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
    get busy() {
      return busy;
    },
    prefetch,
    async close() {
      closing = true;
      await Promise.allSettled(prefetching);
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
      if (answers.size > known) await keep(file, answers);
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

// Other runs may have kept answers of their own meanwhile, as the test files run at once: each adds its own to the
// file's in turn, while it holds a lock beside it. A lock a minute old was left by a run that stopped. The answers are
// written whole to a file of the run's own, then moved over it, so that a run that stops halfway leaves the last one
// whole.
async function keep(file: string, answers: Map<string, unknown>): Promise<void> {
  mkdirSync(dirname(file), { recursive: true });
  const lock = `${file}.lock`;
  for (;;) {
    try {
      closeSync(openSync(lock, "wx"));
      break;
    } catch (error) {
      if ((error as { code?: string }).code !== "EEXIST") throw error;
      try {
        if (Date.now() - statSync(lock).mtimeMs > 60_000) rmSync(lock, { force: true });
      } catch {}
      await sleep(100);
    }
  }
  try {
    const next = `${file}.${process.pid}.new`;
    writeFileSync(next, gzipSync(JSON.stringify({ ...read(file), ...Object.fromEntries(answers) })));
    renameSync(next, file);
  } finally {
    rmSync(lock, { force: true });
  }
}
