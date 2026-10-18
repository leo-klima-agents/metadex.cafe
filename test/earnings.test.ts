import assert from "node:assert/strict";
import { test } from "node:test";
import type { Address } from "viem";
import { earnedBy, valueOf, type Earnings } from "../src/earnings.ts";
import type { Token } from "../src/prices.ts";

const USDC: Token = { address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", decimals: 6, symbol: "USDC" };
const HYDX: Token = { address: "0x00000e7efa313F4E11Bfff432471eD9423AC6B30", decimals: 18, symbol: "HYDX" };
const WFRAX: Token = { address: "0x0CEAC003B0d2479BebeC9f4b2EBAd0a803759bbf", decimals: 18, symbol: "WFRAX" };
const POOL: Address = "0x605abD1873737CA9a9Ec1CFa52CDfc8ef62c2E1d";
const OTHER: Address = "0x0BA69825c4C033e72309F6AC0Bde0023b15Cc97c";

test("a voter's share of a reward contract's rewards rounds down, as the contract's does", () => {
  assert.equal(earnedBy(1_000_000_000n, 3n, 1n), 333_333_333n);
  assert.equal(earnedBy(1_000_000_000n, 3n, 3n), 999_999_999n);
  assert.equal(earnedBy(10n ** 6n, 10n ** 24n, 10n ** 24n), 10n ** 6n, "a sole voter earns it all");
  assert.equal(earnedBy(0n, 5n, 5n), 0n);
});

test("what votes earned, in dollars: fees and incentives apart, and by pool; a token without a price counts for nothing", () => {
  const earnings: Earnings = {
    start: 1_791_417_600,
    votes: 897_042n * 10n ** 18n,
    pools: [
      { address: POOL, name: "vAMM-HYDX/USDC", votes: 1n },
      { address: OTHER, name: "USDC / cbBTC", votes: 2n },
    ],
    rewards: [
      { pool: POOL, token: USDC, amount: 14_099_868n, fee: true },
      { pool: OTHER, token: USDC, amount: 663_168_290n, fee: false },
      { pool: POOL, token: HYDX, amount: 27n * 10n ** 18n, fee: true },
      { pool: OTHER, token: WFRAX, amount: 10n ** 17n, fee: false },
    ],
    prices: new Map([
      [USDC.address.toLowerCase(), 1],
      [HYDX.address.toLowerCase(), 0.025],
    ]),
  };
  const value = valueOf(earnings);
  assert.ok(Math.abs(value.fees - (14.099868 + 0.675)) < 1e-9);
  assert.ok(Math.abs(value.incentives - 663.16829) < 1e-9);
  assert.equal(value.usd, value.fees + value.incentives);
  assert.ok(Math.abs(value.byPool.get(POOL.toLowerCase())! - (14.099868 + 0.675)) < 1e-9);
  assert.ok(Math.abs(value.byPool.get(OTHER.toLowerCase())! - 663.16829) < 1e-9, "WFRAX adds nothing");
});
