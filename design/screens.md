# Screens: the canvas boards in words

The design canvas holds 20 boards: <https://claude.ai/artifact/XWN6n3DdJEcgaWbD1GDsA5>, private until its owner shares
it. This file writes out the 15 boards of rows 1 to 6, the screens, so that the work can go on without the canvas: their
parts in order, their words, their figures, and the logic of the two clickable ones. Rows 7 to 9, the brand, the mark
and the palettes, are in [brand.md](brand.md); the reasoning behind every screen is in [README.md](README.md).

How to read it, as the canvas says:

- **Figures** were read from Base on 17 Oct 2026, unless marked "illustrative".
- **"Sample wallet"** puts together real Hydrex accounts of three owners. Liquidity figures are illustrative.
- **[Brackets]** are decisions not yet taken, such as "[10%] fee" or "[Hydrex relay]".

What has changed since the boards were drawn:

- **The brand.** The boards are in a placeholder teal and the system font. The page is in direction A: Young Serif,
  Atkinson Hyperlegible Next and Mono, Roast with milk in dark, labels in small capitals, receipts and calls in C's
  layout. [brand.md](brand.md) decides.
- **Addresses in full.** Some boards shorten an address outside the wallet chip, as "Paid to 0xa11c…e5a1" or
  "setConduitApproval(0xdE91…317c, …)". The page writes every address in full, in groups of four; only the wallet chip
  and the links to a transaction keep the short form.
- **The cost of receipts.** Row 4's note puts it at "about 30 calls an epoch" and says the page cannot show payouts. The
  page shows the last payout since 0.4.0, at 17 to 118 requests a run: see the README of the repository.

## Map: how the screens fit

Views of one static page, as today: each has its own address, and reads Base only.

- **Without a wallet:** Home, the menu ("What can be looked after, by what you hold") → an automation's page ("One per
  automation: fee facts, record, controls, leaving") → Check it yourself ("What the page checks, for every automation").
  Home → Help me choose ("Three questions, one suggestion and why") → an automation's page.
