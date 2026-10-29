import { encodeFunctionData, parseAbi, zeroAddress, type Address, type Hex } from "viem";
import { blockTime, call, implementation, read, required, rpc, same, type Call } from "./chain.ts";
import {
  ACCOUNT_NAMES,
  APPROVAL_LOGIC,
  AUTOMATIONS,
  DOUBLE_ESPRESSO,
  MATCHA_LATTE,
  CHAIN_ID,
  VOTER,
  VOTING_ESCROW,
  VOTING_ESCROW_IMPLEMENTATION,
  type Automation,
  type Kind,
} from "./config.ts";
import { WEEK, clean, list, weekStart } from "./format.ts";
import conduits from "./hydrex-conduits.json" with { type: "json" };
import { anchorsNow, type Prices } from "./prices.ts";
import { costs } from "./swap-calls.ts";
import type { Slip } from "./views/review.ts";
import type { Tx } from "./wallet.ts";

const votingEscrowAbi = parseAbi([
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

const doubleEspressoAbi = parseAbi(["function lastClaimBlock(uint256 tokenId) view returns (uint256)"]);

// Base's predeploy that prices posting a transaction's data to Ethereum.
const GAS_PRICE_ORACLE: Address = "0x420000000000000000000000000000000000000F";
const gasPriceOracleAbi = parseAbi(["function getL1FeeUpperBound(uint256 unsignedTxSize) view returns (uint256)"]);

const accountNamesAbi = parseAbi(["function getBulkNames(uint256[] tokenIds) view returns (string[])"]);

export const escrow = (functionName: string, ...args: unknown[]) =>
  call(VOTING_ESCROW, votingEscrowAbi, functionName, ...args);
export const voter = (functionName: string, ...args: unknown[]) => call(VOTER, voterAbi, functionName, ...args);
export const matchaLatte = (functionName: string, ...args: unknown[]) =>
  call(MATCHA_LATTE.address, matchaLatteAbi, functionName, ...args);
export const doubleEspresso = (functionName: string, ...args: unknown[]) =>
  call(DOUBLE_ESPRESSO.address, doubleEspressoAbi, functionName, ...args);

// Hydrex's other automations. If Hydrex lists one of the page's own, the page still treats it as its own.
export const others = conduits.filter(
  ({ address }) => !AUTOMATIONS.some((automation) => same(address, automation.address)),
);

export const LockType = { timed: 0, rolling: 1, permanent: 2 } as const;

export type MatchaLatte = {
  time: number;
  epochStart: number;
  retireBps: bigint;
  tonnes: bigint;
  // When it last voted, or 0. It, its fee, the most the fee can become, and where the fee goes may be unknown, as
  // their reads may fail apart from the others: the page then says so, and reads them again later.
  voted?: number;
  feeBps?: bigint;
  maxFeeBps?: bigint;
  feeRecipient?: Address;
};

// The share of a payout's kVCM that reaches the owner: Matcha Latte retires its share first, then takes its fee from
// the rest. Unknown while the fee is: counting it as none would promise the owner too much.
export const paidBpsOf = ({ retireBps, feeBps }: MatchaLatte): bigint | undefined =>
  feeBps === undefined ? undefined : ((10_000n - retireBps) * (10_000n - feeBps)) / 10_000n;

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
  // When its owner last voted, or 0: an account they vote with themselves earns only in an epoch they voted in.
  ownerVoted: number;
  claimer: Address;
};

export type Holdings = {
  owner: Address;
  accounts: Account[];
  time: number;
  epochStart: number;
};

// "in", "partly", "joined" and "left" are about the page's own automations.
export type Status =
  | { kind: "in" | "partly"; automation: Automation }
  | { kind: "joined" | "left"; automation: Automation; date: number }
  | { kind: "self" | "ended" | "empty" }
  | { kind: "other"; name: string }
  | { kind: "left-other"; name: string; date: number }
  | { kind: "stopped"; name: string; voted: number; since: number }
  // Its owner votes with it, but has not voted since before last epoch, or ever: 0.
  | { kind: "unvoted"; voted: number }
  | { kind: "delegated"; to: Address };

// The App's groups: accounts that need their owner, by what each needs, as each takes its own remedy (in one of Hydrex's
// automations that stopped, partly in one of the page's, or not voted with), those in each of the page's automations or
// joining it, the others, and those with nothing to vote with.
export type Group = "needs:stopped" | "needs:partly" | "needs:unvoted" | `in:${Kind}` | "other" | "closed";

// `automation` is set only when the call is about another of Hydrex's automations.
export type Step = Slip & { id: bigint; approve: boolean; conduit: Address; conduitName: string; automation?: string };

// Epochs follow the calendar. Hydrex's Voter moves its own epoch only once someone calls the minter, but joins count
// from the next Thursday either way.
const epochAt = (time: unknown): number => weekStart(Number(time));

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
  const [time, retireBps, tonnes] = required(replies.slice(0, 3)) as [bigint, bigint, bigint];
  const voted = replies[3] as bigint | undefined;
  const [feeBps, maxFeeBps, feeRecipient] = replies.slice(4) as [bigint?, bigint?, Address?];
  return {
    time: Number(time),
    epochStart: epochAt(time),
    retireBps,
    tonnes,
    ...(voted !== undefined && { voted: Number(voted) }),
    ...(feeBps !== undefined && { feeBps }),
    ...(maxFeeBps !== undefined && { maxFeeBps }),
    ...(feeRecipient && { feeRecipient }),
  };
}

