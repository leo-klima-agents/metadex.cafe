# Products

How the page grows from one kind of product to two: the Hydrex automations it has, and a swap of many tokens into one.
On the way, it gains a way to claim AutoMaxi's rewards when its keeper is late. It is UX research and a plan, written
for the owner, who has decisions to take, and for whoever implements it. [Brackets] mark those decisions;
[Decisions](#decisions) lists them with a recommendation each. Where this file disagrees with [audit.md](audit.md), this
file wins for the parts it covers.

Read on 21 Oct 2026, from version 0.5.2 of the page (main at `5b7b9d8`), AutoMaxi version 2 at
`0x692c323B425A9DfeebE302F56168a7798D93EAC5`, and the six swappers deployed that day. Both contracts' sources are
verified with an exact match on Basescan and Sourcify, and their verified files name no author and no repository, so the
page links to them there, as it does for AutoMaxi today, and never to a repository.

Implemented in version 0.6.0, with each open decision as recommended below.

## In short

- **A level for the products.** Home speaks for the whole café. The App (`#app`) becomes the level that lists the
  products, after what needs you across all of them: the Hydrex automations as one entry, and the swap. Today's App, the
  wallet's Hydrex accounts and who votes for them, moves one level down to `#hydrex`. A new `#swap` sits beside it.
- **Claiming is a fallback, not a product.** AutoMaxi's keeper claims for every member right after each epoch ends, so a
  Claim button shows only when an account's payout is overdue: on its page, in the AutoMaxi group, and in the App's
  Needs you.
- **Payouts and the swap meet.** Every AutoMaxi receipt offers to swap the payout into one token, and the claim's review
  offers the rewards "as they are" or "into one token". That gives the hands-off holder what they want, "paid weekly in
  one token", without a new contract.
- **The swap does what the contract leaves out on purpose:** finding the wallet's tokens, choosing each route, setting
  each minimum, and approving each token. The page does all four in the browser, within its rules: three RPCs, no
  server, no signatures.
- **Most tokens are worth less than their gas.** Last epoch, Carbon Impact's votes earned 28 different tokens: USDC was
  98% of the value, and the 27 others came to about $16 together. So the swap preselects only what is worth swapping,
  and says why it leaves the rest.
- **Batching becomes essential.** A swap of 11 tokens is 11 approvals and a swap. One prompt with EIP-5792 where the
  wallet allows it, one Safe transaction from a Safe, and otherwise 12 prompts, which the page must make bearable.

## What the contracts allow

### AutoMaxi's claim

`claim(tokenId, feeAddresses, bribeAddresses, tokens)` claims `tokens` for an account in AutoMaxi from the fee and bribe
contracts given. Of each token received, 1% goes to the 2-of-3 Safe `0x450c72de8c0079B49AcedF294a13011bd09D125B` and the
rest to the account's owner.

- **Anyone can call it, for any account in AutoMaxi,** and it always pays the owner. Whoever calls pays the gas. The fee
  is the same whoever calls.
- **AutoMaxi's keeper claims for every member right after each epoch ends.** Claiming earlier gains nothing: an epoch's
  rewards can be claimed only once it has ended. The page already reads when the last payout came, and calls an account
  late a full epoch after a missed payout, which is too late for the fallback: see [Where it shows](#where-it-shows).
- **It asks every contract for every token.** A bribe walks back up to 50 epochs for a token it has not paid recently,
  so a first claim, or one after a long gap, should pass only the contracts and tokens that owe something. The page
  already reads `earned(tokenId, token)` for last epoch's pools, so it knows which.
- **Owners can also claim on Hydrex directly, without the fee,** for rewards nobody has claimed through AutoMaxi yet.
  The page does not say so: the keeper claims right after each epoch, so there is almost never anything left to claim
  that way. Settled by the owner on 21 Oct 2026.
- **A claim that receives nothing does not revert.** If the keeper claims first, the tokens still reach the owner.

### The swapper

`ImmutableSwapper` is deployed once per output token: USDC, EURC, WETH, cbBTC, AERO and HYDX. Each
`swap(routes, deadline, skipFailed)` sells one or more tokens for the output, each along a route of one to three hops
that the **caller** picks, through pools of Hydrex, Aero, Aerodrome and Uniswap that the contract checks against each
exchange's factory. It sends 1% of each route's output to the same 2-of-3 Safe, and the rest to the caller.

Each one's code hash, read from Base on 21 Oct 2026, matches the one its sources record:

| Output | Swapper                                      | Code hash                                                            |
| ------ | -------------------------------------------- | -------------------------------------------------------------------- |
| USDC   | `0x31791f453d2100e728E012c9e189C0828adf4b6F` | `0x8d6d7ae768e36b4642c1b2d83afc4411053ef918cc78a6fa372f7b694386970b` |
| EURC   | `0x2cd8019d4F98e2fE2Ba705d8E7D38284c2a1450E` | `0xb51455b03682699694ae84a9ee17f1fa52cef8f57100d19a684226069f23be2e` |
| WETH   | `0xe5cbD828c2227E17f7FF8BD54C7A1e6012694Ff2` | `0xf58e0a14f707b542c5eae6af6929b28e4214e723543c617c29444541207261c8` |
| cbBTC  | `0x54805B6E6266c952627E47B8ADe4ae65c5DEA7d0` | `0xce9c5630b7243cbe9cbcbef1704c888e376d45f1889197ffc7d5ad6704c2ed69` |
| AERO   | `0xdd575A498C625AF96ac89efE578Dc68f4c9aB963` | `0xb0f28d588145fa5aef5f44eab97bf0e7f891e60499179b72540cbaa6f80b31d1` |
| HYDX   | `0xC629B1A13a0E1d4F0C38cD80d22E4AAC363cc8bC` | `0xfa9d0e728d29ee86a2762db1ff2d017b0779fcc73fff68e5a4a62301e1785c5d` |

What it leaves to the page, on purpose:

- **Which tokens.** It sells only what the caller names.
- **Which route.** It never picks one: the caller names the exchange and pool of each hop.
- **The minimum.** Each route's `minPaid`, after the fee. With `skipFailed`, a route below its minimum is skipped, its
  token stays in the wallet, and the rest go through.
- **Approvals.** Each token needs `approve(swapper, amount)` first. No permit, no Permit2, no signature of any kind,
  which suits the page: it never asks for signatures.
- **Gas.** About 220,000 gas a route on most pools. Through Hydrex's Algebra pools, whose plugin looks for an arbitrage
  after each swap, about 1 million a hop, and about 1.6 million for a whole transaction of one such route. Base allows
  16.7 million a transaction: about 64 tokens through Uniswap or Aerodrome, about 15 hops through Hydrex's Algebra
  pools.
- **The priority fee.** Above a tip of 1 gwei, Aero's classic pools add an MEV tax of up to 10% that a quote does not
  see.

`quote(routes)`, called with `eth_call`, returns what `swap` would, route by route, without moving anything and without
approvals. It prices each route against the pools as they are, so two routes through one pool are both priced as if
first. `eth_simulateV1` runs the approvals and the swap together, exactly.

Not swappable: native ETH in, or out. The output WETH is not ETH.

## What we learnt

### Rewards come in many tokens, most of them worth cents

From Base on 21 Oct 2026, with the page's own reader (`readEarnings` in `src/earnings.ts`):

- In the epoch from 8 to 15 Oct, Carbon Impact's 1.17M Earning Power voted for 27 pools, which earned rewards in **28
  tokens**: USDC ≈ $677, then wtMSTR ≈ $3.29, GOO ≈ $2.01, AVNT ≈ $1.57, and 18 more under $1.50 each. Six had no price
  in Hydrex's pools at all.
- So the 27 tokens beside USDC came to about $16. An account with about 1% of the votes, as #9540 has, would get about
  **$0.16 spread over 27 tokens**.
- AutoMaxi votes for bribes, so its members should expect the same spread: a few tokens worth something, and many worth
  cents. Its first payout comes after the flip of Thu 22 Oct.

### Gas sets the floor

At the gas price of 21 Oct 2026, 0.0096 gwei, and ETH at $2,461, from Chainlink:

| What                                | Gas       | Dollars |
| ----------------------------------- | --------- | ------- |
| An approval                         | ≈ 46,000  | ≈ 0.001 |
| A route on Uniswap or Aerodrome     | ≈ 220,000 | ≈ 0.005 |
| A hop through a Hydrex Algebra pool | ≈ 1M      | ≈ 0.02  |
| A whole transaction of one such hop | ≈ 1.6M    | ≈ 0.04  |
| 20 routes of three Uniswap v2 hops  | ≈ 3.4M    | ≈ 0.08  |
| A full transaction, 16.7M gas       | 16.7M     | ≈ 0.40  |

An approval and a route together cost about $0.006, so a token worth less than that costs more to sell than it fetches;
through Hydrex's Algebra pools the floor is about $0.02 a hop. Base's L1 data fee adds little: its gas price oracle gave
at most $0.00001 for an approval and $0.0007 for a swap of 9 KB, about 20 routes. The page's gas estimates already count
it. For the 1% member above, six of the 27 tokens are worth more than their gas, and none by more than three cents. The
default priority fee that `mainnet.base.org` suggested was 0.001 gwei, far below the 1 gwei where Aero's MEV tax starts;
a wallet set to "fast" can cross it.

### What the page can read

- **All three RPCs answer `eth_simulateV1`,** tested on 21 Oct 2026. The review can show exactly what the swap pays,
  approvals included, before the wallet asks.
- **No RPC lists a wallet's tokens,** and the free ones give logs 100 blocks at a time, too few to find them from
  transfers. ERC-7811's `wallet_getAssets` lets a wallet tell the page, but few wallets support it
  ([ERC-7811](https://eips.ethereum.org/EIPS/eip-7811);
  [Openfort](https://www.openfort.io/blog/wallet-asset-discovery)). So the page checks the balances of the tokens it
  knows, which costs one read for a few hundred tokens.
- **The page already reads Hydrex's reward contracts,** and with them their tokens and prices, and what waits to be
  claimed for each account in an automation, for its receipts.

### What comparable products do

- **Binance's "Convert small balances"** lists the balances under $20, asks for the target first (BNB, BTC, ETH or
  USDT), lets you tick them, and shows the fee in a preview before you confirm
  ([Binance.US](https://support.binance.us/en/articles/9842899-how-to-convert-small-balances-and-crypto-dust-to-bnb-btc-eth-or-usdt)).
  Target first, then ticks, then a preview: the swap follows that order.
- **Odos** swaps several inputs in one atomic transaction, and avoids one approval per token with Permit2 signatures
  ([Odos](https://docs.odos.xyz/api/permit2);
  [Zellic](https://reports.zellic.io/publications/odos/sections/odosrouterv2sol-swapmulti-c628480985355a5079427135989571c8)).
  The page will not ask for signatures: permit signatures caused 38% of large phishing losses in 2025 (see
  [README.md](README.md#trust-and-safety)). Batching the approvals instead keeps one prompt.
- **DustSweeper** has bots take the swap at prices signed by its server
  ([Alchemy](https://alchemy.com/dapps/dustsweeper)). The page has no server, and the swapper needs none.
- **A Token Sweeper sample** sweeps many balances on Base in one prompt with an EIP-7702 batch
  ([QuickNode](https://www.quicknode.com/sample-app-library/token-sweeper-eip-7702)): the same idea, by the wallet's
  batching.
- **Uniswap** sets slippage automatically between 0.5% and 5% by network cost and size, and lets you override it
  ([Uniswap](https://support.uniswap.org/hc/en-us/articles/8643879653261)). With `skipFailed`, a tight minimum costs the
  page little: a token that falls short stays in the wallet instead of failing the swap.
- **EIP-5792:** MetaMask, Coinbase Wallet and Rainbow batch with `wallet_sendCalls`; MetaMask may first ask to upgrade
  the account to a smart account
  ([MetaMask](https://docs.metamask.io/metamask-connect/evm/guides/send-transactions/batch-transactions/)). Rabby's
  support is unclear. Feature-detect with `wallet_getCapabilities`, and fall back to one prompt per call.

## Who it is for

Two new personas join [README.md's](README.md#personas), as hypotheses to test:

| Persona                       | Holds                                           | Wants                                    | Would pay                               | Needs to see                                     | Wrong if                                               |
| ----------------------------- | ----------------------------------------------- | ---------------------------------------- | --------------------------------------- | ------------------------------------------------ | ------------------------------------------------------ |
| **The reward collector**      | Accounts in AutoMaxi, paid in 20 or more tokens | One token, weekly, without a spreadsheet | 1% of the swap, on top of AutoMaxi's 1% | What it fetched, the fees, what stayed and why   | They keep the tokens, hoping some rise                 |
| **The wallet with leftovers** | Small balances on Base from trades and airdrops | A clean wallet, in one token             | 1%, if gas stays below a cent           | Which tokens are worth swapping, and the minimum | Their leftovers are worth less than gas: nothing to do |

The existing **hands-off holder**, "paid weekly in one token, or a lock that grows", is the one claim-and-swap serves
best.

New moments that matter, after [README.md's](README.md#the-moments-that-matter) nine:

10. **"I was paid in 28 tokens."** The receipt offers to swap them into one, and says which are worth it.
11. **"My payout is late."** The account says so, shows what waits, and offers to claim it now.
12. **"Was the swap fair?"** Each token's quote next to the page's own price, and what each fee took.
13. **"The swap failed: what about my approvals?"** What stayed in the wallet, why, and a way to reset what remains
    approved.

## The new structure

### Levels

| Level | View                 | Address                                           | Holds                                                                                        |
| ----- | -------------------- | ------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| 0     | Home                 | `/`                                               | What the café does, in a heading and a line; the one button; the line on stopped automations |
| 1     | The App              | `#app`                                            | The wallet; Needs you, across products; the products, each with what you hold in it          |
| 1     | About                | `#about`                                          | The café's facts, for every product                                                          |
| 2     | Hydrex               | `#hydrex`                                         | Today's App: the wallet's accounts in groups, then who votes for them                        |
| 2     | Swap                 | `#swap`, `#swap/weth`; a fold, `#swap/weth/check` | The swap, into USDC unless the address names another output                                  |
| 3     | An automation's page | `#hydrex/carbon-impact`, `#hydrex/automaxi`       | As today, with Claim in AutoMaxi's while a member's payout is overdue                        |
| 4     | An account's page    | `#hydrex/9540`                                    | As today, with Claim while its payout is overdue                                             |
| –     | The review           | A dialog                                          | Join, leave, claim, swap: each in two steps                                                  |

The swap has no third level: the six swappers are one product with one choice, the output, which is a field on its page,
not a page each. A swap's receipt shows in the review once done; a page per swap waits until the page reads history.

`src/routes.ts` changes: `#hydrex` stops being an alias of `#app`; `#swap` is new. A second part may name the output, in
lower case (`usdc`, `eurc`, `weth`, `cbbtc`, `aero`, `hydx`), and the last part a fold: `fees`, `control`, `check` or
`approvals`. So `#swap/weth/check` keeps the output when a fold opens, and `#swap/check` is USDC's. The page stores
nothing, but a link can carry the output.

### Navigation

- **The header** keeps one button. "Open the app", or the wallet chip once connected, leads to `#app`. Its hidden label
  becomes "Your wallet, connected as", since the App is no longer only your accounts.
- **Crumbs** gain a level: "App › Hydrex ›" on an automation's page and on an account's page; "App ›" on `#hydrex` and
  `#swap`.
- **Deep links** go straight to the level that answers: Home's stopped line to `#hydrex`, AutoMaxi's receipt to the
  swap, an overdue payout in the App to the account.

### Home

```
metaDEX Café                                      [Open the app]

Vote, claim and swap on Base, from your own wallet
Each call is shown before your wallet asks. Your accounts and
tokens stay in your wallet until you confirm, and this page
keeps nothing.

[Open the app]

▲ Many of Hydrex's automations, such as USDC, stopped voting on
  Wed 9 Sep. An account still in one earns nothing.
  Check your accounts →  (#hydrex)
```

- **The heading** says what happens, which anyone can check, as the brand asks. It names the three verbs, and Base,
  since the swap is for any wallet on Base, not only Hydrex's voters. [Heading]
- **The stopped line stays.** The stranded holder is still the largest audience, and it now leads to `#hydrex`.
- **Nothing else:** no list of products on Home. That is the App's job, one click on, and the header's button reaches it
  from every view.

### The App

```
Your wallet                                      0x0208…4C95

NEEDS YOU · 2
▲ #42877 is in Liquid Hydrex, which stopped on Wed 9 Sep.
  It earns nothing.                                 Change it →
▲ #9540's payout is overdue: ≈ $1.84 waits in 9 tokens.
                                                [Claim now]
○ 2 approvals left from a swap that failed.       [Reset]

THE MENU
Hydrex automations                                         →
  Automations that vote with your Hydrex accounts.
  Yours: 5 accounts, 2 in Carbon Impact, 1 in AutoMaxi
Swap many tokens into one                                  →
  Sell the tokens you pick for one, in one transaction.
  Takes 1% of what each fetches.
  Yours: 11 tokens worth swapping, ≈ $31
```

- **Without a wallet:** the wallet picker, then the menu, without the "Yours" lines.
- **Needs you gathers from every product,** each with one action: an account in a stopped automation, an overdue payout,
  approvals left over. It shows nothing when nothing needs you; a payout that is merely waiting for Thursday does not
  count, so that the group keeps its weight.
- **The menu** has one entry per kind of product, the Hydrex automations together and the swap, each with one line of
  what it does, what it takes, and once connected, what you hold in it. Claiming is not on it: it is an action on
  accounts in AutoMaxi.
- **Reads:** the App reads only what its lines need: the accounts and their groups, which it reads today, and the
  balances of known tokens with their quotes for the swap line. The swap line can come last, marked "…", as the earnings
  do today.

### Hydrex, `#hydrex`

Today's App, unchanged but for its heading, "Your Hydrex accounts", its crumb, and Claim in the AutoMaxi group:

| Group        | Its actions                                                           |
| ------------ | --------------------------------------------------------------------- |
| **AutoMaxi** | Leave, Move to Carbon Impact, and **Claim** while a payout is overdue |

"Who votes for your accounts", the menu of automations, stays at the bottom. Its AutoMaxi entry says "Pays you in the
tokens earned, right after each epoch. Swap them into one here." with a link to the swap.

## Claiming

### Where it shows

Only while an account's payout is overdue: a payout is due since the flip, it has not reached the account, something
waits, and more than half a day has passed since the flip, the time a payout takes. The page's "late" comes a full epoch
later, when the next flip finds the epoch still unpaid, so the fallback needs this earlier mark.

- **An account's page,** for the wallet's own account in AutoMaxi: a notice, "Its payout is overdue", with **Claim
  now**.
- **The AutoMaxi group** in `#hydrex`, and "Your accounts in it" on AutoMaxi's page: **Claim**, for the overdue
  accounts, with boxes to tick when there are more than one.
- **The App's Needs you,** with the same line.

Never in a normal week. Right after each epoch, something always waits until the keeper's payout arrives, up to half a
day later, and a button then would only spend the member's gas on what the keeper is about to do. Nor for others'
accounts: anyone may claim for anyone, and it pays the owner, but a button on a stranger's account invites confusion
about who gets paid. [Claim for others]

The button says what it costs before anyone presses it: "AutoMaxi's keeper usually claims right after each epoch, and
has not for this account yet. Claiming now costs the gas, ≈ $0.01, and AutoMaxi takes 1%, as from the keeper's claim."

### Its review

```
Claim for #9540                                    Step 1 of 2

WHAT WAITS                                   in last epoch's pools
  USDC             1.52        ≈ $1.52
  WETH             0.000065    ≈ $0.16
  AVNT             2.4         ≈ $0.04
  6 more tokens                ≈ $0.12   (show)
  ─────────────────────────────────────
  Earned                       ≈ $1.84
  AutoMaxi's 1%                ≈ −$0.02
  Reaches you                  ≈ $1.82

RECEIVE THEM
  (•) As they are, in 9 tokens
  ( ) Into [USDC ▾]: ≈ 1.69 USDC, at least 1.68. The USDC
      comes as it is; WETH and AVNT are swapped, less the swap's
      1% and the pools' fees. 6 tokens worth less than their gas
      stay as they are.

Gas ≈ $0.01, or ≈ $0.02 with the swap. There may be more in
other pools.

                                                       [Next]
```

- **Step 1, what waits,** as earned, then taken, then yours, as every money figure on the page. It reads `earned` in the
  pools the automation voted for in each epoch not yet paid: last epoch's, and the one before when the keeper missed it
  too, which today the page reads only for its records. It is still a floor: pools from further back are not read.
- **"Receive them" is the one dial** that [README.md](README.md#principles) asks for: the payout token, by the owner's
  choice, without a contract that swaps. "As they are" is the default, so that nothing is sold unasked.
- **Step 2, what your wallet will ask:** one `claim` per account, as slips, with only the contracts and tokens that owe
  something. AutoMaxi asks each contract for every token, so an account owed by many contracts in many tokens, as one
  the keeper missed for weeks, would need more gas than Base allows a transaction: its claim splits into calls that each
  fit one, the most valuable first. Calls that need more than one transaction's gas together go one at a time, even from
  a wallet that sends several in one prompt. A Safe sends many calls in one Safe transaction, so its claim splits into
  small calls instead, none asking a contract for a token it does not owe, which together use the least gas: #82774's
  take 55 calls and 41 million gas, where the 12 calls a wallet sends one by one take 79 million. It proposes them as
  several Safe transactions, as few as their simulated gas allows, one after the other from one click, for its owners to
  sign each. With "Swapped into", the approvals and the swap follow, as in the swap's review, or in a review of their
  own after split calls; a Safe whose claim takes several Safe transactions swaps later, on the swap page, as the swap
  follows the claim's receipts.
- **Done:** a receipt from the `Claimed` events: what was received, the 1%, what reached you. If the keeper claimed
  first, the receipt says the tokens came in its claim, not this one, which still cost its gas.

### Claim and swap in one prompt

The amounts are known before the claim: `earned` gives them, and AutoMaxi's 1% is rounded down. So the page can approve
each token for exactly what the claim will bring, and swap with the amount `type(uint256).max`, which the swapper reads
as "my balance, up to the allowance". It sells what the claim brought and no more, even when the wallet held some of the
token before. If the keeper's claim lands first, the tokens are in the wallet all the same, and the swap still sells
them.

- **With EIP-5792 and atomic batching:** claims, approvals and swap in one prompt, all or nothing.
- **From a Safe:** one Safe transaction, through MultiSend, as for joining today.
- **Otherwise:** the claim first, then the swap's own review, already filled in.

### On a payout's receipt

This is the usual path to one token, week after week. AutoMaxi's receipt on an account's page, and the review's receipt
after a claim, end with **Swap these into one token**, which opens `#swap` with the payout's tokens and amounts ticked.
The page holds them in memory for the visit; nothing is stored.

## Swapping, `#swap`

### The page

```
App ›
Swap many tokens into one

Pick the tokens to sell and the token you want. One transaction
sells them all, through pools on Hydrex, Aero and Uniswap that
the swapper checks. It takes 1% of what each token fetches.

Your tokens stay in your wallet until the swap. Each approval
lets the swapper take that token, for that amount, only from you.

YOU RECEIVE   (•) USDC  ( ) EURC  ( ) WETH  ( ) cbBTC
              ( ) AERO  ( ) HYDX

YOUR TOKENS                              11 of 19 ticked
 [x] WETH    0.0123     ≈ 30.10 USDC   Uniswap v3 · 0.05%
 [x] AVNT    41.2       ≈ 0.61 USDC    Hydrex → WETH → Uniswap
 ...
 [ ] GOO     12.0       ≈ 0.004 USDC   worth less than its gas
 [ ] wtBABA  0.31       no pool the swapper can use
 [ ] SPAM…   1,000,000  no price, no pool   (not the token you
                                            may know: see address)
 + Add a token by its address

 Sells 11 tokens for ≈ 31.20 USDC, at least 31.04 USDC
 Swap's 1%: ≈ 0.31 · Gas ≈ $0.07 · 12 calls: 11 approvals, 1 swap
 Minimum: 0.5% under each quote  (change)
                                                     [Review]

▸ Fee facts
▸ Who controls what
▸ Approvals you gave the swappers
▸ Check it
```

- **The output first,** as Binance does: the routes, the quotes and the minimums all depend on it. USDC by default.
  [Default output] The output itself is not on the list: the swapper never sells it, and it needs no swap.
- **The tokens:** every token the page knows that the wallet holds, by value. The page knows Hydrex's reward tokens, the
  six outputs, and a short list of Base's common tokens built into the page. [Token list] "Add a token by its address"
  covers the rest; ERC-7811 adds the wallet's own list where the wallet offers it.
- **Ticked by default** only when the page found a route and the quote clears its gas twice over. Every unticked row
  says why, in words: worth less than its gas, no pool the swapper can use, no price. "Ticked" is never a nudge: the
  owner can tick anything with a route.
- **Each row** shows what it fetches and the route, with each hop's exchange. A row whose quote is more than 2% below
  the page's own price for the token says so, with both figures: the swapper's README asks holders to check quotes
  through Hydrex's Algebra and Aero's Slipstream pools against another price, and the page has one.
- **Names are not trusted.** A token's symbol is whatever its contract says. Rows show the symbol in the mono face and
  the address beside it; a symbol that copies one of the six outputs, or a known token, at another address says so. No
  name becomes a link.
- **The summary** gives the money as on every page: fetched, the swap's 1%, gas, and the number of calls the wallet will
  see.
- **The minimum** is 0.5% under each quote by default, one setting for the whole swap. With `skipFailed`, a token that
  falls short stays in the wallet: the review says so. [Minimum]
- **More than one transaction:** when the routes need more than about 15 million gas, the page splits them, and says
  "This takes 2 swaps".

### Its review

Two steps, as every review:

1. **What you swap:** each token, its amount, its route, what it fetches and at least; the swap's 1%; the gas. A line on
   what a quote cannot see: the MEV tax on Aero's classic pools above a 1 gwei tip, and fees that Hydrex's and Aero's
   admins can change. Before this step shows, the page runs the approvals and the swap through `eth_simulateV1`, so the
   figures are the swap's own, not only the quotes'.
2. **What your wallet will ask:** each approval as a slip (`approve`, the swapper's address, the exact amount), then the
   swap: the swapper's address, each route in words ("41.2 AVNT, Hydrex Algebra pool `0x…` to WETH, Uniswap v3 0.05%
   pool `0x…` to USDC, at least 0.60 USDC"), the deadline, and skip-failed. From a Safe, the calldata word by word, as
   today.

- **Without batching,** the approvals come one prompt each, then the page quotes again before it asks for the swap.
  Approvals take minutes; a quote should not. A minimum never goes below what the review showed: if a fresh quote falls
  under it, the page shows the new figures and asks again, rather than lowering the minimum.
- **The priority fee:** the page asks for a tip of at most 1 gwei where the wallet lets the page set it, and says why.
  [Aero's classic pools]
- **Done:** a receipt from the `RouteSwapped`, `RouteFailed` and `Swapped` events: each token in, the output, the 1%,
  what reached you, the transaction. A token that was skipped says why, in words, and that it stays in the wallet with
  its approval: **Reset its approval**.

### Approvals

The approvals are exact, so a swap that goes through leaves nothing approved. A skipped route, a failed swap, or an
abandoned review between prompts can leave some. "Approvals you gave the swappers" lists them, with a **Reset** for
each, or all at once: the allowance of each token the page knows, for each of the six swappers. The swapper only ever
pulls from the caller, so a leftover approval cannot be used by anyone else, but
[README.md](README.md#what-comparable-products-charge) lists approvals that linger as a pattern to avoid.

### Routes

The contract never picks a route, so the page must, in the browser, from the three RPCs:

1. For each token, candidate paths: straight to the output, or through WETH, USDC or cbBTC, and HYDX for Hydrex's
   tokens.
2. For each hop, the pools that the twelve factories know: Uniswap v2's pairs, Uniswap v3's four fee tiers, Uniswap v4's
   standard pools without hooks, Aerodrome's and Aero's classic pools and Slipstream tick spacings, Hydrex's pairs and
   Algebra pools. A few hundred factory reads for 20 tokens, in Multicall batches.
3. Quote every candidate with `quote`, in batches, and keep each token's best, net of gas.
4. Simulate the chosen set with `eth_simulateV1`, which catches two routes sharing a pool.

The page shows progress token by token ("Finding routes: 7 of 19"), and keeps the pools it found for the visit. If
finding routes for many tokens strains the free RPCs' limits, the page finds them for the ticked tokens first.

### Its folds

- **Fee facts,** the same six rows as every product:

  | Row                    | The swap                                                                                |
  | ---------------------- | --------------------------------------------------------------------------------------- |
  | Taken                  | 1% of what each token fetches, in the output token                                      |
  | The most it can become | 1%, in its code                                                                         |
  | Goes to                | A 2-of-3 Safe, `0x450c72de8c0079B49AcedF294a13011bd09D125B`, the same as AutoMaxi's fee |
  | When                   | Each swap                                                                               |
  | Other costs            | The pools' own fees, the price moved by the swap, and gas                               |
  | Who can change it      | Nobody: a new fee means a new deployment                                                |

- **Who controls what:** nobody controls the swappers. Each exchange's admins can change their pools' fees, pause pools,
  or upgrade code that runs in the swap, which can worsen a price down to the minimum, but none can take the tokens. One
  line per exchange, from the swapper's own table.
- **Approvals you gave the swappers,** as above.
- **Check it:** the six swappers; the twelve factories, which the page checks against `exchanges()`; what the page
  checks (code, `outputToken`, `TREASURY`, `FEE_BPS`, the factories); how routes are found; how a quote can differ from
  the swap; swapping without this page, from Basescan; and for co-signers.

## Rules for every product

The page's rules stand, and extend:

- **Checks before use.** The page checks each swapper's code hash, output, treasury, fee and factories before it offers
  swaps into it, as it checks the automations before it offers joining. A failed check turns that output off, with a
  square and words. Resetting an approval always works.
- **Each call shown before the wallet asks,** approvals included.
- **Nothing sold unasked.** Claims pay "as they are" by default; the swap ticks only what is worth it, and never sells
  more than the review shows.
- **Money as earned, taken, yours,** with every fee named: AutoMaxi's 1%, the swap's 1%, the pools', gas.
- **Three RPCs and nothing else.** No price API, no token list from a server, no aggregator: the token list is part of
  the page, and routes are found from the factories.
- **No signatures.** Approvals are transactions.
- **Anonymous.** The swapper and AutoMaxi link to Basescan and Sourcify, never to a repository.

## Elsewhere on the page

- **About** speaks for every product. Its lead: "metaDEX Café is a page for looking after your Hydrex accounts and
  swapping tokens on Base, from your own wallet." "What it does not do" adds: "It never sells a token you did not tick,
  and shows each route before your wallet asks." "If this page goes away" adds: "Your tokens stay in your wallet.
  Approvals can be reset on each token's contract, and the swappers called from Basescan." "How the figures are read"
  adds swap quotes and the price check.
- **The review** gains claim and swap. Its machinery holds: steps one by one or one Safe transaction. It gains EIP-5792,
  which the roadmap already plans, and which the swap makes essential.
- **[README.md](README.md):** the views table, the personas and moments above, the fee-facts table's new row, and the
  roadmap: "one prompt with batching" moves first.
- **[brand.md](brand.md):** Home's heading rule follows the new heading. "Small balances", not "dust", in the page's
  words: plain, and no pun. Token symbols in the mono face, as untrusted text.
- **The repository's [README](../README.md):** what the page does, the new contracts and their checks.

## Further changes worth making now

The refactor touches every level, so these come cheaply with it:

- **One prompt for joining and leaving too.** EIP-5792 lands for the swap; joining or leaving several accounts uses it
  the same day. The roadmap already calls it the next step.
- **"What this wallet allows",** a fold on the App: every approval this wallet gave the café's contracts, which are the
  automations' conduit approvals and the swappers' allowances, each with the call that undoes it. It answers "what can
  these contracts do with my wallet?" in one place, and it is where leaving and resetting meet.
- **Carbon Impact's members** are paid in kVCM, one token, so the swap matters less to them. If kVCM has a pool the
  swapper can use, the swap lists it like any other token, and Carbon Impact's receipt can offer the same "Swap into one
  token".

## Implementing

- **`src/routes.ts`:** `#hydrex` and `#swap` as views; `#swap` sections.
- **`src/config.ts`:** the six swappers, with their code hashes from the swapper's `verification/bytecode-hashes.json`,
  and the twelve factories in `exchanges()` order.
- **New modules:** `src/tokens.ts` (the known tokens and their balances), `src/swap.ts` (candidate pools, quotes,
  simulation), `src/claim.ts` (the calls from what `earned` found). `src/wallet.ts` gains `wallet_getCapabilities` and
  `wallet_sendCalls`.
- **`src/hydrex.ts`'s checks** extend to the swappers.
- **Reuse:** `src/prices.ts` for the price check (Aero Basic Pools, Aerodrome Basic Pools, Hydrex Classic Pools, Hydrex
  Integral), `src/receipts.ts` for what waits, `src/review.ts` for the steps and the Safe transaction.
- **Tests:** unit tests for route candidates, minimums, and the claim's calls; fork tests at a block after the swappers'
  deployment on 21 Oct 2026: a claim, a claim and swap, a swap of several tokens with one skipped, a reset, and the
  checks failing for one output.

## How to know it works

From Base, with nothing collected: claims through AutoMaxi by callers other than its keeper; swaps through the six
swappers, with the tokens and outputs; leftover approvals to the swappers.

From people, five sessions per new persona, with four tasks: "Your payout is late: get it", "Turn last week's rewards
into USDC", "What did that cost you?", and "Make sure nothing is still approved". After each, ask what was sold, what
stayed, and why.

## Decisions

Settled by the owner on 21 Oct 2026: the page does not say that owners can claim AutoMaxi's rewards on Hydrex without
the fee, as the keeper claims right after each epoch. AutoMaxi's page no longer says it under "Joining and leaving". It
still says, under leaving, that what nobody has claimed through AutoMaxi is the owner's to claim on Hydrex: after
leaving, that is the only way.

Still open:

| Decision                         | Options                                                                      | Recommendation                                                                                                                                                                         |
| -------------------------------- | ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Heading**                      | "Vote, claim and swap on Base, from your own wallet"; or one per product     | The first: three verbs anyone can check                                                                                                                                                |
| **Claim for others**             | Own accounts only; any account, "pays its owner"                             | Own accounts only                                                                                                                                                                      |
| **Claim and swap, when overdue** | One review with "Receive them"; two separate flows                           | One review, "as they are" by default                                                                                                                                                   |
| **Default output**               | USDC; none until picked                                                      | USDC, unless the address names another, such as `#swap/weth`. The page stores nothing, so it cannot remember a choice                                                                  |
| **Minimum**                      | 0.5%; 1%; automatic, as Uniswap                                              | 0.5%, one setting. With skip-failed, a tight minimum leaves a token rather than failing the swap                                                                                       |
| **Token list**                   | Hydrex's reward tokens and the outputs only; plus a list built into the page | Both. The list lives in the repository, so the build stays reproducible, and is updated by hand, as `src/hydrex-conduits.json` is from Hydrex's API; a script to refresh it would help |
| **Aero's classic pools**         | Use them; prefer others within 1%; avoid them                                | Prefer others within 1%, and cap the tip at 1 gwei where the wallet allows                                                                                                             |
| **WETH or ETH**                  | WETH only; an "unwrap to ETH" call after the swap                            | WETH only at first. Unwrapping is one more call, worth adding once batching works                                                                                                      |
| **Swap from a Safe**             | The same deadline; a longer one for co-signers                               | A day, said in the brief: a route that falls below its minimum while co-signers sign is skipped                                                                                        |
| **AutoMaxi version 1**           | Claim for its members too; not at all                                        | Not at all: the page does not offer version 1                                                                                                                                          |
| **The swap's name**              | "Swap"; a name of its own, as AutoMaxi                                       | "Swap many tokens into one" on the menu, "Swap" in crumbs: plain words, and nothing to brand                                                                                           |
