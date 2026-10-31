import assert from "node:assert/strict";
import { test } from "node:test";
import { hrefOf, parse, type Route } from "../src/routes.ts";

test("each address is a route, each route has its address, and anything else is Home", () => {
  const cases: [string, Route][] = [
    ["#app", { view: "app" }],
    ["#app/allows", { view: "app", section: "allows" }],
    ["#about", { view: "about" }],
    ["#hydrex", { view: "hydrex" }],
    ["#hydrex/matcha-latte/control", { view: "product", kind: "matcha-latte", section: "control" }],
    ["#hydrex/double-espresso", { view: "product", kind: "double-espresso" }],
    ["#hydrex/9540", { view: "account", id: 9540n }],
    ["#swap", { view: "swap", output: "usdc" }],
    ["#swap/weth", { view: "swap", output: "weth" }],
    ["#swap/check", { view: "swap", output: "usdc", section: "check" }],
    ["#swap/cbbtc/approvals", { view: "swap", output: "cbbtc", section: "approvals" }],
  ];
  for (const [hash, route] of cases) {
    assert.deepEqual(parse(hash), route, hash);
    assert.equal(hrefOf(route), hash);
  }
  assert.deepEqual(parse("#hydrex%2F9540"), { view: "account", id: 9540n });
  const home = ["", "#", "#app/", "#about/check", "#hydrex/aero", "#hydrex/0", "#hydrex/09540", "#hydrex/9540/x"];
  home.push(
    "#hydrex/matcha-latte/check/more",
    "#swap/",
    "#swap/WETH",
    "#swap/weth/votes",
    "#swap/check/weth",
    "#%E0%A4",
  );
  for (const hash of home) assert.deepEqual(parse(hash), { view: "home" }, hash);
  assert.equal(hrefOf({ view: "home" }), "#");
});
