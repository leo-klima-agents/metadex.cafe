import { onSettle } from "./cache.ts";
import type { Route } from "./routes.ts";
import type { Connection } from "./wallet.ts";

export const state: {
  route: Route;
  connection?: Connection | undefined;
  // The Hydrex accounts the visitor ticked in each group, keyed by the group's view and name.
  picks: Map<string, Set<bigint>>;
} = { route: { view: "home" }, picks: new Map() };

// Any change redraws everything shown from what is known, at most once a frame.
const drawers: (() => void)[] = [];
let due = false;
export const onRender = (draw: () => void): void => void drawers.push(draw);
export function render(): void {
  if (due) return;
  due = true;
  requestAnimationFrame(() => {
    due = false;
    for (const draw of drawers)
      try {
        draw();
      } catch (error) {
        console.error(error);
      }
  });
}
onSettle(render);
document.addEventListener("visibilitychange", render);

// What a button, a box or a form does, by its data-action.
export const actions: Record<string, (el: HTMLElement, event: Event) => void> = {};
