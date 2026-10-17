import * as esbuild from "esbuild";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
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

function integrity(file: string): string {
  const digest = createHash("sha384")
    .update(readFileSync(`${OUT}/${file}`))
    .digest("base64");
  return `sha384-${digest}`;
}

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT);
await esbuild.build({
  absWorkingDir: ROOT,
  entryPoints: { main: "src/main.ts", style: "style.css" },
  outdir: OUT,
  bundle: true,
  format: "esm",
  target: "es2022",
  minify: true,
  charset: "utf8",
  loader: { ".woff2": "dataurl" },
  legalComments: "linked",
  logLevel: "warning",
});
for (const file of ["icon.svg", "favicon.ico", "apple-touch-icon.png", "klima-protocol.svg", "manifest.json"])
  copyFileSync(`${ROOT}/${file}`, `${OUT}/${file}`);
const values: Record<string, string> = {
  VERSION: version,
  COMMIT: commit().slice(0, 7),
  MAIN_INTEGRITY: integrity("main.js"),
  STYLE_INTEGRITY: integrity("style.css"),
};
const html = readFileSync(`${ROOT}/index.html`, "utf8").replace(/%([A-Z_]+)%/g, (_, key: string) => {
  if (!(key in values)) throw new Error(`index.html has no value for %${key}%.`);
  return values[key]!;
});
writeFileSync(`${OUT}/index.html`, html);
