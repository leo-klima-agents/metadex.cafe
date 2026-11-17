# Nami compared with Aerodrome, Aero and Hydrex

**Short answer.** Nami is a Hydrex-style stack (Algebra pools, permanent locks that burn the token, Merkle-settled
rewards) with Aero-style ambitions (emissions tied to revenue, one vote across chains), run with more discretion and far
less distribution than any of the three. It is about 350 times smaller than Aero and less than one fifth the size of
Hydrex, and it has no emission history yet.

The four protocols:

- **Aerodrome** is the original ve(3,3) DEX on Base, by Dromos Labs, live since August 2023. Its emissions stopped when
  Aero launched; its pools still trade.
- **Aero** is Dromos Labs' successor, live since 22 October 2026. It merges Aerodrome and Velodrome, replaces weekly
  votes with continuous allocation, and runs on Base plus seven other chains.
- **Hydrex** is an Algebra-based ve(3,3) DEX on Base only, live since September 2025. It pays liquidity providers in an
  option token.
- **Nami** is in its launch phase on Ethereum, Base and Robinhood Chain. Emissions start around 26 November 2026.

Facts about Nami are sourced in `01-who-is-behind.md` and `02-tokenomics.md`. Facts about the other three come from
`evidence/aero-facts.md` and `evidence/hydrex-facts.md`, which give a source and a status for every line. On-chain
figures are from Base on 16 November 2026. "Safe" means a Safe multisig; "3-of-7" means three of seven signers.

## 1. Team and scale

|                     | Nami                                              | Aerodrome                                          | Aero                                                             | Hydrex                                                      |
| ------------------- | ------------------------------------------------- | -------------------------------------------------- | ---------------------------------------------------------------- | ----------------------------------------------------------- |
| Builder             | Unnamed. On-chain trail to the SwapX team (Sonic) | Dromos Labs, the Velodrome team                    | Dromos Labs                                                      | "Hydrex Association"                                        |
| Legal form          | Nami Labs Inc., British Virgin Islands            | Delaware LLC, plus a Cayman foundation             | Same                                                             | Wyoming DUNA                                                |
| Named people        | None                                              | Eight executives named in a 2026 disclosure filing | Same                                                             | One co-founder, Garrett Lee                                 |
| Funding             | Presale of ogNAMI: 865,000 USDC                   | No sale, no VC round                               | No sale; whole supply went to AERO and VELO holders              | No sale, no VC round; a $10,000 seed and a builder grant    |
| Live since          | 5 November 2026 (pools); emissions not yet        | 28 August 2023                                     | 22 October 2026                                                  | 11 September 2025                                           |
| Chains              | Ethereum (hub), Base, Robinhood Chain             | Base                                               | Base (root) and 7 others, including Ethereum and Robinhood Chain | Base                                                        |
| TVL                 | $0.51M                                            | $109M, with emissions stopped                      | $177M                                                            | $2.84M (peak $23.4M)                                        |
| Volume, 7 days      | $20.9M, during a points campaign                  | $807M                                              | $6.05B                                                           | $10.3M                                                      |
| Fees, 7 days        | $29,800                                           | $253,000                                           | $2.37M                                                           | $111,000, which also counts option exercises and incentives |
| Token price         | NAMI $7.86                                        | Legacy AERO $0.415                                 | AERO $0.415                                                      | HYDX $0.019                                                 |
| Value of all tokens | $9.4M, counting NAMI burned into locks            | Migrating into Aero                                | $889M                                                            | $13.3M, counting HYDX burned into locks                     |

TVL, volume and fees are DefiLlama's. Nami's valuation is about 70% of Hydrex's on less than a fifth of the TVL, before
any emission has been paid.

## 2. Token supply and distribution

