# metaDEX Café

The static page at <https://metadex.cafe/> for joining and leaving the "Carbon Impact" automation with Hydrex accounts
on Base. It shows the automation's settings and the epoch. With a wallet connected, or inside Safe{Wallet} as a Safe
App, it shows the wallet's accounts with where each stands and where their payouts go, and joins and leaves. A keeper
votes with the accounts in the automation. The page is `index.html` and `style.css`; a script in `src/` fills in what it
reads from Base and talks to the wallet. Its dependencies are `viem`, and `@safe-global/safe-apps-sdk` for Safe{Wallet}.

## How joining works

In Hydrex's contracts, an automation is a conduit. Joining calls `setConduitApproval(conduit, tokenId, true)` on
Hydrex's VotingEscrow, once per account. Then:

- **Votes.** The account's votes count for the automation from the next epoch, which starts on Thursday at 00:00 UTC.
  While the account is in, its owner cannot vote with it.
- **Rewards.** The automation can claim the account's rewards at once, including any the owner has not claimed yet, and
  the current epoch's once it ends. They are swapped and retired like the rest: claim them on Hydrex first to keep them
  as they are.
- **Payouts.** Right after each epoch ends, the automation claims the rewards, swaps them into kVCM, retires a share as
  carbon credits and sends the rest to the owner's payout address.
- **The account** stays in the owner's wallet, with its HYDX. Nothing is transferred.

Leaving is the same call with `false`, at any time. The automation can no longer claim from then on, and the votes come
back to the owner from the next epoch.

A single admin key controls the automation. It can change the share retired up to 100%, the payout tokens, the fee up to
1%, the swap routers and any owner's payout address, and choose who claims and votes for the automation: today an
executor Safe, through which the keeper acts, and the automation's deployer.

## What the page can and cannot do

- **It sends two calls only:** `setConduitApproval(conduit, tokenId, true)` on Hydrex's VotingEscrow to join, and the
  same with `false` to leave. Joining replaces where an account's votes and claims go, so an account in another
  automation joins directly. The page shows what the calls change and the exact calls before the wallet asks.
- **It holds no key, has no server and stores nothing.** Each action ends in a wallet prompt, once per call, each from a
  click of its own once the one before is included: a wallet that opens a window can only open it from a click. The page
  connects to a wallet only from a click, and forgets it on reload.
- **It works with the wallets the browser announces** (EIP-6963), or the one at `window.ethereum`. With no wallet in the
  browser, "Browser wallet" still shows, and says how to get one.
- **Inside Safe{Wallet}, it works with the Safe.** It proposes the calls as one Safe transaction, and the Safe's owners
  sign it in Safe{Wallet}. Safe's SDK is part of the script, and runs only when the page is in a frame.
- **It checks the automation first.** The chain, the automation's code and settings, and the code of Hydrex's
  VotingEscrow must match `src/config.ts`. If not, the page says what changed, and joining stays off. Leaving still
  works.
- **It cannot stop copies.** Anyone can host a changed copy, for example one that approves another conduit. Use the
  official address, and read the wallet prompt.

The page's Content Security Policy lets it reach these origins and nothing else:

| Origin                            | Why                           |
| --------------------------------- | ----------------------------- |
| `https://mainnet.base.org`        | Base RPC: reads, and receipts |
| `https://base-rpc.publicnode.com` | Base RPC: reads, and receipts |
| `https://base.drpc.org`           | Base RPC: reads, and receipts |

Safe's SDK talks to Safe{Wallet} through the frame, and needs no entry. Scripts and styles come only from the page's own
files, and images also as `data:` for wallets' icons.

The browser checks the script, Safe's SDK included, and the stylesheet against the SHA-384 hashes in `index.html`
(Subresource Integrity) before using them.

## Deployment

A tag deploys the page. Tag a commit with the version in `package.json` and push the tag:

```sh
git tag v0.3.0 && git push origin v0.3.0
```

CI runs its checks, publishes `dist/` on GitHub Pages, then checks that Pages serves the same files. A tag that does not
match the version fails.

Set up once, in the repository's settings:

- **Pages:** the source is GitHub Actions, the custom domain is `metadex.cafe`, and HTTPS is enforced.
- **Environments:** `github-pages` allows tags matching `v*`, not only the default branch.
- **DNS:** `metadex.cafe` has the A and AAAA records that GitHub lists for an apex domain.
- **Secrets:** `BASE_RPC_URL`, an archive RPC for Base, so that CI runs the fork tests before it deploys.

### Before tagging

1. Bump the version in `package.json` and `package-lock.json`, and commit.
2. Run `npm run test:fork` with an archive RPC, unless CI runs it. It is the only test of the wallets.
3. Build, serve `dist/` and open it with a wallet. No check of the automation should fail: if one does, a contract
   changed, and `src/config.ts` needs the new contracts checked first.

### After the deployment

