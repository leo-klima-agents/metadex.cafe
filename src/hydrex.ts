import { encodeFunctionData, zeroAddress, type Address, type Hex } from "viem";
import {
  ABI,
  ACCOUNT_NAMES,
  APPROVAL_LOGIC,
  AUTOMATIONS,
  CHAIN_ID,
  GAS_PRICE_ORACLE,
  MATCHA_LATTE,
  DOUBLE_ESPRESSO,
  VOTER,
  VOTING_ESCROW,
  VOTING_ESCROW_IMPLEMENTATION,
  type Automation,
  type Kind,
} from "./config.ts";
import conduits from "./conduits.json" with { type: "json" };
import { WEEK, clean, weekStart } from "./format.ts";
import { anchorsNow, costs, type Prices } from "./prices.ts";
import { blockTime, call, implementation, read, required, rpc, type Call } from "./rpc.ts";
import { memo, same } from "./util.ts";
import type { Tx } from "./wallet.ts";

export const escrow = (name: string, ...args: unknown[]) => call(VOTING_ESCROW, ABI.escrow, name, ...args);
export const voter = (name: string, ...args: unknown[]) => call(VOTER, ABI.voter, name, ...args);
const matchaLatte = (name: string) => call(MATCHA_LATTE.address, ABI.matchaLatte, name);
// Hydrex's other automations, as api.hydrex.fi/conduits lists them.
export const OTHERS = conduits as { name: string; address: Address }[];
export const otherName = (address: Address) => OTHERS.find((other) => same(other.address, address))?.name;
const ours = (address: Address) => AUTOMATIONS.find((automation) => same(address, automation.address));

export type MatchaLatte = {
  epochStart: number;
  retireBps: bigint;
  tonnes: bigint;
  // Each may fail on its own.
  voted?: number;
  feeBps?: bigint;
  maxFeeBps?: bigint;
  feeRecipient?: Address;
};
// What reaches the owner: the share retired first, then the fee from the rest; unknown with the fee.
export const paidBpsOf = ({ retireBps, feeBps }: MatchaLatte): bigint | undefined =>
  feeBps === undefined ? undefined : ((10_000n - retireBps) * (10_000n - feeBps)) / 10_000n;

export async function readMatchaLatte(): Promise<MatchaLatte> {
  const replies = await read([
    blockTime,
    matchaLatte("retireBps"),
    matchaLatte("totalTonnesRetired"),
    voter("lastVoted", MATCHA_LATTE.address),
    matchaLatte("treasuryFeeBps"),
    matchaLatte("MAX_TREASURY_FEE_BPS"),
    matchaLatte("treasury"),
  ]);
  const [time, retireBps, tonnes] = required(replies.slice(0, 3)) as bigint[];
  const [voted, feeBps, maxFeeBps, feeRecipient] = replies.slice(3) as [bigint?, bigint?, bigint?, Address?];
  return {
    epochStart: weekStart(Number(time)),
    retireBps: retireBps!,
    tonnes: tonnes!,
    ...(voted !== undefined && { voted: Number(voted) }),
    ...(feeBps !== undefined && { feeBps }),
    ...(maxFeeBps !== undefined && { maxFeeBps }),
    ...(feeRecipient && { feeRecipient }),
  };
}

// When an automation last voted, or 0, as of the epoch now.
export type Freshness = { epochStart: number; voted: number };
export async function readFreshness({ address }: Automation): Promise<Freshness> {
  const [time, voted] = required(await read([blockTime, voter("lastVoted", address)])) as bigint[];
  return { epochStart: weekStart(Number(time)), voted: Number(voted) };
}

export const LockType = { timed: 0, rolling: 1, permanent: 2 } as const;
export type Account = {
  id: bigint;
  name: string;
  amount: bigint;
  end: number;
  lockType: number;
  votes: bigint;
  delegate: Address;
  delegateAtStart: Address;
  // When whoever holds its votes, or its owner, last voted, or 0.
  delegateVoted: number;
  ownerVoted: number;
  claimer: Address;
};
export type Holdings = { owner: Address; accounts: Account[]; time: number; epochStart: number };

// The block's time and when each other automation last voted, after `calls`; if the Voter fails, nobody stopped.
async function context(calls: Call[]) {
  const [time, ...replies] = await read([
    blockTime,
    ...OTHERS.map(({ address }) => voter("lastVoted", address)),
    ...calls,
  ]);
  const voted = replies.splice(0, OTHERS.length) as (bigint | undefined)[];
  const lastVoted = (address: Address) => Number(voted[OTHERS.findIndex((o) => same(o.address, address))] ?? 0n);
  return { time: Number(required([time])[0]), lastVoted, replies };
}

