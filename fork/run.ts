import { spawn } from "node:child_process";
import { RPCS } from "../src/config.ts";
import { BLOCK } from "./harness.ts";
import { SCENARIOS } from "../qa/scenarios.ts";
import { cacheFileOf, forkUrl, pruneCaches, serveCached, upstreamOf } from "./rpc-cache.ts";

// Runs the browser test files in parallel, each with its own anvil. They all fork `BLOCK` through one cache and one
// queue to `BASE_RPC_URL`, or else to the page's first RPC (see rpc-cache.ts). Arguments are passed to `node --test`:
// files to run (all of them by default), or options.
const FILES = ["fork/views.ts", "fork/joins.ts", "fork/payouts.ts", "fork/swap.ts", "fork/aero.ts"];
const args = process.argv.slice(2);
const named = args.some((arg) => !arg.startsWith("-"));
const upstream = upstreamOf(forkUrl(RPCS[0]!));
// The caches of blocks that neither these tests nor the QA scenarios fork any more are deleted first.
for (const file of pruneCaches([BLOCK, ...SCENARIOS.map(({ block }) => block)])) console.log(`Deleted ${file}.`);
const caches = [{ block: BLOCK, cache: await serveCached(upstream, cacheFileOf(BLOCK), BLOCK) }];
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
