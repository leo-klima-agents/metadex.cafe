import assert from "node:assert/strict";
import { test } from "node:test";
import { hrefOf, parse, type Route } from "../src/routes.ts";

const GAUGE = "0xd424BA8ca9d4E278753DE76651a0095451e65cD1";

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
    ["#aero", { view: "aero" }],
    ["#aero/how", { view: "aero", section: "how" }],
    ["#aero/check", { view: "aero", section: "check" }],
    ["#aero/20366", { view: "stake", id: 20366n }],
    ["#aero/pool/0xd424BA8ca9d4E278753DE76651a0095451e65cD1", { view: "pool", gauge: GAUGE }],
  ];
  for (const [hash, route] of cases) {
    assert.deepEqual(parse(hash), route, hash);
    assert.equal(hrefOf(route), hash);
  }
  assert.deepEqual(parse("#hydrex%2F9540"), { view: "account", id: 9540n });
  assert.deepEqual(parse(`#aero/pool/${GAUGE.toLowerCase()}`), { view: "pool", gauge: GAUGE }, "any case, checksummed");
  const home = ["", "#", "#app/", "#about/check", "#hydrex/aero", "#hydrex/0", "#hydrex/09540", "#hydrex/9540/x"];
  home.push(
    "#hydrex/matcha-latte/check/more",
    "#swap/",
    "#swap/WETH",
    "#swap/weth/votes",
    "#swap/check/weth",
    "#aero/",
    "#aero/0",
    "#aero/020366",
    "#aero/20366/how",
    "#aero/how/x",
    "#aero/pools",
    "#aero/pool",
    "#aero/pool/0x1234",
    `#aero/pool/${GAUGE}/x`,
    "#%E0%A4",
  );
  for (const hash of home) assert.deepEqual(parse(hash), { view: "home" }, hash);
  assert.equal(hrefOf({ view: "home" }), "#");
});