1. CI's last step compares every file Pages serves with the build. It must pass.
2. Open <https://metadex.cafe/>. The footer shows the tag's version and the tagged commit.
3. Check the build from a fresh clone, as in [Checking a build](#checking-a-build).
4. Connect a wallet in a browser, and in a phone wallet's own browser, and open the review of a join without confirming
   it. Check the browser's console for policy errors.
5. In Safe{Wallet}, add `https://metadex.cafe/` as a custom Safe App and check that its name and icon show. With a Safe
   on Base, open the review of a leave or a join, propose it, and reject it in Safe{Wallet}.

## Inside Safe{Wallet}

In Safe{Wallet}, open Apps, then My custom apps, and add `https://metadex.cafe/` as a custom Safe App. Safe{Wallet}
reads the name, description and icon from `manifest.json`. A link also opens it, after a warning that the app is not in
Safe{Wallet}'s list: `https://app.safe.global/apps/open?safe=base:<Safe address>&appUrl=https%3A%2F%2Fmetadex.cafe%2F`.

The page connects to the Safe on its own. Joining and leaving end in Safe{Wallet}'s own screen, which shows the decoded
calls; one owner proposes, and the others sign there. The page does not follow the proposal: the statuses change once
the transaction executes. GitHub Pages lets other sites frame the page and read its manifest, which Safe{Wallet} needs.

## Checking a build

The same commit gives the same files on any machine. To check the official page, build the version in its footer from a
fresh clone of this repository:

```sh
git checkout v0.3.0
npm ci --ignore-scripts
npm run build
```

Then compare each file in `dist/` with the one at the same path on <https://metadex.cafe/>.

## Failure modes

- **Right after a deployment:** GitHub Pages lets a browser keep each file for ten minutes. A browser that gets the new
  page with the previous script or stylesheet from its cache refuses that file, as it does not match the page's hashes,
  until its copy expires.
- **Base RPC:** a read that fails goes to the next RPC. If none answers, the page says so and offers to try again.
- **A failed startup check,** or one that cannot run, turns joining off. The page says why. An open page runs the checks
  again every hour.
- **The end of an epoch:** the page takes the time from the latest block it read rather than from the device, so it does
  not wait for Hydrex's minter to move on to the new epoch. An open page does not move on by itself, but it reads the
  accounts and the automation again when Join or Leave is clicked in a new epoch, before any review.
- **The wrong network:** the page says so, and the main button becomes "Switch to Base". If the wallet cannot switch,
  the page asks to pick Base in the wallet.
- **A call that would fail:** the wallet usually warns while it estimates the gas. If it is sent anyway, Base includes
  it as failed, and the review says so.
- **A refusal in the wallet, or a transaction that fails:** the review says so, with links to the transactions that went
  through. Once something was sent, the page reads the accounts again when the review closes.
- **A review closed early:** closing stops the page sending, not following. It follows what it sent for ten minutes and
  reads the accounts again once Base includes it.
- **A transaction the page cannot follow,** because the wallet replaced it or Base did not include it within ten
  minutes: the review says so. The wallet shows the rest; reload the page then.
- **A wallet that locks:** the page lets go of it. Pick it again once it is unlocked.
- **A Safe** proposes the transaction instead of sending it, and its owners sign it in Safe{Wallet}. A Safe on another
  network cannot switch: the page asks to open it from a Safe on Base.

## Development

Needs Node 26. Run `npm ci --ignore-scripts`, then `npm run typecheck`, `npm test` and `npm run format` before
committing. `npm run build` writes the page to `dist/`; serve that folder with any static server to try it.

`npm run test:fork` builds the page and drives it in Chromium against a copy of Base in anvil, pinned at a block. A test
wallet acts as real owners: one joins with two accounts, one of them from Liquid Hydrex; another joins from Lock Maxi
and USDC; a member leaves; the owner of an ended lock gets nothing to tick; and, inside a stand-in for Safe{Wallet}, a
Safe proposes leaving with two accounts. It also checks that the page asks the wallet nothing until it is picked, and
only for its account, its chain and transactions then; the wrong network, a wallet that cannot switch, a refusal in the
wallet, a transaction that fails on Base, a review closed before Base includes the transaction, a wallet that locks, a
browser without a wallet, and that nothing breaches the page's policy. It needs anvil, from Foundry, and Chromium:
`npx playwright-core install chromium`, or set `CHROMIUM` to a Chromium's path. `BASE_RPC_URL` is the archive RPC to
fork from, `https://mainnet.base.org` by default. With `SCREENSHOTS` set to a folder, it saves screenshots there at 390
and 1440 px, light and dark.

`src/config.ts` holds what the page trusts about the automation, and the RPCs it reads from. After an upgrade, check the
new contracts, then update it. `src/hydrex-conduits.json` names the other automations that Hydrex lists at
`api.hydrex.fi/conduits`.

CI runs Prettier, the type check, the tests, `reuse lint` and the build, then builds again from a fresh clone and checks
that both builds are the same. With a `BASE_RPC_URL` secret, it also runs the fork tests. Dependabot updates the pinned
Actions and npm packages.

## Limitations

- No payout history, and no amount of unclaimed rewards per account. The page cannot check that payouts happen.
- No latest vote, and no way to change the payout address: only the automation's admin key, or a call from the owner's
  address made elsewhere, changes it.

## License

MIT, REUSE compliant.
