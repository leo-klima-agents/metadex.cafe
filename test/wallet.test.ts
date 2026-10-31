import assert from "node:assert/strict";
import { test } from "node:test";
import { SAFE_ORIGIN, askSafe, parentOrigin, safeFrom } from "../src/wallet.ts";

test("the framing page's origin, unless opaque or the page's own", () => {
  assert.equal(parentOrigin(SAFE_ORIGIN, ""), SAFE_ORIGIN);
  assert.equal(parentOrigin(undefined, `${SAFE_ORIGIN}/apps`), SAFE_ORIGIN);
  assert.equal(parentOrigin("null", ""), undefined);
  assert.equal(parentOrigin(undefined, "https://metadex.cafe/", "https://metadex.cafe"), undefined);
});

test("Safe{Wallet} answers from its origin only, and proposes the calls as one Safe transaction", async () => {
  const events = new EventTarget();
  const sent: { method: string; params: unknown }[] = [];
  const parent = {
    postMessage({ id, method, params }: { id: string; method: string; params: unknown }, origin: string) {
      assert.equal(origin, SAFE_ORIGIN);
      sent.push({ method, params });
      const data = {
        id,
        success: true,
        data:
          method === "getSafeInfo" ? { safeAddress: "0x0000000000000000000000000000000000005afe", chainId: 8453 } : {},
      };
      events.dispatchEvent(
        Object.assign(new Event("message"), {
          origin: "https://evil.example",
          source: parent,
          data: { ...data, data: {} },
        }),
      );
      events.dispatchEvent(Object.assign(new Event("message"), { origin: SAFE_ORIGIN, source: parent, data }));
    },
  };
  const wallet = (await safeFrom(askSafe(parent, events), 1_000))!;
  const provider = await wallet.provider();
  assert.deepEqual(await provider.request({ method: "eth_requestAccounts" }), [
    "0x0000000000000000000000000000000000005afe",
  ]);
  await wallet.propose!([{ to: "0x0000000000000000000000000000000000000001", data: "0x12" }]);
  assert.deepEqual(sent.at(-1), {
    method: "sendTransactions",
    params: { txs: [{ to: "0x0000000000000000000000000000000000000001", data: "0x12", value: "0" }] },
  });
  await assert.rejects(wallet.propose!([]));
});
