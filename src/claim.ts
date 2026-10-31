import { decodeEventLog, encodeFunctionData, type Address, type Hex } from "viem";
import { ABI, DOUBLE_ESPRESSO, FEE_BPS, type Token } from "./config.ts";
import { rewardsFor } from "./earnings.ts";
import { WEEK } from "./format.ts";
import type { Entry } from "./payouts.ts";
import { readEarned } from "./payouts.ts";
import type { Log } from "./rpc.ts";
import { key, minus, packInOrder, positive, same, sumByToken, unique, type Amount } from "./util.ts";
import type { Tx } from "./wallet.ts";

// Anyone can claim(tokenId, feeAddresses, bribeAddresses, tokens) through Double Espresso, which pays the owner, less 1%.
// Each contract walks back up to 50 epochs for each token asked, so a claim asks only what earned() finds owing, split
// into calls that each fit a transaction.
export type Owed = { contract: Address; token: Address; amount: bigint; fee: boolean };
export type Claim = { id: bigint; owed: Owed[] };

// From a trace on a fork: each contract asks the VotingEscrow about each token's past epochs, ~6,400 gas a time.
const GAS = { call: 100_000n, token: 80_000n, contract: 50_000n, pair: 400_000n };
export const CLAIM_CALL_GAS = 12_000_000n;
// A Safe sends its calls in one transaction, so small calls that ask no contract for a token it does not owe use the
// least gas together: #82774's 105 pairs take 41 million in 3 Safe transactions, against 79 million in 6.
export const SAFE_CLAIM_CALL_GAS = 1_500_000n;
export const MAX_CLAIM_GAS = 15_000_000n;

export function claimGas(owed: Owed[]): bigint {
  const contracts = BigInt(new Set(owed.map(({ contract }) => key(contract))).size);
  const tokens = BigInt(new Set(owed.map(({ token }) => key(token))).size);
  return GAS.call + tokens * GAS.token + contracts * (GAS.contract + tokens * GAS.pair);
}

// Calls within `budget`: each contract's tokens in as few pieces as fit, then each piece, largest first, where it adds
// the least gas.
export function claimCalls({ id, owed }: Claim, budget = CLAIM_CALL_GAS): Claim[] {
  const byContract = new Map<string, Owed[]>();
  for (const one of owed.filter(({ amount }) => amount > 0n))
    byContract.set(key(one.contract), [...(byContract.get(key(one.contract)) ?? []), one]);
  const pieces = [...byContract.values()].flatMap((each) => packInOrder(each, claimGas, budget));
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
  return calls.map((each) => ({ id, owed: each }));
}

// How many calls, in order, go in each Safe transaction, by their gas.
export const claimTransactions = (gas: bigint[], budget = MAX_CLAIM_GAS): number[] =>
  packInOrder(gas, (group) => group.reduce((total, each) => total + each, 0n), budget).map(({ length }) => length);

export function claimArgs({ id, owed }: Claim): [bigint, Address[], Address[], Address[]] {
  const owing = owed.filter(({ amount }) => amount > 0n);
  const contracts = (fee: boolean) =>
    unique(
      owing.filter((each) => each.fee === fee).map(({ contract }) => contract),
      key,
    );
  return [
    id,
    contracts(true),
    contracts(false),
    unique(
      owing.map(({ token }) => token),
      key,
    ),
  ];
}
export const claimTx = (claim: Claim): Tx => ({
  to: DOUBLE_ESPRESSO.address,
  data: encodeFunctionData({ abi: ABI.doubleEspresso, functionName: "claim", args: claimArgs(claim) }),
});

// Earned, the 1% fee rounded down, and paid, token by token.
export const paidBy = (owed: Owed[]) =>
  sumByToken(owed).map(({ token, amount }) => {
    const fee = (amount * FEE_BPS) / 10_000n;
    return { token, earned: amount, fee, paid: amount - fee };
  });

// What waits for each account now: in its automation's pools of last epoch, and of the epoch before if late. A floor.
export async function owedOf(
  entries: Entry[],
): Promise<{ claims: Claim[]; tokens: Map<string, Token>; earlier: boolean }> {
  const tokens = new Map<string, Token>();
  let earlier = false;
  const claims = await Promise.all(
    entries.map(async ({ account, earnings, standing, voter }): Promise<Claim> => {
      const rewards = [...earnings!.rewards];
      if (standing?.late) {
        earlier = true;
        rewards.push(...(await rewardsFor([voter.address, earnings!.start - WEEK])));
      }
      const pairs = unique(rewards, ({ contract, token }) => `${key(contract)} ${key(token.address)}`);
      for (const { token } of pairs) tokens.set(key(token.address), token);
      const [earned] = await readEarned(
        [account.id],
        pairs.map(({ contract, token }) => ({ contract, token: token.address })),
        "latest",
      );
      const owed = pairs.flatMap(({ contract, token, fee }, i) =>
        earned![i] ? [{ contract, token: token.address, amount: earned![i]!, fee }] : [],
      );
      return { id: account.id, owed };
    }),
  );
  return { claims, tokens, earlier };
}

// Double Espresso's Claimed events, newest first.
export type Claimed = {
  id: bigint;
  owner: Address;
  caller: Address;
  received: Amount[];
  fees: Amount[];
  previous: number;
  tx: Hex;
  block: number;
};
export const order = (log: Partial<Pick<Log, "blockNumber" | "logIndex">>): bigint =>
  BigInt(log.blockNumber ?? 0) * 1_000_000n + BigInt(log.logIndex ?? 0);
// Logs from a wallet's receipts may lack where they sit.
export type AnyLog = Pick<Log, "address" | "data" | "topics"> & Partial<Log>;
export function claimsOf(logs: AnyLog[]): Claimed[] {
  return [...logs]
    .filter((log) => same(log.address ?? DOUBLE_ESPRESSO.address, DOUBLE_ESPRESSO.address))
    .sort((a, b) => Number(order(b) - order(a)))
    .flatMap((log) => {
      try {
        const { args } = decodeEventLog({
          abi: ABI.doubleEspresso,
          eventName: "Claimed",
          data: log.data,
          topics: log.topics as [Hex],
        });
        if (!args) return [];
        return [
          {
            id: args.tokenId,
            owner: args.owner,
            caller: args.caller,
            received: positive(args.tokens, args.amounts),
            fees: positive(args.tokens, args.fees),
            previous: Number(args.previousClaimBlock),
            tx: log.transactionHash ?? "0x",
            block: Number(log.blockNumber ?? 0),
          },
        ];
      } catch {
        return [];
      }
    });
}
export const totals = (claims: Pick<Claimed, "received" | "fees">[]) => {
  const received = sumByToken(claims.flatMap((claim) => claim.received));
  const fees = sumByToken(claims.flatMap((claim) => claim.fees));
  return { received, fees, paid: minus(received, fees) };
};
// The page's own claims for these accounts in its receipts, summed over the calls they were split into.
export const claimedIn = (logs: AnyLog[], ids: bigint[], caller: Address) =>
  ids.flatMap((id) => {
    const mine = claimsOf(logs).filter((claim) => claim.id === id && same(claim.caller, caller));
    return mine.length ? [{ id, ...totals(mine) }] : [];
  });
