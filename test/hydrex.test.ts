import assert from "node:assert/strict";
import { test } from "node:test";
import {
  decodeFunctionData,
  encodeAbiParameters,
  encodeFunctionData,
  encodeFunctionResult,
  parseAbi,
  toFunctionSelector,
  zeroAddress,
  type Address,
  type Hex,
} from "viem";
import { AUTOMAXI, CARBON_IMPACT, VOTING_ESCROW, type Automation } from "../src/config.ts";
import { WEEK } from "../src/format.ts";
import {
  canJoin,
  canLeave,
  canLeaveOther,
  groupOf,
  join,
  leave,
  leaveOther,
  readAccount,
  statusOf,
  type Account,
  type Step,
} from "../src/hydrex.ts";

const OWNER: Address = "0x0208DdBc05a91e1B937E8B3140B62ef22A274C95";
const LIQUID_HYDREX: Address = "0x809F8175b8F60960dF2bc7a78a7C4Eb04d138AF0";
const LOCK_MAXI: Address = "0x53388a4E98Bb56F8571433F5461010Fc287929d3";
const USDC: Address = "0xE57b3Ea02336B9b418cA523aB5aD6f479d93bD1D";
const STRANGER: Address = "0x000000000000000000000000000000000000dEaD";
const CONDUIT = CARBON_IMPACT.address;
const MAXI = AUTOMAXI.address;
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
const statusWith = (changes: Partial<Account>, automations?: Automation[]) =>
  statusOf(account(changes), OWNER, NOW, START, automations);
const groupWith = (changes: Partial<Account>) => groupOf(account(changes), statusWith(changes));
const inCarbonImpact = { automation: CARBON_IMPACT };

// Written separately from src/hydrex.ts, from the verified source on Sourcify.
const abi = parseAbi(["function setConduitApproval(address conduitAddress, uint256 tokenId, bool approve)"]);
const approval = (id: bigint, approve: boolean, conduit: Address = CONDUIT) => ({
  to: VOTING_ESCROW,
  data: encodeFunctionData({ abi, functionName: "setConduitApproval", args: [conduit, id, approve] }),
});
const txs = (steps: Step[]) => steps.map(({ to, data }) => ({ to, data }));
const canJoinIt = (changes: Partial<Account>) => canJoin(account(changes), CARBON_IMPACT, NOW);
const canLeaveIt = (changes: Partial<Account>) => canLeave(account(changes), CARBON_IMPACT);

test("in Carbon Impact, joined this epoch, and left this epoch", () => {
  assert.deepEqual(statusWith({ delegate: CONDUIT, delegateAtStart: CONDUIT, claimer: CONDUIT }), {
    kind: "in",
    ...inCarbonImpact,
  });
  assert.deepEqual(statusWith({ delegate: CONDUIT, claimer: CONDUIT }), {
    kind: "joined",
    ...inCarbonImpact,
    date: START + WEEK,
  });
  assert.deepEqual(statusWith({ delegateAtStart: CONDUIT }), { kind: "left", ...inCarbonImpact, date: START + WEEK });
});

test("votes without claims, or claims without votes, is only partly in", () => {
  assert.deepEqual(statusWith({ delegate: CONDUIT, delegateAtStart: CONDUIT }), { kind: "partly", ...inCarbonImpact });
  assert.deepEqual(statusWith({ claimer: CONDUIT }), { kind: "partly", ...inCarbonImpact });
  assert.deepEqual(statusWith({ delegate: MAXI, claimer: CONDUIT }), { kind: "partly", automation: AUTOMAXI });
});

test("other delegates: the owner, nobody, another automation on Hydrex's list, any other address", () => {
  assert.deepEqual(statusWith({}), { kind: "self" });
  assert.deepEqual(statusWith({ delegate: zeroAddress }), { kind: "self" });
  assert.deepEqual(statusWith({ delegate: USDC.toLowerCase() as Address }), { kind: "other", name: "USDC" });
  assert.deepEqual(statusWith({ delegate: STRANGER }), { kind: "delegated", to: STRANGER });
});

