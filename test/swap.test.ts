import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import {
  decodeFunctionData,
  encodeAbiParameters,
  encodeErrorResult,
  encodeEventTopics,
  encodeFunctionResult,
  numberToHex,
  erc20Abi,
  parseAbi,
  parseAbiParameters,
  zeroAddress,
  zeroHash,
  type Address,
  type Hex,
} from "viem";
import { CBBTC, EXCHANGES, HYDX, SWAPPERS, USDC, WETH } from "../src/config.ts";
import { BY_ID, forget, key, pairKey, waysFor, type Hop } from "../src/prices.ts";
import { same, type Read } from "../src/rpc.ts";
import {
  MAX_SWAP_GAS,
  best,
  candidatePaths,
  feeOf,
  findRoute,
  hopsWords,
  minimumOf,
  paidOf,
  partOf,
  quoteAll,
  reasonOf,
  routeGas,
  simulatePlan,
  split,
  swapGas,
  swapSlip,
  swappedIn,
  swapperAbi,
  venueOf,
  withMinimums,
  type Plan,
  type Result,
  type Route,
} from "../src/swap.ts";

beforeEach(forget);

const AVNT: Address = "0x696F9436B67233384889472Cd7cD58A6fB5DF4f1";
const POOL: Address = "0x0000000000000000000000000000000000000001";
const ME: Address = "0x00000000000000000000000000000000000000AA";
const SWAPPER = SWAPPERS[0]!;
const AERO = SWAPPERS[4]!.token;
const hop = (exchange: number, tokenOut = USDC, fee = 0) => ({ exchange, pool: POOL, tokenOut, fee, tickSpacing: 0 });
const route = (amount: bigint, hops = [hop(10)], token = AVNT): Route => ({ token, amount, minPaid: 0n, hops });
const token = (address: Address, symbol: string, decimals: number) =>
  [key(address), { address, symbol, decimals }] as const;
const TOKENS = new Map([token(AVNT, "AVNT", 18), token(WETH, "WETH", 18), token(USDC, "USDC", 6)]);
const paid = (routes: readonly { amount: bigint }[], done = (_: bigint) => true): Result[] =>
  routes.map(({ amount }) => ({ done: done(amount), amountIn: amount, amountOut: 2n * amount, reason: "0x" }));

test("a token's routes go to the output straight, or through WETH, USDC or cbBTC, and HYDX for Hydrex's tokens", () => {
  assert.deepEqual(candidatePaths(AVNT, USDC), [
    [AVNT, USDC],
    [AVNT, WETH, USDC],
    [AVNT, CBBTC, USDC],
  ]);
  assert.deepEqual(candidatePaths(AVNT, USDC, true).slice(3), [
    [AVNT, HYDX, USDC],
    [AVNT, HYDX, WETH, USDC],
  ]);
  assert.deepEqual(candidatePaths(WETH, USDC), [
    [WETH, USDC],
    [WETH, CBBTC, USDC],
  ]);
  assert.deepEqual(candidatePaths(USDC, USDC), []);
  assert.deepEqual(candidatePaths(USDC, AERO, true).at(-1), [USDC, HYDX, WETH, AERO]);
  for (const from of [AVNT, USDC, WETH, CBBTC, HYDX])
    for (const to of [USDC, WETH, AERO])
      for (const path of candidatePaths(from, to, true)) {
        assert.ok(path.length <= 4 && path.at(-1) === to);
        assert.equal(new Set(path).size, path.length, "no loop through the token sold");
      }
});

test("the swapper's twelve exchanges each have their place, and a route names its tokens, then each venue once", () => {
  const ids = BY_ID.map(({ id }) => id);
  assert.deepEqual(ids, [...Array(12).keys()]);
  assert.deepEqual([...new Set(ids.map((id) => venueOf(hop(id))))], ["Hydrex", "Aero", "Aerodrome", "Uniswap"]);
  const words = (...hops: Hop[]) => hopsWords(route(1n, hops), TOKENS);
  assert.equal(words(hop(6)), "AVNT → USDC via Aerodrome");
  assert.equal(words(hop(6, WETH), hop(8)), "AVNT → WETH → USDC via Aerodrome");
  assert.equal(words(hop(6, WETH), hop(10, USDC, 500)), "AVNT → WETH → USDC via Aerodrome, Uniswap");
  assert.equal(words(hop(4, WETH), hop(6)), "AVNT → WETH → USDC via Aero, Aerodrome");
});

