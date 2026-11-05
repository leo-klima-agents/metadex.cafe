import { parseAbi } from "viem";

export const escrowAbi = parseAbi([
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
  "struct Point { int128 bias; int128 slope; int128 permanent; }",
  "function getFirstEscrowPoint(uint256 tokenId) view returns (Point point, uint48 timestamp)",
]);

export const voterAbi = parseAbi([
  "function _epochTimestamp() view returns (uint256)",
  "function lastVoted(address voter) view returns (uint256)",
  "function poolVoteLength(address voter) view returns (uint256)",
  "function poolVote(address voter, uint256 index) view returns (address)",
  "function length() view returns (uint256)",
  "function pools(uint256 index) view returns (address)",
  "function gauges(address pool) view returns (address)",
  "function internal_bribes(address gauge) view returns (address)",
  "function external_bribes(address gauge) view returns (address)",
  "function totalWeightAt(uint256 time) view returns (uint256)",
]);

// Shared by a pool's two reward contracts: the one for its fees (`internal_bribes`) and the one for its incentives
// (`external_bribes`).
export const rewardsAbi = parseAbi([
  "function totalSupplyAt(uint256 time) view returns (uint256)",
  "function balanceOfOwnerAt(address owner, uint256 time) view returns (uint256)",
  "function rewardsListLength() view returns (uint256)",
  "function rewardTokens(uint256 index) view returns (address)",
  "function rewardData(address token, uint256 time) view returns (uint256 periodFinish, uint256 rewardsPerEpoch, uint256 lastUpdateTime)",
  "function tokenTimestamp(uint256 tokenId, address token) view returns (uint256)",
  "function earned(uint256 tokenId, address token) view returns (uint256)",
  "function earnedTokenId(uint256 tokenId, address token, uint48 timestamp) view returns (uint256)",
  "function firstBribeTimestamp() view returns (uint256)",
]);

export const matchaLatteAbi = parseAbi([
  "function retireBps() view returns (uint256)",
  "function treasuryFeeBps() view returns (uint256)",
  "function MAX_TREASURY_FEE_BPS() view returns (uint256)",
  "function treasury() view returns (address)",
  "function totalTonnesRetired() view returns (uint256)",
  "event CarbonRetired(address indexed creditToken_, uint256 retireTonnes, uint256 kvcmSpent)",
  "event ClaimSwapAndDistributeCompleted(uint256 indexed tokenId, address indexed owner, address indexed recipient, address[] claimedTokens, uint256[] claimedAmounts, address[] distributedTokens, uint256[] distributedAmounts, uint256[] treasuryFees)",
]);

export const doubleEspressoAbi = parseAbi([
  "function claim(uint256 tokenId, address[] feeAddresses, address[] bribeAddresses, address[] tokens) returns (uint256[] amounts)",
  "function lastClaimBlock(uint256 tokenId) view returns (uint256)",
  "event Claimed(uint256 indexed tokenId, address indexed owner, address indexed caller, address[] tokens, uint256[] amounts, uint256[] fees, uint256 previousClaimBlock)",
]);

export const namesAbi = parseAbi(["function getBulkNames(uint256[] tokenIds) view returns (string[])"]);

export const aeroEscrowAbi = parseAbi([
  "function balanceOf(address owner) view returns (uint256)",
  "function ownerOf(uint256 tokenId) view returns (address)",
  "function tokenOfOwnerByIndex(address owner, uint256 index) view returns (uint256)",
  "function getApproved(uint256 tokenId) view returns (address)",
  "function isApprovedForAll(address owner, address operator) view returns (bool)",
  "function staked(uint256 tokenId) view returns ((uint128 amount, uint48 end, bool isPermanent))",
]);

