import assert from "node:assert/strict";
import { test } from "node:test";
import { encodeFunctionData, parseAbi, zeroAddress, type Address } from "viem";
import { DOUBLE_ESPRESSO, MATCHA_LATTE, VOTING_ESCROW } from "../src/config.ts";
import { WEEK } from "../src/format.ts";
import {
  canJoin,
  canLeave,
  groupOf,
  join,
  leave,
  leaveOther,
  paidBpsOf,
  statusOf,
  type Account,
} from "../src/hydrex.ts";

const OWNER: Address = "0x0208DdBc05a91e1B937E8B3140B62ef22A274C95";
const USDC_AUTOMATION: Address = "0xE57b3Ea02336B9b418cA523aB5aD6f479d93bD1D";
const STRANGER: Address = "0x000000000000000000000000000000000000dEaD";
const ML = MATCHA_LATTE.address;
const DE = DOUBLE_ESPRESSO.address;
const START = 1_792_022_400; // Thu 15 Oct 2026
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
  delegateVoted: 0,
  ownerVoted: NOW,
  claimer: zeroAddress,
  ...changes,
});
const status = (changes: Partial<Account>) => statusOf(account(changes), OWNER, NOW, START);
const group = (changes: Partial<Account>) => groupOf(account(changes), status(changes));

test("statuses: in, joined, left, partly, self, unvoted, stopped, other, delegated, ended, empty", () => {
  assert.equal(status({ delegate: ML, delegateAtStart: ML, claimer: ML }).kind, "in");
  assert.deepEqual(status({ delegate: ML, claimer: ML }), {
    kind: "joined",
    automation: MATCHA_LATTE,
    date: START + WEEK,
  });
  assert.deepEqual(status({ delegateAtStart: ML }), { kind: "left", automation: MATCHA_LATTE, date: START + WEEK });
  assert.equal(status({ delegate: ML }).kind, "partly");
  assert.equal(status({ claimer: DE }).kind, "partly");
  assert.equal(status({}).kind, "self");
  assert.equal(status({ delegate: zeroAddress }).kind, "self");
  assert.deepEqual(status({ ownerVoted: START - WEEK - 1 }), { kind: "unvoted", voted: START - WEEK - 1 });
  const stopped = status({ delegate: USDC_AUTOMATION, delegateVoted: START - 3 * WEEK });
  assert.equal(stopped.kind, "stopped");
  assert.deepEqual(status({ delegate: USDC_AUTOMATION, delegateVoted: START - 1 }), { kind: "other", name: "USDC" });
  assert.deepEqual(status({ delegateAtStart: USDC_AUTOMATION }), {
    kind: "left-other",
    name: "USDC",
    date: START + WEEK,
  });
  assert.deepEqual(status({ delegate: STRANGER }), { kind: "delegated", to: STRANGER });
  assert.equal(status({ lockType: 0, end: NOW }).kind, "ended");
  assert.equal(status({ amount: 0n }).kind, "empty");
});

test("groups: what needs the owner by remedy, those in each automation, the rest", () => {
  assert.equal(group({ delegate: USDC_AUTOMATION, delegateVoted: START - 3 * WEEK }), "needs:stopped");
  assert.equal(group({ delegate: ML }), "needs:partly");
  assert.equal(group({ ownerVoted: 0 }), "needs:unvoted");
  assert.equal(group({ ownerVoted: 0, votes: 1n }), "closed");
  assert.equal(group({ amount: 0n, claimer: DE }), "in:double-espresso");
  assert.equal(group({ delegate: DE, claimer: DE }), "in:double-espresso");
  assert.equal(group({}), "other");
});

test("who can join and leave", () => {
  assert.equal(canJoin(account(), MATCHA_LATTE, NOW), true);
  assert.equal(canJoin(account({ delegate: ML, claimer: ML }), MATCHA_LATTE, NOW), false);
  assert.equal(canJoin(account({ lockType: 0, end: NOW }), MATCHA_LATTE, NOW), false);
  assert.equal(canLeave(account({ claimer: ML }), MATCHA_LATTE), true);
  assert.equal(canLeave(account(), MATCHA_LATTE), false);
});

test("join, leave and leaving another automation set the conduit's approval, naming what a join takes over", () => {
  // From the verified source, apart from src/config.ts.
  const abi = parseAbi(["function setConduitApproval(address conduitAddress, uint256 tokenId, bool approve)"]);
  const data = (conduit: Address, approve: boolean) =>
    encodeFunctionData({ abi, functionName: "setConduitApproval", args: [conduit, 141n, approve] });
  const [joined] = join([account({ delegate: USDC_AUTOMATION, claimer: DE })], MATCHA_LATTE);
  assert.deepEqual([joined!.to, joined!.data], [VOTING_ESCROW, data(ML, true)]);
  assert.deepEqual(joined!.leaving, ["Double Espresso", "the USDC automation"]);
  assert.equal(leave([account()], DOUBLE_ESPRESSO)[0]!.data, data(DE, false));
  const [other] = leaveOther([account({ delegate: USDC_AUTOMATION }), account()]);
  assert.deepEqual([other!.data, other!.name, other!.other], [data(USDC_AUTOMATION, false), "USDC", true]);
});

test("what reaches Matcha Latte's owners: the share retired, then the fee, unknown with the fee", () => {
  const settings = { epochStart: START, retireBps: 3333n, tonnes: 0n };
  assert.equal(paidBpsOf(settings), undefined);
  assert.equal(paidBpsOf({ ...settings, feeBps: 100n }), 6600n);
});
