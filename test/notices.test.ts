import * as esbuild from "esbuild";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { bundled, noticeOf, packagePart, partsOf } from "../scripts/notices.ts";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

// Bundles what `scripts/build.ts` bundles, with the same options, without writing it to disk.
const { metafile } = await esbuild.build({
  absWorkingDir: ROOT,
  entryPoints: { main: "src/main.ts", style: "site/style.css" },
  outdir: `${ROOT}/dist-notices`,
  write: false,
  bundle: true,
  format: "esm",
  target: "es2022",
  minify: true,
  loader: { ".woff2": "dataurl" },
  metafile: true,
  logLevel: "error",
});
const withoutVersion = (name: string) => name.replace(/@[^@]+$/, "");

test("the script's notices name each npm package it bundles, by its LICENSE, under the MIT License", () => {
  const parts = partsOf(ROOT, bundled(metafile, "main.js"));
  assert.deepEqual(parts.map(({ name }) => withoutVersion(name)).sort(), ["@noble/hashes", "abitype", "viem"]);
  for (const { name, copyright, license } of parts) {
    assert.equal(license, "MIT", name);
    assert.ok(copyright.length && copyright.every((line) => line.startsWith("Copyright ")), name);
  }
  assert.ok(!parts.some(({ name }) => name.startsWith("src/")));
  // A package without a LICENSE holding a copyright line stops the build, whatever its package.json says.
  const elsewhere = mkdtempSync(join(tmpdir(), "notices-"));
  mkdirSync(join(elsewhere, "node_modules/unknown"), { recursive: true });
  writeFileSync(
    join(elsewhere, "node_modules/unknown/package.json"),
    JSON.stringify({ name: "unknown", version: "1.0.0", license: "MIT", author: "Someone" }),
  );
  assert.throws(() => packagePart(elsewhere, "node_modules/unknown"), /unknown@1\.0\.0 ships no LICENSE/);
});

test("the stylesheet's notices name each font it embeds, by REUSE.toml, under the OFL", () => {
  const parts = partsOf(ROOT, bundled(metafile, "style.css"));
  assert.deepEqual(parts.map(({ name }) => name).sort(), [
    "site/fonts/atkinson-hyperlegible-mono-400.woff2",
    "site/fonts/atkinson-hyperlegible-mono-600.woff2",
    "site/fonts/atkinson-hyperlegible-next-400.woff2",
    "site/fonts/atkinson-hyperlegible-next-700.woff2",
    "site/fonts/young-serif-400.woff2",
  ]);
  for (const { name, license } of parts) assert.equal(license, "OFL-1.1", name);
});

test("a notice is one comment: each license's parts by name, then its text verbatim from LICENSES", () => {
  const notice = noticeOf(ROOT, [
    { name: "b@2.0.0", copyright: ["Copyright (c) 2024 B"], license: "MIT" },
    { name: "a@1.0.0", copyright: ["Copyright (c) 2023 A"], license: "MIT" },
  ]);
  assert.equal(
    notice,
    "/*! Bundled license information:\n\n" +
      "a@1.0.0:\n  Copyright (c) 2023 A\nb@2.0.0:\n  Copyright (c) 2024 B\n\n" +
      `Each under the MIT License:\n\n${readFileSync(`${ROOT}/LICENSES/MIT.txt`, "utf8")}*/\n`,
  );
  // The build has no name or text for Apache-2.0, so a part under it stops the build.
  assert.throws(
    () => noticeOf(ROOT, [{ name: "c@1.0.0", copyright: ["Copyright C"], license: "Apache-2.0" }]),
    /c@1\.0\.0 is under Apache-2\.0/,
  );
  assert.equal(noticeOf(ROOT, []), "");
});
