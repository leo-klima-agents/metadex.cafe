import { encodeFunctionData, parseAbi, size, zeroAddress, type Address, type Hex } from "viem";
import { escrowAbi, matchaLatteAbi, namesAbi, voterAbi } from "./abi.ts";
import * as config from "./config.ts";
import { AUTOMATIONS, MATCHA_LATTE, type Automation, type Kind } from "./config.ts";
import { WEEK, clean, listWords, weekStart } from "./format.ts";
import conduits from "./hydrex-conduits.json" with { type: "json" };
import { anchorsNow, key, type Prices } from "./prices.ts";
import { blockTime, call, contract, costsRead, read, readEach, required, rpc, same, sawBlock } from "./rpc.ts";
import type { Slip, Tx } from "./wallet.ts";

const l1Abi = parseAbi(["function getL1FeeUpperBound(uint256 unsignedTxSize) view returns (uint256)"]);

export const escrow = contract(config.VOTING_ESCROW, escrowAbi);
export const voter = contract(config.VOTER, voterAbi);
const matchaLatte = contract(MATCHA_LATTE.address, matchaLatteAbi);

export const automationAt = (address: Address): Automation | undefined =>
  AUTOMATIONS.find((each) => same(address, each.address));
// Hydrex's other automations. If Hydrex lists one of the page's own, the page still treats it as its own.
const others = (conduits as { name: string; address: Address }[]).filter(({ address }) => !automationAt(address));
export const otherName = (address: Address): string | undefined =>
  others.find((other) => same(other.address, address))?.name;

// Epochs follow the calendar: joins count from the next Thursday, however late Hydrex's Voter moves on.
export type MatchaLatte = {
  epochStart: number;
  retireBps: bigint;
  tonnes: bigint;
  // These may fail to read without failing the rest; the page then says so.
  voted?: number | undefined;
  feeBps?: bigint | undefined;
  maxFeeBps?: bigint | undefined;
  feeRecipient?: Address | undefined;
};
export async function readMatchaLatte(): Promise<MatchaLatte> {
  const [time, retire, retired, voted, feeBps, maxFeeBps, feeRecipient] = await read([
    blockTime,
    matchaLatte("retireBps"),
    matchaLatte("totalTonnesRetired"),
    voter("lastVoted", MATCHA_LATTE.address),
    matchaLatte("treasuryFeeBps"),
    matchaLatte("MAX_TREASURY_FEE_BPS"),
    matchaLatte("treasury"),
  ]);
  const [at, retireBps, tonnes] = required([time, retire, retired]);
  sawBlock(Number(at));
  return {
    epochStart: weekStart(Number(at)),
    retireBps,
    tonnes,
    voted: voted === undefined ? undefined : Number(voted),
    feeBps,
    maxFeeBps,
    feeRecipient,
  };
}
// The share of a payout's kVCM, in basis points, that reaches the owner. Matcha Latte retires its share first, then
// takes its fee from the rest.
export const paidBpsOf = ({ retireBps, feeBps }: MatchaLatte): bigint | undefined =>
  feeBps === undefined ? undefined : ((10_000n - retireBps) * (10_000n - feeBps)) / 10_000n;

// When an automation last voted (0 if never), with the current epoch's start.
type Freshness = { epochStart: number; voted: number };
export async function readFreshness({ address }: Automation): Promise<Freshness> {
  const [time, voted] = required(await read([blockTime, voter("lastVoted", address)]));
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
  // When the delegate last voted, if one of Hydrex's other automations (else 0), and when the owner did (0 if never).
  delegateVoted: number;
  ownerVoted: number;
  claimer: Address;
};
export type Holdings = { owner: Address; accounts: Account[]; epochStart: number };

