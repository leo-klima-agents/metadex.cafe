import { decodeEventLog, encodeFunctionData, parseAbi, type Address, type Hex } from "viem";
import { same, type Receipt } from "./chain.ts";
import { DOUBLE_ESPRESSO, DOUBLE_ESPRESSO_FEE_BPS } from "./config.ts";
import { rewardsFor, type Reward } from "./earnings.ts";
import { WEEK, count } from "./format.ts";
import type { Entry } from "./last-payout.ts";
import type { Token } from "./prices.ts";
import { readEarned, type Amount } from "./receipts.ts";
import type { Slip } from "./views/review.ts";

// Claiming through Double Espresso, when a payout is late. Anyone can call claim(tokenId, feeAddresses,
// bribeAddresses, tokens) for any account in Double Espresso, and it pays the owner, less 1%. The page offers it for
// the wallet's own accounts only, once a payout is overdue. A claim asks every contract given for every token given,
// and a contract walks back up to 50 epochs for a token it has not paid recently, so the page passes only the contracts
// and tokens that owe something, as earned() finds them, and splits a claim that would need more gas than a transaction
// may use into several, each contract with only the tokens it owes.

const doubleEspressoAbi = parseAbi([
  "function claim(uint256 tokenId, address[] feeAddresses, address[] bribeAddresses, address[] tokens) returns (uint256[] amounts)",
  "event Claimed(uint256 indexed tokenId, address indexed owner, address indexed caller, address[] tokens, uint256[] amounts, uint256[] fees, uint256 previousClaimBlock)",
]);

// What a reward contract owes an account in one token; `fee` for a pool's fees contract, else its incentives contract.
export type Owed = { contract: Address; token: Address; amount: bigint; fee: boolean };
export type Claim = { id: bigint; owed: Owed[] };

const key = (address: string): string => address.toLowerCase();
const unique = (addresses: Address[]): Address[] => [
  ...new Map(addresses.map((address) => [key(address), address])).values(),
];

// What a claim's call costs at most, as a trace of one on a fork of Base finds it: each contract walks each token it is
// asked for back up to 50 epochs, asking the VotingEscrow for the account's votes at each, about 6,400 gas a time; then
// Double Espresso takes its fee and pays the owner, token by token.
const CLAIM_GAS = { call: 100_000n, token: 80_000n, contract: 50_000n, pair: 400_000n };
// Each call is kept under this, by the estimate, and under MAX_CLAIM_GAS, as simulated: a transaction may use 16.7
// million gas on Base.
export const CLAIM_CALL_GAS = 12_000_000n;
// A Safe sends many calls in one Safe transaction, so its claim splits into small calls instead, none asking a contract
// for a token it does not owe: what matters is their gas together. #82774's 105 pairs take 55 calls and 41 million gas,
// in 3 Safe transactions, where 12 calls of 12 million by the estimate take 79 million, in 6.
export const SAFE_CLAIM_CALL_GAS = 1_500_000n;
export const MAX_CLAIM_GAS = 15_000_000n;

export function claimGas(owed: Owed[]): bigint {
  const contracts = BigInt(new Set(owed.map(({ contract }) => key(contract))).size);
  const tokens = BigInt(new Set(owed.map(({ token }) => key(token))).size);
  return CLAIM_GAS.call + tokens * CLAIM_GAS.token + contracts * (CLAIM_GAS.contract + tokens * CLAIM_GAS.pair);
}

