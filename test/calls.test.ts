import assert from "node:assert/strict";
import { test } from "node:test";
import { encodeFunctionData, parseAbi, zeroAddress, type Address } from "viem";
import { join, leave } from "../src/calls.ts";
import { CONDUIT, VOTING_ESCROW } from "../src/config.ts";
import { canJoin, canLeave, type Account } from "../src/hydrex.ts";

// Written apart from src/abi.ts, from the verified sources on Sourcify and in hydrex-periphery.
const abi = parseAbi(["function setConduitApproval(address conduitAddress, uint256 tokenId, bool approve)"]);
const approval = (conduit: Address, id: bigint, approve: boolean) => ({
  to: VOTING_ESCROW,
  data: encodeFunctionData({ abi, functionName: "setConduitApproval", args: [conduit, id, approve] }),
});

const OWNER: Address = "0x0208DdBc05a91e1B937E8B3140B62ef22A274C95";
const LIQUID_HYDREX: Address = "0x809F8175b8F60960dF2bc7a78a7C4Eb04d138AF0";
const LOCK_MAXI: Address = "0x53388a4E98Bb56F8571433F5461010Fc287929d3";
const USDC_CONDUIT: Address = "0xE57b3Ea02336B9b418cA523aB5aD6f479d93bD1D";
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
  claimer: zeroAddress,
  ...changes,
});
const calls = (steps: { to: Address; data: string }[]) => steps.map(({ to, data }) => ({ to, data }));

test("joining sets the conduit's approval on the VotingEscrow", () => {
  const steps = join([account()]);
  assert.deepEqual(calls(steps), [approval(CONDUIT, 141n, true)]);
  assert.equal(steps[0]!.says, "#141 joins the Carbon Impact automation.");
  assert.equal(steps[0]!.shows, `setConduitApproval(${CONDUIT}, 141, true)`);
  assert.equal(steps[0]!.on, "Hydrex's VotingEscrow");
});

test("an account in other automations joins directly, one call per account, naming what it leaves", () => {
  const steps = join([
    account({ delegate: LIQUID_HYDREX, claimer: LIQUID_HYDREX }),
    account({ id: 42n, delegate: LOCK_MAXI, claimer: USDC_CONDUIT }),
    account({ id: 7n, claimer: USDC_CONDUIT }),
  ]);
  assert.deepEqual(calls(steps), [
    approval(CONDUIT, 141n, true),
    approval(CONDUIT, 42n, true),
    approval(CONDUIT, 7n, true),
  ]);
  assert.equal(steps[0]!.says, "#141 leaves the Liquid Hydrex automation and joins the Carbon Impact automation.");
  assert.equal(
    steps[1]!.says,
    "#42 leaves the Hydrex Lock Maxi and USDC automations and joins the Carbon Impact automation.",
  );
  assert.equal(steps[2]!.says, "#7 leaves the USDC automation and joins the Carbon Impact automation.");
});

test("leaving clears the conduit's approval", () => {
  const steps = leave([account({ delegate: CONDUIT, claimer: CONDUIT }), account({ id: 42n, claimer: CONDUIT })]);
  assert.deepEqual(calls(steps), [approval(CONDUIT, 141n, false), approval(CONDUIT, 42n, false)]);
  assert.equal(steps[1]!.says, "#42 leaves the Carbon Impact automation.");
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
