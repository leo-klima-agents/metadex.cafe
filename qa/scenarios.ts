import type { Address, Hex } from "viem";
import { DOUBLE_ESPRESSO, WETH } from "../src/config.ts";
import * as h from "../fork/harness.ts";

// The states `npm run qa` forks Base into. Each owner gets 0.1 ETH for gas, and the wallet starts signing as the first.
export type Owner = { address: Address; holds: string };
export type Scenario = {
  name: string;
  title: string;
  block: number;
  hash: string;
  owners: Owner[];
  setup?: () => Promise<unknown>;
  // Transactions Base included after `block`, which the QA wallet sends again, in order, as their senders.
  replays?: { hash: Hex; does: string }[];
};

const ACCOUNTS: Owner[] = [
  { address: h.NEWCOMER, holds: "#141, its own; #42877, in Liquid Hydrex, which stopped" },
  { address: h.ELSEWHERE, holds: "#2435 in Lock Maxi and #2439 in USDC, which both stopped" },
  { address: h.MEMBER, holds: "#9540 in Matcha Latte; #14485, its own" },
  { address: h.LEAVER, holds: "#53350 and #82206 in Matcha Latte" },
  { address: h.ENDED, holds: "#123351, whose lock ended; #123364" },
  { address: h.PAYEE, holds: "93 Hydrex accounts; #82774 in Matcha Latte, paid up to Thu 5 Nov" },
];

// Thu 22 Oct 2026, 00:00:26 UTC: Hydrex has moved on to the new epoch, and Matcha Latte's operator has not paid yet.
const PAYOUT_BLOCK = 52_918_940;

export const SCENARIOS: Scenario[] = [
  {
    name: "hydrex",
    title: "Mon 9 Nov 2026, after Base Denim: both automations, those that stopped, accounts in or out",
    block: h.BLOCK,
    hash: "#hydrex",
    owners: ACCOUNTS,
  },
  {
    name: "fee",
    title: "As hydrex, with Matcha Latte's payout fee raised to 1%, the most its Hydrex admin can set",
    block: h.BLOCK,
    hash: "#hydrex/matcha-latte",
    owners: ACCOUNTS,
    setup: () => h.setMatchaLatteFee(100n),
  },
  {
    name: "double-espresso",
    title:
      "Fri 16 Oct 2026, before Denim, #82774 unpaid since Thu 17 Sept: in Double Espresso, claimed by two strangers",
    block: h.UNPAID,
    hash: "#hydrex/double-espresso",
    owners: [...ACCOUNTS.slice(0, -1), { address: h.PAYEE, holds: "93 Hydrex accounts; #82774 in Double Espresso" }],
    setup: h.doubleEspressoReceipts,
  },
  {
    name: "swap",
    title: "Mon 9 Nov 2026, after Base Denim: a wallet with three tokens to swap",
    block: h.BLOCK,
    hash: "#swap",
    owners: [
      { address: h.SELLER, holds: "WETH, ZORA and AVNT, from Matcha Latte's fee recipient" },
      { address: h.HOLDER, holds: "Matcha Latte's fee recipient, a Safe with many tokens" },
      ACCOUNTS.at(-1)!,
    ],
    setup: () => h.fund([WETH, h.ZORA, h.AVNT]),
  },
  {
    name: "claim",
    title: "Wed 21 Oct 2026, before Denim: #82774 in Double Espresso, its payout overdue, to claim as it is or swapped",
    block: h.UNPAID_SWAPS,
    hash: "#app",
    owners: [{ address: h.PAYEE, holds: "93 Hydrex accounts; #82774 in Double Espresso, its payout overdue" }],
    setup: () => h.approveConduit(h.PAYEE, DOUBLE_ESPRESSO.address, 82774n).then(h.settle),
  },
  {
    name: "payout",
    title: "Thu 22 Oct 2026, just after the flip: Matcha Latte's payouts due, which the operator sends one by one",
    block: PAYOUT_BLOCK,
    hash: "#app",
    owners: [
      { address: h.PAYEE, holds: "93 Hydrex accounts; #82774 in Matcha Latte, its payout due" },
      { address: h.MEMBER, holds: "#9540 in Matcha Latte, its payout due; #14485, its own" },
      { address: "0x8cafEd70F1B60066d3B076410C9eED0cE1f9667C", holds: "#35366 in Matcha Latte, its payout due" },
    ],
    replays: [
      { hash: "0x4d64bad5fc3b699f9f10210ae3e368c475da5e09670c5358496f46fec4bbee4e", does: "pays #82774, 1 of 3" },
      { hash: "0xecd665d62e9571f45d54d1cd5f791f8bd4105569d4b1eb27280802c1824bbcf0", does: "pays #82774, 2 of 3" },
      { hash: "0x5546ef86e2e72b8447ea4928fd8134c4123c0303ce05d41cf8be515c93418a66", does: "pays #82774, 3 of 3" },
      { hash: "0xf37b32e199d0cb5cc9f76e4d8cc9b008bcbeaaa9d35dfbbab7c80def7fd6360b", does: "pays #35366, 1 of 3" },
      { hash: "0x4ce6bc6f60c0a8c04bf69c3a292642b4d445a4c36e20e0004a6ee75c536bb9f9", does: "pays #35366, 2 of 3" },
      { hash: "0x061f78add7ec37c4533ab7c30a3d2a0fbcf1fc253bb22d8503d54864a7116628", does: "pays #35366, 3 of 3" },
      { hash: "0xe06850e6ed95c1994461e1e82850538f5cf7607eb3e0686efdc8b534195c843c", does: "pays #9540" },
    ],
  },
];
