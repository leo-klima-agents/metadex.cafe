# Nami tokenomics

Nami has four tokens. **NAMI** is the emissions token. **veNAMI** is a locked NAMI position that votes. **wveNAMI** is
an ERC-20 share of a pooled permanent lock, used to pay locked rewards to liquidity providers. **ogNAMI** is a separate
fixed-supply presale token that earns 10% of trading fees.

Marks: **[on-chain]** read from a chain on 16 November 2026 (see `evidence/onchain-snapshot.txt`); **[code]** read from
the source verified on Etherscan; **[docs]** stated at docs.nami.fi or in the repository's `docs/`; **[derived]** my
arithmetic from the above.

## Where the protocol stands today

Nami is in its three-week "Genesis" launch phase, which runs from 5 to 26 November 2026. Pools are live on Base,
Ethereum and Robinhood Chain. Emissions have not started: the Minter's `isEpochsStarted` is false. **[on-chain]**

| Measure                         | Value                                                   | Source                                                 |
| ------------------------------- | ------------------------------------------------------- | ------------------------------------------------------ |
| NAMI price                      | about $7.86 (reference launch price was $5.00)          | [derived] NAMI/WETH pool on Base and Chainlink ETH/USD |
| Value of all 1.2M NAMI          | about $9.4M                                             | [derived]                                              |
| Net ETH paid into the NAMI pool | 68.9 WETH, about $124,000                               | [on-chain] pool balance                                |
| ogNAMI price                    | about $10.77 (presale price was $10.00)                 | [derived] ogNAMI/WETH pool on Base                     |
| TVL                             | $0.51M (Base $0.32M, Robinhood $0.10M, Ethereum $0.09M) | DefiLlama, 16 November 2026                            |
| Volume, last 7 days             | $20.9M                                                  | DefiLlama                                              |
| Fees, last 7 days               | $29,843                                                 | DefiLlama                                              |

The $9.4M valuation rests on about $124,000 of net buying along a single-sided launch curve. It says little about what
NAMI would fetch in size.

## NAMI supply

**Genesis supply is 1,200,000 NAMI, minted once on Ethereum.** `NamiHub.GENESIS_SUPPLY` is a constant and `initialMint`
can run once. **[code]** There is no maximum supply and no fixed emission schedule. **[code] [docs]**

The whole genesis supply is accounted for on-chain. **[on-chain]**

| Chain           | Liquid NAMI    | veNAMI (permanent locks, NAMI burned) |
| --------------- | -------------- | ------------------------------------- |
| Ethereum (hub)  | 90,999.01      | 963,997.97                            |
| Base            | 138,723.40     | 1,277.61                              |
| Robinhood Chain | 5,000.01       | 2.00                                  |
| **Total**       | **234,722.42** | **965,277.58**                        |

The two totals add up to exactly 1,200,000. A permanent lock burns its NAMI, so 80.4% of the genesis supply can never be
sold as NAMI. It can still be sold as a position: permanent locks are transferable NFTs, and wveNAMI is an ERC-20.

### Initial allocation

The docs give this split of the 1.2M. **[docs]**

| Bucket                   | Infinite veNAMI | Liquid NAMI | Share  |
| ------------------------ | --------------- | ----------- | ------ |
| Incentives               | 300,000         | 0           | 25.00% |
| Protocol Reserve         | 200,000         | 0           | 16.67% |
| Ecosystem Partners       | 180,000         | 20,000      | 16.67% |
| Multichain Liquidity     | 0               | 150,000     | 12.50% |
| Genesis Phase            | 70,000          | 40,000      | 9.17%  |
| Recursive Buyback Engine | 100,000         | 0           | 8.33%  |
| Presale Airdrop          | 34,000          | 26,000      | 5.00%  |
| Blockchain Foundations   | 40,000          | 0           | 3.33%  |
| SwapX Airdrop            | 40,000          | 0           | 3.33%  |
| **Total**                | **964,000**     | **236,000** | 100%   |

