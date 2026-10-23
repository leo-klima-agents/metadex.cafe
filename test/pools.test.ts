import assert from "node:assert/strict";
import { test } from "node:test";
import { zeroAddress, type Address } from "viem";
import type { Call, read } from "../src/chain.ts";
import { EXCHANGES, USDC } from "../src/config.ts";
import { pairKey, waysFor } from "../src/pools.ts";

const AVNT: Address = "0x696F9436B67233384889472Cd7cD58A6fB5DF4f1";
const POOL: Address = "0x0000000000000000000000000000000000000001";
const PAIR: [Address, Address] = [AVNT, USDC];

// A reader of the test's own, which answers each call as `answer` says and counts the calls it was asked.
function reader(answer: (call: Call) => unknown): { read: typeof read; asked: Call[] } {
  const asked: Call[] = [];
  const own = async (calls: Call[]) => {
    asked.push(...calls);
    return calls.map(answer);
  };
  return { read: own as typeof read, asked };
}

test("a lookup that fails is asked again, while a pool found, or none, is kept", async () => {
  const v2 = EXCHANGES.find(({ kind }) => kind === "v2")!;
  let failing = true;
  const flaky = reader(() => (failing ? undefined : POOL));
  assert.deepEqual((await waysFor([PAIR], [v2], flaky.read)).get(pairKey(...PAIR)), []);
  failing = false;
  const found = (await waysFor([PAIR], [v2], flaky.read)).get(pairKey(...PAIR))!;
  assert.deepEqual(
    found.map(({ pool }) => pool),
    [POOL],
  );
  assert.equal(flaky.asked.length, 2);
  await waysFor([PAIR], [v2], flaky.read);
  assert.equal(flaky.asked.length, 2, "a pool found is kept");
  const none = reader(() => zeroAddress);
  await waysFor([PAIR], [v2], none.read);
  await waysFor([PAIR], [v2], none.read);
  assert.equal(none.asked.length, 1, "no pool is kept too");
});

test("tick spacings are read through the reader given, and asked again when a factory did not answer", async () => {
  const slipstream = EXCHANGES.find(({ kind }) => kind === "slipstream")!;
  let failing = true;
  const own = reader(({ functionName }) => (functionName === "tickSpacings" ? (failing ? undefined : [100]) : POOL));
  // Without its tick spacings, the exchange's pools are not known: neither found nor kept as none.
  assert.deepEqual((await waysFor([PAIR], [slipstream], own.read)).get(pairKey(...PAIR)), []);
  assert.ok(own.asked.some(({ functionName }) => functionName === "tickSpacings"));
  failing = false;
  const found = (await waysFor([PAIR], [slipstream], own.read)).get(pairKey(...PAIR))!;
  assert.deepEqual(
    found.map(({ pool, tickSpacing }) => [pool, tickSpacing]),
    [[POOL, 100]],
  );
  const spacingsAsked = own.asked.filter(({ functionName }) => functionName === "tickSpacings").length;
  await waysFor([[USDC, AVNT]], [slipstream], own.read);
  assert.equal(
    own.asked.filter(({ functionName }) => functionName === "tickSpacings").length,
    spacingsAsked,
    "spacings that were read are kept",
  );
});
