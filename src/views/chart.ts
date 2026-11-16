import { render } from "../state.ts";
import { spread, ticksOf } from "./scale.ts";

// A line chart of a few series over a few positions. It is drawn at its own width, so its text keeps its size. The
// first series is drawn on top, except that a `bold` one is always on top, and the others are then drawn thinner. A
// `reference`, such as an average to compare with, is drawn thin and dotted, without dots. A missing value breaks a
// line. `short` names the series beside its last value.
export type Series = {
  id: string;
  name: string;
  short: string;
  color: string;
  dashed?: boolean;
  reference?: boolean;
  bold?: boolean;
  values: (number | undefined)[];
};
// The dashes of a dashed line and of a reference's dotted line, in the chart and in its swatches.
const DASHES = "6 4";
const DOTS = "1 4";
export const swatchDashes = ({ dashed, reference }: Pick<Series, "dashed" | "reference">): string | null =>
  reference ? DOTS : dashed ? "4 3" : null;
type Plot = {
  positions: string[];
  brief: string[];
  series: Series[];
  value: (n: number) => string;
  tick: (n: number) => string;
};

const NS = "http://www.w3.org/2000/svg";
const HEIGHT = 240;
const [TOP, BOTTOM, LEFT] = [12, 28, 48];
// The end labels' height, and the width of one of their characters, at 12px in the monospace font.
const LABEL = 14;
const CHAR = 7.3;
// When each position gets fewer pixels than this, the axis shows the brief names.
const ROOM = 96;
// What each chart shows, and the position its pointer or focus is on.
const charts = new WeakMap<SVGSVGElement, { plot: Plot; tip: HTMLElement; at: number | undefined }>();
addEventListener("resize", render);

const el = <K extends keyof SVGElementTagNameMap>(name: K, attributes: Record<string, string | number>) => {
  const node = document.createElementNS(NS, name);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, String(value));
  return node;
};
// Room on the right for the longest end label. The labels name their series when each position still gets `NAMED`
// pixels; on a narrower chart they give only the value, and the legend names the lines.
const NAMED = 72;
function rightOf(plot: Plot, width: number): { right: number; named: boolean } {
  const room = (named: boolean) =>
    24 + CHAR * Math.max(0, ...plot.series.map(({ short }) => `${plot.value(1)}${named ? ` ${short}` : ""}`.length));
  const named = (width - LEFT - room(true)) / plot.positions.length >= NAMED;
  return { right: room(named), named };
}

export function drawChart(svg: SVGSVGElement, tip: HTMLElement, plot: Plot): void {
  const known = charts.get(svg);
  if (!known) listen(svg);
  const state = { plot, tip, at: known?.at };
  charts.set(svg, state);
  const width = Math.max(320, Math.round(svg.getBoundingClientRect().width) || 640);
  svg.setAttribute("viewBox", `0 0 ${width} ${HEIGHT}`);
  svg.setAttribute("height", String(HEIGHT));
  const n = plot.positions.length;
  const { right, named } = rightOf(plot, width);
  const figures = plot.series.flatMap(({ values }) => values.filter((v) => v !== undefined));
  const ticks = ticksOf(Math.min(...figures), Math.max(0, ...figures));
  const [bottom, top] = [ticks[0]!, ticks.at(-1)!];
  const x = (i: number) => LEFT + ((i + 0.5) * (width - LEFT - right)) / n;
  const y = (value: number) => TOP + (1 - (value - bottom) / (top - bottom)) * (HEIGHT - TOP - BOTTOM);
  const nodes: SVGElement[] = [];
  for (const tick of ticks) {
    nodes.push(el("line", { class: "Chart-grid", x1: LEFT, x2: width - right + 8, y1: y(tick), y2: y(tick) }));
    const label = el("text", { class: "Chart-axis", x: LEFT - 8, y: y(tick) + 4, "text-anchor": "end" });
    label.textContent = plot.tick(tick);
    nodes.push(label);
  }
  const names = (width - LEFT - right) / n < ROOM ? plot.brief : plot.positions;
  names.forEach((name, i) => {
    const label = el("text", { class: "Chart-axis", x: x(i), y: HEIGHT - 8, "text-anchor": "middle" });
    label.textContent = name;
    nodes.push(label);
  });
  if (state.at !== undefined)
    nodes.push(el("line", { class: "Chart-cross", x1: x(state.at), x2: x(state.at), y1: TOP, y2: HEIGHT - BOTTOM }));
  const ends: { y: number; x: number; text: string }[] = [];
  const bold = plot.series.some((series) => series.bold);
  // The first series ends up on top, and a bold one above all.
  const drawn = plot.series.toReversed().sort((a, b) => Number(!!a.bold) - Number(!!b.bold));
  for (const { values, color, dashed, reference, short, ...series } of drawn) {
    const thickness = series.bold ? 3 : reference || bold ? 1.5 : 2;
    // Each run of known values is its own line.
    let run: string[] = [];
    const flush = () => {
      if (run.length > 1) {
        const path = el("polyline", { class: "Chart-line", points: run.join(" ") });
        path.style.stroke = color;
        path.style.strokeWidth = String(thickness);
        if (reference || dashed) path.setAttribute("stroke-dasharray", reference ? DOTS : DASHES);
        nodes.push(path);
      }
      run = [];
    };
    values.forEach((value, i) => (value === undefined ? flush() : run.push(`${x(i)},${y(value)}`)));
    flush();
    if (!reference)
      values.forEach((value, i) => {
        if (value === undefined) return;
        const dot = el("circle", { class: "Chart-dot", cx: x(i), cy: y(value), r: series.bold ? 4.5 : 3.5 });
        dot.style.fill = color;
        nodes.push(dot);
      });
    const last = values.findLastIndex((value) => value !== undefined);
    if (last >= 0)
      ends.push({
        x: x(last) + 10,
        y: y(values[last]!) + 4,
        text: `${plot.value(values[last]!)}${named ? ` ${short}` : ""}`,
      });
  }
  // End labels, each beside its line's last value, moved apart where they would touch.
  const at = spread(
    ends.map(({ y }) => y),
    LABEL,
    TOP + 4,
    HEIGHT - BOTTOM + 4,
  );
  ends.forEach((end, i) => {
    const label = el("text", { class: "Chart-end", x: end.x, y: at[i]! });
    label.textContent = end.text;
    nodes.push(label);
  });
  svg.replaceChildren(...nodes);
  showTip(svg);
}

