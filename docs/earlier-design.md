# Earlier design

On 2026-10-16 the repository was made minimal ([decision 13](research.md#decisions)), then its history was squashed.
This file keeps the design text and the wallet set-up that were removed then, copied from the last commits that had
them. It describes the page as it was designed, with joining and leaving, not as it is today. Some names are from then:
the product was "metaDEX Relays", the page trusted `src/relays.json`, and `#0x…` in the address showed an address's
accounts.

Not copied: the two HTML mock-ups of Directions A and B, `scripts/members.ts`, which took the members snapshot in
[research.md](research.md#who-uses-it), the size budget script, and the dependency report's script and workflow.

## The page as designed

A static page where holders of vote-escrowed accounts on metaDEXes hand their votes and rewards to a relay, and take
them back. Version 1 supports one relay: Hydrex's "Carbon Impact" automation on Base, whose votes Klima's keeper,
[hydrex-keeper](https://github.com/ldeso/hydrex-keeper), casts. The page runs in the browser, from GitHub Pages or
inside Safe{Wallet} as a Safe App, and talks only to public Base RPCs and the user's wallet.

### What the page can and cannot do

- **It shows any address read-only.** `https://metadex.cafe/#0x…` lists the accounts of that address, with where each
  stands and where its payouts go, without a wallet.
- **It sends three calls only:** `setConduitApproval(conduit, tokenId, true)` to join, the same with `false` to leave,
  and `setMyPayoutRecipient(address)` on the Carbon Impact automation. It simulates each one from the owner's address
  before asking the wallet, and sends nothing that fails.
- **It holds no key and has no server.** Every action ends in a wallet prompt that shows the exact call and the site
  asking for it.
- **It checks the relay before allowing writes.** The chain ID, the automation's VotingEscrow and Voter, its approval
  config (`[3, 5]`, active) and its code hash must match `src/relays.json`, and so must the VotingEscrow's
  implementation and approval logic, with their code hashes. Otherwise writes to that relay stay off and the page says
  why.
- **It cannot stop copies.** Anyone can host a changed copy, for example with another payout address. Use the official
  address, and read the wallet prompt.
- **It looks plain on purpose.** The page is headings, paragraphs, tables and lists in the browser's own style, light or
  dark as the reader's system is set. Only the controls are styled, in one accent: buttons, the address field,
  checkboxes and the selected row, focus rings, links and alerts.

### Failure modes

These describe the finished page.

- **Base RPC:** a read that fails goes to the next RPC. If none answers, the page says so and offers to retry.
- **A failed startup check**, or one that cannot run, turns writes to that relay off. The page says why and offers to
  run the checks again.
- **The wrong network:** the main button becomes "Switch to Base".
- **Coinbase's SDK failing to load** affects only Coinbase Wallet; other wallets keep working.
- **A Safe** proposes the transaction instead of sending it, and its other owners sign it in Safe{Wallet}. The page has
  no view of its own for proposals: the statuses change once the transaction executes.

## Wallet set-up

### Packages

Every package is pinned to an exact version and installed without running its scripts. The runtime packages are `viem`,
`@wagmi/core`, `@wagmi/connectors`, `@coinbase/wallet-sdk`, `@safe-global/safe-apps-sdk` and
`@safe-global/safe-apps-provider`.

The versions, in `package.json`'s `dependencies`:

```json
"dependencies": {
  "@coinbase/wallet-sdk": "4.4.0",
  "@safe-global/safe-apps-provider": "0.18.6",
  "@safe-global/safe-apps-sdk": "9.1.0",
  "@wagmi/connectors": "8.2.0",
  "@wagmi/core": "3.6.5",
  "viem": "2.57.7"
}
```

### Network origins

The page's Content Security Policy allows these origins and nothing else:

| Origin                                                   | Why                                                              |
| -------------------------------------------------------- | ---------------------------------------------------------------- |
| `https://mainnet.base.org`                               | Base RPC, for reads                                              |
| `https://base-rpc.publicnode.com`                        | Base RPC, for reads                                              |
| `https://base.drpc.org`                                  | Base RPC, for reads                                              |
| `https://rpc.wallet.coinbase.com`                        | Coinbase's SDK: call status before a smart-wallet session exists |
| `https://www.walletlink.org`, `wss://www.walletlink.org` | Coinbase's SDK: sessions with the Coinbase Wallet app on a phone |

Coinbase's smart wallet opens `https://keys.coinbase.com` in a popup, which needs no entry. Safe's SDK talks to
Safe{Wallet} through the frame and needs none either. No fonts, images, scripts or styles come from elsewhere.

The Content Security Policy in `index.html` was:

```text
default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src https://mainnet.base.org https://base-rpc.publicnode.com https://base.drpc.org https://rpc.wallet.coinbase.com https://www.walletlink.org wss://www.walletlink.org; frame-src 'none'; base-uri 'none'; form-action 'none'
```

### Write calls

The ABIs had the two functions the page would call. On the VotingEscrow:

```text
function setConduitApproval(address conduit, uint256 tokenId, bool approve)
```

On the Carbon Impact automation:

```text
function setMyPayoutRecipient(address newRecipient)
```

### Build

`npm run build` wrote the page to `dist/`. esbuild bundled `src/main.ts` and split the wallet SDKs into chunks of their
own, so Coinbase's SDK loaded only when someone picked Coinbase Wallet, and Safe's only inside Safe{Wallet}.

`scripts/build.ts` gave esbuild these options:

```ts
export function options(version: string, commit: string): esbuild.BuildOptions {
  return {
    absWorkingDir: ROOT,
    entryPoints: ["src/main.ts"],
    outdir: OUT,
    bundle: true,
    splitting: true,
    format: "esm",
    target: "es2022",
    platform: "browser",
    minify: true,
    charset: "utf8",
    legalComments: "linked",
    entryNames: "[name]",
    chunkNames: "chunks/[name]-[hash]",
    define: { BUILD_VERSION: JSON.stringify(version), BUILD_COMMIT: JSON.stringify(commit) },
    logLevel: "warning",
  };
}
```

### Checks on the packages

`npm run budget` printed every file's gzipped size and failed if the first load passed 90 KB or `style.css` passed 10
KB.

CI ran the budget after the build. A pull request that changed `package-lock.json` got a report of the shipped packages
that changed, the chunk sizes and the dependency tree before and after, and the diff of every wallet SDK that changed,
which a human read before merging.

## Personas

### Ana, the signer of the large Safe

Ana is one of five signers of a Safe that holds 93% of Carbon Impact's votes, in five accounts. Three signatures are
needed. Payouts go to a separate address the team chose.

- **She wants** to check that all five accounts are in, that payouts go to the right address, and what the conduit may
  do with the rewards.
- **She opens** the page inside Safe{Wallet}, from a link a colleague shared. She proposes; others sign later.
- **She worries** about signing something she cannot read, about who can change the settings, and about a copy of the
  page with another payout address.
- **She needs** the exact calls before she proposes, one Safe transaction for several accounts, a clear "waiting for 2
  more signatures", and a page that re-reads the chain once the transaction executes.

### Ben, a Hydrex user with a few accounts

Ben locked HYDX on Hydrex and holds a Protocol Account and two Flex Accounts in MetaMask. He was in an automation and
saw "Automations ended". A friend sent him this page.

- **He wants** his accounts to keep earning without voting every week, and to know what he gives up.
- **He uses** MetaMask on his phone, often in its in-app browser.
- **He worries** that his HYDX could leave his account, that he cannot get out, and that fees are hidden.
- **He needs** plain statuses per account, one button for the accounts he picks, when it starts counting, and how to
  leave.

### Chloé, a Base Account user

Chloé uses a Coinbase Smart Wallet, now Base Account, through Coinbase's popup. She has one small Flex Account.

- **She wants** to join in one step and see the payout token.
- **She uses** a passkey, not an extension, on a phone.
- **She needs** the Coinbase Wallet button to reach her smart wallet, batching where her wallet offers it, and words
  that do not assume she knows what delegation is.

## Hydrex's app

Opened in Playwright's Chromium at 390, 768 and 1440 px, signed out and signed in with a test wallet that claims a
member's address, answers reads through a public RPC and rejects every signature.

### Vocabulary

- **Accounts.** "Accounts" with tabs All, Flex, Protocol, Liquid. "Protocol Account" for a permanent lock, "Flex
  Account" for a rolling or timed one, "Liquid Account" for liquidity. "Account #67491", or the name the owner gave.
- **Numbers.** "Earning Power" for Protocol Accounts, but "Value" in dollars for Flex Accounts. "This Week's Earning
  Power", "Next Week's Earning Power", "Estimated Earning Power Value".
- **Status.** A green dot and "Earning".
- **Automation.** Tabs Account, Automate, Manage, Earnings. "Automate", "No Automation" ("Manage Myself"), "Total
  Automated Payouts", "Next Payout" with a countdown to the flip, "Yield breakdown kVCM · 60% AZUSD · 40%", "Carbon
  Impact Protocol Account" as the subtitle of an account in the conduit, and an "Auto" badge.
- **Timing.** "You won't earn for the current epoch, but will start earning weekly from the next epoch."
- **Fees.** "Automation Strategies take a 0.5% fee on earnings to cover gas." Carbon Impact's fee is 0% on chain.
- **The old conduit card.** "Carbon Impact allocation: Part of the value from this automation supports Klima Protocol's
  voluntary carbon offset program."
- **Empty accounts.** A setting: "Hide 0 earning power veTokens".

### Layout and look

- **Layout.** A top bar with Trade, Accounts, Earn, Vote, Launch and Analytics, and a bottom tab bar on phones. Account
  cards in a row; extras hidden behind "See 5 more". Account details in a modal, a bottom sheet on phones.
- **Look.** White ground, Base blue `#0052FF` for buttons, pill-shaped buttons, the Satoshi web font, line
  illustrations, pastel blobs behind icons.
- **Dark mode.** A switch in the footer. The app ignores the system setting.
- **Network.** Signed in, one page load contacted 25 origins: several RPCs, Coinbase's CDP and analytics, WalletConnect,
  web3modal, spindl, Google Analytics and Tag Manager, Cloudflare Insights, jsDelivr and Google Fonts.

### What confuses

- **Two numbers for one thing.** Earning Power on Protocol Accounts, dollars on Flex Accounts, and votes elsewhere.
- **"Next Payout"** counts down to the flip, whether or not anything will be paid.
- **The automation status** is a subtitle ("Carbon Impact Protocol Account") and a small "Auto" badge.
- **The 0.5% fee** note sits under every automation, although Carbon Impact charges none.
- **Joining's effect on past rewards** is not mentioned.

### Docs, forum and channels

- **docs.hydrex.fi** defines Earning Power as the measure of fee share and votes, "calculated based on lock amount and
  duration". It calls automations a way to "set voting preferences, compound rewards automatically" and "manage your
  position with minimal manual intervention".
- **governance.hydrex.fi** asks for a signed entry message from a wallet with at least 100 Earning Power. It was not
  read.
- **Public discussion** is thin. The words users use are Earning Power, Protocol Account, Flex Account, permanently
  locked, claim, bribe. The worries are whether a step is one-way, whether funds can be withdrawn, and whether fees are
  shown accurately.

## Aerodrome's and Velodrome's relays

Read from their contracts (`aerodrome-finance/contracts`, `velodrome-finance/contracts`, and their `relay` repositories,
whose `src/` trees are identical), their deployed Voters on Sourcify, and their apps with a read-only test wallet.

### They end next week

The Aero upgrade guide (aero.xyz/aero-upgrade) says that all veNFTs should be withdrawn from relays and other vaults by
20 October. Aero launches on 22 October at 00:00 UTC: all gauges are deactivated, veAERO and veVELO upgrade to sAERO,
and "Your veNFT is retired during the upgrade". Relays become "Autopilot", whose contracts are not public yet. Two Klima
relays exist on Aerodrome: "KLIMA veAERO" and "Balanced Klimate veAERO".

So the next relay this page may support is Autopilot or another protocol's, not today's Aerodrome relay. The shared
types should describe an account handed to an automation in general terms, and nothing should be built for managed
veNFTs.

### How their relays work

- **Join:** `Voter.depositManaged(tokenId, mTokenId)`, sent to the Voter, by the owner or an approved address. The
  user's lock is emptied and marked `LOCKED`: it stays in the wallet but cannot be transferred, merged, split, extended,
  topped up or used to vote. Its whole locked amount goes into the relay's permanent lock.
- **Old votes:** the deployed Voters do not clear the lock's earlier votes, so Aerodrome's app asks for a `reset`
  transaction first. Joining takes one or two transactions.
- **Windows:** no join in the first or last hour of an epoch, nor in an epoch in which the lock already voted or
  deposited. No leave in the epoch of the join, nor in the first hour of any epoch.
- **Leave:** `Voter.withdrawManaged(tokenId)`. The same token comes back as a new four-year decaying lock holding the
  deposit plus its share of the compounded tokens. A permanent lock comes back as a decaying one. A leave fails while
  any gauge the relay voted for is killed, until the relay votes again.
- **Rewards:** compounded tokens are shared by balance at the end of each epoch. Leaving mid-epoch gives up that epoch's
  share.
- **One relay per veNFT.** A wallet's different veNFTs can sit in different relays.

Hydrex's conduit differs: one call to the VotingEscrow, no time window, the lock unchanged, an exit no gauge can block,
and rewards paid out rather than compounded.

### Their app

- **Words:** "Relays", "Deposit Lock", "Withdraw Lock", "Compounded rewards", "Updated 2 days ago" for the keeper's last
  run, "Relay Retired", "Withdraw available after first epoch".
- **Cards:** the name, the managed token ID, "Voting Power 50.86M ~ 4.9%", "Rewards AERO" and the APR.
- **Consent:** "Deposit lock" stays disabled until the user ticks "I understand that by depositing my Lock into a Relay
  strategy, the Lock unlock date will be extended to 4 years."
- **Leaving:** the deposit row under each card carries "Withdraw Lock", or "Withdraw available after first epoch".
  Rewards not yet compounded are listed, with a box to tick before withdrawing.
- **Signed out,** the relay pages show nothing.

### What a second kind would need

A managed-veNFT relay, or anything like it, needs from the shared code what Hydrex's conduit does not:

- **Steps, not a call.** A join or leave is a list of one to n transactions, possibly batched.
- **Windows.** "Allowed now" or "blocked until <time>, because <reason>", shown as a countdown.
- **A lock change.** What the account looks like before and after: a four-year relock, a lost permanent flag, a
  compounded amount.
- **Membership.** Which relay holds the account, since when, and when it may leave.
- **Relay identity.** The chain, the contracts, the payout token, retired or not, and when its operator last ran.
- **Consent per kind.** The sentence the user must accept, if any.

## Comparable interfaces

From Aerodrome, Convex, Beefy, Rabby, Coinbase's popup, Safe{Wallet}, Uniswap and RainbowKit:

- **Say what it does not do.** Convex: delegation "does not transfer your CVX … or give the delegate wallet control".
- **Say when it takes effect.** Convex: "take effect starting the next epoch". Aerodrome: "Withdraw available after
  first epoch".
- **State the commitment first.** Convex: "Lock CVX for 16 weeks + 6 days", and "irreversible" before the button.
- **Explain a block and its end.** Beefy: "Deposits will resume automatically in {{timeLeft}}". Aerodrome: "Lock needs a
  reset to continue", with the reset button inline.
- **Show the operator's freshness.** Aerodrome: "Updated 2 days ago". Beefy: "Last harvest 6 hours ago". This page has
  the keeper's latest vote.
- **Put leaving on the row.** Aerodrome's deposit row carries the withdraw action and its state.
- **Count the transactions and show progress.** Convex: "1 Approve → 2 Lock CVX". Beefy: "{{currentStep}} / {{totalTxs}}
  Transaction confirmed".
- **End with what happened and where to manage it.** Aerodrome: "Your lock has been deposited", a link to the
  transaction, "Manage locks".
- **Name each fee and who gets it.** Beefy and Convex both itemise.
- **Wallets show little for a call like ours.** Rabby shows "Contract Call", the decoded operation and "No balance
  change". Coinbase's popup centres on asset changes. Safe asks signers to check To, Value, Data and Operation. The page
  must say in plain words what `setConduitApproval` does, and show the same function and arguments the wallet shows.
- **Wallet pickers** list the wallets they detect first, by name and icon: "Installed" in RainbowKit, "Detected" in
  Uniswap. Aerodrome's generic "Browser Wallet" did not list the test wallet.
- **Wrong network:** the main button becomes the fix. Beefy: "Switch to {{network}}". RainbowKit adds copy for wallets
  that cannot switch: "Try switching networks from within your wallet instead."
- **Coinbase's popup** opens only from a click, with no waiting between the click and the request, and breaks under
  `Cross-Origin-Opener-Policy: same-origin`. So the page simulates before the confirm button, and the confirm click
  sends at once. GitHub Pages sets no such header.

## Design checks

### Nielsen's heuristics

Both directions were checked against Nielsen's ten heuristics. They share the same content, so the findings are the
same.

| Heuristic                      | How the mock-ups meet it                                                                                 | Still to do                                 |
| ------------------------------ | -------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| Visibility of system status    | A status per account from the chain; the week with "now"; "Simulated ✓"; "1 of 3 signatures"             | Loading, an unreachable RPC, a stale epoch  |
| Match with the real world      | Hydrex's words: Protocol Account, Flex Account, automation                                               | "Votes" differ from Hydrex's Earning Power  |
| User control and freedom       | Leave on each account; Back on the review; the payout address can be reset                               | Cancel a pending wallet request             |
| Consistency and standards      | One status vocabulary; one accent for actions; the wallet at the top right                               | Match it on every state                     |
| Error prevention               | Simulation first; another automation is left first, automatically; no checkbox where joining cannot work | Disable writes after a failed startup check |
| Recognition rather than recall | Account names; the selection's total; the review repeats what was picked                                 |                                             |
| Flexibility and efficiency     | Pick several accounts; one batch where the wallet supports it                                            | The read-only `#0x…` view                   |
| Aesthetic and minimal design   | One main action; four facts; the vote list folded                                                        |                                             |
| Recover from errors            | Not designed yet                                                                                         | Revert reasons in plain words               |
| Help and documentation         | "What joining allows", links to the contracts and the code                                               | The README                                  |

### Accessibility

- **Contrast.** Every pair of text and background colour in both directions, light and dark, is at least 4.9:1; the
  lowest is Direction A's green status text on a selected row. AA asks for 4.5:1.
- **Keyboard.** Checkboxes, buttons and links are native elements with a visible focus ring.
- **Labels.** Each checkbox names its account, and the payout field has a label.
- **Motion.** Transitions run only when `prefers-reduced-motion` allows them.
- **Phones.** Both work at 390 px with no sideways scroll. Direction A keeps the main action at the bottom of the
  screen; Direction B keeps it at the top of the accounts.

### Cold read

Fresh readers with no context saw four screenshots of one direction each: the whole page and the review, at 1440 and 390
px. They answered what the page does, what joining changes, when it takes effect, how to leave, and what the statuses
mean.

**Round one.** Both readers got the purpose, what joining allows, the timing, how to leave and every status right. What
tripped them, and the fix:

- **"Take them back at any time"** clashed with "from the next Thursday". The lead now says that joining and leaving
  count from the next week.
- **Jargon:** "flip", "conduit", "keeper", "votes as the contracts count them". The page now says "the next week
  starts", calls the relay a Hydrex automation, introduces Klima's keeper once, and notes Hydrex's Earning Power.
- **"USDC"** read as a token. The status now says "Hydrex's USDC automation".
- **"Delegated to 0x3547…"**: whose address? It now says "an address, not a known automation".
- **The review** showed the calls but not the consequences, and on a phone the past-rewards note sat behind the buttons.
  The review now opens with what changes and the warning, then the calls, with the buttons pinned.
- **No cap on the share retired.** Now "up to 100%".
- **No way to claim first.** The warning now links to Hydrex.
- **"6 accounts" next to "3 empty accounts hidden".** Now "6 accounts with HYDX".
- **When past rewards are claimed.** Now "as soon as the account joins, … can be claimed". The keeper's schedule awaits
  its README.
- **Two boxes ticked in advance.** The mock-ups do it to show the selection; the page will tick nothing.
- **The example's main account held 90% of the relay's votes.** The example is now smaller.

**Round two,** on the revised mock-ups, with two new readers. Both again got the purpose, what joining allows, the
timing, how to leave and every status right, and found the warning about past rewards. Fixed after it:

- **Whether they can still vote themselves.** The page now says they cannot, while the account is in.
- **When the keeper first votes with a new account.** The review now gives the date: the Tuesday after the next week
  starts.
- **Claims start at once, votes next week.** Both are now said side by side.
- **"Leave USDC"** read like leaving a currency. The step now says "Take #51007 out of the USDC automation".
- **What else the calls permit.** The review now says: voting and claiming, nothing else, and nothing is transferred.
- **"Simulated"** puzzled one reader. Now "Checked ✓", with "each call was checked against the chain: it would succeed".
- **Units and costs.** "5,691 t" is now "5,691 tonnes"; "fee 0%" is now "Hydrex takes no fee today; swaps have their
  usual costs"; the keeper chooses the mix of kVCM and AZUSD.
- **"One transaction" against "one transaction per account".** Now the same everywhere.

Still open after round two: who publishes the page, when the keeper claims and pays, and how much an account has not
claimed yet. The [decisions](research.md#decisions) settle the first two.

[Decisions](research.md#decisions) 2 and 3 undo two fixes from the second cold read: the review no longer dates the
keeper's first vote with a new account, and the payout mix is gone.

## Hallway test

A five-minute test of the page with three to five Hydrex users, one at a time. It finds the words and steps people trip
on. Run it on the real page before each release.

### Set-up

- **Who:** people who hold a Hydrex account. Include at least one Safe signer and one phone user.
- **Where:** their own device, in the browser or wallet they normally use. Until the page connects wallets, open it on
  their own address, as `#0x…`.
- **What you say:** "This is a page for Hydrex accounts. Think aloud. There are no wrong answers; we are testing the
  page." Say nothing else about it.
- **What you note:** whether each task succeeds, how long it takes, the exact words they use, and where they hesitate.
  Do not help unless they are stuck for 30 seconds; then note that you helped.

### Tasks

1. **First look, 30 seconds.** "In one sentence, what is this page for?"
2. **Rewards.** "If you join with an account, what happens to its rewards?" Listen for the swap, the share retired, the
   payout address, and rewards from past weeks.
3. **Timing.** "If you join now, from when does your account count?"
4. **Join.** "Join the Carbon Impact automation with two accounts that are not in it yet." Watch whether they find the
   checkboxes and the main button, and whether they notice that one account leaves another automation first.
5. **Review.** "Before you confirm, what will your wallet ask you to sign?"
6. **Leave.** "How would you get out later, and what would happen to your votes and rewards?"
7. **Payouts.** "Send the payouts to another address."
8. **Trust.** "Is anything here worrying, unclear or missing? Would you use it?"

### After each session

Write down, in a few lines:

- the tasks that failed or needed help, and why;
- the words they used for things the page names differently;
- anything they expected to see and did not find.

Change the page where two people tripped on the same thing, then test again with someone new.
