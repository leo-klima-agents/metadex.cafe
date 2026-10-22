import { spawn } from "node:child_process";
import { BLOCK, RECENT, serveFork } from "./harness.ts";

// Runs the browser test files at once, each with an anvil of its own, all forking through one cache per block: so
// FORK_URL is asked for each answer once, however many files read it, and within its limits. The arguments go to
// node --test, and name the files to run, all of them by default; an option takes its value after "=".
const FILES = ["fork/views.ts", "fork/joins.ts", "fork/automaxi.ts", "fork/swap.ts", "fork/claim.ts"];
const args = process.argv.slice(2);
const named = args.some((arg) => !arg.startsWith("-"));
const caches = await Promise.all([BLOCK, RECENT].map(async (block) => ({ block, cache: await serveFork(block) })));
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
  console.log(
    `At block ${block}: ${cache.asked} requests from anvil; ${cache.fetched} asked of FORK_URL, ${cache.busy} of them over its limit.`,
  );
}
process.exit(code);
