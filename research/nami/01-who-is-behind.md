# Who is behind Nami

**Short answer.** Nami is run by a British Virgin Islands company, Nami Labs Inc., with no named founders. On-chain
evidence ties its deployment to the team behind **SwapX**, the Algebra-based ve(3,3) DEX on Sonic: the wallet that owns
`swapx.eth` and deployed SwapX's vote-escrow implementation is the wallet that funded Nami's deployer. SwapX's own
channels promote Nami, and Nami reserves an airdrop for SwapX lockers. I found no official statement that says "Nami is
built by the SwapX team", and no individual is publicly named for either project.

Each claim below is marked **[on-chain]** (I read it from a chain, and `scripts/verify.sh` reads it again),
**[official]** (Nami's own site, docs, repository or terms), or **[secondary]** (press, a search-result excerpt, a third
party).

## What Nami says about itself

| Fact                 | Detail                                                                                                                                                                                                                         | Source                                                                               |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------ |
| Operating company    | Nami Labs Inc., British Virgin Islands, registration number 2218294, registered office Hudsun Chambers, P.O. Box 986, Road Town, Tortola. It makes the interfaces available and organised the presale.                         | [official] Terms of Use, last updated 21 September 2026; Presale Terms               |
| Code licensor        | "North Bay Foundation" holds the copyright and licenses the code under the Business Source License 1.1 (change date 8 September 2030, then GPL-2.0-or-later). I found nothing public about this foundation.                    | [official] `LICENSE` in `namifi/Nami-Protocol`                                       |
| Governing law        | British Virgin Islands law, with binding arbitration.                                                                                                                                                                          | [official] Terms of Use                                                              |
| Team                 | Not named anywhere. The docs say personal information about multisig signers "is treated as sensitive".                                                                                                                        | [official] docs, Risk and Admin Roles                                                |
| Funding              | "No VC Allocation". A public presale of the ogNAMI token raised 865,000 USDC from 405 wallets, against a 2,000,000 USDC target.                                                                                                | [official] docs; [on-chain] `PresaleReader.getPresaleInfo()` on Base                 |
| Public handles       | X `@namidefi`; GitHub organisation `namifi` (earlier named `Project-Nami`); committers `codeislight` and `Rikisp` (`Rikispwiki`); support contact `@zeroxbunny`; email `info@nami.fi`.                                         | [official] docs, git history, the MetaMask issue below                               |
| Earlier track record | "The Nami team has built and shipped plugins in production supporting over $4B in volume." The docs do not say where.                                                                                                          | [official] docs, V4 CLAMM DEX page                                                   |
| Who may use it       | The Terms bar "Restricted Persons" from the interfaces and the presale: anyone located, resident or incorporated in the **United States, the European Union, the European Economic Area or the United Kingdom**, among others. | [official] Terms of Use, section 4. Check this against your own situation before use |

The public repository has six commits, all from 8 September 2026, by two authors. Its last commit merges from
`github.com/Project-Nami/Nami-Protocol`, and BailSec's audit reports reference a private repository,
`Project-Nami/Nami-Contracts`. So the organisation was renamed from `Project-Nami` to `namifi`, and the working
repository is private.

