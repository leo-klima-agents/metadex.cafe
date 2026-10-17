# Research

Findings for the relay page, checked on Base on 2026-10-15 between blocks 52,653,442 and 52,655,496. Screenshots of
other sites are kept out of this repository. A script, `scripts/members.ts`, took the members snapshot; it was removed
since. The other checks are described well enough to redo with `cast` or a short script.

## What changed from the plan

Everything the plan states about the contracts held. These findings are new or more precise:

- **Joining exposes unclaimed rewards.** Once an account joins, the conduit may claim every reward the account has not
  claimed yet for finished weeks, including weeks before it joined. A fork test showed it.
- **Earning Power is votes × 1.3.** The factor is a display constant of Hydrex's app and of its lens contract. The Voter
  counts plain votes.
- **Most accounts are empty.** 95% of all veHYDX accounts hold no HYDX. Hydrex's app hides them; this page must too.
- **"Lock ended" is rare.** Only one account on all of Hydrex is a timed lock that ended with HYDX still in it. The
  members' two zero-power timed locks are empty.
- **The conduit's admin is one key.** `DEFAULT_ADMIN_ROLE` sits with an externally owned account. Two addresses hold
  `EXECUTOR_ROLE`: an executor Safe and the conduit's deployer.
- **Claims have been manual.** The last claim was on 2026-09-23, sent by hand through the executor Safe. Hydrex's API
  says payouts split 60% kVCM and 40% AZUSD; that claim paid kVCM only. The page takes the payout token and timing from
  the [decisions](#decisions) and live settings, never from Hydrex's API.
- **Hydrex names accounts on chain.** `HydrexAccountNames` stores names such as "Main Protocol Account". The page can
  show them.
- **The vote shown most of the week is last week's.** The keeper votes on Tuesday 23:50 UTC and in the last blocks
  before the flip, so from Thursday to Tuesday the conduit has no vote in the current epoch.
- **"Pools" are not all pairs.** The Voter also lists vaults, such as a Morpho vault, and the same pair can appear in
  two pool types. Names need three cases.
- **Aerodrome's and Velodrome's relays end next week.** Aero retires their veNFTs on 22 October; relays become
  "Autopilot". Nothing should be built for managed veNFTs.
- **ox ships once.** With `injected`, `coinbaseWallet` and `safe` only, `ox` appears in one version; `eventemitter3`
  appears in two.

## The contracts

All facts in the plan's tables still hold. Checked by reading the chain:

| Fact                                       | Value on 2026-10-15                                                   |
| ------------------------------------------ | --------------------------------------------------------------------- |
| VotingEscrow implementation (EIP-1967)     | `0x0FC6…F231`, `VotingEscrowV2Upgradeable`, partial match on Sourcify |
| Its `approvalLogic()`                      | `0x4B0B…f63D`, `VotingEscrowV2_ApprovalLogic`                         |
| Conduit source                             | identical to its source in hydrex-periphery at `4d7cb27`              |
| `getConduitApprovalConfig(conduit)`        | actions `[3, 5]`, active, description empty                           |
| `retireBps`, `treasuryFeeBps`              | 3333, 0 (`MAX_TREASURY_FEE_BPS` 100)                                  |
| `distributionTokens`                       | kVCM, AZUSD                                                           |
| `approvedRouters`                          | KyberSwap's `MetaAggregationRouterV2` (`0x6131…37b5`), listed twice   |
| `totalTonnesRetired`, `totalKvcmRetired`   | 5,691.40 t, 22,140.85 kVCM (both 18 decimals)                         |
| `retiringEntityName`, `beneficiaryString`  | "Hydrex", empty                                                       |
| Conduit votes, `getPastVotes` at the epoch | 897,042.93                                                            |
| Voter `_epochTimestamp()`                  | 1792022400, Thursday 2026-10-15 00:00 UTC                             |
| Conduit `lastVoted`                        | 1792022397, three seconds before that flip                            |

Action 3 is `CLAIM_REDIRECT_APPROVAL` and action 5 is `VOTING_DELEGATE` in `IVotingEscrowV2_Data.sol`.

Code hashes (keccak-256 of runtime code), for the registry's pins:

| Contract                    | Code hash                                                            |
| --------------------------- | -------------------------------------------------------------------- |
| Conduit                     | `0x0d67cd335e3ae9cde256cf399f819a3ea2b9c248b0336840a3b20a2ee82c192e` |
| VotingEscrow proxy          | `0x96c3cd33e65424eb56bec90a4fb2ab41c16085b1afc0dcb37dcd412b666fb2d6` |
| VotingEscrow implementation | `0xe6b54672ba85711eac5516d6ce09fe96cabe9cc3764a178e5d2f33a6241c2b42` |
| Approval logic              | `0xd1fab3adcd045439b72359a675665cb9f9267b32aebb140df865fc723681a930` |

### Units

- **Tonnes.** `totalTonnesRetired` uses 18 decimals. The last `CarbonRetired` event reported 1,694.039… t, and the
  credit token, `UCR-320-2022` with 18 decimals, burned exactly that many units in the same transaction.
- **Votes.** `balanceOfNFT` and `getPastVotes` use 18 decimals.

### Who controls the conduit

- **Admin.** `DEFAULT_ADMIN_ROLE` was granted at deployment to `0x7426…ae03`, an externally owned account, and it still
  holds it. It is the role admin of `EXECUTOR_ROLE` too. It can change payout tokens, the retired share, the fee up to
  1%, the routers, the retirement details, any owner's payout address (`adminSetPayoutRecipient`), and withdraw tokens
  the conduit holds between steps.
- **Executors.** `EXECUTOR_ROLE` is held by an executor Safe `0x17f5…1B12` (Safe 1.5.0, 2 of 3), whose only module is
  the conduit's executor, and by the deployer `0x40FB…92f0`, an account with MetaMask's EIP-7702 code.
- **The VotingEscrow.** It is an upgradeable proxy. The approval logic has no way to turn a conduit's config off: the
  config can only be set once, and only to active. An upgrade could still change it.

### What a join and a leave do

Tested on an anvil fork of block 52,653,604 with account #8, whose owner voted on its own last week.

- **Before joining,** the conduit's `claimBribesToRecipientByTokenId` and `claimFeesToRecipientByTokenId` revert.
- **The join** (`setConduitApproval(conduit, 8, true)`, 275,037 gas) set the delegate and the claim redirect to the
  conduit. The account's unclaimed rewards were unchanged.
- **Right after the join,** the conduit claimed all of them to an address of its choice: rewards earned by the owner's
  own vote in the week that had just ended.
- **The leave** (126,250 gas) delegated the votes back to the owner and cleared the claim redirect. The conduit's claims
  reverted again.

Why: each bribe contract pays an account, for every finished week since its last claim (at most 50 per claim), its share
of whoever was its delegate at that week's start. The claim itself only checks who is approved now. So:

- **Joining** lets the conduit claim the account's unclaimed rewards from every past week. They are then swapped, partly
  retired and paid out like any other. To keep past rewards as they are, claim them on Hydrex before joining.
- **Leaving** works the other way. Rewards the conduit earned with the account and did not claim yet become the owner's
  to claim, as they are.

Two more properties, from the code:

- **No time window.** Neither `setConduitApproval` nor the delegation it runs checks the epoch, so a join or a leave
  works at any moment. A leave never calls the Voter, so no killed gauge can block it.
- **One conduit at a time.** The delegate and the claim redirect hold one address each. Joining another conduit replaces
  both.

### Timing

- **Votes.** The Voter weighs a vote with `getPastVotes(voter, epochStart)`. An account that joins counts for the
  conduit from the next Thursday 00:00 UTC. An account that leaves still counts for the conduit until then, and its
  owner cannot vote with it before then either.
- **Statuses.** `delegates(tokenId, epochStart)` on the VotingEscrow tells the delegate at the epoch start. Comparing it
  with `getLockDelegatee(tokenId)` gives "joined, counts from Thursday" and "left, counts until Thursday".
- **The flip.** `_epochTimestamp()` is the minter's `active_period()`. It moves when someone calls the minter after
  Thursday 00:00 UTC, so it can lag the calendar for a while. A join sent meanwhile still counts only from the next
  Thursday, so the page reads delegates and votes at the Thursday before Base's latest block instead. A fork test moves
  anvil past the flip without calling the minter and checks it.
- **The keeper's vote.** The keeper votes on Tuesday at 23:50 UTC and again in the last two blocks before the flip.
  Until Tuesday, the conduit's latest vote is last week's: `lastVoted` is before `_epochTimestamp()`. The page says
  "latest vote" and whether it was last week's or this week's.

### The last payout

Transaction `0x0932…e899` on 2026-09-23 at 17:44 UTC. An owner of the executor Safe sent it by hand through
`execTransaction` and MultiSend, before the module existed.

- It claimed USDC and HYDX for four accounts, swapped them to kVCM, retired part of the kVCM, and paid the rest.
- It paid no AZUSD.
- The large Safe's payouts went to its payout address, an externally owned account.
- For account #26432 it retired 1,694 t for 8,454 kVCM and paid 18,686 kVCM: 31% retired, within the 33.33% cap.

### Pools in a vote

The conduit's latest vote, cast at 23:59:57 UTC on Wednesday 14 October, covers 27 pools. `token0` and `token1` name
most of them. One is a Morpho vault (steakEURC) with `asset()` and no `token0`. Two are price-convergence vaults with a
pair and a symbol of their own. GOO/cbBTC appears twice, as a volatile pair and as another pool. Names should be:

1. the pair's two symbols, plus the pool's own symbol when it has one (for example "GOO/cbBTC · vAMM");
2. otherwise the pool's `symbol()`, such as "steakEURC";
3. otherwise the short address.

Symbols come from the chain. They are text only, and they need a length limit.

### Earning Power

Hydrex's app shows "Earning Power" 216 for an account with 166 votes. Its front end computes `votes × 13 / 10`, and its
lens contract `0xF4d3…6866` exposes `EARNING_POWER_MULTIPLIER` 13 and `EARNING_POWER_DIVISOR` 10. Hydrex's API reports
earning power 1.3 times voting power for every conduit. The VotingEscrow and the Voter use plain votes. Hydrex's copy
says "Flex Accounts give 1:1.3 earning power per liquid HYDX locked".

Recommendation: show votes, as the contracts count them. Where a user may compare, add Hydrex's figure once, for example
"166 votes (216 Earning Power on Hydrex)".

### Account names

`HydrexAccountNames` at `0x998c…c0d3` (verified on Sourcify) lets an owner name an account, at most 24 bytes.
`getBulkNames(tokenIds)` reads them. The large Safe calls account #26432 "Main Protocol Account". Names are user text:
show them with `textContent`, next to the number.

### Hydrex's other conduits

`api.hydrex.fi/conduits` lists 14 conduits with names. Each is active on chain with actions `[3, 5]`, except Hydrex Lock
Maxi, whose actions are `[1, 3, 5]`. Action 1 is an ERC-5725 claim approval, which a Carbon Impact join leaves in place.
These names go into `hydrex-conduits.json`, by address:

| Address       | Name                | Votes     | Contract                  |
| ------------- | ------------------- | --------- | ------------------------- |
| `0x5338…29d3` | Hydrex Lock Maxi    | 1,095,191 | `VeMaxiTokenConduitProxy` |
| `0x809f…8af0` | Liquid Hydrex       | 2,004,398 | `VeTokenConduit`          |
| `0xe57b…bd1d` | USDC                | 2,312,384 | `VeTokenConduit`          |
| `0x65cd…f829` | Bitcoin             | 500,823   | `VeTokenConduit`          |
| `0xde91…317c` | Carbon Impact       | 897,043   | a conduit of its own      |
| `0x24a0…3244` | TGN                 | 520       | `VeTokenConduit`          |
| `0xf34f…692a` | Ethereum            | 759,020   | `VeTokenConduit`          |
| `0xd656…dddd` | WMTX                | 26        | `VeTokenConduit`          |
| `0x612f…1b5c` | Bluechips           | 1,311,649 | `VeTokenConduit`          |
| `0x92d0…9cad` | Onchain cbAssets    | 721,822   | `VeTokenConduit`          |
| `0xb009…870c` | EURC                | 14,450    | `VeTokenConduit`          |
| `0x6e37…58b9` | Base Gaming         | 7,604     | `VeTokenConduit`          |
| `0x528a…3f62` | Base Memes          | 13,284    | `VeTokenConduit`          |
| `0x9691…428a` | Reppo (Vote & Earn) | 66,805    | `VeTokenConduit`          |

Other delegates are not conduits. The largest, `0x3547…B7f4` with 53 accounts, is an ERC-1967 proxy with an unverified
implementation and no conduit config. The page should show "delegated to 0x…" for those.

## Who uses it

`scripts/members.ts`, since removed, read every account's owner, delegate, lock and votes through Multicall3 in about a
minute, then classified the code of each member's owner, of the 100 owners with the most votes, and of 500 random
owners.

### Members of Carbon Impact

21 accounts, held by 14 owners, with 897,042 votes.

- **Concentration.** One Safe 1.3.0 (3 of 5 signers) holds 5 accounts and 93.1% of the votes. With a second Safe (2 of
  3), the two hold 96.5%.
- **Wallet types.** 5 owners are plain EOAs. 3 are EOAs with MetaMask's `EIP7702StatelessDeleGator` and 2 with
  Coinbase's `EIP7702Proxy`, both verified on Sourcify. 2 are ERC-1967 minimal proxies of `CoinbaseSmartWallet`
  (`0x0000…534d`): Coinbase Smart Wallet, now Base Account.
- **Accounts.** 13 rolling, 6 permanent and 2 timed. 4 are empty, including both timed ones, and 1 has under one vote.
  The large Safe has 5 accounts with HYDX in them; 2 owners have 2; 3 owners have only empty ones.
- **Payout address.** The large Safe's payouts go to a separate externally owned account. The others are paid to the
  owner.

### All of Hydrex

123,925 accounts minted, 107 burned, 123,818 left, held by 4,011 owners, with 469.7 million votes.

- **Concentration.** One Safe 1.4.1 holds 59.6% of the votes. It is the address the conduit names as its `treasury`. The
  next two owners hold 1.8% each.
- **Empty accounts.** 117,638 accounts (95%) hold no HYDX, and 1,497 hold under one vote. Owners keep many: one has 500
  accounts, 498 of them empty.
- **Accounts with HYDX in them, per owner.** 2,145 owners have 1, 1,013 have 2, 282 have 3 to 5, 59 have 6 to 20, 7 have
  more, and 505 have none.
- **Lock types.** Permanent locks hold 96.3% of the votes, rolling 3.5%, timed 0.2%. One timed lock has ended with HYDX
  still in it.
- **Delegation.** 3,937 accounts, with 13.1% of the votes, delegate to another address, mostly Hydrex's conduits.

Wallet types of 500 random owners:

| Type                                                | Owners | Their votes |
| --------------------------------------------------- | ------ | ----------- |
| Plain EOA                                           | 259    | 50.4%       |
| EOA with MetaMask's EIP-7702 code                   | 97     | 5.2%        |
| EOA with Coinbase's EIP-7702 code                   | 50     | 3.2%        |
| Coinbase Smart Wallet / Base Account                | 39     | 8.3%        |
| EOA with other EIP-7702 code (Uniswap, Alchemy, …)  | 40     | 0.2%        |
| Hydrex `PartnerEscrow` and an unidentified contract | 14     | 32.6%       |
| Ambire                                              | 1      | 0.0%        |

The 100 owners with the most votes are 3 Safes 1.4.1 (67.6% of their votes), 43 EOAs (13.8%), 23 `PartnerEscrow`
contracts (10.1%), 12 of the unidentified contract (3.0%), 7 Coinbase Smart Wallets, 10 EOAs with EIP-7702 code, one
`PAFAccountUpgradeable` proxy and one Safe 1.3.0.

### What this means for the page

- **Every wallet type matters.** Browser extensions, MetaMask's and Coinbase's EIP-7702 accounts, Coinbase Smart Wallet
  and Safes all hold accounts. Almost 40% of random owners have EIP-7702 code, so batching will often be available.
- **Several accounts at once.** Many owners hold two or more accounts with HYDX in them. Joining several in one step
  matters.
- **Hide empty accounts.** Show a count, such as "3 empty accounts hidden", with a way to show them.
- **Explain statuses, not jargon.** "Lock ended" is rare; "in another automation" is common.

## Wallets

### Connectors

Installed with `npm ci --ignore-scripts`: viem 2.57.7, `@wagmi/core` 3.6.5, `@wagmi/connectors` 8.2.0,
`@coinbase/wallet-sdk` 4.4.0, `@safe-global/safe-apps-sdk` 9.1.0 and `@safe-global/safe-apps-provider` 0.18.6.

- **Packages.** 26 installed, plus esbuild's two. Every SDK is an optional peer dependency of `@wagmi/connectors`, so
  only the ones in `package.json` are installed.
- **Sizes.** A test entry with `createConfig`, the actions the page needs, `injected` from `@wagmi/core`, and
  `coinbaseWallet` and `safe` from their own entry points, bundled by esbuild 0.28.2 with splitting and minification:
  - first load 73.6 KB gzipped;
  - Coinbase's SDK 31.9 KB, loaded only when chosen;
  - Safe's SDK and provider 174 KB, loaded only inside Safe{Wallet}: the provider pulls viem modules the page does not
    use;
  - other lazy chunks of viem and its cryptography, 54 KB, loaded only when needed.
- **Duplicates.** `ox` ships once (0.14.56). `eventemitter3` ships twice: 5.0.1 for wagmi and ox, 5.0.4 for Coinbase's
  SDK.

### Network origins

- **Coinbase's SDK.** Its popup is `https://keys.coinbase.com/connect`, opened with `window.open`, so no frame is
  needed. It calls `https://rpc.wallet.coinbase.com` for `wallet_getCallsStatus` before a session exists. Once connected
  to a smart wallet, it sends other reads to an RPC URL the wallet gives in its handshake; that origin must be confirmed
  with a real Base Account. It was found without one on 2026-10-17: see [Writes](#writes). The Coinbase Wallet app's QR
  flow uses `https://www.walletlink.org` and `wss://www.walletlink.org/rpc`.
- **Coinbase's styles.** That QR flow injects one `<style>` element (`cssReset`) into the page. `style-src 'self'`
  blocks it; a CSP hash of that exact text would allow it and nothing else.
- **Telemetry.** Coinbase's SDK 4.4.0 contains no analytics code. Safe's SDK and wagmi contain none.
- **Safe's SDK** talks only to the parent frame with `postMessage`. It needs no network origin and no `frame-src`.
- **Frames.** None of the three SDKs opens an iframe, so `frame-src 'none'` should do. Confirm in the browser.

### Safe

- **Detection.** The `safe` connector returns no provider outside a frame and gives Safe's SDK 10 ms to answer
  (`unstable_getInfoTimeout`). That may be too short on a slow phone; set it to about a second.
- **Origins.** Safe's SDK accepts messages from any parent unless `allowedDomains` is set. Set it to Safe{Wallet}'s
  origin, `https://app.safe.global`.
- **Batching.** The provider reports `{ atomicBatch: { supported: true } }`, an older shape than EIP-5792's
  `atomic.status`, and viem passes it through unchanged. Accept both.
- **Hashes.** `wallet_sendCalls` returns the Safe transaction hash as the call ID. `wallet_getCallsStatus` reports 100
  until the transaction executes, which may take days. `eth_sendTransaction` also returns a Safe transaction hash.

### Batching elsewhere

- **MetaMask** reports `atomic.status` "ready" for an EOA that has no smart account yet: a batch would ask the user to
  upgrade the account. Recommendation: batch only when the status is "supported", and send one by one when it is
  "ready".
- **Coinbase Smart Wallet** and Base Account support batches.

### Public RPCs

Tested with a browser `Origin` header, a preflight, then a call:

| RPC                                       | CORS | Note                                           |
| ----------------------------------------- | ---- | ---------------------------------------------- |
| `https://mainnet.base.org`                | yes  | rate-limited; refuses large log queries        |
| `https://base-rpc.publicnode.com`         | yes  | no archive reads, which the page does not need |
| `https://base.gateway.tenderly.co`        | yes  |                                                |
| `https://base-mainnet.public.blastapi.io` | yes  |                                                |
| `https://base.meowrpc.com`                | yes  | no `eth_getLogs`                               |
| `https://base.drpc.org`                   | yes  | rate-limited at the time                       |
| `https://1rpc.io/base`                    | yes  | rate-limited at the time                       |

The page reads at the latest block only and needs no logs, so any of these works. Three are enough.

## Hosting

Headers rechecked with `curl`:

- **eth.limo** (`cowswap.eth.limo`) sends `X-Frame-Options: SAMEORIGIN` and
  `Content-Security-Policy: frame-ancestors 'self'`, with `Access-Control-Allow-Origin: *`. Safe{Wallet} could read a
  manifest there but not frame the page.
- **GitHub Pages** (`pages-themes.github.io/minimal`) sends `Access-Control-Allow-Origin: *` and no framing header. Its
  404 pages carry a strict CSP of their own, which does not matter for an existing file.

- **Safe{Wallet}**, opened read-only in Playwright's Chromium for the large Safe with a custom app URL, framed the
  GitHub Pages site and refused `cowswap.eth.limo` with "Refused to frame 'https://cowswap.eth.limo/' because an
  ancestor violates the following Content Security Policy directive: "frame-ancestors 'self'"." Headless Chromium needs
  an explicit `en-US` locale: with the default POSIX locale, Safe{Wallet} crashes on `Intl.NumberFormat`.

Milestone 5 tests the page itself inside Safe{Wallet}.

## Writes

Checked for the wallet milestone on 2026-10-16, on Base at block 52,694,000 and on an anvil fork of it.

- **Members.** 22 accounts, held by 15 owners.
- **Leaving resets, whatever it names.** `setConduitApproval(conduit, tokenId, false)` sets the delegate back to the
  owner and clears the claim redirect for any active conduit, whether or not that conduit holds them. Sent after a join,
  it would undo the join.
- **Joining from another automation.** Joining sets the delegate and the claim redirect, so it replaces another
  automation's hold on both. Only Hydrex Lock Maxi holds more: an ERC-5725 claim approval (action 1), which joining
  leaves in place. That approval allows nothing in the VotingEscrow today: its `claim`, which takes the HYDX out of a
  timed lock, accepts only the owner and ERC-721 approvals. The fork tests show it.
- **Two errors.** The approval logic reverts with "Invalid conduit type" for an inactive conduit and "Not token owner"
  when the sender does not own the account.
- **The payout address.** `setMyPayoutRecipient(address)` stores any address for the sender and never reverts. The zero
  address means the owner itself.
- **Simulation.** `eth_simulateV1` runs calls one after the other, each on the state the one before left.
  `mainnet.base.org` and `base-rpc.publicnode.com` serve it; `base.drpc.org` was rate-limited. Anvil 1.5.1 serves it
  too.
- **Old state.** `mainnet.base.org` serves it, so a fork can be pinned to a block without a private RPC. Publicnode asks
  for a token.
- **Gas depends on the time.** The VotingEscrow's checkpoints make the gas of a join or a leave depend on the block's
  time. Base estimated 347,115 gas to take #2439 out of USDC. Anvil estimates at another time than it mines at, and its
  estimates fell up to 16% short, so the fork tests' wallet sets a fixed limit.
- **Coinbase's SDK 4.4.0** adds three style elements, for the Coinbase Wallet app's QR code, its snackbar and its
  redirect dialog; the page's policy allows them by their hashes. It sends a `HEAD` request to the page's own URL to
  read its `Cross-Origin-Opener-Policy`, so `connect-src` includes `'self'`. It has no telemetry. Once a smart wallet is
  connected, it sends `wallet_getCallsStatus` and other reads to the RPC that keys.coinbase.com names for the session.
  keys.coinbase.com builds it from the chains `api.wallet.coinbase.com/rpc/v3/scw/getSupportedChains` lists, as
  `https://chain-proxy.wallet.coinbase.com/?targetName=base` for Base. Checked on 2026-10-17, without an account: that
  proxy answers chain `0x2105`, allows any origin, and knows `wallet_getCallsStatus`. The page's policy allows it;
  should a status still not come, the page says the batch was sent.
- **Sizes,** gzipped: the first load is 23.5 KB, up from 18.9 KB. Coinbase's SDK is 37.5 KB, loaded only when someone
  picks it, and Safe's 17.0 KB, loaded only in a frame. With esbuild's splitting, the parts of viem that the page and
  Coinbase's SDK both use went into a chunk on the first load, 38 KB in all, so each SDK is now built on its own.

### Safe{Wallet}

Checked on 2026-10-17 in Playwright's Chromium, with Safe{Wallet} at `app.safe.global` opened read-only for the large
Safe on Base, and this build served as `https://metadex.cafe/`:

- **As a Safe App.** The page connected to the Safe on its own and showed its 8 accounts with HYDX. Leaving with #48803
  was checked against Base from the Safe's address. "Propose in Safe{Wallet}" opened Safe{Wallet}'s "Confirm
  transaction" with the decoded call, `setConduitApproval` on Hydrex's VotingEscrow with the automation, 48803 and
  `false`, "No balance change", and 0 of 3 confirmations. Nothing was signed. Discarding it answers "Transaction was
  rejected", which the page shows as a refusal.
- **The manifest.** A link with `appUrl` opens an app that is not in Safe{Wallet}'s list behind a warning, without
  reading the manifest; its transactions then say "unknown". "Add custom Safe App" reads `manifest.json` and `icon.svg`
  and shows the name and description.
- **Safe's provider package,** `@safe-global/safe-apps-provider` 0.18.6, is CommonJS. Bundled, it pulled the CommonJS
  build of Safe's SDK and all of viem: 189 KB gzipped. It also has no `eth_requestAccounts`. The page answers its four
  requests itself over the SDK: `eth_accounts`, `eth_chainId`, `wallet_getCapabilities` and `wallet_sendCalls`, which
  returns the Safe transaction's hash.
- **Safe's SDK** talks only to the parent frame, and the page accepts answers only from `https://app.safe.global`. It
  re-exports types from Safe's gateway package, whose request code is bundled but never called.
- **Simulation from a Safe.** `mainnet.base.org` and `base-rpc.publicnode.com` both run calls from the Safe's address.

## Polish

Checked for milestone 6 on 2026-10-17. The build ran in Playwright's Chromium against an anvil fork of block 52,694,000,
at 320, 390 and 1440 px, light and dark.

### States

Every state was opened and looked at:

- loading, with no RPC answering, and with a failed check;
- the wrong network, and a Safe on another network;
- no wallet, and a wallet's prompt left open;
- no account, and empty and ended accounts, with every status;
- the review while checking, failing, sending, between transactions and done;
- a refusal, and a Safe's proposal.

Fixed:

- **The review's status was out of sight on a phone.** "Checked ✓", "Transaction 1 of 2 is included" and "Done." sat
  under the calls, behind the pinned buttons, so after a join a phone showed only "Close". The status lines are now
  pinned with the buttons, except on screens less than 30rem high.
- **"Switch to Base" could fail silently.** A wallet that cannot switch now gets "Your wallet did not switch. Pick Base
  in your wallet itself."
- **A wallet's prompt gave no sign.** While it is open, the page says "Waiting for … to answer…".
- **The page stood still.** The countdown never moved, and a page left open across the flip kept the old epoch. It now
  moves every half minute, and reads the automation and the accounts again when an epoch ends.
- **The minter's lag.** A join sent between Thursday 00:00 UTC and the minter's move counted, on the review, from that
  same Thursday; see [Timing](#timing).
- **No account.** A wallet with no HYDX in any account gets a link to lock HYDX on Hydrex, and no payout address.

### Accessibility

- **axe-core 4.14,** with WCAG 2.2 AA and best practices, found nothing in any of those states, light or dark, once the
  page set its own background. Without one, axe read the dark page as white and flagged every link.
- **Contrast.** The lowest pair of text and background is a link on a notice, 5.3:1 in the light theme. Field edges are
  3.4:1 or more.
- **Focus.** The review gives the focus to its title, so a screen reader starts at the top rather than on the link to
  Hydrex.
- **Targets.** Each account's row is the label of its box, so tapping anywhere on the row ticks it.
- **Live regions.** "Reading the accounts…" and "Waiting for … to answer…" are announced.

### Browsers inside wallets

Wallet apps show pages in the system's web view: on iOS, WKWebView, which follows the iOS version; on Android, the
WebView that Google Play updates. Almost every phone has a recent one. The exceptions are iPhones that stopped at iOS 15
or 16, the iPhone X and older, and Android 7, whose WebView stopped at Chrome 119.

- **Too new.** The page used `Intl.DurationFormat`, which came late: Safari 16.4 (March 2023), Chrome 129
  (September 2024) and Firefox 136 (March 2025). It threw as the script loaded, so a Chrome or Firefox a year or two old
  showed "…" everywhere. The countdown now uses plural rules instead.
- **Kept as they are** ([decision 25](#decisions)): `light-dark()` (Safari 17.5, Chrome 123, Firefox 120),
  `AbortSignal.timeout()` (Safari 16, Chrome 103, Firefox 100), ARIA reflection (Firefox 119) and `:has()` (Safari 15.4,
  Chrome 105, Firefox 121). Older browsers lose the controls' colours, the reads, a box's spoken label or the accounts'
  layout. The phones among them are from 2017 or before.
- **A wallet that only sets `window.ethereum`,** as some in-app browsers do, shows as "Browser wallet" and connects.
- **Not tested:** WebKit itself, and real wallet apps.
- **Size.** With the code review's fixes, the first load is 24.5 KB gzipped, up from 23.7 KB; the two SDKs are
  unchanged.

### Code review

A review of this milestone's diff, on 2026-10-17, found these, now fixed:

- **Two clocks.** The page saw a new epoch by the device's clock but read it from Base's, so an RPC a few seconds behind
  at the flip left the page in the old epoch for a week. The page now keeps Base's time, from the latest block it read,
  and waits a minute into a new epoch, when every RPC has its blocks, before reading again. Until a read answers from
  the new epoch, it tries again every half minute. The checks also run again then, and every hour.
- **A lock was a disconnection.** A wallet that locks shares no account, and the page used to forget it and revoke its
  own permission, so the next visit asked to connect again. It now lets go of the wallet on the page only, and connects
  again once the wallet shares an account. Only Disconnect forgets it.
- **A connection could be overwritten** by an older attempt that answered late. Only the latest attempt connects now.
- **Closing a review stopped the following,** so the accounts were read before Base included what was sent. The page now
  follows it in the background for ten minutes, and reads the accounts once it is included. When it cannot know, it
  reads them again every 15 seconds for five minutes.
- **Smaller ones.**
  - A click on a row whose box was hidden ticked that box; hidden boxes are now disabled.
  - A lock that ended after its box was ticked could open an empty review.
  - The review's "Switch to Base" had no busy state and left the page's notice in place.
  - A join named only the automation that held the votes, not the one that held the claims.
  - A fork test checked a box that could never show.

### Cold read

The method of [earlier-design.md](earlier-design.md#cold-read): fresh readers, with no context, saw the page on arrival,
with a wallet and two accounts ticked, the join's review, its end, the page after it, a member's page and the review of
a leave. One reader saw them at 1440 px, the other at 390 px. Both answered what the page does, what joining changes,
when, how to leave, what the statuses mean and what the wallet will ask, then listed what tripped them.

**Round one.** Both got the purpose, the timing, how to leave and every status right. What tripped them, and the fix:

- **"Until then you can't vote with them yourself"** read as a limit that ends on Thursday. Now "While they are in, you
  can't vote with them yourself."
- **"Joining and leaving count from the next epoch"** clashed with claims "from the moment it joins". Now "Joining or
  leaving moves an account's votes from the next epoch, and its rewards at once."
- **"To keep them as they are"** hid what happens otherwise, and left this epoch's rewards out. Now the rewards "you
  have not claimed yet, and this epoch's once the epoch ends" are "swapped and retired like the rest".
- **Who runs it,** and who can change its settings? Now the lead says what the automation does every epoch, and that one
  admin key controls its settings. The automation itself claims the rewards.
- **Who votes after a leave,** until Thursday? The leave now says that the votes count for the automation until then.
- **"Joining moves it"** out of another automation said nothing of leaving it. Now "Joining takes it out of that
  automation and into the Carbon Impact automation."
- **Is `0xdE91…` the automation?** The review now says so under the calls.
- **The join's review left out the share retired and the admin key's powers,** and on a phone people tap Join before
  reading "What joining allows". The review now says what each payout does, the share retired, and that the admin key
  can change it and the payout address.
- **"The fee (up to 1%)":** a fee on what? Now "its fee on the payouts".

Not changed: kVCM and Hydrex's account kinds stay without a gloss ([decision 16](#decisions)); the numbers of an
account's unclaimed rewards and of past payouts stay [open](#decisions); who publishes the page is for the user to say.
Both readers would try a small account first, and asked for safeguards on the admin key, which the page cannot give.

**Round two,** on the revised page, with two new readers. Both again got all of it right, among it that they cannot vote
with an account while it is in, and that this epoch's rewards go too. Fixed after it:

- **"Moves an account's votes from the next epoch"** read as taking votes away. Now "A join or a leave changes who votes
  with an account from the next epoch, and who can claim its rewards at once."
- **"Nothing is transferred"** clashed with rewards being claimed and swapped. Now the HYDX and the account stay where
  they are: "Neither is transferred."
- **Rewards from an epoch the automation did not vote in** seemed a contradiction. They are now "even those your own
  votes earned".
- **"Put #141 in the Carbon Impact automation"** sounded like a transfer, and the review did not say that #42877 left
  Liquid Hydrex. The steps now say "#141 joins the Carbon Impact automation" and "#42877 leaves the Liquid Hydrex
  automation and joins the Carbon Impact automation".
- **The review named two of the automation's settings** where the page names five. It now adds "and its other settings".
- **Smaller ones.** "Earning Power this epoch" was nobody's; it is now "Its Earning Power this epoch". "The address
  itself" is now "your own address". The admin key can change a payout address "as it can any owner's".

**Round three,** with two new readers. Both again got all of it right. Fixed after it, without a fourth round:

- **Could they still vote** between joining and Thursday? Now "Once the account joins, you can't vote with it yourself,
  until the epoch after it leaves", and the next epoch is named by its date rather than "Thursday".
- **"At once"** could cover both votes and rewards. The sentence now gives the claims first, "right away", then the
  votes.
- **"The calls allow voting and claiming, nothing else"** sounded too reassuring next to the admin key. Now "The calls
  let the automation vote and claim, nothing more."
- **The bold warning about rewards** took three reads. It now stops at "even those your own votes earned", and the next
  sentences say which and how to keep them.
- **"Each call was run against Base"** sounded as if it had been sent. Now "tried on Base from your address, without
  sending it".
- **Smaller ones.** "Joined" now says the automation can claim already. The lead names the share retired. "In these
  calls" is "In this call" for one call. "The payout tokens" is now "the tokens it pays out in".

Across the three rounds, all six readers got the purpose, the timing, how to leave and the statuses right. None would
join with their main account yet: all six named the admin key, which can redirect payouts and retire up to 100%, and
most asked how much they had not claimed and who publishes the page.

## Decisions

Taken by the user on 2026-10-15, after this research:

1. **Direction A, "Guide".** One column read from top to bottom, around the week. The user first chose Direction B, then
   switched after seeing both again. Its look was dropped later; see decision 9.
2. **kVCM only.** The Carbon Impact automation pays in kVCM only: the keeper swaps every reward into kVCM, although the
   conduit could also pay AZUSD.
3. **One vote shown.** The page shows the keeper's vote just before the week ends and never its Tuesday vote: no marker
   on the week, no date for the first vote with a new account, and the latest vote is labelled "last week" or "this
   week". Decision 14 adds its time.
4. **Payouts right after the flip.** The keeper claims and pays right after each week ends, on Thursday at 00:00 UTC.
   The page says so.
5. **Upgrade pins.** The startup checks also pin the VotingEscrow's implementation and its approval logic, by address
   and code hash. An upgrade of either turns writes off until `relays.json` is updated.
6. **Names.** The product was first "metaDEX Relays", in a repository named `metadex-relays`. On 2026-10-16 the user
   named both after the domain: `relays.metadex.cafe` at first, then, the same day, `metadex.cafe`. Later that day the
   user named the product metaDEX Café; the domain, the repository and the package keep `metadex.cafe`.
7. **GitHub Pages.** It is published on GitHub Pages. First planned at a `github.io` address, it is served at
   `https://metadex.cafe/` since 2026-10-16.
8. **Earning Power, like Hydrex.** The page shows votes × 1.3 and says so once. Vote shares are unaffected.
9. **A plain page.** After seeing the read-only page, the user asked for the simplest CSS, even at the cost of the
   visual identity. The page is now headings, paragraphs, tables and lists in the browser's own style, light or dark as
   the reader's system is set. The week track, the vote bars, the cards, the icons and Direction A's colours are gone.
   The mock-ups were removed later.
10. **No page for Safe proposals.** A Safe proposes and its owners sign in Safe{Wallet}; the page does not follow the
    proposal.
11. **"The Carbon Impact automation".** Sentences name the conduit "the Carbon Impact automation", never just "Carbon
    Impact".
12. **Styled controls.** The controls keep a functional style, in Direction A's teal for both themes: buttons with a
    filled main action and 44 px targets, a 16 px address field with its error state, larger checkboxes with the
    selected row tinted, focus rings, links and boxed alerts.
13. **A minimal repository.** On 2026-10-16 the user asked for the smallest repository. Removed: the mock-ups, the
    hallway-test script, the dependency report for lockfile changes, `scripts/members.ts`, the size budget, the test for
    invisible characters, the development server, and the wallet packages and CSP origins that nothing uses yet. This
    file lost its sections on personas, Hydrex's app, other relays, comparable interfaces and design checks.
    [earlier-design.md](earlier-design.md) keeps the removed text and the wallet set-up.
14. **The vote's time.** On 2026-10-16 the user read "Last week" for a vote cast three seconds before the flip, when it
    was already Thursday in their time zone. The latest vote now also gives its time and how long before the epoch's end
    it was cast.
15. **No "0%" fee.** When the automation takes no fee, the payouts row says only "kVCM", and what joining allows says
    "It takes no fee today". A fee shows only when there is one.
16. **UTC and epochs.** Later that day the user asked for UTC everywhere for now, so the page gives no time in the
    reader's time zone, and for "epoch" rather than "week", as Hydrex says. kVCM needs no gloss, and every address the
    page shows links to its page on Basescan.

17. **No wagmi.** On 2026-10-16 the user confirmed that the page finds wallets with EIP-6963 and talks to them with
    EIP-1193 requests, without wagmi. Its runtime packages are `viem`, `@coinbase/wallet-sdk` and, since milestone 5,
    `@safe-global/safe-apps-sdk`.
18. **Leaving stays on** when a startup check fails: it only takes the account away from the automation. Joining and
    changing the payout address stay off.
19. **The wallet sets the gas.** The page sends no gas limit.
20. **Join directly.** The same day, the user agreed that an account in another automation joins without first being
    taken out of it. The join replaces where its votes and claims go; taking it out first only cleared Lock Maxi's claim
    approval, which the VotingEscrow does not use, at the cost of one more transaction without batching.
21. **Leave with several.** Also that day: a box beside every account that can join or leave, with "Join with N
    accounts" and "Leave with N accounts" under the list, each one transaction where the wallet batches. The large Safe
    can leave with its five accounts in one Safe transaction rather than five.
22. **A click per transaction.** On 2026-10-17, after a code review, the user agreed that a wallet without batching
    sends each transaction from a click of its own: "Confirm transaction 2 of 3" once the one before is included. A
    wallet that opens a window, such as Coinbase's, can only open it from a click, and closing the review between
    transactions plainly stops there.
23. **No address look-up.** Later that day, the user dropped the field that showed any address's accounts: the page
    shows the accounts of the connected wallet, and before a wallet connects, only the automation and the epoch.
24. **"Browser wallet" without a wallet.** Also that day: when no wallet announces itself and `window.ethereum` is
    empty, the page still offers "Browser wallet". Picking it says that no wallet was found, how to get one, and that
    Coinbase Wallet works without one.
25. **Minimal code over old browsers.** Later that day, after the polish, the user chose to keep the code minimal rather
    than support browsers from before 2022 to 2024. The page does without `Intl.DurationFormat` only, which Chrome and
    Firefox gained in 2024 and 2025.
26. **The smallest attack surface.** On 2026-10-17 the user asked for the code to be cut back to the smallest attack
    surface. Kept, by the user's choice: the Safe App, the EIP-6963 wallet picker, account names, other automations'
    names, the three RPCs and the switch to Base. Removed: Coinbase's SDK, with its four origins, the page's own origin
    and three style hashes in the policy; batching for wallets other than a Safe; the payout address form and
    `setMyPayoutRecipient`; the latest vote and its split, which read symbols from any pool and token; the check of the
    calls with `eth_simulateV1`; and remembering the wallet, reconnecting to it and Disconnect. With them went the
    page's own clock, the countdown and moving on to a new epoch by itself, and the reads every 15 seconds after a
    transaction the page could not follow. The policy now requires Trusted Types.
27. **Refactored, with few comments.** The same day, the user asked for the code to be refactored for style, simplicity
    and duplication, keeping only plain comments for what the code cannot say. `src/abi.ts` and `src/calls.ts` went into
    `src/hydrex.ts` and `src/chain.ts`, and their tests into `test/hydrex.test.ts`.
28. **Fingerprinted files.** Then the user asked for best practice, such as no inline CSS and fingerprinting. The page
    had no inline CSS already. The build now names the scripts, the stylesheet and the icon after a hash of their
    content, minifies the stylesheet, and puts Subresource Integrity hashes on the script and stylesheet tags.
29. **One checked script.** Then the user had Safe's SDK bundled into the script, so that the integrity check covers it,
    and the hashed names dropped, as their only use was to keep a cache from pairing files of two versions. For up to
    ten minutes after a deployment, a browser holding the previous script refuses it instead.
30. **After two code reviews.** The user kept the ten minutes after a deployment, and had Trusted Types removed: they
    apply to wallets' scripts in the page too, and could break a wallet, while the page's own code writes no HTML. The
    page keeps Base's time again, so that a lock that ends while the page is open cannot join, and reads again when Join
    or Leave is clicked in a new epoch.

Still open: how much an account has not claimed yet. It would need reads of every bribe the account earned in; it is
left for later.
