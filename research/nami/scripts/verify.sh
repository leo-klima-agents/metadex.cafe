#!/usr/bin/env bash
# Re-reads every on-chain fact the Nami due-diligence report relies on. Read-only: it only makes eth_call-style requests.
# Needs Foundry's `cast` on PATH and BASE_RPC_URL in the environment. The other RPCs default to public endpoints.
set -u
BASE="--rpc-url ${BASE_RPC_URL:?set BASE_RPC_URL}"
ETH="--rpc-url ${ETH_RPC_URL:-https://ethereum-rpc.publicnode.com}"
RH="--rpc-url ${ROBINHOOD_RPC_URL:-https://robinhood-rpc.publicnode.com}"
SONIC="--rpc-url ${SONIC_RPC_URL:-https://rpc.soniclabs.com}"

NAMI=0x8888CDad9Ef66382f89E68f95Ec384d89ec28888
VE=0x808015d4BE11b5b8AD5aD9AFdC8463Bf4f9E8080
OG=0x11110ecC00D927f70Be6E35adb24BB7d3dC11111
SOG=0x0101d61ab0Af01FE430db7c287B8f2704Ae30101
MINTER=0x789e34340C5dE24533b3400DbE17E7787D403044
SETTLEMENT=0x8cdd7856A842Ec343Ab420aC0FE86F4102473bE6
VOTER_REWARDS_ETH=0x98ceaF3d05B35d5DABde1d023DA5298dFa839348
SAFE_ETH=0x52a34381251fA5531746EAa952b7153ff9FFA56b
SAFE_BASE_TREASURY=0x0db1e546Bd8b3B3DA2a08E543E72C69b9bc652c7
SAFE_BASE_UNSOLD=0x764AaBe5987dA77c22D5995F1E44D64CeB9207ac
TIMELOCK_1D_ETH=0xed2ebf7B0C43398F7EC5b517A4C87BF799A8Cd5F
TIMELOCK_3D_ETH=0xd82869395ddbCEfe960b940358F16ca4cba8A577
DEPLOYER=0x2358545eef7e56B2eBEACbf62212278dD27a99DB
SWAPX_WALLET=0xe67E6a96235A4f7A81B8532f3d491c20DaADe2cd
VE_SWPX=0xAA30F0977620D4d46B3Bb3Cf0794Fe645d576CA3
SWPX=0xA04BC7140c26fc9BB1F36B1A604C7A5a88fb0E70
SWAPX_MINTER=0x8b8c58CC70D13905EbF46c2a5ed1f41D52c83364
PRESALE_READER=0x24c7deC79f247ad8E7f26309a10C1a873663EA09
ALGEBRA_FACTORY_BASE=0xf4502A98A15e82D66d28D2381E2F3A407ea45b83
WETH_BASE=0x4200000000000000000000000000000000000006
CHAINLINK_ETH_USD_BASE=0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70
IMPL_SLOT=0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc
ADMIN_SLOT=0xb53127684a568b3173ae13b9f8a6016e243e63b6e8ee1178d6a717850b5d6103

# `$1` is a label; the rest is a cast command line. Prints the first line of the answer, or the error.
show() { local label=$1; shift; printf '%-44s %s\n' "$label" "$("$@" 2>&1 | head -1)"; }
section() { printf '\n## %s\n' "$1"; }

section "Blocks read"
show "Ethereum block" cast block-number $ETH
show "Base block" cast block-number $BASE
show "Robinhood Chain block" cast block-number $RH
show "Sonic block" cast block-number $SONIC
show "Time (UTC)" date -u +%Y-%m-%dT%H:%M:%SZ

section "1. NAMI supply: liquid NAMI plus burned-into-veNAMI, per chain (sum should be 1,200,000e18)"
for chain in ETH BASE RH; do
  rpc=${!chain}
  show "$chain NAMI totalSupply" cast call $NAMI "totalSupply()(uint256)" $rpc
  show "$chain veNAMI supply" cast call $VE "supply()(uint256)" $rpc
  show "$chain veNAMI infinityNFTBalance" cast call $VE "infinityNFTBalance()(uint256)" $rpc
  show "$chain veNAMI lastTokenId" cast call $VE "lastTokenId()(uint256)" $rpc
