# UX directions: from one automation to a menu

Research and proposed designs for when metaDEX Café offers more than Carbon Impact: another Hydrex relay, Aero relays,
compounders and liquidity managers, each for a fee. Nothing here changes the page yet.

- **The mockups** are on a design canvas, with a clickable join review and a clickable "Help me choose":
  <https://claude.ai/artifact/XWN6n3DdJEcgaWbD1GDsA5>. It is private until its owner shares it.
- **The screens in words** are in [screens.md](screens.md): each board of rows 1 to 6, its parts in order, its words and
  figures, and the logic of the two clickable ones, so that the work does not need the canvas.
- **The evidence** is in [research.md](research.md): who uses automations on Base, what comparable products do and
  charge, what changes with Aero, what research says about liquidity providers, trust and disclosure, and the sources.
- **The brand** is in [brand.md](brand.md): what the name carries, the neighbours' colours and type, what each persona
  needs from a brand, the rules on environmental claims, and three directions, on the canvas's row 7, of which A is
  chosen.
- **Figures** are read from Base on 17 Oct 2026, unless marked. Mockups mark what is illustrative, and put product
  decisions not yet taken in brackets, such as "[10%] fee".

## In short

1. **Two audiences, not one.** On Hydrex today, 47% of the owners whose accounts hold votes have one in an automation,
   but automations hold 2% of the votes. In August, before Hydrex stopped them, use fell with size: most owners under
   $1,000 used one, one in eight between $100,000 and $1M, and the largest holder none. Design the default for the many
   small holders, and the evidence for the few large ones.
2. **Start with the rescue.** 2,331 accounts of 1,640 owners still sit in automations that stopped on 9 Sep: 11.4M
   Earning Power, earning nothing. Most are small (the median owner holds about $3), but 208 owners hold $100 or more,
   and a change costs about $0.004 in gas. Hydrex's own app tells them to switch to "No Automation".
3. **Aerodrome's relays end this week.** Members must withdraw by Tue 20 Oct; Aero opens on Thu 22 Oct, 00:00 UTC.
   Klima's two Aerodrome relays are among them. Aero's V3 relays queue deposits and withdrawals and give two tokens, one
   to withdraw and one that earns, and Aero's own Autopilot takes over from its public relay. A café relay must offer
   what Autopilot does not: a payout token, retirement, receipts.
4. **Make the position the unit, not the product.** People arrive with what they hold. Each position has one caretaker
   at a time: show which, how it is doing, and what needs the owner.
5. **One fee label for every product.** Six rows in the same order: taken, the most it can become, goes to, when, other
   costs, who can change it. Elsewhere, 2–17% of rewards is the range for voting and compounding, and about 10% of fees
   for managed liquidity.
6. **Money as earned, then taken, then yours, next to doing it yourself.** Per epoch, in dollars and in tokens, as
   regulators elsewhere ask of funds: costs in money and in percent, net next to gross.
7. **Design leaving first.** Custody and exit in one line, before anything else, for each kind of product.
8. **Proof every epoch.** A receipt per position, an export, a calendar file for payday, all made on the device.
9. **Promise a process, not an outcome.** Most concentrated-liquidity providers do worse than holding the two tokens. A
   manager's page shows its result against holding and against a full-range position, whichever way it falls.
10. **Front door:** the menu without a wallet, your positions with one, and "Help me choose" as a link, not a gate.

## What Base says about who would pay

