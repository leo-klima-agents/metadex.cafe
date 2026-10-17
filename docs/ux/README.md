# UX research: organising metaDEX Café

How <https://metadex.cafe/> should be organised, from a review of the current page, desk research on Hydrex and its
users, and comparable products. It covers organisation and behaviour only: design and branding come later. October 2026.

## In short

**Split the page in three, on one origin: Home to decide, the App to act and check, How it works to read and verify.**

```
metadex.cafe/                 Home           why, what you get, what you give, why it is safe        no wallet
metadex.cafe/app/             App            your accounts, grouped by what you can do; join, leave  Safe App URL
metadex.cafe/how-it-works/    How it works   every disclosure, the timing, the admin key, carbon,    linkable
                                             verification, questions, words
```

1. **Most visitors are holders whose automation stopped.** Hydrex has disabled its automations; about 11.5 M Earning
   Power still points at the 13 that no longer run, and Carbon Impact is the one still voting. Today the page shows such
   an account as "In another Hydrex automation: USDC", as if it still ran. Fixing that line is the first thing to ship,
   before any reorganisation.
2. **One scroll serves four visits badly.** Deciding, moving from a stopped automation, acting and checking each need a
   different order. On a phone, the wallet button is below the fold, after about 170 words of mechanics.
3. **The decision is a comparison the page never makes.** Against voting by hand every Thursday, or staying in a stopped
   automation: what you keep, what you give (a third of the rewards, your own vote), what you get.
4. **The disclosures are the page's best asset and are in the wrong place.** They belong in the review, next to Confirm,
   since wallets will not explain a call that moves no tokens; their long form belongs on a linkable page that
   co-signers and Discord answers can point to.
5. **The typical Hydrex user is two people.** By headcount, a small holder on a phone with a smart wallet and a few
   dollars of weekly rewards; by Earning Power, a few large holders and protocols who read contracts. Home is written
   for the first, How it works for the second, and the App serves both.

## Contents

| Part                                    | What it holds                                                                                                                                |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| [1. The site today](1-audit.md)         | Inventory, measurements and screenshots; what must survive; 15 problems rated by severity                                                    |
| [2. Hydrex users](2-personas.md)        | Hydrex in brief; the numbers that shape the audience; four proto-personas; jobs to be done                                                   |
| [3. Comparable products](3-patterns.md) | Vote automation products, site and app splits, signing research, carbon impact, time and status patterns                                     |
| [4. Organisations](4-organisations.md)  | Six organisations studied (one page reordered, two pages, two pages and a reference, app first, a menu, a wizard) and a scored comparison    |
| [5. Proposal](5-proposal.md)            | The recommended organisation: sitemap, entry points, each page's blocks in order, account groups, the join flow, states, wireframes, phasing |
| [6. Validation](6-validation.md)        | The questions to answer with real users first, methods, test tasks and signals of success                                                    |

## The personas

| Persona                         | Who                                                                            | First question                                                  |
| ------------------------------- | ------------------------------------------------------------------------------ | --------------------------------------------------------------- |
| Maya, the set-and-forget holder | One Flex Account, a few dollars a week, a smart wallet on a phone; was in USDC | "My automation stopped: what happens to my account?"            |
| Theo, the weekly optimiser      | Several accounts, hundreds of dollars a week, desktop; votes on their own      | "How does it vote, and what is my net?"                         |
| Sofia, the impact-minded holder | Follows ReFi on Base; may arrive from Klima without an account                 | "What is retired, and where can I see it?"                      |
| Rafael, the treasury signer     | A signer of a protocol's Safe holding Hydrex accounts                          | "Can we do it from our Safe, and what do I send my co-signers?" |

They are proto-personas from desk research, to be tested: [6. Validation](6-validation.md).

## The options at a glance

| Option                            | Score (of 27) | In one line                                                             |
| --------------------------------- | ------------- | ----------------------------------------------------------------------- |
| A. One page, reordered            | 19            | Smallest change; still one scroll for every visit                       |
| B. Two pages: explain, then use   | 25            | The split the brief suggested; each page has one job                    |
| **C. Two pages and a reference**  | **26**        | **B, plus a linkable page for the full disclosures: recommended**       |
| D. App first, learning in context | 20            | Fast for members, weak for newcomers; cannot remember a dismissed intro |
| E. A menu of automations          | 19            | Right if there is ever a second automation; one today                   |
| F. A guided flow                  | 18            | Wrong for the site, right for the join flow inside the App              |

## What to do first

| Phase | Ships                                                                                                                                 |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------- |
| 0     | On today's page, say when an account is in an automation Hydrex no longer runs                                                        |
| 1     | Home and the App as separate pages; the three-step review; account groups; the epoch timeline; Safe App on `/app/`                    |
| 2     | How it works, with anchors linked from Home, the review and announcements                                                             |
| 3     | Payout and retirement history, an impact page, a read-only lookup by address, batched signing: as far as data without a server allows |

Five decisions are left to the team, from who runs it to whose name is on the retirements:
[5. Proposal, Decisions for the team](5-proposal.md#decisions-for-the-team).

## Method and limits

- **The current page** was built from this repository at commit `7603f66` and driven in Chromium with a test wallet, at
  390 and 1440 px, against Base, with the accounts of a real owner.
- **Hydrex** was studied through its app's own text, its docs and its public API (`api.hydrex.fi`), its SDK, DefiLlama,
  CoinGecko and community channels. Hydrex's app and docs render in the browser only, so some wording was read from
  their scripts.
- **Comparable products and research** came from public docs, guides, forum posts and papers; claims from a single
  secondary source are marked in [3. Comparable products](3-patterns.md).
- **From the team:** Hydrex has disabled its automations, and AZUSD no longer works, so Carbon Impact no longer claims
  it. Hydrex's public API still lists Carbon Impact as paying 60% kVCM and 40% AZUSD.
- **Not done:** no interviews or tests with Hydrex users. The personas and the scores are hypotheses until
  [6. Validation](6-validation.md) has run.
