# metaDEX Café

A static page at <https://metadex.cafe/> for Hydrex accounts and Aero stakes on Base. With it, you can:

- join or leave **Matcha Latte**, Hydrex's automation, or **Double Espresso**, an automation that nobody controls;
- claim Double Espresso's rewards when a payout is late;
- see the APR that votes earned last epoch, next to Hydrex's average, and each account's last payout as a receipt;
- swap many tokens into one through **ImmutableSwapper**, with routes planned together and a simulation on Base before
  the wallet asks you to sign;
- follow one of two Aero strategies with a stake (see below);
- see each Aero stake's pools, when it can be allocated again and what it can claim, and each pool's APR, day by day.

The two Aero strategies pick up to 10 pools, judged on their last eight days, from all pools or from blue chips only.
They pick once, or again every 48 hours.

- **Follow the leaders** picks the pools that pay the most per sAERO above the average. Each pool's weight is in
  proportion to how much more it pays than the average, with your stake counted in the pool.
- **Follow revenue** picks the pools with the most revenue. Each pool's weight is in proportion to its revenue.

The page shows how both strategies did over the last eight days, against Aero's Autopilot as it actually allocated and
against the Base average. You can then allocate a stake on Base to a strategy's picks, or set your own shares across any
pools. The allocation is simulated on Base before the wallet asks you to sign.

The page has no server, holds no keys and stores nothing. It reads Base through three public RPCs:
`https://mainnet.base.org`, `https://base.drpc.org` and `https://base-rpc.publicnode.com`. Its Content Security Policy
lets it connect to these hosts only. Prices come from Chainlink feeds and from pools on Base. Pool prices are averages
over the 30 minutes before a block. Prices are read from past blocks, so they need an RPC that serves old blocks. Before
anyone can join, the page checks Base against the contracts it trusts (`src/config.ts`). If a check fails, joining is
turned off and the page says why. Leaving always works.

## Develop

