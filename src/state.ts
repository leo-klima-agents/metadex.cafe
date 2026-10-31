import { onSettle } from "./cache.ts";
import type { Route } from "./routes.ts";
import type { Connection } from "./wallet.ts";

// What the page knows besides what it reads from Base: where it is, the wallet, and what the visitor picked.
export const state: {
  route: Route;
  connection?: Connection | undefined;
  // Hydrex accounts ticked in each group, by the group's place, and those the visitor ticked or unticked.
  picks: Map<string, Set<bigint>>;
  touched: Set<string>;
} = { route: { view: "home" }, picks: new Map(), touched: new Set() };

// Everything shown is drawn again from what is known, at most once a frame, whenever anything changes.
const drawers: (() => void)[] = [];
let due = false;
export const onRender = (draw: () => void): void => void drawers.push(draw);
export function render(): void {
  if (due) return;
  due = true;
  requestAnimationFrame(() => {
    due = false;
    for (const draw of drawers) draw();
  });
}
onSettle(render);
document.addEventListener("visibilitychange", render);

// What a button, a box or a form does, by its data-action.
export const actions: Record<string, (el: HTMLElement, event: Event) => void> = {};
