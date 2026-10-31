import { encodeFunctionData, parseAbi, zeroAddress, type Address, type Hex } from "viem";
import * as config from "./config.ts";
import { AUTOMATIONS, MATCHA_LATTE, type Automation, type Kind } from "./config.ts";
import { WEEK, clean, list, weekStart } from "./format.ts";
import conduits from "./hydrex-conduits.json" with { type: "json" };
import { anchorsNow, type Prices } from "./prices.ts";
import { blockTime, call, costs, implementation, read, required, rpc, same, sawBlock, type Call } from "./rpc.ts";
import type { Slip, Tx } from "./wallet.ts";

const escrowAbi = parseAbi([
  "function balanceOf(address owner) view returns (uint256)",
  "function ownerOf(uint256 tokenId) view returns (address)",
  "function tokenOfOwnerByIndex(address owner, uint256 index) view returns (uint256)",
  "function lockDetails(uint256 tokenId) view returns ((uint256 amount, uint256 startTime, uint256 endTime, uint8 lockType))",
  "function balanceOfNFT(uint256 tokenId) view returns (uint256)",
  "function balanceOfNFTAt(uint256 tokenId, uint256 timestamp) view returns (uint256)",
  "function getLockDelegatee(uint256 tokenId) view returns (address)",
  "function delegates(uint256 tokenId, uint48 timestamp) view returns (address)",
  "function getClaimRedirectApproved(uint256 tokenId) view returns (address)",
  "function getPastVotes(address account, uint256 timepoint) view returns (uint256)",
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
const matchaLatteAbi = parseAbi([
  "function retireBps() view returns (uint256)",
  "function treasuryFeeBps() view returns (uint256)",
  "function MAX_TREASURY_FEE_BPS() view returns (uint256)",
  "function treasury() view returns (address)",
  "function totalTonnesRetired() view returns (uint256)",
]);
const namesAbi = parseAbi(["function getBulkNames(uint256[] tokenIds) view returns (string[])"]);
const l1Abi = parseAbi(["function getL1FeeUpperBound(uint256 unsignedTxSize) view returns (uint256)"]);

export const escrow = (name: string, ...args: unknown[]): Call => call(config.VOTING_ESCROW, escrowAbi, name, ...args);
export const voter = (name: string, ...args: unknown[]): Call => call(config.VOTER, voterAbi, name, ...args);
const matchaLatte = (name: string): Call => call(MATCHA_LATTE.address, matchaLatteAbi, name);

// Hydrex's other automations. If Hydrex lists one of the page's own, the page still treats it as its own.
export const others = conduits.filter(({ address }) => !AUTOMATIONS.some((each) => same(address, each.address)));
export const otherName = (address: Address): string | undefined =>
  others.find((other) => same(other.address, address))?.name;
const automationAt = (address: Address): Automation | undefined =>
  AUTOMATIONS.find((each) => same(address, each.address));

// Epochs follow the calendar: joins count from the next Thursday, whenever Hydrex's Voter moves on.
export type MatchaLatte = {
  time: number;
  epochStart: number;
  retireBps: bigint;
  tonnes: bigint;
  // These read apart from the others, and may fail: the page then says so.
  voted?: number | undefined;
  feeBps?: bigint | undefined;
  maxFeeBps?: bigint | undefined;
  feeRecipient?: Address | undefined;
};
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
  const at = Number(time);
  sawBlock(at);
  return {
    time: at,
    epochStart: weekStart(at),
    retireBps: retireBps!,
    tonnes: tonnes!,
    voted: voted === undefined ? undefined : Number(voted),
    feeBps,
    maxFeeBps,
    feeRecipient,
  };
}
// The share of a payout's kVCM that reaches the owner: Matcha Latte retires its share, then takes its fee from the rest.
export const paidBpsOf = ({ retireBps, feeBps }: MatchaLatte): bigint | undefined =>
  feeBps === undefined ? undefined : ((10_000n - retireBps) * (10_000n - feeBps)) / 10_000n;

// When an automation last voted, or 0, as of an epoch.
type Freshness = { epochStart: number; voted: number };
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
  // When the automation that holds its votes last voted, and when its owner did, or 0.
  delegateVoted: number;
  ownerVoted: number;
  claimer: Address;
};
export type Holdings = { owner: Address; accounts: Account[]; time: number; epochStart: number };

