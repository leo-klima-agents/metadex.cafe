# metaDEX Café

A static page at <https://metadex.cafe/> for Hydrex accounts on Base:

- join or leave **Matcha Latte**, Hydrex's automation, and **Double Espresso**, an automation nobody controls;
- claim Double Espresso's rewards when a payout is late;
- see what votes earned last epoch compared with Hydrex's average, and each account's last payout as a receipt;
- swap many tokens into one through **ImmutableSwapper**, routed together and simulated on Base before the wallet asks
  to sign.

It has no server, holds no keys and stores nothing. It reads Base through three public RPCs, the only hosts its Content
Security Policy lets it connect to: `https://mainnet.base.org`, `https://base.drpc.org` and
`https://base-rpc.publicnode.com`. Its prices are averages over the half hour before a block, read from past blocks, so
they need an RPC that serves old ones. Before anyone can join, it checks Base against the contracts it trusts
(`src/config.ts`). If a check fails, joining is turned off and the page says why; leaving always works.

## Develop

Needs Node 26 LTS, plus [anvil](https://getfoundry.sh/) and Chromium for the browser tests.

```sh
npm ci --ignore-scripts
npm run typecheck && npm test && npx prettier --check .
npm run build      # dist/
npm run dev        # serves dist/ at http://localhost:8000 (or $PORT), rebuilt on each change
npm run test:fork  # the page in Chromium against forks of Base in anvil
npm run qa         # try the page by hand against a fork, with a wallet that signs as any address
```

The browser tests and the QA wallet fork Base through `fork/rpc-cache.ts`, which asks `BASE_RPC_URL` (an archive RPC; by
default the page's first RPC) once for each answer and caches it in `~/.cache/metadex.cafe/fork` (`FORK_CACHE` sets
another folder). `CHROMIUM` sets the browser binary, and `SCREENSHOTS` a folder to save screenshots in.

| Path                                   | What it holds                                                                                          |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `site/`                                | The files the site serves: the page with every view, popup and row template, the styles and the icons. |
| `src/main.ts`, `routes.ts`, `state.ts` | The page's start, its addresses, and the state every view is drawn from.                               |
| `src/config.ts`, `abi.ts`              | What the page trusts: contracts, RPCs, feeds, swap contracts; and Hydrex's ABIs.                       |
| `src/checks.ts`                        | The checks of Base that run before joining or swapping.                                                |
| `src/rpc.ts`, `cache.ts`               | RPC requests (failover, pacing, the shown view's reads first), and the cache of every read.            |
| `src/wallet.ts`                        | Wallets (EIP-6963, Safe{Wallet}), and sending calls one at a time or in one prompt.                    |
| `src/tokens.ts`                        | The tokens the page knows, and an owner's balances and allowances.                                     |
| `src/prices.ts`                        | Prices from Chainlink and pools: Aero's, Aerodrome's and Hydrex's now, Hydrex's at an epoch's end.     |
| `src/rewards.ts`                       | What votes earned in an epoch, and Hydrex's average.                                                   |
| `src/hydrex.ts`                        | Hydrex accounts, their statuses, joining and leaving.                                                  |
| `src/payouts.ts`                       | How far each account has been paid, what is waiting, and its last receipt.                             |
| `src/claim.ts`                         | Claims through Double Espresso, split to fit transactions.                                             |
| `src/swap.ts`, `routing.ts`            | Routes, quotes, simulation and minimums; `routing.ts` routes the ticked tokens together.               |
| `src/data.ts`, `views/`                | What each view reads (`data.ts`), and how it fills the page (`views/`).                                |
| `src/ui.ts`, `format.ts`               | Filling the page's templates, and how figures, sums, dates and hex are written.                        |
| `test/`, `fork/`, `qa/`                | Unit tests; browser tests (`fork/run.ts`); the QA wallet (`qa/qa.ts`).                                 |
| `scripts/`                             | The build, the dev server, license notices, the release files, the fonts and the token list check.     |

The build bundles `src/main.ts`, and `site/style.css` with the fonts of `site/fonts/` inlined, fills in
`site/index.html`'s version and integrity hashes, and copies the other files of `site/` unchanged.
`python3 scripts/fonts.py` makes the fonts.

## When a contract changes

Each check has an id in `src/checks.ts`, and `src/views/hydrex.ts` says in words why a failed one turns joining off:
`chain` (an RPC serves another chain; joining and swaps are off), `upgrade` (Hydrex upgraded its VotingEscrow), `logic`
(Hydrex changed its approval logic), and `approvals` and `double-espresso-approvals` (joining Matcha Latte or Double
Espresso is turned off, or approves other actions than `[3, 5]`). Read the new code's verified source, update
`src/config.ts` if the page should trust it, and release. To see what Base holds:

```sh
RPC=https://mainnet.base.org
ESCROW=0x25B2ED7149fb8A05f6eF9407d9c8F878f59cd1e1
cast to-check-sum-address $(cast implementation $ESCROW --rpc-url $RPC)
cast call $ESCROW "approvalLogic()(address)" --rpc-url $RPC
for AUTOMATION in 0xdE91885cF35ac57DF0c4A75c16862127dBe8317c 0x692c323B425A9DfeebE302F56168a7798D93EAC5; do
  cast call $ESCROW "getConduitApprovalConfig(address)(uint8[],bool,string)" $AUTOMATION --rpc-url $RPC
done
```

Hydrex's automations are in `src/hydrex-conduits.json`, from <https://api.hydrex.fi/conduits>. `node scripts/tokens.ts`
checks the token list, `src/base-tokens.json`, against Base; `--add 0x…` adds a token and `--write` saves Base's
answers.

## Release

1. Run `npm version x.y.z --no-git-tag-version`, commit, tag `vx.y.z` and push the tag. CI tests it, deploys it to
   GitHub Pages (source "GitHub Actions", custom domain `metadex.cafe`), and makes a Release holding `dist/` as a CAR
   file and a zip, with the CID and content hash in its notes.
2. Upload `dist/`, built from the tag, to Pinata as a folder; check that its CID is the Release's.
3. Set `metadexcafe.eth`'s content hash to the Release's, and check the version in About on
   <https://metadexcafe.eth.limo/>.

The same commit always builds the same files: to check a deployment, build the tag and compare each file of `dist/` with
what the site serves. To use the page in Safe{Wallet}, add `https://metadex.cafe/` as a custom app.

## License

MIT, and REUSE compliant. The fonts are under the SIL Open Font License 1.1. Klima Protocol's logo,
`site/klima-protocol.svg`, belongs to Klima Protocol and is used with its permission.
