import { zeroAddress, type Address } from "viem";
import { accountNamesAbi, conduitAbi, multicall3Abi, votingEscrowAbi } from "./abi.ts";
import { call, codeHash, implementation, read, rpc, same } from "./chain.ts";
import {
  ACCOUNT_NAMES,
  ACTIONS,
  APPROVAL_LOGIC,
  APPROVAL_LOGIC_CODE_HASH,
  CHAIN_ID,
  CONDUIT,
  CONDUIT_CODE_HASH,
  KVCM,
  MULTICALL3,
  VOTER,
  VOTING_ESCROW,
  VOTING_ESCROW_IMPLEMENTATION,
  VOTING_ESCROW_IMPLEMENTATION_CODE_HASH,
} from "./config.ts";
import { WEEK, clean, weekStart } from "./format.ts";
import conduits from "./hydrex-conduits.json" with { type: "json" };

export const LockType = { timed: 0, rolling: 1, permanent: 2 } as const;

export type Relay = {
  /** The start of the epoch at Base's latest block. */
  epochStart: number;
  retireBps: bigint;
  feeBps: bigint;
  /** Tonnes retired so far, with 18 decimals. */
  tonnes: bigint;
  /** The name retirements are made in. */
  entity: string;
  /** The conduit's votes this epoch. */
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
  /** The delegate at the start of the epoch: the votes count for it this epoch. */
  delegateAtStart: Address;
  claimer: Address;
};

export type Status =
  | { kind: "in" | "partly" | "self" | "ended" | "empty" }
  | { kind: "joined" | "left"; date: number }
  | { kind: "other"; name: string }
  | { kind: "delegated"; to: Address };

function all(values: unknown[]): unknown[] {
  if (values.includes(undefined)) throw new Error("A read from Base failed.");
  return values;
}

/** The time of Base's latest block, read alongside the rest. */
const now = () => call(MULTICALL3, multicall3Abi, "getCurrentBlockTimestamp");

/**
 * The epoch at Base's latest block: the Thursday 00:00 UTC before it. The Voter's own _epochTimestamp() moves only once
 * someone calls Hydrex's minter after that time, so it can lag the calendar for a while; a join sent meanwhile counts
 * from the next Thursday all the same.
 */
const epochAt = (time: unknown): number => weekStart(Number(time));

export async function readRelay(): Promise<Relay> {
  const [time, retireBps, feeBps, tonnes, entity] = all(
    await read([
      now(),
      call(CONDUIT, conduitAbi, "retireBps"),
      call(CONDUIT, conduitAbi, "treasuryFeeBps"),
      call(CONDUIT, conduitAbi, "totalTonnesRetired"),
      call(CONDUIT, conduitAbi, "retiringEntityName"),
    ]),
  ) as [bigint, bigint, bigint, bigint, string];
  const epochStart = epochAt(time);
  const [votes] = all(
    await read([call(VOTING_ESCROW, votingEscrowAbi, "getPastVotes", CONDUIT, BigInt(epochStart))]),
  ) as [bigint];
  return { epochStart, retireBps, feeBps, tonnes, entity: clean(entity), votes };
}

/**
 * An owner's accounts, where its payouts go, and the time of Base's latest block with the start of the epoch their
 * delegates are read at.
 */
export async function readAccounts(
  owner: Address,
): Promise<{ accounts: Account[]; payout: Address; time: number; epochStart: number }> {
  const [count, payout, time] = all(
    await read([
      call(VOTING_ESCROW, votingEscrowAbi, "balanceOf", owner),
      call(CONDUIT, conduitAbi, "getEffectiveRecipientForOwner", owner),
      now(),
    ]),
  ) as [bigint, Address, bigint];
  const epochStart = epochAt(time);
  const ids = all(
    await read(
      Array.from({ length: Number(count) }, (_, i) =>
        call(VOTING_ESCROW, votingEscrowAbi, "tokenOfOwnerByIndex", owner, BigInt(i)),
      ),
    ),
  ) as bigint[];
  const details = await read([
    ...ids.flatMap((id) => [
      call(VOTING_ESCROW, votingEscrowAbi, "lockDetails", id),
      call(VOTING_ESCROW, votingEscrowAbi, "balanceOfNFT", id),
      call(VOTING_ESCROW, votingEscrowAbi, "getLockDelegatee", id),
      call(VOTING_ESCROW, votingEscrowAbi, "delegates", id, epochStart),
      call(VOTING_ESCROW, votingEscrowAbi, "getClaimRedirectApproved", id),
    ]),
    call(ACCOUNT_NAMES, accountNamesAbi, "getBulkNames", ids),
  ]);
  const names = (details.at(-1) as readonly string[] | undefined) ?? [];
  const accounts = ids.map((id, i) => {
    const [lock, votes, delegate, delegateAtStart, claimer] = all(details.slice(5 * i, 5 * i + 5)) as [
      { amount: bigint; endTime: bigint; lockType: number },
      bigint,
      Address,
      Address,
      Address,
    ];
    const { amount, endTime, lockType } = lock;
    const name = clean(names[i]);
    return { id, name, amount, end: Number(endTime), lockType, votes, delegate, delegateAtStart, claimer };
  });
  accounts.sort((a, b) => (a.votes === b.votes ? Number(a.id - b.id) : a.votes > b.votes ? -1 : 1));
  return { accounts, payout, time: Number(time), epochStart };
}

/** Whether the account is a timed lock that has ended: it has no votes to give. */
const ended = (account: Account, now: number): boolean => account.lockType === LockType.timed && account.end <= now;

/** What the conduit holds of the account: its votes, its claims, both or neither. */
const held = (account: Account) => ({ votes: same(account.delegate, CONDUIT), claims: same(account.claimer, CONDUIT) });

/**
 * Where an account stands. Joining makes the conduit the account's delegate and claimer. The Voter counts the delegate
 * at the start of the epoch, so joining and leaving count from the next epoch.
 */
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

/** The name of another automation, from Hydrex's list, if the address is one. */
export const automation = (address: Address): string | undefined =>
  conduits.find((conduit) => same(conduit.address, address) && !same(conduit.address, CONDUIT))?.name;

/** Whether joining would change anything: the account holds HYDX, its lock has not ended, and it is not fully in. */
export function canJoin(account: Account, now: number): boolean {
  const { votes, claims } = held(account);
  return account.amount > 0n && !ended(account, now) && !(votes && claims);
}

/** Whether the conduit holds the account's votes or claims. */
export function canLeave(account: Account): boolean {
  const { votes, claims } = held(account);
  return votes || claims;
}

/** The checks that fail, by the id of their message on the page; empty when the chain matches config.ts. */
export async function check(): Promise<string[]> {
  const [chainId, conduitHash, impl, [veToken, voter, payoutToken, config, logic]] = await Promise.all([
    rpc<string>("eth_chainId", []),
    codeHash(CONDUIT),
    implementation(VOTING_ESCROW),
    read([
      call(CONDUIT, conduitAbi, "veToken"),
      call(CONDUIT, conduitAbi, "voter"),
      call(CONDUIT, conduitAbi, "kvcm"),
      call(VOTING_ESCROW, votingEscrowAbi, "getConduitApprovalConfig", CONDUIT),
      call(VOTING_ESCROW, votingEscrowAbi, "approvalLogic"),
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
  return Object.keys(failed).filter((id) => failed[id as keyof typeof failed]);
}
