import assert from "node:assert/strict";
import { test } from "node:test";
import {
  SAFE_ORIGIN,
  askSafe,
  callsStatus,
  capabilities,
  declined,
  parentOrigin,
  safeFrom,
  type Connection,
  type Provider,
} from "../src/wallet.ts";

const ADDRESS = "0x0208DdBc05a91e1B937E8B3140B62ef22A274C95";
const connected = (answer: (method: string, params: unknown) => unknown, propose = false): Connection => {
  const provider: Provider = {
    async request({ method, params }) {
      const found = answer(method, params);
      if (found instanceof Error) throw found;
      return found;
    },
  };
  return {
    wallet: { name: "Test", provider: async () => provider, ...(propose && { propose: async () => {} }) },
    provider,
    address: ADDRESS,
    chainId: 8453,
  };
};

test("a wallet batches when it answers wallet_getCapabilities, all or nothing when it says so for Base", async () => {
  assert.deepEqual(await capabilities(connected(() => ({ "0x2105": { atomic: { status: "supported" } } }))), {
    batch: true,
    atomic: true,
    assets: false,
  });
  assert.deepEqual(await capabilities(connected(() => ({ "0x2105": { atomic: { status: "ready" } } }))), {
    batch: true,
    atomic: true,
    assets: false,
  });
  // Capabilities for every chain, and those of the first drafts.
  assert.deepEqual(
    await capabilities(connected(() => ({ "0x0": { assetDiscovery: { supported: true } }, "0x2105": {} }))),
    { batch: true, atomic: false, assets: true },
  );
  assert.deepEqual(await capabilities(connected(() => ({ "0x2105": { atomicBatch: { supported: true } } }))), {
    batch: true,
    atomic: true,
    assets: false,
  });
  // A wallet that does not answer sends one call at a time, and Safe{Wallet} proposes one Safe transaction.
  const none = { batch: false, atomic: false, assets: false };
  assert.deepEqual(await capabilities(connected(() => Object.assign(new Error("no"), { code: 4200 }))), none);
  assert.deepEqual(
    await capabilities(connected(() => ({ "0x2105": { atomic: { status: "supported" } } }), true)),
    none,
  );
});

test("a batch is pending, done once every receipt succeeded, and failed otherwise, in numbers or in words", async () => {
  const receipt = (status: string) => ({ transactionHash: "0x01", status, logs: [] });
  const state = async (reply: unknown) =>
    (
      await callsStatus(
        connected(() => reply),
        "0x1",
      )
    ).state;
  assert.equal(await state({ status: 100 }), "pending");
  assert.equal(await state({ status: "PENDING" }), "pending");
  assert.equal(await state({ status: 200, receipts: [receipt("0x1"), receipt("0x1")] }), "done");
  assert.equal(await state({ status: "CONFIRMED", receipts: [receipt("0x1")] }), "done");
  assert.equal(await state({ status: 200, receipts: [receipt("0x1"), receipt("0x0")] }), "failed");
  for (const status of [400, 500, 600]) assert.equal(await state({ status }), "failed");
});

test("a wallet that failed to answer wallet_getCapabilities is asked again, unless it does not know the method", async () => {
  const none = { batch: false, atomic: false, assets: false };
  let asked = 0;
  let answer: unknown = Object.assign(new Error("The wallet is locked."), { code: -32603 });
  const wallet = connected(() => {
    asked++;
    return answer;
  });
  assert.deepEqual(await capabilities(wallet), none);
  answer = { "0x2105": { atomic: { status: "supported" } } };
  assert.deepEqual(await capabilities(wallet), { batch: true, atomic: true, assets: false });
  await capabilities(wallet);
  assert.equal(asked, 2, "an answer is kept");
  for (const code of [4200, -32601]) {
    let unknown = 0;
    const old = connected(() => {
      unknown++;
      return Object.assign(new Error("Unknown method."), { code });
    });
    assert.deepEqual(await capabilities(old), none);
    assert.deepEqual(await capabilities(old), none);
    assert.equal(unknown, 1, `${code} is kept`);
  }
});

test("a frame's parent is Safe{Wallet} only at its origin, and an opaque origin leaves it to Safe{Wallet} to say", () => {
  assert.equal(parentOrigin(SAFE_ORIGIN, ""), SAFE_ORIGIN);
  assert.equal(parentOrigin(undefined, `${SAFE_ORIGIN}/apps/open?safe=base:0x1`), SAFE_ORIGIN);
  assert.equal(parentOrigin("https://evil.example", ""), "https://evil.example");
  // Unknown: a sandboxed frame, one framed without a referrer, or none at all.
  assert.equal(parentOrigin("null", ""), undefined);
  assert.equal(parentOrigin(undefined, "about:blank"), undefined);
  assert.equal(parentOrigin(undefined, ""), undefined);
  // Nor a referrer of the page's own, where the browser lists no ancestors: the frame navigated within itself.
  assert.equal(parentOrigin(undefined, "https://metadex.cafe/#app", "https://metadex.cafe"), undefined);
  assert.equal(parentOrigin("https://metadex.cafe", "", "https://metadex.cafe"), "https://metadex.cafe");
});

// A frame's parent, as Safe{Wallet}: what the page sends it, and its answers, from its origin unless said otherwise.
const framed = () => {
  const sent: { message: { id: string; method: string; params?: unknown; env: unknown }; origin: string }[] = [];
  const parent = {
    postMessage: (message: (typeof sent)[number]["message"], origin: string) => sent.push({ message, origin }),
  };
  const events = new EventTarget();
  const answer = (data: unknown, origin = SAFE_ORIGIN, source: unknown = parent) =>
    events.dispatchEvent(Object.assign(new Event("message"), { origin, source, data }));
  return { sent, parent, events, answer };
};
// What a promise holds once the tasks queued so far have run, or "pending".
const by = (promise: Promise<unknown>) =>
  Promise.race([promise, new Promise((resolve) => setImmediate(resolve, "pending"))]);
