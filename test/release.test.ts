import { CarReader } from "@ipld/car";
import * as dagPb from "@ipld/dag-pb";
import type { CID } from "multiformats/cid";
import { sha256 } from "multiformats/hashes/sha2";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { carOf, zipOf } from "../scripts/release.ts";

// A folder with a file of two chunks, one of one, and a folder within. Its CID was recorded once with Kubo 0.43.1, from
// the repository's root: ipfs add -r --cid-version=1 test/fixtures/release
const FIXTURE = fileURLToPath(new URL("fixtures/release", import.meta.url));
const RECORDED = "bafybeigmzca45gv2dy34w5gfnkqtquwixzlcfusid55faiobbow6bfpcou";
// Its zip's SHA-256, recorded once unzip -t and Python's zipfile found the zip sound, and unzip gave back the folder.
const ZIPPED = "2272ca9f3fb60db545edf7bc041b2f292212c0d49aee63c23a8aaf9b2a905576";

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
