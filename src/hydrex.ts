import { encodeFunctionData, keccak256, parseAbi, zeroAddress, type Address, type Hex } from "viem";
import { blockTime, call, codeHash, implementation, read, required, rpc, same, type Call } from "./chain.ts";
import {
  ACCOUNT_NAMES,
  APPROVAL_LOGIC,
  APPROVAL_LOGIC_CODE_HASH,
  AUTOMATIONS,
  AUTOMAXI,
  CARBON_IMPACT,
  CHAIN_ID,
  KVCM,
  VOTER,
  VOTING_ESCROW,
  VOTING_ESCROW_IMPLEMENTATION,
  VOTING_ESCROW_IMPLEMENTATION_CODE_HASH,
  type Automation,
  type Kind,
} from "./config.ts";
import { WEEK, clean, list, weekStart } from "./format.ts";
import conduits from "./hydrex-conduits.json" with { type: "json" };
import { costs } from "./swap-calls.ts";
import type { Slip } from "./review.ts";
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

const carbonImpactAbi = parseAbi([
  "function veToken() view returns (address)",
  "function voter() view returns (address)",
  "function kvcm() view returns (address)",
  "function retireBps() view returns (uint256)",
  "function treasuryFeeBps() view returns (uint256)",
  "function MAX_TREASURY_FEE_BPS() view returns (uint256)",
  "function treasury() view returns (address)",
  "function totalTonnesRetired() view returns (uint256)",
  "function retiringEntityName() view returns (string)",
  "function beneficiaryString() view returns (string)",
  "function impactBeneficiaryAddress() view returns (address)",
  "function retirementMessage() view returns (string)",
  "function getEffectiveRecipientForOwner(address owner) view returns (address)",
]);

const autoMaxiAbi = parseAbi([
  "function veToken() view returns (address)",
  "function voter() view returns (address)",
  "function lastClaimBlock(uint256 tokenId) view returns (uint256)",
]);

// Base's predeploy that prices posting a transaction's data to Ethereum.
const GAS_PRICE_ORACLE: Address = "0x420000000000000000000000000000000000000F";
const gasPriceOracleAbi = parseAbi(["function getL1FeeUpperBound(uint256 unsignedTxSize) view returns (uint256)"]);

const accountNamesAbi = parseAbi(["function getBulkNames(uint256[] tokenIds) view returns (string[])"]);

export const escrow = (functionName: string, ...args: unknown[]) =>
  call(VOTING_ESCROW, votingEscrowAbi, functionName, ...args);
export const voter = (functionName: string, ...args: unknown[]) => call(VOTER, voterAbi, functionName, ...args);
export const carbonImpact = (functionName: string, ...args: unknown[]) =>
  call(CARBON_IMPACT.address, carbonImpactAbi, functionName, ...args);
export const autoMaxi = (functionName: string, ...args: unknown[]) =>
  call(AUTOMAXI.address, autoMaxiAbi, functionName, ...args);

// Hydrex's other automations. If Hydrex lists one of the page's own, the page still treats it as its own.
const others = conduits.filter(({ address }) => !AUTOMATIONS.some((automation) => same(address, automation.address)));

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
  // When it last voted, or 0.
  voted: number;
  // Its fee, the most the fee can become, and where it goes. Only its page shows them, so they may be unknown.
  feeBps?: bigint;
  maxFeeBps?: bigint;
  treasury?: Address;
};

// The share of a payout's kVCM that reaches the owner: Carbon Impact retires its share first, then takes its fee from
// the rest. An unknown fee counts as none.
export const paidBpsOf = ({ retireBps, feeBps = 0n }: CarbonImpact): bigint =>
  ((10_000n - retireBps) * (10_000n - feeBps)) / 10_000n;

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

