import { decodeEventLog, encodeFunctionData, parseAbi, type Address, type Hex } from "viem";
import { DOUBLE_ESPRESSO, FEE_BPS } from "./config.ts";
import { WEEK, count } from "./format.ts";
import { less, readOwed, summed, type Amount, type Entry, type Owed } from "./payouts.ts";
import { key, type Token } from "./prices.ts";
import { rewardsFor, type Reward } from "./rewards.ts";
import { same, type Receipt } from "./rpc.ts";
import type { Slip } from "./wallet.ts";

// Claiming through Double Espresso, once a payout is overdue: anyone can claim(tokenId, feeAddresses, bribeAddresses,
// tokens) for any account in it, and it pays the owner, less 1%. A claim asks every contract given for every token
// given, each walking back up to 50 epochs, so the page passes only what earned() finds owed, split into calls that fit.

const abi = parseAbi([
  "function claim(uint256 tokenId, address[] feeAddresses, address[] bribeAddresses, address[] tokens) returns (uint256[] amounts)",
  "event Claimed(uint256 indexed tokenId, address indexed owner, address indexed caller, address[] tokens, uint256[] amounts, uint256[] fees, uint256 previousClaimBlock)",
]);
export type Claim = { id: bigint; owed: (Owed & { fee: boolean })[] };
const unique = (addresses: Address[]): Address[] => [
  ...new Map(addresses.map((address) => [key(address), address])).values(),
];

// Each contract asked, as many times as its claim must reach past the 50 epochs each asking reads: see readOwed.
const asked = (owed: Claim["owed"]): Address[] =>
  unique(owed.map(({ contract }) => contract)).flatMap((contract) =>
    Array<Address>(
      Math.max(...owed.filter((each) => same(each.contract, contract)).map(({ passes = 1 }) => passes)),
    ).fill(contract),
  );
// What a call costs at most, as traced on a fork: each asking of each contract walks each token up to 50 epochs.
export function claimGas(owed: Claim["owed"]): bigint {
  const contracts = BigInt(asked(owed).length);
  const tokens = BigInt(new Set(owed.map(({ token }) => key(token))).size);
  return 100_000n + tokens * 80_000n + contracts * (50_000n + tokens * 400_000n);
}
// Each call is kept under its budget by the estimate, and under MAX_CLAIM_GAS as simulated. A Safe sends many calls in
// one Safe transaction, so its claim splits into small calls, none asking a contract for a token it does not owe.
export const CLAIM_CALL_GAS = 12_000_000n;
export const SAFE_CLAIM_CALL_GAS = 1_500_000n;
export const MAX_CLAIM_GAS = 15_000_000n;

// An account's claim, as calls that each fit `budget`: contracts that owe the same tokens share one, and each other goes
// where it adds the least, those that owe the most tokens first. One that owes too many for one call is asked in several.
export function claimCalls(claim: Claim, budget = CLAIM_CALL_GAS): Claim[] {
  const byContract = new Map<string, Claim["owed"]>();
  for (const owed of claim.owed.filter(({ amount }) => amount > 0n))
    byContract.set(key(owed.contract), [...(byContract.get(key(owed.contract)) ?? []), owed]);
  const pieces = [...byContract.values()].flatMap((owed) => {
    const parts: Claim["owed"][] = [[]];
    for (const one of owed) {
      if (parts.at(-1)!.length && claimGas([...parts.at(-1)!, one]) > budget) parts.push([]);
      parts.at(-1)!.push(one);
    }
    return parts;
  });
  const calls: Claim["owed"][] = [];
  for (const piece of pieces.sort((a, b) => b.length - a.length)) {
    let best: { call: Claim["owed"]; added: bigint } | undefined;
    for (const call of calls) {
      const gas = claimGas([...call, ...piece]);
      const added = gas - claimGas(call);
      if (gas <= budget && (!best || added < best.added)) best = { call, added };
    }
    if (best) best.call.push(...piece);
    else calls.push([...piece]);
  }
  return calls.map((owed) => ({ id: claim.id, owed }));
}
// How many of the calls, in order, go in each transaction, where one may hold several: as many as fit `budget`.
export function claimTransactions(gas: bigint[], budget = MAX_CLAIM_GAS): number[] {
  const groups: { size: number; gas: bigint }[] = [];
  for (const one of gas) {
    const last = groups.at(-1);
    if (last && last.gas + one <= budget) [last.size, last.gas] = [last.size + 1, last.gas + one];
    else groups.push({ size: 1, gas: one });
  }
  return groups.map(({ size }) => size);
}

