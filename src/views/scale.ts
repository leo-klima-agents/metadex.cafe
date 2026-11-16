// The arithmetic of `chart.ts`, apart from the page, so that it can be tested without one.

// Ticks around the values, about four steps of 1, 2 or 5 times a power of ten: from the last tick below the lowest
// value, never below zero, up to the first at or above the highest. Starting at zero would squeeze lines that lie close
// together into a thin band; the axis's labels still give each line's value.
export function ticksOf(least: number, most: number): number[] {
  if (!(most > 0)) return [0, 1];
  const low = Math.max(0, Math.min(least, most));
  const rough = (most - low || most) / 4;
  const power = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 5, 10].map((k) => k * power).find((each) => each >= rough)!;
  const first = Math.max(0, Math.ceil(low / step - 1e-9) - 1);
  const last = Math.max(first + 1, Math.ceil(most / step - 1e-9));
  // Rounded, so that 0.1 + 0.2 shows as 0.3.
  return Array.from({ length: last - first + 1 }, (_, i) => Number(((first + i) * step).toPrecision(12)));
}
// Moves labels apart, keeping their order, so that none is closer than `gap` to the next, nor outside `low`–`high`. Each
// stays as near its own place as it can.
export function spread(at: number[], gap: number, low: number, high: number): number[] {
  const order = at.map((_, i) => i).sort((a, b) => at[a]! - at[b]!);
  const placed = order.map((i) => at[i]!);
  for (let k = 0; k < placed.length; k++) placed[k] = Math.max(placed[k]!, low, k ? placed[k - 1]! + gap : low);
  for (let k = placed.length - 1; k >= 0; k--)
    placed[k] = Math.min(placed[k]!, k < placed.length - 1 ? placed[k + 1]! - gap : high);
  const moved = [...at];
  order.forEach((i, k) => (moved[i] = placed[k]!));
  return moved;
}
