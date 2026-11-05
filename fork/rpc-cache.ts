import { createServer } from "node:http";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";

// The JSON-RPC server anvil forks from. It asks the upstream once for each answer about the fork's block, and keeps the
// answers in a file per block for later runs. Answers that may change, such as the newest block or a receipt not found,
// are kept for this run only.
export const forkUrl = (fallback: string): string => process.env.BASE_RPC_URL || fallback;
const FORK_CACHE = process.env.FORK_CACHE || join(homedir(), ".cache", "metadex.cafe", "fork");
export const cacheFileOf = (block: number): string => join(FORK_CACHE, `base-${block}.json.gz`);

type Call = { jsonrpc: "2.0"; id: unknown; method: string; params?: unknown[] };
type Reply = { jsonrpc: "2.0"; id: unknown; result?: unknown; error?: unknown };
type Tx = { from?: string; to?: string; data?: string; input?: string; value?: string; gas?: string };
type Upstream = {
  ask(call: Call, later?: () => boolean): Promise<Reply | undefined>;
  serves(method: string): boolean;
};
export type Cache = { url: string; close(): Promise<void> };

const MOVING = /"(latest|pending|safe|finalized|earliest)"/;
const MOVING_METHODS = new Set(["eth_blockNumber", "eth_gasPrice", "eth_maxPriorityFeePerGas", "eth_feeHistory"]);
const BY_HASH = new Set(["eth_getTransactionReceipt", "eth_getTransactionByHash"]);
const UNSERVED_STATUS = [401, 403, 405];
const UNSERVED_CODES = [-32601, -32611];
const BUSY_CODES = [429, -32005, -32007, -32011, -32090];
const BUSY = /request limit|rate limit|too many requests/i;
const fixed = ({ method, params = [] }: Call) => !MOVING_METHODS.has(method) && !MOVING.test(JSON.stringify(params));
const keyOf = ({ method, params = [] }: Call) => `${method} ${JSON.stringify(params)}`;
const ask = (method: string, params: unknown[]): Call => ({ jsonrpc: "2.0", id: 0, method, params });
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const upstreamFetch = globalThis.fetch;

// An upstream refusal, passed on to anvil with its body as it came, and its status, or 429 or 503 if it came as 200.
// `again` means the upstream was busy or out of reach, so the request may be retried.
class Refused extends Error {
  status: number;
  body: string;
  again: boolean;
  after: number;
  constructor(status: number, body: string, again = false, after = 0) {
    super(`The upstream RPC answered ${status}.`);
    this.status = status;
    this.body = body;
    this.again = again;
    this.after = after;
  }
}
const failure = (error: unknown) => JSON.stringify({ jsonrpc: "2.0", id: null, error: { message: String(error) } });

function txsIn(body: string): Tx[] {
  try {
    return [JSON.parse(body) as Call | Call[]].flat().flatMap(({ method, params = [] }): Tx[] => {
      if (["eth_call", "eth_estimateGas", "eth_createAccessList", "eth_sendTransaction"].includes(method))
        return [params[0] as Tx];
      if (method !== "eth_simulateV1") return [];
      return ((params[0] as { blockStateCalls?: { calls?: Tx[] }[] })?.blockStateCalls ?? []).flatMap(
        (b) => b.calls ?? [],
      );
    });
  } catch {
    return [];
  }
}
export const runsCalls = (body: string): boolean => txsIn(body).length > 0;