test("an automation that has not voted since the previous epoch began has stopped", () => {
  const stopped = { kind: "stopped", name: "USDC", voted: STOPPED, since: SINCE };
  assert.deepEqual(statusWith({ delegate: USDC, delegateAtStart: USDC, delegateVoted: STOPPED }), stopped);
  assert.deepEqual(statusWith({ delegate: USDC, delegateVoted: START - WEEK - 1 }), {
    kind: "stopped",
    name: "USDC",
    voted: START - WEEK - 1,
    since: START - WEEK,
  });
  assert.deepEqual(statusWith({ delegate: USDC, delegateVoted: START - WEEK }), { kind: "other", name: "USDC" });
  assert.deepEqual(statusWith({ delegate: USDC, delegateVoted: 0 }), { kind: "other", name: "USDC" }, "never voted");
  assert.ok(canJoinIt({ delegate: USDC, claimer: USDC, delegateVoted: STOPPED }));
});

test("an account that left another automation this epoch votes from the next", () => {
  const left = { kind: "left-other", name: "USDC", date: START + WEEK };
  assert.deepEqual(statusWith({ delegateAtStart: USDC }), left);
  assert.deepEqual(statusWith({ delegate: zeroAddress, delegateAtStart: USDC }), left);
  assert.deepEqual(statusWith({ delegateAtStart: STRANGER }), { kind: "self" }, "not a known automation");
});

test("accounts are grouped by what their owner can do with them", () => {
  assert.equal(groupWith({ delegate: USDC, delegateAtStart: USDC, delegateVoted: STOPPED }), "needs");
  assert.equal(groupWith({ claimer: CONDUIT }), "needs", "partly in");
  assert.equal(groupWith({ delegate: CONDUIT, delegateAtStart: CONDUIT, claimer: CONDUIT }), "in:carbon-impact");
  assert.equal(groupWith({ delegate: MAXI, delegateAtStart: MAXI, claimer: MAXI }), "in:automaxi");
  assert.equal(groupWith({ delegate: CONDUIT, claimer: CONDUIT }), "in:carbon-impact", "joining");
  assert.equal(groupWith({ delegateAtStart: CONDUIT }), "other", "leaving");
  assert.equal(groupWith({}), "other");
  assert.equal(groupWith({ delegate: USDC, delegateVoted: NOW }), "other", "in a running automation");
  assert.equal(groupWith({ delegate: STRANGER }), "other");
  assert.equal(groupWith({ delegateAtStart: USDC }), "other", "left another automation");
  assert.equal(groupWith({ lockType: 0, end: NOW }), "closed");
  assert.equal(groupWith({ amount: 0n }), "closed");
  assert.equal(groupWith({ amount: 0n, delegate: CONDUIT, claimer: CONDUIT }), "in:carbon-impact", "empty, but in");
});

test("an empty account or an ended lock says so first", () => {
  assert.deepEqual(statusWith({ amount: 0n, delegate: CONDUIT, claimer: CONDUIT }), { kind: "empty" });
  assert.deepEqual(statusWith({ lockType: 0, end: NOW }), { kind: "ended" });
  assert.deepEqual(statusWith({ lockType: 0, end: NOW + 1 }), { kind: "self" });
  assert.deepEqual(statusWith({ lockType: 1, end: 0 }), { kind: "self" });
});