// When each of Hydrex's other automations last voted. If the Voter cannot be read, they are just not known to have
// stopped.
const othersVoted = (replies: unknown[]): Map<string, number> =>
  new Map(others.map(({ address }, i) => [address.toLowerCase(), Number((replies[i] as bigint | undefined) ?? 0n)]));

// The block's time, and when each of Hydrex's other automations last voted, read after the calls given.
const withContext = (calls: Call[]): Promise<unknown[]> =>
  read([...calls, blockTime, ...others.map(({ address }) => voter("lastVoted", address))]);

// The accounts, as read for their owner.
async function accountsOf(
  owner: Address,
  ids: bigint[],
  epochStart: number,
  lastVoted: Map<string, number>,
): Promise<Account[]> {
  const details = await read([
    voter("lastVoted", owner),
    ...ids.flatMap((id) => [
      escrow("lockDetails", id),
      escrow("balanceOfNFT", id),
      escrow("getLockDelegatee", id),
      escrow("delegates", id, epochStart),
      escrow("getClaimRedirectApproved", id),
    ]),
    call(ACCOUNT_NAMES, accountNamesAbi, "getBulkNames", ids),
  ]);
  // If the Voter cannot be read, the owner is just not known to have stopped voting.
  const ownerVoted = Number((details.shift() as bigint | undefined) ?? BigInt(epochStart));
  const names = (details[5 * ids.length] as readonly string[] | undefined) ?? [];
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
      ownerVoted,
      claimer,
    };
  });
  return accounts;
}

export async function readAccounts(owner: Address): Promise<Holdings> {
  const [count, time, ...voted] = await withContext([escrow("balanceOf", owner)]);
  required([count, time]);
  const epochStart = epochAt(time);
  const indexes = Array.from({ length: Number(count) }, (_, i) => BigInt(i));
  const ids = required(await read(indexes.map((i) => escrow("tokenOfOwnerByIndex", owner, i)))) as bigint[];
  const accounts = await accountsOf(owner, ids, epochStart, othersVoted(voted));
  accounts.sort((a, b) => (a.votes === b.votes ? Number(a.id - b.id) : a.votes > b.votes ? -1 : 1));
  return { owner, accounts, time: Number(time), epochStart };
}

// One account, whoever owns it, as its owner's holdings of that account alone. Undefined if Hydrex has no account with
// that number, as when it was never minted, or was merged or withdrawn: ownerOf then fails, as a call can that fails
// for another reason, so a failed one is asked again on its own before the account is taken for gone.
export async function readAccount(id: bigint): Promise<Holdings | undefined> {
  const [first, time, ...voted] = await withContext([escrow("ownerOf", id)]);
  const owner = first ?? (await read([escrow("ownerOf", id)]))[0];
  if (owner === undefined) return undefined;
  required([time]);
  const epochStart = epochAt(time);
  const accounts = await accountsOf(owner as Address, [id], epochStart, othersVoted(voted));
  return { owner: owner as Address, accounts, time: Number(time), epochStart };
}

const ended = (account: Account, now: number): boolean => account.lockType === LockType.timed && account.end <= now;

const held = (account: Account, { address }: Automation) => ({
  votes: same(account.delegate, address),
  claims: same(account.claimer, address),
});

export const automationName = (address: Address): string | undefined =>
  others.find((other) => same(other.address, address))?.name;

const pageAutomation = (address: Address): Automation | undefined =>
  AUTOMATIONS.find((automation) => same(address, automation.address));

