import type { Address, Hex } from "viem";
import type { Fiat } from "./format.ts";

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

// Hydrex's pool factories.
export const ALGEBRA_FACTORY: Address = "0x36077D39cdC65E1e3FB65810430E5b2c4D5fA29E";
export const PAIR_FACTORY: Address = "0xC47F17c4fd96F50eFD2A2448ceDe5C185c084bf0";
// The tokens others are priced against, each priced by its Chainlink feed.
export type Feed = { address: Address; decimals: number };
export type Anchor = { address: Address; decimals: number; feed: Feed };
export const WETH: Address = "0x4200000000000000000000000000000000000006";
export const USDC: Address = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
export const CBBTC: Address = "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf";
export const EURC: Address = "0x60a3E35Cc302bFA44Cb288Bc5a4F316Fdb1adb42";
export const HYDX: Address = "0x00000e7efa313F4E11Bfff432471eD9423AC6B30";
const anchor = (address: Address, decimals: number, feed: Address): Anchor => ({
  address,
  decimals,
  feed: { address: feed, decimals: 8 },
});
// Each currency's price in dollars, to show prices in it: not anchors, as no token priced here is the currency itself.
// Chainlink's on Base: EUR / USD, GBP / USD, CHF / USD, AUD / USD and CAD / USD.
export const FIAT_FEEDS: Record<Fiat, Feed> = {
  EUR: { address: "0xc91D87E81faB8f93699ECf7Ee9B44D11e1D53F0F", decimals: 8 },
  GBP: { address: "0xCceA6576904C118037695eB71195a5425E69Fa15", decimals: 8 },
  CHF: { address: "0x3A1d6444fb6a402470098E23DaD0B7E86E14252F", decimals: 8 },
  AUD: { address: "0x46e51B8cA41d709928EdA9Ae43e42193E6CDf229", decimals: 8 },
  CAD: { address: "0xA840145F87572E82519d578b1F36340368a25D5d", decimals: 8 },
};
export const ANCHORS: Anchor[] = [
  // USDC / USD
  anchor(USDC, 6, "0x7e860098F58bBFC8648a4311b374B1D669a2bc6B"),
  // ETH / USD
  anchor(WETH, 18, "0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70"),
  // BTC / USD
  anchor(CBBTC, 8, "0x64c911996D3c6aC71f9b455B1E8E7266BcbD848F"),
  // EURC / USD
  anchor(EURC, 6, "0xDAe398520e2B67cd3f27aeF9Cf14D93D927f8250"),
];

// The swap: ImmutableSwapper, deployed once per output token on 21 Oct 2026. Each sells the tokens its caller names for
// its output, along the routes its caller picks, through pools it checks against the twelve factories below, and sends
// 1% of each route's output to AutoMaxi's treasury. It has no owner and no settings. Its sources are verified, with an
// exact match, on Basescan and Sourcify.
export type Output = "usdc" | "eurc" | "weth" | "cbbtc" | "aero" | "hydx";
export type Swapper = {
  output: Output;
  symbol: string;
  token: Address;
  decimals: number;
  address: Address;
};
export const SWAPPERS: Swapper[] = [
  {
    output: "usdc",
    symbol: "USDC",
    token: USDC,
    decimals: 6,
    address: "0x31791f453d2100e728E012c9e189C0828adf4b6F",
  },
  {
    output: "eurc",
    symbol: "EURC",
    token: EURC,
    decimals: 6,
    address: "0x2cd8019d4F98e2fE2Ba705d8E7D38284c2a1450E",
  },
  {
    output: "weth",
    symbol: "WETH",
    token: WETH,
    decimals: 18,
    address: "0xe5cbD828c2227E17f7FF8BD54C7A1e6012694Ff2",
  },
  {
    output: "cbbtc",
    symbol: "cbBTC",
    token: CBBTC,
    decimals: 8,
    address: "0x54805B6E6266c952627E47B8ADe4ae65c5DEA7d0",
  },
  {
    output: "aero",
    symbol: "AERO",
    token: "0x3f5bF3EdAc59d650D8fDf9657a71F2f904A3a4Ee",
    decimals: 18,
    address: "0xdd575A498C625AF96ac89efE578Dc68f4c9aB963",
  },
  {
    output: "hydx",
    symbol: "HYDX",
    token: HYDX,
    decimals: 18,
    address: "0xC629B1A13a0E1d4F0C38cD80d22E4AAC363cc8bC",
  },
];
export const DEFAULT_OUTPUT: Output = "usdc";
export const swapperOf = (output: string): Swapper | undefined => SWAPPERS.find((each) => each.output === output);
// FEE_BPS in its code.
export const SWAP_FEE_BPS = 100n;

