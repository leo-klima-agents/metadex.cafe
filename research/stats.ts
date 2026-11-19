// Small statistics helpers for the research scripts. Pure functions, so they can be tested.

// A seeded generator (mulberry32). Each test of each strategy gets its own, seeded by `seedOf`, so a change to one test
// doesn't move the random draws of another.
export function generator(seed: number): () => number {
  let state = seed | 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
// FNV-1a, 32 bits.
export function seedOf(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 0x01000193);
  return hash >>> 0;
}

export const mean = (xs: ArrayLike<number>): number => {
  let sum = 0;
  for (let i = 0; i < xs.length; i++) sum += xs[i]!;
  return sum / xs.length;
};
// The population variance.
export function variance(xs: ArrayLike<number>): number {
  const m = mean(xs);
  let sum = 0;
  for (let i = 0; i < xs.length; i++) sum += (xs[i]! - m) ** 2;
  return sum / xs.length;
}
export const median = (xs: number[]): number => [...xs].sort((a, b) => a - b)[xs.length >> 1]!;

// Benjamini–Hochberg q-values, in the order of `ps`.
export function bh(ps: number[]): number[] {
  const order = ps.map((p, i) => [p, i] as const).sort((a, b) => a[0] - b[0]);
  const qs = new Array<number>(ps.length);
  let min = 1;
  for (let n = order.length - 1; n >= 0; n--) {
    const [p, i] = order[n]!;
    min = Math.min(min, (p * order.length) / (n + 1));
    qs[i] = min;
  }
  return qs;
}

// The normal quantile, Φ⁻¹(p), by Acklam's approximation.
export function probit(p: number): number {
  const a = [
    -39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716, 2.506628277459239,
  ];
  const b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572];
  const c = [
    -0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968,
    2.938163982698783,
  ];
  const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];
  const q = Math.min(Math.max(p, 1e-12), 1 - 1e-12);
  if (q < 0.02425) {
    const r = Math.sqrt(-2 * Math.log(q));
    return (
      (((((c[0]! * r + c[1]!) * r + c[2]!) * r + c[3]!) * r + c[4]!) * r + c[5]!) /
      ((((d[0]! * r + d[1]!) * r + d[2]!) * r + d[3]!) * r + 1)
    );
  }
  if (q > 1 - 0.02425) return -probit(1 - q);
  const r = (q - 0.5) * (q - 0.5);
  return (
    ((((((a[0]! * r + a[1]!) * r + a[2]!) * r + a[3]!) * r + a[4]!) * r + a[5]!) * (q - 0.5)) /
    (((((b[0]! * r + b[1]!) * r + b[2]!) * r + b[3]!) * r + b[4]!) * r + 1)
  );
}

// Ranks from 0, with ties given the mean of the ranks they span.
export function ranks(xs: ArrayLike<number>): number[] {
  const order = Array.from(xs, (x, i) => [x, i] as const).sort((a, b) => a[0] - b[0]);
  const out = new Array<number>(xs.length);
  for (let start = 0; start < order.length;) {
    let end = start + 1;
    while (end < order.length && order[end]![0] === order[start]![0]) end++;
    for (let n = start; n < end; n++) out[order[n]![1]] = (start + end - 1) / 2;
    start = end;
  }
  return out;
}
// Each value's rank among the others, scaled to [0, 1]: 0 for the lowest, 1 for the highest, ties in the middle.
export function scaledRanks(xs: ArrayLike<number>): Float64Array {
  const r = ranks(xs);
  return Float64Array.from(r, (rank) => (xs.length > 1 ? rank / (xs.length - 1) : 0.5));
}
export function spearman(a: number[], b: number[]): number {
  const [ra, rb] = [ranks(a), ranks(b)];
  const [ma, mb] = [mean(ra), mean(rb)];
  let [num, da, db] = [0, 0, 0];
  for (let i = 0; i < a.length; i++) {
    num += (ra[i]! - ma) * (rb[i]! - mb);
    da += (ra[i]! - ma) ** 2;
    db += (rb[i]! - mb) ** 2;
  }
  return num / Math.sqrt(da * db);
}
