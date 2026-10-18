# Research behind the UX directions

The evidence for [README.md](README.md): who uses automations on Base today, what comparable products do and charge, and
what changes with Aero. Gathered on 17 Oct 2026. Claims that could not be checked are marked.

## On-chain sizing

Read from Base mainnet on 17 Oct 2026 between 20:29 and 20:49 UTC, through Multicall3 in chunks of 200 calls, each
script pinned to one block (52,739,819 to 52,740,387). No read failed.

### Hydrex

Contracts: VotingEscrow `0x25B2ED7149fb8A05f6eF9407d9c8F878f59cd1e1`, Voter
`0xc69E3eF39E3fFBcE2A1c570f8d3ADF76909ef17b`, the conduits in [`src/hydrex-conduits.json`](../src/hydrex-conduits.json).

- **Voting power:** 469,825,931 votes (`totalSupply()`, which here is voting power), or 610.8M Earning Power. The sum of
  `balanceOfNFT` over every account equals it exactly.
- **HYDX:** about $0.0246, from the deepest pool, Algebra HYDX/USDC `0x51f0…D3D2`, which holds about $215k of USDC;
  HYDX/WETH and the classic HYDX/USDC pair agree. All votes are then worth about $11.6M, nominally: the escrow holds
  17.69M HYDX against 470M of summed lock amounts, so this is not what could be withdrawn.
- **Accounts:** 123,857 minted, all enumerable; 6,183 hold votes; 117,670 are empty (amount 0, not burned). 96.3% of
  votes are in permanent locks.

| Earning Power | Accounts | Share of votes | Owners |
| ------------- | -------- | -------------- | ------ |
| Under 1k      | 4,238    | 0.07%          | 2,072  |
| 1k–10k        | 1,018    | 0.62%          | 736    |
| 10k–100k      | 628      | 3.26%          | 445    |
| 100k–1M       | 246      | 13.47%         | 196    |
| Over 1M       | 53       | 82.58%         | 59     |

At $0.0246 a vote, 1,000 Earning Power is worth about $19, 10,000 about $189, 100,000 about $1,900, and a million about
$18,900.

- **Owners:** 3,508 hold accounts with votes. The top 10 hold 72.05% of votes, the top 100 hold 90.94%. One 2-of-3 Safe,
  `0xd9e9…50aF`, holds 59.6% across 15 accounts and last voted on 16 Sep; it is also the address Carbon Impact's
  `treasury()` returns.
- **Who votes with them**, by each account's delegate: the owner itself, 86.85% of votes (3,757 accounts); 21 other
  addresses, 11.08% (78 accounts); the 13 stopped conduits, 1.87% (2,331 accounts); Carbon Impact, 0.19% (17 accounts,
  11 owners).
- **Automations by owner:** 1,648 owners (47%) have an account in one of Hydrex's 14 conduits; 1,640 have one in a
  conduit that stopped; 3 have both. Of the 2,348 conduit accounts, 1,810 hold under 1,000 Earning Power.
- **Stopped conduits:** all 13 last voted on 9 Sep 2026. Their 8,791,556 votes, 11.4M Earning Power, earn nothing. At
  Carbon Impact's rate last epoch, that is about $6,800 a week not earned.
- **Voted last epoch:** 35.9% of voting power (`Voter.totalWeightAt` for the epoch from 8 Oct: 168,381,324). Without the
  one large Safe, 19.3M votes (4.1%) did not vote, 8.79M of them in stopped conduits.
- **An unlisted automation:** `0x3547…b7f4`, an ERC-1967 proxy that is not on Hydrex's list, holds 9.29M votes from 26
  owners and voted on 17 Oct: as many votes as all 14 listed conduits together.

| Conduit                                  | Votes now | At the epoch's start |
| ---------------------------------------- | --------- | -------------------- |
| USDC                                     | 2,312,375 | 2,314,951            |
| Liquid Hydrex                            | 2,003,572 | 2,004,406            |
| Bluechips                                | 1,311,649 | 1,311,649            |
| Hydrex Lock Maxi                         | 1,103,168 | 1,099,436            |
| Carbon Impact                            | 897,043   | 897,043              |
| Ethereum                                 | 758,948   | 759,051              |
| Onchain cbAssets                         | 721,822   | 721,822              |
| Bitcoin                                  | 477,347   | 500,824              |
| Reppo                                    | 66,805    | 66,805               |
| EURC, Base Memes, Base Gaming, TGN, WMTX | 35,870    | 35,870               |
| **All 14**                               | 9,688,599 | 9,711,877            |

### Carbon Impact, last epoch

The epoch from Thu 8 Oct to Thu 15 Oct, read with the page's own `readEarnings`:

- 1,166,156 Earning Power voted for 27 pools; the last vote was cast on Wed 14 Oct at 23:59:57 UTC.
- Its votes earned about $692.85: $27.48 in fees, $665.37 in incentives, in 28 tokens. That is about $0.594 per 1,000
  Earning Power.
