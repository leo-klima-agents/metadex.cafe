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
