import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import {
  decodeFunctionData,
  encodeAbiParameters,
  encodeFunctionData,
  encodeFunctionResult,
  parseAbi,
  parseAbiParameters,
  toFunctionSelector,
  zeroAddress,
  type Address,
  type Hex,
} from "viem";
import * as config from "../src/config.ts";
import { WEEK } from "../src/format.ts";
import {
  canJoin,
  canLeave,
  canLeaveOther,
  groupOf,
  join,
  leave,
  leaveOther,
  paidBpsOf,
  readAccount,
  statusOf,
  type Account,
} from "../src/hydrex.ts";
import { failedChecks } from "../src/checks.ts";
import type { Slip } from "../src/wallet.ts";

const OWNER: Address = "0x0208DdBc05a91e1B937E8B3140B62ef22A274C95";
const LIQUID_HYDREX: Address = "0x809F8175b8F60960dF2bc7a78a7C4Eb04d138AF0";
const LOCK_MAXI: Address = "0x53388a4E98Bb56F8571433F5461010Fc287929d3";
const USDC: Address = "0xE57b3Ea02336B9b418cA523aB5aD6f479d93bD1D";
const STRANGER: Address = "0x000000000000000000000000000000000000dEaD";
const { DOUBLE_ESPRESSO, MATCHA_LATTE, VOTING_ESCROW } = config;
const CONDUIT = MATCHA_LATTE.address;
const MAXI = DOUBLE_ESPRESSO.address;
const START = 1_792_022_400; // Thu 15 Oct 2026, 00:00 UTC
const NOW = START + 86_400;
const STOPPED = 1_788_955_299; // Wed 9 Sep 2026, when USDC last voted
const NEXT = START + WEEK;

const BASE = { id: 141n, name: "", amount: 10n ** 18n, end: 0, lockType: 2, votes: 10n ** 18n, delegateVoted: 0 };
const HELD = { delegate: OWNER, delegateAtStart: OWNER, ownerVoted: NOW, claimer: zeroAddress };
const account = (changes: Partial<Account> = {}): Account => ({ ...BASE, ...HELD, ...changes });
const status = (changes: Partial<Account>) => statusOf(account(changes), OWNER, NOW, START);
const group = (changes: Partial<Account>) => groupOf(account(changes), status(changes));
const inBoth = (at: Address, changes: Partial<Account> = {}) => ({ delegate: at, claimer: at, ...changes });
const matcha = { automation: MATCHA_LATTE };

// From the verified source on Sourcify, not from `src/hydrex.ts`, so a wrong ABI there fails the test.
const abi = parseAbi(["function setConduitApproval(address conduitAddress, uint256 tokenId, bool approve)"]);
const approval = (id: bigint, approve: boolean, conduit: Address = CONDUIT) => ({
  to: VOTING_ESCROW,
  data: encodeFunctionData({ abi, functionName: "setConduitApproval", args: [conduit, id, approve] }),
});
const txs = (steps: Slip[]) => steps.map(({ to, data }) => ({ to, data }));
const says = (steps: Slip[]) => steps.map(({ says }) => says);

test("the page's automations: in, joined or left this epoch, and partly in", () => {
  assert.deepEqual(status(inBoth(CONDUIT, { delegateAtStart: CONDUIT })), { kind: "in", ...matcha });
  assert.deepEqual(status(inBoth(CONDUIT)), { kind: "joined", ...matcha, date: NEXT });
  assert.deepEqual(status({ delegateAtStart: CONDUIT }), { kind: "left", ...matcha, date: NEXT });
  assert.deepEqual(status({ delegate: CONDUIT, delegateAtStart: CONDUIT }), { kind: "partly", ...matcha });
  assert.deepEqual(status({ claimer: CONDUIT }), { kind: "partly", ...matcha });
  assert.deepEqual(status({ delegate: MAXI, claimer: CONDUIT }), { kind: "partly", automation: DOUBLE_ESPRESSO });
  const maxi = { automation: DOUBLE_ESPRESSO };
  assert.deepEqual(status(inBoth(MAXI, { delegateAtStart: MAXI })), { kind: "in", ...maxi });
  assert.deepEqual(status(inBoth(MAXI, { delegateAtStart: CONDUIT })), { kind: "joined", ...maxi, date: NEXT });
});