async function othersVoted(): Promise<Map<Address, number>> {
  const found = await readEach(others, { voted: ({ address }) => voter("lastVoted", address) });
  return new Map(found.map(({ item, voted }) => [key(item.address), Number(voted ?? 0n)]));
}
// If the Voter cannot be read, no automation or owner is taken to have stopped voting.
async function accountsOf(
  owner: Address,
  ids: bigint[],
  epochStart: number,
  lastVoted: Map<Address, number>,
): Promise<Account[]> {
  const [[ownerVoted], found] = await Promise.all([
    read([voter("lastVoted", owner)]),
    readEach(ids, {
      lock: (id) => escrow("lockDetails", id),
      votes: (id) => escrow("balanceOfNFT", id),
      delegate: (id) => escrow("getLockDelegatee", id),
      atStart: (id) => escrow("delegates", id, epochStart),
      claimer: (id) => escrow("getClaimRedirectApproved", id),
      names: (id) => call(config.ACCOUNT_NAMES, namesAbi, "getBulkNames", [id]),
    }),
  ]);
  return found.map(({ item: id, names, ...each }): Account => {
    const [{ amount, endTime, lockType }, votes, delegate, delegateAtStart, claimer] = required([
      each.lock,
      each.votes,
      each.delegate,
      each.atStart,
      each.claimer,
    ]);
    return {
      id,
      name: clean(names?.[0]),
      amount,
      end: Number(endTime),
      lockType,
      votes,
      delegate,
      delegateAtStart,
      delegateVoted: lastVoted.get(key(delegate)) ?? 0,
      ownerVoted: Number(ownerVoted ?? epochStart),
      claimer,
    };
  });
}

export async function readAccounts(owner: Address): Promise<Holdings> {
  const [[count, time], lastVoted] = await Promise.all([
    read([escrow("balanceOf", owner), blockTime]).then(required),
    othersVoted(),
  ]);
  sawBlock(Number(time));
  const epochStart = weekStart(Number(time));
  const indexes = Array.from({ length: Number(count) }, (_, i) => escrow("tokenOfOwnerByIndex", owner, BigInt(i)));
  const accounts = await accountsOf(owner, required(await read(indexes)), epochStart, lastVoted);
  accounts.sort((a, b) => (a.votes === b.votes ? Number(a.id - b.id) : a.votes > b.votes ? -1 : 1));
  return { owner, accounts, epochStart };
}
// One account, whoever owns it, or undefined if Hydrex has no account with that id. `ownerOf` can fail for other
// reasons, so a failed call is retried on its own before the account is taken as gone.
export async function readAccount(id: bigint): Promise<Holdings | undefined> {
  const [[first, time], lastVoted] = await Promise.all([read([escrow("ownerOf", id), blockTime]), othersVoted()]);
  const owner = first ?? (await read([escrow("ownerOf", id)]))[0];
  if (!owner) return undefined;
  const epochStart = weekStart(Number(required([time])[0]));
  return { owner, accounts: await accountsOf(owner, [id], epochStart, lastVoted), epochStart };
}

// "in", "partly", "joined" and "left" are about the page's own automations.
export type Status =
  | { kind: "in" | "partly"; automation: Automation }
  | { kind: "joined" | "left"; automation: Automation; date: number }
  | { kind: "self" | "ended" | "empty" }
  | { kind: "other"; name: string }
  | { kind: "left-other"; name: string; date: number }
  | { kind: "stopped"; name: string; voted: number; since: number }
  | { kind: "unvoted"; voted: number }
  | { kind: "delegated"; to: Address };
export type Group = "needs:stopped" | "needs:partly" | "needs:unvoted" | `in:${Kind}` | "other" | "closed";

const ended = (account: Account, now: number): boolean => account.lockType === LockType.timed && account.end <= now;
const held = (account: Account, { address }: Automation) => ({
  votes: same(account.delegate, address),
  claims: same(account.claimer, address),
});
// Hydrex counts a vote only in the epoch it is cast, so an automation that has not voted since last epoch began earns
// nothing. One that has never voted (0) may be new, so it does not count as stopped.
export const hasStopped = (voted: number, epochStart: number): boolean => voted > 0 && voted < epochStart - WEEK;