|                           | Nami                                                                            | Aerodrome                                                                  | Aero                                                 | Hydrex                                                                                |
| ------------------------- | ------------------------------------------------------------------------------- | -------------------------------------------------------------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Supply at launch          | 1.2M NAMI                                                                       | 500M AERO                                                                  | 2,127M AERO, pre-minted for migration                | 500M HYDX                                                                             |
| Supply now                | 1.2M: 234,722 liquid, 965,278 burned into locks                                 | 2,008M                                                                     | 2,143M                                               | 107M liquid, 593M burned into locks                                                   |
| Share locked at launch    | 80% as permanent locks                                                          | 90% as locks                                                               | Carried over from the old locks                      | 94% "locked" in the docs; 79% on-chain after five days                                |
| Share locked now          | 80%                                                                             | 53% before migration                                                       | 50% staked, nine tenths of it perpetual              | 87%                                                                                   |
| Who got the launch supply | Team-controlled buckets 70%; liquidity 12.5%; launch rewards and airdrops 17.5% | veVELO lockers 40%; public goods 21%; team 19%; grants 10%; incentives 10% | Old holders only: AERO 1:1, VELO at 0.044            | Community and partners 50%; treasury 25%; contributors 20%; liquidity 3%; advisors 2% |
| Insider vesting           | Not stated. Locks are permanent but transferable                                | None: team tokens were permanent locks                                     | None: positions carried over                         | None: permanent locks, transferable                                                   |
| Supply cap                | None                                                                            | None                                                                       | None, but minting is rate-limited                    | None                                                                                  |
| Second token              | ogNAMI, 250,000 fixed, earns 10% of fees                                        | None                                                                       | xAERO, a receipt for AERO on other chains            | oHYDX, an option on HYDX                                                              |
| Largest holder of votes   | A team 4-of-7 Safe: 99.87%                                                      | Team, public goods and grants locks were about 56% at launch               | The Foundation's fund is "one of the largest" stakes | The treasury 2-of-3 Safe: 59%. It has not voted since September 2026                  |

Nami's "team-controlled buckets" are Incentives, Protocol Reserve, Ecosystem Partners, Blockchain Foundations and the
buyback engine's seed. Nami has no bucket called "team", but it also names no one else who controls these.

Hydrex is the nearest precedent for a treasury that holds most of the votes. Hydrex says its treasury "does not compete
for voting fees", and on-chain it has not voted for two months. Nami has made no such statement.

## 3. Emissions

|                           | Nami                                                                    | Aerodrome                                                                | Aero                                                                            | Hydrex                                                                                         |
| ------------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Shape                     | A weekly amount, rescaled each week                                     | A weekly amount on a fixed curve, then a tail                            | A rate per second; AERO is minted only when a provider claims                   | A weekly amount from a formula, then a tail                                                    |
| First emission            | Not set. Up to 1.4M NAMI allowed, 117% of supply                        | 10M AERO a week, 2% of supply                                            | 13.49 AERO a second: 8.16M a week, 20% a year, as a ceiling                     | Zero, rising to 6M a week by week 12, 1.2% of supply                                           |
| Path                      | Whatever the team sets                                                  | +3% a week for 14 weeks, then −1% a week, then the tail                  | Flat ceiling; actual minting is 53% of it so far                                | Down 0.02 points a week to 2.0M at week 52                                                     |
| Now                       | Not started                                                             | Stopped. The tail was 0.21% of supply a week                             | 5.75M AERO in the last 7 days, about $2.4M                                      | 300,000 HYDX a week, about $5,700                                                              |
| Who can change the amount | The 4-of-7 Safe, no delay: ×0.05 to ×2 each week                        | Nobody during the curve. In the tail, the team Safe: ±0.01 points a week | The operator 3-of-7 Safe: ±1.2% per 47 hours now; the contract allows 5% a week | Holders vote ±100,000 a week; a Governor can set 0 to 2%; the 2-of-4 Safe can rescale the base |
| Tie to revenue            | A model run by the team, off-chain                                      | None                                                                     | A cap per gauge, about 1.2× the pool's revenue, set by operator keys            | None in code                                                                                   |
| Rebase to lockers         | 0% to 15% by formula in the docs; 4% set on-chain; permanent locks only | Yes, weekly, to all locks                                                | None                                                                            | Started at 26%, zero since week 52                                                             |
| Team share of emissions   | None                                                                    | Up to 5%; about 5% at the end                                            | 5% on top of each mint                                                          | Was 4%; zero since September 2026                                                              |
| Form paid to providers    | 80% NAMI at most, 20% or more as a permanent lock; +10% for locking all | Liquid AERO                                                              | Liquid AERO, or xAERO on other chains                                           | oHYDX: pay about half of spot for HYDX today, or lock it for free                              |

