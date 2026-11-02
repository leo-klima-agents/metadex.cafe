import type { Metafile } from "esbuild";
import { readFileSync, readdirSync } from "node:fs";

// Builds the license notices of what a built file bundles, appended to it as one comment so they travel with it. An npm
// package's notice comes from its package.json and the copyright lines of its LICENSE; a repository file that is not
// the café's, such as a font, gets its notice from REUSE.toml. License texts come verbatim from `LICENSES/`. A license
// without a text or name here stops the build.

type Part = { name: string; copyright: string[]; license: string };

const LICENSE_NAMES: Record<string, string> = {
  MIT: "the MIT License",
  "OFL-1.1": "the SIL Open Font License 1.1",
};

// What an output bundles: its inputs, and the files a stylesheet embeds through url(), as data.
export function bundled(metafile: Metafile, output: string): string[] {
  const found = Object.entries(metafile.outputs).find(([path]) => path === output || path.endsWith(`/${output}`));
  if (!found) throw new Error(`The build has no ${output}.`);
  const inputs = Object.entries(found[1].inputs)
    .filter(([, { bytesInOutput }]) => bytesInOutput > 0)
    .map(([path]) => path);
  const embedded = inputs.flatMap((path) =>
    (metafile.inputs[path]?.imports ?? []).filter(({ kind }) => kind === "url-token").map(({ path }) => path),
  );
  return [...new Set([...inputs, ...embedded])];
}

// A package whose LICENSE has no copyright line stops the build, rather than having its notice guessed.
export function packagePart(root: string, dir: string): Part {
  const pkg = JSON.parse(readFileSync(`${root}/${dir}/package.json`, "utf8")) as {
    name: string;
    version: string;
    license?: unknown;
  };
  const name = `${pkg.name}@${pkg.version}`;
  const file = readdirSync(`${root}/${dir}`).find((each) => /^licen[cs]e(\.(md|txt))?$/i.test(each));
  const lines = file ? readFileSync(`${root}/${dir}/${file}`, "utf8").split("\n") : [];
  const copyright = lines.map((line) => line.trim()).filter((line) => /^copyright\b/i.test(line));
  if (!copyright.length) throw new Error(`${name} ships no LICENSE with a copyright line.`);
  if (typeof pkg.license !== "string") throw new Error(`${name} has no license the build can read.`);
  return { name, copyright, license: pkg.license };
}

type Annotation = { path: string; copyright: string; license: string };

// In file order, because a later annotation takes precedence over an earlier one for the same file.
function annotations(root: string): Annotation[] {
  const blocks = readFileSync(`${root}/REUSE.toml`, "utf8").split("[[annotations]]").slice(1);
  return blocks.map((block) => {
    const value = (key: string) => {
      const found = new RegExp(`^${key} = "(.*)"$`, "m").exec(block)?.[1];
      if (found === undefined) throw new Error(`An annotation in REUSE.toml has no ${key}.`);
      return found;
    };
    return {
      path: value("path"),
      copyright: value("SPDX-FileCopyrightText"),
      license: value("SPDX-License-Identifier"),
    };
  });
}

// A REUSE.toml path as a pattern: "*" within a folder, "**" across them.
const glob = (pattern: string) => {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^${escaped.replace(/\*\*|\*/g, (star) => (star === "**" ? ".*" : "[^/]*"))}$`);
};

// One part per bundled package, and one per repository file that REUSE.toml gives a holder other than the café. The
// café's own files are those only its `**` annotation covers.
export function partsOf(root: string, files: string[]): Part[] {
  const parts = new Map<string, Part>();
  const annotated = annotations(root);
  for (const file of files) {
    const dir = /^(.*node_modules\/(?:@[^/]+\/)?[^/]+)\//.exec(file)?.[1];
    if (dir) {
      if (!parts.has(dir)) parts.set(dir, packagePart(root, dir));
      continue;
    }
    const annotation = annotated.filter(({ path }) => glob(path).test(file)).at(-1);
    if (!annotation || annotation.path === "**") continue;
    parts.set(file, { name: file, copyright: [`Copyright ${annotation.copyright}`], license: annotation.license });
  }
  return [...parts.values()];
}

export function noticeOf(root: string, parts: Part[]): string {
  if (!parts.length) return "";
  const licenses = [...new Set(parts.map(({ license }) => license))].sort();
  const sections = licenses.map((license) => {
    const name = LICENSE_NAMES[license];
    const users = parts.filter((part) => part.license === license).map(({ name }) => name);
    if (!name) throw new Error(`${users.join(", ")} is under ${license}, which the build has no name for.`);
    const text = readFileSync(`${root}/LICENSES/${license}.txt`, "utf8");
    const lines = parts
      .filter((part) => part.license === license)
      .sort((a, b) => (a.name < b.name ? -1 : 1))
      .flatMap(({ name, copyright }) => [`${name}:`, ...copyright.map((line) => `  ${line}`)]);
    return `${lines.join("\n")}\n\nEach under ${name}:\n\n${text}`;
  });
  const comment = `/*! Bundled license information:\n\n${sections.join("\n")}*/\n`;
  if (comment.slice(2, -3).includes("*/")) throw new Error("A license notice would end its comment early.");
  return comment;
}