- **From Home to the rest:** "Connect, or look up an address" → Your positions.
- **With a wallet, or an address:** Your positions ("What you hold, who looks after it, what needs you") → Choose,
  switch or leave ("For one position, or for many at once") → Review in three steps ("Before you join · What changes ·
  Your wallet") → Done ("When it takes effect, and a reminder for payday").
- **Below them:** Your positions → Receipts and statements ("One receipt per epoch, per position; export"). The review,
  in a Safe → A brief for co-signers ("A link that shows a Safe's owners the calls").

## Row 1: the front door, three directions

Recommended, as the canvas notes: B as Home without a wallet, with A's look-up and the stopped-automation callout; A
once connected; C as a link from both.

All three share a header: "metaDEX Café" on the left; Menu, How it works, Check it yourself, and a filled button on the
right, Connect on A and C, Your positions on B.

### Front door A: what you hold

1. **Heading and look-up.** "Is everything you locked still earning?" Under it: "Connect, or paste any address, to see
   each Hydrex account, Aerodrome lock or Aero stake, and liquidity position you hold: who looks after it, what it
   earned last epoch, and what needs you." Then "Connect a wallet", a filled button; "or"; a field, "Paste an address or
   a Safe", with "Look". Under them: "Looking needs no wallet. Connecting asks your wallet only for your address."
2. **"What you will see"**, a panel beside the heading, with three sample rows, each with its status shape:
   - #2439, 102 Earning Power. Triangle: "In USDC, stopped 9 Sep. Earns nothing."
   - #9540, 10,295 Earning Power. Filled dot: "In Carbon Impact. Last epoch ≈ $6.12."
   - WETH / USDC, ≈ $3,240. Triangle: "Out of range since Tue. No fees."
3. **The stopped automations,** in a warning band: "Nearly half of the owners of Hydrex accounts, 1,640 of 3,508, still
   have one in an automation that stopped on Wed 9 Sep: 2,331 accounts, earning nothing. Check mine"
4. **"What can be looked after",** three columns, each with "Left alone", "Looked after" and a link:
   - **Hydrex accounts.** Left alone, an account earns nothing: Hydrex counts a vote only in the epoch it is cast.
     Looked after, it is voted with every week, and its rewards are claimed, swapped and paid out. "Carbon Impact, and 1
     coming".
   - **Aero stakes.** Left alone, its allocation goes stale, and its rewards wait to be claimed, in many tokens. Looked
     after, a relay allocates it and adds the rewards back. Aerodrome locks become Aero stakes on Thu 22 Oct, 00:00 UTC.
     "Coming with Aero".
   - **Liquidity positions.** Left alone, a concentrated position earns no fees once the price leaves its range. Looked
     after, it is moved back into range, and its fees are added back to it. "Coming [month]".
5. **"Three steps, and a way back",** four numbered tiles: 1 Look ("Connect, or paste an address. Nothing else is
   asked."); 2 Choose ("For each position, the automations that fit it, with their fee facts and record."); 3 Confirm
   ("The page shows each call before your wallet asks."); ↺ Leave ("At any time, from the same page, even if a check
   fails.").
6. **Foot.** "Every figure is read from Base by this page; it has no server and stores nothing. Check it yourself · See
   the menu"

### Front door B: the menu

1. **Heading.** "Your metaDEX positions, looked after". "Automations that vote, claim, swap and compound for your Hydrex
   and Aerodrome positions every week. Each one shows what it holds, what it takes, and how to leave, read from Base."
   Buttons: "See what fits my positions", "Help me choose".
2. **The stopped automations.** "Was your account in another Hydrex automation?" "Thirteen of them stopped voting on Wed
   9 Sep. 2,331 accounts, with 11.4M Earning Power, are still in them, earning nothing." Buttons: "Check my accounts",
   "Look up an address".
3. **Two rows of filters,** each a group of links to the sections below, the current one marked: "You hold": Anything,
   Hydrex accounts, Aero stakes, Liquidity. "Rewards": Paid to me, Added to my lock, Partly retired.
4. **A card per automation,** grouped by what it takes. Each card: name; status with its shape; one sentence; four
   facts; a check line where there is one; "See it".

   | Card                                 | Status                     | Sentence                                                                                           | Facts                                                                                                                                              |
   | ------------------------------------ | -------------------------- | -------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
   | Carbon Impact (for Hydrex accounts)  | Running · voted Wed 14 Oct | Votes every week, retires a third of the rewards as carbon credits, and pays you the rest in kVCM. | Taken: 33.33% retired, no fee. Pays you: kVCM, Thursdays. Last epoch, per 1,000 EP: ≈ $0.59 earned, ≈ $0.40 to you. Custody: stays in your wallet. |
   | [Hydrex relay] (for Hydrex accounts) | Coming [month]             | Votes every week and pays you in [USDC], for a fee.                                                | Taken: [10%] fee. Pays you: [USDC], Thursdays. Record: none yet. Custody: stays in your wallet.                                                    |
   | [Aero relay] (for Aero stakes)       | Coming with Aero           | Stakes your sAERO with the relay's, allocates its votes, and adds the rewards back.                | Taken: [Aero's fee], then [5%]. Gives you: PT and YT. Record: none yet. Custody: moves into the relay.                                             |
   | [Liquidity manager] (for liquidity)  | Coming [month]             | Keeps a concentrated position in range, and adds its fees and emissions back to it.                | Taken: [10%] of what it collects. Pools: [WETH / USDC, cbBTC / USDC]. Record: none yet. Custody: [approval or vault].                              |
   | [Compounder] (for liquidity)         | Coming [month]             | Claims a staked position's emissions each epoch, and adds them back to it.                         | Taken: [x]% of what it claims. Gives you: a bigger position. Record: none yet. Custody: swapped for shares.                                        |

   Carbon Impact's card adds: "Checked on Base: code, settings and Hydrex's contracts match." The Aero section opens
   with a notice: "Aerodrome's relays end: withdraw your lock by Tue 20 Oct, and vote with it to earn the last week. It
   becomes an Aero stake, sAERO, when Aero opens on Thu 22 Oct, 00:00 UTC; a lock still in a relay cannot."

5. **"Every automation on the menu",** a list: is checked on Base before you can join, and every hour while the page is
   open; shows its fee facts, and the most they can become; says how to leave, and leaving works even if a check fails;
   asks your wallet nothing until you confirm, and shows the calls first.
6. **Foot.** "Check it yourself · If you only want the most yield, and have time each week: vote yourself"

### Front door C: help me choose (clickable)

"Help me choose". "Three questions, then a suggestion and the reasons for it. Your answers stay on this page."

**The questions,** one at a time, with "Question n of 3" and a bar. Each answer is a wide button with a line of help;
the one picked is outlined. "Back" from the second and third.

1. **What do you hold?** Hydrex accounts ("HYDX locked on Hydrex"); An Aero stake, or an Aerodrome lock ("sAERO; veAERO
   until 22 Oct"); A liquidity position ("In a concentrated pool, on Aerodrome or Hydrex"); I am not sure ("Look at my
   wallet instead"), which goes straight to a suggestion.
2. **What should happen to the rewards?** Paid to me, in one token ("Every week, to my address"); Added to what I hold
   ("So it grows"); Partly retired as carbon credits ("The rest paid to me"); As much as possible ("Whatever the
   token").
3. **How much do you want to do each week?** Nothing ("Look now and then"); A little ("Check the receipts, change course
   sometimes"); I will vote myself ("And compare").

**The suggestion,** in an outlined box: a kicker, a name, a line, "Why" with a reason for each answer given ("You hold
Hydrex accounts.", "You want the rewards paid to you, in one token.", "You want nothing to do each week.", and so on), a
panel of facts, a button to it and "See the whole menu". Under the box, an honest line, then "Start again". The first
rule that matches decides:

| When                                       | Kicker           | Suggestion                                                              | Facts                                                                                                                                       | Button                |
| ------------------------------------------ | ---------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- |
| Not sure what they hold                    | First            | Look at what you hold                                                   | Looking asks your wallet for your address only. Nothing is stored.                                                                          | Look at my positions  |
| Will vote themselves, and want the most    | Suggested        | Vote yourself: nothing on the menu beats it, if you vote well           | Each week: vote before Wednesday 24:00 UTC, then claim and swap the rewards. Nothing is taken.                                              | Compare with the menu |
| Hydrex accounts, rewards added to the lock | Nothing fits yet | Nothing adds to a Hydrex lock today (Hydrex Lock Maxi did, until 9 Sep) | Carbon Impact pays you in kVCM and retires a third. [Hydrex relay] will pay you in [USDC], for a [10%] fee.                                 | See the closest       |
| Hydrex accounts, partly retired            | Suggested        | Carbon Impact                                                           | Taken: 33.33% retired, no fee. Last epoch, per 1,000 Earning Power: ≈ $0.59 earned, ≈ $0.40 to members. Stays in your wallet.               | See Carbon Impact     |
| Hydrex accounts, anything else             | Suggested        | [Hydrex relay], paying in [USDC]                                        | Taken: [10%] fee. New: no record yet. Stays in your wallet. Second choice: Carbon Impact, which retires a third and charges no fee.         | See it                |
| An Aero stake or Aerodrome lock            | Suggested        | [Aero relay]                                                            | Taken: [Aero's fee] on deposit, then [5%] of rewards. Your stake moves into the relay: you hold PT and YT, and withdrawals wait in a queue. | See it                |
| A liquidity position                       | Suggested        | [Liquidity manager]                                                     | Taken: [10%] of what it collects. Each move costs a swap, paid from the position.                                                           | See it                |

The honest line is "If you only want the most, and have time each week, vote yourself: nothing is taken, and you claim
and swap the rewards yourself." Two suggestions change it: after "Vote yourself", "Your receipts here will still show
what an automation would have paid, at the same prices"; after a liquidity manager, "If you can watch the price and move
the range yourself, you keep everything."

## Row 2: your positions, choosing and joining

### Your positions (desktop)

1. **Header** with Menu, Your positions, Receipts, Check it yourself, and the wallet chip.
2. **Heading** "Your positions", marked "Sample wallet". "Connected with Rabby as" the wallet's address, then "Read from
   Base at block 52,739,992." A look-up for another address, "0x… or a Safe".
3. **Summary,** five figures in a row: Positions "6 · 2 looked after"; Last epoch, earned "≈ $21.32"; Fees and retired
   "≈ $3.13"; Yours "≈ $18.19"; Next payout "Thu 22 Oct · in 4 d 3 h".
4. **"Needs you · 4",** each with its action:
   - "Withdraw lock #31867 from veAERO Maxi by Tue 20 Oct, then vote with it to earn the last week. Aero opens Thu 22
     Oct, 00:00 UTC, and a lock still in a relay cannot become an Aero stake." What to do
   - "#2439 earns nothing. It is in USDC, which stopped voting on Wed 9 Sep." Choose what looks after it
   - "WETH / USDC is out of range since Tue 13 Oct, 14:20 UTC. It earns no fees until the price comes back." See the
     position
   - "#14485 has not voted this epoch. Vote on Hydrex before Wed 21 Oct, 24:00 UTC, or let an automation vote." Choose
5. **A table per protocol.** Ticking rows shows a bar: "2 ticked · Join Carbon Impact with both · Choose another".

   | Hydrex accounts · 3               | Earning Power | Looked after by                 | Last epoch                           | Actions                   |
   | --------------------------------- | ------------- | ------------------------------- | ------------------------------------ | ------------------------- |
   | #9540, Flex Account, rolling lock | 10,295        | Carbon Impact, since Thu 24 Sep | ≈ $6.12 earned, ≈ $4.08 to you       | Receipt · Switch or leave |
   | #14485, Protocol Account          | 444           | You, not voted this epoch       | ≈ $0.21 earned, unclaimed, on Hydrex | Choose                    |
   | #2439, Protocol Account           | 102           | USDC, stopped on Wed 9 Sep      | Nothing                              | Choose                    |

   | Aerodrome locks · 1                   | Voting power | Looked after by                                        | Last epoch | Actions    |
   | ------------------------------------- | ------------ | ------------------------------------------------------ | ---------- | ---------- |
   | #31867, an Aero stake from Thu 22 Oct | 2,400 veAERO | veAERO Maxi, last voted 7 Oct · withdraw by Tue 20 Oct | Nothing    | What to do |

   | Liquidity · 2                               | Value    | Looked after by                                  | Last epoch                           | Actions          |
   | ------------------------------------------- | -------- | ------------------------------------------------ | ------------------------------------ | ---------------- |
   | WETH / USDC, Aerodrome, concentrated, 0.05% | ≈ $3,240 | Nobody, out of range since Tue                   | ≈ $4.10 in fees, none since Tue      | Choose a manager |
   | cbBTC / USDC, Hydrex, concentrated          | ≈ $1,180 | [Liquidity manager], in range · moved Mon 12 Oct | ≈ $9.80 in fees, after its [10%] fee | See it           |

6. **Foot.** "This epoch ends Thu 22 Oct, 00:00 UTC (02:00 your time). Dollars at prices in each protocol's pools when
   the last epoch ended. Statements and export"

### Your positions (phone)

The same content in one column: header with the wallet chip and tabs (Menu, Positions, Receipts); the summary for "Last
epoch, Thu 8 Oct to Thu 15 Oct" (Earned ≈ $21.32, Fees, retired ≈ $3.13, Yours ≈ $18.19) and "Next payout: Thu 22 Oct,
after 00:00 UTC, in 4 d 3 h."; "Needs you · 4" as on desktop; then a card per position instead of table rows, each with
its name and size, its kind, who looks after it and its status, last epoch, and its actions. For example #2439:
"Protocol Account · In USDC, which stopped on Wed 9 Sep · Earned nothing since Thu 10 Sep · Choose". Foot: "Read from
Base just now. This epoch ends Thu 22 Oct, 00:00 UTC. Look up another address".

### Choose for one account (phone)

1. **"‹ Your positions"**, then "What looks after #2439?" and "Protocol Account · 102 Earning Power".
2. **Now:** "USDC, which stopped voting on Wed 9 Sep. It has earned nothing since Thu 10 Sep."
3. **Worth it?** "A change costs about $0.004 in gas today. At last epoch's rate, #2439 would earn about $0.06 a week."
4. **Choices,** "Last epoch's figures, per 1,000 Earning Power, at the same prices. For #2439, divide by ten." One card
   each, picked like a radio button:
   - **Carbon Impact,** Hydrex automation. "Pays you in kVCM. Retires a third as carbon credits." Earned ≈ $0.59;
     Retired, fee 33% · 0%; To you ≈ $0.40. "Running, voted every epoch since [start] · stays in your wallet".
   - **[Hydrex relay],** Hydrex automation. "Pays you in [USDC]. Takes a [10%] fee." "New: no epoch on record yet. Its
     first votes count from Thu 22 Oct. Checked on Base · stays in your wallet".
   - **Vote yourself.** "Leave USDC, and vote on Hydrex every week, before Wednesday 24:00 UTC. You keep everything, in
     the tokens of the pools you vote for, and claim them yourself." Average ≈ $[x]; Fee none; Each week: vote, claim.
5. **"Compare in a table",** opened on demand:

   |                  | Carbon Impact                   | [Hydrex relay]                  | Vote yourself   |
   | ---------------- | ------------------------------- | ------------------------------- | --------------- |
   | Pays in          | kVCM                            | [USDC]                          | Up to 28 tokens |
   | Taken            | 33.33% retired                  | [10%] fee                       | Nothing         |
   | Most it can take | 100% + 1%                       | [cap]                           | Nothing         |
   | Leaving          | Any time; votes back next epoch | Any time; votes back next epoch | —               |

6. **"Review the change",** and "Nothing is sent until you confirm."

### Join review (phone, clickable)

A dialog, "Join Carbon Impact: step n of 3", with a close button; Continue on steps 1 and 2, "Confirm in your wallet" on
step 3, Back on steps 2 and 3. Here for #14485 and #2439.

1. **Before you join.** "For #14485 and #2439." "Carbon Impact can claim the rewards these accounts have not claimed
   yet, even those your own votes earned, from the moment they join. It swaps and retires them like the rest." "To keep
   them as they are, claim them on Hydrex first, then come back." "#2439 is in USDC, which stopped on Wed 9 Sep. What it
   left unclaimed can still be claimed on Hydrex. Nothing has accrued since." A link, "Claim on Hydrex ↗".
2. **What changes.** A timeline: "Now. Carbon Impact can claim their rewards. USDC can no longer claim #2439's." "Thu 22
   Oct, 00:00 UTC (02:00 your time). It votes with them, and you can't, until the epoch after they leave." "Thu 29 Oct,
   right after 00:00 UTC. The first payout from their votes. Then every Thursday." Then fee facts: Retired as carbon
   credits, can be set up to 100%: 33.33%; Fee, can be set up to 1%: 0%; Paid to the owner's address: the rest, in kVCM.
   "At last epoch's rate, their 546 Earning Power would earn ≈ $0.32 a week, of which ≈ $0.22 reaches you. It is not a
   promise: incentives change every week." "Your HYDX stays in your accounts, and they stay in your wallet. Who controls
   what"
3. **What your wallet will ask.** "One request, with two calls. Your wallet can send them together." Then a call per
   account, "#14485 joins Carbon Impact." and "#2439 leaves the USDC automation and joins Carbon Impact.", each
   `setConduitApproval(conduit, account, true)` on Hydrex's VotingEscrow, with "In these calls,
   0xdE91885cF35ac57DF0c4A75c16862127dBe8317c is Carbon Impact." "A wallet that cannot batch asks twice, one after the
   other. How to check these calls"
4. **Done,** titled "Joined". "Carbon Impact can claim the rewards of #14485 and #2439 now, and votes with them from Thu
   22 Oct, 00:00 UTC." "Your first payout from their votes comes Thu 29 Oct, right after 00:00 UTC. This page shows a
   receipt for each epoch." "Add Thursdays to my calendar" ("A calendar file made on this device: nothing is sent
   anywhere."), the transaction, and "You can leave at any time from Your positions." Buttons: "See your positions",
   "Replay".

The canvas notes: one wallet request for several accounts where the wallet can batch (EIP-5792); one by one otherwise.

## Row 3: one page per automation, from one template

The template, in order: status; name and what it does; four key facts (Takes, Pays you or Gives you, Costs you, Leaving)
and Join; your accounts or stake; fee facts; money per 1,000 units; its record; how it voted, where it votes; what
joining allows, and custody; if you join now; who controls what; check it yourself.

### An automation's page: Carbon Impact

Real settings and last epoch; the record is illustrative except its last bar.

1. **"Menu › For Hydrex accounts".** Status: "Running · voted Wed 14 Oct, 23:59 UTC".
2. **Carbon Impact.** "It votes with your Hydrex accounts every week, retires a third of the rewards as carbon credits
   through Klima, and pays you the rest in kVCM. Your accounts and their HYDX stay in your wallet." Key facts: Takes
   "Hydrex accounts, Flex or Protocol"; Pays you "kVCM, every Thursday after the flip"; Costs you "A third of the
   rewards, retired. No fee."; Leaving "Any time, one call per account". Join.
3. **Your accounts.** "#9540 is in it. #14485 can join." "Last epoch, #9540's votes earned ≈ $6.12", with a bar split
   into "Retired ≈ $2.04" and "To you ≈ $4.08". "Join with #14485", "Compare". "Checked on Base a minute ago: its code,
   settings and Hydrex's contracts match. What is checked"
4. **What it costs you.** Fee facts, "Carbon Impact, as set on Base now":

   | Row                                                         | Value         |
   | ----------------------------------------------------------- | ------------- |
   | Retired as carbon credits, can be set up to 100%            | 33.33%        |
   | Fee, can be set up to 1%                                    | 0%            |
   | Swaps: 28 tokens last epoch, into kVCM, at market prices    | Market        |
   | Gas: for voting, claiming and paying out                    | Keeper pays   |
   | Who can change these: at any time, for every member at once | One admin key |

   "Read from the automation at block 52,739,992. Who controls what"

5. **Per 1,000 Earning Power, last epoch,** "Thu 8 Oct to Thu 15 Oct, at prices in Hydrex's pools when it ended": a bar,
   Earned ≈ $0.59, Retired ≈ $0.20, Paid to you ≈ $0.40. "If you vote yourself, you keep everything, and claim and swap
   up to 28 tokens yourself, every week. Compare the choices"
6. **Its record,** "Illustrative, except the last epoch". A bar for each of eight epochs, 20 Aug to 8 Oct, of what its
   votes earned per 1,000 Earning Power, against a line for Hydrex's average at the same prices; the last bar labelled
   "≈ $0.59"; "As a table" beside it. "Last epoch, it earned [x]% less per 1,000 Earning Power than the average on
   Hydrex, at the same prices. One epoch is noisy: incentives change every week."
7. **How it voted last epoch.** "For 27 pools. Its votes earned ≈ $693: ≈ $27 in fees, ≈ $665 in incentives, paid in 28
   tokens. The five it gave most votes to:", a table of pool, share of its votes as a bar and a figure, and earned: AVNT
   / USDC 16.7% ≈ $116; wtDRAM / USDC 14.2% ≈ $102; GOO / cbBTC 9.8% ≈ $67; WETH / MILK 9.2% ≈ $63; ZORA / WETH 9.2% ≈
   $63. "All 27 pools".
8. **What joining allows.** It can: vote with the account, from the next epoch (you can't, until the epoch after it
   leaves); claim its rewards, from the moment it joins, including any not yet claimed. It cannot: move the account or
   its HYDX (both stay in your wallet, as Basescan shows); change your lock, or stop you leaving. Custody: "Stays in
   your wallet. An approval on Hydrex's VotingEscrow, not a deposit. One call joins; the same call with false leaves."
9. **If you join now.** Now, Sat 17 Oct: it can claim the account's rewards. Thu 22 Oct, 00:00 UTC: its votes move to
   Carbon Impact. Wed 28 Oct, before 24:00 UTC: it votes with the account for the first time. Thu 29 Oct: your first
   payout from its votes, in kVCM. "When things happen, in full"
10. **Who controls what.** The keeper: "Votes, claims, swaps, retires and pays out, each week. It picks the pools. The
    contract stops it retiring more than the share set." The admin key: "Can change, at any time and for everyone: the
    share retired (up to 100%), its fee (up to 1%), the payout token, the routers, any member's payout address. It can
    withdraw tokens the automation holds." Who holds them: "[Name the holder: a Safe, its signers and threshold, read
    from Base.] Every change is a transaction to the automation, on Basescan."
11. **Check it yourself.** "Before it lets you join, and every hour while it is open, this page checks on Base that:"
    the RPC serves Base; Carbon Impact runs the code this page knows, and points to Hydrex's VotingEscrow and Voter; it
    pays in kVCM; joining approves voting and claiming only; Hydrex's VotingEscrow and its approval logic run the code
    this page knows. Each with a tick. Then the automation's address.

### The same template: an Aero (V3) relay

Illustrative, for after Aero opens on Thu 22 Oct. It follows Dromos's V3 interfaces (queues, PT and YT), not deployed
contracts, and is to be confirmed with Dromos.

1. **"Menu › For Aero stakes".** Status: "New · first allocation [Thu 22 Oct]", and "Protocol relay, [L1]".
2. **[Aero relay].** "It stakes your sAERO with everyone's in the relay, allocates the votes, and adds the rewards back
   to the stake, so your share grows. Run by [Klima], on Aero's relay contracts." Key facts: Takes "sAERO, from [any
   address]"; Gives you "Two tokens: PT and YT"; Costs you "Aero's fee in and out; [5%] of rewards"; Leaving "Ask any
   time; paid in queue order". Join.
3. **Your Aero stake.** "#[new id] · 2,400 sAERO, not in a relay." "Your lock left Aerodrome's veAERO Maxi relay, which
   last voted on 7 Oct. Since Aero opened it is this stake, and nothing allocates it." "Deposit 2,400 sAERO", "Compare".
   "Checked on Base: a relay from Aero's factory, with the entrypoint and keeper this page knows. What is checked"
4. **What happens to your stake.** Custody: "Moves into the relay. Your sAERO is staked by the relay, with everyone's.
   It is no longer in your wallet: two tokens are." PT, what you put in: "The right to take your sAERO back. Whoever
   holds it can withdraw." YT, what it earns: "The right to the rewards. In this relay it stays with your address: it
   cannot be sent." A warning: "Keep the PT in this wallet. Sending it gives away the right to withdraw, and this page
   cannot undo that."
5. **What it costs you,** fee facts "[Aero relay], as set on Base": Taken, by Aero in and out, then of the rewards: [x]%
   each way, [5%]. The most it can become: [cap]. Goes to: Aero; [Klima]. When: in, out; each compounding. Other costs,
   swapping rewards into AERO: swaps. Who can change it, [after a timelock; Aero can veto]: [role].
6. **Its record:** "No record yet. Its first allocation is [Thu 22 Oct]. After each one, this shows what it earned per
   1,000 sAERO, next to Aero's average. Until then, judge it by its fee facts and its rules, not by a projected APR.
   This page shows none."
7. **If you deposit now.** Now: "Your request waits in the relay's queue. No tokens yet." Within [the keeper's window]:
   "The keeper takes it in. You receive PT and YT, after Aero's fee." From then: "It earns, as Aero streams the rewards.
   The relay changes its allocation at most every 48 hours." Each compounding: "Rewards become more sAERO for the relay,
   and your share of it grows."
8. **Leaving.** "Ask to withdraw, with your PT. It waits in a queue, still earning, and is paid in order, after Aero's
   fee. A request cannot be cancelled." "If the queue stalls past [the evacuation window], anyone can close the relay,
   and every depositor's sAERO comes back." "Removed from the allow list, your stake joins the queue by itself, as if
   you had asked."
9. **Who controls what, and what the page checks.** Aero decides who may deploy a relay, and can veto a change of its
   entrypoint. [Klima], the relay's manager, sets [its fee, within the cap,] runs the keeper, and keeps the allow list;
   removing an address puts its stake in the withdrawal queue. The keeper takes in deposits, allocates, compounds and
   pays withdrawals in queue order. The page checks that the relay comes from Aero's factory and runs the entrypoint,
   keeper and fee this page knows, before it lets you deposit; withdrawing works either way.

## Row 4: proof, every epoch

### Receipt for one epoch (phone)

1. **"‹ Your positions"**, then "Receipt · #9540 in Carbon Impact" and the epoch as the heading, "Thu 8 Oct to Thu 15
   Oct".
2. **Paid to you,** large: "≈ $4.08". "149 kVCM to" the payout address, "Thu 15 Oct at 00:14 UTC. Transaction"
3. **The lines:**

   | Line            | Detail                                                       | Figure    |
   | --------------- | ------------------------------------------------------------ | --------- |
   | Votes           | 10,295 Earning Power, 0.88% of Carbon Impact's, for 27 pools |           |
   | Earned          | In 28 tokens: fees ≈ $0.24, incentives ≈ $5.88               | ≈ $6.12   |
   | Swapped         | Into kVCM, after swap costs                                  | 224 kVCM  |
   | Retired, 33.33% | ≈ 19 t of carbon credits, in the name "Hydrex"               | − 75 kVCM |
   | Fee, 0%         |                                                              | 0 kVCM    |
   | Paid to you     |                                                              | 149 kVCM  |

   "Dollars at prices in Hydrex's pools when the epoch ended; kVCM at ≈ $0.027. Tonnes at Carbon Impact's average so
   far, 3.9 kVCM a tonne."

4. **Had you voted yourself.** "For the same pools, you would have kept all ≈ $6.12, in 28 tokens to claim and swap
   yourself. Voting for the pools that paid most per vote, you might have earned more; Hydrex's average was ≈ $[x] for
   your Earning Power."
5. **Three things to keep,** each "made on this device. Nothing is sent anywhere.": Download as CSV; Save an image of
   your impact; Add Thursdays to my calendar.
6. **Your share of what it retired.** "≈ 19 t this epoch", "≈ [n] t since #9540 joined." "Carbon Impact retires in one
   name for every member, "Hydrex", so a retirement does not carry yours. This is your share of its retirements, from
   your share of its votes."
7. **Earlier receipts,** illustrative: Thu 1 Oct to Thu 8 Oct ≈ $3.71; Thu 24 Sep to Thu 1 Oct ≈ $4.36; Thu 17 Sep to
   Thu 24 Sep "Joined; votes moved Thu 24 Sep". "Read from the automation's events on Base. How this is worked out"

The page's receipt, since 0.4.0, is for the last payout only, one per account in it, in C's layout: Earned, Swapped,
Retired with Klima's mark, Fee, then Paid, to whom and when, and the transaction.

### Statements and export (desktop)

Illustrative, except 8 Oct to 15 Oct.

1. **"Receipts and statements".** "What each position earned, what was retired or taken in fees, and what reached you,
   epoch by epoch. Read from the automations' events on Base."
2. **Filters:** Period (Since you joined (4 epochs), This year, Last tax year); Positions (All 6, Hydrex accounts,
   Aerodrome locks, Liquidity); Show: Dollars or Tokens.
3. **Totals:** Earned ≈ $124.70; Retired as carbon credits ≈ $7.90 · ≈ [n] t; Fees ≈ $8.90; Reached you ≈ $107.90.
4. **A row per epoch:**

   | Epoch                    | Earned    | Retired | Fees    | Reached you | How                                                      |
   | ------------------------ | --------- | ------- | ------- | ----------- | -------------------------------------------------------- |
   | Thu 8 Oct to Thu 15 Oct  | ≈ $21.32  | ≈ $2.04 | ≈ $1.09 | ≈ $18.19    | 149 kVCM paid; veAERO Maxi did not vote; fees compounded |
   | Thu 1 Oct to Thu 8 Oct   | ≈ $35.10  | ≈ $1.85 | ≈ $2.66 | ≈ $30.59    | 137 kVCM paid, 17.2 veAERO added                         |
   | Thu 24 Sep to Thu 1 Oct  | ≈ $36.48  | ≈ $2.18 | ≈ $2.61 | ≈ $31.69    | 161 kVCM paid, 16.9 veAERO added                         |
   | Thu 17 Sep to Thu 24 Sep | ≈ $31.80  | ≈ $1.83 | ≈ $2.54 | ≈ $27.43    | #9540 joined Carbon Impact                               |
   | 4 epochs                 | ≈ $124.70 | ≈ $7.90 | ≈ $8.90 | ≈ $107.90   |                                                          |

   Each row ends with a link to its receipt.

5. **Export.** "One row per position per epoch: what it earned in each token, what was swapped, retired, taken and paid,
   with the transactions." Download CSV; CSV for a tax tool; Print a statement. "Made on this device. Nothing is sent
   anywhere."
6. **Against doing it yourself.** "Over these 4 epochs, your Hydrex accounts in Carbon Impact earned [x]% less than
   Hydrex's average per 1,000 Earning Power, before the share retired. Your Aerodrome lock grew [y]% faster than
   claiming and re-locking by hand each week would have, after the relay's fee." "At the same prices for both. Each
   epoch is noisy; the comparison means more over months."

## Row 5: liquidity positions, and teams

### A managed liquidity position

Illustrative figures.

1. **"Your positions › Liquidity",** then "cbBTC / USDC" with "In range · managed by [Liquidity manager]". "Hydrex,
   concentrated pool · position #48213 · managed since Sat 19 Sep".
2. **Figures:** Worth now ≈ $1,178; Range now 78,000 – 85,000; Price now 81,512; In range since joining 96% of the time;
   Against holding + $25.51.
3. **Its range, and the price:** a line of cbBTC in USDC over four weeks, 19 Sep to 17 Oct, over a shaded band for the
   range it earned fees in, with a dot for each move.
4. **Against holding the two tokens:** a waterfall from what was put in on 19 Sep to now, "shown whether it is better or
   worse", the bars starting at $1,100: Put in $1,200.00; The price, if held − $48.00; Being concentrated − $7.00; Fees
   collected + $38.90; Its [10%] fee − $3.89; Two moves' swaps − $2.50; Now $1,177.51. "Holding would be worth
   $1,152.00, and a full-range position [≈ $1,161]. This one is $25.51 ahead of holding, after its fee and the moves. A
   sharp move can put a concentrated position behind both: these lines show that too."
5. **Fee facts:** Taken, of the fees and emissions it collects: [10%]. The most it can become: [cap]. Goes to:
   [Operator]. When: each collection. Other costs, paid from the position: each move's swap. Who can change it: [Role,
   delay].
6. **Custody and stopping:** "[If an approval:] the position stays in your wallet. The manager can move its range,
   collect its fees and add them back; it cannot send the tokens to anyone but you. Stop with one call; the position
   stays where it is." Stop managing; Open on Hydrex ↗.
7. **Moves,** a table of when, why, from, to, cost and the transaction: Mon 12 Oct, 06:10 UTC, the price left the range,
   below, 82,000 – 89,000 to 78,000 – 85,000, ≈ $1.10; Fri 2 Oct, 18:40 UTC, the same, 85,000 – 92,000 to 82,000 –
   89,000, ≈ $1.40; Sat 19 Sep, 10:02 UTC, you joined, to 85,000 – 92,000. "Its rule: move when the price has been
   outside the range for [an hour], to a range [±4%] around the price. The strategy, in full"

### From a Safe: propose and brief

1. **Header** with the Safe's chip, its address and "2 of 3".
2. **"Propose to the Safe",** "Sample Safe". "Opened in Safe{Wallet}. The page proposes one Safe transaction; the Safe's
   owners sign it there."
3. **"Join Carbon Impact with 12 accounts".** "412,880 Earning Power, 35% of what is in Carbon Impact today. At last
   epoch's rate, ≈ $245 a week earned, ≈ $163 to the Safe in kVCM." A table of account, Earning Power and now: #3120,
   120,400, in Liquid Hydrex, stopped 9 Sep; #3121, 98,250, the same; #5544, 61,030, the Safe votes with it; #5545,
   44,100, the same; "And 8 more, 89,100 Earning Power".
4. **What the Safe's owners will sign.** "One Safe transaction, with 12 calls to Hydrex's VotingEscrow,
   0x25B2ED7149fb8A05f6eF9407d9c8F878f59cd1e1:" each call in plain words with its
   `setConduitApproval(conduit, account, true)`, "And 10 more, the same call for each account." "Payouts go to the Safe
   itself. Only Carbon Impact's admin key, or a call from the Safe made elsewhere, can change that." Propose in
   Safe{Wallet}; Back.
5. **A brief for the other owners.** "A link that opens this page on what the transaction does, in plain words, with the
   calls and how to check them. It carries the accounts and the automation in its address; nothing is stored." An
   optional field, "Why, for the record", here "Move the treasury's stopped Hydrex accounts, as agreed in the vote of 12
   Oct." The link, as `https://metadex.cafe/#brief?join=3120,3121,5544,…&to=0xdE91885cF35ac57DF0c4A75c16862127dBe8317c`.
   Copy the link; Print the brief.
6. **After it is proposed:** "Nonce 42 · 1 of 2 signatures", "As Safe{Wallet} reports it to the page. The accounts
   change once it executes."
7. **For the treasurer:** "A statement each month: what each account earned, what was retired, what reached the Safe,
   with the transactions." October statement, CSV · Print.

The canvas notes that the brief carries its accounts in the URL fragment, which no server sees. The information
architecture in [README.md](README.md#information-architecture) keeps `#for-co-signers` as its address, with the
accounts and the automation in the fragment; the board's `#brief` predates it.

## Row 6: patterns to reuse

"The same parts on every automation's page, in every review, and in Your positions." The rules for each are in
[README.md](README.md#patterns); the board draws them so:

- **Fee facts:** the same six rows in the same order, Taken, The most it can become, Goes to, When, Other costs, Who can
  change it, for four kinds of product:

  | Kind                               | Taken                                      | Most it can become | Goes to                  | When             | Other costs      | Who can change it |
  | ---------------------------------- | ------------------------------------------ | ------------------ | ------------------------ | ---------------- | ---------------- | ----------------- |
  | Votes for you, retires a share     | Of the rewards: 33.33% retired, 0% fee     | 100% + 1%          | Carbon credits; treasury | Each payout      | Swaps            | One admin key     |
  | Votes for you, pays you in a token | Of the rewards: [10%] fee                  | [cap]              | [Operator]               | Each payout      | Swaps            | [Role, delay]     |
  | Pools your stake in a relay        | Of the deposit; of the rewards: [x]%; [5%] | [cap]              | Aero; [Operator]         | Each compounding | Swaps            | [Role, delay]     |
  | Manages a liquidity position       | Of fees and emissions: [10%] fee           | [cap]              | [Operator]               | Each collection  | Each move's swap | [Role, delay]     |

- **Money: earned, then taken, then yours.** "Last epoch, #9540: ≈ $6.12 earned", a bar split into "Retired ≈ $2.04" and
  "To you ≈ $4.08, 149 kVCM". Next to every figure, what doing it yourself gives: Carbon Impact ≈ $0.59, Hydrex average
  ≈ $[x], "Per 1,000 Earning Power, at the same prices, before anything is taken."
- **The epoch, as a clock:** Now, Sat 17 Oct; Votes, then the flip, Wed 21 Oct, 24:00 UTC. "Join now: claims move now,
  votes move at the flip."
- **Custody and leaving,** one line each, before anything else: "Stays in your wallet" (an approval, not a deposit;
  leave with one call, any time: claims stop at once, votes come back at the next flip), for Hydrex automations; "Moves
  into the relay" (your stake is pooled in the relay; you hold PT, to withdraw it, and YT, which earns; a withdrawal
  waits in a queue, still earning, and cannot be cancelled), for Aero relays; "Swapped for shares" (you hand over the
  tokens and hold shares of a vault; withdraw any time, for the tokens the shares are worth then), for compounders and
  liquidity managers.
- **Status: a shape and words, never colour alone.** Running, filled dot: "Voted Wed 14 Oct, 23:59 UTC". Joining, half
  dot: "Claims moved; votes move Thu 22 Oct". Leaving, half dot: "Votes come back Thu 22 Oct". Not looked after, hollow
  dot: "You vote with it". Stopped, triangle: "Last voted Wed 9 Sep; earns nothing". Checks failed, square: "Joining is
  off; leaving works".

## On the page in 0.4.0

What of the boards the page already has, so that the next work starts from there:

| On the boards                                                                    | On the page                                                                                                      |
| -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| The stopped-automation callout                                                   | On Home; in the App, a group of its own, "In an automation that stopped"                                         |
| Status by shape and words                                                        | Filled, half filled, hollow, triangle and square, before each status                                             |
| The review in three steps                                                        | Before you join, what changes, and the calls, as slips with their fields; one transaction at a time, no batching |
| Calls from a Safe                                                                | One Safe transaction, with the decoded fields and the calldata; a brief for co-signers without its accounts      |
| What the votes earned, against all of Hydrex                                     | Per account and per 1,000 Earning Power, last epoch only                                                         |
| A receipt per epoch, statements and export                                       | The last payout only, as a receipt per account in it; no statements or export                                    |
| Menu, Your positions, Choose, Help me choose, fee facts, record, liquidity, Aero | Not yet                                                                                                          |
