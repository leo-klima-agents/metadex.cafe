import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { RETRY, SOON, reader } from "../src/read.ts";

const original = { now: Date.now, error: console.error };
afterEach(() => {
  Date.now = original.now;
  console.error = original.error;
});

// A read that resolves or rejects when told, and counts how often it was asked.
function controlled<T>() {
  const asked: ((outcome: { value?: T; error?: Error }) => void)[] = [];
  const read = (): Promise<T> =>
    new Promise((resolve, reject) => asked.push(({ value, error }) => (error ? reject(error) : resolve(value as T))));
  return { read, asked, settle: (outcome: { value?: T; error?: Error }) => asked.shift()!(outcome) };
}

test("a read is pending until it ends, shared by every caller meanwhile", async () => {
  const { read, asked, settle } = controlled<number>();
  let settled = 0;
  const value = reader(read, { settled: () => settled++ });
  assert.deepEqual([value.value, value.failed], [undefined, false], "pending");
  assert.equal(value.due(), true);
  const [first, second] = [value.read(), value.read()];
  assert.equal(asked.length, 1);
  assert.equal(value.reading, true);
  assert.equal(value.due(), false);
  settle({ value: 7 });
  assert.deepEqual(await Promise.all([first, second]), [7, 7]);
  assert.equal(value.value, 7);
  assert.equal(settled, 1);
  assert.equal(value.due(), false, "not stale");
});

test("a read that fails says so until one succeeds, keeps what was read before, and is due again after a while", async () => {
  console.error = () => {};
  const { read, settle } = controlled<number>();
  const value = reader(read);
  const failing = value.read();
  settle({ error: new Error("No Base RPC answered eth_call.") });
  await assert.rejects(failing);
  assert.deepEqual([value.value, value.failed], [undefined, true], "not read yet");
  assert.equal(value.due(), false);
  const then = Date.now();
  Date.now = () => then + RETRY;
  assert.equal(value.due(), true);
  const again = value.read();
  assert.deepEqual([value.reading, value.failed], [true, true], "not pending again while read again");
  settle({ value: 3 });
  await again;
  assert.deepEqual([value.value, value.failed], [3, false]);
  const later = value.read();
  settle({ error: new Error("No Base RPC answered eth_call.") });
  await assert.rejects(later);
  assert.equal(value.value, 3, "keeps what an earlier read found");
  assert.equal(value.failed, true);
});

test("what is stale is read again, and the read is given what it found before", async () => {
  const befores: (number | undefined)[] = [];
  let epoch = 1;
  const value = reader(
    async (before: number | undefined) => {
      befores.push(before);
      return epoch;
    },
    { stale: (found) => found < epoch },
  );
  await value.read();
  assert.equal(value.due(), false);
  epoch = 2;
  assert.equal(value.due(), false, "not sooner than SOON after the read that found it");
  const then = Date.now();
  Date.now = () => then + SOON;
  assert.equal(value.due(), true);
  value.check();
  await value.read();
  assert.deepEqual(befores, [undefined, 1]);
  assert.equal(value.value, 2);
});

test("a read under way when its reader forgets is dropped", async () => {
  const { read, settle } = controlled<number>();
  let settled = 0;
  const value = reader(read, { settled: () => settled++ });
  const dropped = value.read();
  value.forget();
  assert.equal(value.reading, false);
  const kept = value.read();
  settle({ value: 1 });
  settle({ value: 2 });
  await Promise.all([dropped, kept]);
  assert.equal(value.value, 2);
  assert.equal(settled, 1);
});

test("a read anew drops the one under way, and keeps what was read until it ends", async () => {
  const { read, settle } = controlled<number>();
  const value = reader(read);
  const first = value.read();
  settle({ value: 1 });
  await first;
  const before = value.read();
  const after = value.refresh();
  assert.equal(value.value, 1);
  settle({ value: 2 });
  settle({ value: 3 });
  assert.deepEqual(await Promise.all([before, after]), [2, 3]);
  assert.equal(value.value, 3, "not what the dropped read found");
});

test("a read that fails at once is not asked again sooner than SOON, however often what draws it asks", async () => {
  console.error = () => {};
  let asked = 0;
  // Like Matcha Latte's settings: what it draws on settling asks whether another read is due.
  const value = reader(
    () => {
      // A loop would never let the timers below run: it stops here, and the count says so.
      if (++asked > 50) return new Promise<never>(() => {});
      return Promise.reject(new Error("No Base RPC can be reached."));
    },
    { retry: 0, settled: () => value.check() },
  );
  await value.read().catch(() => {});
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(asked, 1);
  const then = Date.now();
  Date.now = () => then + SOON;
  value.check();
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(asked, 2);
});
