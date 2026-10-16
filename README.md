# metaDEX Café

The static page at <https://metadex.cafe/> for joining and leaving the Klima "Carbon Impact" automation with Hydrex
accounts on Base. It shows the automation's settings and latest vote, the epoch, and the accounts of any address with
where each stands. Klima's keeper, [hydrex-keeper](https://github.com/ldeso/hydrex-keeper), votes with the accounts in
the automation. The page is `index.html` and `style.css`; a script in `src/` fills in what it reads from Base, and its
only dependency is `viem`.

## How joining works

In Hydrex's contracts, an automation is a conduit. Joining calls `setConduitApproval(conduit, tokenId, true)` on
Hydrex's VotingEscrow, once per account. Then:

- **Votes.** The account's votes count for the automation from the next epoch, which starts on Thursday at 00:00 UTC.
  Meanwhile its owner cannot vote with it.
- **Rewards.** The automation can claim the account's rewards at once, including any from past epochs that the owner has
  not claimed. Claim them on Hydrex first to keep them as they are.
- **Payouts.** Right after each epoch ends, Klima's keeper claims the rewards. The automation swaps them into kVCM,
  retires a share as carbon credits and sends the rest to the owner's payout address.
- **The account** stays in the owner's wallet, with its HYDX. Nothing is transferred.

Leaving is the same call with `false`, at any time. The automation can no longer claim from then on, and the votes come
back to the owner from the next epoch.

Hydrex controls the automation with a single key. It can change the share retired up to 100%, the payout tokens, the fee
up to 1%, the swap routers and any owner's payout address, and choose who claims and votes for the automation: today
Klima's executor Safe, through which the keeper acts, and the automation's deployer.

## What the page can and cannot do

- **It only reads, for now.** It does not talk to wallets yet, so it cannot join or leave.
- **It has no server.** It runs in the browser and reads Base from `https://mainnet.base.org`,
  `https://base-rpc.publicnode.com` and `https://base.drpc.org`. Its Content Security Policy allows nothing else.
- **It checks the automation first.** The chain, the automation's code and settings, and the code of Hydrex's
  VotingEscrow must match `src/config.ts`. If not, the page says what changed, and joining stays off.

## Deployment

A tag deploys the page. Tag a commit with the version in `package.json` and push the tag:

```sh
git tag v0.1.0 && git push origin v0.1.0
```

CI runs its checks, publishes `dist/` on GitHub Pages, then checks that Pages serves the same files. A tag that does not
match the version fails.

Set up once, in the repository's settings:

- **Pages:** the source is GitHub Actions, the custom domain is `metadex.cafe`, and HTTPS is enforced.
- **Environments:** `github-pages` allows tags matching `v*`, not only the default branch.
- **DNS:** `metadex.cafe` has the A and AAAA records that GitHub lists for an apex domain.

## Checking a build

The same commit gives the same files on any machine. To check the official page, build the version in its footer:

```sh
git clone https://github.com/ldeso/metadex.cafe && cd metadex.cafe
git checkout v0.1.0
npm ci --ignore-scripts
npm run build
```

Then compare each file in `dist/` with the one at the same path on <https://metadex.cafe/>.

## Failure modes

- **Base RPC:** a read that fails goes to the next RPC. If none answers, the page says so and offers to try again.

## Development

Needs Node 26. Run `npm ci --ignore-scripts`, then `npm run typecheck`, `npm test` and `npm run format` before
committing. `npm run build` writes the page to `dist/`; serve that folder with any static server to try it.

`src/config.ts` holds what the page trusts about the automation, and the RPCs it reads from. After a Hydrex upgrade,
check the new contracts, then update it. `src/hydrex-conduits.json` names Hydrex's other automations, from
`api.hydrex.fi/conduits`.

CI runs Prettier, the type check, the tests, `reuse lint` and the build, then builds again from a fresh clone and checks
that both builds are the same. Dependabot updates the pinned Actions and npm packages.

## Limitations

- No payout history, and no amount of unclaimed rewards per account. The page cannot check that payouts happen.

## License

MIT, REUSE compliant.
