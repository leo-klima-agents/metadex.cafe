# metaDEX Café

metaDEX Café is a static web page at <https://metadex.cafe/>. It lets owners of Hydrex accounts on Base join or leave
Carbon Impact, Hydrex's automation, and AutoMaxi, an automation nobody controls, and claim AutoMaxi's rewards when its
keeper is late. It also swaps many tokens on Base into one, through ImmutableSwapper. Hydrex's contracts call
automations "conduits".

The page has no server. It reads Base through public RPCs and asks the visitor's wallet to send transactions. It holds
no keys and stores nothing.

This README is for whoever runs the site. The design and the plan are in [design/](design/).

## What the page does

- **Joining** is one call per account: `setConduitApproval(conduit, tokenId, true)` on Hydrex's VotingEscrow. Carbon
  Impact can then claim the account's rewards at once, and votes with it from the next epoch, which starts on Thursday
  at 00:00 UTC. After each epoch, it swaps the rewards to kVCM, retires a share as carbon credits, and pays the rest to
  the owner. The account and its HYDX stay in the owner's wallet.
- **AutoMaxi** takes the same call. It votes for the pools it expects to earn the most bribes, and anyone can claim an
  account's rewards through it: it pays them to the owner in the tokens earned, less 1%. Joining one of the two takes
  the votes and the claims from the other, in one call.
- **Leaving** is the same call with `false`. The page can also take accounts out of Hydrex's other automations, such as
  those that stopped voting in September 2026: same call, with that automation's address.
- **Before anyone can join, the page checks** the chain, each automation's code, Carbon Impact's settings, and the code
  of Hydrex's VotingEscrow against `src/config.ts`. If a check fails, joining that automation is turned off, and the
  page marks the check on that automation's page, under Check it. Leaving always works. The checks run again every hour.
  Until there is code at AutoMaxi's address, the page leaves AutoMaxi out. The swappers' checks are in `src/swap.ts`.
- **Claiming** is `claim(tokenId, feeAddresses, bribeAddresses, tokens)` on AutoMaxi, which anyone can call for any
  account in it, and which pays the owner, less 1%. AutoMaxi's keeper claims for every member right after each epoch, so
  the page offers it only for the wallet's own accounts, once a payout is overdue: half a day after the flip with
  something waiting, or a full epoch late. It passes only the contracts and tokens that `earned()` finds owing, in last
  epoch's pools, and the epoch before's when the keeper missed it too. AutoMaxi asks each contract for every token
  passed, and each answer reads the account's past epochs, so a claim of many contracts and tokens splits into calls
  that each fit a transaction, the most valuable first; calls that need more gas together than one transaction may use
  go one at a time. A Safe, which sends many calls in one Safe transaction, gets small calls instead, none asking a
  contract for a token it does not owe, which together use the least gas; it proposes them in as few Safe transactions
  as their simulated gas allows, each under 15 million. The review offers the rewards as they are, or swapped into one
  token, but not from a Safe whose claim takes several Safe transactions: the swap follows the claim's receipts.
