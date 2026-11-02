import assert from "node:assert/strict";
import { test } from "node:test";
import type { EIP1193Provider } from "viem";
import {
  SAFE_ORIGIN,
  askSafe,
  callsStatus,
  capabilities,
  declined,
  parentOrigin,
  safeFrom,
  type Connection,
} from "../src/wallet.ts";

const ADDRESS = "0x0208DdBc05a91e1B937E8B3140B62ef22A274C95";
const connected = (answer: (method: string) => unknown, propose = false): Connection => {
  const provider = {
    async request({ method }: { method: string }) {
      const found = answer(method);
      if (found instanceof Error) throw found;
      return found;
    },
    on() {},
    removeListener() {},
  } as EIP1193Provider;
  const wallet = { name: "Test", provider: async () => provider, ...(propose && { propose: async () => {} }) };
  return { wallet, provider, address: ADDRESS, chainId: 8453 };
};
const failure = (code: number) => Object.assign(new Error("no"), { code });
const NONE = { batch: false, atomic: false, assets: false };
const ATOMIC = { batch: true, atomic: true, assets: false };

test("a wallet batches when it answers wallet_getCapabilities, all or nothing when it says so for Base", async () => {
  const of = (reply: unknown, propose = false) => capabilities(connected(() => reply, propose));
  assert.deepEqual(await of({ "0x2105": { atomic: { status: "supported" } } }), ATOMIC);
  assert.deepEqual(await of({ "0x2105": { atomic: { status: "ready" } } }), ATOMIC);
  const discovery = { "0x0": { assetDiscovery: { supported: true } }, "0x2105": {} };
  assert.deepEqual(await of(discovery), { batch: true, atomic: false, assets: true });
  assert.deepEqual(await of(failure(4200)), NONE);
  assert.deepEqual(await of({ "0x2105": { atomic: { status: "supported" } } }, true), NONE, "Safe{Wallet} proposes");
});

test("capabilities are asked again after a failure, unless the wallet does not know the method", async () => {
  let [asked, answer] = [0, failure(-32603) as unknown];
  const wallet = connected(() => (asked++, answer));
  assert.deepEqual(await capabilities(wallet), NONE);
  answer = { "0x2105": { atomic: { status: "supported" } } };
  assert.deepEqual(await capabilities(wallet), ATOMIC);
  await capabilities(wallet);
  assert.equal(asked, 2, "an answer is kept");
  for (const code of [4200, -32601]) {
    let unknown = 0;
    const old = connected(() => (unknown++, failure(code)));
    assert.deepEqual([await capabilities(old), await capabilities(old)], [NONE, NONE]);
    assert.equal(unknown, 1, `${code} is kept`);
  }
});

test("a batch is pending, done once every receipt succeeded, or failed", async () => {
  const receipt = (status: string) => ({ transactionHash: "0x01", status, logs: [] });
  const state = async (reply: unknown) =>
    (
      await callsStatus(
        connected(() => reply),
        "0x1",
      )
    ).state;
  assert.equal(await state({ status: 100 }), "pending");
  assert.equal(await state({ status: 200, receipts: [receipt("0x1"), receipt("0x1")] }), "done");
  assert.equal(await state({ status: 200, receipts: [receipt("0x1"), receipt("0x0")] }), "failed");
  assert.equal(await state({ status: 200 }), "pending", "confirmed, but its receipts have not come");
  for (const status of [400, 500, 600]) assert.equal(await state({ status }), "failed");
});

test("a frame's parent is Safe{Wallet} only at its origin; an opaque origin or the page's own says nothing", () => {
  const own = "https://metadex.cafe";
  assert.equal(parentOrigin(SAFE_ORIGIN, ""), SAFE_ORIGIN);
  assert.equal(parentOrigin(undefined, `${SAFE_ORIGIN}/apps/open?safe=base:0x1`), SAFE_ORIGIN);
  assert.equal(parentOrigin("https://evil.example", ""), "https://evil.example");
  assert.equal(parentOrigin("null", ""), undefined);
  assert.equal(parentOrigin(undefined, "about:blank"), undefined);
  assert.equal(parentOrigin(undefined, ""), undefined);
  assert.equal(parentOrigin(undefined, `${own}/#app`, own), undefined);
  assert.equal(parentOrigin(own, "", own), own);
});