Three things stand out.

**Nami and Aero aim at the same thing by opposite means.** Both want emissions to track revenue. Aero does it pool by
pool: each gauge has a cap near 1.2 times what the pool earns, tokens are minted only when claimed, and what a capped
gauge cannot pay is never minted. Over the last week Aero minted about $2.4M of AERO against $2.37M of fees. Nami does
it with one global number that the team sets each week from a model nobody can inspect. Aero's caps are also set by
operator keys, so both trust an off-chain process; Aero's is bounded by a per-second ceiling in the contract, and Nami's
by a doubling per week.

**Nami has the widest discretion over the starting point.** Aerodrome and Hydrex hard-coded their first weeks. Aero's
ceiling is a constant from deployment. Nami's first emission is a number the Safe will type in.

**Paying part of rewards as a lock is Hydrex's idea, made compulsory.** Hydrex's provider chooses between paying to
exercise and locking for free. Nami's provider gets 20% as a permanent lock whether they want it or not.

## 4. Locking

|                       | Nami                                                  | Aerodrome                               | Aero                                               | Hydrex                                                        |
| --------------------- | ----------------------------------------------------- | --------------------------------------- | -------------------------------------------------- | ------------------------------------------------------------- |
| Position              | veNAMI, an NFT                                        | veAERO, an NFT                          | sAERO, an NFT                                      | veHYDX "Account", an NFT                                      |
| Timed lock            | 2 to 26 weeks, decaying                               | 1 week to 4 years, decaying             | Up to 4 years, decaying                            | "Flex": up to 2 years, decaying or held at maximum            |
| Permanent lock        | Yes. The NAMI is burned. One-way                      | Yes. Can be switched off                | Yes ("perpetual"). Leaving restarts a 4-year clock | Yes. The HYDX is burned. One-way                              |
| Votes per token       | Permanent: 1. Timed: up to 1 at 26 weeks              | Permanent: 1. Timed: up to 1 at 4 years | Same as Aerodrome                                  | Flex at maximum: 1. Permanent: 0.77                           |
| Early exit            | None                                                  | None                                    | None                                               | Flex only: pay up to 50%, burned                              |
| Transferable          | Yes, unless it has voted this epoch                   | Yes, unless it has voted this epoch     | Yes, always                                        | Yes, always                                                   |
| Merge and split       | Merge yes; split needs a whitelist                    | Merge yes; split needs a whitelist      | Neither yet                                        | Both, for every lock type                                     |
| Liquid wrapper        | wveNAMI, an ERC-20 the team can blocklist             | None native                             | None native                                        | None native                                                   |
| Automation            | "Relayer", a later module; team keeper; 1% of rewards | "Relay", managed locks                  | "Autopilot"; rake 0% now, 20% at most              | "Conduits"; anyone can deploy one; Hydrex's charge 0% to 0.5% |
| Borrowing against it  | "Nami Credit", a later module, hub only               | None native                             | None native                                        | None found                                                    |
| Bridging the position | Permanent locks and wveNAMI, by burn and mint         | Not applicable                          | No. One stake allocates to any chain from Base     | Not applicable                                                |

Nami's permanent lock works like Hydrex's: the token is burned and the NFT is all that is left. Hydrex gives a permanent
lock fewer votes than a two-year one, to pay for the option of leaving; Nami gives it more privileges than a timed lock
and caps the timed lock at six months.

## 5. Voting and fees

