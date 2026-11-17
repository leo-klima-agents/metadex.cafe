# Risks, strengths and open questions

This file lists what could go wrong with Nami, what it does well, and what to ask the team. It assumes you have read
`01-who-is-behind.md` and `02-tokenomics.md`. Addresses and raw readings are in `evidence/onchain-snapshot.txt`.

## Who controls what

Every admin power traces back to one 4-of-7 Safe with seven undisclosed signers. The same seven addresses sign the Safes
on Ethereum and on Base. All of this is read on-chain, on the Ethereum hub.

| Power                                                        | Holder                              | Delay    |
| ------------------------------------------------------------ | ----------------------------------- | -------- |
| Set the first emission and change it each week               | 4-of-7 Safe, as owner of the Minter | None     |
| Set the rebase and lock-bonus rates                          | 4-of-7 Safe                         | None     |
| Post, approve or replace the weekly settlement root          | 4-of-7 Safe, as root manager        | None     |
| Raise the NAMI bridge mint limits                            | 4-of-7 Safe                         | None     |
| Vote with 99.87% of veNAMI                                   | 4-of-7 Safe, as owner of veNAMI #2  | None     |
| Upgrade the Minter, Claimer, bridge router and other proxies | 1-day timelock, driven by the Safe  | 24 hours |
| Replace the NAMI minter, grant the bridge operator role      | 1-day timelock, driven by the Safe  | 24 hours |
| Own the veNAMI and Voter diamonds, administer VoterRewards   | 1-day timelock, driven by the Safe  | 24 hours |

The docs' contract page lists one timelock per chain, "NamiTimelock", which has a 3-day delay. None of the 20 hub
contracts I checked is owned or administered by it. The timelock that does own them has a 1-day delay and is not on that
page.

The NAMI token contract itself is not upgradeable, and its genesis supply is a constant. But its admin can appoint a new
minter after 24 hours, and a minter can mint without limit. So four signers, given a day, can inflate NAMI. That is
normal for a young protocol and it is the single most important trust assumption here.

## Risks

### 1. The team is anonymous, and its previous token lost almost all its value

Nobody is named. The operating company is in the British Virgin Islands, and the code's licensor is a foundation with no
public footprint. On-chain evidence ties the deployment to SwapX, whose token SWPx is down about 99.9% from its high and
whose TVL is down 99.5%. See `01-who-is-behind.md`.

### 2. One multisig holds 99.87% of the votes

The Safe holds 963,997 of the 965,278 veNAMI that exist. Under the published allocation, 820,000 veNAMI (85%) stays in
buckets the team controls: Incentives, Protocol Reserve, Ecosystem Partners, Blockchain Foundations and the buyback
engine. The docs give no vesting and no voting policy for them, except that the buyback engine's position votes.

Voters earn 90% of gauged pools' fees and all bribes. If these positions vote, they take most of that income and they
decide where emissions go. A protocol that bribes for votes on Nami would be paying mostly the team's positions.

### 3. Emissions are discretionary, and the first one is still unknown

The "d(3,3)" rules are a policy the team applies, not code. The contract lets the Safe set the first weekly emission
anywhere up to 1.4M NAMI, more than the genesis supply, and then multiply it by anything from 0.05 to 2 every week, with
no timelock. The first emission will be set around 26 November 2026. Until then NAMI's dilution cannot be estimated.

### 4. A single keeper settles emissions and voter rewards off-chain

Votes are recorded on each chain, but no contract adds them up. A keeper computes each epoch's split of emissions across
chains and gauges, and each voter's share of fees and bribes, and posts Merkle roots. The docs call this "optimistic":
it is correct only if someone checks every root in time.

On-chain today there is one keeper address, one disputer address, a review threshold of one, and a dispute window of one
hour, the shortest the contract allows. The Safe can also post or approve a root at once. A wrong root, by mistake or on
purpose, would misdirect a week of emissions or of voter income. BailSec's audit calls the root "a trust boundary
between off-chain root construction and on-chain settlement".

### 5. Everything else is upgradeable on 24 hours' notice

The Minter, the emissions contracts, the Claimer, the rewards contracts, the bridge routers and the gauges (through one
beacon) are proxies. veNAMI and the Voter are diamonds whose facets can be swapped. The delay is 24 hours. Holders of a
permanent lock cannot exit in 24 hours: their NAMI is burned.

### 6. Permanent locks have no exit but a market the team can switch off

A permanent lock burns the NAMI. The holder can only sell the NFT or wrap it into wveNAMI and sell that. wveNAMI has an
owner-managed blocklist of receiving addresses, "kept to disable secondary markets if needed". Liquidity providers
receive at least 20% of their rewards in this form.

### 7. Half of ogNAMI sits unsold in a team Safe

The presale sold 43% of its target. 124,850 ogNAMI, half the supply, is in a 4-of-7 team Safe with no stated plan.
Staked, it would take about 59% of the fee share that presale buyers were sold. Sold, it would be more supply than the
presale placed.

### 8. Valuation rests on thin trading

