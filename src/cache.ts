// Every read from Base the page keeps, by key: its value, or why it failed, and the read under way. A failed read
// stays failed until retry(). One past its time to live is read again, and shows its last value meanwhile. A read
// given no time to live keeps the one its key had.
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
  const next: Entry = { ...entry, at: performance.now(), ttl: (ttl ?? entry?.ttl ?? Infinity) as TTL<never> };
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

// What a view shows of a read: its value, if any, and whether it failed. Starts the read if due.
export type Got<T> = { value?: T; failed?: true };
export function use<T>(key: string, read: () => Promise<T>, ttl?: TTL<T>): Got<T> {
  memo(key, read, ttl).catch(() => {});
  const entry = entries.get(key)!;
  return "value" in entry ? { value: entry.value as T } : "error" in entry ? { failed: true } : {};
}

// The second read, once the first has a value.
export const then = <T, U>(got: Got<T>, next: (value: T) => Got<U>): Got<U> =>
  got.value !== undefined ? next(got.value) : got.failed ? { failed: true } : {};

// Forgets what failed, so that it is read again.
export function retry(): void {
  for (const [key, entry] of entries) if ("error" in entry) entries.delete(key);
  settled();
}
// Reads again what starts with `prefix`, failed or not, showing what was read meanwhile, as after a transaction.
export function refresh(prefix: string): void {
  for (const [key, { error: _, ...entry }] of entries)
    if (key.startsWith(prefix)) entries.set(key, { ...entry, at: -Infinity, reading: undefined });
  settled();
}
export const failures = (): number => [...entries.values()].filter((entry) => "error" in entry).length;
