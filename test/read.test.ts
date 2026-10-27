import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { PENDING } from "../src/dom.ts";
import { RETRY, reader } from "../src/read.ts";

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

test("a read is pending until it ends, shared by every caller meanwhile, and its value says its own words", async () => {
  const { read, asked, settle } = controlled<number>();
  let settled = 0;
  const value = reader(read, { settled: () => settled++ });
  assert.equal(value.text(String), PENDING);
  assert.equal(value.due(), true);
  const [first, second] = [value.read(), value.read()];
  assert.equal(asked.length, 1);
  assert.equal(value.reading, true);
  assert.equal(value.due(), false);
  settle({ value: 7 });
  assert.deepEqual(await Promise.all([first, second]), [7, 7]);
  assert.equal(value.text(String), "7");
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
  assert.equal(value.text(String), "Not read yet");
  assert.equal(value.due(), false);
  const then = Date.now();
  Date.now = () => then + RETRY;
  assert.equal(value.due(), true);
  const again = value.read();
  assert.equal(value.text(String), "Not read yet", "not pending again while read again");
  settle({ value: 3 });
  await again;
  assert.equal(value.text(String), "3");
  const later = value.read();
  settle({ error: new Error("No Base RPC answered eth_call.") });
  await assert.rejects(later);
  assert.equal(value.text(String), "3", "keeps what an earlier read found");
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