Read from Hydrex's and Aerodrome's VotingEscrow and Voter. Method, blocks and the August scans are in
[research.md](research.md#on-chain-sizing).

| Hydrex                                          | Value                                                      |
| ----------------------------------------------- | ---------------------------------------------------------- |
| Owners whose accounts hold votes                | 3,508; the median owner holds about $6                     |
| Of them, with an account in an automation today | 1,648 (47%)                                                |
| In an automation in August, before they stopped | 2,270 owners; 11–13% of the votes cast                     |
| Votes in automations today                      | 2.06% (≈ $238k at HYDX ≈ $0.0246)                          |
| In the 13 automations that stopped on 9 Sep     | 2,331 accounts, 1,640 owners, 11.4M Earning Power          |
| Of those owners                                 | Median ≈ $3; 208 hold $100 or more; 39 hold $1,000 or more |
| Carbon Impact                                   | 17 accounts, 11 owners, 0.19% of votes                     |
| Votes held by the top 10 owners                 | 72%; one 2-of-3 Safe holds 59.6%                           |
| Voting power that voted last epoch              | 35.9%, from 94–99% before mid-September                    |
| An automation not on Hydrex's list              | 9.3M votes for 26 owners: as many as all 14 listed ones    |

| Aerodrome                                      | Value                                                      |
| ---------------------------------------------- | ---------------------------------------------------------- |
| veAERO in relays                               | 55% (569M of 1,034M)                                       |
| Of it, in relays with two or three owners each | Most: Public Goods Funding 21%, Ouranous Foundation 19%, … |
| Owners in community relays                     | 7,006; veAERO Maxi alone 6,170                             |
| Owners in a relay, in August, by size          | 16% of all; 22–35% of those with $10,000 to $100,000       |
| Owners of a live lock                          | 51,750; the median owner holds about $0.66                 |
| Votes that carry over from earlier epochs      | 16.8% of the votes counted now                             |

What it means for design:

- **By count, people delegate.** Most small holders on Hydrex used an automation, and stayed in it after it stopped:
  defaults are sticky. For them a fee is cents a week; what they pay with is attention. They need the shortest path, on
  a phone, and to be told when something stops.
- **By value, a few decide.** Treasuries and large holders vote themselves, or through relays with two or three owners.
  On Aerodrome, mid-size owners used relays most. They need what a co-signer or a treasurer can check: the calls, the
  controls, statements.
- **The platform can end the product.** Hydrex stopped its automations; Balancer ended veBAL's economic rights, and
  Aura's TVL fell from $372M to $9.7M in a year. Each automation's page says what its protocol can change, and the
  page's checks watch for it.
- **Competition exists.** A contract not on Hydrex's list votes for 26 owners; on Aero, Autopilot is the protocol's own.

## Who would pay, and for what

Five personas, from the figures above and published research ([research.md](research.md#personas)). They are hypotheses
to test, not findings.

| Persona                  | Holds                                                                    | Wants                                              | Fears                                                    | Would pay                                          | Needs to see                                                                |
| ------------------------ | ------------------------------------------------------------------------ | -------------------------------------------------- | -------------------------------------------------------- | -------------------------------------------------- | --------------------------------------------------------------------------- |
| **The stranded holder**  | A Hydrex account in a stopped automation; median ≈ $3, a few over $1,000 | To earn again, without learning ve(3,3)            | Gas above the rewards; scams                             | A share of rewards, nothing up front               | When it last voted; one call to change; the call in plain words             |
| **The hands-off holder** | Accounts or a lock, $1,000 to $50,000                                    | Paid every week in one token, or a lock that grows | Fees that creep; changes by an admin key; a keeper stops | 2–17% of rewards, as Revert, Beefy and Convex take | Fee facts and their caps; a weekly receipt; growth against doing it oneself |
| **The optimiser**        | Several locks and liquidity positions, $10k to $500k                     | More than doing it themselves, after fees and gas  | Doing worse than the average, hidden behind an APR       | A fee, when the result beats a benchmark           | The record per epoch against themselves and the average; CSV; contracts     |
| **The treasury**         | Large locks in a Safe, often for its own pools                           | Votes and yield handled without weekly signing     | Another Bybit; co-signers who cannot check; admin keys   | A flat or capped fee that governance can approve   | The calldata; build hashes; a risk summary; monthly statements              |
| **The impact holder**    | Any size; individuals and small firms                                    | A credible retirement from their rewards           | Greenwashing; claims the law no longer allows            | The share retired is the price                     | Each retirement, its tonnes and transaction; whose name is on it            |

- **The liquidity provider** is the optimiser with a concentrated position: what they fear most is a position out of
  range, and a manager that does worse than holding.
- **On a phone,** any of them: in Coinbase Wallet, one atomic batch can carry several calls, but a file download may not
  work inside a wallet's browser, so every export has a copy option.

## The moments that matter

Each moment has a screen on the canvas.

1. **"My automation stopped."** Your positions lists it first, says it earns nothing and since when, and offers one
   choice for all such accounts at once, with what a change costs in gas.
2. **"Is it worth the fee?"** The automation's page: fee facts, money as earned, taken and yours, and its record against
   Hydrex's average.
3. **"Thursday: did it work?"** A receipt for the epoch: votes, earned, swapped, retired, fee, paid, with the
   transactions.
4. **"I want out."** Leaving says what happens now and at the flip, and works even if a check fails.
5. **"My co-signers need to agree."** A brief link that opens the page on exactly what the Safe transaction does.
6. **"It left its range."** A liquidity position shows its range, the price, its moves and what they cost.
7. **"Something changed."** If an admin key changes the share retired, a fee or a payout address, every position in that
   automation says so, with the old value, the new one and the transaction.
8. **"My lock is ending."** The position says when, and links to Hydrex or Aero to extend it.
9. **"My relay is ending."** As Aerodrome's do this week: the date, what to do before it, and what comes after. When one
   of the café's own automations ends, it says why, from when, and where to go, as Hydrex's did not.

## Principles

Kept from today's page, because they are what a sceptical payer trusts:

- Plain words, and every figure read from Base.
- The page checks an automation's code and settings before it lets anyone join; leaving always works.
- Each call is shown before the wallet asks, as the wallet will show it.
- No server, no key, nothing stored.

Added for a menu:

1. **Positions first, products second.** The connected home is what you hold.
2. **The same parts on every product:** fee facts, custody and leaving, record, controls, checks, in the same order.
3. **Money in money,** after what is taken, next to doing it yourself, never an APR on its own.
4. **Leaving before joining.** How to leave, and when it takes effect, comes before the Join button.
5. **Proof on a weekly rhythm.** Thursday is Hydrex's payday; Aero streams its rewards, so its receipts are per week.
6. **One prompt where the wallet allows.** Batch calls; fall back to one by one, and say which will happen.
7. **Two densities, one content.** Cards on a phone, tables on a desk.
8. **One dial for the owner.** People keep using an automation they can adjust a little, and drop one they saw err.
   Where a contract allows, let owners choose the payout token or the share retired.
9. **Words that hold up.** "Retired", "your share of what was retired"; never "carbon neutral" because of credits
   retired, a consumer claim EU law bans from 27 Sep 2026.
10. **No pressure.** No countdown to join, no default to the house automation where voting yourself fits better.

## Information architecture

One static page, as today, with views addressed by the hash. Today's addresses keep working.

| View                    | Address                                                                 | Today                      |
| ----------------------- | ----------------------------------------------------------------------- | -------------------------- |
| Menu (home)             | `/`                                                                     | Home                       |
| Your positions          | `#positions`                                                            | `#app`                     |
| An automation's page    | `#carbon-impact`, one each                                              | `#how-it-works`            |
| Choose for a position   | `#choose`, a dialog                                                     | The group buttons          |
| Review                  | a dialog, as today                                                      | The review                 |
| Receipts and statements | `#receipts`                                                             | —                          |
| Help me choose          | `#help-me-choose`                                                       | —                          |
| Check it yourself       | `#verify`, for all products                                             | `#verify`                  |
| Brief for co-signers    | `#for-co-signers`, with the accounts and the automation in the fragment | `#for-co-signers`, generic |
| Questions, Words        | `#questions`, `#words`                                                  | Same                       |

The fragment never reaches a server, so a brief link carries its accounts without breaking "stores nothing". The page
must check everything it reads from a fragment, as it would anything from outside.

## The front door: three directions

On the canvas, row 1, and in [screens.md](screens.md#row-1-the-front-door-three-directions).

| Direction             | For                                         | Strength                                               | Weakness                                                   |
| --------------------- | ------------------------------------------- | ------------------------------------------------------ | ---------------------------------------------------------- |
| **A. What you hold**  | Returning and stranded holders              | Straight to the rescue; personal from the first screen | Says little to someone without a wallet                    |
| **B. The menu**       | Optimisers comparing; anyone without wallet | Comparable, shareable, scales to many products         | Can turn into an APR race; crowded past six or so products |
| **C. Help me choose** | Newcomers, phones                           | Honest "nothing fits yet" and "vote yourself" answers  | Slower for experts; its logic is advice, so it needs care  |

**Recommended:** B as the home without a wallet, with A's address look-up and the stopped-automation callout on it; A as
the home once connected; C as a link from both. All three share the same parts, so the choice is about the order of
sections, not new components.

## Screens

On the canvas, rows 2 to 6, and in [screens.md](screens.md).

- **Your positions** (desktop and phone). A summary of last epoch: earned, fees and retired, yours, next payout. "Needs
  you" first. Then positions by protocol, each with who looks after it, its status and last epoch. On a desk, tables
  with ticks and a bar for what to do with the ticked ones.
- **Choose for one account** (phone). The automations that fit it, with last epoch's figures at the same prices, "Vote
  yourself" among the choices, and what a change costs in gas. A new automation says "no record yet".
- **Review** (phone, clickable). Today's three steps, plus fee facts in "What changes", an estimate for the accounts
  picked ("not a promise"), one wallet request for several accounts, and a calendar file for payday when done.
- **An automation's page.** One template: what it does, key facts, a panel for your accounts, fee facts, money per 1,000
  Earning Power, record, how it voted, what joining allows, if you join now, who controls what, checks. The Aero relay
  uses the same template, and shows what changes: custody in two tokens, the two queues, Aero's fee in and out, and "no
  record yet" instead of a projected APR.
- **Receipt** (phone) and **statements** (desktop). A receipt per position per epoch, as a café receipt. A table of
  epochs with totals; CSV, a CSV for tax tools, and print.
- **A managed liquidity position.** Range and price over time, moves with their cost, and against holding the two tokens
  and a full-range position, as a waterfall that shows a loss as plainly as a gain.
- **From a Safe.** The proposal in plain words, the calls, a brief link for co-signers with an optional reason for the
  record, the status Safe{Wallet} reports, and the treasurer's statement.
- **Patterns.** Fee facts for four kinds of product, money, the epoch as a clock, custody, status.

## Patterns

### Fee facts

The same six rows, in this order, for every product, on its page, in the review, and in Choose:

1. **Taken:** each cut, with its base ("of the rewards", "of the fees it collects").
2. **The most it can become:** the cap in the contract, or "no cap" in words.
3. **Goes to:** carbon credits, a treasury, an operator, a keeper.
4. **When:** each payout, each compounding, each collection.
5. **Other costs:** swaps, the lock, gas if the owner pays it.
6. **Who can change it:** the role, its holder, and any delay before a change applies.

It is read from the contract each time the page opens, with the block. A product that cannot fill a row does not go on
the menu.

### Money

- Earned, then what was taken, then what reached you, always in that order, with a bar split the same way.
- Dollars at prices in the protocol's pools when the epoch ended, marked ≈, with the token amount beside.
- Per position for the owner, per 1,000 units of voting power to compare products.
- A benchmark beside each figure: Hydrex's average per 1,000 Earning Power, doing it yourself, or holding the two tokens
  and a full-range position. Shown whether the product is ahead or behind.
- **Worth it?** For a small position, what a change costs in gas next to what it would earn in a week.
- No APR or APY as a headline. If one is shown, it says over which epochs, and a projection says it is one.

### Custody and leaving

One line, before anything else, from three kinds:

- **Stays in your wallet:** an approval. Leave with one call; claims stop at once; votes come back at the flip. Hydrex
  automations.
- **Moves into the relay:** your stake is pooled with everyone's. You hold a token that withdraws it (PT) and one that
  earns (YT). Deposits and withdrawals wait in queues; a withdrawal keeps earning while it waits, and cannot be
  cancelled. Aero relays.
- **Swapped for shares:** you hold vault shares; withdraw for the tokens they are worth then.

### Status

A shape and words, never colour alone: running (filled dot, with when it last acted), joining and leaving (half dots,
with the date of the flip), not looked after (hollow dot), stopped (triangle, with the last time it acted, and "earns
nothing"), checks failed (square: joining off, leaving works).

### Time

The epoch as a clock: now, the vote, the flip, the payout. Every action says what moves now and what moves at the flip,
in UTC and in the visitor's time, as the page does today.

### Change watch

When an automation's settings change, its page and every position in it show the change, the date and the transaction,
until the owner has seen it. Without storage, "seen" cannot be remembered across devices; the page shows changes from
the last four epochs instead.

### Freshness

Every automation shows when it last acted: voted, compounded, moved a range, paid. Past its usual rhythm, the status
turns to "late", then "stopped", with what that costs. Where an automation will not act, the page says why: below a
threshold, gas above the reward.

### Consent to what cannot be undone

A side effect that cannot be reversed gets a box to tick in the review, in plain words: "My withdrawal request cannot be
cancelled", "Unclaimed rewards will be claimed by the automation, including those my own votes earned". Not for anything
that can be undone, so that the boxes keep their weight.

### Clear signing

The page shows each call in plain words before the wallet asks; the wallet should say the same. Publishing ERC-7730
metadata for the calls the page sends, starting with `setConduitApproval`, lets wallets that support it describe them in
plain words too. In a study of 128 people, plain-language decoding of what a transaction does raised how many risky ones
they caught.

## Within the page's rules

The page holds no key, has no server, stores nothing, and reaches only three Base RPCs. Each new need, and how it fits:

| Need                         | How, within the rules                                                                                 | Cost or risk                                                   |
| ---------------------------- | ----------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| Receipts, payout history     | Find the stretches of 100 blocks where `totalTonnesRetired` changes, then read their events           | 17 to 118 calls a run: the free RPCs give 100 blocks of logs   |
| Value of a position          | Prices as the page already computes them for what votes earned                                        | None new                                                       |
| Change watch                 | Read the settings' events, as for receipts                                                            | As for receipts                                                |
| One prompt for many accounts | EIP-5792 `wallet_sendCalls` where `wallet_getCapabilities` says so: MetaMask, Safe, Coinbase Wallet   | Rabby, Zerion and Phantom do not support it: one by one        |
| Look up an address           | The same reads, without a wallet                                                                      | None                                                           |
| Brief for co-signers         | The accounts and the automation in the URL fragment                                                   | Check everything read from it                                  |
| Calendar file, CSV, image    | Made in the browser, downloaded                                                                       | In-app browsers on iOS may not download: offer to copy instead |
| Safe status                  | Safe{Wallet} reports it to the page through the Safe Apps SDK                                         | None new                                                       |
| Aero and liquidity reads     | More contracts, and their code hashes, in `src/config.ts`                                             | More checks to keep up to date                                 |
| Alerts                       | A calendar file with a weekly rule; Basescan's Watch List, which e-mails activity on a payout address | Push, a bot or an e-mail of our own needs a server: a decision |
| A feed of settings changes   | An Atom file built by CI from the automations' events, published beside the page                      | A scheduled job; the page itself still reaches only the RPCs   |

## Roadmap

- **Now (0.4): the rescue.** Positions first in the App; Choose for one or many accounts, with the gas cost; one prompt
  with batching; fee facts for Carbon Impact; the receipt for the last epoch; change watch; ERC-7730 metadata for
  `setConduitApproval`.
- **Next (0.5): the second Hydrex relay.** The menu as Home; the automation page template; Choose comparing two
  automations and voting yourself; Help me choose; statements and export.
- **Later: Aero and liquidity.** The relay template with "moves into the relay", queues and weekly receipts, once Aero
  has opened and granted the role to deploy a relay; liquidity positions with range, moves, and against holding and full
  range; the Safe brief link.

This week, outside the roadmap: members of Klima's two Aerodrome relays need to hear that they must withdraw by Tue 20
Oct, and how.

## How to know it works

The page collects nothing, so the measures come from Base:

- Accounts and Earning Power leaving stopped automations each epoch, and where they go.
- Earning Power in each automation, and how much leaves each epoch.
- The share of joins made with one batched prompt; Safe transactions executed after a brief was made.

And from people: five moderated sessions per persona, on their own phone or desk, with three tasks ("Is your account
earning?", "What would this cost you?", "Leave"), and three questions after joining: when do the votes move, what is
taken, how do you leave.

## Open questions

- **Fees and caps** for each new product, who holds each admin key, and any delay before a change applies. Carbon
  Impact's single admin key, which can raise the share retired to 100%, would most likely rate Stage 0 on DeFiScan's
  scale; naming its holder, signers and threshold, as Convex does, costs nothing.
- **Autopilot:** its fee is not published. What a café relay offers against it decides whether there should be one.
- **Alerts:** whether to run anything that can send, and who would run it.
- **History:** whether RPC reads are enough, or an indexer is worth reaching a fourth host.
- **Attribution:** retirements in a member's own name need a new automation, or a second call from the member.
- **Words:** "automation" for Hydrex and "relay" for Aero, or one word for both; how far to take the café.
- **Aero relays:** which tier (an allow list, or open to anyone), who is on the allow list, Aero's fee, the keeper's
  window and the evacuation window. What is known so far is in [research.md](research.md#aeros-v3-relays), from Dromos's
  interfaces, not deployed contracts.
