# Is a stake's APR skill or noise?

This directory checks, for every Aero stake (sAERO NFT) on Base, whether it earned more than chance would give, and
splits the answer in two:

- **Selection**: given the hours at which it moved, did it pick better pools than the crowd would have?
- **Timing**: given the pools it moved between, did it move at better hours than it could have at random?

These are the simplest tests that separate the two. Each tests one part while holding the other part fixed at what the
stake actually did. Neither test assumes a distribution for yields, so lumpy fees, persistent pools and concentrated
stakes don't make the result look more significant than it is.

## Running it

From the repository's root, in this order:

```bash
node research/fetch-gauges.ts        # each gauge's rewards manager at every hour since launch, and prices (~2 minutes)
node research/fetch-allocations.ts   # every GaugesAllocated event since launch (publicnode, ~3 minutes)
node research/fetch-stakes.ts        # each stake as of the data's last hour, and when withdrawn ones left (~3 minutes)
node research/analyze.ts             # writes research/results/summary.md and strategies.csv (~5 minutes)
CAP=0.01 OUT=research/results/strict node research/analyze.ts   # the strict capacity rule
node research/validate.ts            # compares rebuilt yields with the site's own APR code; run fetch-gauges first
```

The fetch scripts write to `research/data/`, which is not committed. A second run of `fetch-gauges.ts` or
`fetch-allocations.ts` only reads what is new. `analyze.ts` seeds each test of each strategy on its own, so the same
data gives the same results, and a change to one test doesn't move another's.

## Data

- **One end for everything.** The data ends at the last hour that both the gauges' history and the allocation search
  cover. Allocations after it are left out, and stakes are read as of that hour, so that nothing reaches past the
  gauges' history.
- **Allocations.** Every `GaugesAllocated(tokenId, (gauge, allocated, data)[], …)` event of the LeafVoter. Each event
  replaces the stake's whole allocation on Base. Allocations within one hour are merged, the last one counting. Event
  times come from Base's fixed block schedule.
- **When stakes ended.** A withdrawn stake loses its allocation with no event. `fetch-stakes.ts` finds the first hour at
  which each one was no longer staked, by reading past blocks. A time lock that ended stops the allocation too. A
  stake's last allocation lasts until whichever came first.
- **What each pool paid.** Each gauge's rewards manager keeps its fees per unit of power, and the integral of 1 / power,
  at every checkpoint. Reading both at every hour gives `Y[g][k]`, what one sAERO in gauge `g` earned from launch to
  hour `k`, fees and incentive programs together. A manager only records fees at its checkpoints, which can be hours
  apart, so the fees recorded at one are spread evenly over the time since the one before. `validate.ts` checks this
  against the site's own APR code: they agree within 1% on 10 of the 11 largest pools, and within 3.4% on
  vAMM-AERO/USDC, which checkpoints least often.
- **Gauges that don't count allocations.** A gauge that isn't activated, or whose cap is zero, doesn't count the sAERO
  allocated to it. Its power stays far below them, and the few sAERO that are counted can earn all its fees, at APRs in
  the hundreds of thousands of percent. While a gauge's power is under 10% of the sAERO allocated to it, those sAERO
  earn nothing there. This touches 0.3% of allocated sAERO-hours, but it removed the most extreme APRs.
- **Prices.** Today's prices, one per token, for the whole period, from pools at least 10 times as deep as the most the
  token paid in a day, as the site requires. Only comparisons made over the same hours matter, so one snapshot removes
  price noise without biasing them. Tokens without a price count as 0 for everyone. Gauges paying one hold 1.2% of
  power.
- **Strategies.** Stakes that allocate at the same hours, to the same pools, in the same shares, and end at the same
  hour, are one strategy, tested once. Otherwise, a manager running 50 identical stakes would count as 50 independent
  pieces of evidence.

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
- A placebo only goes to a pool that **could absorb its size**: one where its sAERO would be at most 25% of the pool's
  power, or at most the share the strategy took in the pool it stands for, if that was more. Real stakes take more than
  25% of a pool in only 1% to 8% of their entries, depending on size. Without this rule, a large strategy's placebos
  land in pools far too small for them and dilute themselves, which no real stake of that size does. The strategy then
  looks skilled just for avoiding that. If no pool can absorb the placebo, it takes the largest pool left.
