import assert from "node:assert/strict";
import { test } from "node:test";
import {
  decodeFunctionData,
  encodeAbiParameters,
  encodeEventTopics,
  encodeFunctionResult,
  parseAbi,
  toFunctionSelector,
  zeroAddress,
  type Address,
  type Hex,
} from "viem";
import { EXCHANGES, HYDX, SWAPPERS, WETH } from "../src/config.ts";
import {
  MAX_SWAP_GAS,
  best,
  candidatePaths,
  feeOf,
  findRoute,
  hopName,
  minimumOf,
  onBase,
  paidOf,
  partOf,
  poolName,
  quoteAll,
  venueOf,
  routeGas,
  split,
  swapCall,
  swapGas,
  swappedIn,
  swapperAbi,
} from "../src/swap.ts";
import { lookups, type Hop } from "../src/pools.ts";
import { pricesIn } from "../src/prices.ts";
import { ethCost, gasCost, hopsWords } from "../src/swap-calls.ts";

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

test("the page lists each of the swapper's twelve exchanges once, by its place in the swapper's enum", () => {
  assert.deepEqual(
    EXCHANGES.map(({ id }) => id).sort((a, b) => a - b),
    Array.from({ length: 12 }, (_, i) => i),
  );
  assert.deepEqual(
    [...new Set(EXCHANGES.map(({ name }) => name))],
    [
      "Aero Basic Pools",
      "Aero Slipstream",
      "Aerodrome Basic Pools",
      "Aerodrome Slipstream V3",
      "Aerodrome Slipstream V2",
      "Aerodrome Slipstream",
      "Uniswap v4",
      "Uniswap v3",
      "Uniswap v2",
      "Hydrex Classic Pools",
      "Hydrex Integral",
    ],
  );
  assert.equal(poolName(hop(10, USDC, 500)), "Uniswap v3 0.05%");
  assert.equal(poolName(hop(4, USDC, 0, 100)), "Aero Slipstream, tick spacing 100");
  assert.equal(poolName(hop(0)), "Hydrex Integral");
  // A bill names a hop's pool without its tick spacing, and without its address.
  assert.equal(hopName(hop(10, USDC, 500)), "Uniswap v3 0.05%");
  assert.equal(hopName(hop(4, USDC, 0, 100)), "Aero Slipstream");
  assert.equal(hopName(hop(0)), "Hydrex Integral");
});

