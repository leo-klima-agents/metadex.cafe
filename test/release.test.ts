import { CarReader } from "@ipld/car";
import * as dagPb from "@ipld/dag-pb";
import { CID } from "multiformats/cid";
import { sha256 } from "multiformats/hashes/sha2";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { carOf, contenthashOf, notesOf, zipOf } from "../scripts/release.ts";

// A folder with a file of two chunks, one of one, a folder within, and a hidden file and folder, which both leave out.
// Its CID was recorded once with Kubo 0.43.1, from the repository's root: ipfs add -r --cid-version=1
// test/fixtures/release
const FIXTURE = fileURLToPath(new URL("fixtures/release", import.meta.url));
const RECORDED = "bafybeigmzca45gv2dy34w5gfnkqtquwixzlcfusid55faiobbow6bfpcou";
// Its zip's SHA-256, recorded once unzip -t and Python's zipfile found the zip sound, and unzip gave back the folder,
// less its hidden file and folder.
const ZIPPED = "c14d51d1f689107821c134460cff81e68acdfc3c1f3e5ed52690a4b02e8675b5";

const { root, car } = await carOf(FIXTURE);

test("a folder packs to the CID that ipfs add -r --cid-version=1 gives it, the same bytes each time", async () => {
  assert.equal(root.toString(), RECORDED);
  assert.deepEqual((await carOf(FIXTURE)).car, car);
});

test("a folder zips to the bytes recorded, the same each time", () => {
  const zip = zipOf(FIXTURE, "release");
  assert.equal(createHash("sha256").update(zip).digest("hex"), ZIPPED);
  assert.deepEqual(zipOf(FIXTURE, "release"), zip);
});

test("the notes give the CID, and below it the content hash as EIP-1577 encodes it", () => {
  // EIP-1577's own example.
  const example = CID.parse("QmRAQB6YaCyidP37UdDnjFY5vQuiBrcqdyoW1CuDgwxkD4").toV1();
  assert.equal(
    contenthashOf(example),
    "0xe3010170122029f2d17be6139079dc48696d1f582a8530eb9805b561eda517e22a892c7e3f1f",
  );
  assert.equal(
    notesOf(root),
    `CID: ipfs://${RECORDED}\n\nEIP-1577: 0xe301${Buffer.from(root.bytes).toString("hex")}\n`,
  );
});

test("the CAR file has that one root, and each block under it once, each matching its CID", async () => {
  const reader = await CarReader.fromBytes(car);
  assert.equal(reader.version, 1);
  assert.deepEqual((await reader.getRoots()).map(String), [RECORDED]);
  const blocks = new Map<string, Uint8Array>();
  for await (const { cid, bytes } of reader.blocks()) {
    assert.ok(!blocks.has(cid.toString()), `${cid} twice`);
    assert.deepEqual(cid.multihash.bytes, (await sha256.digest(bytes)).bytes, `${cid} does not match its block`);
    blocks.set(cid.toString(), bytes);
  }
  // Each directory and file of more than one chunk is a dag-pb node; each chunk, a raw block.
  const reached = new Set<string>();
  const walk = (cid: CID) => {
    reached.add(cid.toString());
    const bytes = blocks.get(cid.toString());
    assert.ok(bytes, `${cid} is missing`);
    if (cid.code === dagPb.code) for (const { Hash } of dagPb.decode(bytes).Links) walk(Hash);
  };
  walk(root);
  assert.deepEqual([...reached].sort(), [...blocks.keys()].sort());
});