test("Aero's basic pools win a hop only by more than 1%, as their tax is not in the quote", () => {
  const aero = { way: hop(2), out: 1_005n };
  const uniswap = { way: hop(10, USDC, 500), out: 1_000n };
  assert.equal(best([aero, uniswap]), uniswap);
  assert.equal(best([{ ...aero, out: 1_011n }, uniswap])!.out, 1_011n);
  assert.equal(best([aero]), aero);
  assert.equal(best([{ ...uniswap, out: 0n }]), undefined);
  assert.equal(best([uniswap, { way: hop(9), out: 1_001n }])!.out, 1_001n);
});

test("the minimum is the quote, less the swap's 1% as its code rounds it, less the margin; a part shrinks it", () => {
  assert.deepEqual(
    [feeOf(1_000_000n), feeOf(99n), paidOf(1_000_000n), minimumOf(0n, 50n)],
    [10_000n, 0n, 990_000n, 0n],
  );
  assert.deepEqual([minimumOf(1_000_000n, 50n), minimumOf(1_000_000n, 0n)], [985_050n, 990_000n]);
  const item = { out: 1_000n, route: { ...route(100n), minPaid: 985n } };
  assert.deepEqual(partOf(item, 60n, 100n), { out: 600n, route: { ...item.route, amount: 60n, minPaid: 591n } });
  assert.deepEqual(partOf(item, 120n, 100n), { ...item, route: { ...item.route, amount: 120n } }, "not for more");
});

test("routes split into as few swaps as keep each under 15 million gas", () => {
  const algebra = { hops: [hop(0)] };
  const uniswap = { hops: [hop(9, WETH), hop(10, USDC, 500)] };
  assert.deepEqual([routeGas(algebra), routeGas(uniswap)], [1_050_000n, 210_000n]);
  assert.deepEqual(split([uniswap, uniswap]), [[uniswap, uniswap]]);
  const swaps = split(Array.from({ length: 20 }, () => algebra));
  const sizes = swaps.map(({ length }) => length);
  assert.deepEqual(sizes, [14, 6]);
  for (const each of swaps) assert.ok(swapGas(each) <= MAX_SWAP_GAS);
  assert.deepEqual(split([]), []);
});

test("a swap is swap(routes, deadline, true), selling each token once, in as many routes as it has parts", () => {
  // From the verified source on Sourcify, not from `src/swap.ts`, so a wrong ABI there fails the test.
  const abi = parseAbi([
    "function swap((address token, uint256 amount, uint256 minPaid, (uint8 exchange, address pool, address tokenOut, uint24 fee, int24 tickSpacing)[] hops)[] routes, uint256 deadline, bool skipFailed) returns ((bool done, uint256 amountIn, uint256 amountOut, bytes reason)[] results, uint256 paid, uint256 fee)",
  ]);
  const part = (exchange: number) => ({ ...route(10n ** 18n, [hop(exchange)]), minPaid: 10n ** 6n });
  const slip = swapSlip(SWAPPER, [part(0), part(6)], 1_792_627_200n, TOKENS);
  assert.equal(slip.to, SWAPPER.address);
  assert.deepEqual(decodeFunctionData({ abi, data: slip.data }).args, [[part(0), part(6)], 1_792_627_200n, true]);
  assert.equal(slip.says, "Sell 1 token for at least 2 USDC");
  const labels = slip.fields.map(({ label }) => label);
  assert.deepEqual(labels.slice(0, 3), ["Route 1", "Route 2", "Deadline"]);
});

