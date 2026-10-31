import { parseAbi, type Address } from "viem";
import tokens from "./tokens.json" with { type: "json" };

export const CHAIN_ID = 8453;
// In this order: drpc serves old blocks for free, publicnode only with a paid token.
export const RPCS = ["https://mainnet.base.org", "https://base.drpc.org", "https://base-rpc.publicnode.com"];
export const BASESCAN = "https://basescan.org";

export type Kind = "matcha-latte" | "double-espresso";
// `actions` are what joining approves: 3 sends the claims to the automation, 5 delegates the votes.
export type Automation = { kind: Kind; name: string; contract: string; address: Address; actions: number[] };
export const MATCHA_LATTE: Automation = {
  kind: "matcha-latte",
  name: "Matcha Latte",
  contract: "KlimaVeTokenConduit",
  address: "0xdE91885cF35ac57DF0c4A75c16862127dBe8317c",
  actions: [3, 5],
};
// ImmutableVeTokenConduit v2 (github.com/ldeso/hydrex-conduit, tag v2): no owner; its 1% fee and recipient are immutable.
export const DOUBLE_ESPRESSO: Automation = {
  kind: "double-espresso",
  name: "Double Espresso",
  contract: "ImmutableVeTokenConduit",
  address: "0x692c323B425A9DfeebE302F56168a7798D93EAC5",
  actions: [3, 5],
};
export const AUTOMATIONS = [MATCHA_LATTE, DOUBLE_ESPRESSO];
export const byKind = (kind: string) => AUTOMATIONS.find((automation) => automation.kind === kind);
export const FEE_BPS = 100n; // Double Espresso's and the swappers', of each claim and each route's output
export const FEE_RECIPIENT: Address = "0x450c72de8c0079B49AcedF294a13011bd09D125B"; // a 2-of-3 Safe
export const MATCHA_LATTE_OPERATOR: Address = "0x17f513C024C1C67db050258ba569c714a9CF1B12";

export const MULTICALL3: Address = "0xcA11bde05977b3631167028862bE2a173976CA11";
export const KVCM: Address = "0x00fBAC94Fec8D4089d3fe979F39454F48c71A65d";
export const VOTING_ESCROW: Address = "0x25B2ED7149fb8A05f6eF9407d9c8F878f59cd1e1";
export const VOTING_ESCROW_IMPLEMENTATION: Address = "0x0FC68cE53Be957a1AA779f553AD49f6068fFf231";
export const APPROVAL_LOGIC: Address = "0x4B0BC0889EB524Dbae36d409fF733851E9B4f63D";
export const VOTER: Address = "0xc69E3eF39E3fFBcE2A1c570f8d3ADF76909ef17b";
export const ACCOUNT_NAMES: Address = "0x998cf40a742460b4eBbFB569A0D23eA91976c0d3";
export const GAS_PRICE_ORACLE: Address = "0x420000000000000000000000000000000000000F";

export const WETH: Address = "0x4200000000000000000000000000000000000006";
export const USDC: Address = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
export const CBBTC: Address = "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf";
export const EURC: Address = "0x60a3E35Cc302bFA44Cb288Bc5a4F316Fdb1adb42";
export const HYDX: Address = "0x00000e7efa313F4E11Bfff432471eD9423AC6B30";
export const AERO: Address = "0x3f5bF3EdAc59d650D8fDf9657a71F2f904A3a4Ee";

export type Token = { address: Address; decimals: number; symbol: string; name?: string };
export const TOKENS = tokens as Token[];

// Anchors price every other token, each by its Chainlink feed (8 decimals): USDC, ETH, BTC and EURC / USD.
export const ANCHORS: (Token & { feed: Address })[] = [
  [USDC, "0x7e860098F58bBFC8648a4311b374B1D669a2bc6B"],
  [WETH, "0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70"],
  [CBBTC, "0x64c911996D3c6aC71f9b455B1E8E7266BcbD848F"],
  [EURC, "0xDAe398520e2B67cd3f27aeF9Cf14D93D927f8250"],
].map(([address, feed]) => ({ ...TOKENS.find((token) => token.address === address)!, feed: feed as Address }));
export const CURRENCIES = ["USD", "EUR", "GBP", "CHF", "AUD", "CAD"] as const;
export type Currency = (typeof CURRENCIES)[number];
// Each currency / USD, by Chainlink, 8 decimals.
export const FIAT_FEEDS: Record<Exclude<Currency, "USD">, Address> = {
  EUR: "0xc91D87E81faB8f93699ECf7Ee9B44D11e1D53F0F",
  GBP: "0xCceA6576904C118037695eB71195a5425E69Fa15",
  CHF: "0x3A1d6444fb6a402470098E23DaD0B7E86E14252F",
  AUD: "0x46e51B8cA41d709928EdA9Ae43e42193E6CDf229",
  CAD: "0xA840145F87572E82519d578b1F36340368a25D5d",
};

