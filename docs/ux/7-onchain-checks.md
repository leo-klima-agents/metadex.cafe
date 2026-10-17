# 7. On-chain checks

Two questions the proposal depended on, and what showing payouts would take, answered from Hydrex's verified contracts
and from Base itself on 17 October 2026 (block 52,725,716). The method is at the end, so that each answer can be checked
again.

## Accounts left in a stopped automation

Hydrex's 13 other automations last voted on Wednesday 9 September 2026; Carbon Impact last voted on 14 October.

| Question                                                   | Answer                                                                                                                                                                                                                                                                                                                                                                |
| ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Do its old votes still count?                              | **No.** Hydrex's Voter counts a vote, and the reward contracts record it, only for the epoch in which it is cast. The USDC automation's balance in the reward contracts of its pools was 19.2 M in the epoch from 3 September, and 0 in every epoch from 10 September. Its 5.9 M votes still stored on one pool count for nothing: that pool weighs 2,609 this epoch. |
| So what has the account earned since?                      | **Nothing from voting** (fees and bribes) since the epoch that began on Thursday 10 September. Rebases were not checked.                                                                                                                                                                                                                                              |
| Can the owner vote with it?                                | **Not while it is delegated to the stopped automation.** Its Earning Power counts for the automation, which does not vote.                                                                                                                                                                                                                                            |
| Can the owner still claim its unclaimed rewards on Hydrex? | **Yes.** The reward contracts let the owner, or the address the account's claims are redirected to, claim; the owner's claim is paid to the owner. Simulated for account #2439, in the USDC automation: the owner's claim, through Hydrex's Voter or the reward contract itself, pays 0.004515 USDC to the owner; the same call from another address reverts.         |
| Is there anything left to claim?                           | **Small amounts from before it stopped.** Account #2439 has 20 unclaimed rewards across the USDC automation's pools, such as 0.0045 USDC, 0.107 oHYDX and 20 LFI: what the automation did not claim before it stopped. Nothing accrues after.                                                                                                                         |
| Is the automation's access still there?                    | **Yes.** All 14 automations' approval settings are still active, so each still holds its accounts' claim redirect and voting delegation. Its operator could still claim those leftovers.                                                                                                                                                                              |
| Can the owner leave it, or join Carbon Impact?             | **Both work.** Leaving is `setConduitApproval(automation, account, false)`, which needs the setting to be active, as it is; the votes come back from the next epoch. Joining Carbon Impact replaces both approvals directly, as the page does today.                                                                                                                  |

**What the status line can say.** For an account in the USDC automation: "In USDC, which has not voted since 9 Sep. This
account has earned nothing from voting since 10 Sep." Then two ways out: join Carbon Impact, or leave USDC to vote
yourself on Hydrex. Before joining, the review says that rewards left from before USDC stopped can be claimed on Hydrex
first, or Carbon Impact will claim them with the rest.

**How the page can tell.** It does not need a list of which automations stopped: Hydrex's Voter exposes
`lastVoted(address)`. An automation that has not voted since the start of the previous epoch has stopped, as far as an
account's earnings go. The same read would show it if Carbon Impact ever stopped.

## The name on the retirements

The automation's deployed source is verified, and is the same as `contracts/conduits/KlimaVeTokenConduit.sol` in
Hydrex's `hydrex-periphery` repository.

| Field passed to Klima on each retirement | Today                                                                             |
| ---------------------------------------- | --------------------------------------------------------------------------------- |
| Retiring entity                          | "Hydrex"                                                                          |
| Beneficiary name                         | Empty                                                                             |
| Beneficiary address                      | `0xcba0000027bd78edf6714DE3bCC312360E469502`, an address with no code             |
| Message                                  | "Programmatic carbon retirement via Hydrex's Carbon Strategy on the Base network" |
| Credit retired, in a recent run          | UCR-320-2022                                                                      |

- **It can be changed, for everyone at once.** The admin key can call `setRetirementDetails` to set the retiring entity,
  the beneficiary name and address, and the message. Today's values are the ones the contract was deployed with.
- **It cannot name each member.** There is one set of details for all retirements, the function that pays and retires
  each account takes no name, and only the admin key, not the keeper, can change the details. Retiring in each member's
  name would need a new automation contract, which every member would have to join again.

So the name stays "Hydrex". One thing the team may still want to look at: with the beneficiary name empty, a
certificate's "On behalf of" can only show the beneficiary address, or nothing.

## Reading payouts

The proposal would show a member their last payout rather than promise the next one.

- **The history is on Base.** Each payout emits an event that names the account and its owner, with what was claimed and
  paid.
- **The page's RPCs cannot serve it today.** Of its three public RPCs, one has a request limit, one needs a token for
  history, and one allows 10,000 blocks per query, about five and a half hours. Showing "last payout" needs an RPC that
  serves logs, added to the page's Content Security Policy, or many small queries.
- **AZUSD is still in the contract's list of payout tokens,** which is likely where Hydrex's "60% kVCM, 40% AZUSD" comes
  from. The admin key can change the list.

## Method

- **Sources:** verified on Sourcify for Hydrex's Voter implementation (`0x9cb9…7233`), VotingEscrow implementation
  (`0x0fc6…f231`), approval logic (`0x4B0B…f63D`), reward contract implementation (`BribeV2`, `0x6225…a28d`, behind
  beacon `0x5aeb…11c2`) and the Carbon Impact automation (`0xdE91…317c`). The Voter's claim logic (`0x68ed…c21d`) is not
  verified, so claims were simulated instead of read.
- **Reads:** `lastVoted`, `poolVote`, `votes`, `weightsAt` on the Voter; `balanceOfOwnerAt` and `earned` on each reward
  contract of the USDC automation's six pools; `getConduitApprovalConfig` on the VotingEscrow for all 14 automations;
  the retirement fields on the automation.
- **Simulations:** `eth_simulateV1` with transfer tracing, from the owner of #2439 and from an unrelated address, of
  `getReward` on a reward contract and `claimBribes` on the Voter.
- **Logs:** the Carbon Impact automation's events from block 51,525,716 (19 September) to 52,725,716 (17 October), for a
  recent retirement's details and the shape of the payout event.