test("each route's quote comes back to it, whatever the swapper and however the quotes are batched", async () => {
  // Each swapper pays the amount times its index in `SWAPPERS` plus one, so a quote returned to the wrong route shows.
  const rd: Read = async (calls): Promise<any> =>
    calls.map(({ address, args: [routes] }) => {
      const place = BigInt(SWAPPERS.findIndex((swapper) => swapper.address === address) + 1);
      return paid(routes as Route[]).map((result) => ({ ...result, amountOut: result.amountIn * place }));
    });
  const items = Array.from({ length: 40 }, (_, i) => ({ swapper: SWAPPERS[i % 3]!, route: route(BigInt(i + 1)) }));
  const quoted = (await quoteAll(items, rd)).map((result) => result?.amountOut);
  const expected = items.map(({ route, swapper }) => route.amount * BigInt(SWAPPERS.indexOf(swapper) + 1));
  assert.deepEqual(quoted, expected);
});

// Slipstream factories' tick spacings by exchange id. Every reader here must answer the same, because `prices.ts` keeps
// the first answer it reads for the whole run.
const SPACINGS: Record<number, number[]> = { 4: [1, 100], 6: [1], 7: [50], 8: [] };
const spacingsAt = (address: Address) => SPACINGS[BY_ID.find(({ factory }) => same(factory, address))!.id];

test("a pair is looked up on every exchange, fee and spacing; a v4 pool counts once priced and liquid", async () => {
  let [lookups, slots] = [0, 0];
  const rd: Read = async (calls): Promise<any> =>
    calls.map(({ address, functionName }) => {
      if (functionName === "tickSpacings") return spacingsAt(address);
      lookups++;
      if (functionName === "poolByPair") return POOL;
      if (functionName !== "extsload") return zeroAddress;
      // Uniswap v4's fee tiers answer, in turn: no pool, a price without liquidity, liquidity without a price, and
      // both.
      const n = BigInt(slots++);
      return [n & 1n, 0n, 0n, n & 2n].map((word) => numberToHex(word, { size: 32 }));
    });
  const ways = await waysFor([[AVNT, USDC]], undefined, rd);
  assert.equal(lookups, 20, "Hydrex 3, Aero 4, Aerodrome 4, Uniswap v2 1, v3 4, v4 4");
  const found = ways.get(pairKey(AVNT, USDC))!.map((way) => [way.exchange, way.pool, way.fee, way.tickSpacing]);
  assert.deepEqual(found.flat(), [0, POOL, 0, 0, 11, zeroAddress, 10_000, 200]);
});

test("a route of one hop is quoted once, as its hop, and not again as a whole", async () => {
  // The only pool is Uniswap v3's at 0.05% from AVNT to USDC.
  const v3 = EXCHANGES.find(({ kind }) => kind === "v3")!;
  let quoted = 0;
  const rd: Read = async (calls): Promise<any> =>
    calls.map(({ address, functionName, args }) => {
      if (functionName === "quote") return ((quoted += (args[0] as Route[]).length), paid(args[0] as Route[]));
      if (functionName === "tickSpacings") return spacingsAt(address);
      if (functionName === "extsload") return Array(4).fill(zeroHash);
      const found = same(address, v3.factory) && args[2] === 500 && [AVNT, USDC].every((t) => args.includes(t));
      return found ? POOL : zeroAddress;
    });
  const found = await findRoute(AVNT, 1_000n, SWAPPER, false, undefined, rd);
  assert.deepEqual([found?.out, found?.route.hops.length, quoted], [2_000n, 1, 1]);
});