async function holdings(owner: Address, ids: bigint[], { time, lastVoted }: Awaited<ReturnType<typeof context>>) {
  const epochStart = weekStart(time);
  const details = await read([
    voter("lastVoted", owner),
    call(ACCOUNT_NAMES, ABI.accountNames, "getBulkNames", ids),
    ...ids.flatMap((id) => [
      escrow("lockDetails", id),
      escrow("balanceOfNFT", id),
      escrow("getLockDelegatee", id),
      escrow("delegates", id, epochStart),
      escrow("getClaimRedirectApproved", id),
    ]),
  ]);
  const [voted, names = []] = details.splice(0, 2) as [bigint | undefined, readonly string[] | undefined];
  const accounts = ids.map((id, i): Account => {
    const [lock, votes, delegate, delegateAtStart, claimer] = required(details.slice(5 * i, 5 * i + 5)) as [
      { amount: bigint; endTime: bigint; lockType: number },
      bigint,
      Address,
      Address,
      Address,
    ];
    return {
      id,
      name: clean(names[i]),
      amount: lock.amount,
      end: Number(lock.endTime),
      lockType: lock.lockType,
      votes,
      delegate,
      delegateAtStart,
      delegateVoted: lastVoted(delegate),
      ownerVoted: Number(voted ?? BigInt(epochStart)),
      claimer,
    };
  });
  return { owner, accounts, time, epochStart };
}

export async function readAccounts(owner: Address): Promise<Holdings> {
  const found = await context([escrow("balanceOf", owner)]);
  const [count] = required(found.replies) as [bigint];
  const indexes = Array.from({ length: Number(count) }, (_, i) => escrow("tokenOfOwnerByIndex", owner, BigInt(i)));
  const result = await holdings(owner, required(await read(indexes)) as bigint[], found);
  result.accounts.sort((a, b) => (a.votes === b.votes ? Number(a.id - b.id) : a.votes > b.votes ? -1 : 1));
  return result;
}

// Anyone's account; undefined if none has that number. ownerOf fails then, as it can for other reasons, so it is asked
// once more on its own before the account is taken for gone.
export async function readAccount(id: bigint): Promise<Holdings | undefined> {
  const found = await context([escrow("ownerOf", id)]);
  const owner = (found.replies[0] ?? (await read([escrow("ownerOf", id)]))[0]) as Address | undefined;
  return owner && holdings(owner, [id], found);
}

// Hydrex counts a vote only in the epoch it is cast: one not cast since before last epoch earns nothing.
export const hasStopped = (voted: number, epochStart: number): boolean => voted > 0 && voted < epochStart - WEEK;
const ended = (account: Account, now: number) => account.lockType === LockType.timed && account.end <= now;
export const hasVotes = ({ votes }: Account): boolean => votes >= 10n ** 18n;

// "in", "partly", "joined" and "left" are about the page's own automations; joins and leaves count from the next epoch.
export type Status =
  | { kind: "in" | "partly"; automation: Automation }
  | { kind: "joined" | "left"; automation: Automation; date: number }
  | { kind: "self" | "ended" | "empty" }
  | { kind: "other"; name: string }
  | { kind: "left-other"; name: string; date: number }
  | { kind: "stopped"; name: string; voted: number; since: number }
  | { kind: "unvoted"; voted: number }
  | { kind: "delegated"; to: Address };

export function statusOf(account: Account, owner: Address, now: number, epochStart: number): Status {
  if (account.amount === 0n) return { kind: "empty" };
  if (ended(account, now)) return { kind: "ended" };
  const next = epochStart + WEEK;
  const [votes, claims, atStart] = [account.delegate, account.claimer, account.delegateAtStart].map(ours);
  if (votes && votes === claims)
    return votes === atStart ? { kind: "in", automation: votes } : { kind: "joined", automation: votes, date: next };
  if (votes || claims) return { kind: "partly", automation: (votes ?? claims)! };
  if (atStart) return { kind: "left", automation: atStart, date: next };
  if (same(account.delegate, owner) || same(account.delegate, zeroAddress)) {
    const before = otherName(account.delegateAtStart);
    if (before) return { kind: "left-other", name: before, date: next };
    return account.ownerVoted >= epochStart - WEEK ? { kind: "self" } : { kind: "unvoted", voted: account.ownerVoted };
  }
  const name = otherName(account.delegate);
  if (!name) return { kind: "delegated", to: account.delegate };
  const voted = account.delegateVoted;
  return hasStopped(voted, epochStart)
    ? { kind: "stopped", name, voted, since: weekStart(voted) + WEEK }
    : { kind: "other", name };
}

const holds = (account: Account, { address }: Automation) =>
  [same(account.delegate, address), same(account.claimer, address)] as const;
export const canJoin = (account: Account, automation: Automation, now: number): boolean =>
  account.amount > 0n && !ended(account, now) && !holds(account, automation).every(Boolean);