done
show "NamiHub GENESIS_SUPPLY" cast call $NAMI "GENESIS_SUPPLY()(uint256)" $ETH

section "2. Who holds the voting power (Ethereum veNAMI #2)"
show "ownerOf(2)" cast call $VE "ownerOf(uint256)(address)" 2 $ETH
show "locked(2) = (amount,end,isINFT)" cast call $VE "locked(uint256)((int128,uint64,bool))" 2 $ETH
show "Safe threshold" cast call $SAFE_ETH "getThreshold()(uint256)" $ETH
show "Safe owners" cast call $SAFE_ETH "getOwners()(address[])" $ETH

section "3. Minter (Ethereum hub): emission parameters"
for f in "owner()(address)" "weekly()(uint256)" "EMISSION()(uint256)" "rebaseRate()(uint256)" "lockIncentiveRate()(uint256)" \
  "isEpochsStarted()(bool)" "initialWeeklySet()(bool)" "weekNumber()(uint256)" "active_period()(uint256)"; do
  show "Minter.$f" cast call $MINTER "$f" $ETH
done

section "4. Admin keys (Ethereum hub)"
show "veNAMI diamond owner" cast call $VE "owner()(address)" $ETH
show "1-day timelock getMinDelay" cast call $TIMELOCK_1D_ETH "getMinDelay()(uint256)" $ETH
show "3-day timelock getMinDelay" cast call $TIMELOCK_3D_ETH "getMinDelay()(uint256)" $ETH
show "Safe is proposer on 1-day timelock" cast call $TIMELOCK_1D_ETH "hasRole(bytes32,address)(bool)" "$(cast keccak PROPOSER_ROLE)" $SAFE_ETH $ETH
show "Safe is executor on 1-day timelock" cast call $TIMELOCK_1D_ETH "hasRole(bytes32,address)(bool)" "$(cast keccak EXECUTOR_ROLE)" $SAFE_ETH $ETH
minter_admin=0x$(cast storage $MINTER $ADMIN_SLOT $ETH | cut -c27-)
show "Minter ProxyAdmin" echo "$minter_admin"
show "Minter ProxyAdmin owner" cast call "$minter_admin" "owner()(address)" $ETH
show "NAMI DEFAULT_ADMIN_ROLE: 1-day timelock" cast call $NAMI "hasRole(bytes32,address)(bool)" 0x0000000000000000000000000000000000000000000000000000000000000000 $TIMELOCK_1D_ETH $ETH
show "NAMI BRIDGE_LIMITS_ROLE: Safe" cast call $NAMI "hasRole(bytes32,address)(bool)" "$(cast keccak BRIDGE_LIMITS_ROLE)" $SAFE_ETH $ETH

