# 6. Validating the proposal

The personas and the proposal come from desk research and a review of the current page, not from talking to Hydrex
users. Before design starts, they should meet real ones. The site has no analytics and should keep none, so the evidence
has to come from people, not dashboards. With about 4,000 lockers and a Discord of 6,000, the people are findable.

## Questions to answer first

These decide the organisation; the rest is detail.

1. **Do holders of Hydrex's stopped automations know they stopped, and what do they think happens to their accounts?**
   This decides how loud Home's notice is, and the wording of the status most visitors will see first.
2. **Do Hydrex holders choose an automation on what it pays?** If yes, Home's comparison (block 6) carries the decision
   and needs numbers the page does not read today. If they choose on trust or habit, Home's "Safe to try" matters more.
3. **Is giving up a third of the rewards a deal-breaker, a price, or the point?** This splits the
   [personas](2-personas.md) more than any other question, and decides whether Home leads with yield or with impact.
4. **Do members come back, and why?** If nobody returns between joining and leaving, the App can stay a join and leave
   tool; if they do, phase 3 (history, impact) moves up.
5. **Who signs for DAO and protocol accounts, and what do they need to show co-signers?** This decides how much How it
   works is written for a second reader.
6. **What do people believe happens to rewards they have not claimed when they join?** Today's most important warning
   depends on being understood before confirming.

## Methods

| Method                           | With whom                                                                                                | What it tests                                                                                              | Effort       |
| -------------------------------- | -------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ------------ |
| Short interviews                 | 6 to 8 Hydrex holders, recruited in Hydrex's community channels, at least half from a stopped automation | Questions 1 to 5; how they chose and used automations, and what they did when they stopped                 | 30 min each  |
| Five-second test                 | 15 or more, unmoderated                                                                                  | Home's first screen: what is it, who is it for, what does it cost                                          | Low          |
| Tree test                        | 20 or more, unmoderated                                                                                  | The sitemap: where would you go to leave, to check the admin key, to see when votes move                   | Low          |
| Moderated task test              | 5 per round, two rounds; on phones in a wallet browser and on desktop                                    | The App and the review on a clickable prototype against a fork of Base (the fork tests already set one up) | 1 hour each  |
| Comprehension check after review | Every task test participant                                                                              | Question 6, asked after the review and before confirming: "What happens to your unclaimed rewards?"        | In the above |
| Safe walkthrough                 | 2 or 3 DAO or protocol signers                                                                           | Proposing a join in Safe{Wallet}, and what they would send co-signers                                      | 45 min each  |

## Tasks for the moderated test

1. "You have heard of metaDEX Café. Find out what it does and whether it is for you." (Home, deciding)
2. "Your account was in Hydrex's USDC automation. Find out where it stands now, and decide what to do." (moving: Home's
   notice, the App's first group, `#if-your-automation-stopped`)
3. "Join with your Flex Account only." (App, a selection inside a group, the three-step review)
4. "When will the automation first vote with it? When is your first payout?" (the timeline)
5. "You joined last week. Check that everything is in order." (App, checking)
6. "Leave with all your accounts." (leaving)
7. "A co-signer asks what this allows. Send them something." (How it works, anchors)

## Signals of success

The proposal is working if, in the second round of task tests:

- every participant from a stopped automation says, unprompted, that it no longer votes or claims for them;
- every participant says what joining costs them (a share of the rewards, their own vote) before confirming;
- every participant answers question 6 correctly before confirming;
- no participant needs Home to join or leave once they know the site;
- participants find the date of the first vote and the first payout without help;
- leaving takes no more steps than joining, and nobody hesitates on it.

## Risks to watch

- **Splitting the page could look like an attempt to hide the risks.** The review must keep every disclosure that
  applies, and How it works must never be the only place a warning lives.
- **A comparison on Home invites the question "why not just vote yourself?"** It should be answered honestly, and the
  answer may be "if you only want the most yield and have the time, you should".
- **A notice about Hydrex's automations is a statement about someone else's product.** Its wording should be checked
  with Hydrex, and it should come down once it has done its job.
- **A mirror is a second address a copy can imitate.** If the site is also served from `metadexcafe.eth.limo`, the
  footer and the README name both official addresses, and say that a Safe uses `metadex.cafe`.
