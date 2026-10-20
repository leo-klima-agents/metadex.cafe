# Design

What metaDEX Café is today, what it should become, and why. The brand, from type and colour to the layout of receipts,
is in [brand.md](brand.md).

Figures were read from Base on 17 Oct 2026, unless marked. [Brackets] mark decisions not yet taken, such as "[cap]".
Mockups of the planned screens are on a design canvas, private to its owner:
<https://claude.ai/artifact/XWN6n3DdJEcgaWbD1GDsA5>. Its screens use placeholder colours and type.

## The page today

One static page for one automation, Carbon Impact, with three views addressed by the hash. Every section has an address
of its own, and the views work without the script.

- **Home** (`/`): what Carbon Impact does, whether it still votes, and that Hydrex's other automations stopped. Its
  figures: tonnes retired, the share retired, its Earning Power, when the epoch ends, and what last epoch earned per
  1,000 Earning Power. Then how it works in three steps, what you keep, give and get, a comparison with voting yourself
  and with staying in a stopped automation, why it is safe to try, and common questions.
- **The App** (`#app`): a summary of the wallet's accounts, and the epoch as a timeline. Then the accounts, grouped by
  what the owner can do with them: in an automation that stopped, needs attention, in Carbon Impact, joining, leaving,
  can join, can't join. A group whose button can act on several accounts has boxes to tick. Last, a receipt for each
  account in the last payout, and the payout address.
- **The review:** a dialog in up to three steps: before you join, what changes, and the calls, each as a slip with its
  fields as the wallet will show them. One transaction at a time. Inside Safe{Wallet}, one Safe transaction, with its
  calldata word by word.
- **How it works** (`#how-it-works`): everything in full. The stopped automations, what joining allows, when things
  happen, how the votes did last epoch against all of Hydrex, who controls what, the carbon credits, a brief for
  co-signers, what the page checks, questions, and words.

Every new screen keeps the page's rules:

- Plain words, and every figure read from Base.
- The page checks an automation's code and settings before anyone can join. Leaving always works.
- Each call is shown before the wallet asks, as the wallet will show it.
- No server, no key, nothing stored. The page reaches three Base RPCs and nothing else.
- Addresses and hashes in full, in groups of four. Only the wallet chip and transaction links use the short form.
- Each status has a shape and words, never colour alone.

## Who it is for

Two audiences. By count, many small holders delegate, and stay put. By value, a few large holders decide.

- **Hydrex:** 3,508 owners hold accounts with votes, and the median owner holds about $6. 1,648 of them (47%) have an
  account in an automation, yet automations hold only 2% of the votes. The top 10 owners hold 72% of the votes; one
  2-of-3 Safe holds 59.6%.
- **Stranded accounts:** 2,331 accounts of 1,640 owners still sit in the 13 automations that stopped on 9 Sep 2026, with
  11.4M Earning Power that earns nothing. The median owner among them holds about $3, 208 hold $100 or more, and 39 hold
  $1,000 or more. Moving an account costs about $0.004 in gas. Hydrex's app only tells them to switch to "No
  Automation".
- **Carbon Impact:** 17 accounts of 11 owners, 0.19% of the votes. In the epoch from 8 to 15 Oct, its 1.17M Earning
  Power voted for 27 pools and earned about $693, or $0.59 per 1,000 Earning Power.
- **Competition:** a contract not on Hydrex's list votes for 26 owners, with as many votes as all of Hydrex's 14
  automations together. On Aero, Autopilot is the protocol's own.
- **Aerodrome:** relays held 55% of veAERO, most of it in relays with two or three owners each; 7,006 owners used
  community relays. Aero replaces Aerodrome on Thu 22 Oct 2026, and relay members must withdraw by Tue 20 Oct. Klima's
  two relays, KLIMA veAERO and Balanced Klimate veAERO, are among them.
- **Platforms end products:** Hydrex stopped its automations without a reason or a date. Balancer ended veBAL's economic
  rights, and Aura's TVL fell from $372M to $9.7M in a year. Each automation's page should say what its protocol can
  change, and the checks should watch for it.

### Personas

Hypotheses to test, not findings.