// ImmutableSwapper, one per output (`token`), at `address`, deployed 21 Oct 2026. `places`: decimals worth about a cent.
export type Swapper = {
  output: string;
  symbol: string;
  token: Address;
  decimals: number;
  places: number;
  address: Address;
};
export const SWAPPERS: Swapper[] = (
  [
    ["usdc", USDC, 2, "0x31791f453d2100e728E012c9e189C0828adf4b6F"],
    ["eurc", EURC, 2, "0x2cd8019d4F98e2fE2Ba705d8E7D38284c2a1450E"],
    ["weth", WETH, 6, "0xe5cbD828c2227E17f7FF8BD54C7A1e6012694Ff2"],
    ["cbbtc", CBBTC, 7, "0x54805B6E6266c952627E47B8ADe4ae65c5DEA7d0"],
    ["aero", AERO, 2, "0xdd575A498C625AF96ac89efE578Dc68f4c9aB963"],
    ["hydx", HYDX, 2, "0xC629B1A13a0E1d4F0C38cD80d22E4AAC363cc8bC"],
  ] as const
).map(([output, token, places, address]) => {
  const { symbol, decimals } = TOKENS.find((each) => each.address === token)!;
  return { output, symbol, token, decimals, places, address };
});
export const swapperOf = (output: string) => SWAPPERS.find((each) => each.output === output);

// `id` is the swapper's Exchange enum. Aero's basic pools have a factory per curve; Uniswap v4's is its PoolManager.
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
// Prices come from these pools, the first of two as deep winning.
export const PRICING = EXCHANGES.filter(({ kind }) => ["solidly", "aerodrome", "pair", "algebra"].includes(kind));

// Every contract the page links to, by the name its markup gives in data-address.
export const ADDRESSES: Record<string, Address> = {
  matchaLatte: MATCHA_LATTE.address,
  doubleEspresso: DOUBLE_ESPRESSO.address,
  votingEscrow: VOTING_ESCROW,
  voter: VOTER,
  kvcm: KVCM,
  feeRecipient: FEE_RECIPIENT,
  operator: MATCHA_LATTE_OPERATOR,
  ...Object.fromEntries(SWAPPERS.map(({ output, address }) => [`swapper-${output}`, address])),
};

