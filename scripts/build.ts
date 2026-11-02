import * as esbuild from "esbuild";
import { createHash } from "node:crypto";
import { appendFileSync, copyFileSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { bundled, noticeOf, partsOf } from "./notices.ts";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const OUT = `${ROOT}/dist`;
const SITE = `${ROOT}/site`;
const { version } = JSON.parse(readFileSync(`${ROOT}/package.json`, "utf8")) as { version: string };

function integrity(file: string): string {
  const digest = createHash("sha384")
    .update(readFileSync(`${OUT}/${file}`))
    .digest("base64");
  return `sha384-${digest}`;
}

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT);
const { metafile } = await esbuild.build({
  absWorkingDir: ROOT,
  entryPoints: { main: "src/main.ts", style: "site/style.css" },
  outdir: OUT,
  bundle: true,
  format: "esm",
  target: "es2022",
  minify: true,
  charset: "utf8",
  loader: { ".woff2": "dataurl" },
  legalComments: "none",
  metafile: true,
  logLevel: "warning",
});
// Each built file gets its license notices before its integrity hash is taken, so the hash covers them.
for (const file of ["main.js", "style.css"]) {
  const built = readFileSync(`${OUT}/${file}`, "utf8");
  appendFileSync(
    `${OUT}/${file}`,
    `${built.endsWith("\n") ? "" : "\n"}${noticeOf(ROOT, partsOf(ROOT, bundled(metafile, file)))}`,
  );
}
// Only files are copied: the fonts are in the stylesheet as data, so `site/fonts/` is not.
for (const file of readdirSync(SITE, { withFileTypes: true }))
  if (file.isFile() && !["index.html", "style.css"].includes(file.name))
    copyFileSync(`${SITE}/${file.name}`, `${OUT}/${file.name}`);
const values: Record<string, string> = {
  VERSION: version,
  MAIN_INTEGRITY: integrity("main.js"),
  STYLE_INTEGRITY: integrity("style.css"),
};
const html = readFileSync(`${SITE}/index.html`, "utf8").replace(/%([A-Z_]+)%/g, (_, key: string) => {
  if (!(key in values)) throw new Error(`index.html has no value for %${key}%.`);
  return values[key]!;
});
writeFileSync(`${OUT}/index.html`, html);