| Persona                    | Holds                                                | Wants                                           | Would pay                                  | Needs to see                                         | Wrong if                                                    |
| -------------------------- | ---------------------------------------------------- | ----------------------------------------------- | ------------------------------------------ | ---------------------------------------------------- | ----------------------------------------------------------- |
| **The stranded holder**    | An account in a stopped automation; median about $3  | To earn again without learning how voting works | A share of rewards, nothing up front       | When it last voted; one call to change; plain words  | Few act once told: then attention, not choice, is the limit |
| **The hands-off holder**   | Accounts or a lock, $1,000 to $50,000                | Paid weekly in one token, or a lock that grows  | 2–17% of rewards, as Beefy and Convex take | Fee facts and their caps; a weekly receipt           | They choose by headline APR rather than by token and fee    |
| **The optimiser**          | Several locks and liquidity positions, $10k to $500k | More than doing it themselves, after fees       | A fee, when the result beats a benchmark   | The record per epoch against a benchmark; CSV        | They will not join without a projected APR                  |
| **The treasury**           | Large locks in a Safe                                | Votes and yield handled without weekly signing  | A flat or capped fee governance can pass   | The calldata; build hashes; a risk summary           | They need to direct their own votes: then a custom relay    |
| **The impact holder**      | Any size                                             | A credible retirement from their rewards        | The share retired is the price             | Each retirement, its tonnes and transaction          | They leave once the share retired is shown in dollars       |
| **The liquidity provider** | A concentrated position                              | A position kept in range                        | About 10% of fees, as managers take        | Its range, its moves, and the result against holding | They prefer pooled vaults to positions kept in their wallet |

On a phone, any of them: Coinbase Wallet can send several calls in one prompt, but a download may not work inside a
wallet's browser, so every export also offers a copy.

### The moments that matter

1. **"My automation stopped."** Show it first, say it earns nothing and since when, and offer one choice for all such
   accounts, with the gas cost.
2. **"Is it worth the fee?"** Fee facts, money as earned, taken and yours, and the record against Hydrex's average.
3. **"Thursday: did it work?"** A receipt for the epoch, with the transactions.
4. **"I want out."** What happens now and at the flip, and leaving works even if a check fails.
5. **"My co-signers need to agree."** A link that opens the page on exactly what the Safe transaction does.
6. **"It left its range."** A liquidity position shows its range, the price, its moves and their cost.
7. **"Something changed."** When an admin key changes a share, a fee or a payout address, every position in that
   automation says so, with the old value, the new one and the transaction.
8. **"My lock is ending."** The position says when, and links to the protocol to extend it.
9. **"My automation is ending."** The date, what to do before it, and where to go after.

## Principles

1. **Positions first, products second.** Once connected, the page starts from what you hold.
2. **The same parts on every product,** in the same order: fee facts, custody and leaving, record, controls, checks.
3. **Money in money:** earned, then taken, then yours, next to doing it yourself. Never an APR as a headline.
4. **Leaving before joining.** How to leave, and when it takes effect, comes before the Join button.
5. **Proof every week.** Hydrex pays on Thursdays; Aero streams its rewards, so its receipts are weekly.
6. **One prompt where the wallet allows it.** Batch the calls with EIP-5792; otherwise one by one, and say which.
7. **Two densities, one content:** cards on a phone, tables on a desk.
8. **One dial for the owner.** People keep using an automation they can adjust a little, and drop one they saw err.
   Where a contract allows it, let owners choose the payout token or the share retired.
