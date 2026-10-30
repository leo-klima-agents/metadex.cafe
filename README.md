# metaDEX Café

metaDEX Café is a static web page at <https://metadex.cafe/>. It lets owners of Hydrex accounts on Base join or leave
Matcha Latte, Hydrex's automation, and Double Espresso, an automation nobody controls, and claim Double Espresso's
rewards when they are late. It also swaps many tokens on Base into one, through ImmutableSwapper. Hydrex's contracts
call automations "conduits".

The page has no server. It reads Base through public RPCs and asks the visitor's wallet to send transactions. It holds
no keys and stores nothing.

This README is for whoever runs the site. The design and the plan are in [design/](design/).

## What the page does

- **Joining** is one call per account: `setConduitApproval(conduit, tokenId, true)` on Hydrex's VotingEscrow. Carbon
  Impact can then claim the account's rewards at once, and votes with it from the next epoch, which starts on Thursday
  at 00:00 UTC. After each epoch, it swaps the rewards to kVCM, retires a share as carbon credits, and pays the rest to
  the owner. The account and its HYDX stay in the owner's wallet.
- **Double Espresso** takes the same call. It votes for the pools it expects to earn the most bribes, and anyone can
  claim an account's rewards through it: it pays them to the owner in the tokens earned, less 1%. Joining one of the two
  takes the votes and the claims from the other, in one call.
- **Leaving** is the same call with `false`. The page can also take accounts out of Hydrex's other automations, such as
  those that stopped voting in September 2026: same call, with that automation's address.
- **Before anyone can join, the page checks** that its RPCs serve Base; that Hydrex's VotingEscrow and its approval
  logic are still the ones in `src/config.ts`; and that joining each automation is on, and approves its claims and votes
  only. If a check fails, joining that automation is turned off, its page and its row say so, and Hydrex's page says
  why. Leaving always works. The checks run again every hour.
- **Claiming** is `claim(tokenId, feeAddresses, bribeAddresses, tokens)` on Double Espresso, which anyone can call for
  any account in it, and which pays the owner, less 1%. Claims usually come right after each epoch, so the page offers
  it only for the wallet's own accounts, once a payout is overdue: half a day after the flip with something waiting, or
  a full epoch late. It passes only the contracts and tokens that `earned()` finds owing, in last epoch's pools, and the
  epoch before's when nobody claimed for it either. Double Espresso asks each contract for every token passed, and each
  answer reads the account's past epochs, so a claim of many contracts and tokens splits into calls that each fit a
  transaction, the most valuable first; calls that need more gas together than one transaction may use go one at a time.
  A Safe, which sends many calls in one Safe transaction, gets small calls instead, none asking a contract for a token
  it does not owe, which together use the least gas; it proposes them in as few Safe transactions as their simulated gas
  allows, each under 15 million. The review offers the rewards as they are, or swapped into one token, but not from a
  Safe whose claim takes several Safe transactions: the swap follows the claim's receipts.
