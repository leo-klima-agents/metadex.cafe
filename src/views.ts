// The page is one HTML file in views, each addressed by the hash: CSS shows the view that holds the target, or Home
// (style.css), even without this script. The script adds what CSS cannot: the title, the focus, and opening what
// folds the target. It changes views only through the hash, which the browser keeps in its history.

const views = [...document.querySelectorAll<HTMLElement>(".view")];
const home = views[0]!;
let current: HTMLElement | undefined;

// As the browser finds the target: the fragment as it is, then decoded. A stray "%" cannot be decoded.
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
  for (let fold = element?.closest("details"); fold; fold = fold.parentElement?.closest("details")) fold.open = true;
  const changed = view !== current;
  current = view;
  if (element && element !== view) return element.scrollIntoView();
  if (!changed) return;
  // A new view reads as a new page: from the top, and announced by its heading.
  scrollTo(0, 0);
  if (moved) view.querySelector<HTMLElement>("h1")?.focus({ preventScroll: true });
}

// Inside Safe{Wallet}'s frame, the page opens on the App.
if (window.parent !== window && !location.hash) location.replace("#app");
showView(false);
addEventListener("hashchange", () => showView(true));
