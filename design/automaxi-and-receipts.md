# Plan: receipts from `tokenTimestamp`, and AutoMaxi

Two pieces of work for this repository, in this order:

1. **Carbon Impact's receipts,** found through Hydrex's reward contracts instead of through `totalTonnesRetired`.
2. **The groundwork for AutoMaxi,** a second automation on Hydrex, so the page can offer it once it is deployed.

Part 1 comes first: it fixes what the page shows today, and AutoMaxi reuses its reads. Figures were read from Base on 19
Oct 2026. The design, roadmap and brand are in [README.md](README.md) and [brand.md](brand.md).

## Decisions taken

- The second automation is called **AutoMaxi** on the page.
- **Carbon Impact's keeper** also sends AutoMaxi's votes and claims.
- The page **does not offer a direct claim** from Hydrex's Voter, which would skip AutoMaxi's fee.

## What to know first

### The page and its RPCs

- The page reads Base through three public RPCs, at most 25 requests a second each, 5 of them for logs, and 6 requests
  in flight (`src/chain.ts`). Contract reads go through Multicall3 with `read()`, or `readLater()` for reads after the
  page's own.
- Base makes a block every 2 seconds, so the block at time `t` is `top - (topTime - t) / 2`. `src/receipts.ts` already
  counts 302,400 blocks a week.
- In tests, `eth_call` on old blocks was answered by `mainnet.base.org` and drpc, but logs of old blocks only by drpc,
  and about 25 single-block log reads at once was more than the RPCs would answer. **Log reads are the scarce
  resource:** plan for one log read per block that holds a payout, and no more.

### Carbon Impact

- Address `0xdE91885cF35ac57DF0c4A75c16862127dBe8317c`. Its keeper holds the `EXECUTOR_ROLE`:
  `0x40FBFe5312330f278824ddbB7521ab77409192f0`.
- A payout claims an account's rewards through Hydrex's Voter, swaps them to kVCM, retires a share, and pays the rest.
  Each account is paid in one transaction, which emits `ClaimSwapAndDistributeCompleted` and, if it retired anything,
  `CarbonRetired`. `payouts()` in `src/receipts.ts` decodes both.
- Today, `lastRun()` in `src/receipts.ts` finds the last run by searching for changes in `totalTonnesRetired`. It cannot
  see a payout that retires nothing, and the page cannot say when an account was last paid or what is waiting.
- **On 19 Oct 2026, Carbon Impact had not paid since 23 Sep.** Its last payout was one transaction in block 51,698,051
  (23 Sep, 17:44 UTC, 14.68M gas) that paid accounts #26432, #82774, #14247 and #35366. Those four hold about 884k of
  its 1.17M Earning Power, are still in Carbon Impact, and had at least $1,160 waiting in last epoch's pools alone.
  Carbon Impact still votes: its last vote was on 14 Oct at 23:59 UTC. Raise this with the keeper.

### Hydrex's reward contracts

- Each pool's gauge has two reward contracts, both `BribeV2`: the Voter's `internal_bribes(gauge)` for trading fees and
  `external_bribes(gauge)` for bribes. The Voter is `0xc69E3eF39E3fFBcE2A1c570f8d3ADF76909ef17b`.
- `tokenTimestamp(uint256 tokenId, address token)` is the start of the epoch up to which the contract has paid that
  account in that token, or 0 if it never has. Every claim sets it to the minter's `active_period()`, the start of the
  current epoch, even when nothing was owed. So after a payout in the epoch that started at `E`, every pair the payout
  claimed reads `E`. Values only grow.
- `earned(uint256 tokenId, address token)` is what the account can claim now, looking back at most 50 epochs.
- Anyone with the right to claim for an account moves `tokenTimestamp`: the automation it is in, or its owner claiming
  directly.
- The source is vendored in the AutoMaxi repository at `test/upstream/hydrex/bribe/BribeV2.sol`.

### AutoMaxi

- Source: <https://github.com/ldeso/hydrex-conduit>, commit `82ba69b1472729851894989523c395c9bf25d7e4`, contract
  `ImmutableVeTokenConduit`. Its README describes it in full.
- **Not deployed yet.** It will be at `0x8B79159681aEbeC096D06F3d996fCd2f72e54f8B` (CREATE2), with the runtime code hash
  `0x489e3af444f9c0a45dbc7cb380fcabf86f581a3cc0c7aea968ae280aeae5b74d` from its `verification/bytecode-hashes.json`.
  Once deployed, compare that hash with `cast keccak $(cast code 0x8B79159681aEbeC096D06F3d996fCd2f72e54f8B)`.
- It has no owner, no settings and no upgrade path. Its fee is 1% of each claim (`FEE_BPS`, fixed in the code), sent to
  `TREASURY`, `0x450c72de8c0079B49AcedF294a13011bd09D125B`, a 2-of-3 Safe also fixed in the code.