- Only strategies of at least 100 sAERO and 96 hours in pools are tested. A dust stake that is alone in an empty pool
  earns all of that pool's fees, at APRs in the billions of percent.
- As a robustness check, the crowd is also defined as **stakes rather than sAERO**: pools are drawn in proportion to how
  many stakes are in them.

### Timing

The null hypothesis is that a move from pools `P` to pools `Q` is equally likely at any hour the stake could have moved
at. The **feasible window** runs from the end of the 47-hour lock after the previous allocation to 47 hours before the
next allocation, or to the hour the stake ended. Moving at any hour in the window would have kept the stake's other
moves possible. For each hour `x` in the window, `E(x)` is what one sAERO would have earned over it by staying in `P`
until `x` and then holding `Q`. Pool power is counted without the stake's own, with its amounts added back in whichever
pools it would have been in. The p-value is the chance that a uniformly drawn hour ranks as high as the actual one, from
20,000 draws at most. It needs no model of yields.

- The window is set by the stake's neighbouring moves. The test is exact only if those don't depend on how the pools did
  after this move. A stake that moved again quickly after a bad move would break that, and its timing p-values would be
  off in a direction that depends on how it reacts.
- A strategy that always moves as soon as its lock ends has no freedom left within this window, so it is not tested. Its
  timing is a fixed schedule by construction.
- A strategy's statistic is the sum of (rank − ½) over its moves.

### Several strategies at once

- **Benjamini–Hochberg** q-values across strategies, for each test, at a false discovery rate of 10%.
- **Population checks.** The checks are the share of p-values below 0.05, and those p-values as normal quantiles, which
  have mean 0 and variance 1 when nobody has skill. For timing, the check is the mean rank of every move, which is ½
  with no skill.
- **Calibration by size.** With no skill, 5% of p-values fall below 0.05 and 10% above 0.9, at every size. A size band
  that departs from this much more than the others points either to a flaw in the placebos at that size or to an edge
  that comes with size.
- **Persistence.** The check is the Spearman correlation, with ties ranked equally, between a strategy's selection
  p-values over the first half of the period and over the second half, as normal quantiles.

## Results (22 October to 19 November 2026, 13:00 UTC)

The full tables are in [`results/summary.md`](results/summary.md), and every strategy is in
[`results/strategies.csv`](results/strategies.csv). Over the period, the average counted sAERO in a pool earned an APR
of 21.1% at today's AERO price. Fees were 95.5% of all pay and incentives the rest.

**Some stakes pick pools better than the crowd, and much of it is avoiding pools that pay little.**

- **Against a crowd weighted by power:** 1,702 of 9,701 strategies are significant at FDR 10%, and 26% have p < 0.05,
  against the 5% expected with no skill.
- **Against a crowd of stakes:** 155 strategies are significant, and 12% have p < 0.05.
- **Why there is an edge to find:** pool yields don't even out. Over the period, the 15 largest pools paid between about
  10% (vAMM-AERO/USDC, CL100-RSGP/USDC) and 28% (CL50-USDC/cbBTC, CL10-USDC/SNDKc). A quarter of all power sat in pools
  paying under 15%, mostly pools with AERO on one side. A stake that keeps out of those pools beats the crowd without
  needing to know anything else.
- **Persistence:** selection in the first half predicts selection in the second (Spearman ρ = 0.35, against ±0.02 for no
  relation). Holding the same good pool counts in both halves, though, so this is not independent evidence of repeated
  skill.

**Large stakes stand out, and it isn't only a flaw in the placebos.** Against a crowd of stakes, p < 0.05 holds for
about 11% of strategies under 100,000 sAERO, 20% of those between 100,000 and 1 million, and 54% of those above 1
million. Under 100,000 sAERO, p-values above 0.9 are close to the 10% expected (5% to 9%), so the small strategies' test
looks well calibrated. Three checks say the large strategies' excess is real:

- **Their APRs:** strategies of a million sAERO or more earned a median of 1.14 times what the average sAERO earned over
  the same hours.
- **The strict rule:** a placebo may take no bigger share of a pool than the strategy took (or 1%), so it never dilutes
  itself more than the strategy did. This makes large strategies look better, not worse (`results/strict/`), because the
  pools that can absorb a large placebo are the largest ones, and those include the pools that pay least.
- **Their variance:** a large strategy is spread over several large pools, so random placebos land close to one another.
  A steady edge of a few percent then gives a very small p-value. The edge is real, but small p-values here don't mean a
  large edge.

