import { encodeFunctionData, getAddress, type Address, type Hex } from "viem";
import { AUTOMATIONS, AUTOMAXI, KEEPER, VOTING_ESCROW, WETH } from "../src/config.ts";
import { readEarnings, rewardsFor, type Reward } from "../src/earnings.ts";
import { WEEK } from "../src/format.ts";
import { readAccounts } from "../src/hydrex.ts";
import { SETTLED, readEarned, readStamps, weighed } from "../src/receipts.ts";
import {
  AVNT,
  BLOCK,
  CONDUIT,
  ELSEWHERE,
  ENDED,
  FLIP,
  HOLDER,
  LEAVER,
  MEMBER,
  NEWCOMER,
  PAYEE,
  RECENT,
  SELLER,
  STRANGER,
  ZORA,
  abi,
  anvil,
  claimOne,
  deployAutoMaxi,
  fund,
  mined,
  settle,
  warm,
  warmPayouts,
} from "./harness.ts";

// The states that `npm run qa` puts a fork of Base in, for trying the page's flows by hand: each is the state of some
// of the browser tests, so that what they check can be seen. QA.md says which flow each one is for.
export type Owner = { address: Address; holds: string };
export type Scenario = {
  name: string;
  title: string;
  block: number;
  // The view the page opens on.
  hash: string;
  // The wallets to sign as, the first one first. Each gets 0.1 ETH for gas.
  owners: Owner[];
  // Changes the fork, then reads with no time limit what the page reads first: see warm in harness.ts.
  setup(): Promise<void>;
  // Transactions that Base included after the fork's block, which the QA wallet sends again in their order, as their
  // senders: each named by what it does.
  replays?: { hash: Hex; does: string }[];
};

// Hydrex's accounts at BLOCK, as the browser tests at BLOCK know them.
const ACCOUNTS: Owner[] = [
  { address: NEWCOMER, holds: "#141, its own; #42877, in Liquid Hydrex, which stopped" },
  { address: ELSEWHERE, holds: "#2435 in Lock Maxi and #2439 in USDC, which both stopped" },
  { address: MEMBER, holds: "#9540 in Carbon Impact; #14485, its own" },
  { address: LEAVER, holds: "#53350 and #82206 in Carbon Impact" },
  { address: ENDED, holds: "#123351, whose lock ended; #123364" },
  { address: PAYEE, holds: "93 Hydrex accounts; #82774 in Carbon Impact, its payout late" },
];

// The first block after Hydrex moved on to the epoch from Thu 22 Oct, 00:00 UTC, and before the keeper paid Carbon
// Impact's accounts for the one that ended: Thu 22 Oct 2026, 00:00:26 UTC.
export const PAYOUT_BLOCK = 52_918_940;
const OWNER_35366 = getAddress("0x8cafed70f1b60066d3b076410c9eed0ce1f9667c");
// The keeper's payouts after that flip, in the order Base included them, in blocks 52,918,941 to 52,918,956: each a
// claimSwapAndDistribute through Carbon Impact's executor module, as the keeper's README says.
const PAYOUTS: { hash: Hex; does: string }[] = [
  { hash: "0x4d64bad5fc3b699f9f10210ae3e368c475da5e09670c5358496f46fec4bbee4e", does: "pays #82774, 1 of 3" },
  { hash: "0xecd665d62e9571f45d54d1cd5f791f8bd4105569d4b1eb27280802c1824bbcf0", does: "pays #82774, 2 of 3" },
  { hash: "0x5546ef86e2e72b8447ea4928fd8134c4123c0303ce05d41cf8be515c93418a66", does: "pays #82774, 3 of 3" },
  { hash: "0xf37b32e199d0cb5cc9f76e4d8cc9b008bcbeaaa9d35dfbbab7c80def7fd6360b", does: "pays #35366, 1 of 3" },
  { hash: "0x4ce6bc6f60c0a8c04bf69c3a292642b4d445a4c36e20e0004a6ee75c536bb9f9", does: "pays #35366, 2 of 3" },
  { hash: "0x061f78add7ec37c4533ab7c30a3d2a0fbcf1fc253bb22d8503d54864a7116628", does: "pays #35366, 3 of 3" },
  { hash: "0xe06850e6ed95c1994461e1e82850538f5cf7607eb3e0686efdc8b534195c843c", does: "pays #9540" },
];

