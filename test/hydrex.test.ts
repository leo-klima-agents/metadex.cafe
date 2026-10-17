import assert from "node:assert/strict";
import { test } from "node:test";
import { encodeFunctionData, parseAbi, zeroAddress, type Address } from "viem";
import { CONDUIT, VOTING_ESCROW } from "../src/config.ts";
import { WEEK } from "../src/format.ts";
import { canJoin, canLeave, join, leave, status, type Account, type Step } from "../src/hydrex.ts";

const OWNER: Address = "0x0208DdBc05a91e1B937E8B3140B62ef22A274C95";
const LIQUID_HYDREX: Address = "0x809F8175b8F60960dF2bc7a78a7C4Eb04d138AF0";
const LOCK_MAXI: Address = "0x53388a4E98Bb56F8571433F5461010Fc287929d3";
const USDC: Address = "0xE57b3Ea02336B9b418cA523aB5aD6f479d93bD1D";
const STRANGER: Address = "0x000000000000000000000000000000000000dEaD";
const START = 1_792_022_400; // Thu 15 Oct 2026, 00:00 UTC
const NOW = START + 86_400;

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
const statusOf = (changes: Partial<Account>) => status(account(changes), OWNER, NOW, START);

// Written apart from src/hydrex.ts, from the verified source on Sourcify.
const abi = parseAbi(["function setConduitApproval(address conduitAddress, uint256 tokenId, bool approve)"]);
const approval = (id: bigint, approve: boolean) => ({
  to: VOTING_ESCROW,
  data: encodeFunctionData({ abi, functionName: "setConduitApproval", args: [CONDUIT, id, approve] }),
});
const txs = (steps: Step[]) => steps.map(({ to, data }) => ({ to, data }));

test("in the automation, joined this week, and left this week", () => {
  assert.deepEqual(statusOf({ delegate: CONDUIT, delegateAtStart: CONDUIT, claimer: CONDUIT }), { kind: "in" });
  assert.deepEqual(statusOf({ delegate: CONDUIT, claimer: CONDUIT }), { kind: "joined", date: START + WEEK });
  assert.deepEqual(statusOf({ delegateAtStart: CONDUIT }), { kind: "left", date: START + WEEK });
});

test("votes without claims, or claims without votes, is only partly in", () => {
  assert.deepEqual(statusOf({ delegate: CONDUIT, delegateAtStart: CONDUIT }), { kind: "partly" });
  assert.deepEqual(statusOf({ claimer: CONDUIT }), { kind: "partly" });
});

test("other delegates: the owner, nobody, another automation on Hydrex's list, any other address", () => {
  assert.deepEqual(statusOf({}), { kind: "self" });
  assert.deepEqual(statusOf({ delegate: zeroAddress }), { kind: "self" });
  assert.deepEqual(statusOf({ delegate: USDC.toLowerCase() as Address }), { kind: "other", name: "USDC" });
  assert.deepEqual(statusOf({ delegate: STRANGER }), { kind: "delegated", to: STRANGER });
});

test("an empty account or an ended lock says so first", () => {
  assert.deepEqual(statusOf({ amount: 0n, delegate: CONDUIT, claimer: CONDUIT }), { kind: "empty" });
  assert.deepEqual(statusOf({ lockType: 0, end: NOW }), { kind: "ended" });
  assert.deepEqual(statusOf({ lockType: 0, end: NOW + 1 }), { kind: "self" });
  assert.deepEqual(statusOf({ lockType: 1, end: 0 }), { kind: "self" });
});

test("who can join and who can leave", () => {
  assert.ok(canJoin(account(), NOW));
  assert.ok(canJoin(account({ delegate: USDC }), NOW), "in another automation");
  assert.ok(canJoin(account({ claimer: CONDUIT }), NOW), "partly in");
  assert.ok(!canJoin(account({ delegate: CONDUIT, claimer: CONDUIT }), NOW), "already in");
  assert.ok(!canJoin(account({ amount: 0n }), NOW), "empty");
  assert.ok(!canJoin(account({ lockType: 0, end: NOW }), NOW), "lock ended");
  assert.ok(canJoin(account({ lockType: 0, end: NOW + 1 }), NOW), "lock not ended yet");

  assert.ok(canLeave(account({ delegate: CONDUIT, claimer: CONDUIT })));
  assert.ok(canLeave(account({ claimer: CONDUIT })), "partly in");
  assert.ok(canLeave(account({ amount: 0n, delegate: CONDUIT, claimer: CONDUIT })), "empty but in");
  assert.ok(!canLeave(account({ delegate: USDC, claimer: USDC })), "in another automation");
});

test("joining sets the conduit's approval on the VotingEscrow", () => {
  const [step] = join([account()]);
  assert.deepEqual(txs([step!]), [approval(141n, true)]);
  assert.equal(step!.says, "#141 joins the Carbon Impact automation.");
  assert.equal(step!.shows, `setConduitApproval(${CONDUIT}, 141, true)`);
  assert.equal(step!.on, "Hydrex's VotingEscrow");
});

test("an account in other automations joins directly, one call per account, naming what it leaves", () => {
  const steps = join([
    account({ delegate: LIQUID_HYDREX, claimer: LIQUID_HYDREX }),
    account({ id: 42n, delegate: LOCK_MAXI, claimer: USDC }),
    account({ id: 7n, claimer: USDC }),
  ]);
  assert.deepEqual(txs(steps), [approval(141n, true), approval(42n, true), approval(7n, true)]);
  assert.deepEqual(
    steps.map(({ says }) => says),
    [
      "#141 leaves the Liquid Hydrex automation and joins the Carbon Impact automation.",
      "#42 leaves the Hydrex Lock Maxi and USDC automations and joins the Carbon Impact automation.",
      "#7 leaves the USDC automation and joins the Carbon Impact automation.",
    ],
  );
});

test("leaving clears the conduit's approval", () => {
  const steps = leave([account({ delegate: CONDUIT, claimer: CONDUIT }), account({ id: 42n, claimer: CONDUIT })]);
  assert.deepEqual(txs(steps), [approval(141n, false), approval(42n, false)]);
  assert.equal(steps[1]!.says, "#42 leaves the Carbon Impact automation.");
});