// One queue to the upstream for all of a run's caches: at most `inFlight` requests at once, with anvil's ahead of
// prefetches. A request that is rate-limited or does not reach the upstream is retried for up to five minutes, after
// its Retry-After or a jittered exponential backoff, whichever is longer. A method the upstream does not serve is not
// asked again.
export function upstreamOf(url: string, inFlight = 8): Upstream {
  const waiting: [(() => void)[], (() => void)[]] = [[], []];
  const unserved = new Map<string, Refused | Reply>();
  let free = inFlight;
  const take = (later: boolean): Promise<void> =>
    free-- > 0 ? Promise.resolve() : new Promise((resolve) => (free++, waiting[later ? 1 : 0].push(resolve)));
  const give = (): void => {
    const next = waiting[0].shift() ?? waiting[1].shift();
    if (next) next();
    else free++;
  };

  async function once(call: Call): Promise<Reply> {
    const before = unserved.get(call.method);
    if (before instanceof Refused) throw before;
    if (before) return before;
    let response: Response;
    let body: string;
    try {
      const init = { method: "POST", headers: { "content-type": "application/json" } };
      response = await upstreamFetch(url, { ...init, body: JSON.stringify({ ...call, id: 1 }) });
      body = await response.text();
    } catch (error) {
      throw new Refused(502, failure(error), true);
    }
    let reply: Reply | undefined;
    try {
      reply = JSON.parse(body) as Reply;
    } catch {}
    const { code = 0, message = "" } = (reply?.error ?? {}) as { code?: number; message?: string };
    const busy = response.status === 429 || response.status >= 500 || BUSY_CODES.includes(code) || BUSY.test(message);
    const unservedMethod = !busy && (UNSERVED_STATUS.includes(response.status) || UNSERVED_CODES.includes(code));
    if (busy || !response.ok || !reply || !("result" in reply || "error" in reply)) {
      const after = 1_000 * (Number(response.headers.get("retry-after")) || 0);
      const refused = new Refused(response.ok ? (busy ? 429 : 503) : response.status, body, busy, after);
      if (unservedMethod) unserved.set(call.method, refused);
      throw refused;
    }
    if (unservedMethod) unserved.set(call.method, reply);
    return reply;
  }

  return {
    async ask(call, later) {
      const since = Date.now();
      for (let attempt = 0; ; attempt++) {
        await take(!!later);
        let wait: number;
        try {
          if (later && !later()) return undefined;
          return await once(call);
        } catch (error) {
          if (!(error instanceof Refused && error.again) || Date.now() - since > 300_000) throw error;
          wait = Math.max(error.after, Math.random() * Math.min(10_000, 250 * 2 ** attempt));
        } finally {
          give();
        }
        await sleep(wait);
      }
    },
    serves: (method) => !unserved.has(method),
  };
}

const read = (file: string): Record<string, unknown> => {
  try {
    return JSON.parse(gunzipSync(readFileSync(file)).toString()) as Record<string, unknown>;
  } catch {
    return {};
  }
};

