import { CarWriter } from "@ipld/car";
import { importer, type ImportCandidate, type WritableStorage } from "ipfs-unixfs-importer";
import { fixedSize } from "ipfs-unixfs-importer/chunker";
import { balanced } from "ipfs-unixfs-importer/layout";
import { base32 } from "multiformats/bases/base32";
import type { CID } from "multiformats/cid";
import { mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { buffer } from "node:stream/consumers";
import { fileURLToPath } from "node:url";

// dist/ as one CAR file, release/metadexcafe.eth_v<version>.car, for IPFS and ENS, and its root CID printed. The root
// is the CID Pinata gives the folder when it uploads it as `v1`, which its docs equate to `ipfs add -r
// --cid-version=1`: CIDv1 in base32, sha2-256, raw leaves, 256 KiB chunks in a balanced DAG of 174 links a node, and
// a directory whose entries are the folder's files, with no folder above them, no mode, no modification time and no
// CID inlined. Each setting is passed, rather than left to the importer's defaults, which may change; sha2-256 is the
// only hash it has, and it never inlines. The CAR file holds the one root, then each block once, in the order the
// importer writes them, which stays the same from run to run as it imports one file, and one block, at a time.

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const OUT = `${ROOT}/release`;
const { version } = JSON.parse(readFileSync(`${ROOT}/package.json`, "utf8")) as { version: string };

// A folder's files as a CAR file, and its root.
export async function pack(dir: string): Promise<{ root: CID; car: Uint8Array }> {
  const files = readdirSync(dir, { recursive: true, encoding: "utf8" })
    .filter((path) => statSync(`${dir}/${path}`).isFile())
    .sort();
  const candidates: ImportCandidate[] = files.map((path) => ({ path, content: readFileSync(`${dir}/${path}`) }));
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

if (import.meta.main) {
  const { root, car } = await pack(`${ROOT}/dist`);
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT);
  writeFileSync(`${OUT}/metadexcafe.eth_v${version}.car`, car);
  console.log(root.toString(base32));
}
