// Fetches every GaugesAllocated event of Aero's LeafVoter on Base since launch, into data/allocations.json, with the
// last block searched. publicnode serves old logs, 50,000 blocks per request and 20,000 logs per answer.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { decodeEventLog, parseAbi, type Hex } from "viem";
import { LEAF_VOTER } from "../src/config.ts";
import { dataUrl, timeOfBlock, type Allocation, type Allocations } from "./common.ts";

const RPC = "https://base-rpc.publicnode.com";
const FIRST = 52_900_000;
const SPAN = 50_000;
const abi = parseAbi([
  "event GaugesAllocated(uint256 indexed tokenId, (address gauge, uint128 allocated, bytes data)[] gauges, uint256 total)",
]);
const topic = "0xb13b0fcaf992c63a38992e4eeb65a542452c8366b7d9d8d7ca306ee1293dc2ba";
const OUT = dataUrl("allocations.json");

type Log = { topics: Hex[]; data: Hex; blockNumber: Hex; blockTimestamp?: Hex; logIndex: Hex };
class TooMany extends Error {}

async function post<T>(method: string, params: unknown[]): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      const response = await fetch(RPC, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      });
      const reply = (await response.json()) as { result?: T; error?: { message?: string } };
      if (reply.error && /max results|too many|exceed/i.test(reply.error.message ?? "")) throw new TooMany();
      if (reply.error || reply.result === undefined) throw new Error(JSON.stringify(reply.error));
      return reply.result;
    } catch (error) {
      if (error instanceof TooMany || attempt >= 6) throw error;
      await new Promise((done) => setTimeout(done, 500 * 2 ** attempt));
    }
  }
}
// The range's logs, halving it for as long as an answer would hold too many.
async function logsIn(from: number, to: number): Promise<Log[]> {
  try {
    return await post<Log[]>("eth_getLogs", [
      { address: LEAF_VOTER, topics: [topic], fromBlock: `0x${from.toString(16)}`, toBlock: `0x${to.toString(16)}` },
    ]);
  } catch (error) {
    if (!(error instanceof TooMany) || from === to) throw error;
    const middle = Math.floor((from + to) / 2);
    return [...(await logsIn(from, middle)), ...(await logsIn(middle + 1, to))];
  }
}

mkdirSync(new URL(".", OUT), { recursive: true });
const known: Allocations | undefined = existsSync(OUT) ? JSON.parse(readFileSync(OUT, "utf8")) : undefined;
const head = parseInt(await post<string>("eth_blockNumber", []), 16) - 100;
let from = known ? known.head + 1 : FIRST;
const found: Allocation[] = known?.allocations ?? [];
while (from <= head) {
  const to = Math.min(from + SPAN - 1, head);
  for (const log of await logsIn(from, to)) {
    const { args } = decodeEventLog({ abi, data: log.data, topics: log.topics as [Hex, ...Hex[]] });
    const block = parseInt(log.blockNumber, 16);
    const time = timeOfBlock(block);
    if (log.blockTimestamp && parseInt(log.blockTimestamp, 16) !== time)
      throw new Error(`Block ${block} is not at ${time}: Base's block schedule (BLOCK_SCHEDULE) has changed.`);
    found.push({
      id: args.tokenId.toString(),
      block,
      time,
      log: parseInt(log.logIndex, 16),
      gauges: args.gauges.map(({ gauge, allocated }) => ({ gauge: gauge.toLowerCase(), amount: allocated.toString() })),
    });
  }
  process.stderr.write(`\r${to} (${found.length} allocations)`);
  from = to + 1;
}
found.sort((a, b) => a.block - b.block || a.log - b.log);
const out: Allocations = { head, headTime: timeOfBlock(head), allocations: found };
writeFileSync(OUT, JSON.stringify(out));
console.error(`\nSaved ${found.length} allocations up to block ${head}.`);
