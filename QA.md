# Trying the page by hand

`npm run qa` builds the page and opens it in a browser of its own, against a fork of Base in anvil, as the browser tests
run it: at `https://metadex.cafe`, its RPCs answered by the fork, its Content Security Policy as on the site. A second
window, the QA wallet, signs as any address on Base, and holds the controls for the fork. Nothing reaches Base: every
transaction stays on the fork, and Safe{Wallet} is a stand-in that only takes proposals.

It needs what `npm run test:fork` needs: Node 26 LTS, [anvil](https://getfoundry.sh/), and Chromium (`CHROMIUM` names
one, as for the tests). The fork reads Base's state through `BASE_RPC_URL`, or the page's first RPC, and keeps it in
`FORK_CACHE`, which the browser tests share. The first time, a scenario can take many minutes to start, and the page's
first reads can fail while anvil still fetches state: **run `npm run test:fork` once first**, and each scenario then
starts in seconds. The `payout` scenario forks a block of its own, which the browser tests do not read: its first start
takes a few minutes, as do the page's first reads of its payouts.

```sh
npm ci --ignore-scripts
npm run qa             # the hydrex scenario
npm run qa -- claim    # or another one
node fork/qa.ts --list # the scenarios
```

Close the QA wallet, or press Ctrl-C, to stop. The fork's answers are then kept for the next run.

## The QA wallet

Each change the QA wallet makes to the fork mines the few blocks that the page reads behind Base's newest, as an RPC may
not have those yet: reload the page, and it shows the change.

- **Scenario:** starts one, or the same one again, from a fresh fork. That undoes every transaction and change, and puts
  the wallet back as it was at first: signing as the scenario's first wallet, on Base, able to switch, not asking, one
  call per prompt, with no address typed in.
- **Signs as:** the scenario's wallets, each with what it holds, or any address typed in. The page follows at once, as
  it does when a wallet changes account. An address with less than 0.01 ETH gets 0.1 ETH for gas.
- **Network:** Base, or Ethereum, for the wrong network. **Can switch networks** off makes the wallet refuse to switch.
- **Asks you before it connects, switches or sends:** off, the wallet says yes to everything at once. On, each request
  waits in the QA wallet, which comes to the front, for Confirm or Reject, as a wallet's window does. It connects as the
  address picked when the page asked, and sends from the address the page names, which the prompt names, even if another
  is picked meanwhile.
- **Calls:** one per prompt; or several in one prompt with EIP-5792's `wallet_sendCalls`, as Coinbase Wallet and
  MetaMask do, all or nothing, or one by one. All or nothing, a batch whose calls would not all go through sends one
  transaction that fails, and nothing else. The page asks a wallet what it can do once per address: reload it after a
  change.
