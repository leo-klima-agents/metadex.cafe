import { CarReader } from "@ipld/car";
import * as dagPb from "@ipld/dag-pb";
import type { CID } from "multiformats/cid";
import { sha256 } from "multiformats/hashes/sha2";
import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { pack } from "../scripts/car.ts";

// A folder with a file of two chunks, one of one, and a folder within. Its CID was recorded once with Kubo 0.43.1, from
// the repository's root: ipfs add -r --cid-version=1 test/fixtures/car
const FIXTURE = fileURLToPath(new URL("fixtures/car", import.meta.url));
const RECORDED = "bafybeigmzca45gv2dy34w5gfnkqtquwixzlcfusid55faiobbow6bfpcou";

const { root, car } = await pack(FIXTURE);

test("a folder packs to the CID that ipfs add -r --cid-version=1 gives it, the same bytes each time", async () => {
  assert.equal(root.toString(), RECORDED);
  assert.deepEqual((await pack(FIXTURE)).car, car);
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