export function claimArgs({ id, owed }: Claim): [bigint, Address[], Address[], Address[]] {
  const owing = owed.filter(({ amount }) => amount > 0n);
  return [
    id,
    asked(owing.filter(({ fee }) => fee)),
    asked(owing.filter(({ fee }) => !fee)),
    unique(owing.map(({ token }) => token)),
  ];
}
// What a claim takes and pays, token by token: the fee is 1% of what it receives of each, rounded down.
export function paidBy(owed: Amount[]): { token: Address; earned: bigint; fee: bigint; paid: bigint }[] {
  return summed(owed)
    .filter(({ amount }) => amount > 0n)
    .map(({ token, amount }) => ({
      token,
      earned: amount,
      fee: (amount * FEE_BPS) / 10_000n,
      paid: amount - (amount * FEE_BPS) / 10_000n,
    }));
}

// The call for a claim, or, `whole` false, for one of the calls a claim splits into.
export function claimSlip(claim: Claim, tokens: Map<string, Token>, whole = true): Slip {
  const args = claimArgs(claim);
  const [id, fees, bribes, claimed] = args;
  const contracts = unique([...fees, ...bribes]).length;
  const from = whole ? "" : ` from ${count(contracts, "reward contract", "reward contracts")}`;
  // A contract listed again is asked again: what it owes lies past the 50 epochs one asking reads.
  const again = (listed: Address[]) =>
    unique(listed).length < listed.length ? "; twice where one asking cannot reach all it owes" : "";
  return {
    to: DOUBLE_ESPRESSO.address,
    data: encodeFunctionData({ abi, functionName: "claim", args }),
    title: "Claim",
    says: `Claims account #${id}'s rewards${from} through Double Espresso, which pays them to you, less 1%.`,
    on: DOUBLE_ESPRESSO.contract,
    call: "claim",
    fields: [
      { label: "Account", code: String(id) },
      { label: "Fees from", code: fees, description: `Pools' fees contracts that owe it${again(fees)}` },
      {
        label: "Incentives from",
        code: bribes,
        description: `Pools' incentives contracts that owe it${again(bribes)}`,
      },
      { label: "Tokens", code: claimed, tags: claimed.map((token) => tokens.get(key(token))?.symbol ?? "") },
    ],
  };
}

// What waits for each overdue account now: in the pools its automation voted for last epoch, and the epoch before's
// when it is late for it too. Pools from further back are not read, so it is a floor.
export async function owedOf(
  entries: Entry[],
): Promise<{ claims: Claim[]; tokens: Map<string, Token>; earlier: boolean }> {
  const tokens = new Map<string, Token>();
  const claims = await Promise.all(
    entries.map(async ({ account, earnings, standing, voter }): Promise<Claim> => {
      const rewards: Reward[] = [
        ...earnings!.rewards,
        ...(standing?.late ? await rewardsFor(voter.address, earnings!.start - WEEK) : []),
      ];
      const pairs = [
        ...new Map(rewards.map((reward) => [`${key(reward.contract)} ${key(reward.token.address)}`, reward])).values(),
      ];
      for (const { token } of pairs) tokens.set(key(token.address), token);
      const [owing] = await readOwed(
        [account.id],
        pairs.map(({ contract, token }) => ({ contract, token: token.address })),
        "latest",
        [earnings!.start - WEEK, earnings!.start],
      );
      return {
        id: account.id,
        owed: pairs.flatMap(({ contract, token, fee }, i) => {
          const { amount, passes } = owing![i]!;
          return amount ? [{ contract, token: token.address, amount, fee, passes }] : [];
        }),
      };
    }),
  );
  return { claims, tokens, earlier: entries.some(({ standing }) => standing?.late) };
}

// What the page's own claims received, took and paid, from their Claimed events. One that received nothing, as when
// someone else claimed first, has none.
export type Claimed = { id: bigint; received: Amount[]; fees: Amount[]; paid: Amount[] };
export function claimedIn(receipts: Pick<Receipt, "logs">[], ids: bigint[], caller: Address): Claimed[] {
  const found = new Map<bigint, { received: Amount[]; fees: Amount[] }>();
  for (const log of receipts.flatMap(({ logs }) => logs)) {
    if (!same(log.address, DOUBLE_ESPRESSO.address)) continue;
    try {
      const { eventName, args } = decodeEventLog({ abi, data: log.data, topics: log.topics as [Hex, ...Hex[]] });
      if (eventName !== "Claimed" || !ids.includes(args.tokenId) || !same(args.caller, caller)) continue;
      const at = (values: readonly bigint[]) =>
        args.tokens.map((token, i) => ({ token, amount: values[i] ?? 0n })).filter(({ amount }) => amount > 0n);
      const before = found.get(args.tokenId) ?? { received: [], fees: [] };
      found.set(args.tokenId, {
        received: [...before.received, ...at(args.amounts)],
        fees: [...before.fees, ...at(args.fees)],
      });
    } catch {}
  }
  return [...found].map(([id, { received, fees }]) => ({
    id,
    received: summed(received),
    fees: summed(fees),
    paid: less(summed(received), summed(fees)),
  }));
}