9. **Words that hold up:** "retired" and "your share of what was retired", never "carbon neutral". See
   [brand.md](brand.md#what-the-page-may-claim).
10. **No pressure:** no countdown to join, and no nudge towards the house automation where voting yourself fits better.

## Roadmap

- **Done:** the stopped automations, and a way out of them; what votes earned against all of Hydrex; each account's last
  payout as a receipt, with up to when it was paid and what waits; Safe transactions with their calldata; the brand;
  Choose for one or many accounts, with the gas cost; fee facts for Carbon Impact.
- **Next, the rescue:** positions first in the App; one prompt with batching; change watch; ERC-7730 metadata for
  `setConduitApproval`.
- **Then, a second Hydrex automation, AutoMaxi:** on Base since 20 Oct 2026, in its version 2. It votes for the bribes
  it expects to earn the most, and pays in the tokens earned, unswapped, less 1% of each claim. Done: the menu on Home,
  one page template per automation, and Choose comparing the two and voting yourself. Still to do: Help me choose;
  statements and export.
- **Later, Aero and liquidity:** Aero relays, once Aero grants the role to deploy one; managed liquidity positions; the
  brief link for co-signers.

## Views

One static page, as today, with views addressed by the hash. Today's addresses keep working.

| View                    | Address                                                            | Today                              |
| ----------------------- | ------------------------------------------------------------------ | ---------------------------------- |
| Menu (Home)             | `/`                                                                | Home, with the menu                |
| Your positions          | `#positions`                                                       | `#app`                             |
| An automation's page    | One each: `#carbon-impact`, `#automaxi`                            | Same, with `#how-it-works` in full |
| Choose for a position   | `#choose`, a dialog                                                | A dialog beside the group buttons  |
| Review                  | A dialog                                                           | The review                         |
| Receipts and statements | `#receipts`                                                        | The last payout only               |
| Help me choose          | `#help-me-choose`                                                  | —                                  |
| Check it yourself       | `#verify`, for every product                                       | `#verify`                          |
| Brief for co-signers    | `#for-co-signers`, with the accounts and automation in the address | `#for-co-signers`                  |
| Questions, Words        | `#questions`, `#words`                                             | Same                               |

The fragment of an address never reaches a server, so a brief can carry its accounts without the page storing anything.
The page must check whatever it reads from a fragment, as it would anything from outside.

## Screens

**The front door.** Without a wallet, Home is the menu: automations grouped by what they look after, with an address
look-up and the stopped-automation callout on top. With a wallet, Home is your positions. Help me choose is a link from
both, never a gate.

**Your positions.** A summary of last epoch: earned, fees and retired, yours, and the next payout. Then "Needs you",
with one action each: an automation that stopped or is ending, a position out of range, an account that has not voted.
Then positions by protocol, each with who looks after it, its status and last epoch. On a desk, tables with boxes to
tick and a bar for what to do with the ticked ones; on a phone, a card per position.

**Choose for one account.** The automations that fit it, with last epoch's figures per 1,000 Earning Power at the same
prices, "Vote yourself" among the choices, and the gas cost next to what the account would earn in a week. A new
automation says "no record yet". A table compares them on demand: pays in, taken, the most it can take, leaving.

**The join review.** Today's three steps. "What changes" adds the fee facts and an estimate for the accounts picked,
marked "not a promise". "What your wallet will ask" sends one request for several accounts where the wallet can batch.
"Done" offers a calendar file for payday, made on the device.

**An automation's page,** one template for all: status; what it does; four key facts (takes, pays you, costs you,
leaving) and Join; your accounts in it; fee facts; money per 1,000 units of voting power; its record against the
average; how it voted; what joining allows, and custody; if you join now; who controls what; what the page checks.
Carbon Impact's admin key and keeper go under "who controls what", with the holder named once known.

**An Aero relay's page,** the same template, with what changes: custody moves into the relay, you hold two tokens,
deposits and withdrawals wait in queues, and Aero takes a fee in and out. Until its first allocation it shows "no record
yet", and never a projected APR. It follows Dromos's interfaces, not deployed contracts: to confirm with Dromos.

**A receipt per epoch,** per position: votes, earned, swapped, retired with its tonnes, fee, and paid, with the
transactions; then what voting yourself would have kept. Three things to keep, each made on the device: a CSV, an image
of your impact, and a calendar file for Thursdays. Then your share of what was retired, as Carbon Impact retires in one
name for every member.

**Statements and export,** on a desk: totals for a period (earned, retired, fees, reached you), a row per epoch, and a
CSV, a CSV for tax tools, or a printed statement. Then the result against doing it yourself, at the same prices.

**A managed liquidity position:** worth now, its range, the price, time in range, and the result against holding the two
tokens. A chart of the price over the range it earned fees in, with each move. A waterfall from what was put in to now,
which shows a loss as plainly as a gain: price, being concentrated, fees, the manager's fee, the swaps of each move.
Then fee facts, custody, how to stop, and a table of moves with their cost and transaction.

**From a Safe:** the proposal in plain words, the calls, and a brief link for the other owners, with an optional reason
for the record. Then the status Safe{Wallet} reports, and a monthly statement for the treasurer.

**Help me choose:** three questions, then a suggestion with a reason for each answer, its facts, and an honest line: "If
you only want the most, and have time each week, vote yourself."

