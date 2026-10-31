import assert from "node:assert/strict";
import { test } from "node:test";
import { reader } from "../src/state.ts";

test("a read is shared while under way, kept when a later one fails, and dropped once forgotten", async () => {
  let n = 0;
  let fail = false;
  const value = reader(async () => {
    if (fail) throw new Error("no");
    return ++n;
  });
  assert.equal(value.read(), value.read());
  assert.equal(await value.read(), 1);
  fail = true;
  await assert.rejects(value.refresh());
  assert.deepEqual([value.value, value.failed, value.due()], [1, true, false]);
  fail = false;
  const dropped = value.read();
  value.forget();
  await dropped;
  assert.equal(value.value, undefined);
});
