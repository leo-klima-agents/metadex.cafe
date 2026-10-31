# metaDEX Café

A static page at <https://metadex.cafe/> for Hydrex accounts on Base. It lets their owners join or leave Matcha Latte,
Hydrex's automation, and Double Espresso, an automation nobody controls; leave Hydrex's automations that stopped; claim
Double Espresso's rewards when a payout is late; and swap many tokens into one through ImmutableSwapper. Hydrex's
contracts call automations "conduits".

The page has no server, holds no keys and stores nothing. It reads Base through three public RPCs and asks the visitor's
wallet to send transactions: one prompt for all of them where the wallet supports EIP-5792, and one Safe transaction
inside Safe{Wallet}.

## What it trusts, and the checks

Before anyone can join, the page checks Base and Hydrex's contracts against `src/config.ts`. A failed check turns
joining off, and Hydrex's page names it; leaving always works. The checks run again every hour.

| Check                       | Turns off                    | What changed                                                          |
| --------------------------- | ---------------------------- | --------------------------------------------------------------------- |
| `chain`                     | Joining both, and every swap | An RPC answered for another chain.                                    |
| `upgrade`                   | Joining both                 | Hydrex upgraded its VotingEscrow.                                     |
| `logic`                     | Joining both                 | `approvalLogic()` on the VotingEscrow.                                |
| `approvals`                 | Joining Matcha Latte         | `getConduitApprovalConfig` for Matcha Latte: off, or not `[3, 5]`.    |
| `double-espresso-approvals` | Joining Double Espresso      | `getConduitApprovalConfig` for Double Espresso: off, or not `[3, 5]`. |

After a change, read the new code's verified source and decide whether to trust it; if so, update `src/config.ts`, test
and release. These [Foundry](https://getfoundry.sh/) commands print what the page expects:

```sh
RPC=https://mainnet.base.org
ESCROW=0x25B2ED7149fb8A05f6eF9407d9c8F878f59cd1e1
cast to-check-sum-address $(cast implementation $ESCROW --rpc-url $RPC)  # VOTING_ESCROW_IMPLEMENTATION
cast call $ESCROW "approvalLogic()(address)" --rpc-url $RPC                # APPROVAL_LOGIC
for AUTOMATION in 0xdE91885cF35ac57DF0c4A75c16862127dBe8317c 0x692c323B425A9DfeebE302F56168a7798D93EAC5; do
  cast call $ESCROW "getConduitApprovalConfig(address)(uint8[],bool,string)" $AUTOMATION --rpc-url $RPC
done
```

Hydrex controls Matcha Latte: the share retired (up to 100%), the fee (up to 1%), the payout tokens and routers, and who
votes for it; the page shows its settings as they are on Base. Double Espresso (`ImmutableVeTokenConduit` v2, from
<https://github.com/ldeso/hydrex-conduit> at tag `v2`) and the six swappers have no owner: their 1% fee and the 2-of-3
Safe it goes to are fixed in their code, so the page does not check them.

When Hydrex adds or removes automations, update `src/conduits.json` from <https://api.hydrex.fi/conduits>. The list of
tokens, `src/tokens.json`, is kept by hand: `node scripts/tokens.ts` checks it against Base, `--add 0x…` adds one, and
`--write` writes Base's answers back.

## Network and integrity

The Content Security Policy in `index.html` lets the page reach `https://mainnet.base.org`, `https://base.drpc.org` and
`https://base-rpc.publicnode.com`, asked in that order: at most 25 requests a second each (5 for logs), 6 in flight, the
page shown first. The browser checks the script and the stylesheet, which inlines the fonts, against SHA-384 hashes in
`index.html`. The same commit always builds the same files.

## Setup

- **GitHub Pages:** source "GitHub Actions", custom domain `metadex.cafe`, "Enforce HTTPS" on, and the apex A and AAAA
  records GitHub lists at the DNS provider.
- **The `github-pages` environment:** deployments from tags matching `v*` only.
- **`BASE_RPC_URL` secret** (optional): an archive RPC for the browser tests to fork from.
- **Safe{Wallet}:** under Apps, My custom apps, add `https://metadex.cafe/`.

## Releasing

1. `npm version 1.2.3 --no-git-tag-version`, and commit.
2. `npm run build`, then `python3 -m http.server --directory dist 8000`, and try <http://localhost:8000/#app> with a
   wallet.
3. Tag the commit `v1.2.3` and push the tag. CI deploys to GitHub Pages, checks that Pages serves the build, and makes a
   GitHub Release with `dist/` as a CAR file and a zip, and the CID and EIP-1577 content hash as its notes.
4. Upload `dist/`, built from the tag, as a folder to Pinata, and check that its CID is the Release's.
5. Set `metadexcafe.eth`'s content hash to the Release's, and check <https://metadexcafe.eth.limo/>'s About.

For up to ten minutes after a release, a browser holding the old files in its cache refuses them for their hashes.

To check what the site serves, check out the tag of the version on its About, then:

```sh
npm ci --ignore-scripts && npm run build
cd dist && for file in $(find . -type f | sort); do curl -fsS "https://metadex.cafe/${file#./}?$(date +%s)" | cmp - "$file"; done
```

## Development

Needs Node 26.13 or later.

```sh
npm ci --ignore-scripts
npm run typecheck
npm test          # unit tests, and checks of the markup and the colours' contrast
npm run format    # before committing
npm run build     # writes the page to dist/
npm run release   # dist/ as a CAR file and a zip in release/, with the CID
npm run test:fork # the page in Chromium against a fork of Base
```

`npm run test:fork` needs [anvil](https://getfoundry.sh/) and Chromium (`CHROMIUM` names its binary). anvil forks
`BASE_RPC_URL`, or the page's first RPC, through `fork/cache.ts`, which keeps each answer in `FORK_CACHE`
(`~/.cache/metadex.cafe/fork`): the first run takes a while, later ones a few minutes. The tests join by keyboard alone,
leave, claim, swap, and run axe-core's WCAG 2.2 AA rules on every view, light and dark, desktop and phone. CI runs them
too, and Prettier, the type check, the unit tests, and the build twice from fresh clones, which must give the same
files.

| Path                                | What it holds                                                                           |
| ----------------------------------- | --------------------------------------------------------------------------------------- |
| `index.html`, `style.css`, `fonts/` | Every view and popup; the styles, on a few primitives.                                  |
| `src/config.ts`                     | What the page trusts: addresses, ABIs, RPCs, exchanges, swappers.                       |
| `src/rpc.ts`, `src/state.ts`        | Requests to the RPCs; values read from Base, and the render loop.                       |
| `src/hydrex.ts`                     | Hydrex accounts, their statuses, joining and leaving, and the checks.                   |
| `src/earnings.ts`, `src/prices.ts`  | What votes earned last epoch, at prices now.                                            |
| `src/payouts.ts`, `src/claim.ts`    | Up to when each account was paid, its last receipt, and claims through Double Espresso. |
| `src/swap.ts`, `src/routing.ts`     | Routes, quotes and minimums; tokens sold together, in parts.                            |
| `src/views/`                        | Each view's `render()`, the router, the wallet, and the review of every call.           |
| `scripts/`                          | The build, the release, and the token list's check.                                     |
| `test/`, `fork/`                    | Unit tests; the browser tests and the cache they fork through.                          |

## License

MIT. The fonts are under the SIL Open Font License 1.1 (`fonts/OFL.txt`). Klima Protocol's logo, `klima-protocol.svg`,
belongs to Klima Protocol, all rights reserved, and is used with its permission.
