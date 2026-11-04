import type { Address } from "viem";

export const CHAIN_ID = 8453;
// Asked in this order. Prices read old blocks, which Base's RPC and drpc serve; publicnode serves only recent ones.
export const RPCS = ["https://mainnet.base.org", "https://base.drpc.org", "https://base-rpc.publicnode.com"];
export const MULTICALL3: Address = "0xcA11bde05977b3631167028862bE2a173976CA11";
export const BASESCAN = "https://basescan.org";
// Base's GasPriceOracle, which says what posting a transaction to Ethereum costs.
export const GAS_PRICE_ORACLE: Address = "0x420000000000000000000000000000000000000F";

export type Kind = "matcha-latte" | "double-espresso";
// `actions` is what joining approves: 3 sends the account's claims to the automation, 5 delegates its votes.
export type Automation = { kind: Kind; name: string; contract: string; address: Address; actions: number[] };
// Hydrex's automation; Hydrex controls its settings.
export const MATCHA_LATTE: Automation = {
  kind: "matcha-latte",
  name: "Matcha Latte",
  contract: "KlimaVeTokenConduit",
  address: "0xdE91885cF35ac57DF0c4A75c16862127dBe8317c",
  actions: [3, 5],
};
// ImmutableVeTokenConduit v2 (github.com/ldeso/hydrex-conduit, tag v2): no owner, no settings.
export const DOUBLE_ESPRESSO: Automation = {
  kind: "double-espresso",
  name: "Double Espresso",
  contract: "ImmutableVeTokenConduit",
  address: "0x692c323B425A9DfeebE302F56168a7798D93EAC5",
  actions: [3, 5],
};
export const AUTOMATIONS = [MATCHA_LATTE, DOUBLE_ESPRESSO];
export const byKind = (kind: string): Automation | undefined => AUTOMATIONS.find((each) => each.kind === kind);
// The fee Double Espresso takes on each claim and the swappers take on each route, and the Safe that receives both.
export const FEE_BPS = 100n;
export const FEE_RECIPIENT: Address = "0x450c72de8c0079B49AcedF294a13011bd09D125B";
// The account that holds Matcha Latte's DEFAULT_ADMIN_ROLE, and the Safe that holds its EXECUTOR_ROLE.
export const MATCHA_LATTE_ADMIN: Address = "0x74266f2b206D1359B83fc74949EF07176FB3AE03";
export const MATCHA_LATTE_OPERATOR: Address = "0x17f513C024C1C67db050258ba569c714a9CF1B12";
export const KVCM: Address = "0x00fBAC94Fec8D4089d3fe979F39454F48c71A65d";
export const VOTING_ESCROW: Address = "0x25B2ED7149fb8A05f6eF9407d9c8F878f59cd1e1";
export const VOTING_ESCROW_IMPLEMENTATION: Address = "0x0FC68cE53Be957a1AA779f553AD49f6068fFf231";
export const APPROVAL_LOGIC: Address = "0x4B0BC0889EB524Dbae36d409fF733851E9B4f63D";
export const VOTER: Address = "0xc69E3eF39E3fFBcE2A1c570f8d3ADF76909ef17b";
export const ACCOUNT_NAMES: Address = "0x998cf40a742460b4eBbFB569A0D23eA91976c0d3";

export const WETH: Address = "0x4200000000000000000000000000000000000006";
export const USDC: Address = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
export const CBBTC: Address = "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf";
const EURC: Address = "0x60a3E35Cc302bFA44Cb288Bc5a4F316Fdb1adb42";
export const HYDX: Address = "0x00000e7efa313F4E11Bfff432471eD9423AC6B30";

