# metaDEX Café

The static page at <https://metadex.cafe/> for joining and leaving the Klima "Carbon Impact" automation with Hydrex
accounts on Base. It shows the automation's settings and latest vote, and the epoch. With a wallet connected, or inside
Safe{Wallet} as a Safe App, it shows the wallet's accounts with where each stands, and joins, leaves and sets the payout
address. Klima's keeper, [hydrex-keeper](https://github.com/ldeso/hydrex-keeper), votes with the accounts in the
automation. The page is `index.html` and `style.css`; a script in `src/` fills in what it reads from Base and talks to
the wallet. Its dependencies are `viem`, `@coinbase/wallet-sdk` for Coinbase Wallet, and `@safe-global/safe-apps-sdk`
for Safe{Wallet}.

## How joining works

In Hydrex's contracts, an automation is a conduit. Joining calls `setConduitApproval(conduit, tokenId, true)` on
Hydrex's VotingEscrow, once per account. Then:

- **Votes.** The account's votes count for the automation from the next epoch, which starts on Thursday at 00:00 UTC.
  While the account is in, its owner cannot vote with it.
- **Rewards.** The automation can claim the account's rewards at once, including any the owner has not claimed yet, and
  the current epoch's once it ends. They are swapped and retired like the rest: claim them on Hydrex first to keep them
  as they are.
- **Payouts.** Right after each epoch ends, Klima's keeper claims the rewards. The automation swaps them into kVCM,
  retires a share as carbon credits and sends the rest to the owner's payout address.
- **The account** stays in the owner's wallet, with its HYDX. Nothing is transferred.

Leaving is the same call with `false`, at any time. The automation can no longer claim from then on, and the votes come
back to the owner from the next epoch.

Hydrex controls the automation with a single key. It can change the share retired up to 100%, the payout tokens, the fee
up to 1%, the swap routers and any owner's payout address, and choose who claims and votes for the automation: today
Klima's executor Safe, through which the keeper acts, and the automation's deployer.

## What the page can and cannot do

- **It sends three calls only:** `setConduitApproval(conduit, tokenId, true)` on Hydrex's VotingEscrow to join, the same
  with `false` to leave, and `setMyPayoutRecipient(address)` on the Carbon Impact automation. Joining replaces where an
  account's votes and claims go, so an account in another of Hydrex's automations joins directly.
- **It checks each call before the wallet asks.** It runs the calls against Base from the owner's address, one after the
  other (`eth_simulateV1`), shows what they change and the exact calls, and sends nothing that would fail.
- **It holds no key and has no server.** Each action ends in a wallet prompt. A wallet that sends several calls as one
  transaction (EIP-5792) asks once. Others ask once per call, each from a click of its own once the one before is
  included: a wallet that opens a window, such as Coinbase's, can only open it from a click.
- **It works with the wallets the browser announces** (EIP-6963), or the one at `window.ethereum`, and with Coinbase
  Wallet through Coinbase's SDK. That SDK loads only when someone picks it. With no wallet in the browser, "Browser
  wallet" still shows, and says how to get one.
- **Inside Safe{Wallet}, it works with the Safe.** It proposes the calls as one Safe transaction, and the Safe's owners
  sign it in Safe{Wallet}. Safe's SDK loads only when the page runs in a frame.
- **It checks the automation first.** The chain, the automation's code and settings, and the code of Hydrex's
  VotingEscrow must match `src/config.ts`. If not, the page says what changed, and joining and changing the payout
  address stay off. Leaving still works.
- **It cannot stop copies.** Anyone can host a changed copy, for example with another payout address. Use the official
  address, and read the wallet prompt.

The page's Content Security Policy allows these origins and nothing else:

| Origin                                                   | Why                                                                         |
| -------------------------------------------------------- | --------------------------------------------------------------------------- |
| `https://mainnet.base.org`                               | Base RPC: reads, checks of the calls, and receipts                          |
| `https://base-rpc.publicnode.com`                        | Base RPC: reads, checks of the calls, and receipts                          |
| `https://base.drpc.org`                                  | Base RPC: reads, checks of the calls, and receipts                          |
| `https://rpc.wallet.coinbase.com`                        | Coinbase's SDK: call status before a smart-wallet session exists            |
| `https://chain-proxy.wallet.coinbase.com`                | Coinbase's SDK: a smart-wallet session's reads, such as a batch's status    |
| `https://www.walletlink.org`, `wss://www.walletlink.org` | Coinbase's SDK: sessions with the Coinbase Wallet app on a phone            |
| The page's own origin                                    | Coinbase's SDK reads the page's headers to check how it may open its window |

Coinbase's smart wallet opens `https://keys.coinbase.com` in a window of its own, and Safe's SDK talks to Safe{Wallet}
through the frame; neither needs an entry. The policy also allows the three style elements Coinbase's SDK adds for the
Coinbase Wallet app, by their hashes, and wallets' icons as `data:` images.

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
3. Build, serve `dist/` and open it with a wallet. No check of the automation should fail: if one does, Hydrex changed
   something, and `src/config.ts` needs the new contracts checked first.

