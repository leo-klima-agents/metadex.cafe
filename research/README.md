# Is a stake's APR skill or noise?

This directory checks, for every Aero stake (sAERO NFT) on Base, whether it earned more than chance would give, and
splits the answer in two:

- **Selection**: given the hours at which it moved, did it pick better pools than the crowd would have?
- **Timing**: given the pools it moved between, did it move at better hours than it could have at random?

These are the simplest tests that separate the two. Each tests one part while holding the other part fixed at what the
stake actually did. Neither test assumes a distribution for yields, so lumpy fees, persistent pools and concentrated
stakes don't make the result look more significant than it is.

## Running it

```bash
node research/fetch-allocations.ts   # every GaugesAllocated event since launch (publicnode, ~2 minutes)
node research/fetch-gauges.ts        # each gauge's rewards manager at every hour since launch (~2 minutes)
node research/fetch-stakes.ts        # which stakes are still staked
node research/analyze.ts             # writes results/summary.md and results/strategies.csv (~4 minutes)
node research/validate.ts            # compares rebuilt yields with the site's own APR code
```

The fetch scripts write to `data/`, which is not committed. `analyze.ts` uses a seeded random generator, so the same
data gives the same results.

## Data

- **Allocations.** Every `GaugesAllocated(tokenId, (gauge, allocated, data)[], …)` event of the LeafVoter. Each event
  replaces the stake's whole allocation on Base. Allocations within one hour are merged, the last one counting. A stake
  that was withdrawn loses its allocation with no event, so its last spell is dropped.
- **What each pool paid.** Each gauge's rewards manager keeps its fees per unit of power, and the integral of 1 / power,
  at every checkpoint. Reading both at every hour gives `Y[g][k]`, what one sAERO in gauge `g` earned from launch to
  hour `k`, fees and incentive programs together. `validate.ts` checks this against the site's own APR code: they agree
  to about 1% on the largest pools.
- **Prices.** Today's prices, one per token, for the whole period. Only the comparisons made over the same hours matter,
  so one snapshot removes price noise without biasing them. Tokens without a price count as 0 for everyone. They are
  0.1% of power.
- **Strategies.** Stakes that allocate at the same hours, to the same pools, in the same shares are one strategy, tested
  once. Otherwise, a manager running 50 identical stakes would count as 50 independent pieces of evidence.

## The model

A strategy's history is a list of **spells**. A spell runs from one allocation to the next, with fixed weights `w_g`
over pools. A spell from hour `a` to hour `b` earns `Σ_g w_g (Y[g][b] − Y[g][a])` per sAERO.

### Selection

The null hypothesis is that the strategy picks pools the way the rest of the crowd does. Each **placebo** moves at the
strategy's own hours, with the same number of pools and the same weights. Its pools are drawn at random, in proportion
to the other stakes' power at that hour. The test then asks how often a placebo earns as much as the strategy did over
all its spells. That fraction is the p-value.

- A placebo **keeps its pool** for as long as the strategy keeps the pool it stands for, and draws a new one only when
  the strategy changes pools. A stake that held one pool for four weeks made one decision, and the placebo makes one
  too. This keeps the persistence of pool yields from inflating significance.
- A placebo holds the same amount of sAERO as the strategy, and that **dilutes** the pool it drew, just as the
  strategy's own power diluted its real pools. Without this, small pools look free to a placebo, and a whale is compared
  with placebos that pay no price for its size.
- Only strategies of at least 100 sAERO and 96 hours in pools are tested. A dust stake that is alone in an empty pool
  earns all of that pool's fees, at APRs in the billions of percent.
- As a robustness check, the crowd is also defined as **stakes rather than sAERO**: pools are drawn in proportion to how
  many stakes are in them.

### Timing

The null hypothesis is that a move from pools `P` to pools `Q` is equally likely at any hour the stake could have moved
at. The **feasible window** runs from the end of the 47-hour lock after the previous allocation to 47 hours before the
next allocation, so that moving at any hour in it would have kept the stake's other moves possible. For each hour `x` in
that window, `E(x)` is what one sAERO would have earned over the window by staying in `P` until `x` and then holding
`Q`. Pool power is counted without the stake's own, with its amounts added back in whichever pools it would have been
in. Under the null, the rank of the actual hour among the window's hours is uniform, so the p-value is exact: it comes
from drawing hours uniformly, with no model of yields.

