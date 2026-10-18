import { encodeFunctionData, parseAbi, zeroAddress, type Address } from "viem";
import { blockTime, call, codeHash, implementation, read, required, rpc, same } from "./chain.ts";
import {
  ACCOUNT_NAMES,
  ACTIONS,
  APPROVAL_LOGIC,
  APPROVAL_LOGIC_CODE_HASH,
  CHAIN_ID,
  CONDUIT,
  CONDUIT_CODE_HASH,
  KVCM,
  VOTER,
  VOTING_ESCROW,
  VOTING_ESCROW_IMPLEMENTATION,
  VOTING_ESCROW_IMPLEMENTATION_CODE_HASH,
} from "./config.ts";
import { WEEK, clean, list, weekStart } from "./format.ts";
import conduits from "./hydrex-conduits.json" with { type: "json" };
import type { Tx } from "./wallet.ts";

const votingEscrowAbi = parseAbi([
  "function balanceOf(address owner) view returns (uint256)",
  "function tokenOfOwnerByIndex(address owner, uint256 index) view returns (uint256)",
  "function lockDetails(uint256 tokenId) view returns ((uint256 amount, uint256 startTime, uint256 endTime, uint8 lockType))",
  "function balanceOfNFT(uint256 tokenId) view returns (uint256)",
  "function balanceOfNFTAt(uint256 tokenId, uint256 timestamp) view returns (uint256)",
  "function getLockDelegatee(uint256 tokenId) view returns (address)",
  "function delegates(uint256 tokenId, uint48 timestamp) view returns (address)",
  "function getClaimRedirectApproved(uint256 tokenId) view returns (address)",
  "function getPastVotes(address account, uint256 timepoint) view returns (uint256)",
  "function getVotes(address account) view returns (uint256)",
  "function getConduitApprovalConfig(address conduit) view returns (uint8[] actions, bool active, string description)",
  "function approvalLogic() view returns (address)",
  "function setConduitApproval(address conduit, uint256 tokenId, bool approve)",
]);

const voterAbi = parseAbi([
  "function _epochTimestamp() view returns (uint256)",
  "function lastVoted(address voter) view returns (uint256)",
  "function poolVoteLength(address voter) view returns (uint256)",
  "function poolVote(address voter, uint256 index) view returns (address)",
  "function length() view returns (uint256)",
  "function pools(uint256 index) view returns (address)",
  "function gauges(address pool) view returns (address)",
  "function internal_bribes(address gauge) view returns (address)",
  "function external_bribes(address gauge) view returns (address)",
  "function totalWeightAt(uint256 time) view returns (uint256)",
]);

const conduitAbi = parseAbi([
  "function veToken() view returns (address)",
  "function voter() view returns (address)",
  "function kvcm() view returns (address)",
  "function retireBps() view returns (uint256)",
  "function totalTonnesRetired() view returns (uint256)",
  "function retiringEntityName() view returns (string)",
  "function beneficiaryString() view returns (string)",
  "function impactBeneficiaryAddress() view returns (address)",
  "function retirementMessage() view returns (string)",
  "function getEffectiveRecipientForOwner(address owner) view returns (address)",
]);

const accountNamesAbi = parseAbi(["function getBulkNames(uint256[] tokenIds) view returns (string[])"]);

export const escrow = (functionName: string, ...args: unknown[]) =>
  call(VOTING_ESCROW, votingEscrowAbi, functionName, ...args);
export const voter = (functionName: string, ...args: unknown[]) => call(VOTER, voterAbi, functionName, ...args);
export const conduit = (functionName: string, ...args: unknown[]) => call(CONDUIT, conduitAbi, functionName, ...args);

const others = conduits.filter(({ address }) => !same(address, CONDUIT));

export const LockType = { timed: 0, rolling: 1, permanent: 2 } as const;

export type CarbonImpact = {
  time: number;
  epochStart: number;
  retireBps: bigint;
  tonnes: bigint;
  entity: string;
  beneficiary: string;
  beneficiaryAddress: Address;
  message: string;
  votes: bigint;
  // When it last voted, or 0.
  voted: number;
};

export type Account = {
  id: bigint;
  name: string;
  amount: bigint;
  end: number;
  lockType: number;
  votes: bigint;
  delegate: Address;
  delegateAtStart: Address;
  // When the automation that holds its votes last voted, or 0.
  delegateVoted: number;
  claimer: Address;
};

export type Holdings = { owner: Address; accounts: Account[]; payout: Address; time: number; epochStart: number };

export type Status =
  | { kind: "in" | "partly" | "self" | "ended" | "empty" }
  | { kind: "joined" | "left"; date: number }
  | { kind: "other"; name: string }
  | { kind: "left-other"; name: string; date: number }
  | { kind: "stopped"; name: string; voted: number; since: number }
  | { kind: "delegated"; to: Address };

export type Group = "stopped" | "attention" | "in" | "joining" | "leaving" | "open" | "closed";

