import assert from "node:assert/strict";
import { test } from "node:test";
import type { Address } from "viem";
import { key, type Token } from "../src/prices.ts";
import { earnedBy, valueOf } from "../src/rewards.ts";

const USDC: Token = { address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", decimals: 6, symbol: "USDC" };
const HYDX: Token = { address: "0x00000e7efa313F4E11Bfff432471eD9423AC6B30", decimals: 18, symbol: "HYDX" };
const WFRAX: Token = { address: "0x0CEAC003B0d2479BebeC9f4b2EBAd0a803759bbf", decimals: 18, symbol: "WFRAX" };
const POOL: Address = "0x605abD1873737CA9a9Ec1CFa52CDfc8ef62c2E1d";
const OTHER: Address = "0x0BA69825c4C033e72309F6AC0Bde0023b15Cc97c";
const pay = (token: Token, amount: bigint, at = POOL) => ({ pool: at, contract: at, token, amount, fee: at === POOL });
const PRICES = new Map(Object.entries({ [key(USDC.address)]: 1, [key(HYDX.address)]: 0.025 }));
const round = (value: number) => Math.round(value * 1e6) / 1e6;

test("a voter's share of a reward contract's rewards rounds down, as the contract's does", () => {
  assert.deepEqual(
    [1n, 3n].map((votes) => earnedBy(1_000_000_000n, 3n, votes)),
    [333_333_333n, 999_999_999n],
  );
  assert.equal(earnedBy(10n ** 6n, 10n ** 24n, 10n ** 24n), 10n ** 6n);
  assert.equal(earnedBy(0n, 5n, 5n), 0n);
});

test("earnings' value: fees and incentives apart, by pool, a token without a price counting for nothing", () => {
  const { fees, incentives, total, byPool, unit } = valueOf({
    start: 1_791_417_600,
    votes: 897_042n * 10n ** 18n,
    pools: [],
    rewards: [
      pay(USDC, 14_099_868n),
      pay(USDC, 663_168_290n, OTHER),
      pay(HYDX, 27n * 10n ** 18n),
      pay(WFRAX, 10n ** 17n, OTHER),
    ],
    prices: { unit: "USD", of: PRICES, standIns: new Map() },
  });
  assert.deepEqual(
    [fees, incentives, total, ...byPool.values()].map(round),
    [14.774868, 663.16829, 677.943158, 14.774868, 663.16829],
  );
  assert.deepEqual([...byPool.keys(), unit], [key(POOL), key(OTHER), "USD"]);
});