There is no bucket named "team". The docs do not say who controls Incentives, Protocol Reserve, Ecosystem Partners and
Blockchain Foundations, how they vest, or whether they vote. Together with the buyback engine's seed, those buckets are
840,000 NAMI-equivalent, 70% of the allocation. 820,000 of that is veNAMI, 85% of the initial voting power.
**[derived]**

**Today one multisig holds almost all of it.** veNAMI #2 on Ethereum holds 963,996.97 veNAMI and belongs to a 4-of-7
Safe, `0x52a34381251fA5531746EAa952b7153ff9FFA56b`. That is 99.87% of all voting power. The public holds about 1,280
veNAMI. **[on-chain]** Voters receive 90% of the fees of gauged pools, so whether and how this position votes decides
who earns those fees. Nothing on-chain stops it from voting. The docs say only that the buyback engine's position votes
through the Relayer.

## Emissions: what "d(3,3)" is on-chain

**The pitch.** Emissions follow no schedule. Each epoch a model reads swap fees, "emission efficiency" (fees divided by
the dollar value of net emissions) and the NAMI price, and proposes a change: at most +10% after two good epochs, up to
−25% at once, and never outside one quarter to four times the first emission. A rising price can never raise emissions.
**[docs]**

**What the contract enforces.** **[code]** `Minter.sol` is a Solidly-style minter:

- Each week's emission is last week's times `EMISSION`. The Minter's owner can set `EMISSION` anywhere from 5% to 200%,
  at any time.
- The first week's amount is set once by the owner, before epochs start, and may be anything up to **1,400,000 NAMI**.
  That cap is larger than the whole genesis supply.
- The owner sets the split between rebase, lock bonus and gauges freely, as long as the first two do not exceed 100%.
- Nothing is minted for a team. The three categories are the only destinations.

So the model, its two-epoch rule, its +10% and −25% limits and its envelope all run **off-chain**. The contract only
stops a single step from being more than a halving-to-5% or a doubling. The docs do say hard limits are "−95% to +100%
per epoch" and that an "extraordinary policy" may leave the envelope.

**Who the owner is.** The Minter's owner is the same 4-of-7 Safe, with no timelock in between. **[on-chain]**

**Current values.** `weekly` is still the 400,000 placeholder, `initialWeeklySet` is false, `EMISSION` is 100% (flat),
rebase is 4% and the lock bonus is 10%. **[on-chain]** The team says it will size the first emission from Genesis data
before Epoch 0 ends, on 26 November. **[docs]** That number, which I will call E0, is the largest unknown in the
tokenomics: every later emission compounds from it.

For scale: Nami earned about $30,000 in fees over its best week so far. An emission worth the same amount would be about
3,800 NAMI a week at today's price. The 400,000 placeholder would be worth about $3.1M a week. **[derived]**

### Where each week's emission goes

| Share                                             | Goes to                                                             | Source        |
| ------------------------------------------------- | ------------------------------------------------------------------- | ------------- |
| Rebase: `0.15 × (1 − lock ratio)`, from 0% to 15% | Permanent locks, in proportion to voting power. Paid into the lock. | [docs]        |
| Lock bonus: 10%, fixed                            | Liquidity providers who lock more of their rewards than the minimum | [docs] [code] |
| Gauges: the rest                                  | Liquidity providers, split across pools by votes                    | [docs] [code] |

The rebase formula is in the docs only. On-chain the rate is a number the owner sets, currently 4%. The first emission
pays no rebase. **[code]**

### How liquidity providers are paid

Gauged pools give all their swap fees to voters and ogNAMI stakers, so their liquidity providers earn emissions only.
**[docs]** The NAMI/WETH pool's community fee is set to 100%, which matches. **[on-chain]** During Genesis only, a
provider can choose to keep 0%, 45% or 90% of their fees, in exchange for fewer points.