// `automation` is set only when the call is not about Carbon Impact.
export type Step = Tx & {
  says: string;
  on: string;
  id: bigint;
  approve: boolean;
  conduit: Address;
  automation?: string;
};

// Epochs follow the calendar. Hydrex's Voter moves its own epoch only once someone calls the minter, but joins count
// from the next Thursday either way.
const epochAt = (time: unknown): number => weekStart(Number(time));

export async function readCarbonImpact(): Promise<CarbonImpact> {
  const replies = await read([
    blockTime,
    conduit("retireBps"),
    conduit("totalTonnesRetired"),
    conduit("retiringEntityName"),
    conduit("beneficiaryString"),
    conduit("impactBeneficiaryAddress"),
    conduit("retirementMessage"),
    voter("lastVoted", CONDUIT),
  ]);
  const [time, retireBps, tonnes, entity, beneficiary, beneficiaryAddress, message] = required(replies.slice(0, 7)) as [
    bigint,
    bigint,
    bigint,
    string,
    string,
    Address,
    string,
  ];
  // Only Home shows when it last voted, so a failed read just leaves it out.
  const voted = replies[7] as bigint | undefined;
  const epochStart = epochAt(time);
  const [votes] = required(await read([escrow("getPastVotes", CONDUIT, BigInt(epochStart))])) as [bigint];
  return {
    time: Number(time),
    epochStart,
    retireBps,
    tonnes,
    entity: clean(entity),
    beneficiary: clean(beneficiary),
    beneficiaryAddress,
    message: clean(message),
    votes,
    voted: Number(voted ?? 0n),
  };
}

export async function readAccounts(owner: Address): Promise<Holdings> {
  const replies = await read([
    escrow("balanceOf", owner),
    conduit("getEffectiveRecipientForOwner", owner),
    blockTime,
    ...others.map(({ address }) => voter("lastVoted", address)),
  ]);
  const [count, payout, time] = required(replies.slice(0, 3)) as [bigint, Address, bigint];
  const epochStart = epochAt(time);
  // If the Voter cannot be read, the other automations are just not known to have stopped.
  const voted = replies.slice(3) as (bigint | undefined)[];
  const lastVoted = new Map(others.map(({ address }, i) => [address.toLowerCase(), Number(voted[i] ?? 0n)]));
  const indexes = Array.from({ length: Number(count) }, (_, i) => BigInt(i));
  const ids = required(await read(indexes.map((i) => escrow("tokenOfOwnerByIndex", owner, i)))) as bigint[];
  const details = await read([
    ...ids.flatMap((id) => [
      escrow("lockDetails", id),
      escrow("balanceOfNFT", id),
      escrow("getLockDelegatee", id),
      escrow("delegates", id, epochStart),
      escrow("getClaimRedirectApproved", id),
    ]),
    call(ACCOUNT_NAMES, accountNamesAbi, "getBulkNames", ids),
  ]);
  const names = (details.at(-1) as readonly string[] | undefined) ?? [];
  const accounts = ids.map((id, i): Account => {
    const [{ amount, endTime, lockType }, votes, delegate, delegateAtStart, claimer] = required(
      details.slice(5 * i, 5 * i + 5),
    ) as [{ amount: bigint; endTime: bigint; lockType: number }, bigint, Address, Address, Address];
    return {
      id,
      name: clean(names[i]),
      amount,
      end: Number(endTime),
      lockType,
      votes,
      delegate,
      delegateAtStart,
      delegateVoted: lastVoted.get(delegate.toLowerCase()) ?? 0,
      claimer,
    };
  });
  accounts.sort((a, b) => (a.votes === b.votes ? Number(a.id - b.id) : a.votes > b.votes ? -1 : 1));
  return { owner, accounts, payout, time: Number(time), epochStart };
}

const ended = (account: Account, now: number): boolean => account.lockType === LockType.timed && account.end <= now;

const held = (account: Account) => ({ votes: same(account.delegate, CONDUIT), claims: same(account.claimer, CONDUIT) });

export const automationName = (address: Address): string | undefined =>
  others.find((other) => same(other.address, address))?.name;

// Hydrex counts a vote only in the epoch it is cast. An automation that has not voted since the previous epoch began
// earns its accounts nothing. One that has never voted may be new.
export const hasStopped = (voted: number, epochStart: number): boolean => voted > 0 && voted < epochStart - WEEK;

// Hydrex counts votes for whoever held them when the epoch started, so joins and leaves count from the next epoch.
export function statusOf(account: Account, owner: Address, now: number, epochStart: number): Status {
  if (account.amount === 0n) return { kind: "empty" };
  if (ended(account, now)) return { kind: "ended" };
  const { votes, claims } = held(account);
  const votedAtStart = same(account.delegateAtStart, CONDUIT);
  if (votes && claims) return votedAtStart ? { kind: "in" } : { kind: "joined", date: epochStart + WEEK };
  if (votes || claims) return { kind: "partly" };
  if (votedAtStart) return { kind: "left", date: epochStart + WEEK };
  if (same(account.delegate, owner) || same(account.delegate, zeroAddress)) {
    const before = automationName(account.delegateAtStart);
    return before ? { kind: "left-other", name: before, date: epochStart + WEEK } : { kind: "self" };
  }
  const name = automationName(account.delegate);
  if (!name) return { kind: "delegated", to: account.delegate };
  const voted = account.delegateVoted;
  return hasStopped(voted, epochStart)
    ? { kind: "stopped", name, voted, since: weekStart(voted) + WEEK }
    : { kind: "other", name };
}

