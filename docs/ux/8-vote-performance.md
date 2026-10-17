# 8. How the votes did

Should the page tell people how the automation's votes did in the last epoch, and can it, within the page's rules: a
static page, no server, no storage, and the three public RPCs its Content Security Policy allows? Checked on 17 October
2026 against the epoch from Thursday 8 to Thursday 15 October, with a prototype that read Base the way the page does.

## In short

**Yes, as what the votes earned, and it can be done today without a server or a new origin.** Once an epoch has ended,
what each vote earned is fixed and stored on Base, in Hydrex's reward contracts, where plain reads at the latest block
can find it. The page can show what the automation's votes earned per 1,000 votes, what the average vote earned, and
what each member's account earned. It cannot yet show what members were actually paid: that is only in the payout
events, and none of the page's RPCs serves those.

## Why show it

- **It answers the question the page leaves open** ([audit](1-audit.md), P3): what do I get? Theo's second question
  ([personas](2-personas.md)) is "what is my net, against voting myself?", and Home's comparison table has no number in
  it.
- **It is the best trust signal an anonymous site has.** Results anyone can check on Base, every week, say more than a
  name would.
- **It makes the cost concrete.** "A third of the rewards is retired" means more next to "last epoch, a third was about
  $2 for this account".
- **It gives members a reason to come back** (P8), and a way to see that the automation is doing its job.

## What it would show

The epoch from 8 to 15 October, read from Base:

|                               | Carbon Impact                | All votes on Hydrex                  |
| ----------------------------- | ---------------------------- | ------------------------------------ |
| Votes                         | 897 k (1.17 M Earning Power) | 168.4 M                              |
| Pools voted for               | 27                           | 426 pools with a gauge               |
| What the votes earned         | ≈ $693, in 28 tokens         | ≈ $115,649, in 125 tokens            |
| Of which, fees and incentives | $28 in fees, $665 incentives | $13,651 in fees, $101,999 incentives |
| **Per 1,000 votes**           | **≈ $0.77**                  | **≈ $0.69**                          |
| Per 1,000 Earning Power       | ≈ $0.59                      | ≈ $0.53                              |

And for one member, account #9540 (7,919 votes, about 10,300 Earning Power): **its votes earned ≈ $6.12** last epoch.
Two thirds of that, less swap costs, is paid in kVCM; a third is retired.

So last epoch, the automation's choice of pools earned about 12% more per vote than the average vote on Hydrex.

## Can the page do it?

| Part                                  | How                                                                                                                                                                                      | Realistic today?                                                                                                                                                                                                               |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Which pools it voted for              | The Voter's `poolVote(automation, i)`                                                                                                                                                    | **Yes.** One caveat: from the automation's next vote, just before the epoch ends, until the flip, this lists the new votes. In that window the page can find last epoch's pools from the reward contracts instead (852 reads). |
| What its votes earned, token by token | Each reward contract's `rewardData(token, epoch)`, `totalSupplyAt(epoch)` and `balanceOfOwnerAt(automation, epoch)`: the rewards are kept per epoch, so no history is needed             | **Yes.** About 1,000 reads in 8 rounds, about a second, through the page's own RPCs and Multicall3. Final once the epoch has ended.                                                                                            |
| What each account's votes earned      | Each reward contract's own `earnedTokenId(account, token, epoch)`                                                                                                                        | **Yes.** 333 reads per account; it gave the same $6.12 as the computation above.                                                                                                                                               |
| One figure in dollars                 | Prices from the pools themselves, anchored on USDC and Chainlink's ETH / USD and BTC / USD feeds on Base. The prototype used today's prices; prices at the flip are readable too (below) | **Mostly.** 26 of the 28 tokens priced; USDC was 98% of the value. But a thin pool can misprice a token: FXUSD came out at $1,000 instead of $1.                                                                               |
| The average vote on Hydrex            | The same reads over all 426 pools and 852 reward contracts                                                                                                                               | **On demand only.** 10,092 reads in 59 requests, about six seconds: too much for every visit on public RPCs, fine behind a button or on How it works.                                                                          |
| What members were actually paid       | The automation's payout events, which name each account and owner                                                                                                                        | **No, not with today's RPCs.** mainnet.base.org refused every log request, publicnode serves only the last few hours without a paid token, and drpc refused even 1,000-block ranges on its free plan.                          |