Rewards stream through Algebra's eternal farming to in-range liquidity. Providers do not stake anything in the gauge. A
position that leaves within a per-pool "anti-JIT" window forfeits its rewards. **[docs] [code]**

At least 20% of every reward claim is paid as wveNAMI, which is a permanent lock. A provider may raise that share up to
100% and earn up to 10% more. **[docs] [code]** In effect, a provider's liquid reward is at most 80% of the headline.

## veNAMI: the two locks

|                    | Standard lock                  | Infinite lock ("iNFT")                                    |
| ------------------ | ------------------------------ | --------------------------------------------------------- |
| Duration           | 2 weeks to 26 weeks            | Forever                                                   |
| Voting power       | Decays linearly to zero        | Constant, equal to the amount locked                      |
| The NAMI           | Returned at expiry             | Burned. It never comes back                               |
| Rebase             | Accrues, but cannot be claimed | Claimable, and paid into the lock                         |
| Bridging           | No                             | Yes, by burn and mint over Chainlink CCIP                 |
| Automation, credit | No                             | Yes (both are "later wave" modules)                       |
| Exit               | Withdraw at expiry             | None. Sell the NFT, or wrap it into wveNAMI and sell that |

Sources: **[docs]**; the 26-week maximum is `NamiTimeLibrary.MAX_LOCK_DURATION` **[code]**.

Six months is short for a vote-escrow lock: Aerodrome's maximum was four years. Nami pushes long-term holders to the
permanent lock instead, which is the only kind that earns the rebase.

wveNAMI's owner keeps a blocklist of addresses that cannot receive it, "kept to disable secondary markets if needed".
**[docs]** So the exit through wveNAMI depends on the team not blocklisting the venues where it trades.

Voting runs in weekly epochs that flip on Thursday at 00:00 UTC. No public votes are accepted in the last hour. In that
hour only whitelisted positions vote, which is how the team's Relayer votes last, with full sight of everyone else's
votes. **[docs] [code]**

## Fees and revenue

| Flow                                     | Split                                                            | Source        |
| ---------------------------------------- | ---------------------------------------------------------------- | ------------- |
| Swap fees, gauged ("permissioned") pools | 90% to veNAMI voters of that pool, 10% to ogNAMI stakers in USDC | [docs]        |
| Swap fees, ungauged pools                | 99% to liquidity providers, 1% to Algebra                        | [docs]        |
| Bribes ("voting incentives")             | 100% to voters of that pool                                      | [docs] [code] |
| "Net protocol revenue"                   | 95% buys NAMI and locks it forever; 5% buys and burns ogNAMI     | [docs]        |

"Net protocol revenue" is what feeds the **Recursive Buyback Engine**. It does not include swap fees. Its sources are
the MEV-X plugin's backrun profits, the 1% Relayer fee after running costs, lending fees, marketplace fees, revenue
shared by swap aggregators, the anti-snipe launch fee, and the voting rewards of the engine's own veNAMI. **[docs]** The
NAMI it buys becomes protocol-owned voting power, starting from a 100,000 veNAMI seed, and its voting rewards go back
into buybacks. The docs do not define what is deducted to reach "net".

Two consequences follow. A growing protocol-owned position takes a growing share of the 90% that goes to voters. And the
only cash that reaches NAMI holders who do not lock is buy pressure from the engine.

Gauges are permissioned: only an authorised creator can give a pool a gauge, and both tokens must be whitelisted.
**[docs] [code]**

## ogNAMI and the presale

