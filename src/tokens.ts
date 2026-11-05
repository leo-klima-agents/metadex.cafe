import { erc20Abi, getAddress, type Address } from "viem";
import { SWAPPERS } from "./config.ts";
import list from "./base-tokens.json" with { type: "json" };
import { clean } from "./format.ts";
import { key, type Token } from "./prices.ts";
import { call, read, readEach, same, type Read } from "./rpc.ts";

// The tokens whose balances the page reads, since no RPC lists a wallet's tokens: Base's common tokens and, for this
// visit, Hydrex's reward tokens and any token added by address, listed by the wallet or seen in a payout. `name` tells
// apart two listed tokens with the same symbol.
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
// A token at another address that uses a listed token's symbol. Any contract can claim any symbol.
export const lookalike = (token: Token): Listed | undefined =>
  listed(token.address) ? undefined : LISTED.find((each) => each.symbol.toLowerCase() === token.symbol.toLowerCase());

// An amount of a token, in its smallest units.
export type Amount = { token: Address; amount: bigint };

// Each token's decimals as its contract gives them, and its symbol cleaned, or "?" if unread, keyed by lower-case
// address. A token whose `decimals` read fails is left out.
export async function tokensOf(addresses: Address[], rd: Read = read): Promise<Map<string, Token>> {
  const unique = [...new Set(addresses.map((address) => key(address)))];
  const found = await readEach(
    unique,
    {
      symbol: (address) => call(address, erc20Abi, "symbol"),
      decimals: (address) => call(address, erc20Abi, "decimals"),
    },
    rd,
  );
  return new Map(
    found.flatMap(({ item: address, symbol, decimals }) =>
      decimals === undefined ? [] : [[address, { address, decimals, symbol: clean(symbol) || "?" }]],
    ),
  );
}
// Like `tokensOf`, but takes listed tokens from the list and keeps every other token once read. A token whose read
// fails is read again next time.
export async function describe(addresses: Address[], rd: Read = read): Promise<Map<string, Token>> {
  const unknown = addresses.filter((address) => !listed(address) && !described.has(key(address)));
  if (unknown.length) for (const [address, token] of await tokensOf(unknown, rd)) described.set(address, token);
  return new Map(
    addresses.flatMap((address) => {
      const token = listed(address) ?? described.get(key(address));
      return token ? [[key(address), token] as const] : [];
    }),
  );
}

// The wallet's balance of each token and its allowance for `spender`. A failed read counts as zero.
export async function holdingsOf(owner: Address, tokens: Address[], spender?: Address, rd: Read = read) {
  const found = await readEach(
    tokens,
    {
      balance: (token) => call(token, erc20Abi, "balanceOf", owner),
      allowance: spender ? (token) => call(token, erc20Abi, "allowance", owner, spender) : undefined,
    },
    rd,
  );
  return new Map(found.map(({ item, balance = 0n, allowance = 0n }) => [key(item), { balance, allowance }]));
}

export type Allowance = { token: Address; spender: Address; amount: bigint };
export async function allowancesOf(owner: Address, tokens: Address[], rd: Read = read): Promise<Allowance[]> {
  const pairs = tokens.flatMap((token) => SWAPPERS.map(({ address }) => ({ token, spender: address })));
  const found = await readEach(
    pairs,
    { amount: ({ token, spender }) => call(token, erc20Abi, "allowance", owner, spender) },
    rd,
  );
  return found.flatMap(({ item, amount }) => (amount ? [{ ...item, amount }] : []));
}
