import { decodeEventLog, encodeEventTopics, numberToHex, parseAbi, type Address, type Hex } from "viem";
import { readFor, required, rpc, same } from "./chain.ts";
import { DOUBLE_ESPRESSO } from "./config.ts";
import { doubleEspresso } from "./hydrex.ts";
import { order, positive, type Amount, type Log } from "./receipts.ts";

// Double Espresso pays each claim to the account's owner, in the tokens earned, less its fee. It records the block of
// each account's last claim that received anything, and each claim's event carries the block recorded before it. So the
// page reads an account's claims newest first, one block of logs at a time, and the accounts claimed in the same block
// share each read. Anyone can claim for an account, even dust through a contract of their own, which makes its history
// as long as they like: the page stops after a few blocks.

const claimedAbi = parseAbi([
  "event Claimed(uint256 indexed tokenId, address indexed owner, address indexed caller, address[] tokens, uint256[] amounts, uint256[] fees, uint256 previousClaimBlock)",
]);

// The most blocks of claims read for one account.
export const WALK_LIMIT = 10;

export type Claim = {
  id: bigint;
  owner: Address;
  caller: Address;
  received: Amount[];
  fees: Amount[];
  // The block recorded before this claim's.
  previous: number;
  tx: Hex;
  block: number;
};
// An account's claims since the start of a period, newest first, and whether the walk stopped at WALK_LIMIT before it
// got there.
export type Walk = { claims: Claim[]; stopped: boolean };

// The claims in some logs, newest first.
export function claimsOf(logs: Log[]): Claim[] {
  return [...logs]
    .sort((a, b) => Number(order(b) - order(a)))
    .flatMap((log) => {
      let event;
      try {
        event = decodeEventLog({ abi: claimedAbi, eventName: "Claimed", data: log.data, topics: log.topics });
      } catch {
        return [];
      }
      const { tokenId, owner, caller, tokens, amounts, fees, previousClaimBlock } = event.args;
      return [
        {
          id: tokenId,
          owner,
          caller,
          received: positive(tokens, amounts),
          fees: positive(tokens, fees),
          previous: Number(previousClaimBlock),
          tx: log.transactionHash,
          block: Number(log.blockNumber),
        },
      ];
    });
}

// Reads the claims of some accounts in one block.
export type ClaimsAt = (block: number, ids: bigint[]) => Promise<Claim[]>;

// Each account's claims, from its last claim block `from` back to `since`, its period's first block. When a block holds
// several claims for one account, the first points back and the later ones point to the block itself, so the next
// block is the smallest one below the current that its claims point to.
export async function walkClaims(
  starts: Map<bigint, { from: number; since: number }>,
  claimsAt: ClaimsAt,
  limit = WALK_LIMIT,
): Promise<Map<bigint, Walk>> {
  const walks = new Map<bigint, Walk>();
  let at = new Map<bigint, number>();
  for (const [id, { from }] of starts) {
    walks.set(id, { claims: [], stopped: false });
    if (from > 0) at.set(id, from);
  }
  for (let read = 1; at.size; read++) {
    const blocks = [...new Set(at.values())];
    const found = await Promise.all(
      blocks.map((block) =>
        claimsAt(
          block,
          [...at].flatMap(([id, current]) => (current === block ? [id] : [])),
        ),
      ),
    );
    const next = new Map<bigint, number>();
    blocks.forEach((block, i) => {
      for (const [id, current] of at) {
        if (current !== block) continue;
        const walk = walks.get(id)!;
        const mine = found[i]!.filter((claim) => claim.id === id && claim.block === block);
        // A claim that received nothing moved nothing, and is left out.
        walk.claims.push(...mine.filter(({ received }) => received.length));
        const before = Math.min(...mine.map(({ previous }) => previous).filter((previous) => previous < block));
        if (!Number.isFinite(before) || before === 0 || before < starts.get(id)!.since) continue;
        if (read >= limit) walk.stopped = true;
        else next.set(id, before);
      }
    });
    at = next;
  }
  return walks;
}

const CLAIMED = encodeEventTopics({ abi: claimedAbi, eventName: "Claimed" })[0];
const topic = (id: bigint): Hex => numberToHex(id, { size: 32 });

// Double Espresso's claims for some accounts in a block, from one read of logs. Each account's claims in a block are
// read once. The page reads a block only where Double Espresso recorded a claim for each of the accounts, so an RPC
// whose logs lack one is behind, or lost them, and the next is asked.
const claimsIn = new Map<string, Claim[]>();

export const readClaimsAt: ClaimsAt = async (block, ids) => {
  const key = (id: bigint) => `${block} ${id}`;
  const missing = ids.filter((id) => !claimsIn.has(key(id)));
  if (missing.length) {
    const logs = await rpc<Log[]>(
      "eth_getLogs",
      [
        {
          address: DOUBLE_ESPRESSO.address,
          fromBlock: numberToHex(block),
          toBlock: numberToHex(block),
          topics: [CLAIMED, missing.map(topic)],
        },
      ],
      {
        topic: "payouts",
        accept: (found) => {
          const claimed = Array.isArray(found) ? claimsOf(found as Log[]) : [];
          return missing.every((id) => claimed.some((claim) => claim.id === id));
        },
      },
    );
    const found = claimsOf(logs);
    for (const id of missing)
      claimsIn.set(
        key(id),
        found.filter((claim) => claim.id === id),
      );
  }
  return ids.flatMap((id) => claimsIn.get(key(id))!);
};

// For tests: the claims read are kept for the rest of the session.
export const forgetClaims = (): void => claimsIn.clear();

// The block of each account's last claim through Double Espresso that received anything, or 0.
export async function lastClaimBlocks(ids: bigint[], block: number): Promise<Map<bigint, number>> {
  const found = required(
    await readFor("payouts")(
      ids.map((id) => doubleEspresso("lastClaimBlock", id)),
      block,
    ),
  ) as bigint[];
  return new Map(ids.map((id, i) => [id, Number(found[i])]));
}

// What a walk's claims received, took and paid, token by token.
export function totals(claims: Claim[]): { received: Amount[]; fees: Amount[]; paid: Amount[] } {
  const sum = (amounts: Amount[]): Amount[] => {
    const by = new Map<string, Amount>();
    for (const { token, amount } of amounts) {
      const held = by.get(token.toLowerCase());
      by.set(token.toLowerCase(), { token, amount: (held?.amount ?? 0n) + amount });
    }
    return [...by.values()];
  };
  const received = sum(claims.flatMap((claim) => claim.received));
  const fees = sum(claims.flatMap((claim) => claim.fees));
  const paid = received
    .map(({ token, amount }) => ({
      token,
      amount: amount - (fees.find((fee) => same(fee.token, token))?.amount ?? 0n),
    }))
    .filter(({ amount }) => amount > 0n);
  return { received, fees, paid };
}