1. What do you hold? Hydrex accounts; an Aero stake or Aerodrome lock; a liquidity position; not sure.
2. What should happen to the rewards? Paid to me as they are earned; added to what I hold; partly retired; as much as
   possible.
3. How much do you want to do each week? Nothing; a little; I will vote myself.

The first rule that matches decides. After a liquidity manager, the honest line becomes "If you can watch the price and
move the range yourself, you keep everything."

| When                                       | Suggestion                                                           |
| ------------------------------------------ | -------------------------------------------------------------------- |
| Not sure what they hold                    | Look at what you hold first                                          |
| Will vote themselves, and want the most    | Vote yourself: nothing on the menu beats it, if you vote well        |
| Hydrex accounts, rewards added to the lock | Nothing fits yet; the closest choices                                |
| Hydrex accounts, partly retired            | Carbon Impact                                                        |
| Hydrex accounts, anything else             | AutoMaxi, paying in the tokens earned, less 1%; Carbon Impact second |
| An Aero stake or Aerodrome lock            | [Aero relay]                                                         |
| A liquidity position                       | [Liquidity manager]                                                  |

## Patterns

**Fee facts.** The same six rows, in this order, for every product, on its page, in the review and in Choose. They are
read from the contract each time, with the block. A product that cannot fill a row does not go on the menu.

1. **Taken:** each cut, with its base, such as "of the rewards".
2. **The most it can become:** the cap in the contract, or "no cap" in words.
3. **Goes to:** carbon credits, a treasury, an operator, a keeper.
4. **When:** each payout, each compounding, each collection.
5. **Other costs:** swaps, the lock, gas if the owner pays it.
6. **Who can change it:** the role, its holder, and any delay before a change applies.

For the four kinds of product:

| Kind                                         | Taken                                  | Most            | Goes to                  | When             | Other costs   | Who can change it        |
| -------------------------------------------- | -------------------------------------- | --------------- | ------------------------ | ---------------- | ------------- | ------------------------ |
| Votes for you, retires a share               | Of the rewards: 33.33% retired, 0% fee | 100%, 1%        | Carbon credits; treasury | Each payout      | Swaps         | One admin key            |
| Votes for you, pays you as earned (AutoMaxi) | Of each claim: 1%                      | 1%, in its code | A 2-of-3 Safe            | Each claim       | None          | Nobody: a new deployment |
| Pools your stake in a relay                  | Of the deposit, then of the rewards    | [cap]           | Aero; [operator]         | Each compounding | Swaps         | [Role, delay]            |
| Manages a liquidity position                 | Of fees and emissions: [10%]           | [cap]           | [Operator]               | Each collection  | A swap a move | [Role, delay]            |

**Money.** Earned, then taken, then what reached you, always in that order, with a bar split the same way. Dollars at
the prices in the protocol's pools when the epoch ended, marked ≈, with the tokens beside them. Per position for the
owner; per 1,000 units of voting power to compare products. A benchmark beside each figure (the average, doing it
yourself, or holding the two tokens), whether the product is ahead or behind. For a small position, the gas of a change
next to a week's earnings. An APR only with the epochs it covers, and a projection says it is one.

**Custody and leaving,** one line before anything else:

- **Stays in your wallet:** an approval. Leave with one call; claims stop at once, and votes come back at the flip.
  Hydrex automations.
- **Moves into the relay:** your stake is pooled. You hold one token to withdraw it (PT) and one that earns (YT).
  Deposits and withdrawals wait in queues; a withdrawal keeps earning while it waits, and cannot be cancelled. Aero
  relays.
- **Swapped for shares:** you hold vault shares, and withdraw the tokens they are worth then. Compounders and pooled
  liquidity.

**Status:** a shape and words. Running, a filled dot with when it last acted. Joining and leaving, a half dot with the
date of the flip. Not looked after, a hollow dot. Stopped, a triangle with when it last acted and "earns nothing".
Checks failed, a square: joining off, leaving works.

**Time:** the epoch as a clock: now, the vote, the flip, the payout. Every action says what moves now and what moves at
the flip, in UTC and in the visitor's time.

**Change watch:** when an automation's settings change, its page and every position in it show the change, the date and
the transaction. The page stores nothing, so it cannot remember what was seen: it shows changes from the last four
epochs.

**Freshness:** every automation shows when it last acted. Past its usual rhythm, its status turns to "late", then
"stopped". Where an automation will not act, the page says why, such as gas above the reward.