section "5. Emissions settlement and voter-reward roots (Ethereum hub)"
for target in "EmissionsSettlement=$SETTLEMENT" "VoterRewards=$VOTER_REWARDS_ETH"; do
  name=${target%%=*} addr=${target##*=}
  show "$name owner" cast call "$addr" "owner()(address)" $ETH
  show "$name disputeWindow (seconds)" cast call "$addr" "disputeWindow()(uint32)" $ETH
  show "$name reviewThreshold" cast call "$addr" "reviewThreshold()(uint16)" $ETH
  for role in DISPUTER_ROLE KEEPER_ROLE MERKLE_ROOT_MANAGER; do
    hash=$(cast keccak $role)
    show "$name $role count" cast call "$addr" "getRoleMemberCount(bytes32)(uint256)" "$hash" $ETH
    show "$name $role member 0" cast call "$addr" "getRoleMember(bytes32,uint256)(address)" "$hash" 0 $ETH
  done
done

section "6. Presale and ogNAMI (Base)"
show "getPresaleInfo()" cast call $PRESALE_READER "getPresaleInfo()((address,address,address,address,address,uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint256,bool,bool,bool,uint256,uint256,uint256,uint256,uint256,bool,uint256))" $BASE
show "vaultCount()" cast call $PRESALE_READER "vaultCount()(uint256)" $BASE
show "ogNAMI totalSupply" cast call $OG "totalSupply()(uint256)" $BASE
show "sogNAMI totalSupply (staked)" cast call $SOG "totalSupply()(uint256)" $BASE
show "ogNAMI held by team Safe (unsold)" cast call $OG "balanceOf(address)(uint256)" $SAFE_BASE_UNSOLD $BASE
show "that Safe's threshold" cast call $SAFE_BASE_UNSOLD "getThreshold()(uint256)" $BASE
show "that Safe's owners" cast call $SAFE_BASE_UNSOLD "getOwners()(address[])" $BASE

section "7. Market (Base). Algebra globalState = (sqrtPriceX96, tick, lastFee, pluginConfig, communityFee, unlocked)"
nami_pool=$(cast call $ALGEBRA_FACTORY_BASE "poolByPair(address,address)(address)" $NAMI $WETH_BASE $BASE)
og_pool=$(cast call $ALGEBRA_FACTORY_BASE "poolByPair(address,address)(address)" $OG $WETH_BASE $BASE)
show "NAMI/WETH pool" echo "$nami_pool"
show "NAMI/WETH token0" cast call "$nami_pool" "token0()(address)" $BASE
show "NAMI/WETH globalState" echo "$(cast call "$nami_pool" "globalState()(uint160,int24,uint16,uint8,uint16,bool)" $BASE | tr '\n' ' ')"
show "NAMI/WETH pool WETH balance" cast call $WETH_BASE "balanceOf(address)(uint256)" "$nami_pool" $BASE
show "NAMI/WETH pool NAMI balance" cast call $NAMI "balanceOf(address)(uint256)" "$nami_pool" $BASE
show "ogNAMI/WETH pool" echo "$og_pool"
show "ogNAMI/WETH token0" cast call "$og_pool" "token0()(address)" $BASE
show "ogNAMI/WETH globalState" echo "$(cast call "$og_pool" "globalState()(uint160,int24,uint16,uint8,uint16,bool)" $BASE | tr '\n' ' ')"
show "ogNAMI/WETH pool ogNAMI balance" cast call $OG "balanceOf(address)(uint256)" "$og_pool" $BASE
show "Chainlink ETH/USD answer (8 decimals)" echo "$(cast call $CHAINLINK_ETH_USD_BASE "latestRoundData()(uint80,int256,uint256,uint256,uint80)" $BASE | sed -n 2p)"

section "8. The SwapX link"
show "Nami deployer's first funding: from" cast tx 0x944e69555c739277156aa26bcbc207f530a87e6ff7745262cd7456176453d16d from $ETH
show "Nami deployer's first funding: to" cast tx 0x944e69555c739277156aa26bcbc207f530a87e6ff7745262cd7456176453d16d to $ETH
show "swapx.eth resolves to" cast resolve-name swapx.eth $ETH
show "swapx.eth registrant" cast call 0x57f1887a8BF19b14fC0dF6Fd9B2acc9Af147eA85 "ownerOf(uint256)(address)" "$(cast keccak swapx)" $ETH
show "veSWPx (Sonic) name" cast call $VE_SWPX "name()(string)" $SONIC
show "veSWPx implementation slot" cast storage $VE_SWPX $IMPL_SLOT $SONIC
show "that implementation was created by" cast tx 0xab37c58c48b59d9feb8f34c3b5fd971f30d56b99cfaaf2a3d66c142defa14195 from $SONIC
show "and the creation made contract" cast receipt 0xab37c58c48b59d9feb8f34c3b5fd971f30d56b99cfaaf2a3d66c142defa14195 contractAddress $SONIC

section "9. SwapX today (Sonic)"
show "SWPx totalSupply" cast call $SWPX "totalSupply()(uint256)" $SONIC
show "SwapX minter weekly" cast call $SWAPX_MINTER "weekly()(uint256)" $SONIC
swapx_owner=$(cast call $SWAPX_MINTER "owner()(address)" $SONIC)
show "SwapX minter owner" echo "$swapx_owner"
show "SwapX owner Safe threshold" cast call "$swapx_owner" "getThreshold()(uint256)" $SONIC
show "SwapX owner Safe owners" cast call "$swapx_owner" "getOwners()(address[])" $SONIC
