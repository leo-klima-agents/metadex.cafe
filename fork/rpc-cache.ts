import { createServer, type Server } from "node:http";
import { closeSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";

// What anvil forks from: a JSON-RPC server that asks the upstream RPC once for each answer about a fixed block, and keeps
// it. anvil reads Base's state one slot at a time, and reads it again after each test's snapshot is reverted: most of
// its requests repeat one it made before. The answers go to `file` once anvil stops, so that the next run starts with
// them. Requests about the newest block, such as "latest", go to the upstream each time.
//
// The caches of a run, one per fork, ask the upstream through one queue: see upstreamOf.
//
// anvil asks for what a call reads one slot at a time, as it runs it. `prefetch`, or a request posted to /prefetch, as
// the tests post each one they send anvil, has it asked for all at once instead, before anvil gets to it: the upstream
// says which accounts and slots the call reads at the fork's block, through eth_createAccessList, and each is asked of
// it behind anvil's own requests. What a call reads only on the fork, as after a test's own transactions, anvil still
// asks for itself.
//
// anvil names the fork's block by its number in some requests, and by its hash in others (EIP-1898): both are asked,
// and kept, as the number.

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
// A method the upstream does not serve, as some RPCs refuse eth_getAccountInfo, which anvil then asks for in three
// requests.
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

// Over the upstream's limit, or out of its reach: asked again, after at least `retryAfter` milliseconds.
class Busy extends Error {
  refused: Refused;
  retryAfter: number;
  constructor(refused: Refused, retryAfter = 0) {
    super(refused.message);
    this.refused = refused;
    this.retryAfter = retryAfter;
  }
}

export type Upstream = {
  // Asks the upstream in turn. With `wanted`, the request is the prefetch's: it waits behind anvil's, and is dropped,
  // answered with undefined, if `wanted` says no once its turn comes.
  ask(call: Call, wanted?: () => boolean): Promise<Reply | undefined>;
  serves(method: string): boolean;
  // Requests sent to the upstream, and how many of them it answered over its limit.
  fetched: number;
  busy: number;
};
type UpstreamOptions = { inFlight?: number; retries?: number; backoff?: number; maxBackoff?: number };

export type Cache = {
  url: string;
  // Requests from anvil.
  asked: number;
  // The JSON-RPC request, or batch, about to go to anvil: what its calls read is fetched, without holding it up.
  prefetch(body: string): Promise<void>;
  close(): Promise<void>;
};
type Tx = { from?: string; to?: string; data?: string; input?: string; value?: string; gas?: string };
type AccessList = { address: string; storageKeys: string[] }[];

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

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

// The upstream RPC, through one queue for all the caches of a run: at most `inFlight` requests at once, anvil's first,
// then the prefetch's. One it answers over its limit, or that does not reach it, is asked again after an exponential
// backoff with full jitter, a wait drawn up to `backoff` doubled at each try and at most `maxBackoff`, or longer if its
// Retry-After says so. After `retries` tries, anvil gets the refusal as it came. A method it does not serve is not
// asked of it again.
export function upstreamOf(
  url: string,
  { inFlight = 8, retries = 8, backoff = 250, maxBackoff = 10_000 }: UpstreamOptions = {},
): Upstream {
  const waiting: [(() => void)[], (() => void)[]] = [[], []];
  const unserved = new Map<string, Refused | Reply>();
  let free = inFlight;
  let fetched = 0;
  let busy = 0;

  const take = async (later: boolean): Promise<void> => {
    if (free) free--;
    else await new Promise<void>((resolve) => waiting[later ? 1 : 0].push(resolve));
  };
  const give = (): void => {
    const next = waiting[0].shift() ?? waiting[1].shift();
    if (next) next();
    else free++;
  };

  async function once(call: Call): Promise<Reply> {
    const before = unserved.get(call.method);
    if (before instanceof Refused) throw before;
    if (before) return before;
    fetched++;
    let response: Response;
    let body: string;
    try {
      response = await upstreamFetch(url, {
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
    const isBusy =
      response.status === 429 || response.status >= 500 || BUSY_CODES.includes(code ?? 0) || BUSY.test(message);
    const retryAfter = 1_000 * (Number(response.headers.get("retry-after")) || 0);
    if (!response.ok || !reply || !("result" in reply || "error" in reply)) {
      const refused = new Refused(response.status === 200 ? 503 : response.status, body);
      if (refusesMethod) unserved.set(call.method, refused);
      throw isBusy ? new Busy(refused, retryAfter) : refused;
    }
    if (isBusy) throw new Busy(new Refused(429, body), retryAfter);
    if (refusesMethod) unserved.set(call.method, reply);
    return reply;
  }

  return {
    async ask(call, wanted) {
      for (let attempt = 0; ; attempt++) {
        await take(!!wanted);
        let wait = 0;
        try {
          if (wanted && !wanted()) return undefined;
          return await once(call);
        } catch (error) {
          if (!(error instanceof Busy) || attempt === retries) throw error instanceof Busy ? error.refused : error;
          busy++;
          wait = Math.max(error.retryAfter, Math.random() * Math.min(maxBackoff, backoff * 2 ** attempt));
        } finally {
          give();
        }
        await sleep(wait);
      }
    },
    serves: (method) => !unserved.has(method),
    get fetched() {
      return fetched;
    },
    get busy() {
      return busy;
    },
  };
}

// A cache of the answers about `block`, the fork's, kept in `file`.
export async function serveCached(upstream: Upstream, file: string, block?: number): Promise<Cache> {
  const answers = new Map<string, unknown>(Object.entries(read(file)));
  const pending = new Map<string, { reply: Promise<Reply | undefined>; later: boolean }>();
  const known = answers.size;
  const prefetching = new Set<Promise<void>>();
  let closing = false;
  let asked = 0;
  const at = block === undefined ? undefined : `0x${block.toString(16)}`;

  async function answer(call: Call): Promise<Reply> {
    asked++;
    return answerOf(byNumber(call));
  }

  async function answerOf(call: Call, later = false): Promise<Reply> {
    const key = keyOf(call);
    const cacheable = fixed(call);
    const kept = (): Reply => ({ jsonrpc: "2.0", id: call.id, result: answers.get(key) });
    if (cacheable && answers.has(key)) return kept();
    // Requests in flight for the same answer share the upstream's one, but anvil's does not wait for the prefetch's turn.
    const shared = cacheable ? pending.get(key) : undefined;
    let reply = shared && (later || !shared.later) ? shared.reply : undefined;
    if (!reply) {
      reply = upstream.ask(call, later ? () => !closing && !answers.has(key) : undefined);
      if (cacheable) pending.set(key, { reply, later });
    }
    try {
      const got = await reply;
      // A prefetch dropped as anvil got the answer first, or as the cache closes.
      if (!got) return answers.has(key) ? kept() : { jsonrpc: "2.0", id: call.id, error: { message: "Closing." } };
      const { result, error } = got;
      // null, as for a receipt not found, may change: it is not kept.
      if (cacheable && !error && result !== null) answers.set(key, result);
      return { jsonrpc: "2.0", id: call.id, ...(error ? { error } : { result }) };
    } finally {
      if (pending.get(key)?.reply === reply) pending.delete(key);
    }
  }

  const ask = (method: string, params: unknown[]): Call => ({ jsonrpc: "2.0", id: 0, method, params });

  // The fork's block by its number, where a request names it by the hash that anvil read in the block's own answer.
  function byNumber(call: Call): Call {
    const params = call.params ?? [];
    const named = params.findIndex((param) => typeof (param as { blockHash?: unknown } | null)?.blockHash === "string");
    if (at === undefined || named < 0) return call;
    const { blockHash } = params[named] as { blockHash: string };
    const forked = [false, true].some(
      (full) => (answers.get(keyOf(ask("eth_getBlockByNumber", [at, full]))) as { hash?: string })?.hash === blockHash,
    );
    return forked ? { ...call, params: params.map((param, i) => (i === named ? at : param)) } : call;
  }

  // anvil asks for an account's balance, nonce and code in one request, or in three from an upstream that does not
  // serve it.
  const accountCalls = (address: string, at: string): Call[] =>
    (upstream.serves("eth_getAccountInfo")
      ? ["eth_getAccountInfo"]
      : ["eth_getBalance", "eth_getTransactionCount", "eth_getCode"]
    ).map((method) => ask(method, [address, at]));

  // Asks for the answers not kept yet. A failure is anvil's to meet.
  const fetchAll = (calls: Call[]): Promise<unknown> =>
    Promise.all(calls.filter((call) => !answers.has(keyOf(call))).map((call) => answerOf(call, true).catch(() => {})));

  async function prefetchTx(tx: Tx, at: string): Promise<void> {
    const { from, to, data, input, value, gas } = tx ?? {};
    const call = ask("eth_createAccessList", [{ from, to, data: data ?? input, value, gas }, at]);
    const reply = await answerOf(call, true);
    if (closing) return;
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
    if (at === undefined || closing) return Promise.resolve();
    let calls: Call[];
    try {
      calls = [JSON.parse(body) as Call | Call[]].flat();
    } catch {
      return Promise.resolve();
    }
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

// Another run may have kept answers of its own meanwhile, on the same machine: each adds its own to the file's in turn,
// while it holds a lock beside it. A lock a minute old was left by a run that stopped. The answers are written whole to
// a file of the run's own, then moved over it, so that a run that stops halfway leaves the last one whole.
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
