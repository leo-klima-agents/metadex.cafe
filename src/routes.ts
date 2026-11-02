import { byKind, DEFAULT_OUTPUT, swapperOf, type Kind, type Output } from "./config.ts";

// The page's addresses: `#app`, `#about`, `#hydrex`, `#hydrex/matcha-latte`, `#hydrex/9540`, `#swap/weth`, each with
// an optional section that opens a popup, as `#hydrex/matcha-latte/check`. Anything else is Home.
export type Route =
  | { view: "home" }
  | { view: "about" }
  | { view: "hydrex" }
  | { view: "app"; section?: string }
  | { view: "product"; kind: Kind; section?: string }
  | { view: "account"; id: bigint }
  | { view: "swap"; output: Output; section?: string };
export type View = Route["view"];

const SECTIONS = {
  app: ["allows"],
  product: ["fees", "control", "check", "record"],
  swap: ["fees", "check", "approvals"],
};

const HOME: Route = { view: "home" };
const sectioned = <R extends Extract<Route, { view: "app" | "product" | "swap" }>>(
  route: R,
  section: string | undefined,
  sections: string[],
): Route => (section === undefined ? route : sections.includes(section) ? { ...route, section } : HOME);

export function parse(hash: string): Route {
  let fragment = hash.replace(/^#/, "");
  try {
    fragment = decodeURIComponent(fragment);
  } catch {}
  const [first = "", second, third, ...rest] = fragment.split("/");
  if (rest.length) return HOME;
  if (first === "about" && second === undefined) return { view: "about" };
  if (first === "app" && third === undefined) return sectioned({ view: "app" }, second, SECTIONS.app);
  if (first === "swap") {
    const swapper = second === undefined ? undefined : swapperOf(second);
    if (swapper) return sectioned({ view: "swap", output: swapper.output }, third, SECTIONS.swap);
    if (third === undefined) return sectioned({ view: "swap", output: DEFAULT_OUTPUT }, second, SECTIONS.swap);
  }
  if (first !== "hydrex") return HOME;
  if (second === undefined) return { view: "hydrex" };
  // Hydrex's accounts are numbered from 1, up to a uint256's 78 digits.
  if (/^[1-9]\d{0,77}$/.test(second)) return third === undefined ? { view: "account", id: BigInt(second) } : HOME;
  const automation = byKind(second);
  return automation ? sectioned({ view: "product", kind: automation.kind }, third, SECTIONS.product) : HOME;
}

export function hrefOf(route: Route): string {
  const section = "section" in route && route.section ? [route.section] : [];
  switch (route.view) {
    case "home":
      return "#";
    case "account":
      return `#hydrex/${route.id}`;
    case "product":
      return ["#hydrex", route.kind, ...section].join("/");
    case "swap":
      return ["#swap", ...(route.output === DEFAULT_OUTPUT ? [] : [route.output]), ...section].join("/");
    default:
      return [`#${route.view}`, ...section].join("/");
  }
}
