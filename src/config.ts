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
// Hydrex's automation, whose votes and payouts a keeper now sends. One admin key controls its settings, which the
// page reads from Base.
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
export const byKind = (kind: string): Automation | undefined =>
  AUTOMATIONS.find((automation) => automation.kind === kind);
// AutoMaxi's fee, FEE_BPS in its code, of each claim, and TREASURY, the 2-of-3 Safe it goes to.
export const AUTOMAXI_FEE_BPS = 100n;
export const AUTOMAXI_TREASURY: Address = "0x450c72de8c0079B49AcedF294a13011bd09D125B";
// The address whose claims through AutoMaxi the receipts show as AutoMaxi's own, made for its members after each epoch.
// It holds Carbon Impact's EXECUTOR_ROLE. Anyone may claim through AutoMaxi.
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

// The swap: ImmutableSwapper, deployed once per output token on 21 Oct 2026. Each sells the tokens its caller names for
// its output, along the routes its caller picks, through pools it checks against the twelve factories below, and sends
// 1% of each route's output to AutoMaxi's treasury. It has no owner and no settings. Its sources are verified, with an
// exact match, on Basescan and Sourcify; the code hashes are those its sources record.
export type Output = "usdc" | "eurc" | "weth" | "cbbtc" | "aero" | "hydx";
export type Swapper = {
  output: Output;
  symbol: string;
  token: Address;
  decimals: number;
  address: Address;
  codeHash: Hex;
};
export const SWAPPERS: Swapper[] = [
  {
    output: "usdc",
    symbol: "USDC",
    token: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    decimals: 6,
    address: "0x31791f453d2100e728E012c9e189C0828adf4b6F",
    codeHash: "0x8d6d7ae768e36b4642c1b2d83afc4411053ef918cc78a6fa372f7b694386970b",
  },
  {
    output: "eurc",
    symbol: "EURC",
    token: "0x60a3E35Cc302bFA44Cb288Bc5a4F316Fdb1adb42",
    decimals: 6,
    address: "0x2cd8019d4F98e2fE2Ba705d8E7D38284c2a1450E",
    codeHash: "0xb51455b03682699694ae84a9ee17f1fa52cef8f57100d19a684226069f23be2e",
  },
  {
    output: "weth",
    symbol: "WETH",
    token: WETH,
    decimals: 18,
    address: "0xe5cbD828c2227E17f7FF8BD54C7A1e6012694Ff2",
    codeHash: "0xf58e0a14f707b542c5eae6af6929b28e4214e723543c617c29444541207261c8",
  },
  {
    output: "cbbtc",
    symbol: "cbBTC",
    token: "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf",
    decimals: 8,
    address: "0x54805B6E6266c952627E47B8ADe4ae65c5DEA7d0",
    codeHash: "0xce9c5630b7243cbe9cbcbef1704c888e376d45f1889197ffc7d5ad6704c2ed69",
  },
  {
    output: "aero",
    symbol: "AERO",
    token: "0x3f5bF3EdAc59d650D8fDf9657a71F2f904A3a4Ee",
    decimals: 18,
    address: "0xdd575A498C625AF96ac89efE578Dc68f4c9aB963",
    codeHash: "0xb0f28d588145fa5aef5f44eab97bf0e7f891e60499179b72540cbaa6f80b31d1",
  },
  {
    output: "hydx",
    symbol: "HYDX",
    token: "0x00000e7efa313F4E11Bfff432471eD9423AC6B30",
    decimals: 18,
    address: "0xC629B1A13a0E1d4F0C38cD80d22E4AAC363cc8bC",
    codeHash: "0xfa9d0e728d29ee86a2762db1ff2d017b0779fcc73fff68e5a4a62301e1785c5d",
  },
];
export const DEFAULT_OUTPUT: Output = "usdc";
export const swapperOf = (output: string): Swapper | undefined => SWAPPERS.find((each) => each.output === output);
// FEE_BPS and TREASURY in its code: the same Safe as AutoMaxi's fee.
export const SWAP_FEE_BPS = 100n;
export const SWAP_TREASURY: Address = AUTOMAXI_TREASURY;
export const HYDX: Address = "0x00000e7efa313F4E11Bfff432471eD9423AC6B30";

// The exchanges each swapper trades on, in the order of its Exchange enum and of exchanges(), with the factory it checks
// each pool against. Uniswap v4's is its PoolManager, which holds every pool.
export type ExchangeKind = "algebra" | "pair" | "solidly" | "slipstream" | "aerodrome" | "v2" | "v3" | "v4";
export type Exchange = { id: number; name: string; kind: ExchangeKind; factory: Address };
export const EXCHANGES: Exchange[] = [
  { id: 0, name: "Hydrex, Algebra pools", kind: "algebra", factory: ALGEBRA_FACTORY },
  { id: 1, name: "Hydrex, classic pools", kind: "pair", factory: PAIR_FACTORY },
  { id: 2, name: "Aero, volatile pools", kind: "solidly", factory: "0x8E6a9FCd1d638CC760Ffba397605Fe3355dE76D2" },
  { id: 3, name: "Aero, stable pools", kind: "solidly", factory: "0x78589E876edcEbdce72ee3436ab3c9AD3a7cEF2D" },
  { id: 4, name: "Aero, Slipstream", kind: "slipstream", factory: "0x9CB220581b91b0C83223012FE69688b92aD07a76" },
  { id: 5, name: "Aerodrome, classic pools", kind: "aerodrome", factory: "0x420DD381b31aEf6683db6B902084cB0FFECe40Da" },
  { id: 6, name: "Aerodrome, Slipstream", kind: "slipstream", factory: "0x5e7BB104d84c7CB9B682AaC2F3d509f5F406809A" },
  { id: 7, name: "Aerodrome, Slipstream 2", kind: "slipstream", factory: "0xaDe65c38CD4849aDBA595a4323a8C7DdfE89716a" },
  { id: 8, name: "Aerodrome, Slipstream 3", kind: "slipstream", factory: "0xf8f2eB4940CFE7d13603DDDD87f123820Fc061Ef" },
  { id: 9, name: "Uniswap v2", kind: "v2", factory: "0x8909Dc15e40173Ff4699343b6eB8132c65e18eC6" },
  { id: 10, name: "Uniswap v3", kind: "v3", factory: "0x33128a8fC17869897dcE68Ed026d694621f6FDfD" },
  { id: 11, name: "Uniswap v4", kind: "v4", factory: "0x498581fF718922c3f8e6A244956aF099B2652b2b" },
];