**Timing shows a small edge in aggregate, worth almost nothing to most moves.** 32 of 6,739 strategies are significant
at FDR 10%, and 9% have p < 0.05. Over 26,179 moves, the mean rank of the hour chosen is 0.506, against 0.5 by chance (z
= 3.1). The median move gained nothing over a random feasible hour, while the best hour would have gained a median of 15
hours of average pay. The edge depends on when fees are taken to arrive between checkpoints. Crediting them all at the
later checkpoint, as the contracts record them, gives a mean rank of 0.503 (z = 1.4) and 25 significant strategies.
Moving into a pool makes it checkpoint, so that version counts the fees built up before a move as earned at the move,
which makes earlier moves look better than they were. The strategies that time well mostly made the same moves at the
same hours: into CL100-RSGP/USDC on 28 and 29 October, CL200-USDC/BLUECHIP around 18:00 UTC on 6 November, and
CL200-WETH/DRV around 18:00 on 13 November. They look like a few shared signals, or one operator, rather than many
independent skilled timers.

**The highest APRs are real, but small.** The 15 strategies with APRs above 100% are stakes of 100 to 6,000 sAERO in
small pools, and each held more than a quarter of a pool at some point. Their selection is significant, since placebos
rarely draw such pools, but it does not scale. Stakes of millions of sAERO mostly earn within a few points of the
average. Two of the three largest earn well below it, and are not significant (stake 10495: 14.1% against 19.6%, p =
0.19; stake 10504: 11.9% against 19.6%, p = 0.97).

**Aero's Autopilot USDC Maxi** (stake 20366, 53 million sAERO) earned 22.4% against an average of 21.8% over the same
hours.

- **Selection:** significant against the power-weighted crowd (p = 0.0004, q = 0.011). Against a crowd of stakes it
  isn't (p = 0.006, q = 0.17), though it is under the strict rule (q = 0.004). Its evidence depends on which crowd it is
  compared with.
- **Timing:** not significant (rank 0.72, p = 0.06, q = 0.59).

**So, is one stake's good APR skill or noise?**

- **Small stakes:** for any one stake under 100,000 sAERO, assume noise unless its selection q is at most 0.1 against
  both crowds. Across them, about 11% beat chance at p < 0.05 where 5% would, so there is some real pool-picking, but
  only a few stakes can be singled out.
- **Large stakes:** above-average APRs are mostly real. They come from staying out of the pools that pay least, not from
  timing, and the stakes in those pools may be voting for something other than fees.
- **Timing:** across all stakes there is a small edge, but for any one stake, treat the part of its APR that came from
  when it moved as noise unless its timing q is at most 0.1. Most of the few that pass made the same moves together.

## Limits

- **28 days.** A strategy moves at most every 47 hours, so even the most active have about 14 decisions. Most strategies
  cannot be told apart from chance in either direction.
- **Selection includes part of timing.** Placebos move when the strategy moves, so a strategy that holds winning pools
  longer gets credit in the selection test. The timing test only covers when each move happened, given its neighbours.
- **Hourly resolution.** Fees between two checkpoints are spread evenly over the time between them, which is an
  estimate: the timing result depends on it (see above). Allocations count from the hour after they happened. Placebo
  dilution uses each pool's power at the start of the spell. Cooldown reductions, which can shorten a lock, are ignored;
  no move in the data came sooner than 47 hours after the last.
- **Non-pool allocations.** 8.2% of the sAERO in allocation events goes to the zero address or to `0x2e67…6902`, an
  address with no code that is not a registered gauge. It is left out, and weights are taken over real pools only.
- **Strategies are exact copies.** Stakes run by one manager but allocated at different hours count as different
  strategies. Benjamini–Hochberg still controls the false discovery rate under the positive dependence this creates, but
  counts of significant strategies overstate how many independent decisions they reflect.
- **A crowd is a choice.** "Better than others" depends on who the others are. Power-weighted and stake-weighted crowds
  give very different answers here, so both are reported. Stakes that vote for low-paying pools may be after something
  other than fees, such as directing emissions to a pool. Beating them is beating a crowd that wasn't trying.
- **The largest stakes have few pools that can absorb them.** For a stake of 100 million sAERO, almost no pool can take
  its placebo at 25% or less, so the placebo goes to the largest pools left. "Better than random at its size" means
  little there.
