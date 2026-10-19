import { parseAbi, type Address, type Hex } from "viem";
import { call, read, required, rpc } from "./chain.ts";
import { ETH_USD_FEED, GAS_PRICE_ORACLE } from "./config.ts";
import type { Tx } from "./wallet.ts";

const oracleAbi = parseAbi(["function getL1FeeUpperBound(uint256 unsignedTxSize) view returns (uint256)"]);
const feedAbi = parseAbi([
  "function decimals() view returns (uint8)",
  "function latestRoundData() view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)",
]);

// A transaction's fields other than its data, before its signature, take about this many bytes.
const FIELDS = 50;

// Dollars of ETH, at Chainlink's price.
export const ethToUsd = (wei: bigint, answer: bigint, decimals: number): number =>
  (Number(wei) / 1e18) * (Number(answer) / 10 ** decimals);

// What the calls would cost in gas, in dollars: the gas Base estimates for each, at Base's gas price, and at most what
// posting each to Ethereum costs. A wallet that sends them in one transaction may spend a little less.
export async function gasCost(from: Address, txs: Tx[]): Promise<number> {
  const [gases, price, found] = await Promise.all([
    Promise.all(txs.map(({ to, data }) => rpc<Hex>("eth_estimateGas", [{ from, to, data }]))),
    rpc<Hex>("eth_gasPrice", []),
    read([
      call(ETH_USD_FEED, feedAbi, "decimals"),
      call(ETH_USD_FEED, feedAbi, "latestRoundData"),
      ...txs.map(({ data }) =>
        call(GAS_PRICE_ORACLE, oracleAbi, "getL1FeeUpperBound", BigInt((data.length - 2) / 2 + FIELDS)),
      ),
    ]),
  ]);
  const [decimals, [, answer], ...posting] = required(found) as [number, readonly bigint[], ...bigint[]];
  const wei = gases.reduce((sum, gas) => sum + BigInt(gas) * BigInt(price), 0n) + posting.reduce((a, b) => a + b, 0n);
  return ethToUsd(wei, answer!, decimals);
}