test("status by delegate: the owner, other automations, which may have stopped, anyone else; empty and ended", () => {
  const selves = [{}, { delegate: zeroAddress }, { ownerVoted: START - WEEK }, { delegateAtStart: STRANGER }];
  for (const c of [...selves, { lockType: 1 }, { lockType: 0, end: NOW + 1 }])
    assert.deepEqual(status(c), { kind: "self" });
  assert.deepEqual(status({ ownerVoted: START - WEEK - 1 }), { kind: "unvoted", voted: START - WEEK - 1 });
  assert.deepEqual(status({ ownerVoted: 0 }), { kind: "unvoted", voted: 0 });
  assert.deepEqual(status({ delegate: USDC.toLowerCase() as Address }), { kind: "other", name: "USDC" });
  assert.deepEqual(status({ delegate: STRANGER }), { kind: "delegated", to: STRANGER });
  const left = { kind: "left-other", name: "USDC", date: NEXT };
  assert.deepEqual(status({ delegateAtStart: USDC }), left);
  assert.deepEqual(status({ delegate: zeroAddress, delegateAtStart: USDC }), left);
  assert.deepEqual(status(inBoth(CONDUIT, { amount: 0n })), { kind: "empty" });
  assert.deepEqual(status({ lockType: 0, end: NOW }), { kind: "ended" });
  // An automation that has not voted since the previous epoch began has stopped; one that never voted may be new.
  const stopped = { kind: "stopped", name: "USDC", voted: STOPPED, since: 1_788_998_400 };
  assert.deepEqual(status({ delegate: USDC, delegateAtStart: USDC, delegateVoted: STOPPED }), stopped);
  const later = { ...stopped, voted: START - WEEK - 1, since: START - WEEK };
  assert.deepEqual(status({ delegate: USDC, delegateVoted: START - WEEK - 1 }), later);
  assert.deepEqual(status({ delegate: USDC, delegateVoted: START - WEEK }), { kind: "other", name: "USDC" });
  assert.deepEqual(status({ delegate: USDC, delegateVoted: 0 }), { kind: "other", name: "USDC" }, "never voted");
});

test("accounts are grouped by what their owner can do; without a vote, closed unless still held", () => {
  const stopped = { delegate: USDC, delegateAtStart: USDC, delegateVoted: STOPPED };
  const dust = { votes: 10n ** 18n - 1n };
  const groups: Record<string, Partial<Account>[]> = {
    "needs:stopped": [stopped],
    "needs:partly": [{ claimer: CONDUIT }],
    "needs:unvoted": [{ ownerVoted: 0 }],
    "in:matcha-latte": [inBoth(CONDUIT, { delegateAtStart: CONDUIT }), inBoth(CONDUIT), { ...dust, claimer: CONDUIT }],
    "in:double-espresso": [inBoth(MAXI, { delegateAtStart: MAXI }), inBoth(MAXI, { ...dust, amount: 0n })],
    other: [{}, { delegateAtStart: CONDUIT }, { delegate: USDC, delegateVoted: NOW }, { delegate: STRANGER }],
    closed: [{ ...dust, ownerVoted: 0 }, { ...dust, ...stopped }, { lockType: 0, end: NOW }, { amount: 0n }],
  };
  for (const [expected, list] of Object.entries(groups))
    for (const changes of list) assert.equal(group(changes), expected, JSON.stringify(changes, String));
});

