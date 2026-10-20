// The page is one HTML file split into views. CSS shows the view that holds the hash's target, or Home, even without
// this script (see style.css). The script adds the title and the focus, marks the header's link to the view shown, and
// opens any <details> around the target.

const views = [...document.querySelectorAll<HTMLElement>(".view")];
const home = views[0]!;
let current: HTMLElement | undefined;

// Finds the target as the browser does: by the raw fragment, then decoded. A stray "%" cannot be decoded.
function target(): HTMLElement | null {
  const fragment = location.hash.slice(1);
  if (!fragment) return null;
  let decoded = fragment;
  try {
    decoded = decodeURIComponent(fragment);
  } catch {}
  return document.getElementById(fragment) ?? document.getElementById(decoded);
}

function showView(moved: boolean): void {
  const element = target();
  const view = element?.closest<HTMLElement>(".view") ?? home;
  document.title = view.dataset.title ?? document.title;
  // The header's links say which of them is the view shown.
  for (const link of document.querySelectorAll<HTMLAnchorElement>("header.site a")) {
    const to = link.hash.length > 1 ? document.getElementById(link.hash.slice(1))?.closest(".view") : home;
    if (to === view) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  }
  for (let fold = element?.closest("details"); fold; fold = fold.parentElement?.closest("details")) fold.open = true;
  const changed = view !== current;
  current = view;
  if (element && element !== view) return element.scrollIntoView();
  if (!changed) return;
  // A new view starts at the top, with its heading focused so that screen readers announce it.
  scrollTo(0, 0);
  if (moved) view.querySelector<HTMLElement>("h1")?.focus({ preventScroll: true });
}

// Safe{Wallet} shows the page in a frame: start on the App there.
if (window.parent !== window && !location.hash) location.replace("#app");
showView(false);
addEventListener("hashchange", () => showView(true));