// The accounts read for their owner, with when each of Hydrex's other automations last voted. If the Voter cannot be
// read, an automation or an owner is just not known to have stopped voting.
async function accountsOf(owner: Address, ids: bigint[], epochStart: number, voted: unknown[]): Promise<Account[]> {
  const lastVoted = new Map(
    others.map(({ address }, i) => [address.toLowerCase(), Number((voted[i] as bigint | undefined) ?? 0n)]),
  );
  const details = await read([
    voter("lastVoted", owner),
    ...ids.flatMap((id) => [
      escrow("lockDetails", id),
      escrow("balanceOfNFT", id),
      escrow("getLockDelegatee", id),
      escrow("delegates", id, epochStart),
      escrow("getClaimRedirectApproved", id),
    ]),
    call(config.ACCOUNT_NAMES, namesAbi, "getBulkNames", ids),
  ]);
  const ownerVoted = Number((details.shift() as bigint | undefined) ?? BigInt(epochStart));
  const names = (details[5 * ids.length] as string[] | undefined) ?? [];
  return ids.map((id, i): Account => {
    const [lock, votes, delegate, delegateAtStart, claimer] = required(details.slice(5 * i, 5 * i + 5)) as [
      { amount: bigint; endTime: bigint; lockType: number },
      bigint,
      Address,
      Address,
      Address,
    ];
    const { amount, endTime, lockType } = lock;
    const delegateVoted = lastVoted.get(delegate.toLowerCase()) ?? 0;
    return {
      id,
      name: clean(names[i]),
      amount,
      end: Number(endTime),
      lockType,
      votes,
      delegate,
      delegateAtStart,
      delegateVoted,
      ownerVoted,
      claimer,
    };
  });
}
const withContext = (calls: Call[]) =>
  read([...calls, blockTime, ...others.map(({ address }) => voter("lastVoted", address))]);

