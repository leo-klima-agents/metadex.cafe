# Sources

Everything in the report comes from the sources below, read on 16 November 2026. The on-chain readings are in
`onchain-snapshot.txt`, and `../scripts/verify.sh` makes them again.

## Nami: primary

| Source                                                                                                                                                                                                                            | Used for                                                                               |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| [github.com/namifi/Nami-Protocol](https://github.com/namifi/Nami-Protocol) at commit `5a3075f` (8 September 2026)                                                                                                                 | README, module docs with "trust notes", Batcher source, `LICENSE`, git authors         |
| [docs.nami.fi](https://docs.nami.fi), through its full-text export [docs.nami.fi/llms-full.txt](https://docs.nami.fi/llms-full.txt)                                                                                               | Tokenomics, d(3,3), launch, lock types, contract addresses, terms, audits, admin page  |
| [nami.fi](https://nami.fi)                                                                                                                                                                                                        | Positioning, partner list                                                              |
| Etherscan-verified source of the Ethereum hub contracts, fetched through the Etherscan API: NamiHub `0x8888…8888`, VEProxy `0x8080…8080`, Minter `0x789e…3044`, EmissionsSettlement `0x8cdd…3bE6`, Voter `0x0200…A147` and others | `Minter.sol`, `NamiHub.sol`, `NamiBase.sol`, `Claimer.sol`, `RootLifecycleUpgradeable` |
| Sourcify, Base: PresaleReader `0x24c7…EA09`                                                                                                                                                                                       | ABI for reading the presale                                                            |
| BailSec reports at [github.com/bailsec/BailSec](https://github.com/bailsec/BailSec): "Nami – Core" (September 2026), "Project Nami – Presale Module", "Nami – Batcher", "Nami – Farming", "MEV-X – Differential"                  | Finding counts, audited commits, the audit's view of the trust model                   |

## Nami: on-chain

| Chain           | RPC                                | What was read                                                                       |
| --------------- | ---------------------------------- | ----------------------------------------------------------------------------------- |
| Ethereum        | `ethereum-rpc.publicnode.com`      | Supply, veNAMI holders, Minter, owners, timelocks, roles, settlement configuration  |
| Base            | the `BASE_RPC_URL` of this session | Supply, presale, ogNAMI holders (all `Transfer` logs since deployment), pool prices |
| Robinhood Chain | `robinhood-rpc.publicnode.com`     | Supply                                                                              |
| Sonic           | `rpc.soniclabs.com`                | SwapX's vote-escrow proxy, minter and Safe                                          |

Contract creators and transaction histories on Ethereum and Sonic came from the Etherscan v2 API. Its free tier does not
serve Base, so Base data came from the RPC and Sourcify.

Key transactions:

- Nami deployer's first funding, Ethereum:
  [`0x944e69555c739277156aa26bcbc207f530a87e6ff7745262cd7456176453d16d`](https://etherscan.io/tx/0x944e69555c739277156aa26bcbc207f530a87e6ff7745262cd7456176453d16d)
- Registration of `swapx.eth`, Ethereum:
  [`0x1092b784d8d5a1993e1a89c4303b09c017aaaf7e35d93b7bc33618cf593fc227`](https://etherscan.io/tx/0x1092b784d8d5a1993e1a89c4303b09c017aaaf7e35d93b7bc33618cf593fc227)
- Creation of veSWPx's implementation, Sonic:
  [`0xab37c58c48b59d9feb8f34c3b5fd971f30d56b99cfaaf2a3d66c142defa14195`](https://sonicscan.org/tx/0xab37c58c48b59d9feb8f34c3b5fd971f30d56b99cfaaf2a3d66c142defa14195)
- NamiHub creation, Ethereum:
  [`0xcfeb704d63ef9ebbd816177543373390ee82b3670b9c0c91e0c36eb18e9b930b`](https://etherscan.io/tx/0xcfeb704d63ef9ebbd816177543373390ee82b3670b9c0c91e0c36eb18e9b930b)
- ogNAMI mint of 250,000 to the deployer, Base:
  [`0xb01cc615ad817fd23a0216e8eb6efa4b4425872668956f2e2d3a441f4373b806`](https://basescan.org/tx/0xb01cc615ad817fd23a0216e8eb6efa4b4425872668956f2e2d3a441f4373b806)
- Unsold ogNAMI moved to the team Safe `0x764A…07ac`, Base:
  [`0x8070ed8fbea5fc8dc4e2307ed94d18416e2ae1ec708dd7ff5fb11fcca9a3fb94`](https://basescan.org/tx/0x8070ed8fbea5fc8dc4e2307ed94d18416e2ae1ec708dd7ff5fb11fcca9a3fb94)

## Nami: secondary

| Source                                                                                                                                                        | Used for                                                   | Caveat                                                 |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- | ------------------------------------------------------ |
| DefiLlama API: `api.llama.fi/protocol/nami`, `summary/dexs/nami`, `summary/fees/nami`, and the same for `swapx`, `swapx-algebra`, `aero`, `hydrex`            | TVL, volume, fees                                          | Third-party indexing; Nami's figures cover 11 days     |
| [MetaMask/eth-phishing-detect#298373](https://github.com/MetaMask/eth-phishing-detect/issues/298373)                                                          | The Blockaid flag, the team's contact handle               | Read through a summariser, not the raw issue           |
| [Our Crypto Talk, "Nami Targets ve(3,3)'s Weaknesses. Can It Win?"](https://ourcryptotalk.com/blog/nami-targets-ve33s-weaknesses-can-it-win), 29 October 2026 | Launch dates, a third party's risk list                    | Sponsorship not disclosed either way                   |
| [CoinGabbar on the ogNAMI presale](https://www.coingabbar.com/en/ognami-crypto-presale-news-airdrop-rewards-claim-update), 13 October 2026                    | A mid-presale raise figure ($734,600)                      | Superseded by the on-chain final figure                |
| [blocmates, "SwapX: Building the Liquidity Layer for Sonic"](https://www.blocmates.com/articles/swapx-building-the-liquidity-layer-for-sonic), December 2024  | SwapX's launch supply, emissions and stack                 | Written before SwapX launched                          |
| Web-search excerpts of [x.com/SwapXfi](https://x.com/SwapXfi)                                                                                                 | SwapX promoting Nami and announcing the airdrop to lockers | X itself could not be opened; wording is from excerpts |
| Web-search excerpts of CryptoRank and SonicScan                                                                                                               | SWPx's high and current price                              | Not rechecked against a price feed                     |

## Aerodrome, Aero and Hydrex

See the source notes at the end of `../03-comparison.md`.