**Consent:** a side effect that cannot be undone gets a box to tick in the review, in plain words, such as "My
withdrawal request cannot be cancelled". Nothing that can be undone gets one, so that the boxes keep their weight.

**Clear signing:** the page shows each call in plain words before the wallet asks. Publishing ERC-7730 metadata for the
calls, starting with `setConduitApproval`, lets wallets that support it say the same. In a study of 128 people,
plain-language decoding raised how many risky transactions they caught.

## Within the page's rules

| Need                         | How                                                                            | Cost or risk                                                 |
| ---------------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------ |
| Value of a position          | The prices the page already computes                                           | None                                                         |
| Receipts and history         | Search the block where `tokenTimestamp` reached each account's last epoch paid | About 22 requests a payout, and one of logs per block        |
| Change watch                 | Find the 100-block stretches where a setting changed, then read their logs     | 17 to 118 requests, as the free RPCs give 100 blocks         |
| One prompt for many accounts | EIP-5792 `wallet_sendCalls` where `wallet_getCapabilities` allows it           | Rabby, Zerion and Phantom lack it: one by one there          |
| Look up an address           | The same reads, without a wallet                                               | None                                                         |
| Brief for co-signers         | The accounts and the automation in the fragment                                | Check everything read from it                                |
| Calendar file, CSV, image    | Made in the browser                                                            | In-app browsers on iOS may not download: offer a copy too    |
| Safe status                  | Safe{Wallet} reports it through the Safe Apps SDK                              | None                                                         |
| Aero and liquidity           | More contracts and code hashes in `src/config.ts`                              | More checks to keep up to date                               |
| Alerts                       | A calendar file; Basescan's Watch List e-mails activity on a payout address    | Push, a bot or our own e-mail needs a server: a decision     |
| A feed of settings changes   | An Atom file built by CI from the automations' events                          | A scheduled job; the page itself still reaches only the RPCs |

## How to know it works

The page collects nothing, so the measures come from Base: accounts and Earning Power leaving stopped automations each
epoch, and where they go; Earning Power in each automation, and how much leaves; the share of joins made with one
batched prompt; Safe transactions executed after a brief was made.

And from people: five moderated sessions per persona, on their own phone or desk, with three tasks: "Is your account
earning?", "What would this cost you?", and "Leave". After joining, three questions: when do the votes move, what is
taken, and how do you leave.

## Open questions

- **Fees and caps** for each new product, who holds each admin key, and any delay before a change applies. Carbon
  Impact's single admin key can raise the share retired to 100%, which would likely rate Stage 0 on DeFiScan's scale.
  Naming its holder, signers and threshold, as Convex does, costs nothing.
- **Autopilot:** its fee is not published. What a café relay offers against it (a payout token, retirement, receipts)
  decides whether there should be one.
- **Alerts:** whether to run anything that can send, and who would run it.
- **History:** whether RPC reads are enough, or an indexer is worth a fourth host.
- **Attribution:** retirements in a member's own name need a new automation, or a second call from the member.
- **Words:** "automation" for Hydrex and "relay" for Aero, or one word for both.
- **Aero relays:** which tier, who is on the allow list, Aero's fee, the keeper's window and the evacuation window.

## Evidence

### How the figures were read

From Base mainnet on 17 Oct 2026, 20:29 to 20:49 UTC, through Multicall3 in batches of 200 calls, each script pinned to
one block (52,739,819 to 52,740,387). No read failed. Hydrex: VotingEscrow `0x25B2ED7149fb8A05f6eF9407d9c8F878f59cd1e1`,
Voter `0xc69E3eF39E3fFBcE2A1c570f8d3ADF76909ef17b`, and the automations in
[`src/hydrex-conduits.json`](../src/hydrex-conduits.json). Aerodrome: VotingEscrow
`0xeBf418Fe2512e7E6bd9b87a8F0f294aCDC67e6B4`, Voter `0x16613524e02ad97eDfeF371bC883F2F5d6C480A5`.

- **Hydrex's votes:** 469.8M votes, or 610.8M Earning Power, at about $0.0246 per HYDX. 123,857 accounts minted, 6,183
  holding votes; 96.3% of votes are in permanent locks. 1,000 Earning Power is worth about $19.
