import assert from "node:assert/strict";
import { test } from "node:test";
import { decodeFunctionData, parseAbi, zeroAddress, type Address } from "viem";
import { EXCHANGES, HYDX, SWAPPERS, WETH } from "../src/config.ts";
import {
  MAX_SWAP_GAS,
  best,
  candidatePaths,
  feeOf,
  lookups,
  minimumOf,
  paidOf,
  poolName,
  routeGas,
  split,
  swapCall,
  swapGas,
  type Hop,
} from "../src/swap.ts";

const [USDC, , , CBBTC] = SWAPPERS.map(({ token }) => token) as [Address, Address, Address, Address];
const AVNT: Address = "0x696F9436B67233384889472Cd7cD58A6fB5DF4f1";
const POOL: Address = "0x0000000000000000000000000000000000000001";
const hop = (exchange: number, tokenOut: Address = USDC, fee = 0, tickSpacing = 0): Hop => ({
  exchange,
  pool: POOL,
  tokenOut,
  fee,
  tickSpacing,
});

test("a token's routes go to the output straight, or through WETH, USDC or cbBTC, and HYDX for Hydrex's tokens", () => {
  assert.deepEqual(candidatePaths(AVNT, USDC), [
    [AVNT, USDC],
    [AVNT, WETH, USDC],
    [AVNT, CBBTC, USDC],
  ]);
  assert.deepEqual(candidatePaths(AVNT, USDC, true), [
    [AVNT, USDC],
    [AVNT, WETH, USDC],
    [AVNT, CBBTC, USDC],
    [AVNT, HYDX, USDC],
    [AVNT, HYDX, WETH, USDC],
  ]);
  // No route passes through the token itself or ends before the output, and none has more than three hops.
  assert.deepEqual(candidatePaths(WETH, USDC), [
    [WETH, USDC],
    [WETH, CBBTC, USDC],
  ]);
  assert.deepEqual(candidatePaths(USDC, USDC), []);
  for (const path of candidatePaths(AVNT, WETH, true)) {
    assert.ok(path.length <= 4);
    assert.equal(path.at(-1), WETH);
    assert.equal(new Set(path).size, path.length);
  }
});

test("each pair of tokens is looked up in every factory, every fee tier and every tick spacing", () => {
  const spacings = new Map([
    [4, [1, 100]],
    [6, [1]],
    [7, [50]],
    [8, []],
  ]);
  const found = lookups(AVNT, USDC, spacings);
  // Hydrex: Algebra, and classic volatile and stable; Aero: volatile, stable, two spacings; Aerodrome: volatile,
  // stable, two spacings; Uniswap: v2, v3's four tiers, v4's four standard pools.
  assert.equal(found.length, 1 + 2 + 1 + 1 + 2 + 2 + 1 + 1 + 0 + 1 + 4 + 4);
  assert.ok(found.every(({ call }) => EXCHANGES.some(({ factory }) => factory === call.address)));
  // A factory that has no pool answers the zero address, which is no pool.
  assert.equal(found[0]!.way(zeroAddress), undefined);
  assert.deepEqual(found[0]!.way(POOL), {
    exchange: 0,
    pool: POOL,
    tokenIn: AVNT,
    tokenOut: USDC,
    fee: 0,
    tickSpacing: 0,
  });
  // A v4 pool counts once its price is set and it holds liquidity.
  const v4 = found.at(-1)!;
  const word = (n: bigint) => `0x${n.toString(16).padStart(64, "0")}`;
  assert.equal(v4.way([word(0n), word(0n), word(0n), word(5n)]), undefined);
  assert.equal(v4.way([word(1n), word(0n), word(0n), word(0n)]), undefined);
  assert.deepEqual(v4.way([word(1n), word(0n), word(0n), word(5n)]), {
    exchange: 11,
    pool: zeroAddress,
    tokenIn: AVNT,
    tokenOut: USDC,
    fee: 10_000,
    tickSpacing: 200,
  });
});

test("the twelve exchanges are in the order of the swapper's enum", () => {
  assert.deepEqual(
    EXCHANGES.map(({ id }) => id),
    Array.from({ length: 12 }, (_, i) => i),
  );
  assert.equal(poolName(hop(10, USDC, 500)), "Uniswap v3 0.05%");
  assert.equal(poolName(hop(4, USDC, 0, 100)), "Aero, Slipstream, tick spacing 100");
  assert.equal(poolName(hop(0)), "Hydrex, Algebra pools");
});

test("Aero's classic pools win a hop only by more than 1%, as their tax is not in the quote", () => {
  const aero = { way: hop(2), out: 1_005n };
  const uniswap = { way: hop(10, USDC, 500), out: 1_000n };
  assert.equal(best([aero, uniswap]), uniswap);
  assert.equal(best([{ ...aero, out: 1_011n }, uniswap])!.out, 1_011n);
  assert.equal(best([aero])!.way.exchange, 2);
  assert.equal(best([{ ...uniswap, out: 0n }]), undefined);
  assert.equal(best([uniswap, { way: hop(9), out: 1_001n }])!.out, 1_001n);
});

test("the minimum is the quote, less the swap's 1% as its code rounds it, less the margin", () => {
  assert.equal(feeOf(1_000_000n), 10_000n);
  assert.equal(feeOf(99n), 0n);
  assert.equal(paidOf(1_000_000n), 990_000n);
  assert.equal(minimumOf(1_000_000n, 50n), 985_050n);
  assert.equal(minimumOf(1_000_000n, 0n), 990_000n);
  assert.equal(minimumOf(0n, 50n), 0n);
});

test("routes split into as few swaps as keep each under 15 million gas", () => {
  const algebra = { hops: [hop(0)] };
  const uniswap = { hops: [hop(9, WETH), hop(10, USDC, 500)] };
  assert.equal(routeGas(algebra), 1_050_000n);
  assert.equal(routeGas(uniswap), 210_000n);
  assert.deepEqual(split([uniswap, uniswap]), [[uniswap, uniswap]]);
  const many = Array.from({ length: 20 }, () => algebra);
  const swaps = split(many);
  assert.equal(swaps.length, 2);
  assert.equal(swaps.flat().length, 20);
  for (const each of swaps) assert.ok(swapGas(each) <= MAX_SWAP_GAS);
  assert.deepEqual(split([]), []);
});

test("the swap's call is swap(routes, deadline, true), as the verified source declares it", () => {
  // Written separately from src/swap.ts, from the verified source on Sourcify.
  const abi = parseAbi([
    "function swap((address token, uint256 amount, uint256 minPaid, (uint8 exchange, address pool, address tokenOut, uint24 fee, int24 tickSpacing)[] hops)[] routes, uint256 deadline, bool skipFailed) returns ((bool done, uint256 amountIn, uint256 amountOut, bytes reason)[] results, uint256 paid, uint256 fee)",
  ]);
  const route = { token: AVNT, amount: 41n, minPaid: 7n, hops: [hop(0, WETH), hop(10, USDC, 500)] };
  const { to, data } = swapCall(SWAPPERS[0]!, [route], 1_792_627_200n);
  assert.equal(to, SWAPPERS[0]!.address);
  const { args } = decodeFunctionData({ abi, data });
  assert.deepEqual(args, [[route], 1_792_627_200n, true]);
});