test("who can join and who can leave", () => {
  assert.ok(canJoinIt({}));
  assert.ok(canJoinIt({ delegate: USDC }), "in another automation");
  assert.ok(canJoinIt({ delegate: MAXI, claimer: MAXI }), "in AutoMaxi");
  assert.ok(canJoinIt({ claimer: CONDUIT }), "partly in");
  assert.ok(!canJoinIt({ delegate: CONDUIT, claimer: CONDUIT }), "already in");
  assert.ok(!canJoinIt({ amount: 0n }), "empty");
  assert.ok(!canJoinIt({ lockType: 0, end: NOW }), "lock ended");
  assert.ok(canJoinIt({ lockType: 0, end: NOW + 1 }), "lock not ended yet");
  assert.ok(canJoin(account({ delegate: CONDUIT, claimer: CONDUIT }), AUTOMAXI, NOW), "in Carbon Impact");

  assert.ok(canLeaveIt({ delegate: CONDUIT, claimer: CONDUIT }));
  assert.ok(canLeaveIt({ claimer: CONDUIT }), "partly in");
  assert.ok(canLeaveIt({ amount: 0n, delegate: CONDUIT, claimer: CONDUIT }), "empty but in");
  assert.ok(!canLeaveIt({ delegate: USDC, claimer: USDC }), "in another automation");
  assert.ok(!canLeaveIt({ delegate: MAXI, claimer: MAXI }), "in AutoMaxi");
  assert.ok(canLeave(account({ delegate: MAXI, claimer: MAXI }), AUTOMAXI));

  assert.ok(canLeaveOther(account({ delegate: USDC, claimer: USDC })));
  assert.ok(!canLeaveOther(account({ delegate: CONDUIT, claimer: CONDUIT })), "in Carbon Impact");
  assert.ok(!canLeaveOther(account({ delegate: STRANGER })), "not a known automation");
  assert.ok(!canLeaveOther(account()), "its owner's");
});

test("joining sets the conduit's approval on the VotingEscrow", () => {
  const [step] = join([account()], CARBON_IMPACT);
  assert.deepEqual(txs([step!]), [approval(141n, true)]);
  assert.equal(step!.says, "#141 joins Carbon Impact.");
  assert.deepEqual([step!.conduit, step!.id, step!.approve], [CONDUIT, 141n, true]);
  assert.equal(step!.on, "Hydrex's VotingEscrow");
  assert.equal(step!.conduitName, "Carbon Impact");
});

test("an account in other automations joins directly, one call per account, naming what it leaves", () => {
  const steps = join(
    [
      account({ delegate: LIQUID_HYDREX, claimer: LIQUID_HYDREX }),
      account({ id: 42n, delegate: LOCK_MAXI, claimer: USDC }),
      account({ id: 7n, claimer: USDC }),
    ],
    CARBON_IMPACT,
  );
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
  const steps = leave(
    [account({ delegate: CONDUIT, claimer: CONDUIT }), account({ id: 42n, claimer: CONDUIT })],
    CARBON_IMPACT,
  );
  assert.deepEqual(txs(steps), [approval(141n, false), approval(42n, false)]);
  assert.equal(steps[1]!.says, "#42 leaves Carbon Impact.");
});

test("leaving another automation clears its approval, named by its address", () => {
  const steps = leaveOther([account({ delegate: USDC, claimer: USDC }), account({ id: 42n, delegate: LOCK_MAXI })]);
  assert.deepEqual(txs(steps), [approval(141n, false, USDC), approval(42n, false, LOCK_MAXI)]);
  assert.deepEqual(
    steps.map(({ says, id, approve, conduit, conduitName, automation }) => ({
      says,
      id,
      approve,
      conduit,
      conduitName,
      automation,
    })),
    [
      {
        says: "#141 leaves the USDC automation.",
        id: 141n,
        approve: false,
        conduit: USDC,
        conduitName: "The USDC automation",
        automation: "USDC",
      },
      {
        says: "#42 leaves the Hydrex Lock Maxi automation.",
        id: 42n,
        approve: false,
        conduit: LOCK_MAXI,
        conduitName: "The Hydrex Lock Maxi automation",
        automation: "Hydrex Lock Maxi",
      },
    ],
  );
  assert.deepEqual(leaveOther([account({ delegate: STRANGER })]), [], "not on Hydrex's list");
  const [joining] = join([account({ delegate: USDC })], CARBON_IMPACT);
  assert.equal(joining!.conduit, CONDUIT);
  assert.ok(!("automation" in joining!), "Carbon Impact's call names no other automation");
});

