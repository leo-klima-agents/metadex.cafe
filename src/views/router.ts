import { byKind, swapperOf, type Kind } from "../config.ts";
import { $, $$ } from "./dom.ts";

// The page's address is its fragment, which never reaches a server: `#app`, `#hydrex`, `#hydrex/matcha-latte`,
// `#hydrex/9540`, `#swap/weth`, `#about`; one more part opens a popup's section, as `#swap/weth/check`. Else Home.
export type View = "home" | "app" | "hydrex" | "automation" | "account" | "swap" | "about";
export type Route = { view: View; kind?: Kind; id?: bigint; output?: string; section?: string };

export function parse(hash: string): Route {
  let fragment = hash.replace(/^#/, "");
  try {
    fragment = decodeURIComponent(fragment);
  } catch {}
  const [first = "", second, third, ...rest] = fragment.split("/");
  const at = (route: Route, section?: string): Route => (section ? { ...route, section } : route);
  if (rest.length) return { view: "home" };
  if (first === "app" && third === undefined) return at({ view: "app" }, second);
  if (first === "about" && second === undefined) return { view: "about" };
  if (first === "swap") {
    const output = second && swapperOf(second) ? second : "usdc";
    if (output === second) return at({ view: "swap", output }, third);
    if (third === undefined) return at({ view: "swap", output }, second);
  }
  if (first === "hydrex") {
    if (second === undefined) return { view: "hydrex" };
    // An account number, as a uint256 has at most 78 digits.
    if (/^[1-9]\d{0,77}$/.test(second) && third === undefined) return { view: "account", id: BigInt(second) };
    const kind = byKind(second)?.kind;
    if (kind) return at({ view: "automation", kind }, third);
  }
  return { view: "home" };
}

export const hrefOf = ({ view, kind, id, output, section }: Route): string =>
  `#${[
    view === "home" ? "" : view === "automation" || view === "account" ? "hydrex" : view,
    kind ?? (id === undefined ? undefined : `${id}`),
    output === "usdc" && !section ? undefined : output,
    section,
  ]
    .filter((part) => part !== undefined)
    .join("/")}`;

const TITLES: Partial<Record<View, string>> = { app: "Your wallet", hydrex: "Hydrex", swap: "Swap", about: "About" };
const titleOf = ({ view, kind, id }: Route): string => {
  const name =
    view === "automation" ? byKind(kind!)!.name : view === "account" ? `Hydrex account #${id}` : TITLES[view];
  return name ? `${name} · metaDEX Café` : "metaDEX Café";
};

let current = parse(location.hash);
export const route = (): Route => current;
const listeners: ((route: Route) => void)[] = [];
export function onRoute(listener: (route: Route) => void): void {
  listeners.push(listener);
  listener(current);
}

const html = document.documentElement;
const viewOf = (route: Route) => $(`.view[data-view="${route.view}"]`);
const pops = $$("[popover]");
const isOpen = (pop: HTMLElement) => pop.matches(":popover-open");

function showRoute(moved: boolean): void {
  const next = parse(location.hash);
  const changed = next.view !== current.view || next.kind !== current.kind || next.id !== current.id;
  current = next;
  for (const pop of pops) if (isOpen(pop)) pop.hidePopover();
  html.dataset.view = next.view;
  if (next.kind) html.dataset.kind = next.kind;
  document.title = titleOf(next);
  const chip = $("#chip");
  if (next.view === "app") chip.setAttribute("aria-current", "page");
  else chip.removeAttribute("aria-current");
  for (const listener of listeners) listener(next);
  const section = next.section && viewOf(next).querySelector<HTMLElement>(`[data-section="${next.section}"]`);
  if (changed) scrollTo(0, 0);
  if (section) {
    const pop = section.closest<HTMLElement>("[popover]");
    pop?.showPopover();
    section.scrollIntoView();
    $("h2", pop ?? section).focus({ preventScroll: !pop });
  } else if (changed && moved) $("h1", viewOf(next)).focus({ preventScroll: true });
}

// A popup opened by an address takes focus, and its section leaves the address as it closes.
const holds = (pop: HTMLElement, section: string) =>
  pop.matches(`[data-section="${section}"]`) || !!pop.querySelector(`[data-section="${section}"]`);
for (const pop of pops) {
  $("h2", pop).tabIndex = -1;
  pop.addEventListener("toggle", () => {
    if (isOpen(pop) || !current.section || !holds(pop, current.section)) return;
    const { section: _, ...rest } = current;
    history.replaceState(null, "", hrefOf(rest));
    current = rest;
  });
}

// Safe{Wallet} shows the page in a frame: start on the App there.
if (window.parent !== window && !location.hash) location.replace("#app");
showRoute(false);
addEventListener("hashchange", () => showRoute(true));