export const canLeave = (account: Account, automation: Automation): boolean => holds(account, automation).some(Boolean);
export const canLeaveOther = (account: Account): boolean => otherName(account.delegate) !== undefined;
// The automation it is in or joining, or else leaving.
export const automationOf = (account: Account): Automation | undefined =>
  AUTOMATIONS.find((automation) => canLeave(account, automation)) ?? ours(account.delegateAtStart);

// Accounts that need their owner, by remedy; those in each of the page's automations; the others; those with nothing
// to vote with, unless one of the page's automations still holds their approvals.
export type Group = "needs:stopped" | "needs:partly" | "needs:unvoted" | `in:${Kind}` | "other" | "closed";
export function groupOf(account: Account, status: Status): Group {
  const holder = AUTOMATIONS.find((automation) => canLeave(account, automation));
  const idle: Group = holder ? `in:${holder.kind}` : "closed";
  if (status.kind === "stopped" || status.kind === "partly" || status.kind === "unvoted")
    return hasVotes(account) ? `needs:${status.kind}` : idle;
  if (status.kind === "in" || status.kind === "joined") return `in:${status.automation.kind}`;
  return status.kind === "ended" || status.kind === "empty" ? idle : "other";
}

// setConduitApproval: `other` for Hydrex's own automations; `leaving` names those a join takes over from.
export type Step = Tx & {
  id: bigint;
  approve: boolean;
  conduit: Address;
  name: string;
  other: boolean;
  leaving: string[];
};
const step = (
  id: bigint,
  approve: boolean,
  conduit: Address,
  name: string,
  other: boolean,
  leaving: string[] = [],
) => ({
  to: VOTING_ESCROW,
  data: encodeFunctionData({ abi: ABI.escrow, functionName: "setConduitApproval", args: [conduit, id, approve] }),
  id,
  approve,
  conduit,
  name,
  other,
  leaving,
});

export const join = (accounts: Account[], automation: Automation): Step[] =>
  accounts.map((account) => {
    const holders = [account.delegate, account.claimer];
    const own = AUTOMATIONS.filter(
      (each) => each !== automation && holders.some((address) => same(address, each.address)),
    );
    const names = [...new Set(holders.map(otherName).filter((name) => name !== undefined))];
    const leaving = [...own.map(({ name }) => name), ...names.map((name) => `the ${name} automation`)];
    return step(account.id, true, automation.address, automation.name, false, leaving);
  });
export const leave = (accounts: Account[], automation: Automation): Step[] =>
  accounts.map(({ id }) => step(id, false, automation.address, automation.name, false));
export const leaveOther = (accounts: Account[]): Step[] =>
  accounts.flatMap(({ id, delegate }) => {
    const name = otherName(delegate);
    return name ? [step(id, false, delegate, name, true)] : [];
  });

// Ids of the checks that fail for each automation: Base, Hydrex's VotingEscrow and its approval logic for both, and what
// joining each approves, which must be on, and its claims and votes only.
export async function failedChecks(): Promise<Map<Kind, string[]>> {
  const [chainId, impl, [logic, ...configs]] = await Promise.all([
    rpc<string>("eth_chainId", []),
    implementation(VOTING_ESCROW),
    read([escrow("approvalLogic"), ...AUTOMATIONS.map(({ address }) => escrow("getConduitApprovalConfig", address))]),
  ]);
  const failing = (checks: Record<string, boolean>) => Object.keys(checks).filter((id) => checks[id]);
  const all = failing({
    chain: Number(chainId) !== CHAIN_ID,
    upgrade: !same(impl, VOTING_ESCROW_IMPLEMENTATION),
    logic: !same(String(logic), APPROVAL_LOGIC),
  });
  return new Map(
    AUTOMATIONS.map(({ kind, actions }, i) => {
      const [approved, active] = (configs[i] ?? [[], false]) as [number[], boolean];
      const id = kind === DOUBLE_ESPRESSO.kind ? "double-espresso-approvals" : "approvals";
      return [kind, [...all, ...failing({ [id]: !active || approved.join() !== actions.join() })]];
    }),
  );
}

// What the steps cost from `from`, in wei: each about what the first does, plus the most Base charges to post it.
const l1Fee = memo(async (size: bigint) => {
  const [fee] = await read([call(GAS_PRICE_ORACLE, ABI.gasPriceOracle, "getL1FeeUpperBound", size)]);
  return (fee as bigint | undefined) ?? 0n;
});
export async function gasCost(steps: Tx[], from: Address): Promise<{ wei: bigint; prices: Prices | undefined }> {
  const [first] = steps;
  if (!first) return { wei: 0n, prices: undefined };
  const [{ gasPrice }, gas, l1, prices] = await Promise.all([
    costs(),
    rpc<Hex>("eth_estimateGas", [{ from, to: first.to, data: first.data }]),
    l1Fee(BigInt((first.data.length - 2) / 2 + 100)),
    anchorsNow(),
  ]);
  return { wei: (BigInt(gas) * gasPrice + l1) * BigInt(steps.length), prices };
}