- Joining and leaving use the same call as Carbon Impact: `setConduitApproval(conduit, tokenId, bool)` on the
  VotingEscrow. Its constructor registers the same actions, `[3, 5]`.
- **Votes:** anyone can propose one, and it is accepted only if it is expected to earn at least $1 more in bribes,
  counting only WETH, cbBTC, USDC and EURC at Chainlink prices. Votes do not carry over: an epoch without a vote earns
  nothing.
- **Claims:** anyone can call `claim(tokenId, feeAddresses, bribeAddresses, tokens)`. It pays the account's owner
  directly, as there is no payout address, in the tokens earned, unswapped, less 1%.
- **Claim history:** each claim that received anything records its block in `lastClaimBlock(uint256 tokenId)`, and each
  event carries the block recorded before it:
  `Claimed(uint256 indexed tokenId, address indexed owner, address indexed caller, address[] tokens, uint256[] amounts, uint256[] fees, uint256 previousClaimBlock)`.
  When a block holds several claims for one account, the first points back and the later ones point to the block itself,
  so follow the smallest `previousClaimBlock` below the block. Anyone can make dust claims through a contract of their
  own, which makes a history as long as they like: limit how far back the page walks.
- It is not on Hydrex's list of automations, `src/hydrex-conduits.json`. If Hydrex adds it, the page still treats it as
  its own.

### What the page needs from the keeper

- **A vote for AutoMaxi every epoch.**
- **Each AutoMaxi account claimed in one transaction,** so that a payout is one block of logs. AutoMaxi's README
  explains how to keep claims cheap. A first claim, or one after missed weeks, may need two or three transactions: Base
  appears to cap a transaction at 16,777,216 gas (both RPCs refused to estimate a 21.7M-gas claim that `eth_call` ran),
  and one account with four epochs owed on Carbon Impact's 72 pool-and-token pairs needed about 32M gas.
- **How often it claims small accounts.** Carbon Impact's run of 23 Sep used about 3.7M gas, or $0.05, per account,
  while the median account left in a stopped automation earns about $0.09 a week at last epoch's rate. The page's "late"
  rule should follow the keeper's rhythm.

## Part 1: Carbon Impact's receipts from `tokenTimestamp`

1. **Keep each reward's contract.** `rewardsOf()` in `src/earnings.ts` knows the contract of each reward (`fees` or
   `incentives` from `bribesOf()`) but drops it. Add it, so that `readEarnings()` returns
   `{ pool, contract, token, amount, fee }` for each of last epoch's pool-and-token pairs, called "pairs" below.
2. **Paid through, and waiting.** One multicall at the latest block reads `tokenTimestamp(id, token)` and
   `earned(id, token)` on each pair's contract, for each of the owner's accounts in Carbon Impact, joining or leaving.
   For each account:
   - **paid through:** the largest `tokenTimestamp`, an epoch start `E`. The account has been paid for every epoch that
     ended by `E`. If it is 0, the account has never been paid.
   - **waiting:** the sum of `earned`, priced with `src/prices.ts`. It is a floor, as it counts only last epoch's pools.
   - **late:** when `E` is two or more epochs before the current one, until the keeper's rhythm says otherwise.
3. **Find each account's last payout block.** Search from the block at time `E` to the latest settled block for the
   first block where one pair that now reads `E` reads at least `E`: about 20 reads per account.
   - Search accounts with the same `E` together. At each step, one multicall reads every account's pair at the middle
     block, and the accounts split by whether they have reached `E`. Accounts paid in one transaction stay together.
   - Put the search next to `lastChange()` and `changes()` in `src/receipts.ts`, with a reader passed in, so that it can
     be tested without RPCs.
4. **Read each distinct block's logs once:** `eth_getLogs` on Carbon Impact for that single block, decoded with
   `payouts()`. If an account has no `ClaimSwapAndDistributeCompleted` in its block, it was claimed outside Carbon
   Impact: say so instead of showing a receipt.
5. **Show it** in `src/last-payout.ts`: a receipt for each account, with its paid-through epoch and what is waiting. "A
   payout under way" becomes: some of the owner's accounts paid since the last flip and others not yet, within half a
   day of the first. Keep `blockTimes()` and `namesAt()` for each receipt's time and retirement name.
6. **Remove the old search:** `lastRun()`, `totalRetired()` and their use in `src/last-payout.ts`. Home still reads
   `totalTonnesRetired` for its figure.
7. **Update the README.** Under Limits, drop the paragraph on finding payouts through `totalTonnesRetired`, and "no
   unclaimed rewards per account". Add that what is waiting is a floor, and that a claim by the owner shows as claimed
   outside Carbon Impact. Under "What visitors may run into", add late payouts.