// `payout` is where Carbon Impact pays the owner's accounts, unknown if its read failed: only an account's page shows it.
export type Holdings = {
  owner: Address;
  accounts: Account[];
  payout: Address | undefined;
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
  | { kind: "delegated"; to: Address };

// The App's groups: accounts that need their owner, those in each of the page's automations or joining it, the others,
// and those with nothing to vote with.
export type Group = "needs" | `in:${Kind}` | "other" | "closed";

// `automation` is set only when the call is about another of Hydrex's automations.
export type Step = Slip & { id: bigint; approve: boolean; conduit: Address; conduitName: string; automation?: string };

// Epochs follow the calendar. Hydrex's Voter moves its own epoch only once someone calls the minter, but joins count
// from the next Thursday either way.
const epochAt = (time: unknown): number => weekStart(Number(time));

export async function readCarbonImpact(): Promise<CarbonImpact> {
  const replies = await read([
    blockTime,
    carbonImpact("retireBps"),
    carbonImpact("totalTonnesRetired"),
    carbonImpact("retiringEntityName"),
    carbonImpact("beneficiaryString"),
    carbonImpact("impactBeneficiaryAddress"),
    carbonImpact("retirementMessage"),
    voter("lastVoted", CARBON_IMPACT.address),
    carbonImpact("treasuryFeeBps"),
    carbonImpact("MAX_TREASURY_FEE_BPS"),
    carbonImpact("treasury"),
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
  // Only Home shows when it last voted, so a failed read just leaves it out. The same for the fee.
  const voted = replies[7] as bigint | undefined;
  const [feeBps, maxFeeBps, treasury] = replies.slice(8) as [bigint?, bigint?, Address?];
  return {
    time: Number(time),
    epochStart: epochAt(time),
    retireBps,
    tonnes,
    entity: clean(entity),
    beneficiary: clean(beneficiary),
    beneficiaryAddress,
    message: clean(message),
    voted: Number(voted ?? 0n),
    ...(feeBps !== undefined && { feeBps }),
    ...(maxFeeBps !== undefined && { maxFeeBps }),
    ...(treasury && { treasury }),
  };
}

// When each of Hydrex's other automations last voted. If the Voter cannot be read, they are just not known to have
// stopped.
const othersVoted = (replies: unknown[]): Map<string, number> =>
  new Map(others.map(({ address }, i) => [address.toLowerCase(), Number((replies[i] as bigint | undefined) ?? 0n)]));

// The block's time, and when each of Hydrex's other automations last voted, read after the calls given.
const withContext = (calls: Call[]): Promise<unknown[]> =>
  read([...calls, blockTime, ...others.map(({ address }) => voter("lastVoted", address))]);

// The accounts, and the replies to the `more` calls, which share their read.
async function accountsOf(
  ids: bigint[],
  epochStart: number,
  lastVoted: Map<string, number>,
  more: Call[] = [],
): Promise<{ accounts: Account[]; more: unknown[] }> {
  const details = await read([
    ...ids.flatMap((id) => [
      escrow("lockDetails", id),
      escrow("balanceOfNFT", id),
      escrow("getLockDelegatee", id),
      escrow("delegates", id, epochStart),
      escrow("getClaimRedirectApproved", id),
    ]),
    call(ACCOUNT_NAMES, accountNamesAbi, "getBulkNames", ids),
    ...more,
  ]);
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
      claimer,
    };
  });
  return { accounts, more: details.slice(5 * ids.length + 1) };
}

export async function readAccounts(owner: Address): Promise<Holdings> {
  const [count, payout, time, ...voted] = await withContext([
    escrow("balanceOf", owner),
    carbonImpact("getEffectiveRecipientForOwner", owner),
  ]);
  required([count, time]);
  const epochStart = epochAt(time);
  const indexes = Array.from({ length: Number(count) }, (_, i) => BigInt(i));
  const ids = required(await read(indexes.map((i) => escrow("tokenOfOwnerByIndex", owner, i)))) as bigint[];
  const { accounts } = await accountsOf(ids, epochStart, othersVoted(voted));
  accounts.sort((a, b) => (a.votes === b.votes ? Number(a.id - b.id) : a.votes > b.votes ? -1 : 1));
  return { owner, accounts, payout: payout as Address | undefined, time: Number(time), epochStart };
}

// One account, whoever owns it, as its owner's holdings of that account alone. Undefined if Hydrex has no account with
// that number, as when it was never minted, or was merged or withdrawn: ownerOf then fails, as a call can that fails for
// another reason, so a failed one is asked again on its own before the account is taken for gone.
export async function readAccount(id: bigint): Promise<Holdings | undefined> {
  const [first, time, ...voted] = await withContext([escrow("ownerOf", id)]);
  const owner = first ?? (await read([escrow("ownerOf", id)]))[0];
  if (owner === undefined) return undefined;
  required([time]);
  const epochStart = epochAt(time);
  const {
    accounts,
    more: [payout],
  } = await accountsOf([id], epochStart, othersVoted(voted), [
    carbonImpact("getEffectiveRecipientForOwner", owner as Address),
  ]);
  return { owner: owner as Address, accounts, payout: payout as Address | undefined, time: Number(time), epochStart };
}