// Reads with no time limit what the page reads first, and what an account's page reads of the payouts of `ids` in
// Carbon Impact's pools, last epoch's and the one before's.
const warmStandings = (owners: Address[], ids: bigint[]) =>
  warm(async () => {
    const [earnings] = await Promise.all([
      readEarnings(CONDUIT),
      readEarnings(AUTOMAXI.address),
      ...owners.map((owner) => readAccounts(owner)),
    ]);
    const top = Number(await anvil<Hex>("eth_blockNumber")) - SETTLED;
    const last = weighed(earnings!.rewards, earnings!.prices);
    const before = weighed(await rewardsFor(CONDUIT, earnings!.start - WEEK), earnings!.prices);
    await Promise.all([readStamps(ids, last, top), readEarned(ids, last, top), readStamps(ids, before, top)]);
  });

const moveToAutoMaxi = (id: bigint) =>
  mined(
    PAYEE,
    VOTING_ESCROW,
    encodeFunctionData({ abi, functionName: "setConduitApproval", args: [AUTOMAXI.address, id, true] }),
  );

export const SCENARIOS: Scenario[] = [
  {
    name: "hydrex",
    title: "Fri 16 Oct 2026: Carbon Impact, the automations that stopped in September, and accounts in or out of them",
    block: BLOCK,
    hash: "#hydrex",
    owners: ACCOUNTS,
    setup: () =>
      warm(() =>
        Promise.all([
          ...ACCOUNTS.map(({ address }) => readAccounts(address)),
          ...AUTOMATIONS.map(({ address }) => readEarnings(address)),
          rewardsFor(CONDUIT, FLIP - 3 * WEEK),
        ]),
      ),
  },
  {
    name: "automaxi",
    title: "As hydrex, once AutoMaxi is on Base, with #82774 in it, claimed by its keeper and by a stranger",
    block: BLOCK,
    hash: "#hydrex/automaxi",
    owners: [
      ...ACCOUNTS.filter(({ address }) => [NEWCOMER, LEAVER].includes(address)),
      { address: PAYEE, holds: "93 Hydrex accounts; #82774 in AutoMaxi, with receipts" },
      ...ACCOUNTS.filter(({ address }) => address === MEMBER),
    ],
    async setup() {
      await deployAutoMaxi();
      let rewards: Reward[] = [];
      await warm(async () => {
        rewards = (await readEarnings(CONDUIT))!.rewards;
      });
      await anvil("anvil_setBalance", [STRANGER, "0x16345785d8a0000"]);
      await moveToAutoMaxi(82774n);
      const usdc = rewards.filter(({ token }) => token.symbol === "USDC");
      await claimOne(KEEPER, 82774n, usdc[0]!);
      await claimOne(STRANGER, 82774n, usdc[1]!);
      await settle();
      await warmStandings([NEWCOMER, LEAVER, PAYEE], [82774n]);
    },
  },
  {
    name: "swap",
    title: "Wed 21 Oct 2026, after the swappers' deployment: a wallet with three tokens to swap",
    block: RECENT,
    hash: "#swap",
    owners: [
      { address: SELLER, holds: "WETH, ZORA and AVNT, from Carbon Impact's treasury" },
      { address: HOLDER, holds: "Carbon Impact's treasury, a Safe with many tokens" },
      { address: PAYEE, holds: "93 Hydrex accounts; #82774 in Carbon Impact, its payout late" },
    ],
    setup: () => fund([WETH, ZORA, AVNT]),
  },
  {
    name: "claim",
    title: "Wed 21 Oct 2026: #82774 in AutoMaxi, its payout overdue, to claim as it is or swapped",
    block: RECENT,
    hash: "#app",
    owners: [{ address: PAYEE, holds: "93 Hydrex accounts; #82774 in AutoMaxi, its payout overdue" }],
    async setup() {
      await moveToAutoMaxi(82774n);
      await settle();
      await warmPayouts(PAYEE);
    },
  },
  {
    name: "payout",
    title: "Thu 22 Oct 2026, just after the flip: Carbon Impact's payouts due, which the keeper sends one by one",
    block: PAYOUT_BLOCK,
    hash: "#app",
    owners: [
      { address: PAYEE, holds: "93 Hydrex accounts; #82774 in Carbon Impact, its payout due" },
      { address: MEMBER, holds: "#9540 in Carbon Impact, its payout due; #14485, its own" },
      { address: OWNER_35366, holds: "#35366 in Carbon Impact, its payout due" },
    ],
    replays: PAYOUTS,
    setup: () => warmStandings([PAYEE, MEMBER, OWNER_35366], [82774n, 9540n, 35366n]),
  },
];

export const scenario = (name: string): Scenario | undefined => SCENARIOS.find((each) => each.name === name);