test("a bill's route: its tokens, then who runs its pools, each once, with Aero's and Aerodrome's apart", () => {
  assert.deepEqual(
    [...new Set(EXCHANGES.map((exchange) => venueOf(hop(exchange.id))))],
    ["Aero", "Aerodrome", "Uniswap", "Hydrex"],
  );
  const tokens = new Map(
    [
      { address: AVNT, symbol: "AVNT", decimals: 18 },
      { address: WETH, symbol: "WETH", decimals: 18 },
      { address: USDC, symbol: "USDC", decimals: 6 },
    ].map((token) => [token.address.toLowerCase(), token]),
  );
  const route = (...hops: Hop[]) => ({ token: AVNT, amount: 1n, minPaid: 1n, hops });
  assert.equal(hopsWords(route(hop(6)), tokens), "AVNT → USDC via Aerodrome");
  assert.equal(hopsWords(route(hop(6, WETH), hop(8)), tokens), "AVNT → WETH → USDC via Aerodrome");
  assert.equal(hopsWords(route(hop(6, WETH), hop(10, USDC, 500)), tokens), "AVNT → WETH → USDC via Aerodrome, Uniswap");
  assert.equal(hopsWords(route(hop(4, WETH), hop(6)), tokens), "AVNT → WETH → USDC via Aero, Aerodrome");
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

test("no route loops through the token it sells, as WETH and USDC can be Hydrex's reward tokens", () => {
  for (const [token, output] of [
    [USDC, SWAPPERS[4]!.token],
    [WETH, USDC],
    [CBBTC, USDC],
  ] as const) {
    for (const path of candidatePaths(token, output, true)) assert.equal(new Set(path).size, path.length, `${path}`);
  }
  assert.deepEqual(candidatePaths(USDC, SWAPPERS[4]!.token, true).at(-1), [USDC, HYDX, WETH, SWAPPERS[4]!.token]);
});

test("each route's quote comes back to it, whatever the swapper and however the quotes are batched", async () => {
  const multicall = parseAbi([
    "function aggregate3((address target, bool allowFailure, bytes callData)[] calls) payable returns ((bool success, bytes returnData)[])",
  ]);
  const original = globalThis.fetch;
  // Each swapper quotes a route as its amount times the swapper's place in the list, plus one, so that a quote that
  // comes back to the wrong route, or from the wrong swapper, shows.
  globalThis.fetch = async (_, init) => {
    const { params } = JSON.parse(String(init?.body)) as { params: [{ data: Hex }] };
    const { args } = decodeFunctionData({ abi: multicall, data: params[0].data });
    const replies = args[0].map(({ target, callData }) => {
      const place = BigInt(SWAPPERS.findIndex(({ address }) => address === target) + 1);
      const { args: routes } = decodeFunctionData({ abi: swapperAbi, data: callData });
      const results = (routes[0] as readonly { amount: bigint }[]).map(({ amount }) => ({
        done: true,
        amountIn: amount,
        amountOut: amount * place,
        reason: "0x" as Hex,
      }));
      return {
        success: true,
        returnData: encodeFunctionResult({ abi: swapperAbi, functionName: "quote", result: results }),
      };
    });
    const result = encodeFunctionResult({ abi: multicall, functionName: "aggregate3", result: replies });
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result }));
  };
  try {
    const items = Array.from({ length: 40 }, (_, i) => ({
      swapper: SWAPPERS[i % 3]!,
      route: { token: AVNT, amount: BigInt(i + 1), minPaid: 0n, hops: [hop(10)] },
    }));
    const results = await quoteAll(items);
    assert.deepEqual(
      results.map((result) => result?.amountOut),
      items.map(({ route, swapper }) => route.amount * BigInt(SWAPPERS.indexOf(swapper) + 1)),
    );
  } finally {
    globalThis.fetch = original;
  }
});

test("a swap's receipt counts only the caller's own routes", () => {
  const swapper = SWAPPERS[0]!;
  const ME: Address = "0x00000000000000000000000000000000000000AA";
  const THEM: Address = "0x00000000000000000000000000000000000000bb";
  const log = (eventName: "RouteSwapped" | "Swapped", caller: Address, args: Record<string, unknown>) => ({
    address: swapper.address,
    topics: encodeEventTopics({ abi: swapperAbi, eventName, args: { caller } } as never) as Hex[],
    data:
      eventName === "Swapped"
        ? encodeAbiParameters([{ type: "uint256" }, { type: "uint256" }], [args.paid as bigint, args.fee as bigint])
        : encodeAbiParameters(
            [{ type: "uint256" }, { type: "address" }, { type: "uint256" }, { type: "uint256" }],
            [0n, AVNT, args.amountIn as bigint, args.amountOut as bigint],
          ),
  });
  const receipt = {
    transactionHash: "0x01" as Hex,
    status: "0x1" as Hex,
    logs: [
      log("RouteSwapped", THEM, { amountIn: 5n, amountOut: 500n }),
      log("Swapped", THEM, { paid: 495n, fee: 5n }),
      log("RouteSwapped", ME, { amountIn: 1n, amountOut: 100n }),
      log("Swapped", ME, { paid: 99n, fee: 1n }),
    ],
  };
  assert.deepEqual(swappedIn([receipt], swapper, ME), {
    swapped: [{ index: 0, token: AVNT, amountIn: 1n, amountOut: 100n }],
    failed: [],
    paid: 99n,
    fee: 1n,
  });
});

test("a route for part of what it was quoted for shrinks its quote and minimum in proportion, and not for more", () => {
  const item = { out: 1_000n, route: { token: AVNT, amount: 100n, minPaid: 985n, hops: [hop(10)] } };
  assert.deepEqual(partOf(item, 60n, 100n), { out: 600n, route: { ...item.route, amount: 60n, minPaid: 591n } });
  assert.deepEqual(partOf(item, 100n, 100n), { ...item, route: { ...item.route, amount: 100n } });
  assert.deepEqual(partOf(item, 120n, 100n), { ...item, route: { ...item.route, amount: 120n } });
});

