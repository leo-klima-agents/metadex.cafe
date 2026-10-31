import { CarWriter } from "@ipld/car";
import { importer, type WritableStorage } from "ipfs-unixfs-importer";
import { fixedSize } from "ipfs-unixfs-importer/chunker";
import { balanced } from "ipfs-unixfs-importer/layout";
import type { CID } from "multiformats/cid";
import { mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { sep } from "node:path";
import { buffer } from "node:stream/consumers";
import { crc32 } from "node:zlib";

// Sorted, "/"-separated, without hidden files, as `ipfs add -r` skips them.
const filesOf = (dir: string): string[] =>
  readdirSync(dir, { recursive: true, encoding: "utf8" })
    .map((path) => path.split(sep).join("/"))
    .filter((path) => !/(^|\/)\./.test(path) && statSync(`${dir}/${path}`).isFile())
    .sort();

// The CID of `ipfs add -r --cid-version=1`, as Pinata gives it, with every importer setting pinned.
export async function carOf(dir: string): Promise<{ root: CID; car: Uint8Array }> {
  const blocks = new Map<string, { cid: CID; bytes: Uint8Array }>();
  const store: WritableStorage = {
    put(cid, bytes) {
      if (!(bytes instanceof Uint8Array)) throw new Error(`${cid} came as a stream.`);
      if (!blocks.has(cid.toString())) blocks.set(cid.toString(), { cid, bytes });
      return cid;
    },
  };
  const files = filesOf(dir).map((path) => ({ path, content: readFileSync(`${dir}/${path}`) }));
  let last;
  for await (last of importer(files, store, {
    cidVersion: 1,
    rawLeaves: true,
    reduceSingleLeafToSelf: true,
    chunker: fixedSize({ chunkSize: 262_144 }),
    layout: balanced({ maxChildrenPerNode: 174 }),
    wrapWithDirectory: true,
    shardSplitThresholdBytes: 262_144,
    shardSplitStrategy: "links-bytes",
    shardFanoutBits: 8,
    fieldOrder: "links-first",
    fileImportConcurrency: 1,
    blockWriteConcurrency: 1,
  }));
  if (last?.path !== "" || last.unixfs?.type !== "directory") throw new Error(`${dir} packed to no directory.`);
  const { writer, out } = CarWriter.create([last.cid]);
  const car = buffer(out);
  for (const block of blocks.values()) await writer.put(block);
  await writer.close();
  return { root: last.cid, car: await car };
}

const le = (...fields: [2 | 4, number][]): Buffer =>
  Buffer.concat(
    fields.map(([size, value]) => {
      const field = Buffer.alloc(size);
      if (size === 2) field.writeUInt16LE(value);
      else field.writeUInt32LE(value);
      return field;
    }),
  );

// Stored, dated 1 Jan 1980 and without modes, so that the bytes depend on the files alone.
export function zipOf(dir: string, folder: string): Uint8Array {
  const files = filesOf(dir);
  const entries: Buffer[] = [];
  const listed: Buffer[] = [];
  let offset = 0;
  for (const path of files) {
    if (!/^[\x20-\x7e]+$/.test(path)) throw new Error(`${path} is not ASCII.`);
    const name = Buffer.from(`${folder}/${path}`);
    const data = readFileSync(`${dir}/${path}`);
    // Version 1.0, no flags, stored, 00:00 on 1 Jan 1980, CRC, sizes, name, no extra field.
    const fields = le([2, 10], [2, 0], [2, 0], [2, 0], [2, 0x21], [4, crc32(data)], [4, data.length], [4, data.length]);
    const naming = le([2, name.length], [2, 0]);
    entries.push(le([4, 0x04034b50]), fields, naming, name, data);
    listed.push(le([4, 0x02014b50], [2, 10]), fields, naming, le([2, 0], [2, 0], [2, 0], [4, 0], [4, offset]), name);
    offset += 30 + name.length + data.length;
  }
  const directory = Buffer.concat(listed);
  const end = le([4, 0x06054b50], [2, 0], [2, 0], [2, files.length], [2, files.length], [4, directory.length]);
  return Buffer.concat([...entries, directory, end, le([4, offset], [2, 0])]);
}

export const contenthashOf = (cid: CID): string => `0x${Buffer.from([0xe3, 0x01, ...cid.bytes]).toString("hex")}`;
export const notesOf = (root: CID): string => `CID: ipfs://${root}\n\nEIP-1577: ${contenthashOf(root)}\n`;

if (import.meta.main) {
  process.chdir(new URL("..", import.meta.url).pathname);
  const { version } = JSON.parse(readFileSync("package.json", "utf8")) as { version: string };
  const name = `release/metadex.cafe_v${version}`;
  const { root, car } = await carOf("dist");
  rmSync("release", { recursive: true, force: true });
  mkdirSync("release");
  writeFileSync(`${name}.car`, car);
  writeFileSync(`${name}.zip`, zipOf("dist", name.slice(8)));
  writeFileSync("release/notes.md", notesOf(root));
  process.stdout.write(notesOf(root));
}