const framed = () => {
  const sent: { message: { id: string; method: string; params?: unknown; env: unknown }; origin: string }[] = [];
  const parent = {
    postMessage: (message: (typeof sent)[number]["message"], origin: string) => sent.push({ message, origin }),
  };
  const events = new EventTarget();
  const answer = (data: unknown, origin = SAFE_ORIGIN, source: unknown = parent) =>
    events.dispatchEvent(Object.assign(new Event("message"), { origin, source, data }));
  const reply = (n: number, data: unknown, success = true) =>
    answer({ id: sent.at(n)!.message.id, success, ...(success ? { data } : { error: data }) });
  return { sent, parent, events, answer, reply };
};
// The promise's value once the tasks queued so far have run, or "pending" if it has not settled by then.
const by = (promise: Promise<unknown>) =>
  Promise.race([promise, new Promise((resolve) => setImmediate(resolve, "pending"))]);
const TX = { to: ADDRESS, data: "0x1234" } as const;
const INFO = { safeAddress: ADDRESS, chainId: 8453 };

test("Safe{Wallet} is asked at its origin, and an answer counts only from it, to what was asked", async () => {
  const { sent, parent, events, answer, reply } = framed();
  const ask = askSafe(parent, events);
  const info = ask("getSafeInfo");
  const id = sent[0]!.message.id;
  assert.deepEqual(sent, [
    { message: { id, method: "getSafeInfo", params: undefined, env: { sdkVersion: "9.1.0" } }, origin: SAFE_ORIGIN },
  ]);
  answer({ id, success: true, data: "from elsewhere" }, "https://evil.example");
  answer({ id, success: true, data: "from another frame" }, SAFE_ORIGIN, {});
  answer({ id: "1", success: true, data: "to nothing asked" });
  answer(undefined);
  reply(0, INFO);
  assert.deepEqual(await info, INFO);
  const proposed = ask("sendTransactions", { txs: [] });
  assert.notEqual(sent[1]!.message.id, id);
  reply(1, "Transaction was rejected", false);
  await assert.rejects(proposed, /^Error: Transaction was rejected$/);
});

test("an answer to a question from before the page reloaded, or after it stopped, counts for nothing", async () => {
  const { parent, events, reply } = framed();
  askSafe(parent, new EventTarget())("sendTransactions", { txs: [TX] });
  const ask = askSafe(parent, events);
  const proposed = ask("sendTransactions", { txs: [TX] });
  reply(0, { safeTxHash: "0x01" });
  assert.equal(await by(proposed), "pending");
  reply(1, { safeTxHash: "0x02" });
  assert.deepEqual(await proposed, { safeTxHash: "0x02" });
  const info = ask("getSafeInfo");
  ask.stop();
  reply(2, INFO);
  assert.equal(await by(info), "pending");
  let read = false;
  events.dispatchEvent(
    Object.defineProperty(new Event("message"), "origin", { get: () => ((read = true), SAFE_ORIGIN) }),
  );
  assert.ok(!read, "no message is even read");
});

test("Safe{Wallet} is a wallet once it names its Safe; the page stops listening if it does not in time", async () => {
  const { parent, events, reply } = framed();
  const found = safeFrom(askSafe(parent, events), 1_000);
  reply(0, INFO);
  const wallet = await found;
  assert.equal(wallet?.name, "Safe{Wallet}");
  const provider = await wallet!.provider();
  assert.deepEqual(await provider.request({ method: "eth_requestAccounts" }), [ADDRESS]);
  assert.equal(await provider.request({ method: "eth_chainId" }), "0x2105");
  await assert.rejects(provider.request({ method: "eth_sendTransaction", params: [{}] }), { code: 4200 });
  for (const answers of [false, true]) {
    const { parent, events, reply } = framed();
    const ask = askSafe(parent, events);
    let stopped = false;
    const stop = ask.stop;
    ask.stop = () => ((stopped = true), stop());
    const found = safeFrom(ask, 10);
    if (answers) reply(0, "Unknown", false);
    assert.equal(await found, undefined);
    assert.ok(stopped, answers ? "after an error" : "after no answer");
  }
});

test("a Safe proposes its calls as one Safe transaction, none without a call; a closed window declines", async () => {
  const { sent, parent, events, reply } = framed();
  const found = safeFrom(askSafe(parent, events), 1_000);
  reply(0, INFO);
  const { propose } = (await found)!;
  const empty = propose!([]).catch((error: Error) => error.message);
  assert.equal(await by(empty), "There is no transaction to propose.");
  assert.equal(sent.length, 1, "nothing is sent for nothing");
  const proposed = propose!([TX, { ...TX, tip: 1n }]);
  const value = { ...TX, value: "0" };
  assert.deepEqual(sent[1]!.message.params, { txs: [value, value] });
  reply(1, { safeTxHash: "0x01" });
  await proposed;
  for (const [error, isDeclined] of [
    ["Transaction was rejected", true],
    ["Something else", false],
  ] as const) {
    const thrown = propose!([TX]).catch((thrown: Error) => thrown);
    reply(-1, error, false);
    assert.equal((await thrown)!.message, error);
    assert.equal(declined(await thrown), isDeclined, error);
  }
});