test("a route of one hop is quoted once, as its hop, and not again as a whole", async () => {
  const multicall = parseAbi([
    "function aggregate3((address target, bool allowFailure, bytes callData)[] calls) payable returns ((bool success, bytes returnData)[])",
  ]);
  const v3 = EXCHANGES.find(({ kind }) => kind === "v3")!;
  const v3Abi = parseAbi(["function getPool(address tokenA, address tokenB, uint24 fee) view returns (address)"]);
  const quote = toFunctionSelector(
    "function quote((address,uint256,uint256,(uint8,address,address,uint24,int24)[])[])",
  );
  const tickSpacings = toFunctionSelector("function tickSpacings()");
  const extsload = toFunctionSelector("function extsload(bytes32,uint256)");
  // The only pool is Uniswap v3's at 0.05% from AVNT to USDC, which pays twice what it takes.
  let quoted = 0;
  const original = globalThis.fetch;
  globalThis.fetch = async (_, init) => {
    const { params } = JSON.parse(String(init?.body)) as { params: [{ data: Hex }] };
    const { args } = decodeFunctionData({ abi: multicall, data: params[0].data });
    const replies = args[0].map(({ target, callData }) => {
      const ok = (returnData: Hex) => ({ success: true, returnData });
      if (callData.startsWith(quote)) {
        const { args: routes } = decodeFunctionData({ abi: swapperAbi, data: callData });
        const results = (routes[0] as readonly { amount: bigint }[]).map(({ amount }) => {
          quoted++;
          return { done: true, amountIn: amount, amountOut: 2n * amount, reason: "0x" as Hex };
        });
        return ok(encodeFunctionResult({ abi: swapperAbi, functionName: "quote", result: results }));
      }
      if (callData.startsWith(tickSpacings)) return ok(encodeAbiParameters([{ type: "int24[]" }], [[]]));
      if (callData.startsWith(extsload))
        return ok(encodeAbiParameters([{ type: "bytes32[]" }], [Array(4).fill(`0x${"0".repeat(64)}`)]));
      let pool: Address = zeroAddress;
      if (target.toLowerCase() === v3.factory.toLowerCase()) {
        const {
          args: [a, b, fee],
        } = decodeFunctionData({ abi: v3Abi, data: callData });
        if (a.toLowerCase() === AVNT.toLowerCase() && b.toLowerCase() === USDC.toLowerCase() && fee === 500)
          pool = POOL;
      }
      return ok(encodeAbiParameters([{ type: "address" }], [pool]));
    });
    const result = encodeFunctionResult({ abi: multicall, functionName: "aggregate3", result: replies });
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result }));
  };
  try {
    const found = await findRoute(AVNT, 1_000n, SWAPPERS[0]!, false);
    assert.equal(found?.out, 2_000n);
    assert.equal(found?.route.hops.length, 1);
    assert.equal(quoted, 1);
  } finally {
    globalThis.fetch = original;
  }
});

test("swaps are offered only while the page's RPCs serve Base", async () => {
  const original = globalThis.fetch;
  let chainId = "0x2105";
  globalThis.fetch = async () => new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: chainId }));
  try {
    assert.equal(await onBase(), true);
    chainId = "0x1";
    assert.equal(await onBase(), false);
  } finally {
    globalThis.fetch = original;
  }
});

test("gas is valued at the prices it is compared with, in their unit, and not without ETH's price", () => {
  const eth = WETH.toLowerCase();
  const costs = { gasPrice: 10_000_000n, tip: undefined };
  // 200,000 gas at 0.01 gwei: 0.000002 ETH.
  const inDollars = gasCost(200_000n, costs, pricesIn("USD", [[eth, 2_500]], { EUR: 1.12 }))!;
  assert.ok(Math.abs(inDollars.value - 0.005) < 1e-12);
  assert.deepEqual([inDollars.unit, inDollars.rates], ["USD", { EUR: 1.12 }]);
  assert.equal(gasCost(200_000n, costs, pricesIn("USDC", [[eth, 2_490]]))!.unit, "USDC");
  assert.equal(gasCost(200_000n, costs, pricesIn("USD")), undefined);
  assert.equal(ethCost(10n ** 18n, undefined), undefined);
});
