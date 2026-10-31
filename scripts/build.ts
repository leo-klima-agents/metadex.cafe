import * as esbuild from "esbuild";
import { createHash } from "node:crypto";
import { appendFileSync, copyFileSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";

process.chdir(new URL("..", import.meta.url).pathname);
const read = (path: string) => readFileSync(path, "utf8");
const { version } = JSON.parse(read("package.json")) as { version: string };

rmSync("dist", { recursive: true, force: true });
const { metafile } = await esbuild.build({
  entryPoints: { main: "src/main.ts", style: "style.css" },
  outdir: "dist",
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

// Each bundled npm package's LICENSE, and the fonts', travel at the end of the file that bundles them.
const packages = Object.entries(metafile.outputs["dist/main.js"]!.inputs)
  .filter(([, { bytesInOutput }]) => bytesInOutput > 0)
  .flatMap(([path]) => /^(.*node_modules\/(?:@[^/]+\/)?[^/]+)\//.exec(path)?.[1] ?? []);
const licenseOf = (dir: string): string => {
  const { name, version } = JSON.parse(read(`${dir}/package.json`)) as { name: string; version: string };
  const file = readdirSync(dir).find((each) => /^licen[cs]e/i.test(each));
  if (!file) throw new Error(`${name} ships no LICENSE.`);
  return `${name}@${version}:\n\n${read(`${dir}/${file}`).trim()}`;
};
const notices = {
  "main.js": [...new Set(packages)].sort().map(licenseOf),
  "style.css": [
    `Atkinson Hyperlegible Next, Atkinson Hyperlegible Mono and Young Serif:\n\n${read("fonts/OFL.txt").trim()}`,
  ],
};
for (const [file, texts] of Object.entries(notices)) {
  const comment = `/*! Bundled license information:\n\n${texts.join("\n\n")}\n*/\n`;
  if (comment.slice(2, -3).includes("*/")) throw new Error(`A notice would end ${file}'s comment early.`);
  appendFileSync(`dist/${file}`, `\n${comment}`);
}

for (const file of ["icon.svg", "favicon.ico", "apple-touch-icon.png", "klima-protocol.svg", "manifest.json"])
  copyFileSync(file, `dist/${file}`);
const integrity = (file: string) =>
  `sha384-${createHash("sha384")
    .update(readFileSync(`dist/${file}`))
    .digest("base64")}`;
const values: Record<string, string> = {
  VERSION: version,
  MAIN_INTEGRITY: integrity("main.js"),
  STYLE_INTEGRITY: integrity("style.css"),
};
writeFileSync(
  "dist/index.html",
  read("index.html").replace(/%([A-Z_]+)%/g, (_, key: string) => {
    if (!(key in values)) throw new Error(`index.html has no value for %${key}%.`);
    return values[key]!;
  }),
);
