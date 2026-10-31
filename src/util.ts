import type { Address } from "viem";

export const key = (address: string): string => address.toLowerCase();
// Unlike viem's isAddressEqual, never throws, even on a failed read's undefined.
export const same = (a: string, b: string): boolean => key(a) === key(b);
export const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));
export const sum = (values: number[]): number => values.reduce((total, value) => total + value, 0);
export const unique = <T>(items: T[], id: (item: T) => string = String): T[] => [
  ...new Map(items.map((item) => [id(item), item])).values(),
];

export function maxBy<T>(items: T[], of: (item: T) => number | bigint): T | undefined {
  let best: T | undefined;
  for (const item of items) if (best === undefined || of(item) > of(best)) best = item;
  return best;
}

export type Amount = { token: Address; amount: bigint };
export const positive = (tokens: readonly Address[], values: readonly bigint[]): Amount[] =>
  tokens.map((token, i) => ({ token, amount: values[i] ?? 0n })).filter(({ amount }) => amount > 0n);
export function sumByToken(amounts: Amount[]): Amount[] {
  const all = new Map<string, Amount>();
  for (const { token, amount } of amounts)
    all.set(key(token), { token, amount: (all.get(key(token))?.amount ?? 0n) + amount });
  return [...all.values()];
}
// What is left of `from` once `less` is taken, token by token.
export const minus = (from: Amount[], less: Amount[]): Amount[] =>
  from
    .map(({ token, amount }) => ({
      token,
      amount: amount - (less.find((each) => same(each.token, token))?.amount ?? 0n),
    }))
    .filter(({ amount }) => amount > 0n);

// A promise per key, shared by callers; a failure is forgotten, and so is anything older than `ttl` ms.
export function memo<K, V>(read: (arg: K) => Promise<V>, ttl = Infinity, id: (arg: K) => string = String) {
  const kept = new Map<string, { at: number; value: Promise<V> }>();
  return (arg: K): Promise<V> => {
    const name = id(arg);
    const found = kept.get(name);
    if (found && Date.now() - found.at < ttl) return found.value;
    const entry = { at: Date.now(), value: read(arg) };
    kept.set(name, entry);
    entry.value.catch(() => kept.get(name) === entry && kept.delete(name));
    return entry.value;
  };
}

// The items in order, in as few groups as keep each group's cost within `limit`.
export function packInOrder<T>(items: T[], cost: (group: T[]) => bigint, limit: bigint): T[][] {
  const groups: T[][] = [];
  for (const item of items) {
    const last = groups.at(-1);
    if (last && cost([...last, item]) <= limit) last.push(item);
    else groups.push([item]);
  }
  return groups;
}