export async function readAccounts(owner: Address): Promise<Holdings> {
  const [count, time, ...voted] = await withContext([escrow("balanceOf", owner)]);
  required([count, time]);
  sawBlock(Number(time));
  const epochStart = weekStart(Number(time));
  const indexes = Array.from({ length: Number(count) }, (_, i) => escrow("tokenOfOwnerByIndex", owner, BigInt(i)));
  const accounts = await accountsOf(owner, required(await read(indexes)) as bigint[], epochStart, voted);
  accounts.sort((a, b) => (a.votes === b.votes ? Number(a.id - b.id) : a.votes > b.votes ? -1 : 1));
  return { owner, accounts, time: Number(time), epochStart };
}
// One account, whoever owns it; undefined if Hydrex has none of that number. ownerOf can fail for other reasons, so a
// failed one is asked again on its own before the account is taken for gone.
export async function readAccount(id: bigint): Promise<Holdings | undefined> {
  const [first, time, ...voted] = await withContext([escrow("ownerOf", id)]);
  const owner = (first ?? (await read([escrow("ownerOf", id)]))[0]) as Address | undefined;
  if (!owner) return undefined;
  const epochStart = weekStart(Number(required([time])[0]));
  return { owner, accounts: await accountsOf(owner, [id], epochStart, voted), time: Number(time), epochStart };
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
// Hydrex counts a vote only in the epoch it is cast: an automation that has not voted since last epoch began earns
// nothing. One that never voted may be new.
export const hasStopped = (voted: number, epochStart: number): boolean => voted > 0 && voted < epochStart - WEEK;

// Hydrex counts votes for whoever held them when the epoch began, so joins and leaves count from the next epoch.
export function statusOf(account: Account, owner: Address, now: number, epochStart: number): Status {
  if (account.amount === 0n) return { kind: "empty" };
  if (ended(account, now)) return { kind: "ended" };
  const [votes, claims, atStart] = [account.delegate, account.claimer, account.delegateAtStart].map(automationAt);
  const next = epochStart + WEEK;
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

export const canJoin = (account: Account, automation: Automation, now: number): boolean => {
  const { votes, claims } = held(account, automation);
  return account.amount > 0n && !ended(account, now) && !(votes && claims);
};
export const canLeave = (account: Account, automation: Automation): boolean => {
  const { votes, claims } = held(account, automation);
  return votes || claims;
};
export const canLeaveOther = (account: Account): boolean => otherName(account.delegate) !== undefined;
// An account with less than a vote needs nothing of its owner.
export const hasVotes = ({ votes }: Account): boolean => votes >= 10n ** 18n;

export function groupOf(account: Account, status: Status): Group {
  // Without a vote, it is folded away, unless one of the page's automations still holds approvals to take back.
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

// A call to setConduitApproval. `other` names one of Hydrex's other automations.
export type Step = Slip & { id: bigint; approve: boolean };
function approval(
  { id }: Account,
  approve: boolean,
  says: string,
  target: { address: Address; name: string },
  other = false,
): Step {
  const conduitName = other ? `The ${target.name} automation` : (automationAt(target.address)?.contract ?? target.name);
  return {
    to: config.VOTING_ESCROW,
    data: encodeFunctionData({
      abi: escrowAbi,
      functionName: "setConduitApproval",
      args: [target.address, id, approve],
    }),
    id,
    approve,
    title: approve ? `Join ${target.name}` : `Leave ${other ? `the ${target.name} automation` : target.name}`,
    says: `Account #${id} ${says}`,
    on: "Hydrex's VotingEscrow",
    call: "setConduitApproval",
    fields: [
      { label: "Conduit", code: target.address, description: conduitName },
      { label: "Account", code: String(id) },
      { label: "Approve", code: String(approve) },
    ],
  };
}
// A join takes over the votes and the claims, which other automations may hold, the page's own included.
export const join = (accounts: Account[], automation: Automation): Step[] =>
  accounts.map((account) => {
    const holders = [account.delegate, account.claimer];
    const own = AUTOMATIONS.filter(
      (other) => other !== automation && holders.some((address) => same(address, other.address)),
    );
    const names = [...new Set(holders.map(otherName).filter((name) => name !== undefined))];
    const parts = [
      ...own.map(({ name }) => name),
      ...(names.length ? [`the ${list(names)} automation${names.length > 1 ? "s" : ""}`] : []),
    ];
    return approval(
      account,
      true,
      `${parts.length ? `leaves ${list(parts)} and ` : ""}joins ${automation.name}.`,
      automation,
    );
  });
export const leave = (accounts: Account[], automation: Automation): Step[] =>
  accounts.map((account) => approval(account, false, `leaves ${automation.name}.`, automation));
// The same call, with the other automation's address: only those on Hydrex's list, so that each call names it.
export const leaveOther = (accounts: Account[]): Step[] =>
  accounts.flatMap((account) => {
    const name = otherName(account.delegate);
    return name
      ? [approval(account, false, `leaves the ${name} automation.`, { address: account.delegate, name }, true)]
      : [];
  });

// The checks that fail, by the id of their message on the page, for each automation: whether the RPCs serve Base;
// whether Hydrex's VotingEscrow and its approval logic are those the page knows, as an upgrade could change what
// joining allows; and whether joining each automation is on, and approves its claims and votes only.
export async function failedChecks(): Promise<Map<Kind, string[]>> {
  const [chainId, impl, [logic, ...configs]] = await Promise.all([
    rpc<string>("eth_chainId", []),
    implementation(config.VOTING_ESCROW),
    read([escrow("approvalLogic"), ...AUTOMATIONS.map(({ address }) => escrow("getConduitApprovalConfig", address))]),
  ]);
  const failing = (checks: Record<string, boolean>) =>
    Object.entries(checks).flatMap(([id, fails]) => (fails ? [id] : []));
  const all = failing({
    chain: Number(chainId) !== config.CHAIN_ID,
    upgrade: !same(impl, config.VOTING_ESCROW_IMPLEMENTATION),
    logic: !same(String(logic), config.APPROVAL_LOGIC),
  });
  return new Map(
    AUTOMATIONS.map(({ kind, actions }, i) => {
      const [approved, active] = (configs[i] ?? [[], false]) as [number[], boolean];
      const id = kind === "matcha-latte" ? "approvals" : `${kind}-approvals`;
      return [kind, [...all, ...failing({ [id]: !active || approved.join() !== actions.join() })]];
    }),
  );
}

// What gas costs for calls that differ only by account, from `from`: the first's estimate, plus the most Base charges
// to post it to Ethereum, for each. With today's prices, to show it at.
export async function gasEstimate(steps: Tx[], from: Address): Promise<{ wei: bigint; prices: Prices | undefined }> {
  const [first] = steps;
  if (!first) return { wei: 0n, prices: undefined };
  const size = BigInt((first.data.length - 2) / 2 + 100);
  const l1 = call("0x420000000000000000000000000000000000000F", l1Abi, "getL1FeeUpperBound", size);
  const [{ gasPrice }, gas, [fee], prices] = await Promise.all([
    costs(),
    rpc<Hex>("eth_estimateGas", [{ from, to: first.to, data: first.data }]),
    read([l1]),
    anchorsNow(),
  ]);
  return { wei: (BigInt(gas) * gasPrice + ((fee as bigint | undefined) ?? 0n)) * BigInt(steps.length), prices };
}