// The swappers' exchanges, in the page's order. `id` is the swapper's Exchange enum and exchanges() index. Aero's basic
// pools have a factory per curve; Uniswap v4's is its PoolManager.
export type ExchangeKind = "algebra" | "pair" | "solidly" | "slipstream" | "aerodrome" | "v2" | "v3" | "v4";
export type Exchange = { id: number; name: string; kind: ExchangeKind; factory: Address; stable?: boolean };
export const EXCHANGES: Exchange[] = [
  { id: 2, name: "Aero Basic Pools", kind: "solidly", factory: "0x8E6a9FCd1d638CC760Ffba397605Fe3355dE76D2" },
  {
    id: 3,
    name: "Aero Basic Pools",
    kind: "solidly",
    factory: "0x78589E876edcEbdce72ee3436ab3c9AD3a7cEF2D",
    stable: true,
  },
  { id: 4, name: "Aero Slipstream", kind: "slipstream", factory: "0x9CB220581b91b0C83223012FE69688b92aD07a76" },
  { id: 5, name: "Aerodrome Basic Pools", kind: "aerodrome", factory: "0x420DD381b31aEf6683db6B902084cB0FFECe40Da" },
  { id: 8, name: "Aerodrome Slipstream V3", kind: "slipstream", factory: "0xf8f2eB4940CFE7d13603DDDD87f123820Fc061Ef" },
  { id: 7, name: "Aerodrome Slipstream V2", kind: "slipstream", factory: "0xaDe65c38CD4849aDBA595a4323a8C7DdfE89716a" },
  { id: 6, name: "Aerodrome Slipstream", kind: "slipstream", factory: "0x5e7BB104d84c7CB9B682AaC2F3d509f5F406809A" },
  { id: 11, name: "Uniswap v4", kind: "v4", factory: "0x498581fF718922c3f8e6A244956aF099B2652b2b" },
  { id: 10, name: "Uniswap v3", kind: "v3", factory: "0x33128a8fC17869897dcE68Ed026d694621f6FDfD" },
  { id: 9, name: "Uniswap v2", kind: "v2", factory: "0x8909Dc15e40173Ff4699343b6eB8132c65e18eC6" },
  { id: 1, name: "Hydrex Classic Pools", kind: "pair", factory: PAIR_FACTORY },
  { id: 0, name: "Hydrex Integral", kind: "algebra", factory: ALGEBRA_FACTORY },
];

// Where tokens are priced against the anchors, in order: prices now in Aero Basic Pools, Aerodrome Basic Pools, Hydrex
// Classic Pools and Hydrex Integral; prices at an epoch's end in Hydrex's two.
const exchangesOf = (kind: ExchangeKind): Exchange[] => EXCHANGES.filter((exchange) => exchange.kind === kind);
export const HYDREX_PRICING: Exchange[] = [...exchangesOf("pair"), ...exchangesOf("algebra")];
export const SWAP_PRICING: Exchange[] = [...exchangesOf("solidly"), ...exchangesOf("aerodrome"), ...HYDREX_PRICING];