### After the deployment

1. CI's last step compares every file Pages serves with the build. It must pass.
2. Open <https://metadex.cafe/>. The footer shows the tag's version and the tagged commit.
3. Check the build from a fresh clone, as in [Checking a build](#checking-a-build).
4. Connect a wallet in a browser, and in a phone wallet's own browser, and open the review of a join without confirming
   it.
5. In Safe{Wallet}, add `https://metadex.cafe/` as a custom Safe App and check that its name and icon show. With a Safe
   on Base, open the review of a leave or a join, propose it, and reject it in Safe{Wallet}.

## Inside Safe{Wallet}

In Safe{Wallet}, open Apps, then My custom apps, and add `https://metadex.cafe/` as a custom Safe App. Safe{Wallet}
reads the name, description and icon from `manifest.json`. A link also opens it, after a warning that the app is not in
Safe{Wallet}'s list: `https://app.safe.global/apps/open?safe=base:<Safe address>&appUrl=https%3A%2F%2Fmetadex.cafe%2F`.

The page connects to the Safe on its own. Joining, leaving and the payout address end in Safe{Wallet}'s own screen,
which shows the decoded calls; one owner proposes, and the others sign there. The page does not follow the proposal: the
statuses change once the transaction executes. GitHub Pages lets other sites frame the page and read its manifest, which
Safe{Wallet} needs.

## Checking a build

The same commit gives the same files on any machine. To check the official page, build the version in its footer:

```sh
git clone https://github.com/ldeso/metadex.cafe && cd metadex.cafe
git checkout v0.3.0
npm ci --ignore-scripts
npm run build
```

Then compare each file in `dist/` with the one at the same path on <https://metadex.cafe/>.

## Failure modes

- **Base RPC:** a read that fails goes to the next RPC. If none answers, the page says so and offers to try again.
- **A failed startup check,** or one that cannot run, turns joining and changing the payout address off. The page says
  why.
- **The end of an epoch:** the page counts epochs from the time of Base's latest block, so it does not wait for Hydrex's
  minter to move on to the new epoch. An open page moves on by itself and reads the automation and the accounts again.
- **The wrong network:** the page says so, and the main button becomes "Switch to Base". If the wallet cannot switch,
  the page asks to pick Base in the wallet.
- **A call that would fail:** the review says which and why, and nothing can be sent.
- **A refusal in the wallet, or a transaction that fails:** the review says so, with links to the transactions that went
  through. The page reads the accounts again when the review closes.
- **A transaction the page cannot follow,** because the wallet replaced it or cannot say where a batch is: the review
  can be closed at any time, which stops the page following and sending; the wallet shows the rest.
- **Coinbase's SDK failing to load** affects only Coinbase Wallet; other wallets keep working.
- **A Safe** proposes the transaction instead of sending it, and its owners sign it in Safe{Wallet}. A Safe on another
  network cannot switch: the page asks to open it from a Safe on Base.

## Development

Needs Node 26. Run `npm ci --ignore-scripts`, then `npm run typecheck`, `npm test` and `npm run format` before
committing. `npm run build` writes the page to `dist/`; serve that folder with any static server to try it.

`npm run test:fork` builds the page and drives it in Chromium against a copy of Base in anvil, pinned at a block. A test
wallet acts as real owners: one joins with two accounts, one of them from Liquid Hydrex; another joins from Lock Maxi
and USDC in one batch; a member leaves and changes the payout address; another leaves with two accounts in one batch;
the owner of an ended lock gets nothing to tick; and, inside a stand-in for Safe{Wallet}, a Safe proposes leaving with
two accounts. It also checks the wrong network, a wallet that cannot switch, a refusal in the wallet, a call that would
fail, a browser without a wallet, that Coinbase Wallet loads under the page's policy and opens its window, and an epoch
that ends before Hydrex's minter moves. It needs anvil, from Foundry, and Chromium:
`npx playwright-core install chromium`, or set `CHROMIUM` to a Chromium's path. `BASE_RPC_URL` is the archive RPC to
fork from, `https://mainnet.base.org` by default. With `SCREENSHOTS` set to a folder, it saves screenshots there at 390
and 1440 px, light and dark.

`src/config.ts` holds what the page trusts about the automation, and the RPCs it reads from. After a Hydrex upgrade,
check the new contracts, then update it. `src/hydrex-conduits.json` names Hydrex's other automations, from
`api.hydrex.fi/conduits`.

CI runs Prettier, the type check, the tests, `reuse lint` and the build, then builds again from a fresh clone and checks
that both builds are the same. With a `BASE_RPC_URL` secret, it also runs the fork tests. Dependabot updates the pinned
Actions and npm packages.

## Limitations

- No payout history, and no amount of unclaimed rewards per account. The page cannot check that payouts happen.

## License

MIT, REUSE compliant.
