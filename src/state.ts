// A value read from Base: kept when a later read fails, shared while under way, read again when due.
export const RETRY = 300_000;
// No read is due again sooner than this after the last began, however it ended.
export const SOON = 10_000;

export type Reader<T> = {
  readonly value: T | undefined;
  readonly reading: boolean;
  readonly failed: boolean;
  read(): Promise<T>;
  // Reads anew, dropping a read under way; the value stays until then.
  refresh(): Promise<T>;
  due(): boolean;
  check(): void;
  forget(): void;
};

type Options<T> = { stale?: (value: T, since: number) => boolean; retry?: number };

// Every reader calls update() as it settles, so the page draws again.
export function reader<T>(read: (before: T | undefined) => Promise<T>, options: Options<T> = {}): Reader<T> {
  const { stale = () => false, retry = RETRY } = options;
  let value: T | undefined;
  let failed = false;
  let tried = 0;
  let pending: Promise<T> | undefined;
  let generation = 0;
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
    read() {
      if (pending) return pending;
      const at = generation;
      tried = Date.now();
      pending = read(value)
        .then(
          (found) => {
            if (at === generation) [value, failed] = [found, false];
            return found;
          },
          (error: unknown) => {
            console.error(error);
            if (at === generation) failed = true;
            throw error;
          },
        )
        .finally(() => {
          if (at !== generation) return;
          pending = undefined;
          update();
        });
      return pending;
    },
    refresh() {
      generation++;
      pending = undefined;
      return self.read();
    },
    due() {
      const since = Date.now() - tried;
      if (pending || since < SOON) return false;
      return failed ? since >= retry : value === undefined || stale(value, since);
    },
    check() {
      if (self.due()) self.read().catch(() => {});
    },
    forget() {
      generation++;
      [value, failed, tried, pending] = [undefined, false, 0, undefined];
    },
  };
  return self;
}

const renders: (() => void)[] = [];
let scheduled = false;
export const onUpdate = (render: () => void): void => void renders.push(render);
// Draws the page again, once a frame however often it is asked.
export function update(): void {
  if (scheduled || typeof requestAnimationFrame === "undefined") return;
  scheduled = true;
  requestAnimationFrame(() => {
    scheduled = false;
    for (const render of renders) render();
  });
}
