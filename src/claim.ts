import { decodeEventLog, encodeFunctionData, parseAbi, type Address, type Hex } from "viem";
import { same, type Receipt } from "./chain.ts";
import { AUTOMAXI, AUTOMAXI_FEE_BPS } from "./config.ts";
import { rewardsFor, type Reward } from "./earnings.ts";
import { WEEK, list } from "./format.ts";
import type { Entry } from "./last-payout.ts";
import type { Token } from "./prices.ts";
import { readEarned, type Amount } from "./receipts.ts";
import type { Slip } from "./review.ts";

// Claiming through AutoMaxi, when its keeper is late. Anyone can call claim(tokenId, feeAddresses, bribeAddresses,
// tokens) for any account in AutoMaxi, and it pays the owner, less 1%. The page offers it for the wallet's own accounts
// only, once a payout is overdue. A claim asks every contract given for every token given, and a contract walks back up
// to 50 epochs for a token it has not paid recently, so the page passes only the contracts and tokens that owe
// something, as earned() finds them.

const autoMaxiAbi = parseAbi([
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

// What a claim takes and pays, token by token: AutoMaxi's fee is 1% of what it receives of each token, rounded down.
export function paidBy(owed: Owed[]): { token: Address; earned: bigint; fee: bigint; paid: bigint }[] {
  const totals = new Map<string, { token: Address; earned: bigint }>();
  for (const { token, amount } of owed) {
    const held = totals.get(key(token));
    totals.set(key(token), { token, earned: (held?.earned ?? 0n) + amount });
  }
  return [...totals.values()]
    .filter(({ earned }) => earned > 0n)
    .map(({ token, earned }) => {
      const fee = (earned * AUTOMAXI_FEE_BPS) / 10_000n;
      return { token, earned, fee, paid: earned - fee };
    });
}

export function claimSlip(claim: Claim, tokens: Map<string, Token>): Slip {
  const args = claimArgs(claim);
  const [id, fees, bribes, claimed] = args;
  const symbols = claimed.map((token) => tokens.get(key(token))?.symbol ?? token);
  return {
    to: AUTOMAXI.address,
    data: encodeFunctionData({ abi: autoMaxiAbi, functionName: "claim", args }),
    says: `Claims #${id}'s rewards through AutoMaxi, which pays them to you, less 1%.`,
    on: "AutoMaxi",
    call: "claim",
    fields: [
      { label: "Account", name: "account", code: String(id) },
      { label: "Fees from", name: "fee-contracts", code: fees, under: "Pools' fees contracts that owe it" },
      {
        label: "Incentives from",
        name: "bribe-contracts",
        code: bribes,
        under: "Pools' incentives contracts that owe it",
      },
      { label: "Tokens", name: "tokens", code: claimed, under: list(symbols) },
    ],
    note: "The selector, then each 32-byte word on two lines: the account, where each list starts, then each list, its length first.",
  };
}

// What waits for each account, read now: in the pools its automation voted for last epoch, and, when the keeper missed
// the epoch before too, in that epoch's. Pools from further back are not read, so it is a floor.
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

// Each of the page's own claims, from its Claimed events: what AutoMaxi received for the account, its fee, and what it
// paid the owner. A claim that received nothing, as when the keeper claimed first, has none.
export type Claimed = { id: bigint; received: Amount[]; fees: Amount[]; paid: Amount[] };

export function claimedIn(receipts: Receipt[], ids: bigint[], caller: Address): Claimed[] {
  const found: Claimed[] = [];
  for (const { logs } of receipts) {
    for (const log of logs) {
      if (!same(log.address, AUTOMAXI.address)) continue;
      let event;
      try {
        event = decodeEventLog({ abi: autoMaxiAbi, data: log.data, topics: log.topics as [Hex, ...Hex[]] });
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
      found.push({ id: tokenId, received, fees: taken, paid });
    }
  }
  return found;
}
