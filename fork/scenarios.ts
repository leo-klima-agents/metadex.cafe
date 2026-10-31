import { getAddress, type Address, type Hex } from "viem";
import { DOUBLE_ESPRESSO, WETH } from "../src/config.ts";
import {
  AVNT,
  BLOCK,
  ELSEWHERE,
  ENDED,
  HOLDER,
  LEAVER,
  MEMBER,
  NEWCOMER,
  PAYEE,
  RECENT,
  SELLER,
  ZORA,
  approveConduit,
  deployDoubleEspresso,
  doubleEspressoReceipts,
  fund,
  settle,
} from "./harness.ts";

// The states `npm run qa` forks Base into. Each owner gets 0.1 ETH for gas; the first is signed as.
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
  { address: NEWCOMER, holds: "#141, its own; #42877, in Liquid Hydrex, which stopped" },
  { address: ELSEWHERE, holds: "#2435 in Lock Maxi and #2439 in USDC, which both stopped" },
  { address: MEMBER, holds: "#9540 in Matcha Latte; #14485, its own" },
  { address: LEAVER, holds: "#53350 and #82206 in Matcha Latte" },
  { address: ENDED, holds: "#123351, whose lock ended; #123364" },
  { address: PAYEE, holds: "93 Hydrex accounts; #82774 in Matcha Latte, its payout late" },
];

// Thu 22 Oct 2026, 00:00:26 UTC: Hydrex has moved on to the new epoch, and Matcha Latte's operator has not paid yet.
const PAYOUT_BLOCK = 52_918_940;
const PAYOUTS: { hash: Hex; does: string }[] = [
  { hash: "0x4d64bad5fc3b699f9f10210ae3e368c475da5e09670c5358496f46fec4bbee4e", does: "pays #82774, 1 of 3" },
  { hash: "0xecd665d62e9571f45d54d1cd5f791f8bd4105569d4b1eb27280802c1824bbcf0", does: "pays #82774, 2 of 3" },
  { hash: "0x5546ef86e2e72b8447ea4928fd8134c4123c0303ce05d41cf8be515c93418a66", does: "pays #82774, 3 of 3" },
  { hash: "0xf37b32e199d0cb5cc9f76e4d8cc9b008bcbeaaa9d35dfbbab7c80def7fd6360b", does: "pays #35366, 1 of 3" },
  { hash: "0x4ce6bc6f60c0a8c04bf69c3a292642b4d445a4c36e20e0004a6ee75c536bb9f9", does: "pays #35366, 2 of 3" },
  { hash: "0x061f78add7ec37c4533ab7c30a3d2a0fbcf1fc253bb22d8503d54864a7116628", does: "pays #35366, 3 of 3" },
  { hash: "0xe06850e6ed95c1994461e1e82850538f5cf7607eb3e0686efdc8b534195c843c", does: "pays #9540" },
];

export const SCENARIOS: Scenario[] = [
  {
    name: "hydrex",
    title: "Fri 16 Oct 2026, Double Espresso deployed: both automations, those that stopped, accounts in or out",
    block: BLOCK,
    hash: "#hydrex",
    owners: ACCOUNTS,
    setup: deployDoubleEspresso,
  },
  {
    name: "double-espresso",
    title: "As hydrex, with #82774 in Double Espresso, claimed by two strangers",
    block: BLOCK,
    hash: "#hydrex/double-espresso",
    owners: [
      ...ACCOUNTS.filter(({ address }) => [NEWCOMER, LEAVER].includes(address)),
      { address: PAYEE, holds: "93 Hydrex accounts; #82774 in Double Espresso, with receipts" },
      ...ACCOUNTS.filter(({ address }) => address === MEMBER),
    ],
    setup: doubleEspressoReceipts,
  },
  {
    name: "swap",
    title: "Wed 21 Oct 2026, after the swappers' deployment: a wallet with three tokens to swap",
    block: RECENT,
    hash: "#swap",
    owners: [
      { address: SELLER, holds: "WETH, ZORA and AVNT, from Matcha Latte's fee recipient" },
      { address: HOLDER, holds: "Matcha Latte's fee recipient, a Safe with many tokens" },
      { address: PAYEE, holds: "93 Hydrex accounts; #82774 in Matcha Latte, its payout late" },
    ],
    setup: () => fund([WETH, ZORA, AVNT]),
  },
  {
    name: "claim",
    title: "Wed 21 Oct 2026: #82774 in Double Espresso, its payout overdue, to claim as it is or swapped",
    block: RECENT,
    hash: "#app",
    owners: [{ address: PAYEE, holds: "93 Hydrex accounts; #82774 in Double Espresso, its payout overdue" }],
    setup: async () => {
      await approveConduit(PAYEE, DOUBLE_ESPRESSO.address, 82774n);
      await settle();
    },
  },
  {
    name: "payout",
    title: "Thu 22 Oct 2026, just after the flip: Matcha Latte's payouts due, which the operator sends one by one",
    block: PAYOUT_BLOCK,
    hash: "#app",
    owners: [
      { address: PAYEE, holds: "93 Hydrex accounts; #82774 in Matcha Latte, its payout due" },
      { address: MEMBER, holds: "#9540 in Matcha Latte, its payout due; #14485, its own" },
      {
        address: getAddress("0x8cafed70f1b60066d3b076410c9eed0ce1f9667c"),
        holds: "#35366 in Matcha Latte, its payout due",
      },
    ],
    replays: PAYOUTS,
  },
];
