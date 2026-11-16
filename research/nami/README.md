# Nami: due diligence

Research on [Nami](https://nami.fi) ([github.com/namifi/Nami-Protocol](https://github.com/namifi/Nami-Protocol)), a new
DEX on Ethereum, Base and Robinhood Chain that calls its token model "d(3,3)". Everything here was read on 16 November
2026, during Nami's launch phase and ten days before its first emission. It is separate from the metaDEX Café page.

This is not investment advice, and it is not a security audit.

## Verdict

**Nami is a real, working, audited protocol whose economics are, for now, entirely in its team's hands, and its team is
anonymous with a failed token behind it.** The contracts are verified and match the documentation closely. But one
multisig holds 99.87% of the votes, sets emissions at will, and settles rewards through a single keeper. The first
emission, which decides how fast NAMI dilutes, has not been set. I would treat anything put into Nami before that number
and the team's voting policy are public as a bet on the team's restraint.

## The three questions

### Who made it?

Nami Labs Inc., a British Virgin Islands company. No person is named.

On-chain, Nami's deployer was funded by the wallet that owns `swapx.eth` and that deployed the vote-escrow
implementation of **SwapX**, an Algebra-based ve(3,3) DEX on Sonic. SwapX's own account promotes Nami, and Nami sets
aside 3.33% of its launch allocation for SwapX lockers. So at least one SwapX core developer deployed Nami, and the two
projects are openly linked. Neither names its people.

SwapX's token is down 99.9% from its high, and its TVL is down 99.5%. Details:
[`01-who-is-behind.md`](01-who-is-behind.md).

### What are its tokenomics?

| Token   | What it is                                                                                    |
| ------- | --------------------------------------------------------------------------------------------- |
| NAMI    | The emissions token. 1.2M at genesis, no cap, no schedule                                     |
| veNAMI  | A locked position that votes. Timed for up to 26 weeks, or permanent, which burns the NAMI    |
| wveNAMI | An ERC-20 share of a pooled permanent lock. Providers get at least 20% of their rewards in it |
| ogNAMI  | A separate presale token, 250,000 fixed, that earns 10% of the swap fees of gauged pools      |

- **Supply.** 80% of the 1.2M NAMI is already burned into permanent locks. The split on-chain matches the docs.
- **Distribution.** 70% of the launch allocation is in buckets the team controls, with no vesting or voting policy
  stated. Today a 4-of-7 multisig holds 963,997 of the 965,278 veNAMI.
- **Emissions.** The docs describe a model that moves emissions by at most +10% or −25% a week according to fees and
  price. The contract enforces none of that. It lets the multisig set the first week up to 1.4M NAMI and multiply by
  0.05 to 2 every week after, with no delay.
- **Fees.** On pools with a gauge, 90% of swap fees go to voters and 10% to ogNAMI stakers. Liquidity providers there
  earn emissions only. Other protocol income buys NAMI and locks it in a protocol-owned position that also votes.
- **Presale.** ogNAMI sold 86,500 of 200,000 at $10: 865,000 USDC from 405 wallets. The unsold half of the supply sits
  in a team multisig with no stated plan.
- **Price.** NAMI trades near $7.86, set by about $124,000 of net buying.

Details: [`02-tokenomics.md`](02-tokenomics.md).

### How does it compare with Aerodrome, Aero and Hydrex?

|                           | Nami                                | Aerodrome                     | Aero                                           | Hydrex                            |
| ------------------------- | ----------------------------------- | ----------------------------- | ---------------------------------------------- | --------------------------------- |
| Team                      | Unnamed; linked to SwapX            | Dromos Labs, named executives | Dromos Labs, named executives                  | One named co-founder              |
| TVL                       | $0.51M                              | $109M, emissions stopped      | $177M                                          | $2.84M                            |
| Chains                    | Ethereum, Base, Robinhood Chain     | Base                          | Base and 7 others, including those two         | Base                              |
| Emissions                 | Set weekly by a team multisig       | Fixed curve, then a tail      | Per-second ceiling, capped per pool by revenue | Formula, then a holder-voted tail |
| Longest timed lock        | 26 weeks                            | 4 years                       | 4 years                                        | 2 years                           |
| Permanent lock            | Burns the token                     | Reversible                    | Reversible, with a 4-year wait                 | Burns the token                   |
| Swap fees to voters       | 90%                                 | 100%                          | 100%                                           | 98.5%                             |
| Rewards to providers      | NAMI, with 20% or more force-locked | AERO                          | AERO                                           | An option on HYDX                 |
| Upgradeable               | Yes, 24-hour delay                  | No                            | No                                             | Yes, 24-hour delay                |
| Votes counted             | Off-chain, by a keeper              | On-chain                      | On-chain                                       | On-chain                          |
| Team-side share of votes  | 99.87%                              | About 56% at launch           | Not quantified                                 | 59%, idle                         |
| Audits                    | BailSec                             | Spearbit, ChainSecurity       | ChainSecurity, Sherlock, a contest             | Sherlock, Paladin                 |
| Sold tokens to the public | Yes, ogNAMI                         | No                            | No                                             | No                                |

Nami is closest to Hydrex in how it is built: Algebra pools, permanent locks that burn the token, rewards that push
providers toward locking, Merkle roots, a treasury that starts with most of the votes. It is closest to Aero in what it
wants: emissions tied to revenue, and one position that directs emissions on several chains. It runs with more
discretion and less distribution than either. Aero already operates on all three of Nami's chains with about 350 times
the liquidity.

Details, in seven tables: [`03-comparison.md`](03-comparison.md).

## What would change the verdict

Each of these is checkable, most of them on-chain with [`scripts/verify.sh`](scripts/verify.sh):

1. **The first emission is modest.** For scale, last week's fees were worth about 3,800 NAMI. `Minter.weekly()` will
   show the number once `initialWeeklySet` is true.
2. **The team's veNAMI does not farm the fees.** Either it abstains, as Hydrex's treasury does, or the team publishes
   how each bucket votes and when it is distributed.
3. **The Minter moves behind a timelock**, and the settlement gains more than one disputer and more than one hour.
4. **The unsold ogNAMI is burned or locked** under a published rule.
5. **Someone is named**, or the multisig gains signers who are.
6. **Liquidity and volume hold after 26 November**, when launch points end and emissions begin.

## Files

| File                                                             | Content                                                                                  |
| ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| [`01-who-is-behind.md`](01-who-is-behind.md)                     | The company, the handles, the on-chain trail to SwapX, and SwapX's record                |
| [`02-tokenomics.md`](02-tokenomics.md)                           | Supply, allocation, emissions in docs and in code, locks, fees, the presale, the launch  |
| [`03-comparison.md`](03-comparison.md)                           | Nami against Aerodrome, Aero and Hydrex, topic by topic                                  |
| [`04-risks.md`](04-risks.md)                                     | Who controls what, 14 risks, strengths, questions for the team, and what was not checked |
| [`evidence/onchain-snapshot.txt`](evidence/onchain-snapshot.txt) | The raw on-chain readings behind the Nami figures                                        |
| [`evidence/sources.md`](evidence/sources.md)                     | Every source, with its caveats, and the key transactions                                 |
| [`evidence/aero-facts.md`](evidence/aero-facts.md)               | Sourced fact sheet on Aerodrome and Aero                                                 |
| [`evidence/hydrex-facts.md`](evidence/hydrex-facts.md)           | Sourced fact sheet on Hydrex                                                             |
| [`scripts/verify.sh`](scripts/verify.sh)                         | Re-reads every Nami on-chain fact with `cast`. Read-only                                 |
| [`scripts/token-holders.py`](scripts/token-holders.py)           | Rebuilds a token's holders on Base from its `Transfer` logs                              |

To rerun the checks, with Foundry installed:

```sh
BASE_RPC_URL=https://mainnet.base.org research/nami/scripts/verify.sh
```

## How far to trust this

- **Solid:** anything marked on-chain or code. I read it myself and the script reads it again.
- **Good:** what Nami's docs and terms say. They are Nami's claims, quoted as such, and where I could test them on-chain
  they held.
- **Weaker:** social-media content, which I could only see through search excerpts; third-party articles, whose
  sponsorship is unknown; and DefiLlama figures for a protocol eleven days old.
- **Not done:** I did not run Nami's code, review it for bugs, or read its Discord, Telegram or X. See the end of
  [`04-risks.md`](04-risks.md).
