import { spawn } from "node:child_process";
import { RPCS } from "../src/config.ts";
import { BLOCK, RECENT } from "./harness.ts";
import { cacheFileOf, forkUrl, serveCached, upstreamOf } from "./rpc-cache.ts";

// Runs the browser test files at once, each with an anvil of its own, all forking through one cache per block, and all
// the caches through one queue to FORK_URL: so it is asked for each answer once, however many files read it, and at
// most so many at a time. The arguments go to node --test, and name the files to run, all of them by default; an
// option takes its value after "=".
//
// FORK_URL is the archive RPC that BASE_RPC_URL names, or else the page's own first RPC. Its answers are kept between
// runs in FORK_CACHE: see rpc-cache.ts.
const FORK_URL = forkUrl(RPCS[0]!);
const FILES = ["fork/views.ts", "fork/joins.ts", "fork/double-espresso.ts", "fork/swap.ts", "fork/claim.ts"];
const args = process.argv.slice(2);
const named = args.some((arg) => !arg.startsWith("-"));
const upstream = upstreamOf(FORK_URL);
const caches = await Promise.all(
  [BLOCK, RECENT].map(async (block) => ({
    block,
    cache: await serveCached(upstream, cacheFileOf(block), block),
  })),
);
const child = spawn(
  process.execPath,
  ["--test", `--test-concurrency=${FILES.length}`, ...args, ...(named ? [] : FILES)],
  {
    stdio: "inherit",
    env: {
      ...process.env,
      FORK_CACHES: JSON.stringify(Object.fromEntries(caches.map(({ block, cache }) => [block, cache.url]))),
    },
  },
);
// Stopped, as by Ctrl-C, the tests stop, and the answers found so far are still kept.
for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => child.kill(signal));
const code = await new Promise<number>((resolve) => child.on("exit", (code) => resolve(code ?? 1)));
for (const { block, cache } of caches) {
  await cache.close();
  console.log(`At block ${block}: ${cache.asked} requests from anvil.`);
}
console.log(`${upstream.fetched} requests asked of FORK_URL, ${upstream.busy} of them over its limit.`);
process.exit(code);