All of it fits the page as it is: no new origin in the Content Security Policy, no server, nothing stored. The tests ran
from this environment's shared address; a visitor's own limits may be kinder, and the page already falls back from one
RPC to the next.

## Which prices: today's, or at the flip

The prototype priced the tokens at today's prices. Prices at the end of the epoch can be read too, without the archive
reads most RPCs refuse, since each source keeps its own history in current state:

| Source                   | History it keeps                                                     | Checked                                                                              |
| ------------------------ | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Chainlink feeds          | Every past round, by `getRoundData`                                  | ETH / USD at the flip, $2,415.46, found in 13 reads; $2,411.64 today                 |
| Algebra pools            | A price oracle in each pool's plugin, by `getTimepoints(secondsAgo)` | All 21 of the automation's Algebra pools reach back past the flip, 64 hours ago      |
| Classic pools            | Price observations, as Solidly-style pairs keep                      | The HYDX / USDC pool holds 11,768 of them                                            |
| A read at the flip block | Only with archive state                                              | mainnet.base.org answered 7 and 8 days back; publicnode refused without a paid token |

**Recommended: prices averaged over the half hour before the flip.**

- It is when the epoch's earnings became final, and when the automation claims and swaps them, so it is close to what
  members were paid.
- The figure stays the same all week, instead of moving on every visit.
- Epochs compare on the same footing.
- An average over half an hour is harder to distort than the price of one moment, which also helps with thin pools.

It costs one oracle read per pool (27 for the automation, 426 for the comparison) and about 13 per Chainlink feed:
little next to the rest. Where a pool's oracle does not reach back far enough, the page uses today's price for that
token, or leaves it unpriced, and says so. Last epoch it would have made little difference: ETH moved by 0.2% and the
USDC / cbBTC pool by 0.2%, and USDC was 98% of the value.

## How to show it honestly

1. **Say "earned by its votes", not "paid to you".** The two differ: a third is retired, swaps cost something, and
   tokens worth too little to claim may be left. One line under the figure says so.
2. **Say "≈" and where the prices come from:** "at prices in Hydrex's pools when the epoch ended". Price a token only
   through a pool with enough liquidity, and count the tokens left unpriced rather than guess them.
3. **Name the epoch.** "Last epoch, 8 to 15 Oct". One epoch is noisy: incentives change every week. More epochs can come
   later: for a past epoch, about 850 reads find the automation's pools, then the same reads as above.
4. **Say what is included.** Hydrex publishes $15,008 of weekly rewards for that epoch, close to the fees alone ($13,651
   on Base): it leaves out the incentives. The page's figure includes both, and says so, or the site and Hydrex will
   disagree again (P12).
5. **Compare with the average vote, not the best pool.** The best pool's yield falls as votes move to it; the average is
   what a vote actually earned.

## Where it goes

| Where                                     | What                                                                                                                                                                                                   |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Home, "Carbon Impact today"               | "Last epoch, its votes earned ≈ $0.77 per 1,000 votes", with the dates, and a link to the detail                                                                                                       |
| Home, "Compared with the other choices"   | A row "Last epoch, per 1,000 Earning Power": vote yourself, "≈ $0.53 on average, depending on your pools"; a stopped automation, "$0"; Carbon Impact, "≈ $0.59 earned, two thirds paid to you in kVCM" |
| App, each account in Carbon Impact        | "Last epoch, its votes earned ≈ $6.12"                                                                                                                                                                 |
| How it works, a new `#last-epoch` section | The pools, the tokens, the prices used and the unpriced tokens, what is included, and the comparison with all of Hydrex, computed when the section is opened                                           |

The comparison is the one costly read. If it should not wait for a click, Home can show the automation's figure alone,
and How it works the comparison.

## Decisions for the team

1. **A dollar figure, or tokens only?** Recommended: dollars, with "≈", at prices from the half hour before the flip,
   from pools above a liquidity floor, and the unpriced tokens counted.
2. **The comparison with all of Hydrex:** on How it works, when opened (recommended), behind a button, or not at all.
3. **What members were paid:** add an RPC that serves logs to the Content Security Policy, which is a new origin and a
   new dependency, or leave payouts to Basescan and Hydrex for now.
