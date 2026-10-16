import type { Address } from "viem";
import { accountNamesAbi, conduitAbi, poolAbi, voterAbi, votingEscrowAbi } from "./abi.ts";
import { call, codeHash, implementation, read, rpc } from "./chain.ts";
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
import { WEEK, clean, short } from "./format.ts";
import conduits from "./hydrex-conduits.json" with { type: "json" };

const ZERO = "0x0000000000000000000000000000000000000000";

export const LockType = { timed: 0, rolling: 1, permanent: 2 } as const;

export type Pool = { address: Address; name: string; votes: bigint };

export type Relay = {
  retireBps: bigint;
  feeBps: bigint;
  /** Tonnes retired so far, with 18 decimals. */
  tonnes: bigint;
  /** The name retirements are made in. */
  entity: string;
  /** The conduit's votes this week. */
  votes: bigint;
  lastVoted: number;
  /** The latest vote, largest first. */
  pools: Pool[];
};

export type Account = {
  id: bigint;
  name: string;
  amount: bigint;
  end: number;
  lockType: number;
  votes: bigint;
  delegate: Address;
  /** The delegate at the start of the week: the votes count for it this week. */
  delegateAtStart: Address;
  claimer: Address;
};

export type Status =
  | { kind: "in" | "partly" | "self" | "ended" | "empty" }
  | { kind: "joined" | "left"; date: number }
  | { kind: "other"; name: string }
  | { kind: "delegated"; to: Address };

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

function all(values: unknown[]): unknown[] {
  if (values.includes(undefined)) throw new Error("A read from Base failed.");
  return values;
}

export async function readRelay(): Promise<Relay> {
  const [epoch, retireBps, feeBps, tonnes, entity, lastVoted, length] = all(
    await read([
      call(VOTER, voterAbi, "_epochTimestamp"),
      call(CONDUIT, conduitAbi, "retireBps"),
      call(CONDUIT, conduitAbi, "treasuryFeeBps"),
      call(CONDUIT, conduitAbi, "totalTonnesRetired"),
      call(CONDUIT, conduitAbi, "retiringEntityName"),
      call(VOTER, voterAbi, "lastVoted", CONDUIT),
      call(VOTER, voterAbi, "poolVoteLength", CONDUIT),
    ]),
  ) as [bigint, bigint, bigint, bigint, string, bigint, bigint];
  const [votes, ...pools] = all(
    await read([
      call(VOTING_ESCROW, votingEscrowAbi, "getPastVotes", CONDUIT, epoch),
      ...Array.from({ length: Number(length) }, (_, i) => call(VOTER, voterAbi, "poolVote", CONDUIT, BigInt(i))),
    ]),
  ) as [bigint, ...Address[]];
  return {
    retireBps,
    feeBps,
    tonnes,
    entity: clean(entity),
    votes,
    lastVoted: Number(lastVoted),
    pools: await readPools(pools),
  };
}

async function readPools(addresses: Address[]): Promise<Pool[]> {
  const reads = await read(
    addresses.flatMap((pool) => [
      call(VOTER, voterAbi, "votes", CONDUIT, pool),
      call(pool, poolAbi, "token0"),
      call(pool, poolAbi, "token1"),
      call(pool, poolAbi, "symbol"),
    ]),
  );
  const rows = addresses.map((address, i) => {
    const [votes, token0, token1, symbol] = reads.slice(4 * i, 4 * i + 4) as [bigint?, Address?, Address?, string?];
    return { address, votes: votes ?? 0n, token0, token1, symbol };
  });
  const tokens = [...new Set(rows.flatMap(({ token0, token1 }) => (token0 && token1 ? [token0, token1] : [])))];
  const symbols = await read(tokens.map((token) => call(token, poolAbi, "symbol")));
  const symbolOf = new Map(tokens.map((token, i) => [token, symbols[i] as string | undefined]));
  return rows
    .map(({ address, votes, token0, token1, symbol }) => ({
      address,
      votes,
      name: poolName(address, {
        token0: token0 && symbolOf.get(token0),
        token1: token1 && symbolOf.get(token1),
        symbol,
      }),
    }))
    .sort((a, b) => (a.votes === b.votes ? 0 : a.votes > b.votes ? -1 : 1));
}

/** A pool's pair and kind ("GOO/cbBTC · vAMM"), else its symbol ("steakEURC", for a vault), else its short address. */
export function poolName(
  address: Address,
  found: { token0?: string | undefined; token1?: string | undefined; symbol?: string | undefined },
): string {
  const [token0, token1, symbol] = [clean(found.token0), clean(found.token1), clean(found.symbol)];
  const kind = symbol.split("-")[0] ?? "";
  if (token0 && token1) return kind ? `${token0}/${token1} · ${kind}` : `${token0}/${token1}`;
  return symbol || short(address);
}

/** An owner's accounts, where its payouts go, and the start of the week their delegates are read at. */
export async function readAccounts(
  owner: Address,
): Promise<{ accounts: Account[]; payout: Address; epochStart: number }> {
  const [count, payout, epoch] = all(
    await read([
      call(VOTING_ESCROW, votingEscrowAbi, "balanceOf", owner),
      call(CONDUIT, conduitAbi, "getEffectiveRecipientForOwner", owner),
      call(VOTER, voterAbi, "_epochTimestamp"),
    ]),
  ) as [bigint, Address, bigint];
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
      call(VOTING_ESCROW, votingEscrowAbi, "delegates", id, epoch),
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
  return { accounts, payout, epochStart: Number(epoch) };
}

/**
 * Where an account stands. Joining makes the conduit the account's delegate and claimer. The Voter counts the delegate
 * at the start of the week, so joining and leaving count from the next week.
 */
export function status(account: Account, owner: Address, now: number, epochStart: number): Status {
  if (account.amount === 0n) return { kind: "empty" };
  if (account.lockType === LockType.timed && account.end <= now) return { kind: "ended" };
  const [votesNow, claims, votedAtStart] = [account.delegate, account.claimer, account.delegateAtStart].map((a) =>
    same(a, CONDUIT),
  );
  if (votesNow && claims) return votedAtStart ? { kind: "in" } : { kind: "joined", date: epochStart + WEEK };
  if (votesNow || claims) return { kind: "partly" };
  if (votedAtStart) return { kind: "left", date: epochStart + WEEK };
  if (same(account.delegate, owner) || same(account.delegate, ZERO)) return { kind: "self" };
  const other = conduits.find(({ address }) => same(address, account.delegate));
  return other ? { kind: "other", name: other.name } : { kind: "delegated", to: account.delegate };
}

/** Whether joining would change anything: the account holds HYDX, its lock has not ended, and it is not fully in. */
export const canJoin = (account: Account, now: number): boolean =>
  account.amount > 0n &&
  !(account.lockType === LockType.timed && account.end <= now) &&
  !(same(account.delegate, CONDUIT) && same(account.claimer, CONDUIT));

/** Whether the conduit holds the account's votes or claims. */
export const canLeave = (account: Account): boolean =>
  same(account.delegate, CONDUIT) || same(account.claimer, CONDUIT);

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
