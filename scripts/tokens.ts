import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { getAddress, type Address } from "viem";
import { tokensOf } from "../src/earnings.ts";

// Checks the page's list of tokens, src/base-tokens.json, against Base: each address's symbol and decimals, as its
// contract answers them now. `node scripts/tokens.ts` prints what differs; with --write, it writes the list back with
// Base's answers, and `node scripts/tokens.ts --add 0x…` adds a token. A token that no longer answers is left as it is,
// for its maintainer to remove by hand.

const PATH = fileURLToPath(new URL("../src/base-tokens.json", import.meta.url));
type Entry = { symbol: string; name?: string; address: string; decimals: number };

const list = JSON.parse(readFileSync(PATH, "utf8")) as Entry[];
const added = process.argv.flatMap((arg, i) => (process.argv[i - 1] === "--add" ? [getAddress(arg)] : []));
for (const address of added) {
  if (!list.some((entry) => entry.address.toLowerCase() === address.toLowerCase()))
    list.push({ symbol: "", address, decimals: 0 });
}
const found = await tokensOf(list.map(({ address }) => address as Address));
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
if (process.argv.includes("--write")) writeFileSync(PATH, `${JSON.stringify(checked, null, 2)}\n`);
else if (!differs) console.log(`All ${list.length} tokens are as Base says.`);