test("who can join and who can leave", () => {
  const joins = (changes: Partial<Account>, automation = MATCHA_LATTE) => canJoin(account(changes), automation, NOW);
  const joinable = [{}, { delegate: USDC }, inBoth(MAXI), { claimer: CONDUIT }, { lockType: 0, end: NOW + 1 }];
  assert.ok([...joinable, inBoth(USDC, { delegateVoted: STOPPED })].every((c) => joins(c)));
  assert.ok(![inBoth(CONDUIT), { amount: 0n }, { lockType: 0, end: NOW }].some((c) => joins(c)));
  assert.ok(joins(inBoth(CONDUIT), DOUBLE_ESPRESSO));
  const leaves = (changes: Partial<Account>, automation = MATCHA_LATTE) => canLeave(account(changes), automation);
  assert.ok([inBoth(CONDUIT), { claimer: CONDUIT }, inBoth(CONDUIT, { amount: 0n })].every((c) => leaves(c)));
  assert.ok(![inBoth(USDC), inBoth(MAXI)].some((c) => leaves(c)));
  assert.ok(leaves(inBoth(MAXI), DOUBLE_ESPRESSO));
  assert.ok(canLeaveOther(account(inBoth(USDC))));
  assert.ok(![inBoth(CONDUIT), { delegate: STRANGER }, {}].some((c) => canLeaveOther(account(c))));
});

test("joining sets the conduit's approval, in one call per account, naming what each leaves", () => {
  const [step] = join([account()], MATCHA_LATTE);
  assert.deepEqual(txs([step!]), [approval(141n, true)]);
  assert.deepEqual([step!.title, step!.on], ["Join Matcha Latte", "Hydrex's VotingEscrow"]);
  assert.equal(step!.says, "Account #141 joins Matcha Latte.");
  assert.deepEqual(step!.fields[0], { label: "Conduit", code: CONDUIT, description: "KlimaVeTokenConduit" });
  const many = [inBoth(LIQUID_HYDREX), { id: 42n, delegate: LOCK_MAXI, claimer: USDC }, { id: 7n, claimer: USDC }];
  const steps = join(many.map(account), MATCHA_LATTE);
  assert.deepEqual(txs(steps), [approval(141n, true), approval(42n, true), approval(7n, true)]);
  assert.deepEqual(says(steps), [
    "Account #141 leaves the Liquid Hydrex automation and joins Matcha Latte.",
    "Account #42 leaves the Hydrex Lock Maxi and USDC automations and joins Matcha Latte.",
    "Account #7 leaves the USDC automation and joins Matcha Latte.",
  ]);
});

test("leaving clears the approval; leaving another automation names it by its address", () => {
  const steps = leave([account(inBoth(CONDUIT)), account({ id: 42n, claimer: CONDUIT })], MATCHA_LATTE);
  assert.deepEqual(txs(steps), [approval(141n, false), approval(42n, false)]);
  assert.equal(steps[1]!.says, "Account #42 leaves Matcha Latte.");
  const others = leaveOther([account(inBoth(USDC)), account({ id: 42n, delegate: LOCK_MAXI })]);
  assert.deepEqual(txs(others), [approval(141n, false, USDC), approval(42n, false, LOCK_MAXI)]);
  assert.deepEqual(
    others.map(({ says, fields }) => [says, fields[0]!.description]),
    [
      ["Account #141 leaves the USDC automation.", "The USDC automation"],
      ["Account #42 leaves the Hydrex Lock Maxi automation.", "The Hydrex Lock Maxi automation"],
    ],
  );
  assert.deepEqual(leaveOther([account({ delegate: STRANGER })]), [], "not on Hydrex's list");
});