- The five pools with most of its votes: AVNT/USDC (16.7%, about $116), wtDRAM/USDC (14.2%, $102), GOO/cbBTC (9.8%,
  $67), WETH/MILK (9.2%, $63), ZORA/WETH (9.2%, $63).
- Settings: `retireBps` 3333, `treasuryFeeBps` 0 (up to 1%, per the README). It has retired 22,141 kVCM as 5,691 tonnes,
  about 3.9 kVCM a tonne. kVCM is about $0.0273 in Hydrex's kVCM/USDC pools.

### Aerodrome

Contracts: VotingEscrow `0xeBf418Fe2512e7E6bd9b87a8F0f294aCDC67e6B4`, Voter
`0x16613524e02ad97eDfeF371bC883F2F5d6C480A5`, both checked against each other on chain.

- **Voting power:** 1,034,176,037 veAERO; 1,058.7M AERO locked; 989.3M in permanent locks.
- **Relays** (managed veNFTs, read through `escrowType` for every id): 75, of which 70 active, hold 569,353,579 votes,
  55.05% of veAERO. 10,562 locks from 7,006 owners are in them.

| Relay                   | veAERO  | Share  | Member locks / owners |
| ----------------------- | ------- | ------ | --------------------- |
| Public Goods Funding    | 219.30M | 21.21% | 16 / 3                |
| Ouranous Foundation     | 198.08M | 19.15% | 23 / 2                |
| veAERO Maxi             | 47.78M  | 4.62%  | 8,434 / 6,170         |
| Wonderland Relay        | 36.33M  | 3.51%  | 15 / 3                |
| Echinacea Foundation    | 30.41M  | 2.94%  | 6 / 2                 |
| Moonwell veAERO         | 20.04M  | 1.94%  | 745 / 323             |
| Reserve veAERO          | 3.93M   | 0.38%  | 98 / 82               |
| KLIMA veAERO            | 705     | —      | —                     |
| Balanced Klimate veAERO | 104     | —      | —                     |

- **Locks:** 93,130 live, owned by 51,750 addresses; 59,748 of the 69,902 ordinary locks with votes hold under 1,000
  veAERO. The top 10 owners hold 59% of votes, counting each relay as one owner.
- **Votes carry over between epochs** on Aerodrome: the total weight was the same on both sides of the last flip. 93.8%
  of voting power was allocated at the flip; 16.8% of the votes counted now were cast before 8 Oct.
- **Concentrated liquidity:** Slipstream's 837 gauges point to 4 position contracts with 30.7M position NFTs, most of
  them probably empty, and 42,923 staked in gauges. Managers could not be told apart reliably: Arcadia accounts and vfat
  Sickles are per-user contracts, and Gamma, Ichi and Steer vaults hold liquidity without position NFTs.

## Aerodrome relays, and Aero

### What ends this week

From Aero's upgrade page, read on 17 Oct ([aero.xyz/aero-upgrade](https://aero.xyz/aero-upgrade/)):

- "Maxi Relays cast their final votes on Wednesday October 7."
- "If your veNFT sits in a Relay, withdraw it by October 20 and vote manually in the final epoch to earn that week's
  rewards." A lock still in a relay cannot be upgraded.
- "Aero launches 2026-10-22T00:00:00Z": Thu 22 Oct, 00:00 UTC.
- veAERO and veVELO become sAERO, staked AERO, as a new position with a new id; the lock time carries over, rounded up
  to a full week.
