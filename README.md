# metaDEX Café

metaDEX Café is a static web page at <https://metadex.cafe/>. It lets owners of Hydrex accounts on Base join or leave
Carbon Impact, Klima's automation on Hydrex, and AutoMaxi, an automation nobody controls. Hydrex's contracts call
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
  account's rewards through it: it pays them to the owner in the tokens earned, less 1%. Carbon Impact's keeper sends
  its votes and claims. Joining one of the two takes the votes and the claims from the other, in one call.
- **Leaving** is the same call with `false`. The page can also take accounts out of Hydrex's other automations, such as
  those that stopped voting in September 2026: same call, with that automation's address.
- **Before anyone can join, the page checks** the chain, each automation's code, Carbon Impact's settings, and the code
  of Hydrex's VotingEscrow against `src/config.ts`. If a check fails, joining that automation is turned off and the page
  says why. Leaving always works. The checks run again every hour. Until there is code at AutoMaxi's address, the page
  leaves AutoMaxi out.
- It shows what Carbon Impact's votes earned last epoch. For each of the owner's accounts in an automation, it shows up
  to when the account has been paid, what waits to be claimed, and the receipt of its last payout.
- Home sets the choices side by side: each automation, and voting yourself. Each automation has a page of its own,
  `#carbon-impact` and `#automaxi`, with its six fee facts. In the App, Choose compares them for the accounts ticked,
  with last epoch's figures and the gas of the change.
- Inside Safe{Wallet}, it proposes all the calls as one Safe transaction.

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
- **The `BASE_RPC_URL` secret:** an archive RPC for Base. CI uses it for the browser tests, and skips them without it.
- **Safe{Wallet}:** under Apps, then My custom apps, add `https://metadex.cafe/`.

## Releasing

1. Set the new version, for example `npm version 0.5.0 --no-git-tag-version`, and commit.
2. Run `npm run build` and `python3 -m http.server --directory dist 8000`, then open <http://localhost:8000/#app> with a
   wallet. Check that joining is on.
3. Run the browser tests with `npm run test:fork`. CI runs them too when the `BASE_RPC_URL` secret is set.
4. Tag the commit with `v` and the version, for example `v0.5.0`, and push the tag. Any other tag fails.

CI then runs every check, publishes `dist/` on GitHub Pages, and downloads each file back from Pages to compare it.

For up to ten minutes after a release, a browser may still hold the old script or stylesheet in its cache. It refuses
them, because their hashes no longer match, so the page may not work for that visitor until the cache expires.

## When a contract changes

The page names each check that fails:

| The page says                                          | What changed                                                                              |
| ------------------------------------------------------ | ----------------------------------------------------------------------------------------- |
| The RPC serves another chain than Base.                | An RPC answered for another chain.                                                        |
| Carbon Impact runs other code than this page knows.    | Carbon Impact's code.                                                                     |
| Carbon Impact points to another VotingEscrow or Voter. | `veToken()` or `voter()` on Carbon Impact.                                                |
| Carbon Impact pays in another token than kVCM.         | `kvcm()` on Carbon Impact.                                                                |
| What joining Carbon Impact approves has changed.       | `getConduitApprovalConfig` on the VotingEscrow: no longer active, or other than `[3, 5]`. |
| AutoMaxi runs other code than this page knows.         | AutoMaxi's code.                                                                          |
| AutoMaxi points to another VotingEscrow or Voter.      | `veToken()` or `voter()` on AutoMaxi.                                                     |
| What joining AutoMaxi approves has changed.            | `getConduitApprovalConfig` on the VotingEscrow, for AutoMaxi.                             |
| Hydrex upgraded its VotingEscrow.                      | The VotingEscrow's implementation, or its code.                                           |
| Hydrex changed its VotingEscrow's approval logic.      | `approvalLogic()` on the VotingEscrow, or its code.                                       |

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

When Hydrex adds or removes automations, update `src/hydrex-conduits.json` from <https://api.hydrex.fi/conduits>, and
the table of automations in `index.html`. A test checks that the two match. If Hydrex lists AutoMaxi, the page still
treats it as its own.

AutoMaxi is version 2 of `ImmutableVeTokenConduit`, from <https://github.com/ldeso/hydrex-conduit> at tag `v2`, commit
`718c107`. It was deployed on 20 Oct 2026, in block 52,854,750, through the CREATE2 deployer. The command above prints
the code hash in that commit's `verification/bytecode-hashes.json`,
`0x4872932431e0d175fb1213e9ffec2b8f0ebd1d9d490643d6df5b2c6d0b379847`. Version 1, at
`0x8B79159681aEbeC096D06F3d996fCd2f72e54f8B`, still works, and nobody had joined it when version 2 was deployed. The
page offers only version 2.

## Checking a deployment

The same commit always builds the same files. To check what the site serves, check out the commit shown in the page's
footer, then run these. The query string skips any old copy the CDN still holds right after a release.

```sh
npm ci --ignore-scripts
npm run build
cd dist && for file in $(find . -type f | sort); do curl -fsS "https://metadex.cafe/${file#./}?$(date +%s)" | cmp - "$file"; done
```

## What visitors may run into

- **"Reading Base failed."** No RPC answered. The page offers to try again. What votes earned, the other automations and
  the payouts only add to the page: if one of them cannot be read, the rest of the page still works. What votes earned
  is tried again every five minutes. If one automation's payouts cannot be read, the others' still show, and the page
  reads them again every five minutes; if none can, the payouts have a button to read them again.