export const aeroVoterAbi = parseAbi([
  "function allocationChainIds(uint256 tokenId) view returns (uint256[])",
  "function allocationChainAmounts(uint256 tokenId, uint256 chainId) view returns (uint128)",
  "struct ChainAllocationDispatch { uint256 chainId; uint128 delta; uint256 gasLimit; uint256 value; }",
  "struct GaugeAllocation { address gauge; uint128 allocated; bytes data; }",
  "struct GaugeAllocationDispatch { uint256 chainId; uint256 gasLimit; uint256 value; GaugeAllocation[] gauges; }",
  "function allocate(uint256 tokenId, ChainAllocationDispatch[] chainDispatches, GaugeAllocationDispatch[] gaugeDispatches, address refundRecipient) payable",
]);
// What Aero's Voter, and its LeafVoter on Base, which it calls in the same transaction, revert with when allocating.
export const allocateErrorsAbi = parseAbi([
  "error AllocationExpired()",
  "error ChainAllocationMismatch()",
  "error ChainAllocationMismatch(uint256 chainId)",
  "error ChainNotActiveOrSunset()",
  "error ChainNotActiveOrSunset(uint256 chainId)",
  "error CooldownActive()",
  "error ExceedsMaxGauges()",
  "error GaugesNotStrictlyAscending()",
  "error InsufficientChain0Allocation()",
  "error NotAuthorized()",
  "error StakeExpired()",
  "error StakeWithdrawn()",
  "error StaleShape()",
  "error SunsetDeallocOnly()",
  "error ZeroAllocation()",
]);

export const leafVoterAbi = parseAbi([
  "function allocationCooldown() view returns (uint48)",
  "function maxGauges() view returns (uint256)",
  "function isActivated(address gauge) view returns (bool)",
  "function tokenStates(uint256 tokenId) view returns (address operator, uint48 lastAllocated, bool canVoteForZeroCapGauges, uint128 chainAllocation)",
  "function accumulatedCooldownReduction(uint256 tokenId) view returns (uint48)",
  "function allocatedGauges(uint256 tokenId) view returns (address[])",
  "function allocations(uint256 tokenId, address gauge) view returns (uint128)",
]);

export const registryAbi = parseAbi([
  "function gaugeFactories() view returns (address[])",
  "function factoryToGauges(address factory) view returns (address[])",
  "function gaugeToTarget(address gauge) view returns (address)",
  "function gaugeToRewards(address gauge) view returns (address)",
  "function emissionCap(address gauge) view returns (uint128)",
]);

export const rewardsManagerAbi = parseAbi([
  "function token0() view returns (address)",
  "function token1() view returns (address)",
  "function totalSupply() view returns (uint256)",
  "function supplyAt(uint256 timestamp) view returns (uint256)",
  "function feeRewardPerVotingPower() view returns (uint256, uint256, uint256, uint256)",
  "function feeRewardPerVotingPowerAt(uint256 index) view returns (uint256, uint256, uint256, uint256)",
  "function getPriorSupplyIndex(uint256 timestamp) view returns (uint256)",
  "function globalRewardPointHistory(uint256 index) view returns ((int128 bias, int128 slope, uint48 ts, uint128 permanentStakeBalance, uint48 zeroSupplySeconds))",
  "function supplyAccumulatorAt(uint256 index) view returns (uint256 sharePerVote, uint256 weightedSharePerVote)",
  "function globalCheckpointIndex() view returns (uint256)",
  "function userRewardCheckpointIndex(uint256 tokenId) view returns (uint256)",
  "function feeClaimState(uint256 tokenId) view returns ((uint64 lastGlobalCp, uint64 lastUserCp))",
  "function incentiveCount() view returns (uint256)",
  "function incentive(uint256 programId) view returns ((address token, uint256 amount, uint256 rate, uint48 start, uint48 end, address creator))",
  "function earnedFees(uint256 tokenId, uint256 maxCheckpoints) view returns (uint256, uint256)",
  "function earnedIncentives(uint256 tokenId, uint256 programId, uint256 maxCheckpoints) view returns (uint256)",
]);

export const aeroPoolAbi = parseAbi(["function tickSpacing() view returns (int24)"]);
