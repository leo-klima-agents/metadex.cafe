import { DEFAULT_OUTPUT, byKind, swapperOf, type Kind, type Output } from "./config.ts";

// The page's addresses. Each is a fragment, which never reaches a server: `#app`, `#about`, `#hydrex`,
// `#hydrex/matcha-latte`, `#hydrex/9540`, `#swap`, `#swap/weth`. A page's section is one more part, such as
// `#hydrex/matcha-latte/check` or `#swap/weth/check`. Anything else is Home.

export type Route =
  | { view: "home" }
  | { view: "app"; section?: string }
  | { view: "hydrex" }
  | { view: "about" }
  | { view: "product"; kind: Kind; section?: string }
  | { view: "position"; id: bigint }
  | { view: "swap"; output: Output; section?: string };

// The sections each page has, in the order they come. Most open a popup; some are a part of one, as "control" and
// "check" are of "fees".
export const APP_SECTIONS = ["allows"];
export const PRODUCT_SECTIONS: Record<Kind, string[]> = {
  "matcha-latte": ["fees", "control", "check", "record"],
  "double-espresso": ["fees", "control", "check", "record"],
};
export const SWAP_SECTIONS = ["fees", "check", "approvals"];

// Hydrex's accounts are numbered from 1. A number has at most 78 digits, as a uint256.
const ACCOUNT = /^[1-9]\d{0,77}$/;

const HOME: Route = { view: "home" };

// The swap's output by its lower-case symbol, then a section: `#swap/check` is USDC's.
function swapRoute(second: string | undefined, third: string | undefined): Route {
  if (second === undefined) return { view: "swap", output: DEFAULT_OUTPUT };
  const swapper = swapperOf(second);
  if (swapper) {
    if (third === undefined) return { view: "swap", output: swapper.output };
    return SWAP_SECTIONS.includes(third) ? { view: "swap", output: swapper.output, section: third } : HOME;
  }
  return third === undefined && SWAP_SECTIONS.includes(second)
    ? { view: "swap", output: DEFAULT_OUTPUT, section: second }
    : HOME;
}

export function parse(hash: string): Route {
  let fragment = hash.replace(/^#/, "");
  try {
    fragment = decodeURIComponent(fragment);
  } catch {}
  const [first = "", second, third, ...rest] = fragment.split("/");
  if (rest.length) return HOME;
  if (first === "" && second === undefined) return HOME;
  if (first === "app") {
    if (second === undefined) return { view: "app" };
    return third === undefined && APP_SECTIONS.includes(second) ? { view: "app", section: second } : HOME;
  }
  if (first === "about") return second === undefined ? { view: "about" } : HOME;
  if (first === "swap") return swapRoute(second, third);
  if (first !== "hydrex") return HOME;
  if (second === undefined) return { view: "hydrex" };
  if (ACCOUNT.test(second)) return third === undefined ? { view: "position", id: BigInt(second) } : HOME;
  const automation = byKind(second);
  if (!automation) return HOME;
  const { kind } = automation;
  if (third === undefined) return { view: "product", kind };
  return PRODUCT_SECTIONS[kind].includes(third) ? { view: "product", kind, section: third } : HOME;
}

export function hrefOf(route: Route): string {
  switch (route.view) {
    case "home":
      return "#";
    case "app":
      return route.section ? `#app/${route.section}` : "#app";
    case "hydrex":
      return "#hydrex";
    case "about":
      return "#about";
    case "product":
      return `#hydrex/${route.kind}${route.section ? `/${route.section}` : ""}`;
    case "position":
      return `#hydrex/${route.id}`;
    case "swap": {
      const parts = [
        ...(route.output === DEFAULT_OUTPUT ? [] : [route.output]),
        ...(route.section ? [route.section] : []),
      ];
      return ["#swap", ...parts].join("/");
    }
  }
}