- **Swapping** goes through `ImmutableSwapper`, deployed once per output token: USDC, EURC, WETH, cbBTC, AERO and HYDX.
  Each `swap(routes, deadline, skipFailed)` sells the tokens named, each along a route of one to three hops the caller
  picks, through pools of Hydrex, Aero, Aerodrome and Uniswap that it checks against each exchange's factory, and sends
  1% of each route's output to the same 2-of-3 Safe as AutoMaxi's fee. The page finds the wallet's tokens among those it
  knows (`src/base-tokens.json`, the six outputs, Hydrex's reward tokens, and any added by address), finds each route
  from the twelve factories, quotes it with the swapper's own `quote`, sets each minimum 0.5% under its quote, and runs
  the approvals and the swap through `eth_simulateV1` before the wallet asks. Each approval is exact. A route below its
  minimum is skipped, and its token stays in the wallet, with its approval, which the page offers to reset.
- **Batching:** where the wallet answers EIP-5792's `wallet_getCapabilities`, the page sends all the calls of a review
  in one prompt with `wallet_sendCalls`, all or nothing where it can. From a Safe, one Safe transaction. Otherwise one
  prompt per call; the swap is then quoted again before the wallet asks for it, and never with a lower minimum.
- Home is a heading and the button to the App (`#app`); once a wallet is connected, Home is the App. The App starts with
  what needs you across the products, each with one action: an account in a stopped automation, an overdue payout,
  approvals left to the swappers. Then the products, each with what you hold in it: the Hydrex automations (`#hydrex`)
  and the swap (`#swap`). Its Approvals button lists every approval this wallet gave the café's contracts, with the call
  that undoes it.
- Details open from a round info button beside what they explain, as a popup: on a phone, a sheet from the foot of the
  screen. A popup has an address of its own, such as `#hydrex/carbon-impact/check`.
- `#hydrex` starts with the wallet's accounts, in groups: those that need their owner, those in each automation, and the
  others. Then the menu: each automation, and voting yourself, with what each takes and what it paid last epoch.
- `#swap` takes the output from its address, `#swap/weth`, USDC by default, then lists the wallet's tokens, each with
  its route and what it fetches, ticked when the quote is worth twice its gas. Its popups: its costs, who controls what
  and its smart contracts, such as `#swap/weth/check`; and the approvals given to the swappers.
- Each automation has a page, `#hydrex/carbon-impact` and `#hydrex/automaxi`: its key figures (what it takes, what it
  pays in, what it paid last epoch, and what it retired or who controls it), and a way to join. Everything else is in
  popups: its six fee facts, how it did against all of Hydrex, joining and leaving, who controls what, and Check it.
- Each account has a page, `#hydrex/` and its number, which anyone can open: its status, what its votes earned, what its
  owner can do with it, and, in an automation, up to when it has been paid, what waits to be claimed, and the receipt of
  its last payout. The App marks the accounts paid late.
- Joining takes two steps: what it allows, with what a week at last epoch's rate would pay and the gas of the change,
  then the calls, each in its own words, with its fields behind an info button. About (`#about`) holds the page's own
  facts, and how its figures are read, in a popup. [design/audit.md](design/audit.md) says why the page is laid out so.
- Inside Safe{Wallet}, it proposes all the calls as one Safe transaction.

Nobody controls the swappers either: their code fixes the fee, 1% of each route's output, the Safe it goes to, the
output and the twelve factories, and the page checks all of them, and each swapper's code hash, before it offers swaps
into its output.

One admin key controls Carbon Impact. It can change the share retired (up to 100%), the fee (up to 1%), the payout
tokens, the swap routers, any owner's payout address, and who claims and votes for it. The page always shows the
settings as they are on Base. Nobody controls AutoMaxi: its code fixes its fee, 1% of each claim, and the 2-of-3 Safe it
goes to. A change means a new deployment, and owners joining again.

## Network access

The Content Security Policy in `index.html` lets the page reach three RPCs only. They are asked in this order:

1. `https://mainnet.base.org`
2. `https://base.drpc.org`, which serves old blocks for free
3. `https://base-rpc.publicnode.com`, which needs a paid token for old blocks

The page sends each RPC at most 25 requests a second, 5 of them for logs, and has at most 6 requests in flight. When an
RPC is busy or fails, the next one is asked. When none answers, the busy ones are asked again up to four times.

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
   wallet. Check that joining is on.
3. Run the browser tests with `npm run test:fork`. CI runs them too.
4. Tag the commit with `v` and the version, for example `v0.5.0`, and push the tag. Any other tag fails.

CI then runs every check, publishes `dist/` on GitHub Pages, and downloads each file back from Pages to compare it.

For up to ten minutes after a release, a browser may still hold the old script or stylesheet in its cache. It refuses
them, because their hashes no longer match, so the page may not work for that visitor until the cache expires.

## When a contract changes

The App and the automation's page say that joining it is off, and its Check it marks each check that failed, by its id
in `src/hydrex.ts`:

| Check                                         | Marked on       | What changed                                                                              |
| --------------------------------------------- | --------------- | ----------------------------------------------------------------------------------------- |
| `chain`: the RPC serves Base                  | Both pages      | An RPC answered for another chain.                                                        |
| `code`: Carbon Impact's code                  | Carbon Impact's | Carbon Impact's code.                                                                     |
| `contracts`: its VotingEscrow and Voter       | Carbon Impact's | `veToken()` or `voter()` on Carbon Impact.                                                |
| `token`: it pays in kVCM                      | Carbon Impact's | `kvcm()` on Carbon Impact.                                                                |
| `approvals`: what joining approves            | Carbon Impact's | `getConduitApprovalConfig` on the VotingEscrow: no longer active, or other than `[3, 5]`. |
| `automaxi-code`: AutoMaxi's code              | AutoMaxi's      | AutoMaxi's code.                                                                          |
| `automaxi-contracts`: its VotingEscrow, Voter | AutoMaxi's      | `veToken()` or `voter()` on AutoMaxi.                                                     |
| `automaxi-approvals`: what joining approves   | AutoMaxi's      | `getConduitApprovalConfig` on the VotingEscrow, for AutoMaxi.                             |
| `upgrade`: the VotingEscrow                   | Both pages      | The VotingEscrow's implementation, or its code.                                           |
| `logic`: its approval logic                   | Both pages      | `approvalLogic()` on the VotingEscrow, or its code.                                       |
| `swap-code`: a swapper's code                 | The swap's      | The code at that output's swapper. Swaps into that output turn off.                       |
| `swap-output`: its output token               | The swap's      | `outputToken()` on that swapper.                                                          |
| `swap-treasury`: where its fee goes           | The swap's      | `TREASURY()` on that swapper.                                                             |
| `swap-fee`: its fee                           | The swap's      | `FEE_BPS()` on that swapper.                                                              |
| `swap-exchanges`: its twelve factories        | The swap's      | `exchanges()` on that swapper, against `EXCHANGES` in `src/config.ts`.                    |

Read what changed, and decide whether the page should trust it. If it should, update `src/config.ts`, run the tests and
release. These [Foundry](https://getfoundry.sh/) commands print the values that `src/config.ts` holds:

```sh
RPC=https://mainnet.base.org
CARBON_IMPACT=0xdE91885cF35ac57DF0c4A75c16862127dBe8317c
AUTOMAXI=0x692c323B425A9DfeebE302F56168a7798D93EAC5
ESCROW=0x25B2ED7149fb8A05f6eF9407d9c8F878f59cd1e1
IMPLEMENTATION=$(cast to-check-sum-address $(cast implementation $ESCROW --rpc-url $RPC))
LOGIC=$(cast call $ESCROW "approvalLogic()(address)" --rpc-url $RPC)

cast keccak $(cast code $CARBON_IMPACT --rpc-url $RPC)   # CARBON_IMPACT's codeHash
cast keccak $(cast code $AUTOMAXI --rpc-url $RPC)        # AUTOMAXI's codeHash
echo $IMPLEMENTATION                                    # VOTING_ESCROW_IMPLEMENTATION
cast keccak $(cast code $IMPLEMENTATION --rpc-url $RPC)  # VOTING_ESCROW_IMPLEMENTATION_CODE_HASH
echo $LOGIC                                             # APPROVAL_LOGIC
cast keccak $(cast code $LOGIC --rpc-url $RPC)           # APPROVAL_LOGIC_CODE_HASH
for AUTOMATION in $CARBON_IMPACT $AUTOMAXI; do           # each automation's actions
  cast call $ESCROW "getConduitApprovalConfig(address)(uint8[],bool,string)" $AUTOMATION --rpc-url $RPC
done
```

When Hydrex adds or removes automations, update `src/hydrex-conduits.json` from <https://api.hydrex.fi/conduits>. If
Hydrex lists AutoMaxi, the page still treats it as its own.

The swappers were deployed on 21 Oct 2026, from block 52,894,916. Each one's code hash, in `src/config.ts`, is the one
its sources record, and `cast keccak $(cast code $SWAPPER --rpc-url $RPC)` prints it. Their sources are verified, with
an exact match, on Basescan and Sourcify, which the page links to, and name no author and no repository.

The page's list of tokens, `src/base-tokens.json`, lives in the repository, so that the build stays reproducible, and is
kept by hand. `node scripts/tokens.ts` checks each token's symbol and decimals against Base; `--add 0x…` adds one, and
`--write` writes Base's answers back.

AutoMaxi is version 2 of `ImmutableVeTokenConduit`, from <https://github.com/ldeso/hydrex-conduit> at tag `v2`, commit
`718c107`. It was deployed on 20 Oct 2026, in block 52,854,750, through the CREATE2 deployer. The command above prints
the code hash in that commit's `verification/bytecode-hashes.json`,
`0x4872932431e0d175fb1213e9ffec2b8f0ebd1d9d490643d6df5b2c6d0b379847`. Version 1, at
`0x8B79159681aEbeC096D06F3d996fCd2f72e54f8B`, still works, and nobody had joined it when version 2 was deployed. The
page offers only version 2. Its source is verified, with an exact match, on Basescan and Sourcify, which the page links
to.

The page is anonymous for now: it names no operator, and links to no repository but Hydrex's, neither this one nor
AutoMaxi's. A test checks it.

## Checking a deployment

The same commit always builds the same files. To check what the site serves, check out the tag of the version shown in
the page's footer, such as `v0.5.1`, then run these. The query string skips any old copy the CDN still holds right after
a release.

```sh
npm ci --ignore-scripts
npm run build
cd dist && for file in $(find . -type f | sort); do curl -fsS "https://metadex.cafe/${file#./}?$(date +%s)" | cmp - "$file"; done
```

## What visitors may run into

- **"Reading Base failed."** No RPC answered. The page offers to try again. What votes earned, the other automations and
  the payouts only add to the page: if one of them cannot be read, the rest of the page still works. What votes earned
  is tried again every five minutes. If one automation's payouts cannot be read, the others' still show, and the page
  reads them again every five minutes; if none can, an account's page has a button to read them again.
- **Joining is off.** A check failed: see [When a contract changes](#when-a-contract-changes).
- **The wallet is on another network.** The page offers to switch it to Base, or asks the visitor to pick Base in the
  wallet.
- **A refused or failed transaction.** The review says so, with links to the transactions that went through. Closing the
  review stops sending, but the page keeps following what was already sent.
- **A wallet that locks** is disconnected. Picking it again reconnects it.
- **At the end of an epoch,** Thursday at 00:00 UTC by Base's clock, the page reads the accounts and Carbon Impact again
  within half a minute.
- **A payout under way.** A payout takes up to half a day after each epoch. While it has paid some of the owner's
  accounts and not yet others, the App says so, and so does the page of each account it has not reached. On the page of
  an account the wallet does not hold, the page reads its owner's accounts once, while the account awaits its payout.
  Until a payout due since the flip has reached every account that has something waiting, the page checks every five
  minutes, with one read per account, and reads the payouts again once one has been paid; then not until the next epoch.
- **A late payout.** An account is late when it voted with an automation two epochs ago and has not been paid for that
  epoch yet. Its rewards wait in Hydrex's reward contracts until someone claims them, for up to 50 epochs.
- **An overdue payout in AutoMaxi.** Half a day after the flip, an account whose payout has not come and that has
  something waiting is overdue: its page, the AutoMaxi group and the App's Needs you offer to claim it. If the keeper's
  claim lands first, the page's claim receives nothing, and its receipt says so; it still costs its gas.
- **A token the swap skipped.** Its route would have fetched less than its minimum, or its token refused the transfer.
  It stays in the wallet with its approval; the receipt, Needs you and the swap's Approvals offer to reset it.
- **A quote far under the page's own price.** The row says so, with both figures: the swapper's sources ask holders to
  check quotes through Hydrex's Algebra and Aero's Slipstream pools against another price.
- **Paid, or claimed in part.** An epoch counts as paid once claims since it ended took more than half of what its
  rewards were worth, at last epoch's prices. A claim of a few small rewards, such as anyone may make through AutoMaxi,
  does not count, and tokens a payout leaves out, such as those that cannot be swapped, do not keep it from counting.
- **An account that moved.** Its standing is read in the pools of the automation it voted with last epoch, where its
  rewards are, and its receipts are those of the automation it is in now. If the one it voted with no longer holds its
  claims, the page says so: what waits can still be claimed on Hydrex.
- **Just after the flip,** until Hydrex moves on to the new epoch, what last epoch's votes earned is not final. The
  payouts say so, and are read again every five minutes until it is.

## Limits

- The page shows each account's last payout only. For AutoMaxi, that is the claims in the epoch of the last one, up to
  ten blocks of them: anyone can claim dust for an account through a contract of their own, as often as they like.
- What waits to be claimed is a floor: the page reads each account's rewards in the pools its automation voted for last
  epoch, and no others. If some of those reads fail, it says "at least".
- Whether an account was paid for the epoch before last needs that epoch's rewards. Hydrex's Voter no longer holds those
  votes, so the page finds them among every pool's reward contracts: thousands of reads, about two seconds on Base, made
  once per session, and only if one of the owner's accounts voted with the automation then. They are weighed at last
  epoch's prices.
- The page finds an account's last payout through Hydrex's reward contracts, which record up to when they have paid it,
  through the record of the reward worth the most that the payout claimed. Anyone allowed to claim for the account moves
  that record, such as its owner on Hydrex. The page then says that the account was last claimed outside Carbon Impact,
  and shows no receipt.
- What votes earned is for the last epoch only, at approximate prices: each token's average price over the half hour
  before the epoch ended, in Hydrex's pools, with Chainlink for WETH and cbBTC. A token without a deep enough pool
  counts as nothing.
- Only the admin key, or a call from the owner's own address made elsewhere, can change a payout address.
- The swap knows only the tokens on its list, Hydrex's reward tokens, those added by address, and those a wallet lists
  with ERC-7811's `wallet_getAssets`: no RPC lists a wallet's tokens. Routes pass through WETH, USDC, cbBTC and HYDX
  only, and each hop takes the best pool for what the hop before paid, which is not always the best route as a whole.
  Aero's classic pools win a hop only by more than 1%: above a tip of 1 gwei, they add a tax that a quote does not see.
- Swaps never take or give native ETH: WETH is not ETH.

## Development

Needs Node 26.

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
exponential backoff. The first run, which asks for everything, takes about 25 minutes through an RPC of your own; the
next ones take about two minutes.

CI runs Prettier, the type check, the unit tests, `reuse lint` and the build. It then builds again from a fresh clone
and checks that both builds are the same. It also runs the browser tests, in the runner's Chrome, with the forks'
answers kept in GitHub's cache from one run, or attempt, to the next, one run of a branch at a time. Dependabot updates
the pinned Actions and npm packages every week.

| Path                                                    | What it holds                                                                                                                                                                                             |
| ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `index.html`                                            | The page. Its views are Home, the App (`#app`), the Hydrex accounts (`#hydrex`), a page per automation (`#hydrex/automaxi`), an account's page (`#hydrex/9540`), the swap (`#swap`) and About (`#about`). |
| `style.css`, `fonts/`                                   | Styles and fonts.                                                                                                                                                                                         |
| `src/config.ts`                                         | What the page trusts: contract addresses and code hashes, the RPCs, and the price anchors.                                                                                                                |
| `src/hydrex-conduits.json`                              | Hydrex's automations, as <https://api.hydrex.fi/conduits> lists them.                                                                                                                                     |
| `src/main.ts`                                           | Startup, the wallet connection, the App, the accounts, and an account's page.                                                                                                                             |
| `src/swap.ts`, `src/swap-calls.ts`, `src/swap-view.ts`  | The swap: candidate pools, quotes, minimums and simulation; its calls; and its page.                                                                                                                      |
| `src/tokens.ts`, `src/base-tokens.json`                 | The tokens the page knows, and their balances and approvals.                                                                                                                                              |
| `src/claim.ts`, `src/claim-view.ts`                     | Claiming through AutoMaxi: the calls from what `earned` found, and the review.                                                                                                                            |
| `src/review.ts`                                         | The review that shows each call before the wallet asks.                                                                                                                                                   |
| `src/last-epoch.ts`, `src/earnings.ts`, `src/prices.ts` | What votes earned last epoch, and token prices.                                                                                                                                                           |
| `src/last-payout.ts`, `src/receipts.ts`                 | Payouts: up to when each account was paid, what waits, and its last receipt.                                                                                                                              |
| `src/claims.ts`                                         | AutoMaxi's claims, read back from the last one.                                                                                                                                                           |
| `src/hydrex.ts`                                         | Hydrex's contracts: reads, account statuses, the calls, and the checks.                                                                                                                                   |
| `src/chain.ts`, `src/wallet.ts`                         | RPC requests, and wallets.                                                                                                                                                                                |
| `src/routes.ts`, `src/views.ts`                         | The page's addresses, and the view each shows.                                                                                                                                                            |
| `src/dom.ts`, `src/format.ts`                           | Page helpers, and number and date formats.                                                                                                                                                                |
| `test/`, `fork/`                                        | Unit tests; the browser tests, which `fork/run.ts` runs at once, the harness they share in `fork/harness.ts`, and `fork/rpc-cache.ts`, which keeps the answers their forks read from Base.                |
| `fork/fixtures/`                                        | AutoMaxi's init code, for the browser tests to deploy it on the fork.                                                                                                                                     |
| `scripts/`                                              | The build; `fonts.py` makes `fonts/`, `icons.ts` draws the icons from `icon.svg`, and `tokens.ts` checks the list of tokens.                                                                              |

## License

MIT, and REUSE compliant. The fonts in `fonts/` are under the SIL Open Font License 1.1. Klima Protocol's logo,
`klima-protocol.svg`, belongs to Klima Protocol, all rights reserved, and is used with its permission.