test("AutoMaxi: in it, joining it, and moving between the two in one call, which takes the votes and the claims", () => {
  const maxi = { automation: AUTOMAXI };
  assert.deepEqual(statusWith({ delegate: MAXI, delegateAtStart: MAXI, claimer: MAXI }), { kind: "in", ...maxi });
  assert.deepEqual(statusWith({ delegate: MAXI, delegateAtStart: CONDUIT, claimer: MAXI }), {
    kind: "joined",
    ...maxi,
    date: START + WEEK,
  });
  const [move] = join([account({ delegate: CONDUIT, delegateAtStart: CONDUIT, claimer: CONDUIT })], AUTOMAXI);
  assert.deepEqual(txs([move!]), [approval(141n, true, MAXI)]);
  assert.equal(move!.says, "#141 leaves Carbon Impact and joins AutoMaxi.");
  assert.equal(move!.conduitName, "AutoMaxi");
  const [back] = join([account({ delegate: MAXI, claimer: MAXI })], CARBON_IMPACT);
  assert.equal(back!.says, "#141 leaves AutoMaxi and joins Carbon Impact.");
  const [both] = join([account({ delegate: USDC, claimer: CONDUIT })], AUTOMAXI);
  assert.equal(both!.says, "#141 leaves Carbon Impact and the USDC automation and joins AutoMaxi.");
  assert.deepEqual(txs(leave([account({ delegate: MAXI, claimer: MAXI })], AUTOMAXI)), [approval(141n, false, MAXI)]);
});

test("until AutoMaxi is on Base, the page leaves it out", () => {
  const changes = { delegate: MAXI, delegateAtStart: MAXI, claimer: MAXI };
  assert.deepEqual(statusWith(changes, [CARBON_IMPACT]), { kind: "delegated", to: MAXI });
  assert.equal(groupOf(account(changes), statusWith(changes, [CARBON_IMPACT]), [CARBON_IMPACT]), "other");
});

test("an account whose ownerOf fails is asked again on its own before it is taken for gone", async () => {
  const multicall = parseAbi([
    "function aggregate3((address target, bool allowFailure, bytes callData)[] calls) payable returns ((bool success, bytes returnData)[])",
  ]);
  const ownerOf = toFunctionSelector("function ownerOf(uint256)");
  const timestamp = toFunctionSelector("function getCurrentBlockTimestamp()");
  // What each ownerOf answers in turn, undefined for a call that fails; every other call fails but the block's time.
  let owners: (Address | undefined)[] = [];
  let asked = 0;
  const original = globalThis.fetch;
  globalThis.fetch = async (_, init) => {
    const { params } = JSON.parse(String(init?.body)) as { params: [{ data: Hex }] };
    const { args } = decodeFunctionData({ abi: multicall, data: params[0].data });
    const replies = args[0].map(({ callData }) => {
      const failed = { success: false, returnData: "0x" as Hex };
      if (callData.startsWith(ownerOf)) {
        const owner = owners[asked++];
        return owner ? { success: true, returnData: encodeAbiParameters([{ type: "address" }], [owner]) } : failed;
      }
      if (callData.startsWith(timestamp))
        return { success: true, returnData: encodeAbiParameters([{ type: "uint256" }], [1_792_627_200n]) };
      return failed;
    });
    const result = encodeFunctionResult({ abi: multicall, functionName: "aggregate3", result: replies });
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result }));
  };
  try {
    owners = [undefined, undefined];
    assert.equal(await readAccount(9540n), undefined, "it fails again: Hydrex has no such account");
    assert.equal(asked, 2);
    // It answers the second time: the account is read, and fails here on its details, rather than being taken for gone.
    [owners, asked] = [[undefined, OWNER], 0];
    await assert.rejects(readAccount(9540n), /A read from Base failed/);
    assert.equal(asked, 2);
  } finally {
    globalThis.fetch = original;
  }
});
