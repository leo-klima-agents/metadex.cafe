import { getAddress, type Address } from "viem";
import { ABI, SWAPPERS, TOKENS, type Token } from "./config.ts";
import { clean } from "./format.ts";
import { call, read, type Read } from "./rpc.ts";
import { key, same } from "./util.ts";

// No RPC lists a wallet's tokens: the page reads the balances of those it knows. Those it learns of during the visit,
// Hydrex's reward tokens among them, which also route through HYDX.
const more = new Map<string, Address>();
const hydrex = new Set<string>();
export const listed = (address: string): Token | undefined => TOKENS.find((token) => same(token.address, address));
export function know(addresses: Address[], fromHydrex = false): void {
  for (const address of addresses) {
    if (!listed(address)) more.set(key(address), getAddress(address));
    if (fromHydrex) hydrex.add(key(address));
  }
}
export const isHydrex = (address: string): boolean => hydrex.has(key(address));
export const known = (): Address[] => [...TOKENS.map(({ address }) => address), ...more.values()];

// Another token with a listed token's symbol: a symbol is whatever its contract says.
export const lookalike = (token: Token): Token | undefined =>
  listed(token.address) ? undefined : TOKENS.find((each) => each.symbol.toLowerCase() === token.symbol.toLowerCase());

// Each token's symbol and decimals, by lower-case address, read once; tokens without decimals cannot be counted.
const described = new Map<string, Token>();
export async function tokensOf(addresses: Address[], reader: Read = read): Promise<Map<string, Token>> {
  const unread = [...new Set(addresses.map(key))].filter((address) => !listed(address) && !described.has(address));
  const found = await reader(
    unread.flatMap((address) => ["symbol", "decimals"].map((name) => call(address as Address, ABI.erc20, name))),
  );
  unread.forEach((address, i) => {
    const [symbol, decimals] = found.slice(2 * i, 2 * i + 2) as [string | undefined, number | undefined];
    if (decimals !== undefined)
      described.set(address, { address: address as Address, decimals, symbol: clean(symbol) || "?" });
  });
  return new Map(
    addresses.flatMap((address) => {
      const token = listed(address) ?? described.get(key(address));
      return token ? [[key(address), token] as const] : [];
    }),
  );
}

// Each balance, and what `spender` may take, by lower-case address; a failed read counts as nothing.
export async function holdingsOf(owner: Address, tokens: Address[], spender?: Address, reader: Read = read) {
  const width = spender ? 2 : 1;
  const replies = await reader(
    tokens.flatMap((token) => [
      call(token, ABI.erc20, "balanceOf", owner),
      ...(spender ? [call(token, ABI.erc20, "allowance", owner, spender)] : []),
    ]),
  );
  return new Map(
    tokens.map((token, i) => {
      const [balance, allowance] = replies.slice(width * i, width * i + width) as (bigint | undefined)[];
      return [key(token), { balance: balance ?? 0n, allowance: allowance ?? 0n }];
    }),
  );
}

// What the wallet lets each swapper take of each token, where it is something.
export type Allowance = { token: Address; spender: Address; amount: bigint };
export async function allowancesOf(owner: Address, tokens: Address[], reader: Read = read): Promise<Allowance[]> {
  const pairs = tokens.flatMap((token) => SWAPPERS.map(({ address }) => ({ token, spender: address })));
  const replies = await reader(pairs.map(({ token, spender }) => call(token, ABI.erc20, "allowance", owner, spender)));
  return pairs.flatMap((pair, i) => (replies[i] ? [{ ...pair, amount: replies[i] as bigint }] : []));
}
