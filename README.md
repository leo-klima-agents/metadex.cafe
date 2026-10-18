# metaDEX Café

The static page at <https://metadex.cafe/> for joining and leaving the Klima "Carbon Impact" conduit with Hydrex
accounts on Base; Hydrex's app, and the page, call conduits automations. This repository holds the page: `index.html`,
`style.css` and its fonts in `fonts/`, and the script in `src/` that reads Base and talks to the wallet, whose
dependencies are `viem`, and `@safe-global/safe-apps-sdk` for Safe{Wallet}.

The page has three views, addressed by the hash: Home at `/`, which asks for no wallet; the App at `#app`, with the
wallet's accounts, where Safe{Wallet} opens the page; and How it works at `#how-it-works`, which states everything in
full. Every `id` is an address that shows the view holding it, such as `#timing`, and CSS switches the views, so they
work without the script.

## How joining works

Joining calls `setConduitApproval(conduit, tokenId, true)` on Hydrex's VotingEscrow, once per account.

- **Votes:** the account's votes go to the conduit from the next epoch, which starts on Thursday at 00:00 UTC. Until it
  leaves, its owner cannot vote with it.
- **Rewards:** the conduit can claim the account's rewards at once, including any not yet claimed. After each epoch, it
  swaps them to kVCM, retires a share as carbon credits and sends the rest to the owner's payout address.
- **The account** stays in the owner's wallet, with its HYDX.

Leaving is the same call with `false`: the conduit can no longer claim, and the votes come back from the next epoch.
Leaving another of Hydrex's automations, such as one that stopped, is the same call with its address.

A single admin key controls the conduit. It can change the share retired (up to 100%), its fee (up to 1%), the payout
tokens, the swap routers, any owner's payout address, and who claims and votes for it.

## What the page can and cannot do

- **It sends two calls only,** `setConduitApproval` with `true` or `false`, and shows what they change and each call
  before the wallet asks, field by field, as the wallet will show it, each from a click of its own. Inside Safe{Wallet},
  it also shows the Safe transaction's fields and its calldata, each 32-byte word on two lines of 16 bytes. Addresses
  are in full, in groups of four, and copy without spaces.
- **It holds no key, has no server and stores nothing.** It connects to a wallet only from a click: one the browser
  announces (EIP-6963), or `window.ethereum`. Inside Safe{Wallet}, it proposes the calls as one Safe transaction.
- **It checks the conduit first.** The chain, the conduit's code and settings, and the code of Hydrex's VotingEscrow
  must match `src/config.ts`, or joining stays off. Leaving works either way.
- **It says when an account's automation has stopped,** from when Hydrex's Voter last saw it vote.
- **It shows what the votes earned last epoch,** from Hydrex's reward contracts: for the conduit, for each account in
  it, and, once that section shows, for all of Hydrex. Tokens are priced at their average over the half hour before the
  epoch ended, in Hydrex's pools, with Chainlink for WETH and cbBTC; a token without a deep enough pool counts for
  nothing.
- **It shows the last payout,** as a receipt for each of the owner's accounts in it: what was earned, swapped into kVCM,
  retired and paid, the fee, when and the transaction, from the conduit's events. A run is mostly a transaction for each
  account, over up to half a day, and Base's free RPCs give the logs of 100 blocks at a time at most, so the page finds
  the payout by its effect: `totalTonnesRetired` only grows, and a search of past blocks finds the stretches of 100
  blocks in which it changed, then reads their logs. That was 17 to 118 requests for the six runs from Aug to Sept 2026.
  It looks back eight weeks, and only for an owner with an account in the conduit. An open page checks the total every
  five minutes, and once it has grown, searches only the blocks after its last search. A payout takes up to half a day:
  while one is under way and has not reached the owner's accounts, the page keeps the last receipts, and says a new
  payout has begun. Each stretch's logs must hold a retirement, or the next RPC is asked for them.
- **It reaches nothing but three Base RPCs,** by its Content Security Policy: `https://mainnet.base.org`,
  `https://base.drpc.org` and `https://base-rpc.publicnode.com`. The browser checks the script and the stylesheet
  against the SHA-384 hashes in `index.html`; the fonts are inside the stylesheet.
- **It cannot stop copies.** Anyone can host one that approves another conduit: use the official address, and read the
  wallet prompt.

## Deployment

A tag deploys the page: push a tag of `v` and the version in `package.json`, such as `v0.3.0`; any other fails. CI runs
its checks, publishes `dist/` on GitHub Pages, and checks that Pages serves the same files.

- **Pages:** built by GitHub Actions, on the custom domain `metadex.cafe` with HTTPS enforced, and the A and AAAA
  records GitHub lists for an apex domain. The `github-pages` environment allows tags matching `v*`.
