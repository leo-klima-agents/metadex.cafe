import { erc20Abi, getAddress, type Address } from "viem";
import { SWAPPERS } from "./config.ts";
import list from "./base-tokens.json" with { type: "json" };
import { clean } from "./format.ts";
import { key, type Read, type Token } from "./prices.ts";
import { call, read, same } from "./rpc.ts";

export { erc20Abi };
// The tokens the page knows, whose balances it reads, as no RPC lists a wallet's tokens: Base's common tokens, and
// for the visit, Hydrex's reward tokens, those added by address, those the wallet lists, and those of a payout. `name`
// tells apart two listed tokens of one symbol.
type Listed = Token & { name?: string };
const LISTED = list as Listed[];
const more = new Map<string, Address>();
const hydrex = new Set<string>();
const described = new Map<string, Token>();

export const listed = (address: string): Listed | undefined => LISTED.find((token) => same(token.address, address));
// Hydrex's reward tokens also route through HYDX.
export function know(addresses: Address[], fromHydrex = false): void {
  for (const address of addresses) {
    if (!listed(address)) more.set(key(address), getAddress(address));
    if (fromHydrex) hydrex.add(key(address));
  }
}
export const isHydrex = (address: string): boolean => hydrex.has(key(address));
export const known = (): Address[] => [...LISTED.map(({ address }) => address), ...more.values()];
// A token with a listed token's symbol at another address: a symbol is whatever its contract says.
export const lookalike = (token: Token): Listed | undefined =>
  listed(token.address) ? undefined : LISTED.find((each) => each.symbol.toLowerCase() === token.symbol.toLowerCase());

// An amount of a token, in its smallest units.
export type Amount = { token: Address; amount: bigint };

// Each token's symbol and decimals, by lower-case address, as its contract answers. Those without decimals are left out.
export async function tokensOf(addresses: Address[], rd: Read = read): Promise<Map<string, Token>> {
  const unique = [...new Set(addresses.map(key))] as Address[];
  const found = await rd(
    unique.flatMap((address) => [call(address, erc20Abi, "symbol"), call(address, erc20Abi, "decimals")]),
  );
  return new Map(
    unique.flatMap((address, i) => {
      const [symbol, decimals] = found.slice(2 * i, 2 * i + 2) as [string?, number?];
      return decimals === undefined ? [] : [[address, { address, decimals, symbol: clean(symbol) || "?" }]];
    }),
  );
}
// The same, the list's own first, each read once.
export async function describe(addresses: Address[]): Promise<Map<string, Token>> {
  const unknown = addresses.filter((address) => !listed(address) && !described.has(key(address)));
  if (unknown.length) for (const [address, token] of await tokensOf(unknown)) described.set(address, token);
  return new Map(
    addresses.flatMap((address) => {
      const token = listed(address) ?? described.get(key(address));
      return token ? [[key(address), token] as const] : [];
    }),
  );
}

// The wallet's balance of each token, and what it allows `spender` to take. A failed read counts as nothing.
export async function holdingsOf(owner: Address, tokens: Address[], spender?: Address, rd: Read = read) {
  const width = spender ? 2 : 1;
  const replies = await rd(
    tokens.flatMap((token) => [
      call(token, erc20Abi, "balanceOf", owner),
      ...(spender ? [call(token, erc20Abi, "allowance", owner, spender)] : []),
    ]),
  );
  return new Map(
    tokens.map((token, i) => {
      const [balance = 0n, allowance = 0n] = replies.slice(width * i, width * i + width) as (bigint | undefined)[];
      return [key(token), { balance, allowance }];
    }),
  );
}

// What the wallet allows each swapper to take of each token, where it is more than nothing.
export type Allowance = { token: Address; spender: Address; amount: bigint };
export async function allowancesOf(owner: Address, tokens: Address[], rd: Read = read): Promise<Allowance[]> {
  const pairs = tokens.flatMap((token) => SWAPPERS.map(({ address }) => ({ token, spender: address })));
  const replies = await rd(pairs.map(({ token, spender }) => call(token, erc20Abi, "allowance", owner, spender)));
  return pairs.flatMap((pair, i) => (replies[i] ? [{ ...pair, amount: replies[i] as bigint }] : []));
}
