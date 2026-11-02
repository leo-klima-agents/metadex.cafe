import { spawnSync } from "node:child_process";
import { watch } from "node:fs";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const DIST = join(ROOT, "dist");
const TYPES: Record<string, string> = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".json": "application/json",
};

const build = (): boolean =>
  spawnSync(process.execPath, [join(ROOT, "scripts/build.ts")], { stdio: "inherit" }).status === 0;
build();
let due: ReturnType<typeof setTimeout> | undefined;
for (const dir of ["site", "src"])
  watch(join(ROOT, dir), { recursive: true }, () => {
    clearTimeout(due);
    due = setTimeout(() => build() && console.log("Built: reload the page."), 100);
  });

const port = Number(process.env.PORT ?? 8000);
createServer(async (request, response) => {
  const { pathname } = new URL(request.url ?? "/", "http://localhost");
  const file = join(DIST, pathname === "/" ? "index.html" : pathname);
  const body = file.startsWith(DIST) ? await readFile(file).catch(() => undefined) : undefined;
  if (!body) return void response.writeHead(404).end();
  response.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream" }).end(body);
}).listen(port, () => console.log(`Serving dist/ at http://localhost:${port}/`));
