import { spawn } from "node:child_process";
import { RPCS } from "../src/config.ts";
import { BLOCK, UNPAID, UNPAID_SWAPS } from "./harness.ts";
import { cacheFileOf, forkUrl, serveCached, upstreamOf } from "./rpc-cache.ts";

// Runs the browser test files in parallel, each with its own anvil, all forking through one cache per block and one
// queue to BASE_RPC_URL, or else the page's first RPC (see rpc-cache.ts). Arguments go to `node --test`: files to run
// (all by default), or options.
const FILES = ["fork/views.ts", "fork/joins.ts", "fork/payouts.ts", "fork/swap.ts"];
const args = process.argv.slice(2);
const named = args.some((arg) => !arg.startsWith("-"));
const upstream = upstreamOf(forkUrl(RPCS[0]!));
const caches = await Promise.all(
  [BLOCK, UNPAID, UNPAID_SWAPS].map(async (block) => ({
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
// On Ctrl-C, stop the tests but not this process, so that the caches still save the answers so far.
for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => child.kill(signal));
const code = await new Promise<number>((resolve) => child.on("exit", (code) => resolve(code ?? 1)));
for (const { cache } of caches) await cache.close();
process.exit(code);