function listen(svg: SVGSVGElement): void {
  const move = (at: number | undefined) => {
    const state = charts.get(svg);
    if (!state || state.at === at) return;
    state.at = at;
    drawChart(svg, state.tip, state.plot);
  };
  svg.addEventListener("pointermove", (event) => {
    const state = charts.get(svg)!;
    const box = svg.getBoundingClientRect();
    const n = state.plot.positions.length;
    const inside = (event.clientX - box.left - LEFT) / (box.width - LEFT - rightOf(state.plot, box.width).right);
    move(Math.min(n - 1, Math.max(0, Math.floor(inside * n))));
  });
  svg.addEventListener("pointerleave", () => move(undefined));
  svg.addEventListener("focus", () => move(charts.get(svg)!.plot.positions.length - 1));
  svg.addEventListener("blur", () => move(undefined));
  svg.addEventListener("keydown", (event) => {
    const state = charts.get(svg)!;
    const last = state.plot.positions.length - 1;
    const at = state.at ?? last;
    if (event.key === "ArrowLeft") move(Math.max(0, at - 1));
    else if (event.key === "ArrowRight") move(Math.min(last, at + 1));
    else if (event.key === "Escape") move(undefined);
    else return;
    event.preventDefault();
  });
}

function showTip(svg: SVGSVGElement): void {
  const { plot, tip, at } = charts.get(svg)!;
  tip.hidden = at === undefined;
  if (at === undefined) return;
  const title = Object.assign(document.createElement("p"), { className: "u-label", textContent: plot.positions[at]! });
  const rows = plot.series.map(({ name, color, values, ...style }) => {
    const row = Object.assign(document.createElement("p"), { className: "Chart-tipRow" });
    const key = el("svg", { class: "Chart-swatch", viewBox: "0 0 24 8", "aria-hidden": "true" });
    const line = el("line", { x1: 2, y1: 4, x2: 22, y2: 4 });
    line.style.stroke = color;
    const dashes = swatchDashes(style);
    if (dashes) line.setAttribute("stroke-dasharray", dashes);
    key.append(line);
    const value = Object.assign(document.createElement("strong"), {
      textContent: values[at] === undefined ? "–" : plot.value(values[at]),
    });
    row.append(key, value, Object.assign(document.createElement("span"), { textContent: ` ${name}` }));
    return row;
  });
  tip.replaceChildren(title, ...rows);
  const box = svg.getBoundingClientRect();
  const n = plot.positions.length;
  const left = LEFT + ((at + 0.5) * (box.width - LEFT - rightOf(plot, box.width).right)) / n;
  // Put the tip on whichever side of the crosshair has more room.
  const right = left > box.width / 2;
  tip.style.left = right ? "" : `${left + 12}px`;
  tip.style.right = right ? `${box.width - left + 12}px` : "";
}
