import { CarWriter } from "@ipld/car";
import { importer, type ImportCandidate, type WritableStorage } from "ipfs-unixfs-importer";
import { fixedSize } from "ipfs-unixfs-importer/chunker";
import { balanced } from "ipfs-unixfs-importer/layout";
import { base32 } from "multiformats/bases/base32";
import type { CID } from "multiformats/cid";
import { mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { sep } from "node:path";
import { buffer } from "node:stream/consumers";
import { fileURLToPath } from "node:url";
import { crc32 } from "node:zlib";

// Packs dist/ into release/ as a GitHub Release's files: `metadex.cafe_v<version>.car` for IPFS and ENS, and
// `metadex.cafe_v<version>.zip` with the same files for anyone to unpack. The same dist/ always gives the same bytes.
// `notes.md`, also printed, holds the Release's notes: the CID and its ENS content hash.

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const OUT = `${ROOT}/release`;
const { version } = JSON.parse(readFileSync(`${ROOT}/package.json`, "utf8")) as { version: string };
const NAME = `metadex.cafe_v${version}`;

// Paths use "/" on every system and are sorted. Hidden files and folders are left out, as `ipfs add -r` leaves them
// out, so a `.DS_Store` does not change the CID.
const filesOf = (dir: string): string[] =>
  readdirSync(dir, { recursive: true, encoding: "utf8" })
    .map((path) => path.split(sep).join("/"))
    .filter((path) => !path.split("/").some((part) => part.startsWith(".")) && statSync(`${dir}/${path}`).isFile())
    .sort();

// Packs a folder as a CAR file. The root is the CID Pinata gives the folder when it uploads it as `v1`, which Pinata's
// docs equate to `ipfs add -r --cid-version=1`: CIDv1 in base32, sha2-256, raw leaves, 256 KiB chunks in a balanced DAG
// of 174 links a node, and one directory of the folder's files with no mode, no modification time and no inlined CIDs.
// Every setting is passed explicitly, because the importer's defaults may change; it only hashes with sha2-256 and
// never inlines. The CAR holds the root, then each block once, in the order the importer writes them, which is stable
// because it imports one file and one block at a time.
export async function carOf(dir: string): Promise<{ root: CID; car: Uint8Array }> {
  const candidates: ImportCandidate[] = filesOf(dir).map((path) => ({ path, content: readFileSync(`${dir}/${path}`) }));
  const blocks = new Map<string, { cid: CID; bytes: Uint8Array }>();
  const blockstore: WritableStorage = {
    put(cid, bytes) {
      if (!(bytes instanceof Uint8Array)) throw new Error(`The importer wrote ${cid} as a stream.`);
      if (!blocks.has(cid.toString())) blocks.set(cid.toString(), { cid, bytes });
      return cid;
    },
  };
  let last;
  for await (const entry of importer(candidates, blockstore, {
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
  }))
    last = entry;
  // The importer yields the folder last, as the directory that wraps its files.
  if (last?.path !== "" || last.unixfs?.type !== "directory") throw new Error(`${dir} packed to no directory.`);
  const root = last.cid;
  const { writer, out } = CarWriter.create([root]);
  const written = buffer(out);
  for (const block of blocks.values()) await writer.put(block);
  await writer.close();
  return { root, car: await written };
}

const le = (...fields: [2 | 4, number][]): Buffer =>
  Buffer.concat(
    fields.map(([bytes, value]) => {
      const field = Buffer.alloc(bytes);
      if (bytes === 2) field.writeUInt16LE(value);
      else field.writeUInt32LE(value);
      return field;
    }),
  );

// Zips a folder's files, sorted by name, inside one folder, `folder`. They are stored, not compressed, so the bytes
// depend only on the files and not on the zlib version. Each is dated 1 Jan 1980, 00:00, the earliest date a zip can
// hold, and has no mode, so unzip applies the umask.
export function zipOf(dir: string, folder: string): Uint8Array {
  const files = filesOf(dir);
  const entries: Buffer[] = [];
  const listed: Buffer[] = [];
  let offset = 0;
  for (const path of files) {
    // Names must be ASCII: zip version 1.0 has no UTF-8 names, which need version 6.3.
    if (!/^[\x20-\x7e]+$/.test(`${folder}/${path}`)) throw new Error(`${folder}/${path} is not in ASCII.`);
    const name = Buffer.from(`${folder}/${path}`, "ascii");
    const data = readFileSync(`${dir}/${path}`);
    // Fields the local header and the central directory entry share, in the same order.
    const fields = le(
      [2, 10], // version needed to extract: 1.0
      [2, 0], // no flags
      [2, 0], // method: stored
      [2, 0], // time: 00:00
      [2, 0x21], // date: 1 Jan 1980
      [4, crc32(data)],
      [4, data.length], // compressed size
      [4, data.length], // uncompressed size
      [2, name.length],
      [2, 0], // no extra field
    );
    entries.push(le([4, 0x04034b50]), fields, name, data);
    listed.push(
      le([4, 0x02014b50], [2, 10]), // made by version 1.0, for MS-DOS: no mode
      fields,
      le([2, 0], [2, 0], [2, 0], [4, 0]), // no comment, on disk 0, no internal or external attributes
      le([4, offset]), // offset of its local header
      name,
    );
    offset += 30 + name.length + data.length;
  }
  const directory = Buffer.concat(listed);
  const end = le(
    [4, 0x06054b50],
    [2, 0], // this disk
    [2, 0], // the disk the directory starts on
    [2, files.length], // the files on this disk
    [2, files.length], // the files in all
    [4, directory.length],
    [4, offset], // where the directory starts
    [2, 0], // no comment
  );
  return Buffer.concat([...entries, directory, end]);
}

// An ENS content hash, as EIP-1577 encodes it: IPFS's namespace code 0xe3 as a varint (`e3 01`), then the CID.
export const contenthashOf = (cid: CID): string => `0x${Buffer.from([0xe3, 0x01, ...cid.bytes]).toString("hex")}`;

export const notesOf = (root: CID): string =>
  `CID: ipfs://${root.toString(base32)}\n\nEIP-1577: ${contenthashOf(root)}\n`;

if (import.meta.main) {
  const { root, car } = await carOf(`${ROOT}/dist`);
  const zip = zipOf(`${ROOT}/dist`, NAME);
  const notes = notesOf(root);
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT);
  writeFileSync(`${OUT}/${NAME}.car`, car);
  writeFileSync(`${OUT}/${NAME}.zip`, zip);
  writeFileSync(`${OUT}/notes.md`, notes);
  process.stdout.write(notes);
}