const TX = { to: ADDRESS, data: "0x1234" } as const;

test("Safe{Wallet} is asked at its origin only, and answers count from the parent, at that origin, to what was asked", async () => {
  const { sent, parent, events, answer } = framed();
  const ask = askSafe(parent, events);
  const info = ask("getSafeInfo");
  // As the Safe Apps SDK asked.
  const id = sent[0]!.message.id;
  assert.deepEqual(sent, [
    { message: { id, method: "getSafeInfo", params: undefined, env: { sdkVersion: "9.1.0" } }, origin: SAFE_ORIGIN },
  ]);
  answer({ id, success: true, data: "from elsewhere" }, "https://evil.example");
  answer({ id, success: true, data: "from another frame" }, SAFE_ORIGIN, {});
  answer({ id: "1", success: true, data: "to nothing asked" });
  answer(undefined);
  answer({ id, success: true, data: { safeAddress: ADDRESS, chainId: 8453 } });
  assert.deepEqual(await info, { safeAddress: ADDRESS, chainId: 8453 });
  // Each question has an id of its own; an error, as Safe{Wallet} gives one, rejects it.
  const proposed = ask("sendTransactions", { txs: [] });
  assert.notEqual(sent[1]!.message.id, id);
  answer({ id: sent[1]!.message.id, success: false, error: "Transaction was rejected" });
  await assert.rejects(proposed, /^Error: Transaction was rejected$/);
});

test("an answer to a question asked before the page loaded again, or once it stopped asking, counts for nothing", async () => {
  const { sent, parent, events, answer } = framed();
  // The page, loaded again in the same frame, asks the same as before; Safe{Wallet} answers the first load late.
  askSafe(parent, new EventTarget())("sendTransactions", { txs: [TX] });
  const ask = askSafe(parent, events);
  const proposed = ask("sendTransactions", { txs: [TX] });
  answer({ id: sent[0]!.message.id, success: true, data: { safeTxHash: "0x01" } });
  assert.equal(await by(proposed), "pending");
  answer({ id: sent[1]!.message.id, success: true, data: { safeTxHash: "0x02" } });
  assert.deepEqual(await proposed, { safeTxHash: "0x02" });
  // Once stopped, it listens no more: no message is even read.
  const info = ask("getSafeInfo");
  ask.stop();
  answer({ id: sent[2]!.message.id, success: true, data: { safeAddress: ADDRESS, chainId: 8453 } });
  assert.equal(await by(info), "pending");
  let read = false;
  const message = Object.defineProperty(new Event("message"), "origin", { get: () => ((read = true), SAFE_ORIGIN) });
  events.dispatchEvent(message);
  assert.ok(!read);
});

test("Safe{Wallet} is a wallet once it names its Safe, and the page stops listening if it does not in time", async () => {
  const { sent, parent, events, answer } = framed();
  const found = safeFrom(askSafe(parent, events), 1_000);
  answer({ id: sent[0]!.message.id, success: true, data: { safeAddress: ADDRESS, chainId: 8453 } });
  const wallet = await found;
  assert.equal(wallet?.name, "Safe{Wallet}");
  const provider = await wallet!.provider();
  assert.deepEqual(await provider.request({ method: "eth_requestAccounts" }), [ADDRESS]);
  assert.equal(await provider.request({ method: "eth_chainId" }), "0x2105");
  await assert.rejects(provider.request({ method: "eth_sendTransaction" }), { code: 4200 });
  // No answer in time, or an error: no wallet, and nothing more listened for.
  for (const answers of [false, true]) {
    const { sent, parent, events, answer } = framed();
    const ask = askSafe(parent, events);
    let stopped = false;
    const stop = ask.stop;
    ask.stop = () => {
      stopped = true;
      stop();
    };
    const found = safeFrom(ask, 10);
    if (answers) answer({ id: sent[0]!.message.id, success: false, error: "Unknown" });
    assert.equal(await found, undefined);
    assert.ok(stopped, answers ? "after an error" : "after no answer");
  }
});

test("a Safe proposes its calls as one Safe transaction, none without a call, and a closed window declines", async () => {
  const { sent, parent, events, answer } = framed();
  const found = safeFrom(askSafe(parent, events), 1_000);
  answer({ id: sent[0]!.message.id, success: true, data: { safeAddress: ADDRESS, chainId: 8453 } });
  const { propose } = (await found)!;
  // Refused at once, rather than waiting for an answer to nothing.
  const empty = propose!([]).then(
    () => "proposed",
    (error: Error) => error.message,
  );
  assert.equal(await by(empty), "There is no transaction to propose.");
  assert.equal(sent.length, 1, "nothing is sent for nothing");
  const proposed = propose!([TX, { ...TX, tip: 1n }]);
  assert.deepEqual(sent[1]!.message.params, {
    txs: [
      { ...TX, value: "0" },
      { ...TX, value: "0" },
    ],
  });
  answer({ id: sent[1]!.message.id, success: true, data: { safeTxHash: "0x01" } });
  await proposed;
  // Safe{Wallet} says "Transaction was rejected" when its window is closed; another error is the wallet's answer.
  for (const [error, isDeclined] of [
    ["Transaction was rejected", true],
    ["Something else", false],
  ] as const) {
    const proposed = propose!([TX]).catch((thrown: unknown) => thrown);
    answer({ id: sent.at(-1)!.message.id, success: false, error });
    const thrown = (await proposed) as Error;
    assert.equal(thrown.message, error);
    assert.equal(declined(thrown), isDeclined, error);
  }
});
