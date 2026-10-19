import assert from "node:assert/strict";
import { test } from "node:test";
import { ethToUsd } from "../src/gas.ts";

test("gas in dollars, at Chainlink's price of ETH with its decimals", () => {
  // 300,000 gas at 0.006 gwei, with ETH at $2,421.95.
  assert.equal(ethToUsd(300_000n * 6_000_000n, 242_195_168_089n, 8).toFixed(5), "0.00436");
  assert.equal(ethToUsd(0n, 242_195_168_089n, 8), 0);
});
