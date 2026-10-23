import assert from "node:assert/strict";
import { test } from "node:test";
import { callsStatus, capabilities, type Connection, type Provider } from "../src/wallet.ts";

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
