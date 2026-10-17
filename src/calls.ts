import { encodeFunctionData, type Address, type Hex } from "viem";
import { conduitAbi, votingEscrowAbi } from "./abi.ts";
import { CONDUIT, VOTING_ESCROW } from "./config.ts";
import { list } from "./format.ts";
import { automation, type Account } from "./hydrex.ts";

/** A call the wallet sends: what it does in words, and the contract, function and arguments the wallet shows. */
export type Step = { to: Address; data: Hex; says: string; on: string; shows: string };

const approval = (conduit: Address, id: bigint, approve: boolean) => ({
  to: VOTING_ESCROW,
  data: encodeFunctionData({ abi: votingEscrowAbi, functionName: "setConduitApproval", args: [conduit, id, approve] }),
  on: "Hydrex's VotingEscrow",
  shows: `setConduitApproval(${conduit}, ${id}, ${approve})`,
});

/**
 * Joins the conduit with each account. An account in another automation moves: the join replaces both its delegate
 * and its claimer, which two automations may hold apart.
 */
export const join = (accounts: Account[]): Step[] =>
  accounts.map((account) => {
    const names = [account.delegate, account.claimer].map(automation).filter((name) => name !== undefined);
    const from = [...new Set(names)];
    const leaving = from.length ? `leaves the ${list(from)} automation${from.length > 1 ? "s" : ""} and ` : "";
    return {
      ...approval(CONDUIT, account.id, true),
      says: `#${account.id} ${leaving}joins the Carbon Impact automation.`,
    };
  });

export const leave = (accounts: Account[]): Step[] =>
  accounts.map((account) => ({
    ...approval(CONDUIT, account.id, false),
    says: `#${account.id} leaves the Carbon Impact automation.`,
  }));

/** Sends the owner's payouts to an address. */
export const payout = (recipient: Address): Step => ({
  to: CONDUIT,
  data: encodeFunctionData({ abi: conduitAbi, functionName: "setMyPayoutRecipient", args: [recipient] }),
  says: `Send the payouts to ${recipient}.`,
  on: "the Carbon Impact automation",
  shows: `setMyPayoutRecipient(${recipient})`,
});