- A strategy that always moves as soon as its lock ends has no freedom left within this window, so it is not tested. Its
  timing is a fixed schedule by construction.
- A strategy's statistic is the sum of (rank − ½) over its moves.

### Several strategies at once

- **Benjamini–Hochberg** q-values across strategies, for each test, at a false discovery rate of 10%.
- **Population checks.** The checks are the share of p-values below 0.05, and those p-values as normal quantiles, which
  have mean 0 and variance 1 when nobody has skill. For timing, the check is the mean rank of every move, which is ½
  with no skill.
- **Persistence.** The check is the Spearman correlation between a strategy's selection z-score over the first half of
  the period and over the second half.

## Results (22 October to 18 November 2026)

The full tables are in [`results/summary.md`](results/summary.md), and every strategy is in
[`results/strategies.csv`](results/strategies.csv). Over the period, the average sAERO in a pool earned an APR of 21.4%
at today's AERO price. Fees were 99.6% of that and incentives the rest.

**Selection is real, but mostly relative to the largest stakes.** Against a crowd weighted by power, 1,741 of 9,620
strategies are significant at FDR 10%, and 26% have p < 0.05, against the 5% expected with no skill. Against a crowd of
stakes, only 116 are significant, and 13% have p < 0.05. Much of the power sits with a few very large stakes in pools
that pay below average: the three largest, at 71–143 million sAERO, earned 12–18%. A stake that avoids those pools beats
the sAERO-weighted average without much skill. The edge also persists: selection in the first half predicts selection in
the second (Spearman ρ = 0.34, against ±0.02 for no relation). However, holding the same good pool counts in both
halves, so this is not independent evidence of repeated skill.

**Timing shows almost no skill.** 22 of 6,687 strategies are significant at FDR 10%, and 8.7% have p < 0.05. Over 25,604
moves, the mean rank of the hour chosen is 0.505, against 0.5 by chance. The median move gained nothing over a random
feasible hour, while the best hour would have gained a median of 15 hours of average pay. A handful of strategies time
well, and they are listed in the summary.

**The highest APRs are real, but small.** The strategies with APRs of 50% to 1,400% are mostly stakes of 100 to 5,000
sAERO in small pools. Their selection is significant, since placebos rarely draw such pools, but it does not scale.
Stakes of millions of sAERO mostly earn within a few points of the average, and the three largest earn below it. Aero's
Autopilot USDC Maxi (stake 20366, 53 million sAERO) earned 22.8% against an average of 22.2% over the same hours. That
is significant against random pools at its size (p = 0.0001), but its timing is not significant once every strategy
tested is taken into account (p = 0.015, q = 0.40).

## Limits

- **28 days.** A strategy moves at most every 47 hours, so even the most active have about 13 decisions. Most strategies
  cannot be told apart from chance in either direction.
- **Selection includes part of timing.** Placebos move when the strategy moves, so a strategy that holds winning pools
  longer gets credit in the selection test. The timing test only covers when each move happened, given its neighbours.
- **Hourly resolution.** Fees count from the last checkpoint at or before each hour, and allocations from the hour after
  they happened. Placebo dilution uses each pool's power at the start of the spell. Cooldown reductions, which can
  shorten a lock, are ignored, so some feasible windows are a little too short.
- **Non-pool allocations.** 8.3% of allocated power goes to the zero address or to `0x2e67…6902`, an address with no
  code that is not a registered gauge. It is left out, and weights are taken over real pools only.
- **Strategies are exact copies.** Stakes run by one manager but allocated at different hours count as different
  strategies. Benjamini–Hochberg still controls the false discovery rate under the positive dependence this creates.
- **A crowd is a choice.** "Better than others" depends on who the others are. Power-weighted and stake-weighted crowds
  give very different answers here, so both are reported.
