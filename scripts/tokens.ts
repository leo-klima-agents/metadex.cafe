import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { getAddress, type Address } from "viem";
import { same } from "../src/rpc.ts";
import { tokensOf } from "../src/tokens.ts";

// Checks `src/base-tokens.json` against Base: each token's symbol and decimals, as its contract answers now. `node
// scripts/tokens.ts` prints what differs, `--add 0x…` checks a new token with the rest, and `--write` writes Base's
// answers back, added tokens included. A listed token that no longer answers is left as it is, for its maintainer to
// remove by hand.

const PATH = fileURLToPath(new URL("../src/base-tokens.json", import.meta.url));
type Entry = { symbol: string; name?: string; address: Address; decimals: number };

const list = JSON.parse(readFileSync(PATH, "utf8")) as Entry[];
const added = process.argv.flatMap((arg, i) => (process.argv[i - 1] === "--add" ? [getAddress(arg)] : []));
for (const address of added) {
  if (!list.some((entry) => same(entry.address, address))) list.push({ symbol: "", address, decimals: 0 });
}
const found = await tokensOf(list.map(({ address }) => address));
let differs = 0;
const checked = list.map((entry) => {
  const token = found.get(entry.address.toLowerCase());
  if (!token) {
    console.log(`${entry.address} (${entry.symbol}) does not answer as a token.`);
    differs++;
    return entry;
  }
  if (
    token.symbol !== entry.symbol ||
    token.decimals !== entry.decimals ||
    getAddress(entry.address) !== entry.address
  ) {
    console.log(
      `${entry.address}: ${entry.symbol} ${entry.decimals} on the list, ${token.symbol} ${token.decimals} on Base.`,
    );
    differs++;
  }
  return { ...entry, symbol: token.symbol, address: getAddress(entry.address), decimals: token.decimals };
});
// An added token that does not answer is dropped; only tokens already on the list are kept for their maintainer.
const kept = checked.filter(({ address }) => found.has(address.toLowerCase()) || !added.includes(getAddress(address)));
if (process.argv.includes("--write")) writeFileSync(PATH, `${JSON.stringify(kept, null, 2)}\n`);
else if (!differs) console.log(`All ${list.length} tokens are as Base says.`);
