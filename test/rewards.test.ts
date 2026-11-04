import assert from "node:assert/strict";
import { test } from "node:test";
import type { Address } from "viem";
import { key, type Token } from "../src/prices.ts";
import { earnedBy, partOf, perThousandOf, poolOf, shareOf, valueOf, versus } from "../src/rewards.ts";

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
  const earnings = {
    start: 1_791_417_600,
    votes: 897_042n * 10n ** 18n,
    pools: [],
    rewards: [
      pay(USDC, 14_099_868n),
      pay(USDC, 663_168_290n, OTHER),
      pay(HYDX, 27n * 10n ** 18n),
      pay(WFRAX, 10n ** 17n, OTHER),
    ],
    prices: { unit: "USD" as const, of: PRICES },
    standIns: new Map<string, number>(),
  };
  const { fees, incentives, total, byPool, unit, short } = valueOf(earnings);
  assert.deepEqual(
    [fees, incentives, total, ...byPool.values()].map(round),
    [14.774868, 663.16829, 677.943158, 14.774868, 663.16829],
  );
  assert.deepEqual([...byPool.keys(), unit], [key(POOL), key(OTHER), "USD"]);
  // WFRAX has no price at the flip, nor today: it counts for nothing, and nothing says "at least".
  assert.deepEqual(short, { total: false, fees: false, incentives: false, pools: new Set() });
});

test("earnings say 'at least' where what they leave out is worth 1% or more at today's prices", () => {
  const earnings = (wfrax: number) => ({
    start: 1_791_417_600,
    votes: 10n ** 21n,
    pools: [],
    rewards: [pay(USDC, 1_000_000_000n), pay(USDC, 50_000_000n, OTHER), pay(WFRAX, 10n ** 18n, OTHER)],
    prices: { unit: "USD" as const, of: PRICES },
    standIns: new Map([[key(WFRAX.address), wfrax]]),
  });
  // $1,000 of fees and $50 of incentives, and 1 WFRAX left out of the incentives.
  const worth = (wfrax: number) => valueOf(earnings(wfrax)).short;
  assert.deepEqual(worth(20), { total: true, fees: false, incentives: true, pools: new Set([key(OTHER)]) });
  assert.deepEqual(worth(1), { total: false, fees: false, incentives: true, pools: new Set([key(OTHER)]) });
  assert.deepEqual(worth(0.4), { total: false, fees: false, incentives: false, pools: new Set() });
  assert.equal(perThousandOf(earnings(20)).atLeast, true);
  assert.equal(perThousandOf(earnings(1)).atLeast, undefined);
});

test("the figures shown say 'at least' for the part, the pool, the share or the rate that leaves out much", () => {
  const earnings = {
    start: 1_791_417_600,
    votes: 4n * 10n ** 21n,
    pools: [],
    rewards: [pay(USDC, 1_000_000_000n), pay(USDC, 50_000_000n, OTHER), pay(WFRAX, 10n ** 18n, OTHER)],
    prices: { unit: "USD" as const, of: PRICES },
    standIns: new Map([[key(WFRAX.address), 1]]),
  };
  // 1 WFRAX at $1 is 2% of the $50 of incentives, all in OTHER, but under 1% of the $1,050 in all.
  const value = valueOf(earnings);
  const brief = ({ value, atLeast }: { value: number; atLeast?: true }) => [round(value), !!atLeast];
  assert.deepEqual(brief(partOf(value, "total")), [1_050, false]);
  assert.deepEqual(brief(partOf(value, "fees")), [1_000, false]);
  assert.deepEqual(brief(partOf(value, "incentives")), [50, true]);
  assert.deepEqual(brief(poolOf(value, POOL)), [1_000, false]);
  assert.deepEqual(brief(poolOf(value, OTHER.toLowerCase() as Address)), [50, true], "whatever the address's case");
  assert.deepEqual(brief(shareOf(earnings, 10n ** 21n)), [262.5, false], "a quarter of the votes");
  assert.deepEqual(brief(perThousandOf(earnings)), [262.5, false]);
  const more = { ...earnings, standIns: new Map([[key(WFRAX.address), 20]]) };
  assert.deepEqual(brief(shareOf(more, 2n * 10n ** 21n)), [525, true]);
  assert.deepEqual(brief(perThousandOf(more, valueOf(more))), [262.5, true]);
  assert.deepEqual(brief(shareOf({ ...earnings, votes: 0n }, 10n ** 21n)), [0, false], "no votes, no rate");
});

test("at another's prices, a reward they leave out counts at its own price to say 'at least'", () => {
  const PLAIN: Token = { address: "0x00000000000000000000000000000000000000aa", decimals: 18, symbol: "PLAIN" };
  // An automation's 5 PLAIN were priced at $4, but all of Hydrex's 80 PLAIN were too many for PLAIN's pools.
  const base = { start: 1_791_417_600, pools: [], standIns: new Map<string, number>() };
  const mine = {
    ...base,
    votes: 10n ** 21n,
    rewards: [pay(USDC, 100_000_000n), pay(PLAIN, 5n * 10n ** 18n)],
    prices: { unit: "USD" as const, of: new Map([...PRICES, [key(PLAIN.address), 4]]) },
  };
  const all = {
    ...base,
    votes: 10n ** 22n,
    rewards: [pay(USDC, 1_000_000_000n), pay(PLAIN, 80n * 10n ** 18n)],
    prices: { unit: "USD" as const, of: PRICES },
    standIns: new Map([[key(PLAIN.address), 4]]),
  };
  const atAll = valueOf(mine, all.prices);
  assert.equal(atAll.total, 100);
  assert.deepEqual(atAll.short, { total: true, fees: true, incentives: false, pools: new Set([key(POOL)]) });
  assert.equal(versus(mine, all), 1, "and compares at the same prices: $100 per 1,000 votes each");
});