// Serves the answers about `block`, kept in `file`. POST /prefetch with a request anvil is about to run fetches
// everything it reads at once, behind anvil's own requests. POST /sent with a transaction hash marks it as sent on the
// fork, so that the upstream is not asked for it.
export async function serveCached(upstream: Upstream, file: string, block: number): Promise<Cache> {
  const answers = new Map(Object.entries(read(file)));
  const known = answers.size;
  const forRun = new Map<string, unknown>();
  const sent = new Set<string>();
  const pending = new Map<string, { reply: Promise<Reply | undefined>; later: boolean }>();
  const prefetching = new Set<Promise<void>>();
  const at = `0x${block.toString(16)}`;
  let closing = false;

  // anvil names the fork's block by its hash in some requests (EIP-1898). Those are kept and asked by the block's
  // number.
  const byNumber = (call: Call): Call => {
    const params = call.params ?? [];
    const i = params.findIndex((param) => typeof (param as { blockHash?: unknown } | null)?.blockHash === "string");
    if (i < 0) return call;
    const { blockHash } = params[i] as { blockHash: string };
    const forked = [false, true].some(
      (full) => (answers.get(keyOf(ask("eth_getBlockByNumber", [at, full]))) as { hash?: string })?.hash === blockHash,
    );
    return forked ? { ...call, params: params.map((param, j) => (j === i ? at : param)) } : call;
  };

  async function answer(call: Call, later = false): Promise<Reply> {
    const key = keyOf(call);
    const keep = fixed(call);
    const reply = (result: unknown): Reply => ({ jsonrpc: "2.0", id: call.id, result });
    if (keep && answers.has(key)) return reply(answers.get(key));
    if (forRun.has(key)) return reply(forRun.get(key));
    if (BY_HASH.has(call.method) && sent.has(String(call.params?.[0]).toLowerCase())) return reply(null);
    // Requests for the same answer share one upstream request, but anvil's never waits behind a prefetch's.
    const shared = keep ? pending.get(key) : undefined;
    let asked = shared && (later || !shared.later) ? shared.reply : undefined;
    if (!asked) {
      asked = upstream.ask(call, later ? () => !closing && !answers.has(key) : undefined);
      if (keep) pending.set(key, { reply: asked, later });
    }
    try {
      const got = await asked;
      if (!got)
        return answers.has(key) ? reply(answers.get(key)) : { ...reply(undefined), error: { message: "Closed." } };
      if (got.error) return { jsonrpc: "2.0", id: call.id, error: got.error };
      (keep && got.result !== null ? answers : forRun).set(key, got.result);
      return reply(got.result);
    } finally {
      if (pending.get(key)?.reply === asked) pending.delete(key);
    }
  }

  // anvil reads an account with `eth_getAccountInfo`, or with three requests when the upstream does not serve it.
  const accountCalls = (address: string): Call[] =>
    (upstream.serves("eth_getAccountInfo")
      ? ["eth_getAccountInfo"]
      : ["eth_getBalance", "eth_getTransactionCount", "eth_getCode"]
    ).map((method) => ask(method, [address, at]));
  const fetchAll = (calls: Call[]) =>
    Promise.all(calls.filter((call) => !answers.has(keyOf(call))).map((call) => answer(call, true).catch(() => {})));

  async function prefetchTx({ from, to, data, input, value, gas }: Tx): Promise<void> {
    const call = ask("eth_createAccessList", [{ from, to, data: data ?? input, value, gas }, at]);
    const { result, error } = await answer(call, true);
    if (closing) return;
    // A call the upstream cannot trace, such as one to a contract deployed on the fork, is kept with an empty access
    // list, so that it is not asked again.
    if (error) answers.set(keyOf(call), { accessList: [] });
    const list =
      (result as { accessList?: { address: string; storageKeys: string[] }[] } | undefined)?.accessList ?? [];
    const accounts = [
      ...new Set([from, to, ...list.map((each) => each.address)].flatMap((a) => a?.toLowerCase() ?? [])),
    ];
    // The first account is fetched alone: its answer tells whether the upstream serves `eth_getAccountInfo`.
    if (accounts[0]) await fetchAll(accountCalls(accounts[0]));
    await fetchAll([
      ...accounts.flatMap(accountCalls),
      ...list.flatMap(({ address, storageKeys }) =>
        storageKeys.map((key) => ask("eth_getStorageAt", [address.toLowerCase(), `0x${BigInt(key).toString(16)}`, at])),
      ),
    ]);
  }

  function prefetch(body: string): void {
    const txs = txsIn(body);
    if (closing || !txs.length) return;
    const running: Promise<void> = Promise.all(txs.map((tx) => prefetchTx(tx)))
      .then(() => {})
      .catch(() => {})
      .finally(() => prefetching.delete(running));
    prefetching.add(running);
  }

  const server = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk: Buffer) => (body += chunk));
    request.on("end", async () => {
      if (request.url === "/prefetch") return void (response.writeHead(202).end(), prefetch(body));
      if (request.url === "/sent") return void (sent.add(body.trim().toLowerCase()), response.writeHead(204).end());
      try {
        const calls = JSON.parse(body) as Call | Call[];
        const replies = await Promise.all([calls].flat().map((call) => answer(byNumber(call))));
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify(Array.isArray(calls) ? replies : replies[0]));
      } catch (error) {
        const refused = error instanceof Refused ? error : new Refused(502, failure(error));
        response.writeHead(refused.status, { "content-type": "application/json" }).end(refused.body);
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    url: `http://127.0.0.1:${(server.address() as { port: number }).port}`,
    async close() {
      closing = true;
      await Promise.allSettled(prefetching);
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
      if (answers.size === known) return;
      // Merges what other runs kept meanwhile, writes a temporary file, and renames it over the old one.
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(
        `${file}.${process.pid}`,
        gzipSync(JSON.stringify({ ...read(file), ...Object.fromEntries(answers) })),
      );
      renameSync(`${file}.${process.pid}`, file);
    },
  };
}
