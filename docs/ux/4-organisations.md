# 3. Organisations studied

Six ways to organise the site, from the smallest change to the largest. Each is described by its pages, the path of a
first visit and a return visit, and how it serves the personas in [2. Hydrex users](2-personas.md). They are compared at
the end.

All six keep what the audit says must survive (honest disclosures, two calls, checks, leaving always works, Safe App)
and the constraints of the site: static files, no server, no storage, one official address, a strict Content Security
Policy and a reproducible build. More than one HTML page is possible within these: each page is a file with its own
script and stylesheet hashes, served from the same origin.

Throughout, "the visits" are those from the audit: **deciding** (first visit), **acting** (join or leave) and
**checking** (return visits), plus a fourth that Hydrex disabling its automations created: **moving**, for a holder
whose automation stopped and who has to find out, then choose.

---

## A. One page, reordered

The current single page, with the order changed by state and the long explanation folded.

```
metadex.cafe/
├── Header: name · one-line promise · [Connect wallet]          ← in the first screen
├── Not connected:  Why join (3 points) → The numbers → How it works (folded) → Risks (folded)
└── Connected:      Your accounts (summary + list + Join/Leave) → This epoch → How it works (folded)
    └── Review dialog: effects · calls · Confirm
```

- **Deciding:** the promise and a Connect button on the first screen, then a short why and the numbers; details fold.
- **Acting and checking:** once connected, the accounts move to the top and the explanation folds away.

| For                                                                              | Against                                                                                       |
| -------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Smallest change; one file, one address, one Safe App URL.                        | The page still serves three visits; a page that rearranges itself on connect is disorienting. |
| No routing, so nothing for the build or the Content Security Policy to learn.    | Little room to grow: history, impact and other automations would all land on the same scroll. |
| The official address and the app are the same thing, which helps against copies. | Folded content is easy to miss and hard to link to ("read the risks" cannot point anywhere).  |

---

## B. Two pages: explain, then use

The organisation suggested in the brief. A first page says what it is and why; a second page is where accounts join and
leave.

```
metadex.cafe/                 Home: explain and decide
├── What it does, in one sentence, and who it is for
├── How it works: 3 steps (votes for you → claims and swaps → retires a share, pays you the rest)
├── The numbers: retired so far · share retired · what members get · this epoch, with a countdown
├── What you give up, and what you keep (the honest trade-off)
├── Safe to try: nothing transferred · leave any time · two calls, shown before your wallet asks
└── [Open the app]

metadex.cafe/app/             App: act and check            ← Safe App URL
├── Connect (wallet buttons, or Safe{Wallet} on its own)
├── Your accounts: summary bar · list grouped by status · Join / Leave per selection
├── This epoch: timeline (now → vote → payout → next epoch)
├── Payout address
└── Review dialog: what changes · what your wallet will ask · Confirm
```

- **Deciding:** Home only; nothing asks for a wallet until the visitor chooses to go on.
- **Acting:** the app opens on the accounts; disclosures move into the review, where the decision is.
- **Checking:** a bookmark or the Safe App opens the app directly.

| For                                                                                                    | Against                                                                                                 |
| ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| Each page has one job, and its order can be designed for it.                                           | Two pages repeat a little: the app still needs the numbers and a short reminder of what joining allows. |
| Home can be read, shared and indexed without a wallet; the app can be dense without scaring newcomers. | A visitor who types the address to check status lands on Home, one click from where they meant to go.   |
| The familiar DeFi pattern (a site, then an app) that Hydrex users already know.                        | Two pages to build, hash and test; the Safe App URL moves to `/app/`.                                   |
| The app becomes the place for what comes later (history, impact) without lengthening Home.             |                                                                                                         |

---

## C. Two pages and a reference

Option B, with the long-form material moved to a third page that both link to.

```
metadex.cafe/                 Home: explain and decide         (as in B, shorter)
metadex.cafe/app/             App: act and check               (as in B)
metadex.cafe/how-it-works/    Reference: read and verify
├── What joining allows, in full (today's six disclosures)
├── Timing, step by step: claims move now, votes move next epoch; when it votes and pays
├── Who controls what: the admin key, what it can change, up to what limits
├── The carbon side: what kVCM is, what is retired, where to see retirements
├── Verify: contracts, source, the page's checks, the official address, how to check a build
└── Questions (FAQ) and words (glossary)
```

| For                                                                                                              | Against                                                                                 |
| ---------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Home can stay short and persuasive without hiding anything: every claim links to its full version.               | Three pages to keep consistent; the reference can drift from what the review says.      |
| The reference has linkable sections ("read the timing"), which helps support, Safe co-signers and DAO proposals. | Most visitors will never open it; it must not become where the important warnings live. |
| The verification material, today mixed into the user-facing page, has a home of its own.                         |                                                                                         |

---

## D. App first, with learning in context

