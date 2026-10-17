# 6. Validating the proposal

The personas and the proposal come from desk research and a review of the current page, not from talking to Hydrex
users. Before design starts, they should meet real ones. The site has no analytics and should keep none, so the evidence
has to come from people, not dashboards.

## Questions to answer first

These decide the organisation; the rest is detail.

1. **Do Hydrex holders choose an automation on what it pays?** If yes, Home's comparison (block 5) carries the decision
   and needs numbers the page does not read today. If they choose on trust or habit, Home's "Safe to try" matters more.
2. **Is giving up a third of the rewards a deal-breaker, a price, or the point?** This splits the
   [personas](2-personas.md) more than any other question, and decides whether Home leads with yield or with impact.
3. **Do members come back, and why?** If nobody returns between joining and leaving, the App can stay a join and leave
   tool; if they do, phase 3 (history, impact) moves up.
4. **Who signs for DAO and protocol accounts, and what do they need to show co-signers?** This decides how much How it
   works is written for a second reader.
5. **What do people believe happens to rewards they have not claimed when they join?** Today's most important warning
   depends on being understood before confirming.

## Methods

| Method                           | With whom                                                             | What it tests                                                                                              | Effort       |
| -------------------------------- | --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ------------ |
| Short interviews                 | 6 to 8 Hydrex holders, recruited in Hydrex's community channels       | Questions 1 to 4; how they choose and use automations today                                                | 30 min each  |
| Five-second test                 | 15 or more, unmoderated                                               | Home's first screen: what is it, who is it for, what does it cost                                          | Low          |
| Tree test                        | 20 or more, unmoderated                                               | The sitemap: where would you go to leave, to check the admin key, to see when votes move                   | Low          |
| Moderated task test              | 5 per round, two rounds; on phones in a wallet browser and on desktop | The App and the review on a clickable prototype against a fork of Base (the fork tests already set one up) | 1 hour each  |
| Comprehension check after review | Every task test participant                                           | Question 5, asked after the review and before confirming: "What happens to your unclaimed rewards?"        | In the above |
| Safe walkthrough                 | 2 or 3 DAO or protocol signers                                        | Proposing a join in Safe{Wallet}, and what they would send co-signers                                      | 45 min each  |

## Tasks for the moderated test

1. "You have heard of metaDEX Café. Find out what it does and whether it is for you." (Home, deciding)
2. "Join with your Flex Account only." (App, a selection inside a group, the three-step review)
3. "When will the automation first vote with it? When is your first payout?" (the timeline)
4. "You joined last week. Check that everything is in order." (App, checking)
5. "Leave with all your accounts." (leaving)
6. "A co-signer asks what this allows. Send them something." (How it works, anchors)

## Signals of success

The proposal is working if, in the second round of task tests:

- every participant says what joining costs them (a share of the rewards, their own vote) before confirming;
- every participant answers question 5 correctly before confirming;
- no participant needs Home to join or leave once they know the site;
- participants find the date of the first vote and the first payout without help;
- leaving takes no more steps than joining, and nobody hesitates on it.

## Risks to watch

- **Splitting the page could look like an attempt to hide the risks.** The review must keep every disclosure that
  applies, and How it works must never be the only place a warning lives.
- **A comparison on Home invites the question "why not just use USDC?"** It should be answered honestly, and the answer
  may be "if you only want yield, you should".
- **Two URLs are two things a copy can imitate.** The footer's official address and the README's advice ("use the
  official address, read the wallet prompt") apply to both pages.