export function canJoin(account: Account, now: number): boolean {
  const { votes, claims } = held(account);
  return account.amount > 0n && !ended(account, now) && !(votes && claims);
}

export function canLeave(account: Account): boolean {
  const { votes, claims } = held(account);
  return votes || claims;
}

export const canLeaveOther = (account: Account): boolean => automationName(account.delegate) !== undefined;

export function groupOf(account: Account, status: Status): Group {
  switch (status.kind) {
    case "stopped":
      return "stopped";
    case "partly":
      return "attention";
    case "in":
      return "in";
    case "joined":
      return "joining";
    case "left":
      return "leaving";
    // Carbon Impact may still hold the approvals of an account it can no longer vote with.
    case "ended":
    case "empty":
      return canLeave(account) ? "in" : "closed";
    default:
      return "open";
  }
}

type Other = { address: Address; name: string };

function approval({ id }: Account, approve: boolean, says: string, other?: Other): Step {
  const target = other?.address ?? CONDUIT;
  return {
    to: VOTING_ESCROW,
    data: encodeFunctionData({ abi: votingEscrowAbi, functionName: "setConduitApproval", args: [target, id, approve] }),
    says: `#${id} ${says}`,
    on: "Hydrex's VotingEscrow",
    id,
    approve,
    conduit: target,
    ...(other && { automation: other.name }),
  };
}

// A join takes over the votes and the claims, which other automations may hold.
export const join = (accounts: Account[]): Step[] =>
  accounts.map((account) => {
    const names = [account.delegate, account.claimer].map(automationName).filter((name) => name !== undefined);
    const from = [...new Set(names)];
    const leaving = from.length ? `leaves the ${list(from)} automation${from.length > 1 ? "s" : ""} and ` : "";
    return approval(account, true, `${leaving}joins Carbon Impact.`);
  });

export const leave = (accounts: Account[]): Step[] =>
  accounts.map((account) => approval(account, false, "leaves Carbon Impact."));

// The same call as leaving Carbon Impact, with the other automation's address. Only automations on Hydrex's list, so
// that each call names the one it leaves.
export const leaveOther = (accounts: Account[]): Step[] =>
  accounts.flatMap((account) => {
    const name = automationName(account.delegate);
    if (!name) return [];
    return [approval(account, false, `leaves the ${name} automation.`, { address: account.delegate, name })];
  });

export type Automation = { address: Address; name: string; voted: number; votes: bigint | undefined };

// When each of Hydrex's other automations last voted (0 if unknown), and the votes still delegated to it.
export async function readAutomations(): Promise<Automation[]> {
  const found = await read(others.flatMap(({ address }) => [voter("lastVoted", address), escrow("getVotes", address)]));
  return others.map(({ address, name }, i) => ({
    address: address as Address,
    name,
    voted: Number((found[2 * i] as bigint | undefined) ?? 0n),
    votes: found[2 * i + 1] as bigint | undefined,
  }));
}

// The checks that fail, each named by the id of its message on the page.
export async function failedChecks(): Promise<string[]> {
  const [chainId, conduitHash, impl, [veToken, voterAddress, payoutToken, config, logic]] = await Promise.all([
    rpc<string>("eth_chainId", []),
    codeHash(CONDUIT),
    implementation(VOTING_ESCROW),
    read([
      conduit("veToken"),
      conduit("voter"),
      conduit("kvcm"),
      escrow("getConduitApprovalConfig", CONDUIT),
      escrow("approvalLogic"),
    ]),
  ]);
  const [implHash, logicHash] = await Promise.all([codeHash(impl), logic ? codeHash(logic as Address) : undefined]);
  const [actions, active] = (config ?? [[], false]) as [number[], boolean];
  const failed = {
    chain: Number(chainId) !== CHAIN_ID,
    code: conduitHash !== CONDUIT_CODE_HASH,
    contracts: !same(String(veToken), VOTING_ESCROW) || !same(String(voterAddress), VOTER),
    token: !same(String(payoutToken), KVCM),
    approvals: !active || actions.join() !== ACTIONS.join(),
    upgrade: !same(impl, VOTING_ESCROW_IMPLEMENTATION) || implHash !== VOTING_ESCROW_IMPLEMENTATION_CODE_HASH,
    logic: !same(String(logic), APPROVAL_LOGIC) || logicHash !== APPROVAL_LOGIC_CODE_HASH,
  };
  return Object.entries(failed).flatMap(([id, failing]) => (failing ? [id] : []));
}
