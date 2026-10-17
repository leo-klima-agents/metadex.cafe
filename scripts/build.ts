import * as esbuild from "esbuild";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename } from "node:path";
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

async function build(entry: string, options: esbuild.BuildOptions = {}): Promise<string> {
  const { metafile } = await esbuild.build({
    ...options,
    absWorkingDir: ROOT,
    entryPoints: [entry],
    outdir: OUT,
    entryNames: "[name].[hash]",
    metafile: true,
    bundle: true,
    minify: true,
    charset: "utf8",
    legalComments: "linked",
    loader: { ".svg": "copy" },
    logLevel: "warning",
  });
  const [path] = Object.entries(metafile.outputs).find(([, output]) => output.entryPoint === entry)!;
  return basename(path);
}

function integrity(file: string): string {
  const digest = createHash("sha384")
    .update(readFileSync(`${OUT}/${file}`))
    .digest("base64");
  return `sha384-${digest}`;
}

function render(template: string, values: Record<string, string>): void {
  const text = readFileSync(`${ROOT}/${template}`, "utf8").replace(/%([A-Z_]+)%/g, (_, key: string) => {
    if (!(key in values)) throw new Error(`${template} has no value for %${key}%.`);
    return values[key]!;
  });
  writeFileSync(`${OUT}/${template}`, text);
}

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT);
const script = { format: "esm", target: "es2022" } as const;
// Safe's SDK is bundled on its own, with the parts of viem it uses, as only Safe{Wallet} loads it. esbuild's splitting
// would put those parts in a chunk that every visitor loads.
const safe = await build("src/safe.ts", script);
const external: esbuild.Plugin = {
  name: "safe",
  setup: (plugin) => plugin.onResolve({ filter: /^\.\/safe\.ts$/ }, () => ({ path: `./${safe}`, external: true })),
};
const main = await build("src/main.ts", { ...script, plugins: [external] });
const style = await build("style.css");
const icon = await build("icon.svg");
const values = {
  VERSION: version,
  COMMIT: commit().slice(0, 7),
  MAIN: main,
  MAIN_INTEGRITY: integrity(main),
  STYLE: style,
  STYLE_INTEGRITY: integrity(style),
  ICON: icon,
};
render("index.html", values);
render("manifest.json", values);