test("moving between Matcha Latte and Double Espresso is one call, which takes the votes and the claims", () => {
  const [move] = join([account(inBoth(CONDUIT, { delegateAtStart: CONDUIT }))], DOUBLE_ESPRESSO);
  assert.deepEqual(txs([move!]), [approval(141n, true, MAXI)]);
  assert.equal(move!.fields[0]!.description, "ImmutableVeTokenConduit");
  assert.deepEqual(
    says([...join([account(inBoth(CONDUIT))], DOUBLE_ESPRESSO), ...join([account(inBoth(MAXI))], MATCHA_LATTE)]),
    [
      "Account #141 leaves Matcha Latte and joins Double Espresso.",
      "Account #141 leaves Double Espresso and joins Matcha Latte.",
    ],
  );
  const [both] = join([account({ delegate: USDC, claimer: CONDUIT })], DOUBLE_ESPRESSO);
  assert.equal(both!.says, "Account #141 leaves Matcha Latte and the USDC automation and joins Double Espresso.");
  assert.deepEqual(txs(leave([account(inBoth(MAXI))], DOUBLE_ESPRESSO)), [approval(141n, false, MAXI)]);
});

const multicall = parseAbi([
  "function aggregate3((address target, bool allowFailure, bytes callData)[] calls) payable returns ((bool success, bytes returnData)[])",
]);
type Answer = { success: boolean; returnData: Hex };
const serve = (t: TestContext, answer: (callData: Hex) => Answer, other: (method: string) => unknown = () => null) =>
  t.mock.method(globalThis, "fetch", async (_: unknown, init: RequestInit) => {
    const { method, params } = JSON.parse(String(init.body)) as { method: string; params: [{ data: Hex }] };
    if (method !== "eth_call") return Response.json({ result: other(method) });
    const { args } = decodeFunctionData({ abi: multicall, data: params[0].data });
    const result = args[0].map(({ callData }) => answer(callData));
    return Response.json({ result: encodeFunctionResult({ abi: multicall, functionName: "aggregate3", result }) });
  });
const ok = (type: string, value: unknown) => ({ success: true, returnData: encodeAbiParameters([{ type }], [value]) });
const failed: Answer = { success: false, returnData: "0x" };

test("an account whose ownerOf fails is asked again on its own before it is taken for gone", async (t) => {
  const ownerOf = toFunctionSelector("function ownerOf(uint256)");
  const timestamp = toFunctionSelector("function getCurrentBlockTimestamp()");
  let [owners, asked] = [[undefined, undefined] as (Address | undefined)[], 0];
  serve(t, (data) => {
    if (data.startsWith(ownerOf)) return owners[asked++] ? ok("address", owners[asked - 1]) : failed;
    return data.startsWith(timestamp) ? ok("uint256", 1_792_627_200n) : failed;
  });
  assert.equal(await readAccount(9540n), undefined);
  assert.equal(asked, 2);
  // When `ownerOf` answers on the second try, the account is read, so a failed read of its details rejects instead of
  // returning `undefined`.
  [owners, asked] = [[undefined, OWNER], 0];
  await assert.rejects(readAccount(9540n), /A read from Base failed/);
  assert.equal(asked, 2);
});

test("every automation's checks fail once an RPC answers for another chain", async (t) => {
  const logic = toFunctionSelector("function approvalLogic()");
  const approvals = {
    success: true,
    returnData: encodeAbiParameters(parseAbiParameters("uint8[], bool, string"), [[3, 5], true, ""]),
  };
  const implementation = `0x${config.VOTING_ESCROW_IMPLEMENTATION.slice(2).padStart(64, "0")}`;
  let chainId = "0x2105";
  const other = (method: string) => (method === "eth_chainId" ? chainId : implementation);
  serve(t, (data) => (data.startsWith(logic) ? ok("address", config.APPROVAL_LOGIC) : approvals), other);
  assert.deepEqual([...(await failedChecks()).values()], [[], []]);
  chainId = "0x1";
  assert.deepEqual([...(await failedChecks()).values()], [["chain"], ["chain"]]);
});

test("what reaches the owner of Matcha Latte's payouts is not known until its fee is", () => {
  const settings = { retireBps: 3_333n } as Parameters<typeof paidBpsOf>[0];
  assert.equal(paidBpsOf(settings), undefined);
  assert.equal(paidBpsOf({ ...settings, feeBps: 0n }), 6_667n);
  assert.equal(paidBpsOf({ ...settings, feeBps: 100n }), 6_600n);
});
