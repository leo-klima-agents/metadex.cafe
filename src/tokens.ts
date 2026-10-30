import { getAddress, type Address } from "viem";
import { call, read, same } from "./chain.ts";
import { SWAPPERS } from "./config.ts";
import { tokensOf } from "./earnings.ts";
import list from "./base-tokens.json" with { type: "json" };
import type { Token } from "./prices.ts";
import { erc20Abi } from "./swap.ts";

// The tokens the page knows, whose balances it reads: a short list of Base's common tokens, built into the page, the
// six outputs, which are on it, and, for the visit, Hydrex's reward tokens, those added by address, those the wallet
// lists, and those of a payout. No RPC lists a wallet's tokens, so the page reads the balances of those it knows, in one
// read. `name` tells apart two listed tokens of one symbol.

export type Listed = Token & { name?: string };
export const LISTED: Listed[] = list.map(({ address, ...rest }) => ({ ...rest, address: address as Address }));

const key = (address: string): string => address.toLowerCase();
const more = new Map<string, Address>();
const hydrex = new Set<string>();

export const listed = (address: string): Listed | undefined => LISTED.find((token) => same(token.address, address));

// Tokens to know for the visit. Hydrex's reward tokens also route through HYDX.
export function know(addresses: Address[], fromHydrex = false): void {
  for (const address of addresses) {
    if (!listed(address)) more.set(key(address), getAddress(address));
    if (fromHydrex) hydrex.add(key(address));
  }
}

export const isHydrex = (address: string): boolean => hydrex.has(key(address));

export const known = (): Address[] => [...LISTED.map(({ address }) => address), ...more.values()];

// A token whose symbol is one of a listed token's, at another address: the page says so, as a symbol is whatever its
// contract says.
export function lookalike(token: Token): Listed | undefined {
  if (listed(token.address)) return undefined;
  const symbol = token.symbol.toLowerCase();
  return LISTED.find((each) => each.symbol.toLowerCase() === symbol);
}

// Each token's symbol and decimals: the list's own, or read from its contract. Tokens without decimals are left out.
// Each is read once.
const described = new Map<string, Token>();

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

// The wallet's balance of each token, and what it allows `spender` to take, by lower-case address. A failed read
// counts as nothing.
export async function holdingsOf(
  owner: Address,
  tokens: Address[],
  spender?: Address,
  reader: typeof read = read,
): Promise<Map<string, { balance: bigint; allowance: bigint }>> {
  const replies = await reader(
    tokens.flatMap((token) => [
      call(token, erc20Abi, "balanceOf", owner),
      ...(spender ? [call(token, erc20Abi, "allowance", owner, spender)] : []),
    ]),
  );
  const width = spender ? 2 : 1;
  return new Map(
    tokens.map((token, i) => {
      const [balance, allowance = 0n] = replies.slice(width * i, width * i + width) as (bigint | undefined)[];
      return [key(token), { balance: balance ?? 0n, allowance: allowance ?? 0n }];
    }),
  );
}

// What the wallet allows each swapper to take of each token, where it is more than nothing.
export type Allowance = { token: Address; spender: Address; amount: bigint };

export async function allowancesOf(
  owner: Address,
  tokens: Address[],
  reader: typeof read = read,
): Promise<Allowance[]> {
  const pairs = tokens.flatMap((token) => SWAPPERS.map(({ address }) => ({ token, spender: address })));
  const replies = await reader(pairs.map(({ token, spender }) => call(token, erc20Abi, "allowance", owner, spender)));
  return pairs.flatMap((pair, i) => {
    const amount = replies[i] as bigint | undefined;
    return amount ? [{ ...pair, amount }] : [];
  });
}