test("a plan runs through Base after one approval per token, and each item gets its minimum", async (t) => {
  const refused = encodeErrorResult({ abi: swapperAbi, errorName: "TokenCallFailed", args: [WETH] });
  let calls: { to: Address; data: Hex }[] = [];
  t.mock.method(globalThis, "fetch", async (_: unknown, init: RequestInit) => {
    calls = JSON.parse(String(init.body)).params[0].blockStateCalls[0].calls;
    const replies = calls.map(({ to, data }) => {
      if (to !== SWAPPER.address) return { status: "0x1", returnData: "0x", gasUsed: "0x1" };
      const sent = decodeFunctionData({ abi: swapperAbi, data }).args[0] as Route[];
      // The simulation succeeds only when no route has a minimum. Each route then fetches what it can, except WETH's
      // route of 18, which its token refuses.
      const results = paid(sent, (amount) => amount !== 18n).map((r) => (r.done ? r : { ...r, reason: refused }));
      const returnData = encodeFunctionResult({ abi: swapperAbi, functionName: "swap", result: [results, 0n, 0n] });
      return { status: sent.every(({ minPaid }) => minPaid === 0n) ? "0x1" : "0x0", returnData, gasUsed: "0x10" };
    });
    return Response.json({ result: [{ calls: replies }] });
  });
  // Twenty routes of about a million gas each make two swaps. The first two routes are parts of AVNT, whose allowance
  // of 50 is short of their 100, so AVNT needs one approval.
  const item = (amount: bigint, address = AVNT, allowance = 50n) => ({
    token: TOKENS.get(key(address))!,
    route: { ...route(amount, [hop(0)], address), minPaid: 7n },
    out: 0n,
    allowance,
  });
  const items = [item(30n), item(70n), ...Array.from({ length: 18 }, (_, i) => item(BigInt(i + 1), WETH, 10n ** 18n))];
  const plan: Plan = { swapper: SWAPPER, items, margin: 50n };
  const run = (await simulatePlan(ME, [], plan, TOKENS, 1_792_627_200n))!;
  assert.equal(calls.length, 1 + 2);
  const approval = decodeFunctionData({ abi: erc20Abi, data: run.steps.approvals[0]!.data });
  assert.deepEqual(approval.args, [SWAPPER.address, 100n]);
  assert.equal(run.gas, 1n + 2n * 16n);
  const found = withMinimums(plan, run.results).map(({ item, reason }) => [item.out, item.route.minPaid, reason]);
  const outs = items.map(({ route }) => (route.amount === 18n ? 0n : 2n * route.amount));
  const expected = outs.map((out) => [out, minimumOf(out, 50n), out ? undefined : "its token refused the transfer"]);
  assert.deepEqual(found, expected);
  const quoted = withMinimums(plan).map(({ item }) => item);
  assert.deepEqual(quoted, items, "without Base's results, as quoted");
});

test("a failed route says why, in words", () => {
  const error = (errorName: "TooLittle" | "Expired", args: unknown[]) =>
    encodeErrorResult({ abi: swapperAbi, errorName, args } as never);
  assert.equal(reasonOf(error("TooLittle", [0n, 1n, 2n])), "it would have fetched less than its minimum");
  assert.equal(reasonOf(error("Expired", [])), "the swap's deadline had passed");
  assert.equal(reasonOf("0x"), "a pool or its token refused it");
});

test("a swap's receipt counts only the caller's own routes", () => {
  const THEM: Address = "0x00000000000000000000000000000000000000bb";
  const log = (eventName: "RouteSwapped" | "Swapped", caller: Address, types: string, values: unknown[]) => ({
    address: SWAPPER.address,
    topics: encodeEventTopics({ abi: swapperAbi, eventName, args: { caller } }) as Hex[],
    data: encodeAbiParameters(parseAbiParameters(types), values),
  });
  const routeSwapped = (caller: Address, amountIn: bigint) =>
    log("RouteSwapped", caller, "uint256, address, uint256, uint256", [0n, AVNT, amountIn, 100n * amountIn]);
  const swapped = (caller: Address, fee: bigint) => log("Swapped", caller, "uint256, uint256", [99n * fee, fee]);
  const logs = [routeSwapped(THEM, 5n), swapped(THEM, 5n), routeSwapped(ME, 1n), swapped(ME, 1n)];
  assert.deepEqual(swappedIn([{ logs }], SWAPPER, ME), {
    swapped: [{ caller: ME, index: 0, token: AVNT, amountIn: 1n, amountOut: 100n }],
    failed: [],
    paid: 99n,
    fee: 1n,
  });
});
