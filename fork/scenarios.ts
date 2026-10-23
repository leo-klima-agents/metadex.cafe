import { encodeFunctionData, type Address, type Hex } from "viem";
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

const moveToAutoMaxi = (id: bigint) =>
  mined(
    PAYEE,
    VOTING_ESCROW,
    encodeFunctionData({ abi, functionName: "setConduitApproval", args: [AUTOMAXI.address, id, true] }),
  );

export const SCENARIOS: Scenario[] = [
  {
    name: "hydrex",
    title: "Fri 16 Oct 2026: Carbon Impact, the automations that stopped, and accounts in every state",
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
      { address: NEWCOMER, holds: "#141, its own; #42877, in Liquid Hydrex, which stopped" },
      { address: LEAVER, holds: "#53350 and #82206 in Carbon Impact" },
      { address: PAYEE, holds: "93 Hydrex accounts; #82774 in AutoMaxi, with receipts" },
      { address: MEMBER, holds: "#9540 in Carbon Impact; #14485, its own" },
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
      await warm(async () => {
        const [earnings] = await Promise.all([
          readEarnings(CONDUIT),
          readEarnings(AUTOMAXI.address),
          readAccounts(NEWCOMER),
          readAccounts(LEAVER),
          readAccounts(PAYEE),
        ]);
        const top = Number(await anvil<Hex>("eth_blockNumber")) - SETTLED;
        const last = weighed(earnings!.rewards, earnings!.prices);
        const before = weighed(await rewardsFor(CONDUIT, earnings!.start - WEEK), earnings!.prices);
        await Promise.all([
          readStamps([82774n], last, top),
          readEarned([82774n], last, top),
          readStamps([82774n], before, top),
        ]);
      });
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
];

export const scenario = (name: string): Scenario | undefined => SCENARIOS.find((each) => each.name === name);