const ended = (account: Account, now: number): boolean => account.lockType === LockType.timed && account.end <= now;

const held = (account: Account, { address }: Automation) => ({
  votes: same(account.delegate, address),
  claims: same(account.claimer, address),
});

export const automationName = (address: Address): string | undefined =>
  others.find((other) => same(other.address, address))?.name;

const pageAutomation = (address: Address, automations: Automation[]): Automation | undefined =>
  automations.find((automation) => same(address, automation.address));

// Hydrex counts a vote only in the epoch it is cast. An automation that has not voted since the previous epoch began
// earns its accounts nothing. One that has never voted may be new.
export const hasStopped = (voted: number, epochStart: number): boolean => voted > 0 && voted < epochStart - WEEK;

// Hydrex counts votes for whoever held them when the epoch started, so joins and leaves count from the next epoch.
// `automations` are the page's own that are on Base.
export function statusOf(
  account: Account,
  owner: Address,
  now: number,
  epochStart: number,
  automations: Automation[] = AUTOMATIONS,
): Status {
  if (account.amount === 0n) return { kind: "empty" };
  if (ended(account, now)) return { kind: "ended" };
  const [votes, claims, atStart] = [account.delegate, account.claimer, account.delegateAtStart].map((address) =>
    pageAutomation(address, automations),
  );
  if (votes && votes === claims) {
    return votes === atStart
      ? { kind: "in", automation: votes }
      : { kind: "joined", automation: votes, date: epochStart + WEEK };
  }
  if (votes || claims) return { kind: "partly", automation: (votes ?? claims)! };
  if (atStart) return { kind: "left", automation: atStart, date: epochStart + WEEK };
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

export function canJoin(account: Account, automation: Automation, now: number): boolean {
  const { votes, claims } = held(account, automation);
  return account.amount > 0n && !ended(account, now) && !(votes && claims);
}

export function canLeave(account: Account, automation: Automation): boolean {
  const { votes, claims } = held(account, automation);
  return votes || claims;
}

export const canLeaveOther = (account: Account): boolean => automationName(account.delegate) !== undefined;

export function groupOf(account: Account, status: Status, automations: Automation[] = AUTOMATIONS): Group {
  switch (status.kind) {
    case "stopped":
    case "partly":
      return "needs";
    case "in":
    case "joined":
      return `in:${status.automation.kind}`;
    // An automation may still hold the approvals of an account it can no longer vote with.
    case "ended":
    case "empty": {
      const holder = automations.find((automation) => canLeave(account, automation));
      return holder ? `in:${holder.kind}` : "closed";
    }
    default:
      return "other";
  }
}

type Target = { address: Address; name: string };

function approval({ id }: Account, approve: boolean, says: string, target: Target, other = false): Step {
  const conduitName = other ? `The ${target.name} automation` : target.name;
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
    says: `#${id} ${says}`,
    on: "Hydrex's VotingEscrow",
    call: "setConduitApproval",
    fields: [
      {
        label: "Conduit",
        name: "conduit",
        code: target.address,
        under: conduitName,
      },
      { label: "Hydrex account", name: "account", code: String(id) },
      { label: "Approve", name: "approve", code: String(approve) },
    ],
    note: `The selector, then each 32-byte word on two lines: the conduit, ${id} as ${id.toString(16)}, and ${approve} as ${Number(approve)}.`,
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

// The hash of no code at all.
const NO_CODE = keccak256("0x");

export type Checks = {
  // The page's automations with code on Base. Until AutoMaxi has some, the page leaves it out.
  present: Automation[];
  // The checks that fail for each automation, each named by the id of its message on the page. A check of Base or of
  // Hydrex fails for all of them.
  failed: Map<Kind, string[]>;
};

const points = (escrowAddress: unknown, voterOf: unknown) =>
  same(String(escrowAddress), VOTING_ESCROW) && same(String(voterOf), VOTER);

// Each automation's own checks: what its code must hash to and what joining it must approve, which every automation
// has, then the reads of its own and what they must answer. Each check is named by the id of its message on the page.
// Carbon Impact is on Base from the start; AutoMaxi only once there is code at its address.
type Own = {
  calls: Call[];
  checks(answers: unknown[], code: boolean, approvals: boolean): Record<string, boolean>;
  always: boolean;
};
const own: Record<Kind, Own> = {
  "carbon-impact": {
    calls: [carbonImpact("veToken"), carbonImpact("voter"), carbonImpact("kvcm")],
    checks: ([veToken, voterOf, payoutToken], code, approvals) => ({
      code: !code,
      contracts: !points(veToken, voterOf),
      token: !same(String(payoutToken), KVCM),
      approvals: !approvals,
    }),
    always: true,
  },
  automaxi: {
    calls: [autoMaxi("veToken"), autoMaxi("voter")],
    checks: ([veToken, voterOf], code, approvals) => ({
      "automaxi-code": !code,
      "automaxi-contracts": !points(veToken, voterOf),
      "automaxi-approvals": !approvals,
    }),
    always: false,
  },
};

// The automations on Base before the checks have run.
export const FROM_START: Automation[] = AUTOMATIONS.filter(({ kind }) => own[kind].always);

export async function failedChecks(): Promise<Checks> {
  const reads = AUTOMATIONS.map(({ kind, address }) => [
    escrow("getConduitApprovalConfig", address),
    ...own[kind].calls,
  ]);
  const [chainId, hashes, impl, [logic, ...answers]] = await Promise.all([
    rpc<string>("eth_chainId", []),
    Promise.all(AUTOMATIONS.map(({ address }) => codeHash(address))),
    implementation(VOTING_ESCROW),
    read([escrow("approvalLogic"), ...reads.flat()]),
  ]);
  const [implHash, logicHash] = await Promise.all([codeHash(impl), logic ? codeHash(logic as Address) : undefined]);
  const failing = (checks: Record<string, boolean>) =>
    Object.entries(checks).flatMap(([id, fails]) => (fails ? [id] : []));
  const all = failing({
    chain: Number(chainId) !== CHAIN_ID,
    upgrade: !same(impl, VOTING_ESCROW_IMPLEMENTATION) || implHash !== VOTING_ESCROW_IMPLEMENTATION_CODE_HASH,
    logic: !same(String(logic), APPROVAL_LOGIC) || logicHash !== APPROVAL_LOGIC_CODE_HASH,
  });
  let at = 0;
  const found = AUTOMATIONS.map((automation, i) => {
    const [config, ...mine] = answers.slice(at, (at += reads[i]!.length));
    const [actions, active] = (config ?? [[], false]) as [number[], boolean];
    const approvals = active && actions.join() === automation.actions.join();
    const checks = own[automation.kind].checks(mine, hashes[i] === automation.codeHash, approvals);
    return {
      automation,
      failed: [...all, ...failing(checks)],
      on: own[automation.kind].always || hashes[i] !== NO_CODE,
    };
  });
  return {
    present: found.flatMap(({ automation, on }) => (on ? [automation] : [])),
    failed: new Map(found.map(({ automation, failed }) => [automation.kind, failed])),
  };
}

// What gas costs in dollars for some calls from `from`, at today's prices: each costs about what the first does, as they
// differ only by account, plus the most Base charges to post it to Ethereum. Undefined if ETH has no price. The gas
// price and ETH's price are the swap's, read at most once a minute; what posting costs for each size of call is read
// once for all the calls priced.
export type GasCost = (steps: Tx[], from: Address) => Promise<number | undefined>;

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
    if (!first) return 0;
    // The call's data, and about as much again for the transaction's other fields.
    const size = BigInt((first.data.length - 2) / 2 + 100);
    const [{ gasPrice, ethUsd }, gas, l1] = await Promise.all([
      costs(),
      rpc<Hex>("eth_estimateGas", [{ from, to: first.to, data: first.data }]),
      postingOf(size),
    ]);
    if (ethUsd === undefined) return undefined;
    const wei = (BigInt(gas) * gasPrice + l1) * BigInt(steps.length);
    return (Number(wei) / 1e18) * ethUsd;
  };
}
