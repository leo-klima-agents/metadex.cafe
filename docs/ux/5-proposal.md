# 5. Proposal

**Three pages: Home to decide, the App to act and check, How it works to read and verify.** This is option C in
[4. Organisations](4-organisations.md), built in two steps, with a guided join flow inside the App and, because Hydrex
has disabled its automations, a clear path for holders whose automation stopped. Design and branding come later: the
wireframes below fix order, content and behaviour, not looks, and the copy in them is a placeholder that shows intent.

## Sitemap

```
metadex.cafe/                     Home            decide, move   public, no wallet, readable without the script
metadex.cafe/app/                 App             act, check     connects on a click; the Safe App opens here
metadex.cafe/how-it-works/        How it works    read, verify   public, every section has an anchor
    #if-your-automation-stopped  #what-joining-allows  #timing  #who-controls-what
    #carbon  #for-co-signers  #verify  #questions  #words
```

Kept open, not built now:

```
metadex.cafe/app/?address=0x…     the App, read-only, for any address                    (phase 3)
metadex.cafe/impact/              impact over time: tonnes per epoch, retirements          (phase 3, needs data)
metadex.cafe/<automation>/        a page per automation, if there is ever a second          (only then)
```

One origin, paths rather than subdomains: one official address to learn and check, one place for the reproducible build
to cover, one stable URL for Safe ([3. Comparable products](3-patterns.md#a-site-and-an-app)).

**Every page** has the same header and footer:

- **Header:** the name (to Home) · How it works · a button to the App ("Open the app"; on the App, the wallet's state).
- **Footer:** the official address `https://metadex.cafe/` · version and commit · source · contracts · Hydrex · Klima ·
  where to ask a question. No operator is named (a decision for now).

## Entry points

Where people come from, and where each should land. Links the team publishes should point to the landing given here.

| Arrives from                                           | Who          | Lands on                                                |
| ------------------------------------------------------ | ------------ | ------------------------------------------------------- |
| An announcement that Hydrex's automations have stopped | Maya, Theo   | `/how-it-works/#if-your-automation-stopped`, or `/app/` |
| The address typed, a search, X or Farcaster            | Everyone     | `/`                                                     |
| A bookmark, after a first visit                        | Members      | `/app/`                                                 |
| A wallet app's own browser (the Base app, MetaMask)    | Maya         | `/app/`, from a deep link                               |
| Safe{Wallet}, as a custom Safe App                     | Rafael       | `/app/`                                                 |
| Klima's site or community                              | Sofia        | `/`, then `/how-it-works/#carbon`                       |
| A question in Discord, a DAO proposal, a co-signer     | Theo, Rafael | An anchor in `/how-it-works/`                           |

**Safe{Wallet}:** the Safe App's URL becomes `https://metadex.cafe/app/`, with its `manifest.json` there. A Safe that
added the root as a custom app keeps working: in a Safe{Wallet} frame, Home sends the visitor straight on to the App.
Safe has paused new listings, so this URL is the one the README and How it works give.

## Home: decide

**Job:** in under a minute, a Hydrex holder knows what it is, what they get, what they give up and why it is safe to
try, and can choose to go on. A holder whose automation stopped learns that first. Nothing on Home asks for a wallet,
and all of it reads in the HTML, without the script; only the live numbers are filled in.

| Order | Block                        | Content                                                                                                                                                                                                                                                                                                                                                              | Answers                                   |
| ----- | ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| 1     | Promise                      | One sentence of benefit, one of mechanism ("votes every week, retires a share of the rewards as carbon credits, pays you the rest; your HYDX never leaves your wallet"). One line on what anyone can check, in place of an operator's name: the automation is Hydrex's own code, it retires through Klima, this page is open source. [Open the app] · [How it works] | What is it? Is it for me? Can I check it? |
| 2     | Your automation stopped?     | A short notice: "Hydrex's automations stopped voting on 9 Sep. If your account is in one, it has earned nothing from voting since 10 Sep." [Check my accounts] → `/app/` · [What it means] → `#if-your-automation-stopped`                                                                                                                                           | What happened to mine?                    |
| 3     | The numbers                  | Tonnes retired so far · the split, in words and percent ("a third retired, two thirds paid to you") · the Earning Power in it this epoch · this epoch ends in 4 d 6 h                                                                                                                                                                                                | Is it real? Is it alive?                  |
| 4     | How it works, in three steps | 1 It votes with your accounts each week. 2 It claims their rewards and swaps them into kVCM. 3 It retires a share as carbon credits and sends you the rest. Under the steps, one line on timing: "Joins count from the next Thursday."                                                                                                                               | What happens to my votes and rewards?     |
| 5     | What you keep, what you give | Three columns, plain: **You keep** your HYDX, your account, the right to leave at any time. **You give** a third of the rewards, retired; your own vote while in. **You get** the rest in kVCM, every week, with nothing to do. Link: what kVCM is and how to swap it.                                                                                               | What does it cost me?                     |
| 6     | Compared with                | A short, honest table: voting yourself every week · staying in a stopped automation · Carbon Impact. Rows: who votes, what you are paid in, share retired, fee, weekly effort. It may say: "If you only want the most yield and have time each Thursday, vote yourself."                                                                                             | Why this rather than the others?          |
| 7     | Safe to try                  | Nothing is transferred, and you can check it on Basescan · leave at any time, even if the page's checks fail · two calls, both shown before your wallet asks · the page checks the contracts before it lets you join · one admin key can change the settings, within limits (link)                                                                                   | Can I trust it?                           |
| 8     | Questions                    | Three or four: "Can I still vote myself?" · "What happens to rewards I have not claimed?" · "What carbon credits, and where can I see them?" · "Can a DAO join from a Safe?" Each links to How it works.                                                                                                                                                             | The objection I still have                |
| 9     | Go on                        | [Open the app] again, and "You need a Hydrex account: lock HYDX on Hydrex" for those without one.                                                                                                                                                                                                                                                                    | What now?                                 |

Blocks 1 to 3 fill the first screen on a phone. Blocks 5 and 6 are where the current page is silent and where the
decision is made. Block 2 is temporary: it goes once the holders of stopped automations have moved or stopped coming.

```
┌─────────────────────────────────────┐
│ metaDEX Café    How it works  [App] │
├─────────────────────────────────────┤
│ Your Hydrex votes, working for      │
│ the climate.                        │
│ An automation votes with your       │
│ accounts every week, retires a      │
│ share of the rewards as carbon      │
│ credits and pays you the rest.      │
│ Your HYDX never leaves your wallet. │
│                                     │
│ [ Open the app ]    How it works ›  │
├─────────────────────────────────────┤
│ ! Hydrex's automations stopped      │
│ voting on 9 Sep. Is your account in │
│ one? It has earned nothing since.   │
│ Check accounts ›    What it means › │
├─────────────────────────────────────┤
│  5,691 t           1/3 retired      │
│  retired so far    2/3 paid to you  │
│  1.17 M EP         ends in 4 d 6 h  │
│  in it this epoch  this epoch       │
└─────────────────────────────────────┘
  ↓ How it works (3 steps)
  ↓ What you keep · what you give · what you get
  ↓ Compared with voting yourself, and with a stopped automation
  ↓ Safe to try
  ↓ Questions
  ↓ [ Open the app ]
```

## App: act and check

**Job:** a holder sees every account, where each stands and what happens next, and joins or leaves in as few steps as
the wallet allows. A member checking in gets status at a glance and leaves.

### Order

| Order | Block          | Content                                                                                                                                                                                                                                                                                                                   |
| ----- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1     | Wallet         | Before connecting: the wallet buttons, first on the screen, and one line on what connecting does ("shows your accounts; asks nothing until you confirm"). With no wallet found: links that reopen the page in the Base app or MetaMask, rather than only "install a wallet". After: the wallet, the address, the network. |
| 2     | Summary        | "3 accounts · 1 in Carbon Impact · 2 in an automation that stopped" · total Earning Power · "Payouts go to your address" (or to another, with the address).                                                                                                                                                               |
| 3     | This epoch     | A timeline, not a paragraph: **now** · **vote** (just before the end) · **payout** (right after) · **next epoch starts**, each as "Thu 22 Oct, 00:00 UTC (Wed 21 Oct, 20:00 your time)", and a countdown. The statuses below refer to it.                                                                                 |
| 4     | Your accounts  | Grouped by what can be done with them (below), each group with its own action.                                                                                                                                                                                                                                            |
| 5     | Payout address | One line in the summary; the full address and what can change it here, folded.                                                                                                                                                                                                                                            |
| 6     | Help           | "How joining works" and "Leaving" link to How it works; where to ask a question.                                                                                                                                                                                                                                          |

The numbers that persuade (tonnes retired, the split) stay on Home; the App shows them once, small, under the summary.
The six disclosures move out of the page and into the review, where they apply to the accounts being changed.

### Account groups

Today's statuses, sorted into groups by what the user can do, in this order. A group with no accounts does not show.
Every status says what it means for votes and rewards, in words, with the date of the next change; colour, if any, comes
later and never alone.

| Group                         | Statuses today                     | Action               | Line under each account                                                                               |
| ----------------------------- | ---------------------------------- | -------------------- | ----------------------------------------------------------------------------------------------------- |
| In an automation that stopped | other (a stopped automation)       | Join, or leave it    | "In USDC, which has not voted since 9 Sep: this account has earned nothing from voting since 10 Sep." |
| Needs attention               | partly                             | Join (sets the rest) | "Only some of its approvals are set."                                                                 |
| In Carbon Impact              | in                                 | Leave                | "Votes with Carbon Impact. Last payout 23 Sep." (once the page can read payouts)                      |
| Joining                       | joined                             | Leave                | "Votes with Carbon Impact from Thu 22 Oct. It can claim rewards already."                             |
| Leaving                       | left                               | Join                 | "Votes count for Carbon Impact until Thu 22 Oct. It no longer claims."                                |
| Can join                      | self · other (running) · delegated | Join                 | "You vote with it." · "In …" · "Delegated to 0x12…ab."                                                |
| Can't join                    | ended · empty                      | Link to Hydrex       | "Lock ended: extend it on Hydrex." · "Empty."                                                         |

The page can tell a stopped automation from a running one without keeping a list: Hydrex's Voter exposes
`lastVoted(address)`, and an automation that has not voted since the start of the previous epoch has stopped. "Leave it"
is the same call as leaving Carbon Impact, with the stopped automation's address; it gives the votes back to the owner
from the next epoch ([7. On-chain checks](7-onchain-checks.md)).

The App states the last payout it can see rather than promising the next one: Base shows no Carbon Impact payout since
23 September. Until the page can read payouts (phase 3), the line says only what the automation does and when it votes.

Ticks stay, but **inside a group**, so that one selection is always one action: "Join with 2 accounts" under a group
that can join, "Leave with 1 account" under In Carbon Impact. A group with one account shows a plain button and no tick.
The account card keeps today's facts: name, number, kind (Flex or Protocol, lock end), Earning Power.

```
┌─────────────────────────────────────┐
│ metaDEX Café          ● 0x6970…a655 │
├─────────────────────────────────────┤
│ 2 accounts · 2 in automations that  │
│ stopped · 122 Earning Power         │
│ Payouts go to your address          │
├─────────────────────────────────────┤
│ This epoch             ends 4 d 6 h │
│ ●━━━━━━━━━━━━━━━━━━━━━━○───○───○    │
│ now  Thu 15      vote  pay  next    │
│                  Wed 21  Thu 22     │
├─────────────────────────────────────┤
│ In an automation that stopped       │
│ ☐ Account #2439      102 EP         │
│   Protocol · in USDC, which has not │
│   voted since 9 Sep: earns nothing  │
│ ☐ Account #2435       20 EP         │
│   Flex, rolling · in Lock Maxi,     │
│   stopped 9 Sep: earns nothing      │
│ [ Join with 0 accounts ] (off)      │
│   Tick the accounts to join.        │
│   Or leave them, to vote yourself › │
├─────────────────────────────────────┤
│ How joining works ›    Questions ›  │
└─────────────────────────────────────┘
```

### Joining: a short guided flow

The review becomes three short steps in the same dialog (a sheet on phones), with Back at every step. It borrows option
F's "one decision per screen" without making the whole site a wizard, and keeps the plain-language explanation next to
Confirm, since the wallet will show only a raw or decoded call that moves no tokens.

1. **Before you join.** Shown first because it can only be acted on before: "Carbon Impact can claim rewards these
   accounts have not claimed yet, even those your own votes earned. To keep them as they are, claim them on Hydrex
   first." [Claim on Hydrex] · [Continue]. For an account from a stopped automation, it says that what the automation
   left unclaimed before it stopped can still be claimed on Hydrex, and that nothing has accrued since. For an account
   in a running automation, it says the account leaves it.
2. **What changes.** A timeline for the ticked accounts: **now** Carbon Impact can claim · **Thu 22 Oct** it votes with
   them, and you can't · **every Thursday after** a third of the rewards retired, the rest to your payout address. Then
   one line on the admin key, with a link to `#who-controls-what`.
3. **What your wallet will ask.** Today's list of calls, decoded, and Confirm; the progress line, with an outcome per
   account when there are several. For a Safe: "Propose in Safe{Wallet}". Later, a wallet that can batch calls
   (EIP-5792) could sign all accounts in one prompt.

Then **Done**, in place of today's "Done.": the same timeline with "Joined" at the start, the next payout date, and "You
can leave at any time from this page." For a Safe: "Proposed. Your co-signers sign in Safe{Wallet}", a waiting state
until it executes, and a link to `#for-co-signers` to send them.

```
 Step 1 of 3                Step 2 of 3                Step 3 of 3
┌──────────────────────┐   ┌──────────────────────┐   ┌──────────────────────┐
│ Before you join      │   │ What changes         │   │ What your wallet     │
│                      │   │ for #2439, #2435     │   │ will ask             │
│ Unclaimed rewards    │   │ ● now   it can claim │   │ 2 transactions,      │
│ will be claimed by   │   │ ● Thu 22 it votes;   │   │ one after the other  │
│ Carbon Impact, and   │   │          you can't   │   │ 1 #2439 leaves USDC  │
│ swapped and retired  │   │ ● weekly 1/3 retired │   │   and joins …        │
│ like the rest. What  │   │          2/3 to you  │   │   setConduitApp…     │
│ the stopped          │   │ Admin key can change │   │ 2 #2435 …            │
│ automations left     │   │ settings, within     │   │                      │
│ unclaimed can still  │   │ limits. More ›       │   │ [Confirm 1 of 2]     │
│ be claimed first.    │   │ [Continue]  Back     │   │  Back                │
│ [Claim on Hydrex ↗]  │   └──────────────────────┘   └──────────────────────┘
│ [Continue]  Back     │
└──────────────────────┘
```

### Leaving

Leaving stays short: it gives control back, and should never feel harder than joining. One review screen: **now** Carbon
Impact can no longer claim; what it has not claimed is yours on Hydrex · **Thu 22 Oct** your votes come back to you, and
you will need to vote each week or choose another automation. Then the calls and Confirm. It works whether or not the
checks pass, as today.

### States the App must design for

All exist today; the reorganisation gives each a place.

| State                                | Where it shows                                           | What the user can do                        |
| ------------------------------------ | -------------------------------------------------------- | ------------------------------------------- |
| No wallet in the browser             | Wallet block                                             | Reopen in a wallet app; install a wallet    |
| Connecting, refused, failed          | Wallet block                                             | Try again, or another wallet                |
| Wrong network                        | Wallet block, and the review's button                    | Switch to Base                              |
| Safe on another network              | Wallet block                                             | Open from a Safe on Base                    |
| Reading accounts, reading failed     | Summary block                                            | Wait; try again                             |
| No account with HYDX                 | Summary block, replacing the groups                      | Lock HYDX on Hydrex                         |
| Checks failed                        | Top of the App, above the summary; Join off everywhere   | Leave still works; read why on How it works |
| New epoch while open                 | The timeline moves on; accounts read again on any action | Nothing; the page catches up                |
| Sent, waiting, failed, closed early  | The review, then Done                                    | Follow links to the transactions            |
| Proposed in a Safe, not yet executed | Done, then the account's line                            | Send co-signers the link; wait              |

## How it works: read and verify

**Job:** every claim on Home and in the review has a full, linkable version here. It is where a Safe signer sends their
co-signers, where a DAO proposal links to, and where an announcement about Hydrex's automations points. It is not where
warnings live: anything a user must know before confirming is in the review too.

| Section                       | From today's page                                   | New                                                                                                                                                                                                                                                                                             |
| ----------------------------- | --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `#if-your-automation-stopped` | —                                                   | When each automation last voted; that an account in one has earned nothing from voting since 10 Sep, and its old votes count for nothing; that the stopped automation still holds its approvals; that leftovers can be claimed on Hydrex; the choices: leave it and vote yourself, or join here |
| `#what-joining-allows`        | The six disclosures of "What joining allows"        | One heading each, so each can be linked from the review                                                                                                                                                                                                                                         |
| `#timing`                     | "This epoch"                                        | A worked example over two epochs: join on a Monday, what happens each day after; join on a Thursday                                                                                                                                                                                             |
| `#who-controls-what`          | The admin key and what it can change                | The limits (up to 100% retired, up to 1% fee); how a change would show on Base; that the page names no operator                                                                                                                                                                                 |
| `#carbon`                     | "Retires … in the name Hydrex"                      | What kVCM is; what is retired and where each retirement's certificate can be seen; the names on each retirement ("Hydrex", no beneficiary name) and why they are the same for every member                                                                                                      |
| `#for-co-signers`             | —                                                   | One screen for a second reader: what the Safe transaction does, what it allows, how to undo it                                                                                                                                                                                                  |
| `#verify`                     | Contracts, source, the official address, the checks | How to check a build; what each check guards against; how to see on Basescan that nothing was transferred                                                                                                                                                                                       |
| `#questions`                  | —                                                   | The FAQ, including the ones Home links to                                                                                                                                                                                                                                                       |
| `#words`                      | —                                                   | Account, Flex, Protocol, Earning Power, epoch, kVCM, retire, conduit, admin key                                                                                                                                                                                                                 |

## Content rules for all pages

- **Lead with what happens to the user, then how.** "A third of your rewards are retired" before "retireBps 3333".
- **Hydrex's words for Hydrex things** (Account, Earning Power, Flex, Protocol, epoch, payout): this audience knows
  them. **Explain carbon words** (kVCM, retire, carbon credit) on first use. **Contract words** (VotingEscrow, Voter,
  conduit, routers) only in `#verify` and in the calls.
- **Be the reference on this automation.** What Hydrex still publishes about Carbon Impact is out of date (it lists
  AZUSD); the site states what the contract does today and says it reads it from Base.
- **Name it once per screen.** "Carbon Impact" the first time, "it" or "the automation" after; today's page says "the
  Carbon Impact automation" 23 times.
- **Dates as weekday, day and time with the zone, then the visitor's time, then how far off:** "Thu 22 Oct, 00:00 UTC
  (Wed 21 Oct, 20:00 your time) · in 4 d 6 h". Never "midnight".
- **Say the split as a fraction and a percentage**, and say who receives each part.
- **One impact unit: tonnes,** each figure linked to where it can be checked.

## Phasing

Problem numbers refer to [the audit](1-audit.md).

| Phase   | Ships                                                                                                                                                                                                                                                         | Fixes             |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- |
| 0       | Now, on today's page: say when an account is in an automation that has stopped voting, read from Hydrex's Voter                                                                                                                                               | P1                |
| 1       | Home and App as separate pages (option B), with Home's notice for stopped automations; disclosures moved into a three-step review; account groups; the epoch timeline; wallet-app links; Safe App on `/app/`                                                  | P2 – P7, P11, P13 |
| 2       | How it works with anchors, linked from Home, the review and announcements; the carbon section; who controls what; for co-signers; FAQ and glossary                                                                                                            | P9, P10, P12, P14 |
| 3       | Data the page does not read yet: past payouts and retirements per account, with links to certificates, and an impact page (needs an RPC that serves logs); the read-only lookup by address; batched signing where wallets allow; a Base or Farcaster mini app | P8, P15           |
| Not now | "Sign in with Base" and WalletConnect outside a wallet app's browser (an SDK and a relay, against "no server")                                                                                                                                                | P11, in part      |
| Later   | A page per automation, only if there is a second one                                                                                                                                                                                                          | —                 |

Phase 0 is a status line and one read of Hydrex's Voter; it helps the holders arriving now, before any reorganisation.
Phase 3 depends on what Base and Klima expose without a server; it is listed so that the organisation leaves room for
it, not as a commitment.

## Decisions

Taken by the team, or answered on Base ([7. On-chain checks](7-onchain-checks.md)):

| Question                                              | Decision                                                                                                                                                                                                                     | What it changes                                                                                                                                  |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Who runs it?                                          | Anonymous for now.                                                                                                                                                                                                           | No operator on any page. Trust rests on what anyone can check, so "Safe to try" on Home and `#verify` carry more weight (P10 stays partly open). |
| Whose name is on the retirements?                     | Stays "Hydrex". The admin key can change the names, but only for every member at once; a name per member would need a new automation contract.                                                                               | `#carbon` says whose names they are and why. No personal certificate in the App.                                                                 |
| Smart wallets and WalletConnect outside a wallet app? | Not now.                                                                                                                                                                                                                     | Links that reopen the page in a wallet app instead.                                                                                              |
| What happens to an account in a stopped automation?   | Its old votes count for nothing and it has earned nothing from voting since 10 Sep; the stopped automation still holds its approvals; the owner can claim what was left unclaimed, and can leave or join another automation. | The wording of Home's notice, the App's first group and step 1 of the review, as above.                                                          |

Still open:

1. **How strongly to address holders of stopped automations,** and with Hydrex's agreement or not: a notice on Home, an
   announcement, a link from Hydrex's own app.
2. **Payouts.** Base shows no Carbon Impact payout since 23 September. That is for the team to look into, not for the
   site to organise around; but until payouts can be read, the App must not promise a next one.

## What does not change

Two calls only; the checks, with leaving always on; no key, no server, no storage; a click before any wallet request;
the official address in the footer; the reproducible build. The reorganisation moves content, it does not add trust the
page has not earned.
