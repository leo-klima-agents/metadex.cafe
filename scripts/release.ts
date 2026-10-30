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

// dist/ as the files of a GitHub Release, in release/: metadex.cafe_v<version>.car, for IPFS and ENS, and
// metadex.cafe_v<version>.zip, the same files for anyone to unpack. Both come out the same, byte for byte, from the same
// dist/. With them, notes.md holds the Release's notes, which it prints: the CID, and the content hash it makes ENS's.

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const OUT = `${ROOT}/release`;
const { version } = JSON.parse(readFileSync(`${ROOT}/package.json`, "utf8")) as { version: string };
const NAME = `metadex.cafe_v${version}`;

// A folder's files, by their paths within it, with "/" between folders on any system, sorted. Hidden files and folders,
// whose names start with a dot, are left out, as `ipfs add -r` leaves them out: a .DS_Store does not change the CID.
const filesOf = (dir: string): string[] =>
  readdirSync(dir, { recursive: true, encoding: "utf8" })
    .map((path) => path.split(sep).join("/"))
    .filter((path) => !path.split("/").some((part) => part.startsWith(".")) && statSync(`${dir}/${path}`).isFile())
    .sort();

// A folder as a CAR file, and its root: the CID Pinata gives the folder when it uploads it as `v1`, which its docs
// equate to `ipfs add -r --cid-version=1`: CIDv1 in base32, sha2-256, raw leaves, 256 KiB chunks in a balanced DAG of
// 174 links a node, and a directory whose entries are the folder's files, with no folder above them, no mode, no
// modification time and no CID inlined. Each setting is passed, rather than left to the importer's defaults, which may
// change; sha2-256 is the only hash it has, and it never inlines. The CAR file holds the one root, then each block
// once, in the order the importer writes them, which stays the same from run to run as it imports one file, and one
// block, at a time.
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

// Little-endian fields of a zip, each of 2 or 4 bytes.
const le = (...fields: [2 | 4, number][]): Buffer =>
  Buffer.concat(
    fields.map(([bytes, value]) => {
      const field = Buffer.alloc(bytes);
      if (bytes === 2) field.writeUInt16LE(value);
      else field.writeUInt32LE(value);
      return field;
    }),
  );

// A folder as a zip, its files within one folder, `folder`, and in the order of their names. They are stored, not
// compressed, so that the bytes depend on nothing but the files: not on the version of zlib. Each is dated 1 Jan 1980
// at 00:00, the earliest a zip can say, and has no mode, which unzip leaves to the umask.
export function zipOf(dir: string, folder: string): Uint8Array {
  const files = filesOf(dir);
  const entries: Buffer[] = [];
  const listed: Buffer[] = [];
  let offset = 0;
  for (const path of files) {
    // In ASCII, which version 1.0 has: a name in UTF-8 would need version 6.3.
    if (!/^[\x20-\x7e]+$/.test(`${folder}/${path}`)) throw new Error(`${folder}/${path} is not in ASCII.`);
    const name = Buffer.from(`${folder}/${path}`, "ascii");
    const data = readFileSync(`${dir}/${path}`);
    // What both of the file's headers say.
    const fields = le(
      [2, 10], // the version needed to read it: 1.0
      [2, 0], // no flags
      [2, 0], // stored
      [2, 0], // 00:00
      [2, 0x21], // 1 Jan 1980
      [4, crc32(data)],
      [4, data.length], // its size stored
      [4, data.length], // its size
      [2, name.length],
      [2, 0], // no extra field
    );
    entries.push(le([4, 0x04034b50]), fields, name, data);
    listed.push(
      le([4, 0x02014b50], [2, 10]), // made by version 1.0, for MS-DOS: no mode
      fields,
      le([2, 0], [2, 0], [2, 0], [4, 0]), // no comment, on disk 0, no attributes
      le([4, offset]), // where its entry starts
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

// A CID as an ENS content hash, as EIP-1577 encodes it: the code of IPFS's namespace, 0xe3, as a varint, then the CID.
export const contenthashOf = (cid: CID): string => `0x${Buffer.from([0xe3, 0x01, ...cid.bytes]).toString("hex")}`;

// The Release's notes, in Markdown: its CID, and below, the same as the content hash ENS stores.
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