One page whose default is the app. A first-time visitor sees a short introduction above the accounts, dismissible, and
learns the rest where it matters: in tooltips, a "How it works" drawer and the review.

```
metadex.cafe/
├── Intro panel (first visit): one sentence · three numbers · [How it works] drawer · [Connect]
├── Your accounts (empty state before connect: "Connect to see your Hydrex accounts")
├── This epoch: timeline
└── Drawers: How it works · Risks · Verify          Review dialog: effects · calls · Confirm
```

| For                                                                   | Against                                                                                                                                                      |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Fastest for returning members and Safe users; the app is the address. | The page stores nothing, so it cannot remember that a visitor dismissed the intro; it shows every visit, or never.                                           |
| Close to how Hydrex itself works (the dApp is the site).              | The decision to give up a share of rewards is made in tooltips and drawers, not on a page built to explain it. Weak for the newcomer and the impact-curious. |
|                                                                       | Nothing to share or index without a wallet, beyond a panel.                                                                                                  |

---

## E. A menu of automations

metaDEX Café as a café: a menu of automations, of which Carbon Impact is the first. Each automation has its own page;
the accounts page shows every account against every automation on the menu.

```
metadex.cafe/                         The menu: automations side by side (what each pays, retires, charges)
metadex.cafe/carbon-impact/           One automation: explain, numbers, join
metadex.cafe/accounts/                Your accounts, in any automation on the menu
metadex.cafe/how-it-works/            Reference
```

| For                                                                                                                                                                   | Against                                                                                                                                                                     |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Matches how Hydrex users learnt to choose: between automations, on what they pay. With Hydrex's own disabled, the site could become where automations on Hydrex live. | There is one automation today. A menu of one looks empty, and listing Hydrex's stopped automations beside it would make the site a status board for someone else's product. |
| The name "Café" and the brand invite it.                                                                                                                              | Every automation added widens what the page must check and what a copy could abuse; the "two calls only" promise gets harder to keep.                                       |
| The accounts page already reads which automation each account is in, by name.                                                                                         | Most of the work would go into comparison and catalogue features before the core flow is fixed.                                                                             |

---

## F. A guided flow

A step-by-step wizard from the first visit to a confirmed join, with one question per screen.

```
1 Why       → 2 Connect → 3 Pick accounts → 4 Before you join (claim on Hydrex first?) → 5 Review → 6 Done: what happens next
```

| For                                                                                                                 | Against                                                                                                  |
| ------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Puts each disclosure exactly where it applies; "claim your rewards on Hydrex first" becomes a step, not a footnote. | Slow for anyone who already knows; returning members want status, not steps.                             |
| Good on phones and in wallet browsers: one decision per screen.                                                     | Leaving, checking and Safe proposals do not fit a linear flow, so the site would still need a dashboard. |
| A "Done" screen can show the timeline of what happens next, which today is a status line.                           |                                                                                                          |

F is better read as a pattern for the join flow inside any of A to E than as an organisation on its own.

---

## Comparison

Scores from 1 (poor) to 3 (good), from [the audit](1-audit.md), [the personas](2-personas.md) and
[the comparable products](3-patterns.md).

| Criterion                                                                      | A   | B   | C   | D   | E   | F   |
| ------------------------------------------------------------------------------ | --- | --- | --- | --- | --- | --- |
| Deciding: a first visitor understands what, why, cost and risk before a wallet | 2   | 3   | 3   | 1   | 2   | 3   |
| Acting: from arrival to a reviewed join or leave                               | 2   | 3   | 3   | 3   | 2   | 2   |
| Checking: a member sees status and what comes next at once                     | 2   | 3   | 3   | 3   | 3   | 1   |
| Moving: a holder whose automation stopped learns it, and what to do            | 2   | 3   | 3   | 2   | 3   | 2   |
| Trust: claims are verifiable and the risks are linkable                        | 2   | 2   | 3   | 1   | 2   | 2   |
| Safe{Wallet} and wallet browsers                                               | 2   | 3   | 3   | 3   | 2   | 2   |
| Room for what comes later (history, impact, another automation)                | 1   | 3   | 3   | 2   | 3   | 1   |
| Keeps the attack surface and the checks small                                  | 3   | 3   | 3   | 3   | 1   | 3   |
| Cost to build and keep consistent                                              | 3   | 2   | 2   | 2   | 1   | 2   |
| **Total (of 27)**                                                              | 19  | 25  | 26  | 20  | 19  | 18  |

**C scores highest, with B a close second: C is B plus a reference page.** D is right for members and wrong for
newcomers; E answers a question the site does not have yet, though Hydrex disabling its automations makes it a question
worth keeping open; F is the best shape for the join flow, inside the app. The recommendation in
[5. Proposal](5-proposal.md) is therefore C, built in two steps (B first, then the reference), with F's steps inside the
app's join flow and E kept open by the URL structure.
