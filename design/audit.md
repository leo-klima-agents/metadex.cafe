# Audit

Everything the page shows today, and what happens to it in the redesign towards minimalism: kept, moved, merged,
rewritten or cut. It is written for whoever implements the redesign. Where it disagrees with [README.md](README.md),
[brand.md](brand.md) or the repository's [README](../README.md), this file wins until they are updated, which is part of
the work: see [Docs to update](#docs-to-update).

Read from version 0.5.1, commit `682c47e`, on 20 Oct 2026: every view at 1280 and 390 px wide, without a wallet, and
with two owners' wallets on Base. One holds an account in Matcha Latte and an account that votes itself; the other holds
two accounts in automations that stopped.

## Second pass: fewer words

Done on 21 Oct 2026, from version 0.6.4, and made stricter the same day after review. Where it disagrees with the rest
of this file, it wins.

- **No sentence that the page's controls already say.** A view is its heading, then what you act on. Home is "Vote,
  claim and swap on Base" and its one button, which stands in for the header's: no lead, and no line on the stopped
  automations, which the App's Needs you shows to the owners they concern. No hints such as "Tick the accounts to
  change".
- **Labels, not prose.** What a product does is in its figures: Takes, Pays in, Last epoch, then Retired or Controlled
  by. Each choice on the menu has the first three. Matcha Latte's name sits beside "33.33% retired" and "Pays in kVCM",
  which say what it does ([brand.md](brand.md#what-the-page-may-claim)).
- **The only sentences left warn of what cannot be undone:** in the join review, that joining also lets the automation
  claim the rewards not claimed yet, with "Claim them on Hydrex first".
- **Folds hold the rest, closed, as rows of a label and a value:** fees, the record against all of Hydrex, joining and
  leaving, who controls what, the carbon credits, the checks, About's facts, each call's fields in the review. They keep
  every address, hash and check, and drop the explanations. An address that points into a fold opens it.
- **Statuses and messages in a word or two:** "In USDC · stopped Wed 9 Sept", "Payout late", "Reading the payouts
  failed. Try again", "Checking…". Only the exception is said: the swap's review says "Not simulated" when it could not
  run the swap through Base, and nothing when it could. A token's row says why it is not ticked, and not its route,
  which the review shows.
- **One look everywhere:** one spacing scale, one radius, a card for every item of a list (choices, accounts, tokens,
  what needs you, approvals, folds), h1 and h2 in Young Serif, everything else in the sans, labels in the mono.

Measured with a wallet on Base, at 1280 px: words shown on Home went from 60 to 8, on About from 558 to 24, on Carbon
Impact's page from 221 to 76, on the accounts of a wallet with stopped automations from 227 to 98, and in the join
review from 178 to 50.

## Third pass: details on demand

The owner's review of the second pass, on 21 Oct 2026: a group's heading read as a link and a heading at once; every
page led back to "App", which Home already is once a wallet is connected; and the folds still showed too much.

- **Details open from an info button, as a popup.** A small round "i" sits beside what it explains: the status, a key
  figure, a group of accounts, About's rows. It opens a popup over the page with a title and a close button, light to
  dismiss; on a phone, a sheet from the foot of the screen. Nothing of the details shows until then: no folds, no
  summaries. An address still points into one, such as `#hydrex/matcha-latte/check`, and opens it; it goes from the
  address once the popup closes. A browser without popups shows them at the foot of the view, and hides the buttons.
- **A call's fields** in the review open from the same button, at the corner of its slip.
- **Home is the App once a wallet is connected,** so the name in the header leads there. The breadcrumb is gone: a page
  within Hydrex has one link back to it, "‹ Hydrex", and the others have none.
- **Addresses, not code hashes.** A contract shows by its address, linked to its code, verified on Basescan; the page
  shows no code hash. An address is "0x", then groups of four. It stays on one line where it fits; otherwise it breaks
  once, in the middle, its second half's groups under the first's, both halves ending flush.
- **The swap's costs, each as one row:** its fee, pools' fees, price impact, slippage and gas. Its fee is in its code,
  so no row says who can change it. Its contracts are listed by name, without numbers, in the order the page checks
  them: the swappers, then the exchanges, from Aero's to Hydrex's.
- **About** keeps the official address, the cookies stored (none), the version and where its figures come from.
- **A heading is never a link.** The groups of accounts are plain headings; a card that leads somewhere is a card, with
  a chevron at its end, its title in the ink colour.

## Givens

- The page is not published. No address, anchor or link has to keep working.
- Views may need the script. The rule that every view works without it is dropped.
- The page's other rules stand: no server, nothing stored, three RPCs and nothing else, the checks before anyone can
  join, leaving always works, each call shown before the wallet asks, and each status as a shape and words.

Settled by the owner on 20 Oct 2026:

- **Matcha Latte is Hydrex's automation,** even though Hydrex no longer sends its votes: an operator does. The page says
  "Hydrex's automation" wherever it says whose it is, never "Klima's".
- **The café is anonymous for now.** The page names nobody, neither who runs the café nor who runs Matcha Latte as its
  operator, and links to no repository of the café's: neither this one nor Double Espresso's. This repository is public,
  but nothing on the page leads to it. Each automation's contract links to its code on Basescan, and the commit leaves
  the footer. See rule 10.
- **Double Espresso's source is verified, with an exact match, on Basescan and on Sourcify.** The page links to it
  there, not to its repository. Its verified files name no author and no repository: checked on 20 Oct 2026.
- **No legal pages for now:** no terms, and no page on privacy.

## What is wrong today

| View              | Desk, 1280 px | Phone, 390 × 844      |
| ----------------- | ------------- | --------------------- |
| Home              | 3,764 px      | 5,390 px, 6.4 screens |
| How it works      | 9,324 px      | 12,596 px, 15 screens |
| App, two accounts | 2,347 px      | 2,915 px, 3.5 screens |
| Double Espresso   | 2,302 px      | 3,240 px, 3.8 screens |
| Matcha Latte      | 1,400 px      | 1,858 px, 2.2 screens |

1. **One fact, many places.** On Home, what Matcha Latte does is said at least five times: the heading's paragraph, its
   card, the three steps, what you keep, give and get, and the comparison. The share it retires shows five times. The
   choices are compared three ways: Home's cards, Home's table and the table in Choose. "If you only want the most… vote
   yourself" is on Home twice, and "Open the app" three times.
2. **Matcha Latte everywhere, though there are two automations.** Home's heading, the meta description, How it works
   ("Everything Home and the review say about Matcha Latte"), its questions, the footer's contracts, and the App's
   timeline of the epoch ("Matcha Latte votes with its accounts"), which every wallet sees. "If your automation stopped"
   still says Matcha Latte "is the one that still votes", and offers it as the only way out besides voting yourself. The
   App tells an owner with no account in Matcha Latte that "Matcha Latte pays out to your address", and gives its tonnes
   retired.
3. **Your accounts come late.** On a phone, the App's first screen shows the address in full, a summary, Matcha Latte's
   tonnes and the timeline of the epoch, and no account.
4. **Method before result.** The App's payouts open with almost 100 words on how the page decides an epoch was paid.
   Each account in a stopped automation repeats the sentence its group has just said.
5. **Two models for one thing.** Double Espresso's page holds its own facts. Matcha Latte's page is a stub that links to
   five sections of How it works. The join review shows Double Espresso's fee facts, and not Matcha Latte's.
6. **Words of the page's own.** "The flip", and a glossary of twelve words, where a date would do: the page knows when
   the next epoch starts.
7. **Content in conflict.** Matcha Latte's page calls it "Klima's automation". How it works calls it "a contract of
   Hydrex's", and Questions says that the automation is Hydrex's. Settled: it is Hydrex's.
8. **A crowded header.** On a phone, How it works and the button push the header onto two lines.

## The new structure

Two axes:

- **The menu:** the products, to browse. Each level down shows more, and the most technical comes last, folded.
- **Your accounts:** flat. Once a wallet is connected, the App starts with them, and each is one tap from the App.

### Addresses

| Level | Address                                           | Page                                                                                             |
| ----- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| 0     | `#`, or none                                      | Home                                                                                             |
| 1     | `#app`                                            | The App: your accounts, then the menu                                                            |
| 1     | `#about`                                          | About                                                                                            |
| 2     | `#hydrex`                                         | Not built yet: shows the App. A protocol's page comes with a second protocol, such as Aero.      |
| 3     | `#hydrex/matcha-latte`, `#hydrex/double-espresso` | A product                                                                                        |
| 4     | `#hydrex/9540`                                    | A position: one Hydrex account, whichever product it is in                                       |
| 5     | `#hydrex/9540/2026-10-22`                         | A receipt, once the page reads more than the last one. Until then, it is on the position's page. |
| any   | `#<page>/<section>`                               | The page, scrolled to one of its sections, with the section's fold open, such as `#about/check`  |

- A position's address carries the protocol, not the product. An account moves between products, and its address must
  neither change nor lie when it does.
- The protocol is in every address from now, since account numbers are per protocol, so that adding Aero changes no
  address.
- A level that would hold fewer than three things is not built. That is why there is no protocol page yet.
- Sections: a product's are `fees`, `control` and `check`, in one popup, then `record`, and Double Espresso's `votes` in
  it; About's are `check`, `safe` and `figures`.
- An address the page does not know shows Home.
- Inside Safe{Wallet}, the page opens on the App, as today.

### Navigation

- **The header:** the name, which leads Home, and one button: "Open the app", or the wallet chip once connected. Nothing
  else.
- **A breadcrumb** on every page below the App: "App › Matcha Latte", "App › Account #9540". In Safe{Wallet}'s frame and
  in wallets' browsers there is no address bar, and Back is not to be relied on.
- **The footer:** the official address; the version, which leads to `#about/check`; and About. No commit: see rule 10.
- **Folds** (`<details>`) hold the technical parts of a page. An address that points into a fold opens it, as
  `views/router.ts` does today.

### Home

Only these, in this order:

1. The heading: what the café is, for every product. Proposed: "Automations that vote with your Hydrex accounts".
2. One line: "Your account stays in your wallet, and you can leave with one call, at any time."
3. "Open the app".
4. The stopped automations, in one line with the triangle: "Many of Hydrex's automations, such as USDC, stopped voting
   on Wed 9 Sep. An account still in one earns nothing.", then "Check your accounts", which leads to the App. Not
   "Hydrex's own": Matcha Latte is Hydrex's too, and still votes. It stays until the owner removes it.

No figures, no menu, no questions. A connected visitor sees the same Home, with the wallet chip in the header.

### The App

Without a wallet:

1. "Your accounts", the wallet buttons, and one line: "Pick your wallet to see your Hydrex accounts. It is asked nothing
   else until you confirm a change." Then the notices for no wallet and a failed connection, as today.
2. The menu.

With a wallet:

1. "Your accounts".
2. Notices, each in one line, only when they apply: the wallet is on another network; joining a product is off because
   its checks failed ("Joining Matcha Latte is off: this page's checks of it failed. Leaving works."), with a link to
   its `check`; a payout is under way.
3. One line: "This epoch ends Thu 22 Oct, 00:00 UTC, in 1 d 3 h. A change made now moves the votes from then."
4. The groups, below.
5. The menu, last.

With no account holding HYDX: today's `#none` line, then the menu.

The groups show only when they hold accounts, with the count in their heading:

| Group                                        | Holds today's groups                                                                                        | Its actions                                                                                                   |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| What needs you, a group for each remedy      | Accounts whose owner did not vote, `stopped`, `attention` (partly in): each in its own, in that order       | Join Matcha Latte, Join Double Espresso, Leave; or, for those not voted with, Vote on Hydrex instead of Leave |
| **Matcha Latte**, which leads to its page    | `in:matcha-latte`, and `joining` into it; empty or ended accounts that still approve it stay here           | Leave, Move to Double Espresso                                                                                |
| **Double Espresso**, which leads to its page | `in:double-espresso`, and `joining` into it, as for Matcha Latte                                            | Leave, Move to Matcha Latte                                                                                   |
| **Other accounts**                           | `open` (votes itself, delegated to an address, in a running automation of Hydrex's), and `leaving`          | Join Matcha Latte, Join Double Espresso, Leave                                                                |
| A fold: "3 Hydrex accounts without votes"    | `closed` (empty, its lock ended, or less than a vote, then "with less than one vote"; none needs its owner) | None                                                                                                          |

- What needs you comes first, with no heading over it: a group for each remedy, each under its own heading at the level
  of the others, "Didn't vote last epoch", "In a stopped automation", "Partly in an automation", in the App's order.
  Their Leave, "Leave automation" in the stopped group, leaves whichever automation holds each account:
  `review(accounts, "self")` already leaves both the page's and Hydrex's.
- Other accounts' Leave shows only for an account in one of Hydrex's running automations, and takes it out of it.
- Boxes to tick, and the hint, stay as today: one selection, one action.
- A row: the account's name and number, which lead to its page; its votes; what its votes earned last epoch. A status
  only where the group does not already say it: joining ("votes from Thu 22 Oct"), leaving, partly in, a late payout
  (triangle), which automation stopped ("In USDC · stopped 9 Sep"), the address it is delegated to. The kind of lock
  goes to the account's page.

### The menu

One list, the same in the App with or without a wallet, with one row per choice at every width. Today's grid of cards
leaves "Vote yourself" alone on a row on a desk. Each choice has:

- its name, which leads to its page;
- its status: the shape, its words and the day it last voted ("Running · voted Wed 14 Oct"), or "Checks failed: joining
  off" with the square;
- one sentence: what it does, and what it pays in;
- **Takes:** "33.33% retired, and a fee of 0%", "1% of each claim", or "Nothing";
- **Last epoch, per 1,000 votes:** "≈ $0.77 earned, ≈ $0.51 paid to you", "No record yet", or "Depends on your votes".

"Vote yourself" is one of the choices, with no page of its own. It is the only place that says "If you only want the
most, and have time each week, vote yourself."

### A product

One template for every product, in this order. Visible:

1. The breadcrumb, the name, and its status.
2. One sentence: what it does, and what it pays in. A product name the law covers, such as "Matcha Latte", always has
   this sentence beside it ([brand.md](brand.md#what-the-page-may-claim)).
3. One line: "Your account stays in your wallet. Leave with one call, at any time: claims stop at once, and your votes
   come back on Thu 22 Oct, 00:00 UTC."
4. With a wallet: your accounts in it, which lead to their pages, and Join for those that can join, with boxes to tick
   when there are several. Without a wallet: the wallet buttons. They are the App's parts, not copies.
5. **Last epoch:** the menu's line, as Hydrex's page has it: per 1,000 votes, against Hydrex's average. Matcha Latte
   adds "Retired so far: 5,691 tonnes of carbon credits", with Klima's mark and "through Klima Protocol".
6. **Costs and contracts** (`fees`), from the info button beside its name, as the swap's popup: its costs (for Matcha
   Latte, up to its share retired, its payout fee and the swap costs; for Double Espresso, its fee on claims); who can
   change it (`control`): for Matcha Latte, Hydrex and its operator, without naming who that is; for Double Espresso,
   nothing, as it is immutable, while anyone can propose its votes; then its contract and its fee recipient, short
   (`check`). The checks are not listed: Hydrex's page says why joining is off when one fails.

Then one fold, closed:

7. **Performance** (`record`): the table of today's `#last-epoch`, read only once the fold opens, as it costs about
   10,000 reads; the sentence that compares; "Earned by its votes, not paid to you"; then the pools it voted for. Every
   product has it.

Joining and leaving, the carbon credits, Hydrex's contracts and the calls are no longer popups of their own: the line on
custody and the review say when joining counts and what happens to the rewards not claimed yet, and the review shows
each call in full before it is signed.

### A position

`#hydrex/<id>` shows to anyone. Its actions show only to the wallet that owns it, or the Safe that does.

1. The breadcrumb, then the account's name and number.
2. Its status, with a link to its product: "In Matcha Latte", "You vote with it", "In USDC, which stopped voting on Wed
   9 Sep".
3. Its kind of lock, its votes, what its votes earned last epoch, and its owner, in the short form, when it is not the
   wallet connected.
4. Its actions, as in its group, for this account alone.
5. In a stopped automation: what that means, in three lines (its votes count for nothing; it has earned nothing since
   Thu 10 Sep; you can't vote with it while that automation holds its votes), and that what the automation left
   unclaimed can be claimed on Hydrex first.
6. In an automation, or just out of one: its payouts, as today: its standing (paid up to, late, not paid yet, nothing to
   pay, not final yet, not read), what waits, the notes on claims made elsewhere, then the receipt of its last payout.

Reading an account by its number is new: its owner, then the reads `readAccounts` makes for each account. Its payouts
are read for that one account, where `last-payout.ts` reads an owner's.

### About

1. What the café is, and that it is independent: not Hydrex's, not Dromos's. It names no operator.
2. The official address, and why to check it: anyone can host a changed copy.
3. What it does not do: no server, nothing stored, transactions only and never signatures, and nothing asked of the
   wallet until it is picked. What it reads, and from where: the three RPCs, by name.
4. **Check this page** (`check`): the version, and that the browser checks the script and the stylesheet against hashes
   in the page before it runs them. Not the reproducible build: without the source, which the page does not link, no
   visitor can rebuild it. The README keeps it, for whoever runs the site.
5. **From a Safe** (`safe`): add the page as a custom Safe App; it proposes one Safe transaction for all the accounts.
6. If this page goes away: the accounts stay as they are, and leaving is one call that any contract interface, such as
   Basescan's, can make.
7. **How the figures are read** (`figures`), the one place for the page's methods: the prices (each token's average over
   the half hour before the epoch ended, in the deepest of Hydrex's pools; Chainlink for WETH and cbBTC; the depth a
   pool needs; and that a token without one counts for nothing); fees and incentives, and why Hydrex's own figures are
   lower; when the page counts an epoch as paid; and why what waits to be claimed is a floor. Figures marked "≈"
   elsewhere can link here.

### The review

Joining takes two steps instead of three:

1. **Before you join**, today's "Before you join" and "What changes" in one, in this order:
   - the rewards not claimed yet, in bold, with "Claim on Hydrex", as today;
   - for the accounts picked, at last epoch's rate: "≈ $0.18 a week would reach you. The change costs < $0.01 in gas. An
     estimate, not a promise." These figures are Choose's;
   - the timeline, with its dates: now, the next epoch, after each epoch;
   - one line on what it takes and who can change it. Matcha Latte: "It retires 33.33% of the rewards, and takes a fee
     of 0%. Hydrex can raise them to 100% and 1%, and change the payout tokens, the swap routers and your payout
     address." Double Espresso: "It takes 1% of each claim. Nobody can change that.";
   - the notes on accounts in a stopped or a running automation, as today.

   Every product has the same parts. The full fee facts are on the product's page, so Double Espresso's review no longer
   copies them.

2. **What your wallet will ask:** as today. "How to check these calls" leads to the product's `check`.

Leaving stays one step; its link leads to the product's `joining`. The last screen stays; in a Safe, the link for
co-signers leads to the product's `check`.

### Choose

Today, a Choose button sits beside Join and Leave in the App's groups. For the accounts ticked, it opens a dialog with a
card for each choice: each automation, and voting yourself. A card gives last epoch's figure per 1,000 votes, what a
week at that rate would pay those accounts, the gas of the change, and a button to make it. Under the cards, a folded
table compares what each pays in, what it takes, the most it can take, and leaving.

Cut: the Join buttons beside it already make the change, and it is the third place that compares the choices. Its parts
go:

- **Last epoch, per 1,000 votes:** the same for everyone, so it goes on the menu.
- **A week for the accounts ticked, and the gas:** they depend on the accounts, so they go in the review's first step,
  for the product being joined.
- **The table:** the menu compares the choices, and each product's page has its fee facts.

To join, it goes from tick, Choose, a card's button, three steps of review, then the wallet; to tick, Join, two steps of
review, then the wallet. What is lost: the weekly estimate for the accounts ticked shows for one product at a time.

## Rules for every page

1. **One fact, one place.** A figure or a claim shows once on a page, and on one level; elsewhere, a link leads to it.
   The review repeats, on purpose, what someone must see before they agree: the rewards not claimed yet, who can change
   what, and leaving.
2. **Plain first, proof folded.** What shows answers the page's question. Methods and proofs go in folds at its foot, or
   in About.
3. **Dates, not rules.** "Thu 22 Oct, 00:00 UTC", not "the next flip". "The flip" leaves the page's words.
4. **A share once:** "33.33%", not "a third (33.33%)". `share()` in `format.ts` changes.
5. **Addresses in full only where someone checks them:** in `check`, the call slips and the receipts. Elsewhere, a name
   with a link, or the short form. The connected address is in the header's chip only. A link around an address in
   groups of four has one underline, not one for each group.
6. **One status per row,** as a shape and words, and none that repeats its group's heading.
7. **Nothing that sells inside the App:** no tonnes retired, and no pitch for one product. Klima's mark stays beside a
   retirement only: on Matcha Latte's page and on its receipts.
8. **Plain words.** Account, votes, epoch, Flex and Protocol Account, as Hydrex uses them. No glossary.
9. **Heights on a phone,** 390 × 844: Home in one screen; the App, with a wallet, shows its first account in the first
   screen; a product's page in two screens with its folds closed; a position's in two, with its receipt.
10. **Anonymous.** Nobody named, neither who runs the café nor Matcha Latte's operator; Hydrex is named as the one who
    controls its settings. No link to this repository or to Double Espresso's, `github.com/ldeso/hydrex-conduit`, and no
    commit hash, which could be searched for. Each automation's contract links to its code on Basescan, where Double
    Espresso's is verified. Links that a visitor follows need no change to the Content Security Policy, which governs
    only what the page itself fetches.

## Everything, item by item

**Keep** as it is; **Rewrite** in place; **Move** to another page; **Merge** with another item; **Cut**. Items are named
by their id or class in `index.html` at commit `682c47e`.

### On every view

| Item                                                    | Decision | Where it goes, and why                                                                                                                          |
| ------------------------------------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `<title>`, `data-title`                                 | Keep     | The router sets them.                                                                                                                           |
| `meta name="description"`                               | Rewrite  | For every product: "Automations that vote with your Hydrex accounts on Base. Your account stays in your wallet, and you can leave at any time." |
| `header.site .name`                                     | Keep     |                                                                                                                                                 |
| `header.site .how`                                      | Cut      | How it works is cut, and the header fits on one line on a phone.                                                                                |
| `header.site .to-app`, `.wallet-state`                  | Keep     |                                                                                                                                                 |
| `#error`                                                | Keep     |                                                                                                                                                 |
| `.needs-script`, on Home, the App and How it works      | Cut      | One `<noscript>` line for the whole page.                                                                                                       |
| Views shown by `:target`, in `style.css` and `views.ts` | Rewrite  | A router: see [Implementation](#implementation).                                                                                                |
| `footer`: the official address                          | Keep     |                                                                                                                                                 |
| `footer`: the contracts and the source                  | Move     | Each product's `check`. Today they are Matcha Latte's only.                                                                                     |
| `footer`: version, commit, Check this page, Questions   | Rewrite  | The version, which leads to `#about/check`, and About. The commit goes: rule 10.                                                                |

### Home, `#home`

| Item                                                        | Decision | Where it goes, and why                                                                                                                       |
| ----------------------------------------------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `.promise h1` and its paragraph                             | Rewrite  | Home 1 and 2, for every product.                                                                                                             |
| `.promise .buttons`                                         | Keep     | The one "Open the app" on Home.                                                                                                              |
| `.promise .states`: Matcha Latte running                    | Cut      | Its status is on the menu and its page.                                                                                                      |
| `.promise .states`: Hydrex's stopped automations            | Rewrite  | Home 4, which leads to the App.                                                                                                              |
| `.numbers`: Retired so far, with Klima's mark               | Move     | Matcha Latte's page, Last epoch.                                                                                                             |
| `.numbers`: Of the rewards                                  | Cut      | The fee facts say it.                                                                                                                        |
| `.numbers`: Its votes                                       | Move     | `record`, whose table shows it.                                                                                                              |
| `.numbers`: This epoch ends, and the countdown              | Move     | The App's line on the epoch.                                                                                                                 |
| `.numbers`: Last epoch, per 1,000 votes                     | Move     | The menu, and the product's Last epoch.                                                                                                      |
| `#menu`: its paragraph                                      | Cut      | Home 2 and the product's line on custody say it.                                                                                             |
| `#menu .choice`: the cards                                  | Move     | The menu, slimmer. Costs you and Leaving go: both automations say the same. Pays you joins the sentence.                                     |
| `#menu`: "If you only want the most…"                       | Move     | The choice to vote yourself.                                                                                                                 |
| `#in-three-steps`                                           | Cut      | The product's sentence, and `joining`.                                                                                                       |
| `#in-three-steps`: "A join takes effect in two steps"       | Move     | `joining`.                                                                                                                                   |
| `#what-you-give`                                            | Cut      | It repeats the sentence, the fee facts and the line on custody.                                                                              |
| `#compared`                                                 | Cut      | The menu compares. Double Espresso's "when a vote would earn at least $1 more" goes to its `votes`; "Stay in one that stopped" is Needs you. |
| `#compared`: "If you only want the most yield…"             | Cut      | Said once, on the menu.                                                                                                                      |
| `#safe-to-try`                                              | Cut      | Each point has a place: the line on custody, the review, `check`, the fee facts.                                                             |
| `#common-questions`                                         | Cut      | See `#questions`, below.                                                                                                                     |
| The last `section`: the button, "You need a Hydrex account" | Cut      | The App's `#none` says it.                                                                                                                   |

### The App, `#app`

| Item                                                      | Decision | Where it goes, and why                                                                                                  |
| --------------------------------------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------- |
| `h1`                                                      | Keep     |                                                                                                                         |
| `#checks`                                                 | Rewrite  | One line for each product whose checks failed, which leads to its `check`. Also on the product's page and its menu row. |
| `#checks li`, the ten failures                            | Move     | `check`, on the line of the check that failed.                                                                          |
| `#wallets`, `#connecting`, `#no-wallet`, `#wallet-failed` | Keep     | The help line, shorter. Product pages use the same parts.                                                               |
| `#connected`: "Connected with … as …"                     | Cut      | The header's chip says it.                                                                                              |
| `#wrong-chain`, `#reading`                                | Keep     |                                                                                                                         |
| `#summary .summary-line`                                  | Cut      | The groups' headings count.                                                                                             |
| `#summary`: "Matcha Latte pays out to …"                  | Move     | The page of an account in Matcha Latte, when it is not the owner's own. Today owners with no account in it see it too.  |
| `#none`                                                   | Keep     | The menu follows it.                                                                                                    |
| `p.small`: tonnes retired, and the share                  | Cut      | Rule 7.                                                                                                                 |
| `#epoch`: dates and countdown                             | Rewrite  | The App's one line on the epoch.                                                                                        |
| `#epoch progress.elapsed`                                 | Cut      |                                                                                                                         |
| `#epoch .timeline`                                        | Cut      | It is Matcha Latte's, and everyone sees it. Each product's is in its review and its `joining`.                          |
| `.group`, eight sections                                  | Rewrite  | Four groups and a fold: see [The App](#the-app).                                                                        |
| `.group` paragraphs                                       | Rewrite  | Needs you's only.                                                                                                       |
| `template#account`                                        | Rewrite  | A row: see [The App](#the-app).                                                                                         |
| The status templates, `#in` to `#empty`                   | Rewrite  | Shorter, without what the group says. In full on the account's page.                                                    |
| `.pick-hint`                                              | Keep     |                                                                                                                         |
| `[data-action="choose"]`                                  | Cut      | Choose is cut.                                                                                                          |
| `#receipts`: its heading and paragraph                    | Move     | The paragraph to `#about/figures`.                                                                                      |
| `#receipts .receipts-underway`                            | Rewrite  | A notice line in the App, and on the page of each account it concerns.                                                  |
| `#receipts .standings`, and the receipts                  | Move     | Each account's page. A late payout also marks the account's row.                                                        |
| `#receipts .receipts-reading`, `.receipts-failed`         | Move     | The account's page.                                                                                                     |
| `#payout`                                                 | Move     | The page of an account in Matcha Latte.                                                                                 |
| `nav.help`                                                | Cut      |                                                                                                                         |

### Matcha Latte, `#matcha-latte`

| Item                  | Decision | Where it goes, and why                                                                                 |
| --------------------- | -------- | ------------------------------------------------------------------------------------------------------ |
| `h1`, `.states`       | Keep     | A product, 1.                                                                                          |
| `.lead`               | Rewrite  | A product, 2: "Hydrex's automation", not "Klima's".                                                    |
| `.key-facts`          | Cut      | Pays you joins the sentence; Leaving is the line on custody; Takes and Costs you are in the fee facts. |
| "Join from the app"   | Rewrite  | A product, 4: join on the page.                                                                        |
| `.fee-facts`          | Keep     | The fee recipient named and linked; its address in `check`.                                            |
| Last epoch, per 1,000 | Keep     | A product, 5.                                                                                          |
| The rest, in full     | Cut      | The folds hold it.                                                                                     |

### Double Espresso, `#double-espresso`

| Item                                         | Decision | Where it goes, and why                                                                    |
| -------------------------------------------- | -------- | ----------------------------------------------------------------------------------------- |
| `.double-espresso-absent`                    | Cut      | Double Espresso is on Base since Tue 20 Oct: the page always shows it.                    |
| `h1`, `.states`, `.lead`                     | Keep     |                                                                                           |
| `.key-facts`                                 | Cut      | As Matcha Latte's.                                                                        |
| `.double-espresso-join`                      | Rewrite  | A product, 4.                                                                             |
| The fee facts, and "Its code fixes all six…" | Keep     | The Safe named and linked; its address in `check`.                                        |
| Last epoch                                   | Keep     | A product, 5.                                                                             |
| `.double-espresso-pools`                     | Move     | `record`.                                                                                 |
| What joining allows                          | Move     | `joining`. That anyone can claim through it stays, as Double Espresso's own.              |
| If you join now                              | Move     | `joining`; the $1 threshold and the prices to `votes`.                                    |
| Who controls what                            | Move     | `control`; the points on prices to `votes`.                                               |
| What the page checks                         | Move     | `check`. Its source on Basescan and Sourcify, not its repository, and no commit: rule 10. |

### How it works, `#how-it-works`: cut as a page

| Item                                                                          | Decision | Where it goes, and why                                                                                                              |
| ----------------------------------------------------------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `.lead`, `nav.contents`                                                       | Cut      |                                                                                                                                     |
| `#if-your-automation-stopped`: its paragraph                                  | Cut      | Out of date: it says Matcha Latte is the one that still votes.                                                                      |
| `table.automations`: 13 automations and the votes still in them               | Cut      | Hydrex's history, not the owner's. `readAutomations` and `showAutomations` go with it; `hydrex-conduits.json` stays, for the names. |
| "What it means for an account still in one"                                   | Move     | A position, 5, and Needs you's line.                                                                                                |
| "What you can do", and "Check my accounts"                                    | Cut      | Out of date: it offers Matcha Latte only. Needs you's actions are the choices.                                                      |
| `#what-joining-allows`                                                        | Move     | `joining`. That the settings can change is in the fee facts and `control`; the swaps and payouts are in `carbon`.                   |
| `#timing`: the two rules                                                      | Move     | `joining`.                                                                                                                          |
| `#timing`: Join on a Monday                                                   | Cut      | The review and `joining` give the real dates.                                                                                       |
| `#timing`: Join on a Thursday                                                 | Rewrite  | One sentence in `joining`.                                                                                                          |
| `#timing`: Leave                                                              | Move     | `joining`.                                                                                                                          |
| `#timing`: what Hydrex's app has said                                         | Cut      |                                                                                                                                     |
| `#last-epoch`: the table, the comparison, the pools                           | Move     | `record`, for every product.                                                                                                        |
| `#last-epoch`: the four notes                                                 | Move     | "Earned by its votes, not paid to you" under the table in `record`; the other three to `#about/figures`.                            |
| `#who-controls-what`                                                          | Move     | Matcha Latte's `control`. "This page names no operator…" goes to About.                                                             |
| `#carbon`                                                                     | Move     | Matcha Latte's `carbon`.                                                                                                            |
| `#for-co-signers`                                                             | Move     | Each product's `check`, for its own conduit.                                                                                        |
| `#verify`: the official address, the hashes, the RPCs                         | Move     | About.                                                                                                                              |
| `#verify`: that this page is the one built from its source                    | Cut      | No visitor can rebuild it without the source, which the page does not link: rule 10. The README keeps it.                           |
| `#verify`: the contracts, the calls, the checks, that nothing was transferred | Move     | Each product's `check`.                                                                                                             |
| `#questions`                                                                  | Cut      | Each answer has a place: see below.                                                                                                 |
| `#words`                                                                      | Cut      | Rule 8.                                                                                                                             |

Where each question's answer goes:

| Question                                       | Answered in                           |
| ---------------------------------------------- | ------------------------------------- |
| Can I still vote myself?                       | `joining`                             |
| Can I put in only some of my accounts?         | Nowhere: the boxes to tick show it    |
| What happens to rewards I have not claimed?    | The review, and `joining`             |
| What does it cost?                             | The fee facts                         |
| How much will I get?                           | Last epoch, and the review's estimate |
| What carbon credits, and where can I see them? | `carbon`                              |
| Can a DAO join from a Safe?                    | `#about/safe`                         |
| Is this page Hydrex's?                         | About                                 |
| Why does Hydrex show other numbers?            | `#about/figures`                      |
| What if this page goes away?                   | About, and `check`                    |

### Dialogs and templates

| Item                                                                                                     | Decision | Where it goes, and why                                                               |
| -------------------------------------------------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------ |
| `#review`, joining in three steps                                                                        | Rewrite  | Two: see [The review](#the-review).                                                  |
| `template#join-before`, `#join-changes`, `#double-espresso-join-before`, `#double-espresso-join-changes` | Merge    | One "Before you join" for each product, with the same parts. `.fee-facts-copy` goes. |
| `template#join-done`, `#double-espresso-join-done`                                                       | Keep     |                                                                                      |
| `template#proposed`                                                                                      | Rewrite  | It leads to the product's `check`.                                                   |
| `template#leave-effects`, `#leave-other-effects`                                                         | Keep     | Their link leads to the product's `joining`.                                         |
| `template#step`                                                                                          | Keep     | Its link leads to the product's `check`.                                             |
| `#choose`, `template#option`                                                                             | Cut      | See [Choose](#choose).                                                               |
| `template#standing`, `#receipt`, `#claims-receipt`, `#claim-line`                                        | Keep     | On the account's page.                                                               |
| `template#earned-pool`                                                                                   | Keep     | In `record`.                                                                         |
| `template#wallet`                                                                                        | Keep     |                                                                                      |

## Implementation

1. **A router.** `views/router.ts` reads the hash as a route: Home, the App, About, a product, an account, each with an
   optional section. It shows that view, sets the title, marks the header's link, draws the breadcrumb, opens the fold
   of the section asked for and scrolls to it, and on a new view scrolls to the top and focuses its `h1`, as today. The
   CSS rule that shows views by `:target` goes.
2. **One product template.** Today Matcha Latte's page and Double Espresso's are written out twice, and
   `fill(document, …)` writes figures into every element of a class across the page. With each figure in one place,
   fewer classes are filled that way. As built, each product keeps a view of its own in `index.html`, as their words
   differ in every fold, and a test holds them to the same parts in the same order; the script fills each within its own
   view.
3. **Accounts by number.** A read of one account by its number, and its payouts read for that account alone. The App's
   rows and the account's page share these reads.
4. **Code that goes:** `choose.ts`, and `choose`, `factsOf` and `openChoose` in `main.ts`; `readAutomations` and
   `showAutomations`; the styles of `.numbers`, `.columns`, the grid of `.menu`, `.contents`, `.automations`,
   `dl.words`, `.help`, `progress.elapsed`, `.compare`, `.options` and `.needs-script`.
5. **Anonymous:** `scripts/build.ts` no longer writes the commit into the page, only the version. The links to
   `github.com/ldeso/hydrex-conduit` go. The comment on `MATCHA_LATTE` in `src/config.ts` says "Hydrex's automation".
6. **What does not change:** the Content Security Policy and the RPCs; the checks and when they run; the build and its
   hashes; the fonts and colours; the layout of receipts and call slips.

### Tests

- `test/config.test.ts`: drop "Choose finds each fact…" and "How it works lists each of its sections…". Point the test
  of the six fee facts at the product template. Keep the tests of the CSP, fonts, colours, integrity, and that every
  address within the page has a target, for the new routes. Add one: the page links to no address on `github.com` but
  Hydrex's repository, links to Double Espresso's verified source on Basescan and Sourcify, and holds no commit.
- The browser tests in `fork/` find things by their headings and words. Rewrite their tests of navigation, Home's menu,
  Choose, How it works and the views without the script. Keep what the others prove: joining and leaving, one
  transaction at a time, Safe, receipts, failed checks, another network, a refusal, the turn of an epoch, and that the
  page reaches only its RPCs.
- To see the App with real accounts without anvil, announce an EIP-6963 wallet that answers `eth_requestAccounts` with a
  fixture owner, and `eth_chainId` with `0x2105`: the page reads Base itself. The owners at the top of `fork/harness.ts`
  work, though their accounts may have changed since its block.

### Docs to update

- [README](../README.md): its first paragraph ("Klima's automation on Hydrex"); What the page does (Home, Choose, a page
  for each automation); When a contract changes (where a failed check shows); Limits (now in About too); the sentence
  about the table of automations in `index.html`; and Checking a deployment, which checks out "the commit shown in the
  page's footer": the tag of the version shown instead.
- [README.md](README.md): The page today, Views, Screens (the front door, Help me choose, and "with the holder named
  once known"), the patterns that put fee facts in Choose and the review, and the roadmap.
- [brand.md](brand.md): Voice ("Name Matcha Latte's operator and keys once known": no names, for now); Navigation (the
  header and How it works); What the page may claim (Home's heading); Klima's mark ("under Retired so far on Home").

## Decisions

Taken here, for the owner to overturn:

1. Choose is cut.
2. Joining takes two steps in the review, not three.
3. How it works, Questions and Words are cut as pages.
4. The table of Hydrex's stopped automations is cut.
5. The App has four groups and a fold, not eight groups.
6. Home keeps the line about the stopped automations.
7. Help me choose, on the roadmap, is dropped: three choices on the menu, and the line for voting yourself, do its job.

The owner's answers are under [Givens](#givens).

## Done when

- Every item above is done as marked.
- The heights in rule 9 hold, with the owners in `fork/harness.ts`.
- `npm run typecheck`, `npm test`, `npx prettier --check .` and `npm run build` pass, and the rewritten browser tests
  pass against anvil.
- The Content Security Policy and the RPCs have not changed.
- Nothing on the page names an operator, links to this repository or to Double Espresso's, or shows a commit. Double
  Espresso's `check` links to its verified source on Basescan and Sourcify.
- Each view has one `h1`, which takes the focus on a new view; the breadcrumb is a `nav` with a label; each fold is a
  `<details>`.
