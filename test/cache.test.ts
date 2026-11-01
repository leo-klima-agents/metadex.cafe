import assert from "node:assert/strict";
import { test } from "node:test";
import { memo, refresh, retry, use } from "../src/cache.ts";

const tick = () => new Promise((done) => setTimeout(done, 0));

test("a read is shared, kept, and failed until retried", async () => {
  let reads = 0;
  const read = async () => ++reads;
  assert.equal(await Promise.all([memo("a", read), memo("a", read)]).then(() => reads), 1);
  assert.deepEqual(use("a", read), { value: 1 });
  let fail = true;
  const flaky = async () => (fail ? Promise.reject(new Error("no")) : "ok");
  assert.deepEqual(use("b", flaky), {});
  await tick();
  assert.deepEqual(use("b", flaky), { failed: true });
  fail = false;
  assert.deepEqual(use("b", flaky), { failed: true });
  retry();
  await memo("b", flaky);
  assert.deepEqual(use("b", flaky), { value: "ok" });
});

test("what is read again shows its last value meanwhile", async () => {
  let n = 0;
  const read = async () => ++n;
  await memo("c", read, 0);
  assert.deepEqual(use("c", read, 1e9), { value: 1 });
  await tick();
  assert.deepEqual(use("c", read, 1e9), { value: 2 });
  refresh("c");
  assert.deepEqual(use("c", read), { value: 2 });
  await tick();
  assert.deepEqual(use("c", read), { value: 3 });
});

test("a read given no time to live keeps its key's; one that fails again is failed, and refresh reads it again", async () => {
  let n = 0;
  const read = async () => ++n;
  await memo("d", read, 0);
  await memo("d", read);
  await memo("d", read);
  assert.equal(n, 3, "each read again at once: its time to live stayed 0");
  let fail = false;
  const flaky = async () => (fail ? Promise.reject(new Error("no")) : "ok");
  await memo("e", flaky, 0);
  fail = true;
  await memo("e", flaky).catch(() => {});
  assert.deepEqual(use("e", flaky), { failed: true }, "no stale value shown as read");
  fail = false;
  refresh("e");
  await memo("e", flaky);
  assert.deepEqual(use("e", flaky, 1e9), { value: "ok" });
});
