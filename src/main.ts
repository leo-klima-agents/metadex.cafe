import { failures, retry } from "./cache.ts";
import { CHAIN_ID, currencyOf } from "./config.ts";
import { preload } from "./data.ts";
import { setCurrency, short } from "./format.ts";
import { parse, type View } from "./routes.ts";
import { showTags, type Tag } from "./rpc.ts";
import { actions, onRender, render, state } from "./state.ts";
import { $, fill, toggle } from "./ui.ts";
import { drawApp } from "./views/app.ts";
import { drawAccount } from "./views/account.ts";
import { drawHydrex, drawProduct } from "./views/hydrex.ts";
import { drawReview } from "./views/review.ts";
import { drawSwap, preloadSwap } from "./views/swap.ts";
import { drawWallets, startWallets } from "./views/wallet.ts";

// The page is one HTML file of views, and the hash picks the one shown. A view's tags name its reads, which go before
// other views' reads.
const TAGS: Record<View, Tag[]> = {
  home: [],
  about: [],
  app: ["earnings", "payouts", "swap"],
  hydrex: ["earnings", "average", "shares", "payouts"],
  product: ["earnings", "average", "shares", "payouts"],
  account: ["earnings", "shares", "payouts"],
  swap: ["earnings", "swap"],
};
const DRAW: Partial<Record<View, () => void>> = {
  app: drawApp,
  hydrex: drawHydrex,
  product: drawProduct,
  account: drawAccount,
  swap: drawSwap,
};
const views = [...document.querySelectorAll<HTMLElement>("main > [data-view]")];
const popups = [...document.querySelectorAll<HTMLElement>("[popover]")];

function show(first: boolean): void {
  const before = state.route;
  const route = (state.route = parse(location.hash));
  const moved =
    route.view !== before.view ||
    (route.view === "account" && before.view === "account" && route.id !== before.id) ||
    first;
  const view = views.find(({ dataset }) => dataset.view === route.view)!;
  for (const each of views) each.hidden = each !== view;
  toggle("view", true, route.view);
  toggle("kind", route.view === "product", route.view === "product" ? route.kind : "");
  document.title = route.view === "account" ? `Hydrex account #${route.id} · metaDEX Café` : view.dataset.title!;
  const chip = $("[data-text=chip]");
  if (route.view === "app") chip.setAttribute("aria-current", "page");
  else chip.removeAttribute("aria-current");
  showTags(TAGS[route.view]);
  for (const popup of popups) if (popup.matches(":popover-open")) popup.hidePopover();
  render();
  const section =
    "section" in route && route.section ? view.querySelector<HTMLElement>(`[data-section="${route.section}"]`) : null;
  const popup = section?.closest<HTMLElement>("[popover]");
  if (popup && section) {
    popup.showPopover();
    section.scrollIntoView();
    $("h2", popup).focus({ preventScroll: true });
  } else if (moved) {
    scrollTo(0, 0);
    if (!first) $("h1", view).focus({ preventScroll: true });
  }
}
// When a popup closes, its section leaves the address, so that the same address opens it again.
for (const popup of popups) {
  popup.querySelector("h2")?.setAttribute("tabindex", "-1");
  popup.addEventListener("toggle", () => {
    if (popup.matches(":popover-open") || !("section" in state.route) || !state.route.section) return;
    if (!popup.matches(`[data-section="${state.route.section}"], :has([data-section="${state.route.section}"])`))
      return;
    history.replaceState(null, "", location.hash.replace(/\/[^/]*$/, ""));
    state.route = parse(location.hash);
  });
}

function dispatch(el: HTMLElement | null, event: Event): void {
  const action = el?.dataset.action;
  if (el && action) actions[action]?.(el, event);
}
document.addEventListener("click", (event) =>
  dispatch((event.target as Element).closest<HTMLElement>("button[data-action], a[data-action]"), event),
);
document.addEventListener("change", (event) => dispatch(event.target as HTMLElement, event));
document.addEventListener("submit", (event) => {
  event.preventDefault();
  dispatch(event.target as HTMLElement, event);
});
actions.retry = () => retry();
actions.currency = (el) => {
  const currency = currencyOf((el as HTMLSelectElement).value);
  if (currency) setCurrency(currency);
  render();
};

onRender(() => {
  const connection = state.connection;
  toggle("wallet", !!connection);
  toggle("wrong-chain", !!connection && connection.chainId !== CHAIN_ID);
  toggle("safe", !!connection?.wallet.propose);
  fill(document.body, { chip: connection ? short(connection.address) : "", failed: failures() > 0 || null });
  $("[data-text=chip]").setAttribute(
    "aria-label",
    connection ? `Your wallet, connected as ${short(connection.address)}` : "",
  );
  drawWallets();
  DRAW[state.route.view]?.();
  drawReview();
  preload();
  preloadSwap();
});

// Safe{Wallet} shows the page in a frame, where it starts on the App.
if (window.parent !== window && !location.hash) location.replace("#app");
addEventListener("hashchange", () => show(false));
show(true);
startWallets();
setInterval(render, 30_000);