8. **Tests:**
   - `test/receipts.test.ts`: the search with a fake reader, for one account, several accounts paid in one block,
     accounts paid in different blocks, an account never paid, and a value that never reaches `E`.
   - Paid through, waiting and late, from fixed reads.
   - `fork/page.ts`: its fork block is 52,694,000 (16 Oct 2026). There, the four accounts above read 17 Sep, and their
     receipts must come from block 51,698,051.

**What to expect.** Measured on 19 Oct 2026 through `src/chain.ts`: today's search took 1.9 s and 22 requests. The
`tokenTimestamp` search took 1.1 s and 19 requests for one account over a week, 1.3 s and 22 requests over four weeks,
and 2.1 s for four accounts searched separately. It found block 51,698,051 for all four. The multicall in step 2 took
0.1 s for four accounts and 72 pairs.

## Part 2: the groundwork for AutoMaxi

Until AutoMaxi is deployed, the page leaves it out, because a check finds no code at its address. Everything below can
be built and tested on a fork first.

1. **The automations as a list.** In `src/config.ts`, replace the single `CONDUIT` with a list of automations. Each has
   a name, an address, a code hash, what joining approves (`[3, 5]`), and a kind, `carbon-impact` or `automaxi`, which
   picks its reads and its receipts. Carbon Impact keeps its settings reads (`retireBps`, `kvcm` and the rest); AutoMaxi
   has none.
2. **Checks per automation.** `failedChecks()` in `src/hydrex.ts` runs for each automation: the code hash and
   `getConduitApprovalConfig`, and for AutoMaxi also `voter()` and `veToken()`. A failure turns off that automation's
   Join only; leaving always works. With no code at AutoMaxi's address, the page leaves AutoMaxi out.
3. **Statuses and calls per automation.** In `src/hydrex.ts`, `statusOf()`, `groupOf()`, `canJoin()`, `canLeave()`,
   `join()` and `leave()` take the automation. Hydrex's other automations are `src/hydrex-conduits.json` less both of
   the page's. Moving an account between Carbon Impact and AutoMaxi is one call: joining one takes the votes and the
   claims from the other.
4. **Freshness:** AutoMaxi's last vote, from the Voter's `lastVoted(AutoMaxi)`, with the existing `hasStopped()`.
5. **What votes earned:** `readEarnings()` takes the automation's address instead of `CONDUIT`. AutoMaxi shows "no
   record yet" until its first epoch ends.
6. **Receipts from `lastClaimBlock`,** in a module next to `src/receipts.ts`:
   - One multicall of `lastClaimBlock(id)` for the owner's AutoMaxi accounts.
   - One `eth_getLogs` per distinct block, on AutoMaxi, with the `Claimed` topic and the accounts' token IDs as a list
     in the second topic, so that accounts claimed in the same block share one read.
   - For each account, the next block is the smallest `previousClaimBlock` below the current one. Stop at the start of
     the period shown, at 0, or after a set number of blocks per account (start with 10), and then say that the page
     stopped.
   - A receipt lists each token received and the fee, with dollars at the page's prices, marked ≈. Tokens it cannot
     price show as amounts.
   - Paid through and waiting come from Part 1's reads, which work the same way: AutoMaxi claims from the same reward
     contracts.
7. **Fee facts,** the six rows of [README.md](README.md#patterns), for AutoMaxi. Its code hash fixes them all:
   - Taken: 1% of each claim.
   - The most it can become: 1%, fixed in the code.
   - Goes to: the 2-of-3 Safe `0x450c72de8c0079B49AcedF294a13011bd09D125B`.
   - When: each claim.
   - Other costs: none. It pays in the tokens earned, unswapped.
   - Who can change it: nobody. A change means a new deployment, and owners joining again.
8. **Fork tests.** Deploy AutoMaxi on anvil through the CREATE2 deployer `0x4e59b44847b379578588920cA78FbF26c0B4956C`,
   with the salt `keccak256("metadex.cafe/ImmutableVeTokenConduit/v1")` and the init code from `initCode()` in its
   `script/Deploy.s.sol` at the pinned commit, committed as a fixture. Check that it lands at its address with the
   expected code hash. Its constructor needs fresh Chainlink prices and Base's sequencer up at the fork's time. Then
   test joining, a claim by the keeper, a dust claim by a stranger, receipts and the walk's limit, leaving, and moving
   an account between the two automations.
9. **Views, last:** the menu, a page per automation, and Choose, as in the roadmap. Update the roadmap's assumptions
   about the second automation: AutoMaxi pays in the tokens earned rather than in one token, and takes 1% rather than
   "[10%]". That includes Help me choose's row for "[Hydrex automation], paying in [USDC]".

## Done

Each part is done when `npx prettier --check .`, `npm run typecheck`, `npm test`, `reuse lint` and `npm run build` pass,
and `npm run test:fork` passes with `BASE_RPC_URL` set. Steps 1 to 8 of Part 2 can be released before AutoMaxi is
deployed. Once it is, check its code hash on Base, then release again.
