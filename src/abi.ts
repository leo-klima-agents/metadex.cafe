import { parseAbi } from "viem";

export const multicall3Abi = parseAbi([
  "function aggregate3((address target, bool allowFailure, bytes callData)[] calls) payable returns ((bool success, bytes returnData)[])",
]);

export const votingEscrowAbi = parseAbi([
  "function balanceOf(address owner) view returns (uint256)",
  "function tokenOfOwnerByIndex(address owner, uint256 index) view returns (uint256)",
  "function lockDetails(uint256 tokenId) view returns ((uint256 amount, uint256 startTime, uint256 endTime, uint8 lockType))",
  "function balanceOfNFT(uint256 tokenId) view returns (uint256)",
  "function getLockDelegatee(uint256 tokenId) view returns (address)",
  "function delegates(uint256 tokenId, uint48 timestamp) view returns (address)",
  "function getClaimRedirectApproved(uint256 tokenId) view returns (address)",
  "function getPastVotes(address account, uint256 timepoint) view returns (uint256)",
  "function getConduitApprovalConfig(address conduit) view returns (uint8[] actions, bool active, string description)",
  "function approvalLogic() view returns (address)",
  "function setConduitApproval(address conduit, uint256 tokenId, bool approve)",
]);

export const voterAbi = parseAbi([
  "function _epochTimestamp() view returns (uint256)",
  "function lastVoted(address voter) view returns (uint256)",
  "function poolVoteLength(address voter) view returns (uint256)",
  "function poolVote(address voter, uint256 index) view returns (address)",
  "function votes(address voter, address pool) view returns (uint256)",
]);

export const conduitAbi = parseAbi([
  "function veToken() view returns (address)",
  "function voter() view returns (address)",
  "function kvcm() view returns (address)",
  "function retireBps() view returns (uint256)",
  "function treasuryFeeBps() view returns (uint256)",
  "function totalTonnesRetired() view returns (uint256)",
  "function retiringEntityName() view returns (string)",
  "function getEffectiveRecipientForOwner(address owner) view returns (address)",
  "function setMyPayoutRecipient(address newRecipient)",
]);

export const accountNamesAbi = parseAbi(["function getBulkNames(uint256[] tokenIds) view returns (string[])"]);

export const poolAbi = parseAbi([
  "function token0() view returns (address)",
  "function token1() view returns (address)",
  "function symbol() view returns (string)",
]);