export const CURRENCIES = ["USD", "EUR", "GBP", "CHF", "AUD", "CAD"] as const;
export type Currency = (typeof CURRENCIES)[number];
export const currencyOf = (name: string): Currency | undefined => CURRENCIES.find((each) => each === name);
export type Fiat = Exclude<Currency, "USD">;
// Chainlink feeds on Base, all with 8 decimals: each currency's price in dollars, and the dollar price of each anchor,
// the tokens that others are priced against.
export const FIAT_FEEDS: Record<Fiat, Address> = {
  EUR: "0xc91D87E81faB8f93699ECf7Ee9B44D11e1D53F0F",
  GBP: "0xCceA6576904C118037695eB71195a5425E69Fa15",
  CHF: "0x3A1d6444fb6a402470098E23DaD0B7E86E14252F",
  AUD: "0x46e51B8cA41d709928EdA9Ae43e42193E6CDf229",
  CAD: "0xA840145F87572E82519d578b1F36340368a25D5d",
};
export type Anchor = { address: Address; decimals: number; feed: Address };
export const ANCHORS: Anchor[] = [
  { address: USDC, decimals: 6, feed: "0x7e860098F58bBFC8648a4311b374B1D669a2bc6B" },
  { address: WETH, decimals: 18, feed: "0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70" },
  { address: CBBTC, decimals: 8, feed: "0x64c911996D3c6aC71f9b455B1E8E7266BcbD848F" },
  { address: EURC, decimals: 6, feed: "0xDAe398520e2B67cd3f27aeF9Cf14D93D927f8250" },
];

// ImmutableSwapper, one per output token, with no owner and no settings. `places` is the number of decimals that shows
// about a cent at the token's usual price.
export type Output = "usdc" | "eurc" | "weth" | "cbbtc" | "aero" | "hydx";
export type Swapper = {
  output: Output;
  symbol: string;
  token: Address;
  decimals: number;
  places: number;
  address: Address;
};
const swapper = (
  output: Output,
  symbol: string,
  token: Address,
  decimals: number,
  places: number,
  address: Address,
): Swapper => ({ output, symbol, token, decimals, places, address });
export const SWAPPERS: Swapper[] = [
  swapper("usdc", "USDC", USDC, 6, 2, "0x31791f453d2100e728E012c9e189C0828adf4b6F"),
  swapper("eurc", "EURC", EURC, 6, 2, "0x2cd8019d4F98e2fE2Ba705d8E7D38284c2a1450E"),
  swapper("weth", "WETH", WETH, 18, 6, "0xe5cbD828c2227E17f7FF8BD54C7A1e6012694Ff2"),
  swapper("cbbtc", "cbBTC", CBBTC, 8, 7, "0x54805B6E6266c952627E47B8ADe4ae65c5DEA7d0"),
  swapper(
    "aero",
    "AERO",
    "0x3f5bF3EdAc59d650D8fDf9657a71F2f904A3a4Ee",
    18,
    2,
    "0xdd575A498C625AF96ac89efE578Dc68f4c9aB963",
  ),
  swapper("hydx", "HYDX", HYDX, 18, 2, "0xC629B1A13a0E1d4F0C38cD80d22E4AAC363cc8bC"),
];
export const DEFAULT_OUTPUT: Output = "usdc";
export const swapperOf = (output: string): Swapper | undefined => SWAPPERS.find((each) => each.output === output);

// The swappers' exchanges, in the order the page lists them. `id` is the value of the swapper's `Exchange` enum. For
// Uniswap v4, `factory` is the PoolManager.
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
  { id: 1, name: "Hydrex Classic Pools", kind: "pair", factory: "0xC47F17c4fd96F50eFD2A2448ceDe5C185c084bf0" },
  { id: 0, name: "Hydrex Integral", kind: "algebra", factory: "0x36077D39cdC65E1e3FB65810430E5b2c4D5fA29E" },
];
// Prices come from Aero's, Aerodrome's and Hydrex's pools, and at an epoch's end from Hydrex's only. Of two equally
// deep pools, the first listed wins.
const PRICED = ["solidly", "slipstream", "aerodrome", "pair", "algebra"] as const;
export type PricedKind = (typeof PRICED)[number];
export const PRICING = EXCHANGES.filter(({ kind }) => (PRICED as readonly ExchangeKind[]).includes(kind));
export const HYDREX_PRICING = PRICING.filter(({ kind }) => kind === "pair" || kind === "algebra");
