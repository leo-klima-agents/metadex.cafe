import { encodeFunctionData, type Address } from "viem";
import { doubleEspressoAbi as abi } from "./abi.ts";
import { DOUBLE_ESPRESSO, FEE_BPS } from "./config.ts";
import { WEEK, count } from "./format.ts";
import { claimed, readOwed, summed, totals, type Overdue, type Owed } from "./payouts.ts";
import type { Amount } from "./tokens.ts";
import { key, type Token } from "./prices.ts";
import { rewardsFor, type Reward } from "./rewards.ts";
import { logsIn, same, type Landed } from "./rpc.ts";
import type { Slip } from "./wallet.ts";

// Once a payout is overdue, anyone can call Double Espresso's `claim(tokenId, feeAddresses, bribeAddresses, tokens)`
// for any account in it, and it pays the owner less 1%. A claim asks every contract given for every token given, each
// walking back up to 50 epochs, so the page passes only what `earned()` finds owed and splits it into calls that fit.

// `passes` is how many times the claim must ask the contract to reach past the 50 epochs one asking reads (see
// `readOwed`).
export type Claim = { id: bigint; owed: (Owed & { fee: boolean; passes: number })[] };
const unique = (addresses: Address[]): Address[] => [
  ...new Map(addresses.map((address) => [key(address), address])).values(),
];

const asked = (owed: Claim["owed"]): Address[] =>
  unique(owed.map(({ contract }) => contract)).flatMap((contract) =>
    Array<Address>(Math.max(...owed.filter((each) => same(each.contract, contract)).map(({ passes }) => passes))).fill(
      contract,
    ),
  );
// Upper bound on a call's gas, from traces on a fork: each asking of each contract walks each token back up to 50
// epochs.
export function claimGas(owed: Claim["owed"]): bigint {
  const contracts = BigInt(asked(owed).length);
  const tokens = BigInt(new Set(owed.map(({ token }) => key(token))).size);
  return 100_000n + tokens * 80_000n + contracts * (50_000n + tokens * 400_000n);
}
// `claimCalls` keeps each call under its budget as `claimGas` estimates it, and simulation keeps it under
// `MAX_CLAIM_GAS`. A Safe sends many calls in one transaction, so its claim splits into small calls, none asking a
// contract for a token it does not owe.
export const CLAIM_CALL_GAS = 12_000_000n;
export const SAFE_CLAIM_CALL_GAS = 1_500_000n;
export const MAX_CLAIM_GAS = 15_000_000n;

// Splits an account's claim into calls that each fit `budget`. A contract owing too many tokens for one call is split
// across several. Pieces go, those owing the most tokens first, into the call they add the least gas to, so contracts
// owing the same tokens share a call.
export function claimCalls(claim: Claim, budget = CLAIM_CALL_GAS): Claim[] {
  const byContract = Map.groupBy(
    claim.owed.filter(({ amount }) => amount > 0n),
    ({ contract }) => key(contract),
  );
  const pieces = [...byContract.values()].flatMap((owed) => {
    const parts: Claim["owed"][] = [];
    for (const one of owed) {
      const last = parts.at(-1);
      if (last && claimGas([...last, one]) <= budget) last.push(one);
      else parts.push([one]);
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
// Groups consecutive calls into transactions of up to `budget` gas, and returns how many calls go in each.
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
// What a claim takes and pays, token by token. The fee is 1% of each token received, rounded down.
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

// Set `whole` to false for one of the calls a split claim makes.
export function claimSlip(claim: Claim, tokens: Map<string, Token>, whole = true): Slip {
  const args = claimArgs(claim);
  const [id, fees, bribes, claimed] = args;
  const contracts = unique([...fees, ...bribes]).length;
  const from = whole ? "" : ` from ${count(contracts, "reward contract", "reward contracts")}`;
  // A contract listed twice is asked twice, to reach what it owes beyond the 50 epochs one asking reads.
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

// What each overdue account can claim now, from the pools its automation voted for last epoch, plus the epoch before's
// when it is late for that too. Older pools are not read, so this is a lower bound. `unread` counts the reward
// contracts whose amounts could not all be read; they are left out.
export async function owedOf(
  entries: Overdue[],
): Promise<{ claims: Claim[]; tokens: Map<string, Token>; unread: number }> {
  const tokens = new Map<string, Token>();
  const unread = new Set<string>();
  const claims = await Promise.all(
    entries.map(async ({ account, earnings, standing, voter }): Promise<Claim> => {
      const rewards: Reward[] = [
        ...earnings.rewards,
        ...(standing.late ? await rewardsFor(voter.address, earnings.start - WEEK) : []),
      ];
      const pairs = [
        ...new Map(rewards.map((reward) => [`${key(reward.contract)} ${key(reward.token.address)}`, reward])).values(),
      ];
      for (const { token } of pairs) tokens.set(key(token.address), token);
      const rows = await readOwed(
        [account.id],
        pairs.map(({ contract, token, fee }) => ({ contract, token: token.address, fee })),
        "latest",
        [earnings.start - WEEK, earnings.start],
      );
      return {
        id: account.id,
        owed: rows.flatMap(({ owing }) =>
          owing.flatMap(({ pair, amount, passes }) => {
            if (amount === undefined) unread.add(key(pair.contract));
            return amount ? [{ ...pair, amount, passes }] : [];
          }),
        ),
      };
    }),
  );
  return { claims, tokens, unread: unread.size };
}

// What claims by `caller` received, took and paid, from their `Claimed` events. A claim that received nothing, as when
// someone else claimed first, gives empty lists.
type Claimed = { id: bigint; received: Amount[]; fees: Amount[]; paid: Amount[] };
export function claimedIn(receipts: Pick<Landed, "logs">[], ids: bigint[], caller: Address): Claimed[] {
  const logs = logsIn(receipts).filter((log) => same(log.address, DOUBLE_ESPRESSO.address));
  const mine = claimed(logs).filter((claim) => ids.includes(claim.id) && same(claim.caller, caller));
  return [...new Set(mine.map(({ id }) => id))].map((id) => ({
    id,
    ...totals(mine.filter((claim) => claim.id === id)),
  }));
}
