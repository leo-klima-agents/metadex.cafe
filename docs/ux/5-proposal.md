# 5. Proposal

**Three pages, each for one of the three visits: Home to decide, the App to act and check, How it works to read and
verify.** This is option C in [4. Organisations](4-organisations.md), built in two steps, with a guided join flow inside
the App. Design and branding come later: the wireframes below fix order, content and behaviour, not looks, and the copy
in them is a placeholder that shows intent.

## Sitemap

```
metadex.cafe/                     Home            decide       public, no wallet
metadex.cafe/app/                 App             act, check   connects on a click; the Safe App opens here
metadex.cafe/how-it-works/        How it works    read, verify public, every section has an anchor
    #what-joining-allows  #timing  #who-controls-what  #carbon  #verify  #questions  #words
```

Kept open, not built now:

```
metadex.cafe/app/?address=0x…     the App, read-only, for any address                    (phase 3)
metadex.cafe/impact/              impact over time: tonnes per epoch, retirements          (phase 3, needs data)
metadex.cafe/<automation>/        a page per automation, if there is ever a second          (only then)
```

**Every page** has the same header and footer:

- **Header:** the name (to Home) · How it works · a button to the App ("Open the app"; on the App, the wallet's state).
- **Footer:** the official address `https://metadex.cafe/` · version and commit · source · contracts · Hydrex · Klima ·
  where to ask a question.

**Safe{Wallet}:** the Safe App's URL becomes `https://metadex.cafe/app/`, with its `manifest.json` there. A Safe that
added the root as a custom app keeps working: in a Safe{Wallet} frame, Home sends the visitor straight on to the App.

## Home: decide

**Job:** in under a minute, a Hydrex holder knows what it is, what they get, what they give up and why it is safe to
try, and can choose to go on. Nothing on Home asks for a wallet.

| Order | Block                        | Content                                                                                                                                                                                                                                                                  | Answers                               |
| ----- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------- |
| 1     | Promise                      | One sentence of benefit, one of mechanism ("votes every week, retires a share of the rewards as carbon credits, pays you the rest; your HYDX never leaves your wallet"). [Open the app] · [How it works]                                                                 | What is it? Is it for me?             |
| 2     | The numbers                  | Tonnes retired so far · the split, in words and percent ("a third retired, two thirds paid to you") · the Earning Power in it this epoch · this epoch ends in 4 d 6 h                                                                                                    | Is it real? Is it alive?              |
| 3     | How it works, in three steps | 1 It votes with your accounts each week. 2 It claims their rewards and swaps them into kVCM. 3 It retires a share as carbon credits and sends you the rest. Under the steps, one line on timing: "Joins take effect from the next Thursday."                             | What happens to my votes and rewards? |
| 4     | What you keep, what you give | Three columns, plain: **You keep** your HYDX, your account, the right to leave at any time. **You give** a share of the rewards, retired; your own vote while in. **You get** the rest in kVCM, every week, with no weekly chore. Link: what kVCM is and how to swap it. | What does it cost me?                 |
| 5     | Compared with                | A short, honest table: voting yourself · a Hydrex automation that pays in a token (USDC, for example) · Carbon Impact. Rows: who votes, what you are paid in, share retired, fee, weekly effort.                                                                         | Why this rather than the others?      |
| 6     | Safe to try                  | Nothing is transferred · leave at any time, even if the page's checks fail · two calls, both shown before your wallet asks · the page checks the contracts before it lets you join · one admin key can change the settings, within limits (link to #who-controls-what)   | Can I trust it?                       |
| 7     | Questions                    | Three or four: "Can I still vote myself?" · "What happens to rewards I have not claimed?" · "What carbon credits, and where can I see them?" · "Can a DAO join from a Safe?" Each links to How it works.                                                                 | The objection I still have            |
| 8     | Go on                        | [Open the app] again, and "You need a Hydrex account: lock HYDX on Hydrex" for those without one.                                                                                                                                                                        | What now?                             |

Blocks 1 and 2 fill the first screen on a phone. Blocks 4 and 5 are where the current page is silent and where the
decision is actually made.

```
┌──────────────────────────────────┐
│ metaDEX Café     How it works [App]│
├──────────────────────────────────┤
│ Your Hydrex votes, working for    │
│ the climate.                      │
│ An automation votes with your     │
│ accounts every week, retires a    │
│ share of the rewards as carbon    │
│ credits and pays you the rest.    │
│ Your HYDX never leaves your wallet│
│                                   │
│ [ Open the app ]  How it works ›  │
├──────────────────────────────────┤
│  5,691 t          1/3 retired     │
│  retired so far   2/3 paid to you │
│                                   │
│  1.17 M EP        ends in 4d 6h   │
│  in it this epoch this epoch      │
└──────────────────────────────────┘
  ↓ How it works (3 steps)
  ↓ What you keep · what you give · what you get
  ↓ Compared with voting yourself, and other automations
  ↓ Safe to try
  ↓ Questions
  ↓ [ Open the app ]
```

## App: act and check

**Job:** a holder sees every account, where each stands and what happens next, and joins or leaves in as few steps as
the wallet allows. A member checking in gets status at a glance and leaves.

### Order

| Order | Block          | Content                                                                                                                                                                                                               |
| ----- | -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1     | Wallet         | Before connecting: the wallet buttons, first on the screen, and one line on what connecting does ("shows your accounts; asks nothing until you confirm"). After: the wallet, the address, the network warning if any. |
| 2     | Summary        | "3 accounts · 1 in Carbon Impact · 2 can join" · total Earning Power · "Payouts go to your address" (or to another, with the address).                                                                                |
| 3     | This epoch     | A timeline, not a paragraph: **now** · **vote** (just before the end) · **payout** (right after) · **next epoch starts**, with dates in local time and UTC, and a countdown. The statuses below refer to it.          |
| 4     | Your accounts  | Grouped by what can be done with them (see below), each group with its own action.                                                                                                                                    |
| 5     | Payout address | One line in the summary; the full address and what can change it here, folded.                                                                                                                                        |
| 6     | Help           | "How joining works" and "Leaving" link to How it works; where to ask a question.                                                                                                                                      |

The numbers that persuade (tonnes retired, the split) stay on Home; the App shows them once, small, under the summary.
The six disclosures move out of the page and into the review, where they apply to the accounts being changed.

### Account groups

Today's statuses, sorted into groups by what the user can do. A group with no accounts does not show.

| Group            | Statuses today           | Action               | Line under each account                                                   |
| ---------------- | ------------------------ | -------------------- | ------------------------------------------------------------------------- |
| In Carbon Impact | in                       | Leave                | "Votes with Carbon Impact. Next payout Thu 22 Oct."                       |
| Joining          | joined                   | Leave                | "Votes with Carbon Impact from Thu 22 Oct. It can claim rewards already." |
| Leaving          | left                     | Join                 | "Votes count for Carbon Impact until Thu 22 Oct. It no longer claims."    |
| Needs attention  | partly                   | Join (sets the rest) | "Only some of its approvals are set."                                     |
| Can join         | self · other · delegated | Join                 | "You vote with it." · "In the USDC automation." · "Delegated to 0x12…ab." |
| Can't join       | ended · empty            | Link to Hydrex       | "Lock ended: extend it on Hydrex." · "Empty."                             |

Ticks stay, but **inside a group**, so that one selection is always one action: "Join with 2 accounts" under Can join,
"Leave with 1 account" under In Carbon Impact. A group with one account shows a plain button and no tick. The account
card keeps today's facts: name, number, kind (Flex or Protocol, lock end), Earning Power.

```
┌──────────────────────────────────┐
│ metaDEX Café  How it works  ● 0x6970…a655 │
├──────────────────────────────────┤
│ 2 accounts · 0 in Carbon Impact   │
│ 122 Earning Power                 │
│ Payouts go to your address        │
├──────────────────────────────────┤
│ This epoch            ends 4d 6h  │
│ ●━━━━━━━━━━━━━━━━━━━━━○──○──○     │
│ now  Thu 15     vote  pay  next   │
│                 Wed 21  Thu 22    │
├──────────────────────────────────┤
│ Can join                          │
│ ☐ Account #2439   102 EP          │
│   Protocol · in the USDC automation│
│ ☐ Account #2435    20 EP          │
│   Flex, rolling · in Lock Maxi    │
│ [ Join with 0 accounts ] (off)    │
│   Tick the accounts to join.      │
├──────────────────────────────────┤
│ How joining works ›   Questions ›  │
└──────────────────────────────────┘
```

### Joining: a short guided flow

The review becomes three short steps in the same dialog (a sheet on phones), with Back at every step. It borrows option
F's "one decision per screen" without making the whole site a wizard.

1. **Before you join.** Shown first because it can only be acted on before: "Carbon Impact can claim rewards these
   accounts have not claimed yet, even those your own votes earned. To keep them as they are, claim them on Hydrex
   first." [Claim on Hydrex] · [Continue]. When an account comes from another automation, this step also says it leaves
   that automation.
2. **What changes.** A timeline for the ticked accounts: **now** Carbon Impact can claim · **Thu 22 Oct** it votes with
   them, and you can't · **every Thursday after** a third of the rewards retired, the rest to your payout address. Then
   one line on the admin key, with a link to #who-controls-what.
3. **What your wallet will ask.** Today's list of calls, decoded, and Confirm; the progress line as today. For a Safe:
   "Propose in Safe{Wallet}".

Then **Done**, in place of today's "Done.": the same timeline with "Joined" at the start, the next payout date, and "You
can leave at any time from this page." For a Safe: "Proposed. Your co-signers sign in Safe{Wallet}" and a link to How it
works to send them.

```
 Step 1 of 3                Step 2 of 3                 Step 3 of 3
┌────────────────────┐     ┌────────────────────┐      ┌────────────────────┐
│ Before you join     │     │ What changes        │      │ What your wallet    │
│                     │     │ for #2439, #2435    │      │ will ask            │
│ Unclaimed rewards   │     │ ● now   it can claim│      │ 2 transactions,     │
│ will be claimed by  │     │ ● Thu 22 it votes;  │      │ one after the other │
│ Carbon Impact, and  │     │          you can't  │      │ 1 #2439 leaves USDC │
│ swapped and retired │     │ ● weekly 1/3 retired│      │   and joins …       │
│ like the rest.      │     │          2/3 to you │      │   setConduitApp…    │
│                     │     │ Admin key can change│      │ 2 #2435 …           │
│ [Claim on Hydrex ↗] │     │ settings, within    │      │                     │
│ [Continue]  Back    │     │ limits. More ›      │      │ [Confirm 1 of 2]    │
└────────────────────┘     │ [Continue]  Back    │      │  Back               │
                           └────────────────────┘      └────────────────────┘
```

### Leaving

Leaving stays short: it gives control back, and should never feel harder than joining. One review screen: **now** Carbon
Impact can no longer claim; what it has not claimed is yours on Hydrex · **Thu 22 Oct** your votes come back to you.
Then the calls and Confirm. It works whether or not the checks pass, as today.

### States the App must design for

All exist today; the reorganisation gives each a place.

| State                               | Where it shows                                           | What the user can do                        |
| ----------------------------------- | -------------------------------------------------------- | ------------------------------------------- |
| No wallet in the browser            | Wallet block                                             | Install a wallet, or open in a wallet app   |
| Connecting, refused, failed         | Wallet block                                             | Try again, or another wallet                |
| Wrong network                       | Wallet block, and the review's button                    | Switch to Base                              |
| Safe on another network             | Wallet block                                             | Open from a Safe on Base                    |
| Reading accounts, reading failed    | Summary block                                            | Wait; try again                             |
| No account with HYDX                | Summary block, replacing the groups                      | Lock HYDX on Hydrex                         |
| Checks failed                       | Top of the App, above the summary; Join off everywhere   | Leave still works; read why on How it works |
| New epoch while open                | The timeline moves on; accounts read again on any action | Nothing; the page catches up                |
| Sent, waiting, failed, closed early | The review, then Done                                    | Follow links to the transactions            |

## How it works: read and verify

**Job:** every claim on Home and in the review has a full, linkable version here. It is where a Safe signer sends their
co-signers and where a DAO proposal links to. It is not where warnings live: anything a user must know before confirming
is in the review too.

| Section                | From today's page                                   | New                                                                                         |
| ---------------------- | --------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `#what-joining-allows` | The six disclosures of "What joining allows"        | One heading each, so each can be linked from the review                                     |
| `#timing`              | "This epoch"                                        | A worked example over two epochs: join on a Monday, what happens each day after             |
| `#who-controls-what`   | The admin key and what it can change                | Who holds it, if it can be said; the limits (100% retired, 1% fee); how a change would show |
| `#carbon`              | "Retires … in the name Hydrex"                      | What kVCM is; what is retired, where retirements can be seen; why the name is Hydrex        |
| `#verify`              | Contracts, source, the official address, the checks | How to check a build; what each check guards against                                        |
| `#questions`           | —                                                   | The FAQ, including the ones Home links to                                                   |
| `#words`               | —                                                   | Account, Flex, Protocol, Earning Power, epoch, kVCM, retire, conduit, admin key             |

## Content rules for all pages

- **Lead with what happens to the user, then how.** "A third of your rewards are retired" before "retireBps 3333".
- **Hydrex's words for Hydrex things** (Account, Earning Power, Flex, Protocol, epoch): this audience knows them.
  **Explain carbon words** (kVCM, retire, carbon credit) on first use. **Contract words** (VotingEscrow, Voter, conduit,
  routers) only in #verify and in the calls.
- **Name it once per screen.** "Carbon Impact" the first time, "it" or "the automation" after; today's page says "the
  Carbon Impact automation" 23 times.
- **Dates in the visitor's time, with UTC beside them**, and a countdown where a deadline matters.
- **Say the split as a fraction and a percentage**, and say who receives each part.

## Phasing

| Phase | Ships                                                                                                                                          | Fixes           |
| ----- | ---------------------------------------------------------------------------------------------------------------------------------------------- | --------------- |
| 1     | Home and App as separate pages (option B); disclosures moved into a three-step review; account groups; the epoch timeline; Safe App on `/app/` | P1 – P6, P10    |
| 2     | How it works with anchors, linked from Home and the review; FAQ and glossary; the carbon section; who controls what                            | P4, P8, P9, P11 |
| 3     | Data the page does not read yet: past payouts and retirements per account, an impact page; the read-only lookup by address                     | P7, P12         |
| Later | A page per automation, only if there is a second one                                                                                           | —               |

Phase 3 depends on what Base and Klima expose without a server; it is listed so that the organisation leaves room for
it, not as a commitment.

## What does not change

Two calls only; the checks, with leaving always on; no key, no server, no storage; a click before any wallet request;
the official address in the footer; the reproducible build. The reorganisation moves content, it does not add trust the
page has not earned.
