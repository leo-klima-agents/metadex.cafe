import assert from "node:assert/strict";
import { test } from "node:test";
import { encodeFunctionData, parseAbi, zeroAddress, type Address } from "viem";
import { CONDUIT, VOTING_ESCROW } from "../src/config.ts";
import { WEEK } from "../src/format.ts";
import {
  canJoin,
  canLeave,
  canRelease,
  group,
  join,
  leave,
  release,
  status,
  type Account,
  type Step,
} from "../src/hydrex.ts";

const OWNER: Address = "0x0208DdBc05a91e1B937E8B3140B62ef22A274C95";
const LIQUID_HYDREX: Address = "0x809F8175b8F60960dF2bc7a78a7C4Eb04d138AF0";
const LOCK_MAXI: Address = "0x53388a4E98Bb56F8571433F5461010Fc287929d3";
const USDC: Address = "0xE57b3Ea02336B9b418cA523aB5aD6f479d93bD1D";
const STRANGER: Address = "0x000000000000000000000000000000000000dEaD";
const START = 1_792_022_400; // Thu 15 Oct 2026, 00:00 UTC
const NOW = START + 86_400;
const STOPPED = 1_788_955_299; // Wed 9 Sep 2026, 12:01 UTC, when USDC last voted
const SINCE = 1_788_998_400; // Thu 10 Sep 2026, 00:00 UTC

const account = (changes: Partial<Account> = {}): Account => ({
  id: 141n,
  name: "",
  amount: 10n ** 18n,
  end: 0,
  lockType: 2,
  votes: 10n ** 18n,
  delegate: OWNER,
  delegateAtStart: OWNER,
  delegateVoted: 0,
  claimer: zeroAddress,
  ...changes,
});
const statusOf = (changes: Partial<Account>) => status(account(changes), OWNER, NOW, START);

// Written apart from src/hydrex.ts, from the verified source on Sourcify.
const abi = parseAbi(["function setConduitApproval(address conduitAddress, uint256 tokenId, bool approve)"]);
const approval = (id: bigint, approve: boolean, conduit: Address = CONDUIT) => ({
  to: VOTING_ESCROW,
  data: encodeFunctionData({ abi, functionName: "setConduitApproval", args: [conduit, id, approve] }),
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

test("an automation that has not voted since the previous epoch began has stopped", () => {
  const stopped = { kind: "stopped", name: "USDC", voted: STOPPED, since: SINCE };
  assert.deepEqual(statusOf({ delegate: USDC, delegateAtStart: USDC, delegateVoted: STOPPED }), stopped);
  assert.deepEqual(statusOf({ delegate: USDC, delegateVoted: START - WEEK - 1 }), {
    kind: "stopped",
    name: "USDC",
    voted: START - WEEK - 1,
    since: START - WEEK,
  });
  assert.deepEqual(statusOf({ delegate: USDC, delegateVoted: START - WEEK }), { kind: "other", name: "USDC" });
  assert.deepEqual(statusOf({ delegate: USDC, delegateVoted: 0 }), { kind: "other", name: "USDC" }, "never voted");
  assert.ok(canJoin(account({ delegate: USDC, claimer: USDC, delegateVoted: STOPPED }), NOW));
});

test("an account that left another automation this epoch votes from the next", () => {
  const released = { kind: "released", name: "USDC", date: START + WEEK };
  assert.deepEqual(statusOf({ delegateAtStart: USDC }), released);
  assert.deepEqual(statusOf({ delegate: zeroAddress, delegateAtStart: USDC }), released);
  assert.deepEqual(statusOf({ delegateAtStart: STRANGER }), { kind: "self" }, "not a known automation");
});

test("accounts are grouped by what their owner can do with them", () => {
  const groupOf = (changes: Partial<Account>) => group(account(changes), statusOf(changes));
  assert.equal(groupOf({ delegate: USDC, delegateAtStart: USDC, delegateVoted: STOPPED }), "stopped");
  assert.equal(groupOf({ claimer: CONDUIT }), "attention");
  assert.equal(groupOf({ delegate: CONDUIT, delegateAtStart: CONDUIT, claimer: CONDUIT }), "in");
  assert.equal(groupOf({ delegate: CONDUIT, claimer: CONDUIT }), "joining");
  assert.equal(groupOf({ delegateAtStart: CONDUIT }), "leaving");
  assert.equal(groupOf({}), "open");
  assert.equal(groupOf({ delegate: USDC, delegateVoted: NOW }), "open", "in a running automation");
  assert.equal(groupOf({ delegate: STRANGER }), "open");
  assert.equal(groupOf({ delegateAtStart: USDC }), "open", "left another automation");
  assert.equal(groupOf({ lockType: 0, end: NOW }), "closed");
  assert.equal(groupOf({ amount: 0n }), "closed");
  assert.equal(groupOf({ amount: 0n, delegate: CONDUIT, claimer: CONDUIT }), "in", "empty, but Carbon Impact holds it");
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

  assert.ok(canRelease(account({ delegate: USDC, claimer: USDC })));
  assert.ok(!canRelease(account({ delegate: CONDUIT, claimer: CONDUIT })), "in Carbon Impact");
  assert.ok(!canRelease(account({ delegate: STRANGER })), "not a known automation");
  assert.ok(!canRelease(account()), "its owner's");
});

test("joining sets the conduit's approval on the VotingEscrow", () => {
  const [step] = join([account()]);
  assert.deepEqual(txs([step!]), [approval(141n, true)]);
  assert.equal(step!.says, "#141 joins Carbon Impact.");
  assert.deepEqual([step!.conduit, step!.id, step!.approve], [CONDUIT, 141n, true]);
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
      "#141 leaves the Liquid Hydrex automation and joins Carbon Impact.",
      "#42 leaves the Hydrex Lock Maxi and USDC automations and joins Carbon Impact.",
      "#7 leaves the USDC automation and joins Carbon Impact.",
    ],
  );
});

test("leaving clears the conduit's approval", () => {
  const steps = leave([account({ delegate: CONDUIT, claimer: CONDUIT }), account({ id: 42n, claimer: CONDUIT })]);
  assert.deepEqual(txs(steps), [approval(141n, false), approval(42n, false)]);
  assert.equal(steps[1]!.says, "#42 leaves Carbon Impact.");
});

test("leaving another automation clears its approval, named by its address", () => {
  const steps = release([account({ delegate: USDC, claimer: USDC }), account({ id: 42n, delegate: LOCK_MAXI })]);
  assert.deepEqual(txs(steps), [approval(141n, false, USDC), approval(42n, false, LOCK_MAXI)]);
  assert.deepEqual(
    steps.map(({ says, id, approve, conduit, automation }) => ({ says, id, approve, conduit, automation })),
    [
      {
        says: "#141 leaves the USDC automation.",
        id: 141n,
        approve: false,
        conduit: USDC,
        automation: "USDC",
      },
      {
        says: "#42 leaves the Hydrex Lock Maxi automation.",
        id: 42n,
        approve: false,
        conduit: LOCK_MAXI,
        automation: "Hydrex Lock Maxi",
      },
    ],
  );
  assert.deepEqual(release([account({ delegate: STRANGER })]), [], "not on Hydrex's list");
  const [joining] = join([account({ delegate: USDC })]);
  assert.equal(joining!.conduit, CONDUIT);
  assert.ok(!("automation" in joining!), "Carbon Impact's call names no other automation");
});
