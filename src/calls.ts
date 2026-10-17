import { encodeFunctionData, type Address, type Hex } from "viem";
import { conduitAbi, votingEscrowAbi } from "./abi.ts";
import { CONDUIT, VOTING_ESCROW } from "./config.ts";
import type { Account } from "./hydrex.ts";

/** A call the wallet sends: what it does in words, and the contract, function and arguments the wallet shows. */
export type Step = { to: Address; data: Hex; says: string; on: string; shows: string };

const approval = (conduit: Address, id: bigint, approve: boolean) => ({
  to: VOTING_ESCROW,
  data: encodeFunctionData({ abi: votingEscrowAbi, functionName: "setConduitApproval", args: [conduit, id, approve] }),
  on: "Hydrex's VotingEscrow",
  shows: `setConduitApproval(${conduit}, ${id}, ${approve})`,
});

/** Joins the conduit with each account. An account in another of Hydrex's automations moves: the join replaces both. */
export const join = (accounts: Account[]): Step[] =>
  accounts.map((account) => ({
    ...approval(CONDUIT, account.id, true),
    says: `Put #${account.id} in the Carbon Impact automation.`,
  }));

export const leave = (accounts: Account[]): Step[] =>
  accounts.map((account) => ({
    ...approval(CONDUIT, account.id, false),
    says: `Take #${account.id} out of the Carbon Impact automation.`,
  }));

/** Sends the owner's payouts to an address. */
export const payout = (recipient: Address): Step => ({
  to: CONDUIT,
  data: encodeFunctionData({ abi: conduitAbi, functionName: "setMyPayoutRecipient", args: [recipient] }),
  says: `Send the payouts to ${recipient}.`,
  on: "the Carbon Impact automation",
  shows: `setMyPayoutRecipient(${recipient})`,
});