You need Node 26 LTS. The browser tests also need [anvil](https://getfoundry.sh/) and Chromium.

```sh
npm ci --ignore-scripts
npm run typecheck && npm test && npx prettier --check .
npm run build      # builds the page into dist/
npm run dev        # serves dist/ at http://localhost:8000 (or $PORT), and rebuilds it on each change
npm run test:fork  # tests the page in Chromium against forks of Base in anvil
npm run qa         # lets you try the page by hand against a fork, with a wallet that signs as any address
```

The browser tests and the QA wallet fork Base through `fork/rpc-cache.ts`. It asks `BASE_RPC_URL` once for each answer
and saves the answer in `~/.cache/metadex.cafe/fork`. `BASE_RPC_URL` should be an archive RPC. By default, it is the
page's first RPC. `FORK_CACHE` sets another cache folder, `CHROMIUM` sets the browser binary, and `SCREENSHOTS` sets a
folder to save screenshots in.

| Path                                   | What it holds                                                                                                |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `site/`                                | The files the site serves: the page with all its views, popups and row templates, the styles and the icons.  |
| `src/main.ts`, `routes.ts`, `state.ts` | How the page starts, its addresses (the part after `#`), and the state that every view is drawn from.        |
| `src/config.ts`, `abi.ts`              | What the page trusts: contracts, RPCs, price feeds and swap contracts. Hydrex's and Aero's ABIs.             |
| `src/checks.ts`                        | The checks of Base that run before joining or swapping.                                                      |
| `src/rpc.ts`, `cache.ts`               | RPC requests (failover, pacing, and the shown view's reads first), and the cache of every read.              |
| `src/wallet.ts`                        | Wallets (EIP-6963, Safe{Wallet}), and sending calls one at a time or in one prompt.                          |
| `src/tokens.ts`                        | The tokens the page knows, and an owner's balances and allowances.                                           |
| `src/prices.ts`                        | Prices from Chainlink and from pools: Aero's, Aerodrome's and Hydrex's now, only Hydrex's at an epoch's end. |
| `src/rewards.ts`                       | What votes earned in an epoch, and Hydrex's average.                                                         |
| `src/hydrex.ts`                        | Hydrex accounts, their statuses, and joining and leaving.                                                    |
| `src/payouts.ts`                       | How far each account has been paid, what is waiting, and its last receipt.                                   |
| `src/claim.ts`                         | Claims through Double Espresso, split into calls that fit in transactions.                                   |
| `src/aero.ts`                          | Aero's pools on Base, what each paid per sAERO, stakes, and the record of the strategies in 48-hour steps.   |
| `src/swap.ts`, `routing.ts`            | Routes, quotes, simulation and minimums. `routing.ts` routes the ticked tokens together.                     |
| `src/data.ts`, `views/`                | What each view reads (`data.ts`), and how each view fills the page (`views/`).                               |
| `src/ui.ts`, `format.ts`               | Filling the page's templates, and how figures, sums, dates and hex are written.                              |
| `test/`, `fork/`, `qa/`                | Unit tests; browser tests (`fork/run.ts`); the QA wallet (`qa/qa.ts`).                                       |
| `scripts/`                             | The build, the dev server, the license notices, the release files, the fonts and the token list check.       |

The build bundles `src/main.ts`, and `site/style.css` with the fonts from `site/fonts/` inlined. It adds the license
notices of what each file bundles, fills in the version and the integrity hashes in `site/index.html`, and copies the
other files in `site/` unchanged. `python3 scripts/fonts.py` makes the fonts.

## When a contract changes

Each check has an id in `src/checks.ts`. When a check fails, `src/views/hydrex.ts` tells the user in words why joining
is off. The checks are:

- `chain`: an RPC serves another chain. Joining and swaps are off.
- `upgrade`: Hydrex upgraded its VotingEscrow.
- `logic`: Hydrex changed its VotingEscrow's approval logic.
- `approvals` and `double-espresso-approvals`: joining Matcha Latte or Double Espresso is turned off, or approves other
  actions than `[3, 5]`. Action 3 sends the account's claims to the automation, and action 5 delegates its votes.

If Hydrex changed a contract, read its new verified source. If the page should trust it, update `src/config.ts` and
release. To see what Base holds:

```sh
RPC=https://mainnet.base.org
ESCROW=0x25B2ED7149fb8A05f6eF9407d9c8F878f59cd1e1
cast to-check-sum-address $(cast implementation $ESCROW --rpc-url $RPC)
cast call $ESCROW "approvalLogic()(address)" --rpc-url $RPC
for AUTOMATION in 0xdE91885cF35ac57DF0c4A75c16862127dBe8317c 0x692c323B425A9DfeebE302F56168a7798D93EAC5; do
  cast call $ESCROW "getConduitApprovalConfig(address)(uint8[],bool,string)" $AUTOMATION --rpc-url $RPC
done
```

The list of Hydrex's automations, `src/hydrex-conduits.json`, comes from <https://api.hydrex.fi/conduits>.
`node scripts/tokens.ts` checks the token list, `src/base-tokens.json`, against Base. `--add 0x…` checks a new token
too, and `--write` saves Base's answers to the list, added tokens included.

## Release

1. Run `npm version x.y.z --no-git-tag-version`, commit, tag the commit `vx.y.z` and push the tag. CI checks that the
   tag matches the version in `package.json`, tests the code and deploys it to GitHub Pages (source "GitHub Actions",
   custom domain `metadex.cafe`). It also makes a GitHub Release with `dist/` as a CAR file and as a zip file. The
   Release's notes give the CID and the ENS content hash.
2. Build `dist/` from the tag and upload it to Pinata as a folder. Check that its CID is the same as the Release's.
3. Set the content hash of `metadexcafe.eth` to the Release's, then check the version in About on
   <https://metadexcafe.eth.limo/>.

The same commit always builds the same files. To check a deployment, build the tag and compare each file in `dist/` with
what the site serves. To use the page in Safe{Wallet}, add `https://metadex.cafe/` as a custom app.

## License

The project is under the MIT License, and it is REUSE compliant. The fonts are under the SIL Open Font License 1.1.
Klima Protocol's logo, `site/klima-protocol.svg`, belongs to Klima Protocol and is used with its permission.