export const ABI = {
  multicall3: parseAbi([
    "function aggregate3((address target, bool allowFailure, bytes callData)[] calls) payable returns ((bool success, bytes returnData)[])",
    "function getCurrentBlockTimestamp() view returns (uint256 timestamp)",
  ]),
  escrow: parseAbi([
    "function balanceOf(address owner) view returns (uint256)",
    "function ownerOf(uint256 tokenId) view returns (address)",
    "function tokenOfOwnerByIndex(address owner, uint256 index) view returns (uint256)",
    "function lockDetails(uint256 tokenId) view returns ((uint256 amount, uint256 startTime, uint256 endTime, uint8 lockType))",
    "function balanceOfNFT(uint256 tokenId) view returns (uint256)",
    "function balanceOfNFTAt(uint256 tokenId, uint256 timestamp) view returns (uint256)",
    "function getLockDelegatee(uint256 tokenId) view returns (address)",
    "function delegates(uint256 tokenId, uint48 timestamp) view returns (address)",
    "function getClaimRedirectApproved(uint256 tokenId) view returns (address)",
    "function getPastVotes(address account, uint256 timepoint) view returns (uint256)",
    "function getConduitApprovalConfig(address conduit) view returns (uint8[] actions, bool active, string description)",
    "function approvalLogic() view returns (address)",
    "function setConduitApproval(address conduit, uint256 tokenId, bool approve)",
  ]),
  voter: parseAbi([
    "function _epochTimestamp() view returns (uint256)",
    "function lastVoted(address voter) view returns (uint256)",
    "function poolVoteLength(address voter) view returns (uint256)",
    "function poolVote(address voter, uint256 index) view returns (address)",
    "function length() view returns (uint256)",
    "function pools(uint256 index) view returns (address)",
    "function gauges(address pool) view returns (address)",
    "function internal_bribes(address gauge) view returns (address)",
    "function external_bribes(address gauge) view returns (address)",
  ]),
  matchaLatte: parseAbi([
    "function retireBps() view returns (uint256)",
    "function treasuryFeeBps() view returns (uint256)",
    "function MAX_TREASURY_FEE_BPS() view returns (uint256)",
    "function treasury() view returns (address)",
    "function totalTonnesRetired() view returns (uint256)",
    "event CarbonRetired(address indexed creditToken_, uint256 retireTonnes, uint256 kvcmSpent)",
    "event ClaimSwapAndDistributeCompleted(uint256 indexed tokenId, address indexed owner, address indexed recipient, address[] claimedTokens, uint256[] claimedAmounts, address[] distributedTokens, uint256[] distributedAmounts, uint256[] treasuryFees)",
  ]),
  doubleEspresso: parseAbi([
    "function lastClaimBlock(uint256 tokenId) view returns (uint256)",
    "function claim(uint256 tokenId, address[] feeAddresses, address[] bribeAddresses, address[] tokens) returns (uint256[] amounts)",
    "event Claimed(uint256 indexed tokenId, address indexed owner, address indexed caller, address[] tokens, uint256[] amounts, uint256[] fees, uint256 previousClaimBlock)",
  ]),
  rewards: parseAbi([
    "function totalSupplyAt(uint256 time) view returns (uint256)",
    "function balanceOfOwnerAt(address owner, uint256 time) view returns (uint256)",
    "function rewardsListLength() view returns (uint256)",
    "function rewardTokens(uint256 index) view returns (address)",
    "function rewardData(address token, uint256 time) view returns (uint256 periodFinish, uint256 rewardsPerEpoch, uint256 lastUpdateTime)",
    "function tokenTimestamp(uint256 tokenId, address token) view returns (uint256)",
    "function earned(uint256 tokenId, address token) view returns (uint256)",
  ]),
  erc20: parseAbi([
    "function balanceOf(address owner) view returns (uint256)",
    "function allowance(address owner, address spender) view returns (uint256)",
    "function approve(address spender, uint256 amount) returns (bool)",
    "function symbol() view returns (string)",
    "function decimals() view returns (uint8)",
  ]),
  gasPriceOracle: parseAbi(["function getL1FeeUpperBound(uint256 unsignedTxSize) view returns (uint256)"]),
  accountNames: parseAbi(["function getBulkNames(uint256[] tokenIds) view returns (string[])"]),
  feed: parseAbi([
    "function latestRoundData() view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)",
  ]),
  pair: parseAbi([
    "function getReserves() view returns (uint256 reserve0, uint256 reserve1, uint256 blockTimestampLast)",
    "function observe(uint32[] secondsAgos) view returns (uint256[] reserve0Cumulatives, uint256[] reserve1Cumulatives)",
    "function observationLength() view returns (uint256)",
    "function observations(uint256 index) view returns (uint256 timestamp, uint256 reserve0Cumulative, uint256 reserve1Cumulative)",
    "function currentCumulativePrices() view returns (uint256 reserve0Cumulative, uint256 reserve1Cumulative, uint256 blockTimestamp)",
  ]),
  algebraPool: parseAbi([
    "function getReserves() view returns (uint128 reserve0, uint128 reserve1)",
    "function globalState() view returns (uint160 price, int24 tick, uint16 lastFee, uint8 pluginConfig, uint16 communityFee, bool unlocked)",
    "function plugin() view returns (address)",
    "function getTimepoints(uint32[] secondsAgos) view returns (int56[] tickCumulatives, uint88[] volatilityCumulatives)",
  ]),
  factory: parseAbi([
    "function poolByPair(address tokenA, address tokenB) view returns (address)",
    "function getPair(address tokenA, address tokenB) view returns (address)",
    "function getPool(address tokenA, address tokenB) view returns (address)",
    "function tickSpacings() view returns (int24[])",
    "function extsload(bytes32 startSlot, uint256 nSlots) view returns (bytes32[])",
  ]),
  pairFactory: parseAbi(["function getPair(address tokenA, address tokenB, bool stable) view returns (address)"]),
  stableFactory: parseAbi(["function getPool(address tokenA, address tokenB, bool stable) view returns (address)"]),
  slipstreamFactory: parseAbi([
    "function getPool(address tokenA, address tokenB, int24 tickSpacing) view returns (address)",
  ]),
  v3Factory: parseAbi(["function getPool(address tokenA, address tokenB, uint24 fee) view returns (address)"]),
  swapper: parseAbi([
    "struct Hop { uint8 exchange; address pool; address tokenOut; uint24 fee; int24 tickSpacing; }",
    "struct Route { address token; uint256 amount; uint256 minPaid; Hop[] hops; }",
    "struct Result { bool done; uint256 amountIn; uint256 amountOut; bytes reason; }",
    "function swap(Route[] routes, uint256 deadline, bool skipFailed) returns (Result[] results, uint256 paid, uint256 fee)",
    "function quote(Route[] routes) returns (Result[] results)",
    "event RouteSwapped(address indexed caller, uint256 index, address token, uint256 amountIn, uint256 amountOut)",
    "event RouteFailed(address indexed caller, uint256 index, address token, bytes reason)",
    "event Swapped(address indexed caller, uint256 paid, uint256 fee)",
    "error Expired()",
    "error BadHopCount(uint256 route)",
    "error BadPath(uint256 route, uint256 hop)",
    "error NotExchangePool(uint8 exchange, address pool)",
    "error NativeOutsideV4(uint256 route, uint256 hop)",
    "error NoOutput(uint256 route, uint256 hop)",
    "error PartialFill(address pool)",
    "error NotExpectedCaller(address caller)",
    "error TooLittle(uint256 route, uint256 paid, uint256 minPaid)",
    "error Quoted(uint256 amountOut)",
    "error TokenCallFailed(address token)",
    "error OnlySelf()",
    "error Reentrancy()",
    "error ZeroAddress()",
  ]),
};