- **Joining is off.** A check failed: see [When a contract changes](#when-a-contract-changes).
- **The wallet is on another network.** The page offers to switch it to Base, or asks the visitor to pick Base in the
  wallet.
- **A refused or failed transaction.** The review says so, with links to the transactions that went through. Closing the
  review stops sending, but the page keeps following what was already sent.
- **A wallet that locks** is disconnected. Picking it again reconnects it.
- **At the end of an epoch,** Thursday at 00:00 UTC by Base's clock, the page reads the accounts and Carbon Impact again
  within half a minute.
- **A payout under way.** A payout takes up to half a day after each epoch. While it has paid some of the owner's
  accounts and not yet others, the page says so. Until a payout due since the flip has reached every account, the page
  reads the payouts again every five minutes, and then not until the next epoch.
- **A late payout.** An account is late when it voted with Carbon Impact two epochs ago and has not been paid for that
  epoch yet. Its rewards wait in Hydrex's reward contracts until someone claims them, for up to 50 epochs. Carbon Impact
  paid nothing from 23 Sep to at least 19 Oct 2026, though it kept voting.

## Limits

- The page shows each account's last payout only. For AutoMaxi, that is the claims in the epoch of the last one, up to
  ten blocks of them: anyone can claim dust for an account through a contract of their own, as often as they like.
- What waits to be claimed is a floor: the page reads each account's rewards in the pools its automation voted for last
  epoch, and no others. If some of those reads fail, it says "at least".
- An account not paid since last epoch started may have been paid on the pools of the epoch before. Hydrex's Voter no
  longer holds those votes, so the page finds them among every pool's reward contracts: thousands of reads, made only
  then, and once per session.
- The page finds an account's last payout through Hydrex's reward contracts, which record up to when they have paid it.
  Anyone allowed to claim for the account moves that record, such as its owner on Hydrex. The page then says that the
  account was last claimed outside Carbon Impact, and shows no receipt.
- What votes earned is for the last epoch only, at approximate prices: each token's average price over the half hour
  before the epoch ended, in Hydrex's pools, with Chainlink for WETH and cbBTC. A token without a deep enough pool
  counts as nothing.
- Only the admin key, or a call from the owner's own address made elsewhere, can change a payout address.

## Development

Needs Node 26.

```sh
npm ci --ignore-scripts
npm run typecheck
npm test
npm run format  # before committing
npm run build   # writes the page to dist/
```

`npm run test:fork` builds the page, then runs it in Chromium against a fork of Base in anvil, with real accounts:
joining, leaving, a Safe, the views, and what can fail. It needs [anvil](https://getfoundry.sh/) and Chromium
(`npx playwright-core install chromium`, or set `CHROMIUM` to a Chromium binary). `BASE_RPC_URL` is the archive RPC to
fork from, and `SCREENSHOTS` an optional folder for screenshots. It takes about twenty minutes.

CI runs Prettier, the type check, the unit tests, `reuse lint` and the build. It then builds again from a fresh clone
and checks that both builds are the same. With `BASE_RPC_URL` set, it also runs the browser tests. Dependabot updates
the pinned Actions and npm packages every week.

| Path                                                    | What it holds                                                                                                                             |
| ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `index.html`                                            | The page. Its views are Home, the App (`#app`), a page per automation (`#carbon-impact`, `#automaxi`) and How it works (`#how-it-works`). |
| `style.css`, `fonts/`                                   | Styles and fonts. CSS switches the views, so they work without the script.                                                                |
| `src/config.ts`                                         | What the page trusts: contract addresses and code hashes, the RPCs, and the price anchors.                                                |
| `src/hydrex-conduits.json`                              | Hydrex's automations, as <https://api.hydrex.fi/conduits> lists them.                                                                     |
| `src/main.ts`                                           | Startup, the wallet connection, and the accounts.                                                                                         |
| `src/review.ts`                                         | The review that shows each call before the wallet asks.                                                                                   |
| `src/choose.ts`                                         | Choose: the automations and voting yourself, side by side, for the accounts ticked.                                                       |
| `src/last-epoch.ts`, `src/earnings.ts`, `src/prices.ts` | What votes earned last epoch, and token prices.                                                                                           |
| `src/last-payout.ts`, `src/receipts.ts`                 | Payouts: up to when each account was paid, what waits, and its last receipt.                                                              |
| `src/claims.ts`                                         | AutoMaxi's claims, read back from the last one.                                                                                           |
| `src/hydrex.ts`                                         | Hydrex's contracts: reads, account statuses, the calls, and the checks.                                                                   |
| `src/chain.ts`, `src/wallet.ts`                         | RPC requests, and wallets.                                                                                                                |
| `src/views.ts`, `src/dom.ts`, `src/format.ts`           | Views, page helpers, and number and date formats.                                                                                         |
| `test/`, `fork/page.ts`                                 | Unit tests, and the browser tests.                                                                                                        |
| `fork/fixtures/`                                        | AutoMaxi's init code, for the browser tests to deploy it on the fork.                                                                     |
| `scripts/`                                              | The build; `fonts.py` makes `fonts/`, and `icons.ts` draws the icons from `icon.svg`.                                                     |

## License

MIT, and REUSE compliant. The fonts in `fonts/` are under the SIL Open Font License 1.1. Klima Protocol's logo,
`klima-protocol.svg`, belongs to Klima Protocol, all rights reserved, and is used with its permission.
