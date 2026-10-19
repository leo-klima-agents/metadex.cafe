import assert from "node:assert/strict";
import { mock, test } from "node:test";
import { callsStatus, canBatch, cannotBatch, sendCalls, type Connection, type Provider } from "../src/wallet.ts";

const ADDRESS = "0x0208DdBc05a91e1B937E8B3140B62ef22A274C95";
const ESCROW = "0x25B2ED7149fb8A05f6eF9407d9c8F878f59cd1e1";

function connected(answer: (method: string, params: unknown) => unknown): Connection & { asked: unknown[] } {
  const asked: unknown[] = [];
  const provider: Provider = {
    async request({ method, params }) {
      asked.push({ method, params });
      return answer(method, params);
    },
  };
  return { wallet: { name: "Test", provider: async () => provider }, provider, address: ADDRESS, chainId: 8453, asked };
}

const refusing = (code: number) => () => {
  throw Object.assign(new Error("no"), { code });
};

test("a wallet batches on Base if it lists the atomic capability for Base or for every chain", async () => {
  const capable = (found: unknown) => canBatch(connected(() => found));
  assert.equal(await capable({ "0x2105": { atomic: { status: "supported" } } }), true);
  assert.equal(await capable({ "0x2105": { atomic: { status: "ready" } } }), true);
  assert.equal(await capable({ "0x0": { atomic: { status: "unsupported" } } }), true, "in any order, one by one");
  assert.equal(await capable({ "0x1": { atomic: { status: "supported" } } }), false, "on another chain only");
  assert.equal(await capable({ "0x2105": { paymasterService: { supported: true } } }), false);
  assert.equal(await capable(null), false);
  assert.equal(await canBatch(connected(refusing(4200))), false, "a wallet without EIP-5792");
  const asking = connected(() => ({}));
  await canBatch(asking);
  assert.deepEqual(asking.asked, [{ method: "wallet_getCapabilities", params: [ADDRESS, ["0x2105"]] }]);
});

test("a wallet that never answers is taken not to batch", async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const asking = canBatch(connected(() => new Promise(() => {})));
    mock.timers.tick(2_000);
    assert.equal(await asking, false);
  } finally {
    mock.timers.reset();
  }
});

test("all the calls in one request, and the batch's status", async () => {
  const wallet = connected((method) => (method === "wallet_sendCalls" ? { id: "0xabc" } : undefined));
  const data = "0x1234";
  assert.equal(await sendCalls(wallet, [{ to: ESCROW, data }]), "0xabc");
  assert.deepEqual(wallet.asked, [
    {
      method: "wallet_sendCalls",
      params: [
        {
          version: "2.0.0",
          from: ADDRESS,
          chainId: "0x2105",
          atomicRequired: false,
          calls: [{ to: ESCROW, data, value: "0x0" }],
        },
      ],
    },
  ]);
  const sentAs = (answer: unknown) =>
    sendCalls(
      connected(() => answer),
      [],
    );
  assert.equal(await sentAs("0xdef"), "0xdef", "as EIP-5792's drafts answered");
  const statusOf = (answer: unknown) =>
    callsStatus(
      connected(() => answer),
      "0xabc",
    );
  const receipts = [{ status: "0x1", transactionHash: `0x${"ab".repeat(32)}` }];
  assert.deepEqual(await statusOf({ status: 200, receipts }), { status: 200, receipts });
  assert.deepEqual(await statusOf({ status: "CONFIRMED", receipts }), { status: 200, receipts });
  assert.deepEqual(await statusOf({ status: "PENDING" }), { status: 100, receipts: [] });
});

test("errors that mean the wallet cannot batch, so that the calls go one by one", () => {
  for (const code of [4200, -32601, 5700, 5710, 5740, 5760]) assert.ok(cannotBatch({ code }), `${code}`);
  assert.ok(cannotBatch({ code: -32603, data: { originalError: { code: 5710 } } }), "wrapped");
  for (const code of [4001, 5750, -32603]) assert.ok(!cannotBatch({ code }), `${code}`);
});
