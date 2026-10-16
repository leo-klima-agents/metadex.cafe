import assert from "node:assert/strict";
import { test } from "node:test";
import { encodeFunctionData, parseAbi, type Address } from "viem";
import { join, leave, payout } from "../src/calls.ts";
import { CONDUIT, VOTING_ESCROW } from "../src/config.ts";
import { canJoin, canLeave, type Account } from "../src/hydrex.ts";

// Written apart from src/abi.ts, from the verified sources on Sourcify and in hydrex-periphery.
const abi = parseAbi([
  "function setConduitApproval(address conduitAddress, uint256 tokenId, bool approve)",
  "function setMyPayoutRecipient(address newRecipient)",
]);
const approval = (conduit: Address, id: bigint, approve: boolean) => ({
  to: VOTING_ESCROW,
  data: encodeFunctionData({ abi, functionName: "setConduitApproval", args: [conduit, id, approve] }),
});

const OWNER: Address = "0x0208DdBc05a91e1B937E8B3140B62ef22A274C95";
const LIQUID_HYDREX: Address = "0x809F8175b8F60960dF2bc7a78a7C4Eb04d138AF0";
const LOCK_MAXI: Address = "0x53388a4E98Bb56F8571433F5461010Fc287929d3";
const USDC_CONDUIT: Address = "0xE57b3Ea02336B9b418cA523aB5aD6f479d93bD1D";
const ZERO: Address = "0x0000000000000000000000000000000000000000";
const NOW = 1_792_195_200;

const account = (changes: Partial<Account> = {}): Account => ({
  id: 141n,
  name: "",
  amount: 10n ** 18n,
  end: 0,
  lockType: 2,
  votes: 10n ** 18n,
  delegate: OWNER,
  delegateAtStart: OWNER,
  claimer: ZERO,
  ...changes,
});
const calls = (steps: { to: Address; data: string }[]) => steps.map(({ to, data }) => ({ to, data }));

test("joining sets the conduit's approval on the VotingEscrow", () => {
  const steps = join([account()]);
  assert.deepEqual(calls(steps), [approval(CONDUIT, 141n, true)]);
  assert.equal(steps[0]!.says, "Put #141 in the Carbon Impact automation.");
  assert.equal(steps[0]!.shows, `setConduitApproval(${CONDUIT}, 141, true)`);
  assert.equal(steps[0]!.on, "Hydrex's VotingEscrow");
});

test("an account in another automation is taken out of it before it joins", () => {
  const steps = join([account({ delegate: LIQUID_HYDREX, claimer: LIQUID_HYDREX }), account({ id: 42n })]);
  assert.deepEqual(calls(steps), [
    approval(LIQUID_HYDREX, 141n, false),
    approval(CONDUIT, 141n, true),
    approval(CONDUIT, 42n, true),
  ]);
  assert.equal(steps[0]!.says, "Take #141 out of the Liquid Hydrex automation.");
});

test("an account split between two other automations is taken out of both", () => {
  const steps = join([account({ delegate: LOCK_MAXI, claimer: USDC_CONDUIT })]);
  assert.deepEqual(calls(steps), [
    approval(LOCK_MAXI, 141n, false),
    approval(USDC_CONDUIT, 141n, false),
    approval(CONDUIT, 141n, true),
  ]);
});

test("leaving clears the conduit's approval, and the payout address is set on the conduit", () => {
  assert.deepEqual(calls(leave([account({ delegate: CONDUIT, claimer: CONDUIT })])), [approval(CONDUIT, 141n, false)]);
  const step = payout(OWNER);
  assert.deepEqual(calls([step]), [
    { to: CONDUIT, data: encodeFunctionData({ abi, functionName: "setMyPayoutRecipient", args: [OWNER] }) },
  ]);
  assert.equal(step.shows, `setMyPayoutRecipient(${OWNER})`);
});

test("who can join and who can leave", () => {
  assert.ok(canJoin(account(), NOW));
  assert.ok(canJoin(account({ delegate: USDC_CONDUIT }), NOW), "in another automation");
  assert.ok(canJoin(account({ claimer: CONDUIT }), NOW), "partly in");
  assert.ok(!canJoin(account({ delegate: CONDUIT, claimer: CONDUIT }), NOW), "already in");
  assert.ok(!canJoin(account({ amount: 0n }), NOW), "empty");
  assert.ok(!canJoin(account({ lockType: 0, end: NOW }), NOW), "lock ended");
  assert.ok(canJoin(account({ lockType: 0, end: NOW + 1 }), NOW), "lock not ended yet");

  assert.ok(canLeave(account({ delegate: CONDUIT, claimer: CONDUIT })));
  assert.ok(canLeave(account({ claimer: CONDUIT })), "partly in");
  assert.ok(canLeave(account({ amount: 0n, delegate: CONDUIT, claimer: CONDUIT })), "empty but in");
  assert.ok(!canLeave(account({ delegate: USDC_CONDUIT, claimer: USDC_CONDUIT })), "in another automation");
});
