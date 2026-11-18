import { getAddress, type Address, type Hex } from "viem";
import { DOUBLE_ESPRESSO, WETH } from "../src/config.ts";
import * as h from "../fork/harness.ts";

// The states that `npm run qa` forks Base into. Each owner gets 0.1 ETH for gas. The wallet starts by signing as the
// first owner.
export type Owner = { address: Address; holds: string };
export type Scenario = {
  name: string;
  title: string;
  block: number;
  hash: string;
  owners: Owner[];
  setup?: () => Promise<unknown>;
  // Transactions that Base included after `block`. The QA wallet sends them again, in order, from their senders.
  replays?: { hash: Hex; does: string }[];
};

const ACCOUNTS: Owner[] = [
  { address: h.NEWCOMER, holds: "#141, its own; #42877, in Liquid Hydrex, which stopped" },
  { address: h.ELSEWHERE, holds: "#2435 in Lock Maxi and #2439 in USDC, which both stopped" },
  { address: h.MEMBER, holds: "#9540 in Matcha Latte; #14485, its own" },
  { address: h.LEAVER, holds: "#53350 and #82206 in Matcha Latte" },
  { address: h.ENDED, holds: "#123351, whose lock ended; #123364" },
  { address: h.LATE, holds: "134 Hydrex accounts; #26432 and #14247 in Matcha Latte, both late" },
];

// Thu 12 Nov 2026, 00:00:25 UTC, the first flip after Base Denim: Hydrex has moved on to the new epoch, and Matcha
// Latte's operator has not paid yet. It pays each account in one transaction.
const PAYOUT_BLOCK = 56_256_250;
// 93 Hydrex accounts; #82774 in Matcha Latte.
const PAYEE = getAddress("0x60924601e73ebc5c2bd9244c788d93e0710a6c93");

export const SCENARIOS: Scenario[] = [
  {
    name: "aero",
    title: "Mon 16 Nov 2026, after Base Denim: a wallet with 25 sAERO stakes to allocate, none locked",
    block: h.BLOCK,
    hash: "#aero",
    owners: [{ address: h.ALLOCATOR, holds: "25 sAERO stakes, none locked; #2848 the largest" }],
  },
  {
    name: "hydrex",
    title: "Mon 16 Nov 2026, after Base Denim: both automations, those that stopped, accounts in or out",
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
    title: "Mon 16 Nov 2026: #26432, unpaid since Thu 11 June, in Double Espresso, claimed by two strangers",
    block: h.BLOCK,
    hash: "#hydrex/double-espresso",
    owners: [...ACCOUNTS.slice(0, -1), { address: h.LATE, holds: "134 Hydrex accounts; #26432 in Double Espresso" }],
    setup: h.doubleEspressoReceipts,
  },
  {
    name: "swap",
    title: "Mon 16 Nov 2026, after Base Denim: a wallet with three tokens to swap",
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
    title: "Mon 16 Nov 2026: #26432 in Double Espresso, its payout overdue, to claim as it is or swapped",
    block: h.BLOCK,
    hash: "#app",
    owners: [{ address: h.LATE, holds: "134 Hydrex accounts; #26432 in Double Espresso, its payout overdue" }],
    setup: () => h.approveConduit(h.LATE, DOUBLE_ESPRESSO.address, 26432n).then(h.settle),
  },
  {
    name: "payout",
    title: "Thu 12 Nov 2026, just after the flip: Matcha Latte's payouts due, which the operator sends one by one",
    block: PAYOUT_BLOCK,
    hash: "#app",
    owners: [
      { address: PAYEE, holds: "93 Hydrex accounts; #82774 in Matcha Latte, its payout due" },
      { address: h.MEMBER, holds: "#9540 in Matcha Latte, its payout due; #14485, its own" },
      { address: "0x8cafEd70F1B60066d3B076410C9eED0cE1f9667C", holds: "#35366 in Matcha Latte, its payout due" },
    ],
    // The operator's payouts in the order it sent them, the first two to accounts outside this scenario.
    replays: [
      { hash: "0xf0f5225bfad17f401a858ea2e23cbe5a638b1ba105f2cf6fd3ef46d6b7584bec", does: "pays #43261" },
      { hash: "0x23c75fda8a9a214ad7ce1c71ccfad1c994aadc41bd7ced404a235797958068d1", does: "pays #52050" },
      { hash: "0x8d2cbed92015c1b7b8baa2a4f81b8fc385093870cd809cec0e95769b6c8a2caf", does: "pays #82774" },
      { hash: "0xec856e71724c65c2895ae24360424f20b48f53a0ba96fe827186778374a751ee", does: "pays #35366" },
      { hash: "0xdc4caa3792b12d37301f14565a1247e4f606e0cae0bfb1f8e3178eb416b0efcd", does: "pays #9540" },
    ],
  },
];