- **Fail the next transaction:** sends it with too little gas, so that Base includes it, and it fails. A call that runs
  on less gas than its calldata already pays for (EIP-7623's floor) cannot fail so: the wallet then refuses to send it,
  and the page shows the error.
- **Lock:** the wallet shares no account any more, as when it locks.
- **Send it all away:** sends the wallet's whole balance of a token to `0x…dEaD`, as if spent elsewhere. By symbol, the
  one the wallet holds of the listed tokens so named: two are AERO.
- **Give it a token of that symbol:** deploys a token of the QA wallet's own, `fork/fixtures/QaToken.sol`, at a new
  address, with the symbol given, and 1,000 of it to the wallet. **Lists those tokens** answers ERC-7811's
  `wallet_getAssets` with them, as a wallet that lists its tokens does; such a wallet answers `wallet_getCapabilities`,
  so the page also sends several calls in one prompt: ticking it turns one call per prompt into all or nothing, and
  picking one call per prompt unticks it. The log says so either way.
- **Open the page:** with the wallet; in Safe{Wallet}, with the address signed as for the Safe, on the wallet's network;
  with two wallets in the browser; or with none.
- **Hydrex,** for the account typed in, as its owner can on Hydrex: **Delegate its votes** to any address, to one of
  Hydrex's automations by its name, or back to its owner; **Give it to the address signed as**; **Its owner claims on
  Hydrex** the most valuable of what waits for it in the pools of each of the last two epochs, ten of each at most.
  **Matcha Latte pays there** sets where Matcha Latte pays the accounts of the address signed as.
- **Hydrex, as on Base each week,** which nobody does on the fork unasked: **Hydrex moves on to the new epoch** after a
  flip, through its minter, until when what the epoch before earned is not final; **Matcha Latte's operator votes** as
  Matcha Latte did last, through its executor module; **Someone adds incentives:** 100 USDC, from Matcha Latte's fee
  recipient, in the pool Matcha Latte votes for most. **Hydrex's other automations vote again** makes those that stopped
  in September look as if they voted just now.
- **The operator,** in the `payout` scenario: sends again, one by one, the payouts that Base included after the fork's
  block, from the operator's own address, with their own calldata. One that fails on the fork, as the QA wallet changed
  it, says so, and the next is then sent.
- **Base:** its time on the fork, which runs on a block every 2 seconds. **Next epoch** moves it to a minute after the
  next Thursday, 00:00 UTC; **12 hours later**, half a day on. The page's clock follows. Nobody votes or pays on the
  fork unasked, so a new epoch shows Matcha Latte as stopped.
- **Failures:** Base's RPCs fail, or serve another chain; Hydrex's Voter cannot be read; tokens' symbols cannot be read,
  each such read failing on its own, as a token's would; Matcha Latte's figures cannot be read, while Double Espresso's
  can, or the other way round; or the swappers' quotes come in a tenth under what their pools give.
- **Checks that fail:** each of the page's checks but `chain`, by the id the README's table gives it, fails on its own:
  the page reads another implementation or approval logic for the VotingEscrow, or what joining an automation approves
  as off, while the fork's stays as it is. The page checks contracts as it opens, then every hour: reload it after a
  change.
- **What the wallet was asked:** each connection, switch and transaction, and its answer, and each change to the fork.

Links out of the page, such as to Basescan, open the real site, which knows nothing of the fork.

## The scenarios

Each starts from the state of some of the browser tests, or, for `payout`, of Base just before the operator's payouts.

| Scenario          | Base on              | Signs as, first            | What it is for                                                                    |
| ----------------- | -------------------- | -------------------------- | --------------------------------------------------------------------------------- |
| `hydrex`          | Fri 16 Oct, 19:03    | `0x0208…4C95`, #141        | Both automations: joining and leaving, those that stopped, and what can fail.     |
| `double-espresso` | Fri 16 Oct, 19:03    | `0x0208…4C95`, #141        | As `hydrex`, with Double Espresso's receipts for #82774.                          |
| `swap`            | Wed 21 Oct, 15:42    | `0x0000…FFEE`, WETH ZORA … | The swap, from a wallet that holds three tokens, or Matcha Latte's fee recipient. |
| `claim`           | Wed 21 Oct, 15:42    | `0x6092…6c93`, #82774      | An overdue payout in Double Espresso: claim it as it is, swapped, or from a Safe. |
| `payout`          | Thu 22 Oct, 00:00:26 | `0x6092…6c93`, #82774      | Matcha Latte's payouts after a flip, sent by its operator one by one, as on Base. |

## The flows

Each line names the scenario, the wallet to sign as in the QA wallet, and what to do. Any scenario serves the views and
the wallet's own failures. Start the scenario again to try a flow from its start: a join, once made, stays made.

### The views

- **Home, the App, About:** any scenario. Home, then Open app; Back and Forward; About from the footer. An address the
  page does not know, such as `#how-it-works`, opens Home.
- **Phone widths and dark mode:** resize the window, or open DevTools (F12): its device toolbar, and Rendering's
  `prefers-color-scheme`.
- **Without a wallet:** Open the page, Without a wallet. The App's Browser wallet says No wallet found, and links to
  wallet apps; so does the header's button.
- **Several wallets:** Open the page, With two wallets. The header's button offers a list.
- **A wallet that locks:** connect, then Lock. The page lets the wallet go; a click connects it again.
- **Another account in the wallet:** connect, open an account's page such as `#hydrex/141`, then sign as another
  address: the page speaks of its owner, without actions.

### Hydrex: `hydrex`

| Flow                                                          | Sign as       | What to do                                                                                                                                                                   |
| ------------------------------------------------------------- | ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Join with an account of its own                               | `0x0208…4C95` | Needs you: untick #42877, Join Matcha Latte, Continue, Sign transaction. #141 then says Joining Matcha Latte, votes from Thu 22 Oct.                                         |
| An account whose owner did not vote                           | `0x0208…4C95` | #141: Not voted since 4 Oct 2025, in Needs you, with Vote on Hydrex. The App's Needs you counts it; `#hydrex/141` gives the gas of a change.                                 |
| Join from automations that stopped, one transaction at a time | `0x6970…a655` | Needs you starts with #2435 and #2439 ticked, 2 of 2: Join Matcha Latte. Two transactions. All unticks and ticks them both.                                                  |
| The same, in one prompt                                       | `0x6970…a655` | Calls: several in one prompt, all or nothing. Reload, then as above: One prompt, 2 calls.                                                                                    |
| Closing between transactions                                  | `0x6970…a655` | As above, confirm the first, then Close: #2439 joins, #2435 stays.                                                                                                           |
| Leave                                                         | `0x388b…7b40` | Leave beside #9540.                                                                                                                                                          |
| Leave an automation that stopped, to vote yourself            | `0x6970…a655` | Untick #2435, Vote yourself.                                                                                                                                                 |
| A lock that ended                                             | `0x2518…e84d` | #123351 under the closed group: Lock ended, nothing to tick.                                                                                                                 |
| Votes delegated to an address                                 | `0x0208…4C95` | Account #141, delegate its votes to `0x000000000000000000000000000000000000dEaD`, reload: Delegated to 0x0000…dEaD. Delegate them to `owner` to undo.                        |
| Partly in an automation                                       | `0x0208…4C95` | Account #141, delegate its votes to `Matcha Latte`, reload: Partly in Matcha Latte, which the App's Needs you lists.                                                         |
| In another automation that still votes                        | `0x6970…a655` | Tick Hydrex's other automations vote again, reload: #2439 is In USDC, and not stopped.                                                                                       |
| What votes earned last epoch                                  | `0x388b…7b40` | #9540: about $6 last epoch. Vote yourself: Hydrex's average, and Your votes: Didn't vote; each automation's page, the average beside its own. `#hydrex/matcha-latte/record`. |
| A late payout, and its last receipt                           | `0x6092…6c93` | #82774: Payout late. Its page, `#hydrex/82774`, shows the receipt of the payout of Wed 23 Sep. 93 accounts: the first time, reading takes a while.                           |
| Payouts not final yet, then final                             | `0x388b…7b40` | Next epoch, then `#hydrex/9540`: Not final yet. Hydrex moves on, reload: Late, with its receipt.                                                                             |
| Nothing to pay                                                | `0x388b…7b40` | As above, then Next epoch and Hydrex moves on again: Matcha Latte earned nothing in either epoch on the fork, and `#hydrex/9540` says Nothing to pay.                        |
| Not paid yet                                                  | `0x0208…4C95` | Join Matcha Latte with #141; Next epoch; Hydrex moves on; Matcha Latte's operator votes; Someone adds incentives; Next epoch; Hydrex moves on: `#hydrex/141`, Not paid yet.  |
| Payouts that cannot be read                                   | `0x6092…6c93` | Tick Matcha Latte's figures cannot be read, open `#hydrex/82774`: Reading the payouts failed. Untick, then Try again.                                                        |
| Tokens whose symbol cannot be read                            | `0x6092…6c93` | Tick Tokens' symbols cannot be read, reload `#hydrex/82774`: its receipt earned 8.56 ? and 89.04 ?, and paid its owner 727.11 ?.                                             |
| An account's page, anyone's                                   | any           | `#hydrex/9540`, `#hydrex/14485`; `#hydrex/999999999` has no such account.                                                                                                    |
| Inside Safe{Wallet}                                           | `0x2573…0b16` | Open the page in Safe{Wallet}. Tick #53350 and #82206, Leave: one Safe transaction, 2 calls, then Proposed.                                                                  |
| A Safe that is not on Base                                    | `0x2573…0b16` | Network: Ethereum, then open the page in Safe{Wallet}: This Safe isn't on Base.                                                                                              |
| The wrong network                                             | `0x0208…4C95` | Network: Ethereum. The page says Wrong network; its Switch to Base switches the wallet. With Can switch networks off, it says to switch there.                               |
| A refusal in the wallet                                       | `0x0208…4C95` | Tick Asks you, start a join, and Reject in the QA wallet: You said no in your wallet.                                                                                        |
| A transaction that fails                                      | `0x0208…4C95` | Fail the next transaction, then join: A transaction failed on Base.                                                                                                          |
| Back while the wallet asks                                    | `0x0208…4C95` | Tick Asks you, Sign transaction on the page, then Back. Confirm in the QA wallet: the account still updates.                                                                 |
| Two clicks while the wallet asks to connect                   | any           | Tick Asks you, reload, click Test Wallet in the App twice: the second did not connect. Confirm: the first still does.                                                        |
| Reading Base failed                                           | any           | Tick Base's RPCs fail, reload: Reading Base failed. Untick, then Try again.                                                                                                  |
| A check that fails                                            | any           | Tick one under Checks that fail, reload: Hydrex's page says why joining is off; the page of each automation it turns off says so, and Why leads there.                       |
| The Voter cannot be read                                      | `0x6970…a655` | Tick Hydrex's Voter cannot be read, reload: the accounts still show.                                                                                                         |
| A new epoch                                                   | `0x0208…4C95` | Join with #141, then Next epoch: the page moves on to the next one, and #141 is in Matcha Latte. Nobody votes on the fork: Matcha Latte reads as stopped.                    |

### Double Espresso: `hydrex`, and `double-espresso` for its receipts

| Flow                                 | Sign as       | What to do                                                                                                                                                                                         |
| ------------------------------------ | ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The menu, and Double Espresso's page | `0x0208…4C95` | `#hydrex`: Matcha Latte, Double Espresso and Vote yourself. Double Espresso has no record yet. Its page: `#hydrex/double-espresso`.                                                                |
| Join Double Espresso                 | `0x0208…4C95` | Needs you: untick #42877, Join Double Espresso.                                                                                                                                                    |
| Move between the two automations     | `0x2573…0b16` | Tick #53350, Move to Double Espresso; then Move to Matcha Latte.                                                                                                                                   |
| Leave Double Espresso                | `0x0208…4C95` | Once #141 is in, Leave: claims stop.                                                                                                                                                               |
| Its receipts: anyone's claims        | `0x6092…6c93` | In `double-espresso`, `#hydrex/82774`: Receipt · #82774 · Double Espresso, claims sent by `0x0000…dEaD` and by `0x0000…1234`, each paid to the owner, less 1%.                                     |
| One automation's payouts that fail   | `0x0208…4C95` | #141 joins Double Espresso, #42877 Matcha Latte; twice, Next epoch and Hydrex moves on; tick Double Espresso's figures cannot be read: `#hydrex/141` cannot read its payouts, `#hydrex/42877` can. |

### The swap: `swap`

| Flow                                          | Sign as       | What to do                                                                                                                                                           |
| --------------------------------------------- | ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Swap into USDC                                | `0x0000…FFEE` | WETH, ZORA and AVNT, each with what it fetches. The quote, the 1%, what reaches you, the least, the gas. Review, Continue, Sign 4 transactions.                      |
| All or nothing, one by one, or one per prompt | `0x0000…FFEE` | Calls, then reload. All or nothing: All 4 in one prompt, all or nothing. One by one: All 4 in one prompt. One per prompt: a prompt each, the swap quoted again last. |
| A token skipped, and its approval reset       | `0x0000…FFEE` | Calls: several, all or nothing; reload. Review, Continue; then send all of AVNT away, and Sign 4 transactions: 2 tokens sold, AVNT kept. Reset its approval.         |
| A quote far under the page's price            | `0x0000…FFEE` | Tick Swap quotes come in a tenth under price, reload: each row says Quote 10% under price.                                                                           |
| A token with a listed token's symbol          | `0x0000…FFEE` | Give it a token of symbol `USDC`; then tick Lists those tokens and reload: USDC, no route, Not the usual USDC.                                                       |
| Another output                                | `0x0000…FFEE` | `#swap/weth`, or pick it on the page.                                                                                                                                |
| The approvals given to the swappers           | `0x0000…FFEE` | After a swap, the swap's Approvals, and the App's.                                                                                                                   |
| Many tokens                                   | `0xd9e9…50aF` | Matcha Latte's fee recipient, a Safe: as a wallet, or in Safe{Wallet}.                                                                                               |
| Swaps are off                                 | any           | Tick Base's RPCs serve another chain, reload: Swaps are off, without naming the check.                                                                               |

### Claiming: `claim`

| Flow              | Sign as       | What to do                                                                                                         |
| ----------------- | ------------- | ------------------------------------------------------------------------------------------------------------------ |
| An overdue payout | `0x6092…6c93` | The App's Needs you: #82774, payout overdue. Its page, `#hydrex/82774`, says so too.                               |
| Claim it as it is | `0x6092…6c93` | Claim now, Continue: several transactions, each a claim through Double Espresso. Then the receipt, and Swap these. |
| Claim it, swapped | `0x6092…6c93` | Claim now, Into, Continue: the claims, then Review the swap into USDC.                                             |
| After the claim   | `0x6092…6c93` | Close, then `#hydrex/82774`: nothing waiting, its last receipts by its owner; Needs you no longer lists it.        |
| From a Safe       | `0x6092…6c93` | Open the page in Safe{Wallet}. Claim now in Needs you: as it is only, as several Safe transactions, then Proposed. |
| Across the flip   | `0x6092…6c93` | Next epoch, then Hydrex moves on, then 12 hours later, to see the payouts across a new epoch.                      |

### Payouts: `payout`

Base on Thu 22 Oct, 26 seconds after the flip: Hydrex has moved on, and the operator has not paid yet. On Base, it then
paid #82774 in three transactions, #35366 in three, and #9540 in one: the operator's button sends them again, in turn.

| Flow                                  | Sign as       | What to do                                                                                                                                                                                                     |
| ------------------------------------- | ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Payouts due, then paid                | `0x6092…6c93` | `#hydrex/82774`: Late, ≈ $52 waiting. The operator pays #82774, 1 of 3, reload: Paid up to Thu 22 Oct, and the receipt of that payout, from Base's own transaction.                                            |
| A payout under way                    | `0x6092…6c93` | Account #35366, Give it to the address signed as; on the page, Join Matcha Latte with #35366; then the operator pays #82774, 1 of 3, reload: Hydrex's page says Payout under way, and so does `#hydrex/35366`. |
| Paid to another address               | `0x6092…6c93` | Matcha Latte pays there: `0x000000000000000000000000000000000000dEaD`; then the operator pays #82774, 1 of 3: its receipt reads To 0x…dEaD.                                                                    |
| Paid to its owner then                | `0x6092…6c93` | Account #35366, Give it to the address signed as: `#hydrex/35366`'s receipt was paid to its owner then, at its address.                                                                                        |
| Last claimed outside Matcha Latte     | `0x388b…7b40` | Account #9540, Its owner claims on Hydrex, reload `#hydrex/9540`: Last claimed outside Matcha Latte: no receipt.                                                                                               |
| An account its automation can't claim | `0x6092…6c93` | Account #35366, Give it to the address signed as: Matcha Latte no longer claims it: claim on Hydrex.                                                                                                           |

## Every state, and where to find it

The page sorts each Hydrex account by what holds its votes and its claims, in `statusOf` in `src/hydrex.ts`. Each status
can be reached:

| Status       | What the page says                               | Where                                                       |
| ------------ | ------------------------------------------------ | ----------------------------------------------------------- |
| `self`       | You vote with it                                 | `hydrex`, #141                                              |
| `in`         | In Matcha Latte's group                          | `hydrex`, #9540                                             |
| `joined`     | Joining Matcha Latte, votes from …               | `hydrex`, once #141 joins                                   |
| `left`       | Leaving Matcha Latte, your votes from …          | `hydrex`, once #9540 leaves                                 |
| `partly`     | Partly in Matcha Latte; in Needs you             | `hydrex`, #141 delegated to Matcha Latte                    |
| `stopped`    | In USDC · stopped since Wed 9 Sept; in Needs you | `hydrex`, #2439                                             |
| `other`      | In USDC                                          | `hydrex`, #2439, once Hydrex's other automations vote again |
| `left-other` | Left USDC, your votes from …                     | `hydrex`, once #2439 leaves                                 |
| `delegated`  | Delegated to 0x…                                 | `hydrex`, #141 delegated to an address                      |
| `ended`      | Lock ended                                       | `hydrex`, #123351                                           |
| `empty`      | Empty, under the closed group                    | `hydrex`, `0x0208…4C95`'s closed group                      |

An account's payouts, on its page, in `standingItem` in `src/last-payout.ts`:

| What the page says                              | Where                                                                       |
| ----------------------------------------------- | --------------------------------------------------------------------------- |
| Paid up to …                                    | `payout`, #82774 once the operator pays it                                  |
| Not paid yet                                    | `hydrex`, #141, as in Not paid yet above                                    |
| Late · paid up to …, or Late · never paid       | `hydrex`, #82774; `hydrex`, #53350                                          |
| Nothing to pay                                  | `hydrex`, #9540, as in Nothing to pay above                                 |
| Not final yet                                   | `hydrex`, #9540, after Next epoch                                           |
| … no longer claims it: claim on Hydrex          | `double-espresso`, #82774; `payout`, #35366 once given                      |
| Last claimed outside Matcha Latte: no receipt   | `payout`, #9540 once its owner claims on Hydrex                             |
| Never claimed through Double Espresso           | `claim`, #82774                                                             |
| Payout under way                                | `payout`, as in A payout under way above                                    |
| A receipt paid To another address               | `payout`, #82774, as in Paid to another address above                       |
| A receipt Paid to its owner then                | `payout`, #35366 once given                                                 |
| Double Espresso's receipts, Last 10 blocks only | `claim`, #82774 once the page's claim of it went through                    |
| Reading the payouts failed                      | any, with Matcha Latte's figures, or Double Espresso's, that cannot be read |

Each of the page's checks, in `failedChecks` in `src/hydrex.ts`, can fail on its own: `chain` as Base's RPCs serve
another chain, and the others under Checks that fail. `approvals` fails for Matcha Latte alone, and
`double-espresso-approvals` for Double Espresso alone; the others, for both.

## What the scenarios do not show

- **Not read yet,** the standing of an account whose automation's figures could not be read while another's could: the
  page reads the payouts of one account at a time, on its page, so that such a failure fails the whole read, and the
  page says Reading the payouts failed instead.
- **Real wallets and the real Safe{Wallet}:** Safe{Wallet} proposes through Safe's own servers, which know nothing of a
  fork, and a wallet extension signs with its own keys, not as anyone. Check those on the site itself, as
  [Releasing](README.md#releasing) says.
