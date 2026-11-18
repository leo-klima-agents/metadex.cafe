// Fetches every GaugesAllocated event of Aero's LeafVoter on Base since launch, into data/allocations.json.
// publicnode serves old logs, 50,000 blocks per request.
import { decodeEventLog, parseAbi, type Hex } from "viem";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { LEAF_VOTER } from "../src/config.ts";

const RPC = "https://base-rpc.publicnode.com";
const FIRST = 52_900_000;
const SPAN = 50_000;
const abi = parseAbi([
  "event GaugesAllocated(uint256 indexed tokenId, (address gauge, uint128 allocated, bytes data)[] gauges, uint256 total)",
]);
const OUT = new URL("./data/allocations.json", import.meta.url);

type Log = { topics: Hex[]; data: Hex; blockNumber: Hex; blockTimestamp: Hex; transactionHash: Hex; logIndex: Hex };
export type Allocation = {
  id: string;
  block: number;
  time: number;
  log: number;
  tx: string;
  total: string;
  gauges: { gauge: string; amount: string }[];
};

async function post(method: string, params: unknown[]): Promise<any> {
  for (let attempt = 0; ; attempt++) {
    try {
      const response = await fetch(RPC, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      });
      const reply = await response.json();
      if (reply.error) throw new Error(JSON.stringify(reply.error));
      return reply.result;
    } catch (error) {
      if (attempt >= 6) throw error;
      await new Promise((done) => setTimeout(done, 500 * 2 ** attempt));
    }
  }
}

const topic = "0xb13b0fcaf992c63a38992e4eeb65a542452c8366b7d9d8d7ca306ee1293dc2ba";
const known: Allocation[] = existsSync(OUT) ? JSON.parse(readFileSync(OUT, "utf8")) : [];
const head = parseInt(await post("eth_blockNumber", []), 16) - 100;
let from = known.length ? Math.max(...known.map(({ block }) => block)) + 1 : FIRST;
const found = known.filter(({ block }) => block < from);
while (from <= head) {
  const to = Math.min(from + SPAN - 1, head);
  const logs: Log[] = await post("eth_getLogs", [
    { address: LEAF_VOTER, topics: [topic], fromBlock: `0x${from.toString(16)}`, toBlock: `0x${to.toString(16)}` },
  ]);
  for (const log of logs) {
    const { args } = decodeEventLog({ abi, data: log.data, topics: log.topics as [Hex, ...Hex[]] });
    found.push({
      id: args.tokenId.toString(),
      block: parseInt(log.blockNumber, 16),
      time: parseInt(log.blockTimestamp, 16),
      log: parseInt(log.logIndex, 16),
      tx: log.transactionHash,
      total: args.total.toString(),
      gauges: args.gauges.map(({ gauge, allocated }) => ({ gauge: gauge.toLowerCase(), amount: allocated.toString() })),
    });
  }
  process.stderr.write(`\r${to} (${found.length} allocations)`);
  from = to + 1;
}
found.sort((a, b) => a.block - b.block || a.log - b.log);
writeFileSync(OUT, JSON.stringify(found));
console.error(`\nSaved ${found.length} allocations up to block ${head}.`);