// Hydrex counts a vote only in the epoch it is cast. An automation that has not voted since the previous epoch began
// earns its accounts nothing. One that has never voted may be new.
export const hasStopped = (voted: number, epochStart: number): boolean => voted > 0 && voted < epochStart - WEEK;
// An owner who votes with their accounts themselves: whether they voted last epoch or since. Never is not.
const hasVoted = (voted: number, epochStart: number): boolean => voted >= epochStart - WEEK;

// Hydrex counts votes for whoever held them when the epoch started, so joins and leaves count from the next epoch.
export function statusOf(account: Account, owner: Address, now: number, epochStart: number): Status {
  if (account.amount === 0n) return { kind: "empty" };
  if (ended(account, now)) return { kind: "ended" };
  const [votes, claims, atStart] = [account.delegate, account.claimer, account.delegateAtStart].map(pageAutomation);
  if (votes && votes === claims) {
    return votes === atStart
      ? { kind: "in", automation: votes }
      : { kind: "joined", automation: votes, date: epochStart + WEEK };
  }
  if (votes || claims) return { kind: "partly", automation: (votes ?? claims)! };
  if (atStart) return { kind: "left", automation: atStart, date: epochStart + WEEK };
  if (same(account.delegate, owner) || same(account.delegate, zeroAddress)) {
    const before = automationName(account.delegateAtStart);
    if (before) return { kind: "left-other", name: before, date: epochStart + WEEK };
    return hasVoted(account.ownerVoted, epochStart) ? { kind: "self" } : { kind: "unvoted", voted: account.ownerVoted };
  }
  const name = automationName(account.delegate);
  if (!name) return { kind: "delegated", to: account.delegate };
  const voted = account.delegateVoted;
  return hasStopped(voted, epochStart)
    ? { kind: "stopped", name, voted, since: weekStart(voted) + WEEK }
    : { kind: "other", name };
}

export function canJoin(account: Account, automation: Automation, now: number): boolean {
  const { votes, claims } = held(account, automation);
  return account.amount > 0n && !ended(account, now) && !(votes && claims);
}

export function canLeave(account: Account, automation: Automation): boolean {
  const { votes, claims } = held(account, automation);
  return votes || claims;
}

export const canLeaveOther = (account: Account): boolean => automationName(account.delegate) !== undefined;

// Whether an account has a vote or more: one with less needs nothing of its owner.
export const hasVotes = ({ votes }: Account): boolean => votes >= 10n ** 18n;

export function groupOf(account: Account, status: Status): Group {
  switch (status.kind) {
    case "stopped":
    case "partly":
    case "unvoted":
      return hasVotes(account) ? `needs:${status.kind}` : withoutVotes(account);
    case "in":
    case "joined":
      return `in:${status.automation.kind}`;
    case "ended":
    case "empty":
      return withoutVotes(account);
    default:
      return "other";
  }
}

// An account with nothing, or less than a vote, to vote with is folded away; but one of the page's automations may
// still hold its approvals, which its group can take back.
function withoutVotes(account: Account): Group {
  const holder = AUTOMATIONS.find((automation) => canLeave(account, automation));
  return holder ? `in:${holder.kind}` : "closed";
}

type Target = { address: Address; name: string };

function approval({ id }: Account, approve: boolean, says: string, target: Target, other = false): Step {
  // Beside its address, the page's own automations go by their contract's name.
  const ours = AUTOMATIONS.find(({ address }) => same(address, target.address));
  const conduitName = other ? `The ${target.name} automation` : (ours?.contract ?? target.name);
  return {
    to: VOTING_ESCROW,
    data: encodeFunctionData({
      abi: votingEscrowAbi,
      functionName: "setConduitApproval",
      args: [target.address, id, approve],
    }),
    id,
    approve,
    conduit: target.address,
    conduitName,
    title: approve ? `Join ${target.name}` : `Leave ${other ? `the ${target.name} automation` : target.name}`,
    says: `Account #${id} ${says}`,
    on: "Hydrex's VotingEscrow",
    call: "setConduitApproval",
    fields: [
      {
        label: "Conduit",
        name: "conduit",
        code: target.address,
        description: conduitName,
      },
      { label: "Account", name: "account", code: String(id) },
      { label: "Approve", name: "approve", code: String(approve) },
    ],
    ...(other && { automation: target.name }),
  };
}

// A join takes over the votes and the claims, which other automations may hold, the page's own included.
export const join = (accounts: Account[], automation: Automation): Step[] =>
  accounts.map((account) => {
    const holders = [account.delegate, account.claimer];
    const own = AUTOMATIONS.filter(
      (other) => other !== automation && holders.some((address) => same(address, other.address)),
    );
    const names = [...new Set(holders.map(automationName).filter((name) => name !== undefined))];
    const parts = [
      ...own.map(({ name }) => name),
      ...(names.length ? [`the ${list(names)} automation${names.length > 1 ? "s" : ""}`] : []),
    ];
    const leaving = parts.length ? `leaves ${list(parts)} and ` : "";
    return approval(account, true, `${leaving}joins ${automation.name}.`, automation);
  });

