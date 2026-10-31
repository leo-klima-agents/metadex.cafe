import assert from "node:assert/strict";
import { test } from "node:test";
import { encodeAbiParameters, encodeEventTopics, parseAbiParameters, type Address, type Hex } from "viem";
import {
  MAX_CLAIM_GAS,
  SAFE_CLAIM_CALL_GAS,
  claimArgs,
  claimCalls,
  claimGas,
  claimTransactions,
  claimedIn,
  paidBy,
  type Owed,
} from "../src/claim.ts";
import { ABI, DOUBLE_ESPRESSO } from "../src/config.ts";

const address = (n: number) => `0x${n.toString(16).padStart(40, "0")}` as Address;
const owed = (contract: number, token: number, amount = 1n, fee = false): Owed => ({
  contract: address(contract),
  token: address(1000 + token),
  amount,
  fee,
});

test("a claim passes only what owes something, by kind of contract", () => {
  const args = claimArgs({ id: 7n, owed: [owed(1, 1, 5n, true), owed(2, 1), owed(2, 2), owed(3, 3, 0n)] });
  assert.deepEqual(args, [7n, [address(1)], [address(2)], [address(1001), address(1002)]]);
});

test("Double Espresso takes 1% of each token, rounded down", () => {
  assert.deepEqual(paidBy([owed(1, 1, 150n), owed(2, 1, 50n)]), [
    { token: address(1001), earned: 200n, fee: 2n, paid: 198n },
  ]);
});

test("a large claim splits into calls that fit; contracts owing the same tokens share one", () => {
  const big = { id: 1n, owed: Array.from({ length: 40 }, (_, i) => owed(i % 8, Math.floor(i / 8))) };
  const calls = claimCalls(big);
  assert.ok(calls.length > 1);
  for (const call of calls) assert.ok(claimGas(call.owed) <= 12_000_000n);
  assert.equal(calls.flatMap(({ owed }) => owed).length, 40);
  assert.deepEqual(claimCalls({ id: 1n, owed: [owed(1, 1), owed(2, 1)] }).length, 1);
  for (const call of claimCalls(big, SAFE_CLAIM_CALL_GAS))
    assert.ok(claimGas(call.owed) <= SAFE_CLAIM_CALL_GAS || call.owed.length === 1);
});

test("a Safe's calls go in as few transactions as their gas allows, in order", () => {
  assert.deepEqual(claimTransactions([MAX_CLAIM_GAS / 2n, MAX_CLAIM_GAS / 2n, 1n, MAX_CLAIM_GAS]), [2, 1, 1]);
});

test("the page's receipt sums its own Claimed events for each account", () => {
  const caller = address(99);
  const log = (id: bigint, from: Address, amount: bigint) => ({
    address: DOUBLE_ESPRESSO.address,
    topics: encodeEventTopics({
      abi: ABI.doubleEspresso,
      eventName: "Claimed",
      args: { tokenId: id, owner: address(5), caller: from },
    }) as Hex[],
    data: encodeAbiParameters(parseAbiParameters("address[], uint256[], uint256[], uint256"), [
      [address(1001)],
      [amount],
      [amount / 100n],
      0n,
    ]),
  });
  const found = claimedIn(
    [log(1n, caller, 100n), log(1n, caller, 200n), log(1n, address(3), 5n), log(2n, caller, 9n)],
    [1n],
    caller,
  );
  assert.deepEqual(found, [
    {
      id: 1n,
      received: [{ token: address(1001), amount: 300n }],
      fees: [{ token: address(1001), amount: 3n }],
      paid: [{ token: address(1001), amount: 297n }],
    },
  ]);
});
