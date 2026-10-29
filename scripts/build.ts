import * as esbuild from "esbuild";
import { createHash } from "node:crypto";
import { appendFileSync, copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { bundled, noticeOf, partsOf } from "./notices.ts";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const OUT = `${ROOT}/dist`;
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
  entryPoints: { main: "src/main.ts", style: "style.css" },
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
// Each built file ends with the license notices of what it bundles, before its integrity is taken.
for (const file of ["main.js", "style.css"]) {
  const built = readFileSync(`${OUT}/${file}`, "utf8");
  appendFileSync(
    `${OUT}/${file}`,
    `${built.endsWith("\n") ? "" : "\n"}${noticeOf(ROOT, partsOf(ROOT, bundled(metafile, file)))}`,
  );
}
for (const file of ["icon.svg", "favicon.ico", "apple-touch-icon.png", "klima-protocol.svg", "manifest.json"])
  copyFileSync(`${ROOT}/${file}`, `${OUT}/${file}`);
const values: Record<string, string> = {
  VERSION: version,
  MAIN_INTEGRITY: integrity("main.js"),
  STYLE_INTEGRITY: integrity("style.css"),
};
const html = readFileSync(`${ROOT}/index.html`, "utf8").replace(/%([A-Z_]+)%/g, (_, key: string) => {
  if (!(key in values)) throw new Error(`index.html has no value for %${key}%.`);
  return values[key]!;
});
writeFileSync(`${OUT}/index.html`, html);
