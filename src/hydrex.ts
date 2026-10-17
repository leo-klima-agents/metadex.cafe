import { encodeFunctionData, parseAbi, zeroAddress, type Address } from "viem";
import { blockTime, call, codeHash, implementation, read, rpc, same } from "./chain.ts";
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
  "function getLockDelegatee(uint256 tokenId) view returns (address)",
  "function delegates(uint256 tokenId, uint48 timestamp) view returns (address)",
  "function getClaimRedirectApproved(uint256 tokenId) view returns (address)",
  "function getPastVotes(address account, uint256 timepoint) view returns (uint256)",
  "function getConduitApprovalConfig(address conduit) view returns (uint8[] actions, bool active, string description)",
  "function approvalLogic() view returns (address)",
  "function setConduitApproval(address conduit, uint256 tokenId, bool approve)",
]);

const conduitAbi = parseAbi([
  "function veToken() view returns (address)",
  "function voter() view returns (address)",
  "function kvcm() view returns (address)",
  "function retireBps() view returns (uint256)",
  "function treasuryFeeBps() view returns (uint256)",
  "function totalTonnesRetired() view returns (uint256)",
  "function retiringEntityName() view returns (string)",
  "function getEffectiveRecipientForOwner(address owner) view returns (address)",
]);

const accountNamesAbi = parseAbi(["function getBulkNames(uint256[] tokenIds) view returns (string[])"]);

const escrow = (functionName: string, ...args: unknown[]) =>
  call(VOTING_ESCROW, votingEscrowAbi, functionName, ...args);
const conduit = (functionName: string, ...args: unknown[]) => call(CONDUIT, conduitAbi, functionName, ...args);

export const LockType = { timed: 0, rolling: 1, permanent: 2 } as const;

export type Relay = {
  epochStart: number;
  retireBps: bigint;
  feeBps: bigint;
  tonnes: bigint;
  entity: string;
  votes: bigint;
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
  claimer: Address;
};

export type Holdings = { owner: Address; accounts: Account[]; payout: Address; time: number; epochStart: number };

export type Status =
  | { kind: "in" | "partly" | "self" | "ended" | "empty" }
  | { kind: "joined" | "left"; date: number }
  | { kind: "other"; name: string }
  | { kind: "delegated"; to: Address };

export type Step = Tx & { says: string; on: string; shows: string };

function required(values: unknown[]): unknown[] {
  if (values.includes(undefined)) throw new Error("A read from Base failed.");
  return values;
}

// By the calendar: the Voter's own epoch moves only once someone calls Hydrex's minter, and joins count from the next
// Thursday all the same.
const epochAt = (time: unknown): number => weekStart(Number(time));

export async function readRelay(): Promise<Relay> {
  const [time, retireBps, feeBps, tonnes, entity] = required(
    await read([
      blockTime,
      conduit("retireBps"),
      conduit("treasuryFeeBps"),
      conduit("totalTonnesRetired"),
      conduit("retiringEntityName"),
    ]),
  ) as [bigint, bigint, bigint, bigint, string];
  const epochStart = epochAt(time);
  const [votes] = required(await read([escrow("getPastVotes", CONDUIT, BigInt(epochStart))])) as [bigint];
  return { epochStart, retireBps, feeBps, tonnes, entity: clean(entity), votes };
}

export async function readAccounts(owner: Address): Promise<Holdings> {
  const [count, payout, time] = required(
    await read([escrow("balanceOf", owner), conduit("getEffectiveRecipientForOwner", owner), blockTime]),
  ) as [bigint, Address, bigint];
  const epochStart = epochAt(time);
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
    const name = clean(names[i]);
    return { id, name, amount, end: Number(endTime), lockType, votes, delegate, delegateAtStart, claimer };
  });
  accounts.sort((a, b) => (a.votes === b.votes ? Number(a.id - b.id) : a.votes > b.votes ? -1 : 1));
  return { owner, accounts, payout, time: Number(time), epochStart };
}

const ended = (account: Account, now: number): boolean => account.lockType === LockType.timed && account.end <= now;

const held = (account: Account) => ({ votes: same(account.delegate, CONDUIT), claims: same(account.claimer, CONDUIT) });

export const automation = (address: Address): string | undefined =>
  conduits.find((conduit) => same(conduit.address, address) && !same(conduit.address, CONDUIT))?.name;

// The Voter counts the delegate at the start of the epoch, so joins and leaves count from the next one.
export function status(account: Account, owner: Address, now: number, epochStart: number): Status {
  if (account.amount === 0n) return { kind: "empty" };
  if (ended(account, now)) return { kind: "ended" };
  const { votes, claims } = held(account);
  const votedAtStart = same(account.delegateAtStart, CONDUIT);
  if (votes && claims) return votedAtStart ? { kind: "in" } : { kind: "joined", date: epochStart + WEEK };
  if (votes || claims) return { kind: "partly" };
  if (votedAtStart) return { kind: "left", date: epochStart + WEEK };
  if (same(account.delegate, owner) || same(account.delegate, zeroAddress)) return { kind: "self" };
  const other = automation(account.delegate);
  return other ? { kind: "other", name: other } : { kind: "delegated", to: account.delegate };
}

export function canJoin(account: Account, now: number): boolean {
  const { votes, claims } = held(account);
  return account.amount > 0n && !ended(account, now) && !(votes && claims);
}

export function canLeave(account: Account): boolean {
  const { votes, claims } = held(account);
  return votes || claims;
}

const approval = ({ id }: Account, approve: boolean, says: string): Step => ({
  to: VOTING_ESCROW,
  data: encodeFunctionData({ abi: votingEscrowAbi, functionName: "setConduitApproval", args: [CONDUIT, id, approve] }),
  says: `#${id} ${says}`,
  on: "Hydrex's VotingEscrow",
  shows: `setConduitApproval(${CONDUIT}, ${id}, ${approve})`,
});

// A join replaces both the delegate and the claimer, which two other automations may hold.
export const join = (accounts: Account[]): Step[] =>
  accounts.map((account) => {
    const names = [account.delegate, account.claimer].map(automation).filter((name) => name !== undefined);
    const from = [...new Set(names)];
    const leaving = from.length ? `leaves the ${list(from)} automation${from.length > 1 ? "s" : ""} and ` : "";
    return approval(account, true, `${leaving}joins the Carbon Impact automation.`);
  });

export const leave = (accounts: Account[]): Step[] =>
  accounts.map((account) => approval(account, false, "leaves the Carbon Impact automation."));

// Each check is named by the id of its message on the page.
export async function check(): Promise<string[]> {
  const [chainId, conduitHash, impl, [veToken, voter, payoutToken, config, logic]] = await Promise.all([
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
    contracts: !same(String(veToken), VOTING_ESCROW) || !same(String(voter), VOTER),
    token: !same(String(payoutToken), KVCM),
    approvals: !active || actions.join() !== ACTIONS.join(),
    upgrade: !same(impl, VOTING_ESCROW_IMPLEMENTATION) || implHash !== VOTING_ESCROW_IMPLEMENTATION_CODE_HASH,
    logic: !same(String(logic), APPROVAL_LOGIC) || logicHash !== APPROVAL_LOGIC_CODE_HASH,
  };
  return Object.entries(failed).flatMap(([id, failing]) => (failing ? [id] : []));
}
