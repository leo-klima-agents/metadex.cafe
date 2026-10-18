import type { Address, Hex } from "viem";

export const CHAIN_ID = 8453;
// In the order they are asked: drpc keeps Base's history for free, where publicnode asks a token for it.
export const RPCS = ["https://mainnet.base.org", "https://base.drpc.org", "https://base-rpc.publicnode.com"];
export const MULTICALL3: Address = "0xcA11bde05977b3631167028862bE2a173976CA11";
export const CONDUIT: Address = "0xdE91885cF35ac57DF0c4A75c16862127dBe8317c";
export const CONDUIT_CODE_HASH: Hex = "0x0d67cd335e3ae9cde256cf399f819a3ea2b9c248b0336840a3b20a2ee82c192e";
export const ACTIONS = [3, 5]; // what joining approves: the claim redirect and the voting delegate
export const KVCM: Address = "0x00fBAC94Fec8D4089d3fe979F39454F48c71A65d";
export const VOTING_ESCROW: Address = "0x25B2ED7149fb8A05f6eF9407d9c8F878f59cd1e1";
export const VOTING_ESCROW_IMPLEMENTATION: Address = "0x0FC68cE53Be957a1AA779f553AD49f6068fFf231";
export const VOTING_ESCROW_IMPLEMENTATION_CODE_HASH: Hex =
  "0xe6b54672ba85711eac5516d6ce09fe96cabe9cc3764a178e5d2f33a6241c2b42";
export const APPROVAL_LOGIC: Address = "0x4B0BC0889EB524Dbae36d409fF733851E9B4f63D";
export const APPROVAL_LOGIC_CODE_HASH: Hex = "0xd1fab3adcd045439b72359a675665cb9f9267b32aebb140df865fc723681a930";
export const VOTER: Address = "0xc69E3eF39E3fFBcE2A1c570f8d3ADF76909ef17b";
export const ACCOUNT_NAMES: Address = "0x998cf40a742460b4eBbFB569A0D23eA91976c0d3";
// For what the votes earned: Hydrex's two pool factories, and the tokens its pools are priced against, with the
// Chainlink feeds that price them.
export const ALGEBRA_FACTORY: Address = "0x36077D39cdC65E1e3FB65810430E5b2c4D5fA29E";
export const PAIR_FACTORY: Address = "0xC47F17c4fd96F50eFD2A2448ceDe5C185c084bf0";
export type Anchor = { address: Address; decimals: number; symbol: string; feed?: Address };
export const ANCHORS: Anchor[] = [
  { address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", decimals: 6, symbol: "USDC" },
  {
    address: "0x4200000000000000000000000000000000000006",
    decimals: 18,
    symbol: "WETH",
    feed: "0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70", // ETH / USD
  },
  {
    address: "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf",
    decimals: 8,
    symbol: "cbBTC",
    feed: "0x64c911996D3c6aC71f9b455B1E8E7266BcbD848F", // BTC / USD
  },
];
