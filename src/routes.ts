import { getAddress, type Address } from "viem";
import { byKind, DEFAULT_OUTPUT, swapperOf, type Kind, type Output } from "./config.ts";

// The page's addresses, such as `#app`, `#about`, `#hydrex`, `#hydrex/matcha-latte`, `#hydrex/9540`, `#swap/weth`,
// `#aero`, `#aero/20366` and `#aero/pool/0x…` (a pool by its gauge). The app, automation, swap and Aero
// views take an optional section that opens a popup, such as `#hydrex/matcha-latte/check`. Anything else is Home.
export type Route =
  | { view: "home" | "about" | "hydrex" }
  | { view: "aero"; section?: string }
  | { view: "stake"; id: bigint }
  | { view: "pool"; gauge: Address }
  | { view: "app"; section?: string }
  | { view: "product"; kind: Kind; section?: string }
  | { view: "account"; id: bigint }
  | { view: "swap"; output: Output; section?: string };
export type View = Route["view"];

const SECTIONS = {
  app: ["allows"],
  product: ["fees", "control", "check", "record"],
  swap: ["fees", "check", "approvals"],
  aero: ["how", "check"],
};

const HOME: Route = { view: "home" };
const sectioned = (route: Extract<Route, { view: keyof typeof SECTIONS }>, section: string | undefined): Route =>
  section === undefined ? route : SECTIONS[route.view].includes(section) ? { ...route, section } : HOME;

export function parse(hash: string): Route {
  let fragment = hash.replace(/^#/, "");
  try {
    fragment = decodeURIComponent(fragment);
  } catch {}
  const [first = "", second, third, ...rest] = fragment.split("/");
  if (rest.length) return HOME;
  if (first === "about" && second === undefined) return { view: "about" };
  if (first === "app" && third === undefined) return sectioned({ view: "app" }, second);
  if (first === "swap") {
    const swapper = second === undefined ? undefined : swapperOf(second);
    if (swapper) return sectioned({ view: "swap", output: swapper.output }, third);
    if (third === undefined) return sectioned({ view: "swap", output: DEFAULT_OUTPUT }, second);
  }
  // Hydrex's accounts and Aero's stakes are numbered from 1, up to a uint256's 78 digits.
  const id = (text: string) => /^[1-9]\d{0,77}$/.test(text);
  if (first === "aero") {
    if (second === undefined) return { view: "aero" };
    if (id(second)) return third === undefined ? { view: "stake", id: BigInt(second) } : HOME;
    if (second === "pool")
      return third && /^0x[0-9a-fA-F]{40}$/.test(third) ? { view: "pool", gauge: getAddress(third) } : HOME;
    return third === undefined ? sectioned({ view: "aero" }, second) : HOME;
  }
  if (first !== "hydrex") return HOME;
  if (second === undefined) return { view: "hydrex" };
  if (id(second)) return third === undefined ? { view: "account", id: BigInt(second) } : HOME;
  const automation = byKind(second);
  return automation ? sectioned({ view: "product", kind: automation.kind }, third) : HOME;
}

export function hrefOf(route: Route): string {
  const section = "section" in route && route.section ? [route.section] : [];
  switch (route.view) {
    case "home":
      return "#";
    case "account":
      return `#hydrex/${route.id}`;
    case "stake":
      return `#aero/${route.id}`;
    case "pool":
      return `#aero/pool/${route.gauge}`;
    case "product":
      return ["#hydrex", route.kind, ...section].join("/");
    case "swap":
      return ["#swap", ...(route.output === DEFAULT_OUTPUT ? [] : [route.output]), ...section].join("/");
    default:
      return [`#${route.view}`, ...section].join("/");
  }
}
