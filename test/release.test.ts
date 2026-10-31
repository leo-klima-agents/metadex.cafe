import { CarReader } from "@ipld/car";
import { CID } from "multiformats/cid";
import { sha256 } from "multiformats/hashes/sha2";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname } from "node:path";
import { test } from "node:test";
import { carOf, contenthashOf, notesOf, zipOf } from "../scripts/release.ts";

// A file of two chunks, one of one, a subfolder, and hidden ones left out. Recorded with Kubo 0.43.1:
// ipfs add -r --cid-version=1; and the zip once unzip -t and Python's zipfile found it sound.
const DIR = mkdtempSync(`${tmpdir()}/release-`);
const files = {
  "large.txt": "This line repeats until the file is more than one 256 KiB chunk long.\n".repeat(4000),
  "small.txt": "A file of one chunk, whose CID is its own raw block.\n",
  ".hidden": "A hidden file, which the release leaves out, as ipfs add -r does.\n",
  "sub/nested.txt": "A file in a folder of the folder.\n",
  "sub/.folder/file.txt": "A file in a hidden folder, which the release leaves out too.\n",
};
for (const [path, text] of Object.entries(files)) {
  mkdirSync(dirname(`${DIR}/${path}`), { recursive: true });
  writeFileSync(`${DIR}/${path}`, text);
}
const RECORDED = "bafybeigmzca45gv2dy34w5gfnkqtquwixzlcfusid55faiobbow6bfpcou";
const { root, car } = await carOf(DIR);

test("the CID is Kubo's, and the CAR holds that root and each block once, matching its CID", async () => {
  assert.equal(root.toString(), RECORDED);
  assert.deepEqual((await carOf(DIR)).car, car);
  const reader = await CarReader.fromBytes(car);
  assert.deepEqual((await reader.getRoots()).map(String), [RECORDED]);
  const seen = new Set<string>();
  for await (const { cid, bytes } of reader.blocks()) {
    assert.ok(!seen.has(`${cid}`), `${cid} twice`);
    seen.add(`${cid}`);
    assert.deepEqual(cid.multihash.bytes, (await sha256.digest(bytes)).bytes);
  }
});

test("the zip is the bytes recorded", () => {
  const sha = createHash("sha256").update(zipOf(DIR, "release")).digest("hex");
  assert.equal(sha, "c14d51d1f689107821c134460cff81e68acdfc3c1f3e5ed52690a4b02e8675b5");
});

test("the notes give the CID and the EIP-1577 content hash", () => {
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