On 29 September 2026 a GitHub user, `Rikispwiki`, opened
[MetaMask/eth-phishing-detect#298373](https://github.com/MetaMask/eth-phishing-detect/issues/298373) as "the team behind
Nami", because Blockaid was flagging `nami.fi` as malicious in MetaMask, Rabby and OKX Wallet. MetaMask closed it on 1
October: the domain was not on its own list, and it sent the filer to Blockaid. I could not confirm whether Blockaid
still flags the domain. **[secondary]**

## The link to SwapX

SwapX is a ve(3,3) DEX on Sonic, built on Algebra Integral and audited by BailSec. Its contracts were deployed on 24
December 2024.

### On-chain evidence

1. **Nami's deployer is `0x2358545EeF7E56B2EbEaCbF62212278dD27A99db`.** It created NamiHub (the NAMI token), the veNAMI
   proxy, wveNAMI, the Minter and the Batcher factory on Ethereum. **[on-chain]** Etherscan `getcontractcreation`.
2. **Its first transaction on Ethereum was a gas top-up from `0xe67E6a96235A4f7A81B8532f3d491c20DaADe2cd`.** That wallet
   sent it 0.0005 ETH on 27 August 2026 at 22:52:35 UTC
   ([`0x944e6955…d16d`](https://etherscan.io/tx/0x944e69555c739277156aa26bcbc207f530a87e6ff7745262cd7456176453d16d)).
   The deployer made its first contract 96 seconds later. **[on-chain]**
3. **`0xe67E…e2cd` is a SwapX wallet.** **[on-chain]**
   - It registered the ENS name `swapx.eth` on 13 April 2025
     ([`0x1092b784…c227`](https://etherscan.io/tx/0x1092b784d8d5a1993e1a89c4303b09c017aaaf7e35d93b7bc33618cf593fc227)).
     It still owns the name, and the name resolves to it.
   - On 23 January 2025 it deployed, on Sonic, the contract `VotingEscrowV1_1` at
     `0x099850d49CA301729Edb8D8ec533b155E0ABaAf2`
     ([`0xab37c58c…4195`](https://sonicscan.org/tx/0xab37c58c48b59d9feb8f34c3b5fd971f30d56b99cfaaf2a3d66c142defa14195)).
     SwapX's veSWPx proxy (`0xAA30F0977620D4d46B3Bb3Cf0794Fe645d576CA3`, name "veSwapX") uses that contract as its
     implementation today. The same wallet deployed the implementation of veSWPx's art proxy one second earlier.

So a wallet that holds SwapX's ENS name and shipped SwapX's vote-escrow upgrade paid for the first gas of Nami's
deployer. This shows that at least one SwapX core developer deployed Nami. It does not, by itself, show that the two
projects have the same owners.

Two things I checked that do **not** link the projects: Nami's seven multisig signers are different addresses from
SwapX's six, and Nami's deployer has no history on Ethereum or Sonic before 27 August 2026.

### Public evidence

- **Nami's tokenomics reserve a "SwapX Airdrop"**: 40,000 Infinite veNAMI, 3.33% of the initial allocation.
  **[official]** docs, Supply and Emission.
- **SwapX's X account promotes Nami.** Search-result excerpts of `@SwapXfi` show a pinned post introducing Nami, a post
  announcing Nami's Genesis launch, and "All xNFT holders and veSWPx lockers are eligible for the nami airdrop". I could
  not open X directly, so treat the wording as **[secondary]**.
- **The "$4B in volume" claim fits SwapX.** DefiLlama's all-time volume for "SwapX Algebra" is $3.70B. **[secondary]**
- **Same building blocks.** Both use Algebra Integral, both describe themselves with the phrase "V4 CLAMM", both use
  BailSec, and Nami's verified `Minter` has the same function names as SwapX's (`weekly`, `EMISSION`, `active_period`,
  `update_period`). Many Solidly forks share these names, so this is weak evidence on its own.

### Why it matters: SwapX's record

| Measure            | Peak                             | Now                                      | Source                                                                 |
| ------------------ | -------------------------------- | ---------------------------------------- | ---------------------------------------------------------------------- |
| SwapX TVL          | $65.1M on 28 March 2025          | $0.31M on 16 November 2026 (down 99.5%)  | [secondary] DefiLlama `swapx`                                          |
| SWPx price         | $0.7548 on 25 February 2025      | $0.0011 on 16 November 2026 (down 99.9%) | [secondary] CryptoRank excerpt for the high; DefiLlama price for today |
| SWPx supply        | 40M at launch                    | 160.9M                                   | [secondary] blocmates for launch; [on-chain] `totalSupply()`           |
| SWPx emissions     | 2M a week at launch, decaying 1% | 935,066 a week, still running            | [secondary] blocmates; [on-chain] `Minter.weekly()`                    |
| SwapX 7-day volume |                                  | $0.80M                                   | [secondary] DefiLlama                                                  |
| SwapX admin        |                                  | A 2-of-6 Safe owns the minter            | [on-chain]                                                             |

Sonic's whole DeFi ecosystem shrank over the same period, so SwapX's decline is not only the team's doing. Two points
still bear on Nami. First, the same developers' previous token lost almost all its value while it kept emitting; Nami's
"d(3,3)" pitch is a direct answer to that. Second, SwapX lockers receive 3.33% of Nami's initial allocation, while SwapX
itself keeps running with little activity.

## What remains unknown

- Who the people are. Neither project names anyone. `@zeroxbunny`, `codeislight` and `Rikisp` are handles, not
  identities.
- Who owns Nami Labs Inc. and North Bay Foundation, and how the two relate.
- Who the seven multisig signers are, and whether any is independent of the team. The docs' table of admin roles reads
  "TBD" in every cell.
- Whether SwapX will be wound down, merged into Nami, or kept running.
- Whether the "two independent teams" that the docs say audited the code are both inside BailSec. Only BailSec reports
  are published.
