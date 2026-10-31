import { readFileSync, writeFileSync } from "node:fs";
import { getAddress, type Address } from "viem";
import { ABI, type Token } from "../src/config.ts";
import { call, read } from "../src/rpc.ts";

// Checks src/tokens.json against Base: `--add 0x…` adds a token, `--write` writes Base's answers back.
const PATH = new URL("../src/tokens.json", import.meta.url);
const list = JSON.parse(readFileSync(PATH, "utf8")) as Token[];
for (const [i, arg] of process.argv.entries())
  if (process.argv[i - 1] === "--add" && !list.some(({ address }) => address.toLowerCase() === arg.toLowerCase()))
    list.push({ symbol: "", address: getAddress(arg), decimals: 0 });
const found = await read(
  list.flatMap(({ address }) => ["symbol", "decimals"].map((name) => call(address as Address, ABI.erc20, name))),
);
const checked = list.flatMap((token, i) => {
  const [symbol, decimals] = found.slice(2 * i, 2 * i + 2) as [string | undefined, number | undefined];
  if (symbol === undefined || decimals === undefined) {
    console.log(`${token.address} (${token.symbol}) does not answer as a token.`);
    return token.symbol ? [token] : [];
  }
  const answer = { ...token, symbol, decimals, address: getAddress(token.address) };
  if (JSON.stringify(answer) !== JSON.stringify(token))
    console.log(`${token.address}: ${token.symbol} ${token.decimals} listed, ${symbol} ${decimals} on Base.`);
  return [answer];
});
if (process.argv.includes("--write")) writeFileSync(PATH, `${JSON.stringify(checked, null, 2)}\n`);
