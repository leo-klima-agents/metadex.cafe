import type { Address, Hex } from "viem";

export const CHAIN_ID = 8453;
// Asked in this order. drpc serves old blocks for free; publicnode needs a paid token for them.
export const RPCS = ["https://mainnet.base.org", "https://base.drpc.org", "https://base-rpc.publicnode.com"];
export const MULTICALL3: Address = "0xcA11bde05977b3631167028862bE2a173976CA11";

// The automations the page offers, and the Hydrex contracts the page checks before it lets anyone join. The kind picks
// an automation's reads and its receipts.
export type Kind = "carbon-impact" | "automaxi";
export type Automation = {
  kind: Kind;
  name: string;
  address: Address;
  codeHash: Hex;
  // What joining approves: 3 sends the account's claims to the automation, 5 delegates its votes.
  actions: number[];
};
// Klima's automation. One admin key controls its settings, which the page reads from Base.
export const CARBON_IMPACT: Automation = {
  kind: "carbon-impact",
  name: "Carbon Impact",
  address: "0xdE91885cF35ac57DF0c4A75c16862127dBe8317c",
  codeHash: "0x0d67cd335e3ae9cde256cf399f819a3ea2b9c248b0336840a3b20a2ee82c192e",
  actions: [3, 5],
};
// ImmutableVeTokenConduit version 2, from https://github.com/ldeso/hydrex-conduit at tag v2, commit 718c107. It has no
// owner and no settings: its code fixes its fee and where the fee goes. It deploys through CREATE2, so its address is
// known before; until there is code there, the page leaves it out. Version 1, at
// 0x8B79159681aEbeC096D06F3d996fCd2f72e54f8B, still works, but the page does not offer it.
export const AUTOMAXI: Automation = {
  kind: "automaxi",
  name: "AutoMaxi",
  address: "0x692c323B425A9DfeebE302F56168a7798D93EAC5",
  codeHash: "0x4872932431e0d175fb1213e9ffec2b8f0ebd1d9d490643d6df5b2c6d0b379847",
  actions: [3, 5],
};
export const AUTOMATIONS = [CARBON_IMPACT, AUTOMAXI];
// AutoMaxi's fee, FEE_BPS in its code, of each claim, and TREASURY, the 2-of-3 Safe it goes to.
export const AUTOMAXI_FEE_BPS = 100n;
export const AUTOMAXI_TREASURY: Address = "0x450c72de8c0079B49AcedF294a13011bd09D125B";
// The keeper that votes and claims for both: it holds Carbon Impact's EXECUTOR_ROLE. Anyone may claim through AutoMaxi.
export const KEEPER: Address = "0x40FBFe5312330f278824ddbB7521ab77409192f0";
export const KVCM: Address = "0x00fBAC94Fec8D4089d3fe979F39454F48c71A65d";
export const VOTING_ESCROW: Address = "0x25B2ED7149fb8A05f6eF9407d9c8F878f59cd1e1";
export const VOTING_ESCROW_IMPLEMENTATION: Address = "0x0FC68cE53Be957a1AA779f553AD49f6068fFf231";
export const VOTING_ESCROW_IMPLEMENTATION_CODE_HASH: Hex =
  "0xe6b54672ba85711eac5516d6ce09fe96cabe9cc3764a178e5d2f33a6241c2b42";
export const APPROVAL_LOGIC: Address = "0x4B0BC0889EB524Dbae36d409fF733851E9B4f63D";
export const APPROVAL_LOGIC_CODE_HASH: Hex = "0xd1fab3adcd045439b72359a675665cb9f9267b32aebb140df865fc723681a930";
export const VOTER: Address = "0xc69E3eF39E3fFBcE2A1c570f8d3ADF76909ef17b";
export const ACCOUNT_NAMES: Address = "0x998cf40a742460b4eBbFB569A0D23eA91976c0d3";

// For pricing rewards: Hydrex's two pool factories, and the tokens other tokens are priced against.
export const ALGEBRA_FACTORY: Address = "0x36077D39cdC65E1e3FB65810430E5b2c4D5fA29E";
export const PAIR_FACTORY: Address = "0xC47F17c4fd96F50eFD2A2448ceDe5C185c084bf0";
export type Anchor = { address: Address; decimals: number; feed?: Address };
export const WETH: Address = "0x4200000000000000000000000000000000000006";
export const ANCHORS: Anchor[] = [
  // USDC, counted as a dollar
  { address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", decimals: 6 },
  // WETH, with Chainlink's ETH / USD feed
  {
    address: WETH,
    decimals: 18,
    feed: "0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70",
  },
  // cbBTC, with Chainlink's BTC / USD feed
  {
    address: "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf",
    decimals: 8,
    feed: "0x64c911996D3c6aC71f9b455B1E8E7266BcbD848F",
  },
];