- "Each sAERO position has a 47-hour cooldown between allocation changes at launch." The product page says "Allocations
  can shift every 48 hours at launch, subject to a cooldown period that shortens over time", and that stakers "earn
  Exchange Revenue as it accrues, pool by pool, in real time"
  ([Predictive Allocation](https://aero.xyz/features/predictive-allocation/)). Rewards stream; there is no weekly payout
  to hang a receipt on, so receipts for Aero products are per week, not per epoch.
- "Users should withdraw from ALMs on Aerodrome and Velodrome. Positions will not move automatically."

**Klima's two Aerodrome relays,** "KLIMA veAERO" (705 veAERO) and "Balanced Klimate veAERO" (104), were still
compounding on 15 Oct, per Aerodrome's RelaySugar. Their members fall under the 20 Oct deadline.

### Velodrome V2 relays, as they were

From the shared contracts' [specification](https://github.com/velodrome-finance/contracts/blob/main/SPECIFICATION.md)
and the [relay README](https://github.com/aerodrome-finance/relay):

- Deposits: once per epoch, only from a lock that has not voted that epoch, and not in the last hour before the flip.
- Withdrawals: from the epoch after the deposit; the lock is re-locked for four years.
- Neither in the first hour of an epoch.
- Keepers compound from an hour after the flip; in the last 24 hours anyone may, for at least 1% of the amount.

Aerodrome's app asked for consent to the side effects: "I understand that by depositing my Lock into a Relay strategy,
the Lock unlock date will be extended to 4 years", and on withdrawal, "I understand that by withdrawing now I won't be
able to claim later the compound from these rewards". Its docs: "make sure the automation was run before you withdraw,
the latest update date should be recent".

### Aero's V3 relays

From the interfaces in Dromos Labs' public repository
([IRelay](https://github.com/Dromos-Labs/metadex-public/blob/main/V3/src/interfaces/relay/IRelay.sol),
[IRelayFactory](https://github.com/Dromos-Labs/metadex-public/blob/main/V3/src/interfaces/relay/IRelayFactory.sol)).
Read from interfaces, not deployed contracts: to confirm with Dromos before building.

- **Tiers:** "Maxi: permissionless deposits." "ProtocolL1: whitelist-gated, fixed entrypoints." "ProtocolL2:
  whitelist-gated, mutable entrypoints, sweep." An L1 relay can be promoted to L2, one way. The allow list gates
  deposits and transfers of the yield token, and allow-listed tiers refuse a transferable yield token.
- **Creating one** needs `RELAY_DEPLOYER_ROLE`, which Aero's Voter grants.
- **Deposits wait in a queue:** "No shares mint here: the entry waits on the deposit queue until the keeper processes
  it, or anyone after it ages past keeperWindow." There is a minimum deposit.
- **Two tokens per deposit:** "The principal token (PT): the priced position carrying the withdraw right", and "The
  yield token (YT): the balance the reward accumulator reads".
- **Withdrawals wait in a first-in, first-out queue,** which is "Permissionless; cannot be cancelled". Shares in the
  queue keep earning. If the oldest request has waited a full evacuation window, anyone can close the relay, and every
  stake comes back.
- **The manager can remove an address** from the allow list (`Kicked`): its rewards are settled and its position is put
  in the withdrawal queue.
- **Entrypoints:** a compounder, single or multiple converters, and a hybrid whose split "is applied off-chain by" the
  keeper. On Protocol L2 relays, a new entrypoint attaches only after a non-zero timelock, and a vetoer, if set, can
  cancel it; Maxi and L1 entrypoints are fixed.
- **Fees:** Aero's protocol fee reduces what is recorded on deposit, and on withdrawal; its rate is not in the
  interface. Aero's Autopilot replaces the Maxi relay; its fee is not stated.

Unlike a Hydrex conduit, a deposit moves the stake out of the owner's position into the relay's pooled sAERO. An "Aero
v3 relay" for metaDEX Café would be a Protocol relay, created with Aero's agreement.

## Hydrex automations

From Hydrex's app bundle, docs and API, read on 17 Oct ([API](https://api.hydrex.fi/conduits),
[docs](https://hydrex.gitbook.io/home/pro-concepts/protocol-automations.md)):

- The app presents automations as cards: icon, name, payout split, a "Carbon impact" badge, plus "No Automation" and
  "Request Custom Automation". In effect a menu of payout tokens: USDC, cbBTC, WETH, EURC, baskets, HYDX, a re-locking
  Lock Maxi, partner tokens.
- Its copy: "Votes 60% on TGN/AZUSD, 40% on other. 100% back in TGN."; "Your account automation status will change after
  the next payout"; for new accounts, "You won't earn for the current epoch, but will start earning weekly from the next
  epoch."
- History: "Automation History", "Total Automated Payouts", "Next payout", from a per-user jobs endpoint.
- APR is not per automation: 13 of 14 conduits share `estimatedWeeklyVoteApr: 69` in the API.
- Fees disagree: 1% of fees in the docs, "0.5% fee on earnings" in the app's FAQ, Lock Maxi "completely fee-free".
- **The sunset:** cards greyed out, "Automations are ending. You can only turn them off.", and "Automations have ended.
  Please switch to No Automation." No public reason, date or successor was found. DefiLlama lists Hydrex at $4.2M to
  $4.9M, from a peak of $18.3M to $23.4M in January 2026, depending on the entry
  ([hydrex](https://defillama.com/protocol/hydrex), [hydrex-integral](https://defillama.com/protocol/hydrex-integral)).
- Concentrated liquidity on Hydrex is Algebra Integral, with dynamic fees. Its strategy list has 293 ICHI single-sided
  vaults, 4 Gamma, 2 Algebra and 251 manual
  ([strategies](https://github.com/hydrexfi/hydrex-lists/blob/main/strategies/8453.json)).

## What comparable products charge

As each publishes it, read on 17 Oct.

| Product               | What it does                                  | Fee                                                                                                                                    |
| --------------------- | --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Hydrex automations    | Vote, claim, pay out                          | 0.5% or 1% of earnings (sources disagree); Lock Maxi none                                                                              |
| Carbon Impact         | Vote, claim, retire, pay out                  | 33.33% retired; fee 0%, up to 1%                                                                                                       |
| Autopilot (Aerodrome) | Vote, pay out in USDC                         | 5% of rewards ([DefiLlama](https://defillama.com/protocol/autopilot)); minimum 400 veAERO                                              |
| Convex                | Vote-escrow aggregator                        | 17% of CRV rewards ([docs](https://docs.convexfinance.com/convexfinance/faq/fees.md))                                                  |
| Votium                | Vote incentives market                        | 2% of incentives, capped at 4% in the contract ([docs](https://docs.votium.app/faq/fees.md))                                           |
| Llama Airforce Union  | Compounds vote incentives                     | 2% of rewards plus a yield fee ([docs](https://docs.llama.airforce/the-union.md))                                                      |
| StakeDAO              | Liquid lockers                                | Performance fees at harvest; APR shown net ([docs](https://docs.stakedao.org/lockerfees.md))                                           |
| vfat / Sickle         | Per-user automation of farms and CL positions | 0.9–1.8% of rewards; rebalance 0.01–0.05% of the position ([docs](https://docs.vfat.io/fees/))                                         |
| Revert                | Auto-range, auto-exit, compounding            | 0.15% of the position or 2% of fees ([docs](https://docs.revert.finance/revert/auto-range.md))                                         |
| Arcadia               | Accounts with asset managers                  | 10% of yield ([docs](https://docs.arcadia.finance/protocol/asset-managers.md)); its fee table says 7.5% or 0%                          |
| Beefy CLM             | Pooled CL vaults                              | Up to 9.5% of trading fees, included in the APY ([docs](https://docs.beefy.finance/beefy-products/clm.md))                             |
| ICHI / Gamma          | Pooled CL vaults                              | 10% ([ICHI](https://docs.ichi.org/home/protocol-fees.md)); 14–20% ([Gamma](https://docs.gamma.xyz/gamma/lp-vaults/faq/using_gamma.md)) |
| Krystal               | Automations and vaults                        | Compound 2%; rebalance 0.01–0.05%; vaults 10% ([docs](https://docs.krystal.app/ecosystem/fees.md))                                     |
| DeFi Saver            | Lending automations                           | 0.05% per triggered action, plus gas; free to keep on ([docs](https://help.defisaver.com/features/automation/fees.md))                 |

On Base, by TVL ([DefiLlama](https://defillama.com/)): vfat $22.3M, Beefy $19.6M, Arcadia $5.9M, Steer $3.5M, Revert
$3.1M, ICHI $2.0M, Krystal $0.5M, Gamma $65k.

A fee of 2–10% of rewards is the norm for voting and compounding; around 10% of fees for managed liquidity. Carbon
Impact's third retired is far above both, which suits people who want the retirement and no one else; the next products
should sit in the norm, and say how they compare.

## Patterns worth copying

Each seen in at least one product above.

1. **One plain sentence per strategy,** for where the votes go and how it pays (Hydrex's cards).
2. **Group by who runs it:** "Relays run by the Protocol" and "by or for the Protocol Partners" (Aerodrome). Name the
   manager, with a one-line thesis (Morpho's
   [integrator rules](https://docs.morpho.org/developers/earn/vault-ux/best-practices)).
3. **"No automation" and "request a custom one"** next to the products (Hydrex).
4. **States that say when:** "earning from next epoch" (Hydrex), "Withdraw available after first epoch", "Relay Retired"
   (Aerodrome), a countdown to the next membership window (Llama Airforce).
5. **Consent to side effects** that cannot be undone, as a ticked box: the lock extension, forfeited compounding
   (Aerodrome).
6. **A payout ledger per account:** each payout in tokens and dollars, a total, the next payout (Hydrex, Autopilot).
7. **Freshness:** when it last ran and voted, with a warning when stale (Aerodrome's "latest update date").
8. **APR net of fees, split by component and token,** with a worked example of the fee (StakeDAO, Llama Airforce's 30% →
   29.4%, Morpho).
9. **One fee table:** rate, base, when, and the cap in the contract (vfat, Votium's 4% cap, Morpho's caps).
10. **Say when it will not run:** thresholds, gas limits, retries (vfat, Arcadia, Krystal).
11. **Admin powers and timelocks, in a list that leads with what fails** (Beefy's
    [risk checklist](https://beefy.com/articles/risk-checklist/), Morpho, Votium).
12. **Against a benchmark:** against holding, against voting by hand (Revert, Beefy).
13. **What the strategy ignores,** said plainly (Blackhole's auto-voting docs).
14. **A way out without the front-end:** an explorer guide, mirrors, a reproducible build (Revert, Gamma; metaDEX Café
    already has two of the three).
15. **A payout token per member** inside one product, instead of one product per token (Ramses AutoVaults).

## Patterns to avoid

1. **Fees that disagree** between pages (Hydrex's 1% and 0.5%; Arcadia's 10%, 7.5% and 0%).
2. **One APR for every automation** (Hydrex's 69%).
3. **Risk scores that contradict their own text,** or reassure more than they inform (Hydrex's strategy levels; Beefy
   replaced its Safety Score after "frustrations with a false sense of security").
4. **Broad approvals that linger, without a way to revoke them in the app,** and "non-custodial" for what is a deposit
   (Arcadia's $3.5M exploit of its asset managers in July 2025; Autopilot).
5. **Silent sunsets:** greyed-out cards with no reason, date or successor (Hydrex), against Aero's dated page.

## What people say

Thin: Reddit refused automated reads, so this comes from blogs, forums and post-mortems.

- On delegating veAERO to Autopilot: "it made me nervous signing over the voting rights to them", and "the support was
  fantastic"
  ([Skool, Nov 2025](https://www.skool.com/the-crypto-sabbatical-5837/questions-on-the-veaero-voting-process-using-theautopilotxyz)).
- On vfat: "the calmer interface to live in"; Krystal's "looks busier"
  ([dev.to](https://dev.to/seredasv/lp-automation-tools-compared-vfat-krystal-and-maxfi-lof)).
- After Arcadia's exploit, users were told to revoke asset managers
  ([The Block](https://www.theblock.co/post/362624/arcadia-hack)). Gamma paused deposits but kept withdrawals open after
  its own
  ([The Block](https://www.theblock.co/post/270338/defi-protocol-gamma-strategies-suffers-an-estimated-3-4-million-exploit)).
- The Aerodrome and Velodrome DNS hijacks in Nov 2025 drained users through a cloned front-end
  ([Blockaid](https://www.blockaid.io/blog/how-blockaids-customer-data-network-contained-the-aerodrome-dns-attack)): the
  case for the page's official address, hashes and reproducible build.

## Willingness to pay, elsewhere and before

Figures marked "scan" were computed from public RPCs and DefiLlama's API on 17 Oct 2026, reproducible but not audited.

- **Curve.** Convex holds 54.3% of veCRV, StakeDAO 15.2% and Yearn 10.7%: about 80% sits in wrappers (scan, Ethereum
  block 26,214,676, [veCRV](https://etherscan.io/address/0x5f3b5DfEb7B28CDbD7FAba78963EE202a494e2A2)). Convex keeps 17%
  of CRV rewards, with a ceiling of 20% in the contract
  ([fees](https://docs.convexfinance.com/convexfinance/faq/fees.md)); that brings it $13.0M a year on $576M of TVL, down
  from $21.2B in January 2022 ([DefiLlama](https://defillama.com/protocol/convex-finance)). Large holders accept about a
  sixth of their rewards for someone else to vote.
- **Balancer.** Aura held 74.7% of veBAL (scan). Balancer halted BAL emissions, ended veBAL's economic rights and voted
  on 29 Sep 2026 to wind down; its co-founder said veBAL had been "captured by meta-governance protocols and bribe
  markets"
  ([CoinDesk](https://www.coindesk.com/tech/2026/03/24/balancer-labs-will-shut-down-as-corporate-entity-became-a-liability-after-usd110-million-exploit),
  [Unchained](https://unchainedcrypto.com/balancer-is-shutting-down-with-payouts-estimated-at-about-16-cents-per-bal/)).
  Aura's TVL fell from $372M to $9.7M in a year ([DefiLlama](https://defillama.com/protocol/aura)): the protocol beneath
  an automation can end it.
- **Hydrex in August** (scan of 27 Aug 2026). 2,270 owners had delegated to one of the 14 automations, with 52–60M
  votes, 11–13% of the votes cast in August's epochs. Use fell with size: 56–82% of owners under $1,000, 63% at $1,000
  to $10,000, 36% at $10,000 to $100,000, one in eight at $100,000 to $1M, and the largest holder not at all. Votes cast
  were 94–99% of voting power from 30 Jul to 10 Sep, and 35–36% from 17 Sep.
- **Who stayed.** Of those 2,270 owners, 1,640 are still in automations that stopped. Their median holding is about $3;
  208 hold $100 or more, 39 hold $1,000 or more (scan). Defaults are sticky elsewhere too
  ([NBER w7682](https://www.nber.org/papers/w7682)).
- **Aerodrome in August** (scan of 23 Aug 2026). 75 relays held 55.8% of voting power. Four addresses had put all 441M
  of their votes in relays; without them, relays held about 13% of the rest. 7,357 of 45,307 owners (16%) used a relay,
  and 22–35% of owners holding $10,000 to $100,000.
- **Vaults and liquidity tools.** Beefy takes up to 9.5% and shows APY net of it; its TVL is $110M, from $290M a year
  earlier, and it took $1.30M in fees over the year ([DefiLlama](https://defillama.com/protocol/beefy)). Yearn's factory
  vaults take 10% and show net APY ([docs](https://docs.yearn.fi/getting-started/products/yvaults/overview)). vfat holds
  $36.4M across chains, from $116.7M in August 2025, and earns $1.15M a year; its audit notes that admins can change its
  fees ([DefiLlama](https://defillama.com/protocol/vfat.io),
  [Ackee](https://ackee.xyz/blog/vfat-farm-strategies-audit-summary/)). Arrakis Modular's managers keep about 49% of
  gross trading fees ([DefiLlama](https://defillama.com/protocol/arrakis-modular)).
- **The share of liquidity that managers hold** on Uniswap v3: no current figure was found. Arrakis claimed over 10% in
  June 2023 ([forum](https://gov.uniswap.org/t/rfc-arrakis-finance-liquidity-mining-for-uniswap-v3-via-arrakis/21367));
  its $61M today is under 4% of Uniswap v3's $1.58B. Gamma fell from $128M to $2.9M after its exploit on 3 Jan 2024
  ([DefiLlama](https://defillama.com/protocol/gamma)).

## Concentrated liquidity: what a manager can promise

- In 17 Uniswap v3 pools holding 43% of its TVL in 2021, liquidity providers earned $199.3M in fees and lost $260.1M to
  impermanent loss: $60.8M worse than holding. Bancor commissioned the study
  ([arXiv](https://arxiv.org/abs/2111.09192)).
- On Base's WETH/USD pools across Uniswap, Aerodrome, PancakeSwap and SushiSwap, about one provider in six avoids losses
  ([Urusov et al., April 2026](https://arxiv.org/abs/2604.22069)).
- Passive providers do worse than pool-level figures suggest; the gap is smaller on L2s, and they do better in pools
  with higher fees ([Sadeghi, Moallemi et al., September 2026](https://arxiv.org/abs/2609.37963)).
- In Uniswap v3's USDC/ETH 0.05% pool over 2023–24, even the best range earned less than holding; a full range did best,
  narrow ranges worst ([arXiv](https://arxiv.org/pdf/2504.16542)).
- Over 99.99% of the variance in returns of Uniswap v2's ETH/USDC providers comes from market exposure; fees less losses
  to arbitrageurs (LVR) are the part a manager controls ([arXiv](https://arxiv.org/abs/2208.06046)).
- Just-in-time liquidity touched $750bn of Uniswap v3's liquidity events in 2023
  ([Kaiko](https://research.kaiko.com/insights/jit-2)), and can cut a passive provider's profit on a trade by up to 44%
  ([AFT 2025](https://drops.dagstuhl.de/entities/document/10.4230/LIPIcs.AFT.2025.8)).
- Managers' yields are not comparable across measures; about half of Gamma's came from incentives, and some Mellow
  vaults were negative ([Gauntlet](https://www.gauntlet.xyz/resources/uniswap-alm-analysis)).

So a manager can promise a process, not an outcome. Report the result against holding and against a full range, net of
its fee and of gas, with fees and incentives apart, as Beefy's "CLM vs Hold" begins to
([docs](https://docs.beefy.finance/beefy-products/clm)).

## Trust and safety

- **Previews are standard in wallets:** Coinbase Wallet since 2023
  ([The Block](https://www.theblock.co/post/206684/coinbase-wallet-shows-transaction-previews-to-protect-against-nft-scams)),
  MetaMask with Blockaid alerts on by default
  ([support](https://support.metamask.io/configure/wallet/how-to-turn-on-security-alerts)), Phantom with Blowfish
  ([blog](https://phantom.com/learn/blog/phantom-acquires-blowfish)). The Ethereum Foundation's Clear Signing standard,
  ERC-7730, lets wallets describe a call in plain words from metadata the dapp publishes
  ([CoinDesk, May 2026](https://www.coindesk.com/tech/2026/05/12/the-ethereum-foundation-unveils-new-clear-signing-standard-to-stop-users-from-approving-malicious-crypto-transactions)).
- **Plain words help.** Users misread signing parameters, and decoding what a transaction does in plain language raised
  how many risky ones 128 participants caught ([arXiv, January 2026](https://arxiv.org/abs/2601.16751)). DeFi users put
  profit before security, and victims rarely change their practices
  ([USENIX Security 2024](https://arxiv.org/abs/2406.15709)); they handle risk by avoiding it, spreading it or accepting
  it ([CHI 2024](https://eprint.iacr.org/2024/271)). Audit information is hard for users to find
  ([NDSS 2025](https://www.ndss-symposium.org/ndss-paper/exploring-user-perceptions-of-security-auditing-in-the-web3-ecosystem)).
- **Phishing** took $83.85M from 106,000 victims in 2025, down 83%; Permit and Permit2 signatures caused 38% of losses
  in cases over $1M, and malicious EIP-7702 batch signatures $2.54M
  ([Scam Sniffer](https://drops.scamsniffer.io/scam-sniffer-2025-crypto-phishing-losses-fall-83-to-84-million/)). The
  page asks for transactions, never for signatures, and should keep it so.
- **Front-ends get hijacked.** Bybit's $1.4–1.5B loss came from malicious JavaScript served by Safe{Wallet}'s front end
  ([NCC Group](https://www.nccgroup.com/research/in-depth-technical-analysis-of-the-bybit-hack/)). The defences are
  those the page has: published hashes, a reproducible build, the official address; mirrors would add one.
- **Revocation.** revoke.cash counts over 2M users and 20M approvals revoked, and revokes in batches with EIP-7702
  ([year in review](https://revoke.cash/blog/2025/year-in-review)). Leaving is a revocation: it belongs next to Join.
- **Centralisation.** DeFiScan grades protocols in stages modelled on L2BEAT's: Stage 0 while an operator controls it;
  Stage 1 needs an exit window of at least 7 days, or a security council of at least 7 signers, a threshold of at least
  50% and a majority of outsiders, and a backup interface
  ([DeFi Collective](https://deficollective.org/blog/introducing-defiscan)). Convex names the signers of its 3-of-5
  multisig and hard-codes its fee ranges
  ([docs](https://docs.convexfinance.com/convexfinance/faq/multisig-admin-rights.md)).
- **Batching.** EIP-5792 is final since May 2025; 8 of 21 wallets support it, among them MetaMask, Safe and the Base
  app; Rabby, Zerion and Phantom do not ([walletbeat](https://beta.walletbeat.eth.limo/wallet/eip/5792/)).
- **Automation psychology.** People drop an algorithm after seeing it err
  ([Dietvorst et al. 2015](https://faculty.wharton.upenn.edu/wp-content/uploads/2016/11/20-Dietvorst-Simmons-Massey-2015.pdf)),
  and keep using an imperfect one they can adjust a little
  ([Dietvorst et al. 2018](https://ideas.repec.org/a/inm/ormnsc/v64y2018i3p1155-1170.html)). Hydrex's stop is the first;
  letting owners pick the payout token or the share retired is the second.

## Disclosure: what regulators ask elsewhere

Not binding on a page that holds nothing for anyone, but a guide to presenting fees fairly. Some points rest on
secondary sources, as marked.

- **EU, MiCA:** information "fair, clear and not misleading", and fee policies "in a prominent place"
  ([Art. 66](https://www.springlex.eu/en/packages/mica/mica-regulation/article-66/)). "Fully decentralised" services are
  outside it, but that scope is unsettled ([PwC](https://legal.pwc.de/en/news/articles/demystifying-defi-in-micar)).
- **EU, MiFID II:** costs as an amount of money and as a percentage, an illustration of their cumulative effect on
  return, and a personal statement afterwards
  ([Delegated Regulation 2017/565](https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:32017R0565)).
- **US, SEC:** net performance next to gross, with at least equal prominence and over the same period
  ([17 CFR 275.206(4)-1](<https://www.law.cornell.edu/cfr/text/17/275.206(4)-1>)); fund fee tables with a $10,000
  example over 1, 3, 5 and 10 years ([Form N-1A](https://www.sec.gov/about/forms/formn-1a.pdf)).
- **UK, FCA:** final rules for cryptoassets published on 30 Jun 2026, in force from 25 Oct 2027, with the Consumer Duty
  applying, and DeFi in scope "where there is an identifiable controlling entity"
  ([FCA](https://www.fca.org.uk/publications/policy-statements/cryptoasset-regime)).
- **Carbon claims:** from 27 Sep 2026, the EU bans consumer claims that a product is carbon neutral because of offsets
  ([summary](https://nexioprojects.com/ecgt-green-claims-directive-what-changes-on-27-september-2026/)); companies
  reporting under the ESRS report credits apart, not netted (secondary:
  [regreener](https://www.regreener.earth/blog/carbon-credits-csrd-reporting)). Klima 2.0, live since 24 Feb 2026,
  requires identity verification through zk.me
  ([Klima](https://www.klimaprotocol.com/blog/klima-2-protocol-announcement)), and older criticism of tokenised credits
  still colours how buyers see them ([CarbonPlan, 2022](https://carbonplan.org/research/toucan-crypto-offsets)).

## Alerts and exports without a server

- **These need a server or a key:** Base mini-app notifications, a webhook server and stored tokens
  ([docs](https://docs.base.org/mini-apps/core-concepts/notifications)); XMTP agents, a running process with a wallet
  key ([docs](https://docs.xmtp.org/agents/get-started/build-an-agent)); Telegram bots
  ([API](https://core.telegram.org/bots/api)).
- **These do not:** a calendar file with a weekly rule for Thursday, 00:00 UTC
  ([RFC 5545](https://www.rfc-editor.org/rfc/rfc5545)); Basescan's Watch List, which e-mails the activity of up to 50
  addresses, such as a payout address ([Basescan](https://info.basescan.org/mywatchlist/)); an Atom feed of settings
  changes, built by CI and published beside the page ([RFC 4287](https://www.rfc-editor.org/rfc/rfc4287)).
- **Exports:** Koinly's universal CSV takes Date (UTC), Sent and Received Amount and Currency, Fee, Net Worth, a Tag
  such as "reward", a Description and the TxHash
  ([Koinly](https://intercom.help/koinly/en/articles/9489976-how-to-create-a-custom-csv-file-with-your-data)).
  CoinTracker's has eight fixed columns and dates as MM/DD/YYYY (from a search summary, not checked). In-app browsers on
  iOS download files only if the host app supports it ([WWDC21](https://www.wwdcnotes.com/notes/wwdc21/10032)): offer to
  copy as well.

## Personas

The evidence behind each persona in the [README](README.md#who-would-pay-and-for-what), and what would show it wrong. No
survey of veNFT holders was found, so sizes come from on-chain data alone, for the accounts that still exist, at today's
prices. For context: 716M people hold crypto, 40–70M of them active each month
([a16z, 2025](https://a16zcrypto.com/posts/article/state-of-crypto-report-2025/)), and security (77%) and ease of use
(74%) led the choice of wallet in an 18,000-person survey
([Consensys and YouGov](https://consensys.com/blog/global-survey-on-crypto-and-web3-press-release-2024)).

### The stranded holder

- 1,640 owners still have an account in a Hydrex automation that stopped on 9 Sep: what remains of the 2,270 who used
  one in August. Their median holding is about $3; 208 hold $100 or more, 39 hold $1,000 or more.
- Hydrex's app greys out their automation and tells them to switch to "No Automation", with no reason or date.
- A change costs about $0.004 in gas (287,000 gas at 0.006 gwei, on 17 Oct). At Carbon Impact's rate last epoch, 1,000
  Earning Power earned about $0.59 a week. What they lack is a reason to come back, and one clear thing to do.
- **Shown wrong if** few of them act once told: then their attention, not the choice, is the limit, and look-up and
  batching matter more than comparison.

### The hands-off holder

- Hydrex Lock Maxi, which added rewards to the lock, drew the most accounts and votes in August (scan). 6,170 owners put
  locks in veAERO Maxi, a public compounder, accepting a four-year re-lock.
- On Aerodrome, 22–35% of owners holding $10,000 to $100,000 used a relay in August.
- They pay what comparable products charge: Convex 17% of rewards, Beefy up to 9.5%, Autopilot 5%, Revert 2% of
  compounded fees (a 2022 figure), Hydrex 0.5–1%.
- **Shown wrong if** they choose by headline APR rather than by payout token and fee, in tests of the menu.

### The optimiser

- Only about 8% of Hydrex owners holding $10,000 to $100,000 are in an automation today (scan).
- On Base, vfat holds $22.3M and Beefy $19.6M: people pay for managed farming and liquidity.
- They judge by profit against holding, with divergence loss as its own line (Revert), and praise calm interfaces
  (vfat).
- **Shown wrong if** they will not join without a projected APR, which this proposal declines to show for products
  without a record.

### The treasury

- Ten owners hold 72% of Hydrex's votes; the largest, a 2-of-3 Safe, holds 59.6% and last voted on 16 Sep.
- On Aerodrome, foundation relays with two or three owners each hold about 40% of veAERO, partner relays are a category
  of their own, and Moonwell and KlimaDAO are among the largest lockers, locking for their own liquidity
  ([4pillars, March 2026](https://research.4pillars.io/en/research/aero-thesis-base-s-cash-cow-coinbase-s-golden-child)).
- Safe secures $35.25B in 61.1M accounts ([Safe](https://safefoundation.org/blog/safe-q1-2026-quarterly-report)); after
  Bybit, its users check the calldata and the front end they sign from.
- **Shown wrong if** treasuries need to direct their own votes, which a shared automation cannot do: then the product is
  a custom relay, and the page is its window.

### The impact holder

- Carbon Impact's 11 owners give a third of their rewards to retirements; Klima's two Aerodrome relays hold 705 and 104
  veAERO.
- Its retirements carry the name "Hydrex" and no beneficiary, so members get no attribution of their own.
- Since 27 Sep 2026 the EU bans "carbon neutral" claims based on offsets, and companies report credits apart: the case
  rests on retirements that are each traceable, and on words that claim no more.
- **Shown wrong if** members leave when the share retired is shown in tonnes and dollars, beside what reaches them.

### The liquidity provider

- 42,923 Slipstream positions are staked in Aerodrome's gauges; Hydrex lists 293 ICHI vaults and 251 manual strategies.
- Aero tells users to withdraw from Aerodrome's liquidity managers, which "will not move automatically", and says "The
  current ALM solution is winding down": many will need a manager after 22 Oct.
- On Base's WETH/USD pools, about one provider in six avoids losses.
- **Shown wrong if** they prefer pooled vaults with a single token in, over managers that leave the position in their
  wallet.

### On a phone

- Coinbase Wallet, called the Base app from July 2025, comes with a smart wallet and supports EIP-5792 atomic batches.
  In July 2026 it dropped social for trading, payments and agents
  ([Cryptopolitan](https://www.cryptopolitan.com/coinbase-admit-trust-gap-base-faces-backlash/)), and on 10 Sep 2026 it
  took back the name Coinbase Wallet
  ([The Block](https://theblock.co/news/defi/2026-09-10-coinbase-rebrands-base-app-back-to-coinbase-wallet-after-just-over-a-year-as-social-experiment-falls-short-414115)).
- Downloads may not work in its browser on iOS: everything the page makes should be readable on screen, and copyable.
