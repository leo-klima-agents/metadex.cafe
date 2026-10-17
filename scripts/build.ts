import * as esbuild from "esbuild";
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const OUT = `${ROOT}/dist`;

/** The commit being built: $COMMIT, else git's HEAD. */
function commit(): string {
  if (process.env.COMMIT) return process.env.COMMIT;
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

const { version } = JSON.parse(readFileSync(`${ROOT}/package.json`, "utf8")) as { version: string };
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT);
const common: esbuild.BuildOptions = {
  absWorkingDir: ROOT,
  bundle: true,
  format: "esm",
  target: "es2022",
  minify: true,
  charset: "utf8",
  legalComments: "linked",
  logLevel: "warning",
};
// Safe's SDK is bundled on its own, with the parts of viem it uses, and loaded only when the page runs in Safe{Wallet}.
// Splitting would put those parts in a chunk that every visitor loads.
const safe: esbuild.Plugin = {
  name: "safe",
  setup: (build) => build.onResolve({ filter: /^\.\/safe\.ts$/ }, () => ({ path: "./safe.js", external: true })),
};
await esbuild.build({ ...common, entryPoints: ["src/main.ts"], outfile: `${OUT}/main.js`, plugins: [safe] });
await esbuild.build({ ...common, entryPoints: ["src/safe.ts"], outfile: `${OUT}/safe.js` });
const html = readFileSync(`${ROOT}/index.html`, "utf8");
writeFileSync(`${OUT}/index.html`, html.replace("%VERSION%", version).replace("%COMMIT%", commit().slice(0, 7)));
for (const file of ["manifest.json", "icon.svg", "style.css"]) copyFileSync(`${ROOT}/${file}`, `${OUT}/${file}`);