// An account's claim, as calls that each fit `budget`. A call asks each of its contracts for all of its tokens, so
// contracts that owe the same tokens share one, and each other contract goes where it adds the least: the contracts
// that owe the most tokens first. A contract that owes too many tokens for one call is asked in several.
export function claimCalls(claim: Claim, budget = CLAIM_CALL_GAS): Claim[] {
  const owing = claim.owed.filter(({ amount }) => amount > 0n);
  const byContract = new Map<string, Owed[]>();
  for (const owed of owing) byContract.set(key(owed.contract), [...(byContract.get(key(owed.contract)) ?? []), owed]);
  const pieces = [...byContract.values()].flatMap((owed) => {
    const parts: Owed[][] = [[]];
    for (const one of owed) {
      if (parts.at(-1)!.length && claimGas([...parts.at(-1)!, one]) > budget) parts.push([]);
      parts.at(-1)!.push(one);
    }
    return parts;
  });
  const calls: Owed[][] = [];
  for (const piece of pieces.sort((a, b) => b.length - a.length)) {
    let best: { call: Owed[]; added: bigint } | undefined;
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

// How many of the calls, in order, go in each transaction where one may hold several, as a Safe transaction does: as
// many as fit `budget` together, by each one's gas.
export function claimTransactions(gas: bigint[], budget = MAX_CLAIM_GAS): number[] {
  const groups: { size: number; gas: bigint }[] = [];
  for (const one of gas) {
    const last = groups.at(-1);
    if (last && last.gas + one <= budget) Object.assign(last, { size: last.size + 1, gas: last.gas + one });
    else groups.push({ size: 1, gas: one });
  }
  return groups.map(({ size }) => size);
}

// The claim's arguments: the contracts that owe something, of each kind, and the tokens they owe.
export function claimArgs({ id, owed }: Claim): [bigint, Address[], Address[], Address[]] {
  const owing = owed.filter(({ amount }) => amount > 0n);
  return [
    id,
    unique(owing.filter(({ fee }) => fee).map(({ contract }) => contract)),
    unique(owing.filter(({ fee }) => !fee).map(({ contract }) => contract)),
    unique(owing.map(({ token }) => token)),
  ];
}

// What a claim takes and pays, token by token: Double Espresso's fee is 1% of what it receives of each token, rounded
// down.
export function paidBy(owed: Owed[]): { token: Address; earned: bigint; fee: bigint; paid: bigint }[] {
  const totals = new Map<string, { token: Address; earned: bigint }>();
  for (const { token, amount } of owed) {
    const held = totals.get(key(token));
    totals.set(key(token), { token, earned: (held?.earned ?? 0n) + amount });
  }
  return [...totals.values()]
    .filter(({ earned }) => earned > 0n)
    .map(({ token, earned }) => {
      const fee = (earned * DOUBLE_ESPRESSO_FEE_BPS) / 10_000n;
      return { token, earned, fee, paid: earned - fee };
    });
}

// The call for a claim, or for `whole === false`, one of the calls an account's claim is split into.
export function claimSlip(claim: Claim, tokens: Map<string, Token>, whole = true): Slip {
  const args = claimArgs(claim);
  const [id, fees, bribes, claimed] = args;
  // A token the page could not name has no tag: its address is all there is.
  const symbols = claimed.map((token) => tokens.get(key(token))?.symbol ?? "");
  const from = whole ? "" : ` from ${count(fees.length + bribes.length, "reward contract", "reward contracts")}`;
  return {
    to: DOUBLE_ESPRESSO.address,
    data: encodeFunctionData({ abi: doubleEspressoAbi, functionName: "claim", args }),
    title: "Claim",
    says: `Claims account #${id}'s rewards${from} through Double Espresso, which pays them to you, less 1%.`,
    on: DOUBLE_ESPRESSO.contract,
    call: "claim",
    fields: [
      { label: "Account", name: "account", code: String(id) },
      { label: "Fees from", name: "fee-contracts", code: fees, description: "Pools' fees contracts that owe it" },
      {
        label: "Incentives from",
        name: "bribe-contracts",
        code: bribes,
        description: "Pools' incentives contracts that owe it",
      },
      { label: "Tokens", name: "tokens", code: claimed, tags: symbols },
    ],
  };
}

// What waits for each account, read now: in the pools its automation voted for last epoch, and, when nobody claimed
// for the epoch before either, in that epoch's. Pools from further back are not read, so it is a floor.
export async function owedOf(
  entries: Entry[],
): Promise<{ claims: Claim[]; tokens: Map<string, Token>; earlier: boolean }> {
  const tokens = new Map<string, Token>();
  let earlier = false;
  const claims = await Promise.all(
    entries.map(async ({ account, earnings, standing, voter }): Promise<Claim> => {
      const rewards: Reward[] = [...earnings!.rewards];
      if (standing?.late) {
        earlier = true;
        rewards.push(...(await rewardsFor(voter.address, earnings!.start - WEEK)));
      }
      const pairs = [
        ...new Map(rewards.map((reward) => [`${key(reward.contract)} ${key(reward.token.address)}`, reward])).values(),
      ];
      for (const { token } of pairs) tokens.set(key(token.address), token);
      const [earned] = await readEarned(
        [account.id],
        pairs.map(({ contract, token }) => ({ contract, token: token.address })),
        "latest",
      );
      return {
        id: account.id,
        owed: pairs.flatMap(({ contract, token, fee }, i) => {
          const amount = earned![i];
          return amount ? [{ contract, token: token.address, amount, fee }] : [];
        }),
      };
    }),
  );
  return { claims, tokens, earlier };
}

// Each of the page's own claims, from its Claimed events: what Double Espresso received for the account, its fee, and
// what it paid the owner, summed over the calls a claim was split into. A claim that received nothing, as when someone
// else claimed first, has none.
export type Claimed = { id: bigint; received: Amount[]; fees: Amount[]; paid: Amount[] };

export function claimedIn(receipts: Receipt[], ids: bigint[], caller: Address): Claimed[] {
  const found: Claimed[] = [];
  for (const { logs } of receipts) {
    for (const log of logs) {
      if (!same(log.address, DOUBLE_ESPRESSO.address)) continue;
      let event;
      try {
        event = decodeEventLog({ abi: doubleEspressoAbi, data: log.data, topics: log.topics as [Hex, ...Hex[]] });
      } catch {
        continue;
      }
      if (event.eventName !== "Claimed" || !ids.includes(event.args.tokenId) || !same(event.args.caller, caller))
        continue;
      const { tokenId, tokens, amounts, fees } = event.args;
      const at = (values: readonly bigint[]) =>
        tokens.map((token, i) => ({ token, amount: values[i] ?? 0n })).filter(({ amount }) => amount > 0n);
      const received = at(amounts);
      const taken = at(fees);
      const paid = received
        .map(({ token, amount }) => ({
          token,
          amount: amount - (taken.find((fee) => same(fee.token, token))?.amount ?? 0n),
        }))
        .filter(({ amount }) => amount > 0n);
      const before = found.find((claimed) => claimed.id === tokenId);
      if (!before) found.push({ id: tokenId, received, fees: taken, paid });
      else
        Object.assign(before, {
          received: [...before.received, ...received],
          fees: [...before.fees, ...taken],
          paid: [...before.paid, ...paid],
        });
    }
  }
  return found.map(({ id, received, fees, paid }) => ({
    id,
    received: summed(received),
    fees: summed(fees),
    paid: summed(paid),
  }));
}

// Amounts of the same token, added together.
export const summed = (amounts: Amount[]): Amount[] => {
  const all = new Map<string, Amount>();
  for (const { token, amount } of amounts)
    all.set(key(token), { token, amount: (all.get(key(token))?.amount ?? 0n) + amount });
  return [...all.values()];
};