- **Swapping** goes through `ImmutableSwapper`, deployed once per output token: USDC, EURC, WETH, cbBTC, AERO and HYDX.
  Each `swap(routes, deadline, skipFailed)` sells the tokens named, each along a route of one to three hops the caller
  picks, through pools of Hydrex, Aero, Aerodrome and Uniswap that it checks against each exchange's factory, and sends
  1% of each route's output to the same 2-of-3 Safe as Double Espresso's fee. The page finds the wallet's tokens among
  those it knows (`src/base-tokens.json`, the six outputs, Hydrex's reward tokens, and any added by address), finds each
  route from the twelve factories and quotes it with the swapper's own `quote`. A quote prices a route as if it sold
  alone, so the ticked tokens are then routed together (`src/routing.ts`): those that move their pools may go in parts,
  up to three routes each, through other pools, by a model of each pool read at a few amounts. The page runs the
  approvals and the routes through `eth_simulateV1`, in order, with no minimum: each route fetches what the pools those
  before it moved pay, whichever of its own routes and those found together fetches more, net of gas. Each minimum is
  0.5% under what Base found, and a route that would not go through even so is left out of the swap. Each approval is
  exact, one a token for all its parts. A route that falls below its minimum by the time it runs is skipped, and its
  token stays in the wallet, with its approval, which the page offers to reset.
- **Batching:** where the wallet answers EIP-5792's `wallet_getCapabilities`, the page sends all the calls of a review
  in one prompt with `wallet_sendCalls`, all or nothing where it can. From a Safe, one Safe transaction. Otherwise one
  prompt per call; the swap is then run through Base again before the wallet asks for it, and never with a lower
  minimum.
- The header holds the logo and the name, which lead Home, and on every view a button that connects a wallet: at once
  when the browser has one, from a list when it has several. Once one is connected, the wallet's chip, which leads to
  the App, takes its place. The App, under its products, and the lists of a wallet's Hydrex accounts and tokens to sell
  list the wallets in the page too.
- Home is a heading and the button to the App (`#app`). A wallet connected on Home or About leads on to the App; the
  name in the header still leads Home afterwards. The App, "Your wallet", starts with what needs you across the
  products, each with one action: the Hydrex accounts with a vote or more whose owner did not vote last epoch, those in
  stopped automations, each one partly in an automation, an overdue payout, token approvals to the swappers that haven't
  been used. Then the products, each with what you hold in it: the swap (`#swap`); Hydrex (`#hydrex`), its automations
  and voting yourself; and Aero, greyed out, "Coming soon". Its Approvals button lists every approval this wallet gave
  the café's contracts, with the call that undoes it. The pages under it lead one level back, above their title: "‹ Your
  wallet" from Hydrex and the swap, "‹ Hydrex" from the pages below; Home and About do not.
- The page always says "Hydrex account", as "account" alone means an address in crypto: "8 Hydrex accounts", "Hydrex
  Main Protocol Account #26432".
- Details open from a round info button beside what they explain, as a popup: on a phone, a sheet from the foot of the
  screen. A popup has an address of its own, such as `#hydrex/matcha-latte/check`.
- `#hydrex` starts with the automations, in one box, a row each, with what each takes, what it pays in, what its votes
  earned last epoch per 1,000 votes and how that compares with Hydrex's average, both at the average's prices, and, with
  a wallet, how many of its Hydrex accounts are in it. Then, apart, as it is no automation, voting yourself: what votes
  earned on Hydrex last epoch per 1,000 votes, on average and, with a wallet, by the wallet's own votes, with how the
  two compare, and a link to vote on Hydrex. Then the wallet's Hydrex accounts, in groups a level below: first those
  with a vote or more that need their owner, in a group for each remedy, so that each group's buttons fit each of its
  accounts (Didn't vote last epoch, voted with by an owner who has not voted since before last epoch, as Hydrex counts a
  vote only in the epoch it is cast: join an automation, or vote on Hydrex; In a stopped automation, and Partly in an
  automation, one of the page's: join an automation, or leave); those in each automation; and the others. Leaving says,
  once done, that the votes are the owner's from the next epoch, to vote with on Hydrex each week. Each account shows
  what its votes earned last epoch, in an automation or through whoever voted with it. Those that need their owner start
  ticked; each group with boxes has one that ticks them all, and says how many are ticked and their votes.
- `#swap` takes the output from its address, `#swap/weth`, USDC by default, then lists the wallet's tokens, each with
  what it fetches, ticked when the quote is worth twice its gas. What the ticked ones fetch shows line by line: the
  quote, the 1%, what reaches you, the least that may, on the line where the slippage is picked, and the gas, paid apart
  in ETH. Until the ticked tokens are routed together and run through Base, each is its own quote, and the bar says so;
  then each ticked row shows what it fetches among the others. Its popups: its costs, what the slippage is, and the six
  swappers' contracts, such as `#swap/weth/check`; and the approvals given to the swappers. Its review shows the swap as
  a bill: each token, or each part of one, with its route by tokens and pools, under the gas, then the least, with the
  slippage that set it.
- Each automation has a page, `#hydrex/matcha-latte` and `#hydrex/double-espresso`: what it does in one sentence, that
  the account stays in the wallet, its key figures (what it takes, what it pays in, what its votes earned last epoch
  against Hydrex's average, as Hydrex's page shows it, and what it retired or who controls it), and a way to join, or
  the wallet buttons. Everything else is in two popups. Costs and contracts, beside its name, as the swap's: its costs,
  who can change it, and its contracts. And Performance, beside last epoch: how it did against all of Hydrex.
- Each account has a page, `#hydrex/` and its number, which anyone can open: its status, what its votes earned, what its
  owner can do with it, with the gas of a change when it earns nothing, and, in an automation, up to when it has been
  paid, what waits to be claimed, and the receipt of its last payout. The App marks the accounts paid late.
- Joining takes two steps: what it allows, with what a week at last epoch's rate would pay and the gas of the change,
  then the calls, each a bill in its own words, with its fields in full. About (`#about`) holds the page's own facts:
  its address, the cookies it stores, none, and its version. The footer leads to it, and stays at the foot of the
  screen. It also picks the currency the figures show in, for the visit: USD, EUR, GBP, CHF, AUD or CAD, the most traded
  that Chainlink prices on Base. The page stores the choice nowhere. [design/audit.md](design/audit.md) says why the
  page is laid out so.
- Inside Safe{Wallet}, it proposes all the calls as one Safe transaction.

Nobody controls the swappers either: their code fixes the fee, 1% of each route's output, the Safe it goes to, the
output and the twelve factories. As nothing about them can change, the page does not check them: it offers swaps once it
has read that its RPCs serve Base, and says nothing of it.

Hydrex controls Matcha Latte. It can change the share retired (up to 100%), the fee (up to 1%), the payout tokens, the
swap routers, any owner's payout address, and who claims and votes for it. The page always shows the settings as they
are on Base. Nobody controls Double Espresso: its fee, 1% of each claim, and the 2-of-3 Safe it goes to are immutable in
its code. A change means a new deployment, and owners joining again.

## Network access

The Content Security Policy in `index.html` lets the page reach three RPCs only. They are asked in this order:

1. `https://mainnet.base.org`
2. `https://base.drpc.org`, which serves old blocks for free
3. `https://base-rpc.publicnode.com`, which needs a paid token for old blocks

The page sends each RPC at most 25 requests a second, 5 of them for logs, and has at most 6 requests in flight. When an
RPC is busy or fails, the next one is asked. When none answers, the busy ones are asked again up to four times.

Every page reads the same, as soon as what each read needs is known: what the other pages show is read too, so that they
open with it. Only the order differs. Requests for what the page shown draws go first, and the others as slots free,
whichever page started them; changing page changes which go first. Home and About draw none.

The browser checks the script and the stylesheet against SHA-384 hashes in `index.html`. The fonts are inside the
stylesheet.

## Setup

Once, on GitHub and at the DNS provider:

- **GitHub Pages:** source "GitHub Actions", custom domain `metadex.cafe`, "Enforce HTTPS" on. At the DNS provider, add
  the A and AAAA records that GitHub lists for an apex domain.
- **The `github-pages` environment:** allow deployments from tags that match `v*`.
- **The `BASE_RPC_URL` secret,** if you like: an archive RPC for Base, for the browser tests to fork from. Without it,
  they fork from `https://mainnet.base.org`, which keeps a year of state but limits how many logs one address reads.
- **Safe{Wallet}:** under Apps, then My custom apps, add `https://metadex.cafe/`.

## Releasing

1. Set the new version, for example `npm version 0.5.0 --no-git-tag-version`, and commit.
2. Run `npm run build` and `python3 -m http.server --directory dist 8000`, then open <http://localhost:8000/#app> with a
   wallet. Check that joining is on. To try a flow without funds, as [QA.md](QA.md) lists them, run `npm run qa`.
3. Run the browser tests with `npm run test:fork`. CI runs them too.
4. Tag the commit with `v` and the version, for example `v0.5.0`, and push the tag. Any other tag fails.
5. Copy the CID from the Release.
6. In Pinata's web app, upload `dist/`, built from the tag, as a folder.
7. Check that the CID Pinata shows is the Release's.
8. Set `metadexcafe.eth`'s content hash to `ipfs://` and the CID, encoded per EIP-1577.
9. Open <https://metadexcafe.eth.limo/> and check that its About shows the new version.

The copy on ENS is not a Safe app: in Safe{Wallet}, the custom app stays `https://metadex.cafe/`.

For up to ten minutes after a release, a browser may still hold the old script or stylesheet in its cache. It refuses
them, because their hashes no longer match, so the page may not work for that visitor until the cache expires.

## When a contract changes

Each automation's page and its row on Hydrex's page say that joining it is off, and Hydrex's page says why, for the
check it names, by its id in `src/hydrex.ts`:

| Check                                              | Turns off                    | What changed                                                                                      |
| -------------------------------------------------- | ---------------------------- | ------------------------------------------------------------------------------------------------- |
| `chain`: the RPC serves Base                       | Joining both, and every swap | An RPC answered for another chain.                                                                |
| `upgrade`: the VotingEscrow                        | Joining both                 | The VotingEscrow's implementation: Hydrex upgraded it.                                            |
| `logic`: its approval logic                        | Joining both                 | `approvalLogic()` on the VotingEscrow.                                                            |
| `approvals`: what joining approves                 | Joining Matcha Latte         | `getConduitApprovalConfig` on the VotingEscrow, for Matcha Latte: off, or other than `[3, 5]`.    |
| `double-espresso-approvals`: what joining approves | Joining Double Espresso      | `getConduitApprovalConfig` on the VotingEscrow, for Double Espresso: off, or other than `[3, 5]`. |

The verified sources show that the last three cannot change unless the VotingEscrow is upgraded: what joining an
automation approves is set once, and no call sets it again; and the approval logic is set only as the VotingEscrow is
initialized. The page checks them all the same, should code it has not read, such as the VotingEscrow's lock logic,
change them. Each automation's VotingEscrow, Voter and Matcha Latte's kVCM are immutable, and code at an address cannot
change on Base, so an address is enough to know its code.

After a change, read the new code's verified source, and decide whether the page should trust it. If it should, update
`src/config.ts`, run the tests and release. These [Foundry](https://getfoundry.sh/) commands print what it holds:

```sh
RPC=https://mainnet.base.org
ESCROW=0x25B2ED7149fb8A05f6eF9407d9c8F878f59cd1e1
MATCHA_LATTE=0xdE91885cF35ac57DF0c4A75c16862127dBe8317c
DOUBLE_ESPRESSO=0x692c323B425A9DfeebE302F56168a7798D93EAC5

cast to-check-sum-address $(cast implementation $ESCROW --rpc-url $RPC)  # VOTING_ESCROW_IMPLEMENTATION
cast call $ESCROW "approvalLogic()(address)" --rpc-url $RPC                # APPROVAL_LOGIC
for AUTOMATION in $MATCHA_LATTE $DOUBLE_ESPRESSO; do                        # each automation's actions
  cast call $ESCROW "getConduitApprovalConfig(address)(uint8[],bool,string)" $AUTOMATION --rpc-url $RPC
done
```

When Hydrex adds or removes automations, update `src/hydrex-conduits.json` from <https://api.hydrex.fi/conduits>. If
Hydrex lists Double Espresso, the page still treats it as its own.

The swappers were deployed on 21 Oct 2026, from block 52,894,916. Their sources are verified, with an exact match, on
Basescan and Sourcify, which the page links to, and name no author and no repository.

The page's list of tokens, `src/base-tokens.json`, lives in the repository, so that the build stays reproducible, and is
kept by hand. `node scripts/tokens.ts` checks each token's symbol and decimals against Base; `--add 0x…` adds one, and
`--write` writes Base's answers back.

Double Espresso is version 2 of `ImmutableVeTokenConduit`, from <https://github.com/ldeso/hydrex-conduit> at tag `v2`,
commit `718c107`. It was deployed on 20 Oct 2026, in block 52,854,750, through the CREATE2 deployer. Version 1, at
`0x8B79159681aEbeC096D06F3d996fCd2f72e54f8B`, still works, and nobody had joined it when version 2 was deployed. The
page offers only version 2. Its source is verified, with an exact match, on Basescan and Sourcify; the page links to
Basescan's.

The page is anonymous for now: it names nobody, neither who runs it nor who runs Matcha Latte as its operator, and links
to no repository, neither this one nor Double Espresso's. A test checks it.

## Checking a deployment

The same commit always builds the same files. To check what the site serves, check out the tag of the version shown on
the page's About, such as `v0.5.1`, then run these. The query string skips any old copy the CDN still holds right after
a release.

```sh
npm ci --ignore-scripts
npm run build
cd dist && for file in $(find . -type f | sort); do curl -fsS "https://metadex.cafe/${file#./}?$(date +%s)" | cmp - "$file"; done
```

Then `npm run release` prints the notes of the tag's Release: the CID, and the content hash `metadexcafe.eth` should
hold.

## What visitors may run into

- **While the page reads Base,** each figure shows as a quiet bar where it will go, and each list as cards of bars; a
  status says "Checking…". Lines that most reads fill, such as how an automation compares with Hydrex's average, keep
  their place meanwhile, so that nothing moves once shown. A read that takes more than a few seconds says so. One that
  fails says "Not read", or hides its line, and never leaves a bar behind.
- **"Reading Base failed."** No RPC answered. The page offers to try again. When none can be reached at all, as offline,
  it says so within seconds: once each RPC went unanswered three times in a row, for two reads or more over two seconds
  or more, every read fails at once for ten seconds, then the next is asked as usual. What votes earned, the other
  automations and the payouts only add to the page: if one of them cannot be read, the rest of the page still works.
  What votes earned is tried again every five minutes. If one automation's payouts cannot be read, the others' still
  show, and the page reads them again every five minutes; if none can, an account's page has a button to read them
  again.
- **Joining is off.** A check failed: see [When a contract changes](#when-a-contract-changes).
- **The wallet is on another network.** The page offers to switch it to Base, or asks the visitor to pick Base in the
  wallet.
- **A refused or failed transaction.** The review says so, with links to the transactions that went through. Closing the
  review stops sending, but the page keeps following what was already sent.
- **A wallet that locks** is disconnected. Picking it again reconnects it.
- **At the end of an epoch,** Thursday at 00:00 UTC by Base's clock, the page reads the accounts and Matcha Latte again
  within half a minute.
- **A payout under way.** A payout takes up to half a day after each epoch. While it has paid some of the owner's
  accounts and not yet others, the App says so, and so does the page of each account it has not reached. On the page of
  an account the wallet does not hold, the page reads its owner's accounts once, while the account awaits its payout.
  Until a payout due since the flip has reached every account that has something waiting, the page checks every five
  minutes, with one read per account, and reads the payouts again once one has been paid; then not until the next epoch.
- **A late payout.** An account is late when it voted with an automation two epochs ago and has not been paid for that
  epoch yet. Its rewards wait in Hydrex's reward contracts until someone claims them, for up to 50 epochs.
- **An overdue payout in Double Espresso.** Half a day after the flip, an account whose payout has not come and that has
  something waiting is overdue: its page, the Double Espresso group and the App's Needs you offer to claim it. If
  someone else's claim lands first, the page's claim receives nothing, and its receipt says so; it still costs its gas.
- **A token the swap skipped.** Its route would have fetched less than its minimum, or its token refused the transfer.
  It stays in the wallet with its approval; the receipt, Needs you and the swap's Approvals offer to reset it. A route
  that Base finds would not go through even with no minimum is left out before the wallet asks, and the bill says why.
- **A quote far under the page's own price.** The row says so, with both figures, and so does the bill's line: the
  swapper's sources ask holders to check quotes through Hydrex's Algebra and Aero's Slipstream pools against another
  price. Tokens whose routes meet in a thin pool, as several into HYDX through USDC, fetch less together than each
  alone: the later ones show it.
- **Paid, or claimed in part.** An epoch counts as paid once claims since it ended took more than half of what its
  rewards were worth, at last epoch's prices. A claim of a few small rewards, such as anyone may make through Double
  Espresso, does not count, and tokens a payout leaves out, such as those that cannot be swapped, do not keep it from
  counting.
- **An account that moved.** Its standing is read in the pools of the automation it voted with last epoch, where its
  rewards are, and its receipts are those of the automation it is in now. If the one it voted with no longer holds its
  claims, the page says so: what waits can still be claimed on Hydrex.
- **Just after the flip,** until Hydrex moves on to the new epoch, what last epoch's votes earned is not final. The
  payouts say so, and are read again every five minutes until it is.

## Limits

- The page shows each account's last payout only. For Double Espresso, that is the claims in the epoch of the last one,
  up to ten blocks of them: anyone can claim dust for an account through a contract of their own, as often as they like.
- What waits to be claimed is a floor: the page reads each account's rewards in the pools its automation voted for last
  epoch, and no others. If some of those reads fail, it says "at least".
- Whether an account was paid for the epoch before last needs that epoch's rewards. Hydrex's Voter no longer holds those
  votes, so the page finds them among every pool's reward contracts, which it reads once a session for all that need
  them, and only if one of the owner's accounts voted with the automation then. They are weighed at last epoch's prices.
- The page finds an account's last payout through Hydrex's reward contracts, which record up to when they have paid it,
  through the record of the reward worth the most that the payout claimed. Anyone allowed to claim for the account moves
  that record, such as its owner on Hydrex. The page then says that the account was last claimed outside Matcha Latte,
  and shows no receipt.
- What votes earned is for the last epoch only. A voter's pools are those Hydrex's Voter holds for it, until it votes
  again, as the automations do just before each flip. Then, and for Hydrex's average, they are found among every pool's
  reward contracts: thousands of reads, made once a session and shared. The average is read on every page once Hydrex's
  last epoch is read: first on `#hydrex` and the automations' pages, and elsewhere as slots free, so that `#hydrex`
  opens with it read, or under way. So is what the votes of a wallet's accounts in no automation earned, through whoever
  held them.
- Prices are approximate. USDC, WETH, cbBTC and EURC take Chainlink's; other tokens, and one of those four whose feed
  does not answer, a half-hour average in their deepest pool against one of those priced. Prices now, for swaps, gas and
  what waits to be claimed, come from Aero Basic Pools, Aerodrome Basic Pools, Hydrex Classic Pools and Hydrex Integral,
  the first of two as deep; prices at an epoch's end, for what it earned and paid, from Hydrex's pools only, and only
  from what they and Chainlink recorded then: a feed without a round of that time gives no price, and a pool without its
  history gives way to the next deepest. A token none of whose pools has one has no price at that time; its price now
  only weighs its rewards against the others, to tell a payout from a claim of a few small ones, and is never shown. If
  none of Chainlink's feeds answers, the figures are in USDC instead of dollars, from the pools alone. In another
  currency, a figure in dollars is converted at Chainlink's rate on Base of its own time, such as GBP / USD, at the flip
  or now; without a round of that time, it stays in dollars. Gas without ETH's price shows in ETH. A token without a
  deep enough pool has no price.
- Only Hydrex, or a call from the owner's own address made elsewhere, can change a payout address.
- The swap knows only the tokens on its list, Hydrex's reward tokens, those added by address, and those a wallet lists
  with ERC-7811's `wallet_getAssets`: no RPC lists a wallet's tokens. Routes pass through WETH, USDC, cbBTC and HYDX
  only. A token's own route takes, at each hop, the best pool for what the hop before paid, which is not always the best
  route as a whole; routed together, the tokens that move their pools try every path through the best pools of each hop,
  in tenths. Aero's classic pools win a hop only by more than 1%, and pay 1% less in the model: above a tip of 1 gwei,
  they add a tax that a quote does not see.
- How much the page reads to route tokens together depends on what the RPCs allow: as many requests as they allow in a
  second, by what the page has learnt of their limits. Each RPC is asked up to 25 times a second at first, half as often
  once it says it is over its limit, and a little more again with each answer. With less, the router reads fewer pools
  and fewer amounts of each, or leaves each token its own route; Base's run in order still sets the minimums.
- Swaps never take or give native ETH: WETH is not ETH.

## Development

Needs Node 26 LTS, 26.13 or later.

```sh
npm ci --ignore-scripts
npm run typecheck
npm test
npm run format  # before committing
npm run build   # writes the page to dist/
```

`npm run test:fork` builds the page, then runs it in Chromium against forks of Base in anvil, with real accounts:
joining, leaving, a Safe, the views, the accounts' pages, and what can fail; then, after the swappers' deployment, a
swap with a token skipped and its approval reset, a swapper whose checks fail, and a claim, as it is, swapped, and from
a Safe. Its five files run at once, each with an anvil of its own; `node fork/run.ts fork/claim.ts` runs one, and passes
options such as `--test-name-pattern=…` on to `node --test`. It needs [anvil](https://getfoundry.sh/) and Chromium
(`npx playwright-core install chromium`, or set `CHROMIUM` to a Chromium or Chrome binary). `BASE_RPC_URL` is the
archive RPC to fork from, the page's first RPC by default, and `SCREENSHOTS` an optional folder for screenshots. anvil
forks through `fork/rpc-cache.ts`, which asks `BASE_RPC_URL` once for each answer about the forks' blocks and keeps it,
in `FORK_CACHE`, `~/.cache/metadex.cafe/fork` by default; `FORK_LOG=1` prints each request it still sends. Before anvil
runs a call, the cache asks `BASE_RPC_URL` which slots it reads, and for all of them. Every request of a run goes
through one queue, at most 8 at a time, anvil's first; one refused as over the RPC's limit is asked again after an
exponential backoff, for up to 5 minutes. The first run, which asks for everything, takes about 25 minutes through an
RPC of your own; the next ones take about two minutes.

`npm run qa` opens the page by hand against the same forks, in a browser of its own, beside a wallet that signs as any
address and steers the fork: the states the browser tests start from, Base's clock, and what can fail. The page's flows
can be tried there without a wallet or funds of your own: [QA.md](QA.md) says which scenario each needs, and which few
states the fork cannot show.

CI runs Prettier, the type check, the unit tests, `reuse lint` and the build, packs the build as a CAR file and a zip,
and checks that the zip unpacks to it. It then builds and packs again from a fresh clone and checks that both give the
same files, CAR file, zip, CID and content hash. It also runs the browser tests, in the runner's Chrome, with the forks'
answers kept in GitHub's cache from one run, or attempt, to the next, one run of a branch at a time. Dependabot updates
the pinned Actions and npm packages every week, in one pull request for each, with releases a week old or more; a
security update comes at once, on its own.

| Path                                                    | What it holds                                                                                                                                                                                                    |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `index.html`                                            | The page. Its views are Home, the App (`#app`), the Hydrex accounts (`#hydrex`), a page per automation (`#hydrex/double-espresso`), an account's page (`#hydrex/9540`), the swap (`#swap`) and About (`#about`). |
| `style.css`, `fonts/`                                   | Styles and fonts.                                                                                                                                                                                                |
| `src/config.ts`                                         | What the page trusts: contract addresses, the RPCs, and the price anchors.                                                                                                                                       |
| `src/hydrex-conduits.json`                              | Hydrex's automations, as <https://api.hydrex.fi/conduits> lists them.                                                                                                                                            |
| `src/main.ts`                                           | Startup: each view set up, then the reads, and again every half a minute what is due; and which reads go first on each page.                                                                                     |
| `src/views/page.ts`                                     | What the views share: the wallet connected, its Hydrex accounts, and how each view is drawn again.                                                                                                               |
| `src/views/automations.ts`                              | The automations' state and figures, on Hydrex's menu and their pages, beside Hydrex's average; and the checks.                                                                                                   |
| `src/views/accounts.ts`                                 | The wallet's Hydrex accounts in groups, their boxes and buttons, and the reviews of joining, leaving and claiming.                                                                                               |
| `src/views/position.ts`                                 | An account's page.                                                                                                                                                                                               |
| `src/views/app.ts`                                      | The App: what needs you, the products, and what the wallet allows.                                                                                                                                               |
| `src/views/connection.ts`                               | Connecting a wallet, its events, and reading its Hydrex accounts.                                                                                                                                                |
| `src/views/payouts.ts`                                  | The wallet's payouts, as the views show them: late, overdue, or under way.                                                                                                                                       |
| `src/pools.ts`                                          | Each exchange's pools of two tokens, for routes and prices.                                                                                                                                                      |
| `src/swap.ts`, `src/swap-calls.ts`, `src/views/swap.ts` | The swap: routes, quotes, minimums and simulation; its calls; and its page.                                                                                                                                      |
| `src/routing.ts`                                        | Routes for the ticked tokens together, in parts, from a model of each pool, within what the RPCs allow.                                                                                                          |
| `src/tokens.ts`, `src/base-tokens.json`                 | The tokens the page knows, and their balances and approvals.                                                                                                                                                     |
| `src/claim.ts`, `src/views/claim.ts`                    | Claiming through Double Espresso: the calls from what `earned` found, and the review.                                                                                                                            |
| `src/views/review.ts`                                   | The review that shows each call before the wallet asks.                                                                                                                                                          |
| `src/last-epoch.ts`, `src/earnings.ts`, `src/prices.ts` | What votes earned last epoch, and token prices.                                                                                                                                                                  |
| `src/last-payout.ts`, `src/receipts.ts`                 | Payouts: up to when each account was paid, what waits, and its last receipt.                                                                                                                                     |
| `src/claims.ts`                                         | Double Espresso's claims, read back from the last one.                                                                                                                                                           |
| `src/hydrex.ts`                                         | Hydrex's contracts: reads, account statuses, the calls, and the checks.                                                                                                                                          |
| `src/chain.ts`, `src/wallet.ts`                         | RPC requests, and wallets.                                                                                                                                                                                       |
| `src/routes.ts`, `src/views/router.ts`                  | The page's addresses, and the view each shows.                                                                                                                                                                   |
| `src/dom.ts`, `src/format.ts`, `src/read.ts`            | Page helpers; number and date formats; and what the page reads, kept with its state, retried when due.                                                                                                           |
| `test/`, `fork/`                                        | Unit tests; the browser tests, which `fork/run.ts` runs at once, the harness they share in `fork/harness.ts`, and `fork/rpc-cache.ts`, which keeps the answers their forks read from Base.                       |
| `fork/qa.ts`, `fork/qa.html`, `fork/scenarios.ts`       | `npm run qa`: the page against a fork, the QA wallet's window beside it, and the states it can start the fork in.                                                                                                |
| `fork/fixtures/`                                        | Double Espresso's init code, for the browser tests to deploy it on the fork; and a token of the QA wallet's own, its source and init code.                                                                       |
| `test/fixtures/`                                        | A folder for `test/release.test.ts` to pack, with the CID that Kubo gives it.                                                                                                                                    |
| `scripts/`                                              | The build, and `notices.ts`, the license notices it appends to each built file; `fonts.py` makes `fonts/`, `icons.ts` draws the icons from `icon.svg`, and `tokens.ts` checks the list of tokens.                |
| `scripts/release.ts`                                    | `npm run release`: `dist/` as a CAR file, for IPFS and ENS, and as a zip, in `release/`, with the Release's notes: the CID and content hash.                                                                     |

## License

MIT, and REUSE compliant. The fonts in `fonts/` are under the SIL Open Font License 1.1. Klima Protocol's logo,
`klima-protocol.svg`, belongs to Klima Protocol, all rights reserved, and is used with its permission.
