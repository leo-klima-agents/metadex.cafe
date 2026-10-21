import assert from "node:assert/strict";
import { test } from "node:test";
import { hrefOf, parse, type Route } from "../src/routes.ts";

test("each address is a route, and anything else is Home", () => {
  const cases: [string, Route][] = [
    ["", { view: "home" }],
    ["#", { view: "home" }],
    ["#app", { view: "app" }],
    ["#hydrex", { view: "hydrex" }],
    ["#app/allows", { view: "app", section: "allows" }],
    ["#swap", { view: "swap", output: "usdc" }],
    ["#swap/usdc", { view: "swap", output: "usdc" }],
    ["#swap/weth", { view: "swap", output: "weth" }],
    ["#swap/cbbtc/check", { view: "swap", output: "cbbtc", section: "check" }],
    ["#swap/check", { view: "swap", output: "usdc", section: "check" }],
    ["#swap/approvals", { view: "swap", output: "usdc", section: "approvals" }],
    ["#about", { view: "about" }],
    ["#about/check", { view: "about", section: "check" }],
    ["#hydrex/carbon-impact", { view: "product", kind: "carbon-impact" }],
    ["#hydrex/carbon-impact/carbon", { view: "product", kind: "carbon-impact", section: "carbon" }],
    ["#hydrex/automaxi/votes", { view: "product", kind: "automaxi", section: "votes" }],
    ["#hydrex/9540", { view: "position", id: 9540n }],
    ["#hydrex%2F9540", { view: "position", id: 9540n }],
  ];
  for (const [hash, route] of cases) assert.deepEqual(parse(hash), route, hash);
  for (const hash of [
    "#how-it-works",
    "#app/",
    "#about/nothing",
    "#hydrex/carbon-impact/votes",
    "#hydrex/automaxi/carbon",
    "#hydrex/aero",
    "#hydrex/0",
    "#hydrex/09540",
    "#hydrex/9540/2026-10-22",
    "#hydrex/carbon-impact/check/more",
    "#app/check",
    "#swap/",
    "#swap/WETH",
    "#swap/eth",
    "#swap/weth/votes",
    "#swap/check/weth",
    "#swap/weth/check/more",
    "#100%",
    "#%E0%A4",
  ]) {
    assert.deepEqual(parse(hash), { view: "home" }, hash);
  }
});

test("each route has its address", () => {
  const routes: Route[] = [
    { view: "home" },
    { view: "app" },
    { view: "about" },
    { view: "about", section: "figures" },
    { view: "product", kind: "automaxi" },
    { view: "product", kind: "carbon-impact", section: "check" },
    { view: "position", id: 82774n },
    { view: "hydrex" },
    { view: "app", section: "allows" },
    { view: "swap", output: "usdc" },
    { view: "swap", output: "hydx" },
    { view: "swap", output: "usdc", section: "fees" },
    { view: "swap", output: "eurc", section: "approvals" },
  ];
  for (const route of routes) assert.deepEqual(parse(hrefOf(route)), route);
});
