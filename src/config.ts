import type { Address, Hex } from "viem";

export const CHAIN_ID = 8453;
export const RPCS = ["https://mainnet.base.org", "https://base-rpc.publicnode.com", "https://base.drpc.org"];
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
