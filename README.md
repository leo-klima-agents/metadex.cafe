# metaDEX Café

A static page at <https://metadex.cafe/> for Hydrex accounts on Base:

- join or leave **Matcha Latte**, Hydrex's automation, and **Double Espresso**, an automation nobody controls;
- claim Double Espresso's rewards when a payout is late;
- see what votes earned last epoch, against Hydrex's average, and each account's last payout as a receipt;
- swap many tokens into one through **ImmutableSwapper**, routed together and run through Base before the wallet asks.

It has no server, holds no keys and stores nothing. It reads Base through three public RPCs, which its Content Security
Policy allows and nothing else: `https://mainnet.base.org`, `https://base.drpc.org` and
`https://base-rpc.publicnode.com`. Before anyone can join, it checks the contracts it trusts (`src/config.ts`): if a
check fails, joining is off and the page says why; leaving always works.

## Develop

Needs Node 26 LTS. [anvil](https://getfoundry.sh/) and Chromium for the browser tests.

```sh
npm ci --ignore-scripts
npm run typecheck && npm test && npx prettier --check .
npm run build      # dist/
npm run test:fork  # the page in Chromium against forks of Base in anvil
npm run qa         # the page by hand against a fork, beside a wallet that signs as any address
```

The browser tests and the QA wallet fork through `fork/rpc-cache.ts`, which asks `BASE_RPC_URL` (an archive RPC, else
the page's first RPC) once for each answer and keeps it in `~/.cache/metadex.cafe/fork`. `CHROMIUM` names a browser
binary; `SCREENSHOTS` a folder for screenshots.

| Path                        | What it holds                                                                |
| --------------------------- | ---------------------------------------------------------------------------- |
| `index.html`, `style.css`   | Every view, popup and row template; the styles. Fonts are in `fonts/`.       |
| `src/config.ts`             | What the page trusts: contracts, RPCs, price feeds, swappers and exchanges.  |
| `src/rpc.ts`, `cache.ts`    | RPC requests (failover, pacing, the shown view's reads first) and one cache. |
| `src/prices.ts`             | Pools on twelve exchanges, Chainlink, and prices now and at an epoch's end.  |
| `src/rewards.ts`            | What votes earned in an epoch, and Hydrex's average.                         |
| `src/hydrex.ts`             | Hydrex accounts, their statuses, joining and leaving, and the checks.        |
| `src/payouts.ts`            | Up to when each account was paid, what waits, and its last receipt.          |
| `src/claim.ts`              | Claims through Double Espresso, split to fit transactions.                   |
| `src/swap.ts`, `routing.ts` | Routes, quotes, simulation and minimums; routing ticked tokens together.     |
| `src/data.ts`, `views/`     | What each view reads, and how it fills the page.                             |
| `test/`, `fork/`            | Unit tests; browser tests (`fork/run.ts`) and the QA wallet (`fork/qa.ts`).  |
| `scripts/`                  | The build, license notices, the release, fonts and the token list's check.   |

## When a contract changes

Each check is named by its id in `src/hydrex.ts`: `chain` (an RPC serves another chain: joining and swaps off),
`upgrade` (Hydrex upgraded its VotingEscrow), `logic` (its approval logic), `approvals` and `double-espresso-approvals`
(what joining each automation approves is off, or other than `[3, 5]`). Read the new code's verified source, update
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

Hydrex's automations are in `src/hydrex-conduits.json`, from <https://api.hydrex.fi/conduits>. The token list,
`src/base-tokens.json`, is checked against Base by `node scripts/tokens.ts` (`--add 0x…`, `--write`).

## Release

1. `npm version x.y.z --no-git-tag-version`, commit, and tag `vx.y.z`; push the tag. CI tests it, deploys it to GitHub
   Pages (source "GitHub Actions", custom domain `metadex.cafe`), and makes a Release with `dist/` as a CAR file and a
   zip, and its CID and content hash.
2. Upload `dist/`, built from the tag, to Pinata as a folder; check that its CID is the Release's.
3. Set `metadexcafe.eth`'s content hash to the Release's, and check <https://metadexcafe.eth.limo/>'s About.

The same commit always builds the same files: to check a deployment, build the tag and compare each file of `dist/` with
what the site serves. In Safe{Wallet}, the custom app is `https://metadex.cafe/`.

## License

MIT, and REUSE compliant. The fonts are under the SIL Open Font License 1.1. Klima Protocol's logo,
`klima-protocol.svg`, belongs to Klima Protocol and is used with its permission.