|                           | Nami                                                                    | Aerodrome                                | Aero                                                             | Hydrex                                             |
| ------------------------- | ----------------------------------------------------------------------- | ---------------------------------------- | ---------------------------------------------------------------- | -------------------------------------------------- |
| Cadence                   | Weekly epochs, Thursday 00:00 UTC                                       | Weekly epochs, Thursday 00:00 UTC        | No epochs. A stake can move every 47 hours                       | Weekly epochs, Thursday 00:00 UTC                  |
| Closed windows            | Last hour: only whitelisted positions vote                              | First and last hour                      | None                                                             | None                                               |
| Votes carry over          | Only if "poked" each week                                               | Yes                                      | Allocations stand until changed                                  | No. Vote every week or earn nothing                |
| Pools per position        | 50                                                                      | 60                                       | 20 per chain                                                     | Not checked                                        |
| Swap fees, gauged pools   | 90% to voters, 10% to ogNAMI stakers                                    | 100% to voters                           | 100% to allocators                                               | 98.5% to voters, 1.5% to Algebra                   |
| What providers there earn | Emissions only                                                          | Emissions only                           | Emissions only                                                   | Emissions only                                     |
| Fee on unstaked liquidity | Not applicable: nothing is staked                                       | 10% to voters                            | 5% on Base, 0% on Ethereum and Robinhood Chain                   | Not applicable                                     |
| When voters are paid      | After the epoch, once a Merkle root is active                           | The following epoch, on-chain            | Continuously, on-chain                                           | After the epoch flips, on-chain                    |
| Bribes                    | Per epoch, up to 4 epochs ahead, whitelisted tokens                     | Per epoch, whitelisted tokens            | Streaming programs of 2 days or more, listed tokens              | Per epoch, tokens enabled per gauge by an admin    |
| Getting a gauge           | Team approval                                                           | Anyone, once both tokens are whitelisted | Governance Safe only, on-chain                                   | Anyone for some types; an admin whitelist for most |
| Other protocol income     | MEV backruns, automation, lending and marketplace fees: all to buybacks | The team's own locks                     | A priority-fee MEV tax to allocators (set to zero on Base today) | Option exercises, to a reserve that holders govern |
| Buyback                   | Automatic by design: 95% buys and locks NAMI, 5% burns ogNAMI           | At the foundation's discretion           | At the foundation's discretion                                   | A fund that votes, buys HYDX and locks it          |

Nami is the only one of the four where voters do not get all the swap fees of the pools they vote for: 10% is carved out
for the presale token. It is also the only one where the value of MEV capture goes to buybacks, not to voters.

Aero has the same three chains as Nami. An sAERO holder on Base can already allocate to pools on Ethereum and Robinhood
Chain. So "one vote, every chain" is not unique to Nami; what Nami adds is a vote for a market, which the protocol then
splits across that market's pools on different chains.

## 6. Pools and cross-chain design

|                            | Nami                                                       | Aerodrome                                        | Aero                                                             | Hydrex                                                    |
| -------------------------- | ---------------------------------------------------------- | ------------------------------------------------ | ---------------------------------------------------------------- | --------------------------------------------------------- |
| Concentrated liquidity     | Algebra Integral 1.2.2, licensed                           | Slipstream, from Uniswap v3                      | Slipstream V3, from Uniswap v3, with swap hooks                  | Algebra Integral 1.2, licensed                            |
| Basic pools                | None                                                       | Stable and volatile                              | Stable and volatile                                              | Stable and volatile                                       |
| Fees                       | Dynamic, by volatility                                     | Fixed per pool; a dynamic module later           | Dynamic: base plus volatility, with a cap                        | Dynamic and directional, 0.01% to 0.34% in practice       |
| MEV                        | A backrun plugin (MEV-X); profit to buybacks               | Nothing native                                   | A tax on priority fees; wired in, set to zero on Base            | Nothing in the default plugin                             |
| Rewards for providers      | Algebra farming, in range only; forfeit if you leave early | Stake in the gauge; in range only for Slipstream | Stake in the gauge; forfeit if you leave within about 15 seconds | Stake vault tokens, or Merkle claims for manual positions |
| Token across chains        | NAMI is burned and minted on each chain, with rate limits  | Base only                                        | AERO lives on Base only; other chains pay a receipt, xAERO       | Base only                                                 |
| Messaging                  | Chainlink CCIP; Hyperlane wired as a spare                 | Not applicable                                   | Hyperlane                                                        | Not applicable                                            |
| Where votes are counted    | Off-chain, by a keeper, into a Merkle root                 | On-chain                                         | On-chain: Base holds each stake's budget per chain               | On-chain                                                  |
| Where emissions are minted | Ethereum, then bridged to each chain weekly                | Base                                             | Base, when a claim on another chain is redeemed                  | Base                                                      |