- **Secrets:** `BASE_RPC_URL`, an archive RPC for Base, for the fork tests.
- **Safe{Wallet}:** add `https://metadex.cafe/` as a custom Safe App, under Apps, then My custom apps.

Before tagging, run the fork tests unless CI does, and open the build with a wallet: a failed check of the conduit means
a contract changed, and `src/config.ts` needs the new contracts checked first.

## Checking a build

The same commit gives the same files on any machine. Check out the version in the page's footer, run
`npm ci --ignore-scripts` and `npm run build`, and compare each file in `dist/` with the one at the same path on
<https://metadex.cafe/>.

## Failure modes

- **Right after a deployment,** a browser may keep the previous script or stylesheet for ten minutes, and refuses it
  until then, as it does not match the page's hashes.
- **Base RPC:** every request goes through one queue in `src/chain.ts`, six at a time at most, the page's own reads
  before those in the background (the last payout's search, all of Hydrex, prices). Each RPC is asked 25 times a second
  at most, 5 of them for logs, as `https://mainnet.base.org` allows a visitor; a request goes to the first RPC with
  room, asking mainnet.base.org, then drpc, then publicnode: drpc keeps Base's history for free, where publicnode asks a
  token for it. It waits only when none has room. While the first two are full, a read of a past block still reaches
  publicnode, which refuses it, and goes on. A read that fails goes to the next RPC at once, in the same turn. An RPC
  that refuses for its limits is left alone for a second by every request. When none answers, the page asks those that
  were busy or out of reach again, up to four times, after an exponential backoff with full jitter; a read that would
  fail the same way, as one that reverts or one too slow, is not asked again. If none answers in the end, the page says
  so and offers to try again. Leaving never waits for the conduit's settings. If the Voter cannot be read, accounts in
  other automations show without saying whether those stopped; if what the votes earned cannot be read, the page says so
  where the figures go, and tries again every five minutes. If the last payout cannot be read, the page says so and
  offers to try again; one without prices shows its tokens alone. Read again in the background, a payout that cannot be
  read leaves what is shown, and is tried again five minutes later.
- **A failed check** turns joining off and says why. An open page runs the checks again every hour.
- **The end of an epoch:** the page takes the time from Base's newest block, and reads the accounts and the conduit
  again within half a minute.
- **The wrong network:** the page offers to switch to Base, or asks to pick Base in the wallet.
- **A refusal, or a transaction that fails:** the review says so, with links to the transactions that went through.
  Closing it stops the page sending, not following.
- **A wallet that locks** is let go: pick it again once it is unlocked.

## Development

Needs Node 26. Run `npm ci --ignore-scripts`, then `npm run typecheck`, `npm test` and `npm run format` before
committing. `npm run build` writes the page to `dist/`.

`npm run test:fork` drives the build in Chromium against a fork of Base in anvil, with real owners: joining, leaving, a
Safe, the views and what can fail. It needs anvil, and Chromium (`npx playwright-core install chromium`, or `CHROMIUM`).
`BASE_RPC_URL` is the archive RPC to fork from, and `SCREENSHOTS` a folder for screenshots.

`fonts/` holds Latin subsets of Atkinson Hyperlegible Next and Mono, and Young Serif, made by `scripts/fonts.py` from
Google Fonts' sources at a pinned commit; it needs Python, with the fontTools and brotli versions it names. The build
puts them inside `style.css` as `data:` URLs, which the Content Security Policy allows for fonts only.
`scripts/icons.ts` draws `favicon.ico` and `apple-touch-icon.png` from `icon.svg`, with Chromium.

`src/config.ts` holds what the page trusts about the conduit, its RPCs, and what its prices start from;
`src/hydrex-conduits.json` names Hydrex's other automations, as `api.hydrex.fi/conduits` lists them. CI runs Prettier,
the type check, the tests, `reuse lint` and the build, then builds again from a fresh clone and checks that both builds
are the same; with `BASE_RPC_URL`, it also runs the fork tests. Dependabot updates the pinned Actions and npm packages.

## Limitations

- The last payout only, and no unclaimed rewards per account. A payout that retires nothing does not move
  `totalTonnesRetired`: the page finds it only within 100 blocks of one that does. In Aug and Sept 2026, 2 of 71 payouts
  retired nothing, both paying nothing, and one of them was that close.
- What the votes earned is for the last epoch only, at approximate prices.
- Only the admin key, or a call from the owner's address made elsewhere, can change a payout address.

## License

MIT, REUSE compliant. The fonts in `fonts/` are under the SIL Open Font License 1.1, and carry their copyright and
licence in their own metadata. Klima Protocol's logo, `klima-protocol.svg`, is Klima Protocol's, all rights reserved,
and used with its permission.