export const leave = (accounts: Account[], automation: Automation): Step[] =>
  accounts.map((account) => approval(account, false, `leaves ${automation.name}.`, automation));

// The same call as leaving the page's automations, with the other automation's address. Only automations on Hydrex's
// list, so that each call names the one it leaves.
export const leaveOther = (accounts: Account[]): Step[] =>
  accounts.flatMap((account) => {
    const name = automationName(account.delegate);
    if (!name) return [];
    return [approval(account, false, `leaves the ${name} automation.`, { address: account.delegate, name }, true)];
  });

// Freshness: when an automation last voted, or 0, as of an epoch.
export type Freshness = { epochStart: number; voted: number };

export async function readFreshness({ address }: Automation): Promise<Freshness> {
  const [time, voted] = required(await read([blockTime, voter("lastVoted", address)])) as bigint[];
  return { epochStart: epochAt(time), voted: Number(voted) };
}

export type Checks = {
  // The checks that fail for each automation, each named by the id of its message on the page. A check of Base or of
  // Hydrex fails for all of them.
  failed: Map<Kind, string[]>;
};

// Each automation's own check, by the id of its message: what joining it approves. Matcha Latte's was the page's first.
const approvalsCheck: Record<Kind, string> = {
  "matcha-latte": "approvals",
  "double-espresso": "double-espresso-approvals",
};

// Base, through the page's RPCs; Hydrex's VotingEscrow as the page knows it, and its approval logic: an upgrade or
// other logic changes what joining allows; and what joining each automation approves, which must be on, and its claims
// and votes only. Each check is named by the id of its message on the page.
export async function failedChecks(): Promise<Checks> {
  const [chainId, impl, [logic, ...configs]] = await Promise.all([
    rpc<string>("eth_chainId", []),
    implementation(VOTING_ESCROW),
    read([escrow("approvalLogic"), ...AUTOMATIONS.map(({ address }) => escrow("getConduitApprovalConfig", address))]),
  ]);
  const failing = (checks: Record<string, boolean>) =>
    Object.entries(checks).flatMap(([id, fails]) => (fails ? [id] : []));
  const all = failing({
    chain: Number(chainId) !== CHAIN_ID,
    upgrade: !same(impl, VOTING_ESCROW_IMPLEMENTATION),
    logic: !same(String(logic), APPROVAL_LOGIC),
  });
  const found = AUTOMATIONS.map(({ kind, actions }, i): [Kind, string[]] => {
    const [approved, active] = (configs[i] ?? [[], false]) as [number[], boolean];
    return [kind, [...all, ...failing({ [approvalsCheck[kind]]: !active || approved.join() !== actions.join() })]];
  });
  return { failed: new Map(found) };
}

// What gas costs for some calls from `from`, in wei, with today's prices to show it at: each costs about what the first
// does, as they differ only by account, plus the most Base charges to post it to Ethereum. The gas price and the prices
// are read at most once a minute, for all of the page; what posting costs for each size of call, once for all the calls
// priced.
export type GasCost = (steps: Tx[], from: Address) => Promise<{ wei: bigint; prices: Prices | undefined }>;

export function gasCosts(): GasCost {
  const posting = new Map<bigint, Promise<bigint>>();
  const postingOf = (size: bigint): Promise<bigint> => {
    if (!posting.has(size)) {
      const fee = read([call(GAS_PRICE_ORACLE, gasPriceOracleAbi, "getL1FeeUpperBound", size)]);
      posting.set(
        size,
        fee.then(([found]) => (found as bigint | undefined) ?? 0n),
      );
    }
    return posting.get(size)!;
  };
  return async (steps, from) => {
    const [first] = steps;
    // Nothing to send costs nothing, in any currency: no prices are read for it.
    if (!first) return { wei: 0n, prices: undefined };
    // The call's data, and about as much again for the transaction's other fields.
    const size = BigInt((first.data.length - 2) / 2 + 100);
    const [{ gasPrice }, gas, l1, prices] = await Promise.all([
      costs(),
      rpc<Hex>("eth_estimateGas", [{ from, to: first.to, data: first.data }]),
      postingOf(size),
      anchorsNow(),
    ]);
    return { wei: (BigInt(gas) * gasPrice + l1) * BigInt(steps.length), prices };
  };
}
