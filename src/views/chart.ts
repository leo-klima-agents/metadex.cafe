import { render } from "../state.ts";

// A line chart of a few series over a few positions, drawn at its own width so that its text keeps its size. A missing
// value breaks a line.
export type Series = { id: string; name: string; color: string; dashed?: boolean; values: (number | undefined)[] };
export type Plot = {
  positions: string[];
  brief: string[];
  series: Series[];
  value: (n: number) => string;
  tick: (n: number) => string;
};

const NS = "http://www.w3.org/2000/svg";
const HEIGHT = 240;
const [TOP, BOTTOM, LEFT, RIGHT] = [12, 28, 48, 72];
const LABEL = 14;
// Under this many pixels a position, the positions take their brief names.
const ROOM = 96;
// What each chart shows and where its pointer or focus is.
const charts = new WeakMap<SVGSVGElement, { plot: Plot; tip: HTMLElement; at: number | undefined }>();
addEventListener("resize", render);

const el = <K extends keyof SVGElementTagNameMap>(name: K, attributes: Record<string, string | number>) => {
  const node = document.createElementNS(NS, name);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, String(value));
  return node;
};
// Ticks from zero, a step of 1, 2 or 5 times a power of ten apart, up to the first at or above the highest value.
function ticksOf(most: number): number[] {
  if (!(most > 0)) return [0, 1];
  const rough = most / 4;
  const power = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 5, 10].map((k) => k * power).find((each) => each >= rough)!;
  return Array.from({ length: Math.ceil(most / step) + 1 }, (_, i) => i * step);
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
  const ticks = ticksOf(Math.max(0, ...plot.series.flatMap(({ values }) => values.filter((v) => v !== undefined))));
  const top = ticks.at(-1)!;
  const x = (i: number) => LEFT + ((i + 0.5) * (width - LEFT - RIGHT)) / n;
  const y = (value: number) => TOP + (1 - value / top) * (HEIGHT - TOP - BOTTOM);
  const nodes: SVGElement[] = [];
  for (const tick of ticks) {
    nodes.push(el("line", { class: "Chart-grid", x1: LEFT, x2: width - RIGHT + 8, y1: y(tick), y2: y(tick) }));
    const label = el("text", { class: "Chart-axis", x: LEFT - 8, y: y(tick) + 4, "text-anchor": "end" });
    label.textContent = plot.tick(tick);
    nodes.push(label);
  }
  const names = (width - LEFT - RIGHT) / n < ROOM ? plot.brief : plot.positions;
  names.forEach((name, i) => {
    const label = el("text", { class: "Chart-axis", x: x(i), y: HEIGHT - 8, "text-anchor": "middle" });
    label.textContent = name;
    nodes.push(label);
  });
  if (state.at !== undefined)
    nodes.push(el("line", { class: "Chart-cross", x1: x(state.at), x2: x(state.at), y1: TOP, y2: HEIGHT - BOTTOM }));
  const ends: { y: number; x: number; text: string }[] = [];
  for (const { values, color, dashed } of plot.series) {
    // Runs of known values, each its own line.
    let run: string[] = [];
    const flush = () => {
      if (run.length > 1) {
        const path = el("polyline", { class: "Chart-line", points: run.join(" ") });
        path.style.stroke = color;
        if (dashed) path.setAttribute("stroke-dasharray", "6 4");
        nodes.push(path);
      }
      run = [];
    };
    values.forEach((value, i) => (value === undefined ? flush() : run.push(`${x(i)},${y(value)}`)));
    flush();
    values.forEach((value, i) => {
      if (value === undefined) return;
      const dot = el("circle", { class: "Chart-dot", cx: x(i), cy: y(value), r: 4 });
      dot.style.fill = color;
      nodes.push(dot);
    });
    const last = values.findLastIndex((value) => value !== undefined);
    if (last >= 0) ends.push({ x: x(last) + 10, y: y(values[last]!) + 4, text: plot.value(values[last]!) });
  }
  // End labels, the series drawn on top first; one that would touch another is left to the legend and the tooltip.
  const placed: number[] = [];
  for (const end of ends.toReversed()) {
    if (placed.some((at) => Math.abs(at - end.y) < LABEL)) continue;
    placed.push(end.y);
    const label = el("text", { class: "Chart-end", x: end.x, y: end.y });
    label.textContent = end.text;
    nodes.push(label);
  }
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
    const inside = (event.clientX - box.left - LEFT) / (box.width - LEFT - RIGHT);
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
  const rows = plot.series.map(({ name, color, dashed, values }) => {
    const row = Object.assign(document.createElement("p"), { className: "Chart-tipRow" });
    const key = el("svg", { class: "Chart-swatch", viewBox: "0 0 24 8", "aria-hidden": "true" });
    const line = el("line", { x1: 2, y1: 4, x2: 22, y2: 4 });
    line.style.stroke = color;
    if (dashed) line.setAttribute("stroke-dasharray", "4 3");
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
  const left = LEFT + ((at + 0.5) * (box.width - LEFT - RIGHT)) / n;
  // On the side of the crosshair with room for it.
  const right = left > box.width / 2;
  tip.style.left = right ? "" : `${left + 12}px`;
  tip.style.right = right ? `${box.width - left + 12}px` : "";
}