| Fact                        | Value                                                                                   | Source            |
| --------------------------- | --------------------------------------------------------------------------------------- | ----------------- |
| Supply                      | 250,000 at mint, fixed; 249,917.26 now, after one burn of 82.74                         | [code] [on-chain] |
| Planned split               | 200,000 public sale, 30,000 seed liquidity, 20,000 buyer bonus                          | [docs]            |
| Presale terms               | 10 USDC each, up to 100,000 USDC a wallet, on Base, 5 October to 2 November 2026        | [docs] [on-chain] |
| **Sold**                    | **86,500 ogNAMI for 865,000 USDC: 43% of the target, from 405 wallets**                 | [on-chain]        |
| **Unsold and unused bonus** | **124,850 ogNAMI, 49.96% of supply, in a 4-of-7 team Safe on Base**                     | [on-chain]        |
| Staked (sogNAMI)            | 87,695.68                                                                               | [on-chain]        |
| In the ogNAMI/WETH pool     | 28,004.78                                                                               | [on-chain]        |
| What a holder gets          | Staked ogNAMI earns 10% of gauged pools' swap fees, in USDC, each epoch                 | [docs]            |
| Buyers' vesting             | Locked through Genesis, then linear over 12 weekly epochs                               | [docs]            |
| Buyers' bonus               | Up to +10% ogNAMI, accruing over epochs 11 to 17, lost on early exit                    | [docs]            |
| Buyers' NAMI airdrop        | 60,000 NAMI-equivalent in total: 60% as veNAMI at once, 40% as NAMI over about 100 days | [docs]            |
| Planned use of funds        | 50% NAMI liquidity, 25% ogNAMI liquidity, 15% incentives and operations, 10% referrals  | [docs]            |

**The unsold half is the open question.** The Safe at `0x764AaBe5987dA77c22D5995F1E44D64CeB9207ac` holds the 113,500
ogNAMI that did not sell plus 11,350 of unused bonus. I found no statement on what happens to them. If the Safe staked
them, it would take about 59% of the stakers' fee stream. If it sold them, it would add more supply than the whole
presale did. The presale terms say only that a buyer's bonus "may be reduced proportionally" if the sale does not fill.

The presale raised less than half its target, so the seed liquidity it funds is smaller than the "up to $1.0M+" the docs
show.

For a sense of the yield: 10% of the last week's fees is about $3,000, shared by 87,696 staked ogNAMI. That is about
$0.034 per ogNAMI a week, or roughly 16% a year on the $10.77 price, if this week's fees repeated and nothing else
changed. **[derived]** Genesis-week volume is boosted by points farming, so treat that as an upper bound.

## The launch: Genesis and Epoch 0

- **Genesis (5 to 26 November).** Providers earn up to 100,000 points, each worth 1 NAMI-equivalent (60% veNAMI, 40%
  NAMI that vests). The team sets each pool's daily point budget as it goes. **[docs]** Points are tracked off-chain.
- **Price discovery.** NAMI and ogNAMI opened as single-sided liquidity above $5.00 and $10.00. An anti-snipe fee
  started at 500% and decayed to zero over 30 minutes. **[docs]**
- **Epoch 0 (19 to 26 November).** The first vote. 90% of all Genesis swap fees become voting rewards for it, in USDC.
  **[docs]** With the public holding about 1,280 veNAMI, those rewards go to whoever locks early, unless the Safe votes.
- **Epoch 1 (from 26 November).** Emissions begin, Genesis rewards and airdrops become claimable, presale ogNAMI starts
  to unlock.

## What is discretionary

Every item here is decided by the team's 4-of-7 Safe or by its keepers, not by token holders or by code:

1. The first emission, up to 1.4M NAMI, and every weekly change after it.
2. The rebase rate and the lock bonus rate.
3. Which pools get a gauge, and which are frozen.
4. Each epoch's split of emissions across chains and gauges. Votes are recorded on each chain, but a keeper adds them up
   off-chain and posts a Merkle root. One address can dispute it, within one hour. See `04-risks.md`.
5. Each voter's share of fees and bribes, settled the same way.
6. How the 820,000 veNAMI in team-controlled buckets votes.
7. What happens to the unsold 124,850 ogNAMI.
8. Genesis point budgets.

veNAMI holders vote on where gauge emissions go. They have no vote on any of the eight items above.
