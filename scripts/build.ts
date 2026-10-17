import * as esbuild from "esbuild";
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const OUT = `${ROOT}/dist`;
const { version } = JSON.parse(readFileSync(`${ROOT}/package.json`, "utf8")) as { version: string };

function commit(): string {
  try {
    return process.env.COMMIT || execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

const bundle = (name: string, plugins: esbuild.Plugin[] = []) =>
  esbuild.build({
    absWorkingDir: ROOT,
    entryPoints: [`src/${name}.ts`],
    outfile: `${OUT}/${name}.js`,
    plugins,
    bundle: true,
    format: "esm",
    target: "es2022",
    minify: true,
    charset: "utf8",
    legalComments: "linked",
    logLevel: "warning",
  });

// Safe's SDK is bundled on its own, with the parts of viem it uses, as only Safe{Wallet} loads it. esbuild's splitting
// would put those parts in a chunk that every visitor loads.
const external: esbuild.Plugin = {
  name: "safe",
  setup: (build) => build.onResolve({ filter: /^\.\/safe\.ts$/ }, () => ({ path: "./safe.js", external: true })),
};

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT);
await bundle("main", [external]);
await bundle("safe");
const html = readFileSync(`${ROOT}/index.html`, "utf8");
writeFileSync(`${OUT}/index.html`, html.replace("%VERSION%", version).replace("%COMMIT%", commit().slice(0, 7)));
for (const file of ["manifest.json", "icon.svg", "style.css"]) copyFileSync(`${ROOT}/${file}`, `${OUT}/${file}`);