Aero keeps its token on one chain and sends messages; a bridge fault there cannot mint AERO elsewhere. Nami mints NAMI
on every chain it runs on, which is more convenient and puts more weight on the bridge limits.

## 7. Control and assurance

|                             | Nami                                                              | Aerodrome                                          | Aero                                                           | Hydrex                                                                   |
| --------------------------- | ----------------------------------------------------------------- | -------------------------------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Core contracts              | Upgradeable proxies and diamonds. The token itself is not         | Not upgradeable                                    | Not upgradeable                                                | Upgradeable proxies. The token and option token are not                  |
| Upgrade delay               | 24 hours                                                          | Not applicable                                     | Not applicable                                                 | 24 hours                                                                 |
| Main admin                  | One 4-of-7 Safe                                                   | A 3-of-7 Safe; separate emergency and minter Safes | One 3-of-7 Safe for every role; a second with the same signers | A 3-of-3 Safe for upgrades; a 2-of-4 Safe for operations; one single key |
| Timelock on parameters      | None on emissions or settlement                                   | None                                               | None                                                           | None on fees, whitelists, the option token or the emission base          |
| Votes held by the team side | 99.87%                                                            | About 56% at launch, by design                     | Not quantified; the foundation's fund is "one of the largest"  | 59% in the treasury, idle; about 4% more in funds that vote              |
| Holder governance           | None                                                              | None in effect: the "governor" was the team Safe   | None on-chain                                                  | Real but narrow: the tail emission rate and the reserve                  |
| Settled off-chain           | Emission split, voter rewards, launch points, the emission amount | Nothing                                            | Gauge caps, Autopilot, token listing                           | Rewards for manual positions, gauge eligibility, conduit runs            |
| Audits                      | BailSec: five reports in 2026                                     | Spearbit, ChainSecurity, MixBytes                  | ChainSecurity (three), Sherlock (two), a public contest        | Sherlock (August 2025), Paladin (one module)                             |
| Bug bounty                  | None found                                                        | Up to $200,000                                     | Up to $500,000                                                 | Claimed in the docs; no programme found                                  |
| Licence                     | Business Source 1.1 to 2030                                       | Business Source 1.1 and GPL                        | A restricted-use licence for five years, then GPL              | Mostly MIT; Algebra core is Business Source 1.1                          |
| Code published              | Verified on explorers. GitHub has only the swap account           | GitHub and explorers                               | GitHub and explorers                                           | Verified on explorers. The audited repository is not public              |
| Open to US and EU users     | No, by its terms                                                  | Not checked                                        | Not checked                                                    | Not checked                                                              |

None of the four is governed by its token holders in any strong sense, and none puts a timelock on its day-to-day
parameters. The differences are of degree:

- **Aerodrome and Aero cannot be upgraded.** Their admins can change parameters, add modules and pause, but cannot
  rewrite the escrow or the token. Nami's and Hydrex's can, after a day.
- **Hydrex has a weaker operations key than Nami.** One externally owned account can redirect pool fees and bypass gauge
  whitelists. Nami's single keys are its keeper and its disputer, and a keeper's root waits an hour before it takes
  effect.
- **Nami settles the most off-chain.** Aerodrome computes everything on-chain. Aero sets its gauge caps off-chain and
  Hydrex pays manual positions by Merkle root, but both count votes and pay voters on-chain. Nami decides the emission
  amount, counts the votes, splits the emissions and pays voters off-chain.
- **Nami has the least independent review.** One audit firm, no bounty that I found, and a private working repository.

## What Nami takes from each, and what is its own

**From the Solidly and Aerodrome line:** weekly epochs flipping on Thursday, all gauged-pool fees leaving the pool,
bribes per epoch, a rebase, permissioned splitting of locks, a minter whose code is recognisably Thena's.

