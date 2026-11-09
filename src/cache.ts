// Every read from Base the page keeps, by key: its value or error, and any read under way. A failed read stays failed
// until `retry()`, or a `refresh()` of its key. A read past its time to live (in ms) is made again and shows its last
// value meanwhile. A read given no time to live keeps its key's previous one.
type TTL<T> = number | ((value: T) => number);
type Entry = { value?: unknown; error?: unknown; reading?: Promise<unknown>; at: number; ttl: TTL<never> };
const entries = new Map<string, Entry>();
let settled = (): void => {};
export const onSettle = (listener: () => void): void => void (settled = listener);

export function memo<T>(key: string, read: () => Promise<T>, ttl?: TTL<T>): Promise<T> {
  const entry = entries.get(key);
  if (entry?.reading) return entry.reading as Promise<T>;
  if (entry && "error" in entry) return Promise.reject(entry.error);
  const fresh = (entry: Entry) =>
    performance.now() - entry.at < (typeof entry.ttl === "number" ? entry.ttl : entry.ttl(entry.value as never));
  if (entry && "value" in entry && fresh(entry)) return Promise.resolve(entry.value as T);
  const next: Entry = { ...entry, at: performance.now(), ttl: ttl ?? entry?.ttl ?? Infinity };
  const reading = read().then(
    (value) => {
      if (entries.get(key) === next) [next.value, next.reading] = [value, undefined];
      return value;
    },
    (error: unknown) => {
      console.error(key, error);
      if (entries.get(key) === next) {
        [next.error, next.reading] = [error, undefined];
        delete next.value;
      }
      throw error;
    },
  );
  next.reading = reading.finally(settled);
  next.reading.catch(() => {});
  entries.set(key, next);
  return reading;
}

// What a view shows of a read. `use` also starts the read if it is due.
export type Got<T> = { value?: T; failed?: true };
export function use<T>(key: string, read: () => Promise<T>, ttl?: TTL<T>): Got<T> {
  memo(key, read, ttl).catch(() => {});
  const entry = entries.get(key)!;
  return "value" in entry ? { value: entry.value as T } : "error" in entry ? { failed: true } : {};
}

export const andThen = <T, U>(got: Got<T>, next: (value: T) => Got<U>): Got<U> =>
  got.value !== undefined ? next(got.value) : got.failed ? { failed: true } : {};

export function retry(): void {
  for (const [key, entry] of entries) if ("error" in entry) entries.delete(key);
  settled();
}
// Makes every read whose key starts with `prefix` due again, failed or not, keeping its last value on show meanwhile.
// For use after a transaction.
export function refresh(prefix: string): void {
  for (const [key, { error: _, ...entry }] of entries)
    if (key.startsWith(prefix)) entries.set(key, { ...entry, at: -Infinity, reading: undefined });
  settled();
}
export const failures = (): number => [...entries.values()].filter((entry) => "error" in entry).length;
// Forgets the settled reads whose keys start with one of `prefixes` and that were made over `age` ms ago: reads keyed by
// a time that has moved on, which nothing asks for again.
export function prune(prefixes: readonly string[], age: number): void {
  const now = performance.now();
  for (const [key, entry] of entries)
    if (!entry.reading && now - entry.at > age && prefixes.some((prefix) => key.startsWith(prefix)))
      entries.delete(key);
}
