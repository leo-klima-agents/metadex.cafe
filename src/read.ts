import { PENDING, type Text } from "./dom.ts";

// What the page reads from Base, as it keeps it: the last value read, kept when a later read fails; the read under way,
// which every caller shares; when the last read began, and whether it failed. A read is due when none was made, five
// minutes, or `retry`, after one that failed, and when what it found is stale, as from an epoch that has ended. Until
// one succeeds, what shows it is pending, then says "Not read yet" once one failed: the page reads it again when due.
export const RETRY = 300_000;

export type Reader<T> = {
  readonly value: T | undefined;
  readonly reading: boolean;
  readonly failed: boolean;
  // When the last read began, as Date.now().
  readonly tried: number;
  // Reads now, or joins the read under way: resolves to what it found, or rejects as it failed.
  read(): Promise<T>;
  // Reads anew, dropping a read under way, as after a transaction it may not see: what was read stays until then.
  refresh(): Promise<T>;
  // Whether a read is due, and a read if so. What shows the value hears how it went through `settled`.
  due(): boolean;
  check(): void;
  // Forgets what was read, and drops a read under way, as when what it reads changes.
  forget(): void;
  // How to show it: pending until read, "Not read yet" once a read failed with nothing read before, then its words.
  text<W extends Text | (() => Text)>(words: (value: T) => W): W | Text;
};

export type ReaderOptions<T> = {
  // Whether what was read should be read again, `since` the read that found it began, in ms.
  stale?: (value: T, since: number) => boolean;
  retry?: number;
  // Called once each read ends, found or failed, unless it was forgotten meanwhile.
  settled?: () => void;
};

// `read` is given what was read before, if anything: it may answer the same when nothing is newer.
export function reader<T>(read: (before: T | undefined) => Promise<T>, options: ReaderOptions<T> = {}): Reader<T> {
  const { stale = () => false, retry = RETRY, settled = () => {} } = options;
  let value: T | undefined;
  let failed = false;
  let tried = 0;
  let pending: Promise<T> | undefined;
  // Reads begun before the last forget() are dropped.
  let forgotten = 0;
  const self: Reader<T> = {
    get value() {
      return value;
    },
    get reading() {
      return !!pending;
    },
    get failed() {
      return failed;
    },
    get tried() {
      return tried;
    },
    read() {
      if (pending) return pending;
      const at = forgotten;
      const current = () => forgotten === at;
      tried = Date.now();
      const reading = read(value)
        .then(
          (found) => {
            if (current()) [value, failed] = [found, false];
            return found;
          },
          (error: unknown) => {
            console.error(error);
            if (current()) failed = true;
            throw error;
          },
        )
        .finally(() => {
          if (!current()) return;
          pending = undefined;
          settled();
        });
      pending = reading;
      return reading;
    },
    refresh() {
      forgotten++;
      pending = undefined;
      return self.read();
    },
    due() {
      if (pending) return false;
      const since = Date.now() - tried;
      if (failed) return since >= retry;
      return value === undefined || stale(value, since);
    },
    check() {
      if (self.due()) self.read().catch(() => {});
    },
    forget() {
      forgotten++;
      [value, failed, tried, pending] = [undefined, false, 0, undefined];
    },
    text: (words) => (value !== undefined ? words(value) : failed ? "Not read yet" : PENDING),
  };
  return self;
}