NAMI trades at about $7.86, which values 1.2M NAMI at about $9.4M. The pool that sets this price has taken in about
$124,000 of ETH. The presale's 43% fill is the better signal of demand at these prices.

### 9. Launch-phase numbers flatter the protocol

Volume over the last week was $20.9M on $0.5M of TVL, about six times TVL every day. Genesis pays points for in-range
liquidity and lets providers trade fees for points, which invites wash trading. Expect volume and fees to fall when
points end on 26 November.

### 10. The audit is real but single-source, and I cannot match it to the deployment

BailSec's core audit (September 2026) lists 173 findings: 5 high, all resolved; 25 medium, 10 of them acknowledged
without a change; 102 low, 75 acknowledged and 3 left open; 2 governance findings, acknowledged. BailSec also audited
the presale, the Batcher, the farming module and the MEV-X integration.

Three caveats. All reports are from one firm; the docs speak of "two independent teams" without naming a second. The
audited repository is private, and the core contracts were deployed on 11 October, a month after the report, so I cannot
check that what runs is what was audited. And the lending and automation modules have no published audit yet.

### 11. It launched on three chains at once, with many moving parts

Chainlink CCIP carries NAMI, positions and settlement messages between Ethereum, Base and Robinhood Chain. A fault on
the bridge path is bounded by rate limits, which the Safe sets. Robinhood Chain is itself only a few months old.

### 12. It competes with Aero on all three chains

Aero has about $147M of TVL on Base, $11.5M on Ethereum and $3.9M on Robinhood Chain, and legacy Aerodrome holds another
$109M on Base. Nami has $0.5M in total. Nami's liquidity providers earn no swap fees on gauged pools, so its liquidity
lasts only as long as its emissions are worth more than what Aero and Uniswap pay.

### 13. Legal and access risk

The Terms bar persons in the United States, the European Union, the European Economic Area and the United Kingdom from
the interfaces. ogNAMI pays a share of revenue in USDC, which is the kind of feature securities regulators look at; a
third-party review raised the same point. `nami.fi` was flagged as malicious by Blockaid in September 2026.

### 14. The public repository shows only a small part of the code

`namifi/Nami-Protocol` contains the Batcher (the swap account) and prose descriptions of the rest. Its README says
modules are published "as they go live", but the core has been live since October and is not there. The full source is
verified on Etherscan, which is what I read.

## Strengths

- **The code is verifiable.** Every core contract I looked up is verified on Etherscan with its whole source tree. The
  Batcher files in the public repository are byte-identical to the verified ones.
- **Supply matches the docs to the token.** Liquid NAMI plus burned-into-veNAMI across three chains is exactly
  1,200,000, split 234,722 to 965,278 against a documented 236,000 to 964,000. The difference is what users have locked.
- **No emissions go to the team.** The Minter mints for three destinations only. SwapX's minter, by contrast, has a team
  rate of 3%.
- **Better key hygiene than SwapX.** A 4-of-7 Safe and timelocks, against SwapX's 2-of-6 Safe. Ownership of the main
  contracts cannot be renounced by accident.
- **The token is not a proxy.** NAMI's logic cannot be changed; only its minter can be replaced.
- **Bridge mints are rate-limited**, with a separate lane for protocol traffic.
- **The repository's own docs are candid.** Each module's page ends with "trust notes" that state most of the powers
  listed above.
- **Presale money moved on-chain**, through a verified contract with per-buyer vaults.
- **The design is thoughtful.** Tying emissions to fees per dollar emitted, paying part of rewards as locks, and letting
  one lock vote across chains each answer a real weakness of earlier ve(3,3) systems.

## Questions for the team

1. Who are the founders, and what is the relationship between Nami Labs Inc., North Bay Foundation and SwapX?
2. Who are the seven signers? Is any independent of the team?
3. Will the Safe's veNAMI vote before it is distributed? How will the Incentives, Reserve, Partners and Foundations
   buckets vote, and on what schedule are they distributed?
4. What will the first weekly emission be, and will the Minter be moved behind a timelock?
5. What happens to the 124,850 unsold ogNAMI?
6. Who runs the keeper and the disputer? When will the review threshold rise above one and the window above one hour?
7. Is the deployed code the audited commit `99ef66b`? Will the core repository be published?
8. Which firm was the second audit team?
9. What does the 3-day "NamiTimelock" control, and why is the 1-day timelock that owns the contracts not documented?
10. What is the plan for SwapX and for SWPx holders beyond the 40,000 veNAMI airdrop?

## What I did not do

- I did not build or run Nami's code. I read the verified source and compared the public repository's files to it.
- I did not read X, Discord or Telegram, which is where a team usually answers the questions above.
- I did not review the contracts for bugs. This is a review of who, what and how much, not a security audit.
- I did not trace the keeper's history on Base or the Robinhood Chain deployment in detail. Admin keys were read on the
  Ethereum hub; on Base and Robinhood Chain I checked only the veNAMI owner, which is a 1-day timelock there too.