// Hydrex counts votes for whoever held them when the epoch began, so joins and leaves count from the next epoch.
export function statusOf(account: Account, owner: Address, now: number, epochStart: number): Status {
  if (account.amount === 0n) return { kind: "empty" };
  if (ended(account, now)) return { kind: "ended" };
  const [votes, claims, atStart] = [account.delegate, account.claimer, account.delegateAtStart].map(automationAt);
  const next = epochStart + WEEK;
  if (votes && votes === claims)
    return votes === atStart ? { kind: "in", automation: votes } : { kind: "joined", automation: votes, date: next };
  const partly = votes ?? claims;
  if (partly) return { kind: "partly", automation: partly };
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

export const canJoin = (account: Account, automation: Automation, now: number): boolean => {
  const { votes, claims } = held(account, automation);
  return account.amount > 0n && !ended(account, now) && !(votes && claims);
};
export const canLeave = (account: Account, automation: Automation): boolean => {
  const { votes, claims } = held(account, automation);
  return votes || claims;
};
export const canLeaveOther = (account: Account): boolean => otherName(account.delegate) !== undefined;
// An account with less than one vote (10^18) needs no action from its owner.
export const hasVotes = ({ votes }: Account): boolean => votes >= 10n ** 18n;

export function groupOf(account: Account, status: Status): Group {
  // An account without a vote is folded away, unless one of the page's automations still holds approvals to revoke.
  const withoutVotes = (): Group => {
    const holder = AUTOMATIONS.find((automation) => canLeave(account, automation));
    return holder ? `in:${holder.kind}` : "closed";
  };
  switch (status.kind) {
    case "stopped":
    case "partly":
    case "unvoted":
      return hasVotes(account) ? `needs:${status.kind}` : withoutVotes();
    case "in":
    case "joined":
      return `in:${status.automation.kind}`;
    case "ended":
    case "empty":
      return withoutVotes();
    default:
      return "other";
  }
}

function approval(
  { id }: Account,
  approve: boolean,
  says: string,
  target: Pick<Automation, "address" | "name" | "contract">,
): Slip {
  return {
    to: config.VOTING_ESCROW,
    data: encodeFunctionData({
      abi: escrowAbi,
      functionName: "setConduitApproval",
      args: [target.address, id, approve],
    }),
    title: `${approve ? "Join" : "Leave"} ${target.name}`,
    says: `Account #${id} ${says}`,
    on: "Hydrex's VotingEscrow",
    call: "setConduitApproval",
    fields: [
      { label: "Conduit", code: target.address, description: target.contract },
      { label: "Account", code: String(id) },
      { label: "Approve", code: String(approve) },
    ],
  };
}
// Joining takes over the votes and the claims from whichever automations hold them, the page's own included.
export const join = (accounts: Account[], automation: Automation): Slip[] =>
  accounts.map((account) => {
    const holders = [account.delegate, account.claimer];
    const own = AUTOMATIONS.filter(
      (other) => other !== automation && holders.some((address) => same(address, other.address)),
    );
    const names = [...new Set(holders.map(otherName).filter((name) => name !== undefined))];
    const parts = [
      ...own.map(({ name }) => name),
      ...(names.length ? [`the ${listWords(names)} automation${names.length > 1 ? "s" : ""}`] : []),
    ];
    return approval(
      account,
      true,
      `${parts.length ? `leaves ${listWords(parts)} and ` : ""}joins ${automation.name}.`,
      automation,
    );
  });
export const leave = (accounts: Account[], automation: Automation): Slip[] =>
  accounts.map((account) => approval(account, false, `leaves ${automation.name}.`, automation));
// Leaves another automation with the same call. Only automations on Hydrex's list are offered, so each call can name
// the one it leaves.
export const leaveOther = (accounts: Account[]): Slip[] =>
  accounts.flatMap((account) => {
    const name = otherName(account.delegate);
    const target = { address: account.delegate, name: `the ${name} automation`, contract: `The ${name} automation` };
    return name ? [approval(account, false, `leaves ${target.name}.`, target)] : [];
  });

// Gas for calls that differ only by account, sent from `from`: the first call's estimate plus the most Base charges to
// post it to Ethereum (nothing if the oracle cannot be read), times the number of calls. Also returns today's prices to
// show it in.
export async function gasEstimate(steps: Tx[], from: Address): Promise<{ wei: bigint; prices: Prices | undefined }> {
  const [first] = steps;
  if (!first) return { wei: 0n, prices: undefined };
  const l1 = call(config.GAS_PRICE_ORACLE, l1Abi, "getL1FeeUpperBound", BigInt(size(first.data) + 100));
  const [{ gasPrice }, gas, [fee], prices] = await Promise.all([
    costsRead(),
    rpc<Hex>("eth_estimateGas", [{ from, to: first.to, data: first.data }]),
    read([l1]),
    anchorsNow(),
  ]);
  return { wei: (BigInt(gas) * gasPrice + (fee ?? 0n)) * BigInt(steps.length), prices };
}
