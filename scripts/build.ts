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
await esbuild.build({
  absWorkingDir: ROOT,
  entryPoints: ["src/main.ts"],
  outfile: `${OUT}/main.js`,
  bundle: true,
  format: "esm",
  target: "es2022",
  minify: true,
  charset: "utf8",
  legalComments: "linked",
  logLevel: "warning",
});
const html = readFileSync(`${ROOT}/index.html`, "utf8");
writeFileSync(`${OUT}/index.html`, html.replace("%VERSION%", version).replace("%COMMIT%", commit().slice(0, 7)));
for (const file of ["manifest.json", "icon.svg", "style.css"]) copyFileSync(`${ROOT}/${file}`, `${OUT}/${file}`);