- **Who votes with them:** the owners themselves, 86.85% of votes; 21 other addresses, 11.08%; the 13 stopped
  automations, 1.87%; Carbon Impact, 0.19%. 35.9% of voting power voted last epoch, down from 94–99% before
  mid-September.
- **In August,** before Hydrex stopped its automations, 2,270 owners used one, with 11–13% of the votes cast. Use fell
  with size: most owners under $1,000 used one, one in eight between $100,000 and $1M, and the largest holder none.
- **Carbon Impact's settings:** `retireBps` 3333, `treasuryFeeBps` 0. It has retired 22,141 kVCM as 5,691 tonnes, about
  3.9 kVCM a tonne, with kVCM at about $0.0273.
- **Aerodrome:** 1,034M veAERO; 75 relays hold 569M of it. In August, 16% of owners used a relay, and 22–35% of those
  holding $10,000 to $100,000.

### Aero's relays

From the interfaces in Dromos Labs' public repository
([IRelay](https://github.com/Dromos-Labs/metadex-public/blob/main/V3/src/interfaces/relay/IRelay.sol),
[IRelayFactory](https://github.com/Dromos-Labs/metadex-public/blob/main/V3/src/interfaces/relay/IRelayFactory.sol)), not
deployed contracts. Aero opens on Thu 22 Oct 2026; veAERO becomes sAERO, a staked position whose allocation can change
every 48 hours at first, and whose rewards stream ([Aero](https://aero.xyz/aero-upgrade/)).

- **Tiers:** Maxi relays take anyone's deposit; Protocol L1 relays have an allow list and fixed entrypoints; L2 relays
  can change their entrypoints after a timelock that a vetoer can cancel. Deploying one needs a role Aero grants.
- **Deposits** wait in a queue until the keeper takes them in. Each gives two tokens: PT, which carries the right to
  withdraw, and YT, which earns.
- **Withdrawals** wait in a first-in, first-out queue, keep earning, and cannot be cancelled. If the oldest request
  waits a full evacuation window, anyone can close the relay, and every stake comes back.
- **The manager** can remove an address from the allow list, which puts its stake in the withdrawal queue.
- **Fees:** Aero takes a fee on deposit and on withdrawal; its rate is not in the interfaces.

Unlike a Hydrex automation, a deposit moves the stake out of the owner's position. A café relay would be a Protocol
relay, made with Aero's agreement.

### What comparable products charge

As each published it on 17 Oct 2026.

| Product                 | Does                                      | Takes                                                                                                                                  |
| ----------------------- | ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Hydrex's automations    | Vote, claim, pay out                      | 0.5% or 1% of earnings, as its sources disagree; Lock Maxi nothing                                                                     |
| Carbon Impact           | Vote, claim, retire, pay out              | 33.33% retired; a fee of 0%, up to 1%                                                                                                  |
| AutoMaxi                | Vote for bribes, claim, pay out unswapped | 1% of each claim, fixed in its code                                                                                                    |
| Autopilot, on Aerodrome | Vote, pay out in USDC                     | 5% of rewards ([DefiLlama](https://defillama.com/protocol/autopilot))                                                                  |
| Convex                  | Votes for Curve lockers                   | 17% of CRV rewards, capped at 20% ([docs](https://docs.convexfinance.com/convexfinance/faq/fees.md))                                   |
| Votium                  | Vote incentives market                    | 2% of incentives, capped at 4% ([docs](https://docs.votium.app/faq/fees.md))                                                           |
| vfat                    | Automates farms and positions, per user   | 0.9–1.8% of rewards; 0.01–0.05% of a position per rebalance ([docs](https://docs.vfat.io/fees/))                                       |
| Revert                  | Keeps positions in range                  | 0.15% of the position or 2% of fees ([docs](https://docs.revert.finance/revert/auto-range.md))                                         |
| Beefy CLM               | Pooled liquidity vaults                   | Up to 9.5% of trading fees, shown net ([docs](https://docs.beefy.finance/beefy-products/clm.md))                                       |
| ICHI, Gamma             | Pooled liquidity vaults                   | 10% ([ICHI](https://docs.ichi.org/home/protocol-fees.md)); 14–20% ([Gamma](https://docs.gamma.xyz/gamma/lp-vaults/faq/using_gamma.md)) |

2–10% of rewards is the norm for voting and compounding, and about 10% of fees for managed liquidity. Carbon Impact's
third retired is far above both, which suits people who want the retirement. AutoMaxi's 1% is below the norm. The next
products should sit in the norm, and say how they compare.

Worth copying: one plain sentence per strategy; "no automation" next to the products; states that say when, such as
"earning from next epoch"; ticked consent to side effects that cannot be undone; a payout ledger per account; when it
last ran; fees net and split by component; one fee table with the cap; saying when it will not run; admin powers in a
list that leads with what fails; a benchmark; a way out without the front end. To avoid: fees that disagree between
pages; one APR for every product; risk scores that reassure more than they inform; approvals that linger with no way to
revoke them in the app; silent sunsets.

### Liquidity: what a manager can promise

Most providers do worse than holding the two tokens. In 17 Uniswap v3 pools in 2021, providers earned $199.3M in fees
and lost $260.1M to price moves ([arXiv](https://arxiv.org/abs/2111.09192)). On Base's WETH/USD pools, about one
provider in six avoids losses ([arXiv](https://arxiv.org/abs/2604.22069)). Even the best range in Uniswap v3's USDC/ETH
0.05% pool over 2023–24 earned less than holding ([arXiv](https://arxiv.org/pdf/2504.16542)). So a manager can promise a
process, not an outcome: report the result against holding and against a full range, net of its fee and of gas, with
fees and incentives apart.

### Trust and safety

- **Plain words help.** Decoding a transaction in plain language raised how many risky ones people caught
  ([arXiv](https://arxiv.org/abs/2601.16751)). ERC-7730 lets wallets do it from metadata the dapp publishes.
- **Front ends get hijacked.** Bybit's $1.4–1.5B loss came from JavaScript served by Safe{Wallet}'s front end
  ([NCC Group](https://www.nccgroup.com/research/in-depth-technical-analysis-of-the-bybit-hack/)), and the Aerodrome DNS
  hijack of Nov 2025 drained users through a cloned site. The defences are the page's own: published hashes, a
  reproducible build, the official address.
- **Signatures drain wallets.** Permit signatures caused 38% of large phishing losses in 2025
  ([Scam Sniffer](https://drops.scamsniffer.io/scam-sniffer-2025-crypto-phishing-losses-fall-83-to-84-million/)). The
  page asks for transactions, never signatures.
- **Leaving is a revocation,** and belongs next to Join.
- **Centralisation:** DeFiScan rates a protocol Stage 0 while an operator controls it; Stage 1 needs a seven-day exit
  window or a security council ([DeFi Collective](https://deficollective.org/blog/introducing-defiscan)).
- **Batching:** EIP-5792 is final, and 8 of 21 wallets support it, including MetaMask, Safe and Coinbase Wallet
  ([walletbeat](https://beta.walletbeat.eth.limo/wallet/eip/5792/)).
- **Adjusting keeps people:** people drop an algorithm after seeing it err, and keep one they can adjust a little
  ([Dietvorst 2018](https://ideas.repec.org/a/inm/ormnsc/v64y2018i3p1155-1170.html)).

### Disclosure elsewhere

Not binding on a page that holds nothing for anyone, but a guide to showing fees fairly. MiCA asks for information that
is "fair, clear and not misleading" ([Art. 66](https://www.springlex.eu/en/packages/mica/mica-regulation/article-66/));
MiFID II for costs in money and in percent, and their effect on return
([2017/565](https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:32017R0565)); the SEC for net performance next to
gross, over the same period ([275.206(4)-1](<https://www.law.cornell.edu/cfr/text/17/275.206(4)-1>)). The UK's rules for
cryptoassets apply from 25 Oct 2027 ([FCA](https://www.fca.org.uk/publications/policy-statements/cryptoasset-regime)).

### Alerts and exports without a server

Base mini-app notifications, XMTP agents and Telegram bots all need a server or a key. A calendar file with a weekly
rule ([RFC 5545](https://www.rfc-editor.org/rfc/rfc5545)), Basescan's Watch List, which e-mails the activity of up to 50
addresses, and an Atom feed built by CI ([RFC 4287](https://www.rfc-editor.org/rfc/rfc4287)) do not. For exports,
Koinly's universal CSV takes the date in UTC, amounts and currencies sent and received, the fee, the value, a tag such
as "reward", a description and the transaction hash
([Koinly](https://intercom.help/koinly/en/articles/9489976-how-to-create-a-custom-csv-file-with-your-data)).