**From the Hydrex and Algebra line:** Algebra Integral pools with a custom plugin, a 100% community fee on gauged pools,
permanent locks that burn the token, part of rewards paid in a form that pushes toward locking, a team-run automation
layer for voters, Merkle roots for rewards, and a treasury that starts with most of the votes.

**In common with Aero:** the aim of tying emissions to revenue, a penalty for liquidity that leaves at once, capturing
MEV at the pool, and one position that directs emissions on several chains.

**Its own:**

- **ogNAMI**, a presale token with a claim on 10% of fees. None of the others sold anything.
- **The Recursive Buyback Engine**, a protocol-owned permanent lock that grows from non-fee revenue and votes.
- **A six-month maximum** on timed locks, where the others use two or four years.
- **A liquid ERC-20 wrapper** for permanent locks, with a blocklist.
- **Voting for a market** that spans pools on several chains.
- **Lending against locks and a marketplace for them**, both announced for later.
- **Off-chain settlement of the vote itself.**

## Where that leaves Nami

Against **Aero**, Nami competes on the same three chains with about one 350th of the liquidity, one audit firm against
Aero's two plus a public contest and a bounty, and a token whose votes sit 99.87% with the team. Its case is that a
small, new token with a tight float can pay providers more per dollar of liquidity than a $900M one. That depends
entirely on the first emission and on NAMI holding its price.

Against **Hydrex**, Nami is the closer cousin: similar code lineage, similar permanent-lock economics, similar reliance
on a team Safe. Hydrex has fourteen months of emission history, emissions that have fallen from 2.0M to 0.3M a week,
partly by weekly holder votes, a treasury that visibly abstains, and one named founder. It also has a single-key admin
and a TVL down 88% from its peak. Nami has none of the history and a more complex system, across three chains from the
first day.

Against **Aerodrome**, the useful comparison is the launch. Aerodrome also began with 90% of supply locked and over half
its votes in team and foundation hands. The differences are that Aerodrome's emission curve was fixed in immutable code,
its insiders' locks came from a team with Velodrome's record, and nothing was sold to the public.

## Source notes for the other three

The two fact sheets in `evidence/` were compiled by research sub-tasks on 16 November 2026 from official docs, verified
contract source and on-chain reads on Base (blocks 58,168,500 and 58,168,920). I rechecked 25 of their on-chain figures
at block 58,177,156 and all matched. Their main sources:

- **Aero:** [app.aero.xyz/docs](https://app.aero.xyz/docs/),
  [aero.xyz/articles/the-aero-economy](https://aero.xyz/articles/the-aero-economy/),
  [aero.xyz/aero-upgrade](https://aero.xyz/aero-upgrade/), the `dromos-labs/metadex-public` repository, and verified
  source on Basescan.
- **Aerodrome:** [aerodrome.finance/docs](https://aerodrome.finance/docs), the `aerodrome-finance/contracts` and
  `slipstream` repositories, a
  [Blockworks token transparency filing](https://blockworks.com/token-transparency/filing/aerodrome) (issuer-reported),
  and verified source on Basescan.
- **Hydrex:** [docs.hydrex.fi](https://docs.hydrex.fi), [paragraph.com/@hydrex](https://paragraph.com/@hydrex), the
  [Sherlock audit report](https://github.com/sherlock-protocol/sherlock-reports/blob/main/audits/2025.08.20%20-%20Final%20Report%20-%20Hydrex%20Collaborative%20Audit%20Report.pdf),
  a
  [PR Newswire release](https://www.prnewswire.com/news-releases/hydrex-launches-duna-governed-protocol-with-100-revenue-share-on-base-302559931.html),
  and verified source on Basescan.
- **Scale figures for all four:** the DefiLlama API. Token prices: DefiLlama for AERO and HYDX; Nami's own pool and
  Chainlink for NAMI.

Things the fact sheets could not establish, which bear on the comparison: the signers of every Safe, on all four
protocols; Aero's parameters on chains other than Base; the security set-up of the Hyperlane routes Aero uses; and
whether Hydrex has a live bug bounty.
