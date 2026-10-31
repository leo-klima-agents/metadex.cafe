import assert from "node:assert/strict";
import { test } from "node:test";
import {
  encodeErrorResult,
  encodeEventTopics,
  encodeAbiParameters,
  parseAbiParameters,
  zeroAddress,
  type Address,
  type Hex,
} from "viem";
import { ABI, CBBTC, HYDX, SWAPPERS, USDC, WETH } from "../src/config.ts";
import {
  best,
  candidatePaths,
  feeOf,
  minimumOf,
  paidOf,
  partOf,
  reasonOf,
  refusedTransfer,
  split,
  swappedIn,
  type Route,
} from "../src/swap.ts";

const TOKEN = "0x000000000000000000000000000000000000c0DE";
const hop = (exchange: number) => ({ exchange, pool: zeroAddress, tokenOut: USDC, fee: 0, tickSpacing: 0 });

test("routes go straight or through WETH, USDC, cbBTC, and HYDX for Hydrex's tokens", () => {
  assert.deepEqual(candidatePaths(TOKEN, USDC), [
    [TOKEN, USDC],
    [TOKEN, WETH, USDC],
    [TOKEN, CBBTC, USDC],
  ]);
  assert.deepEqual(candidatePaths(TOKEN, USDC, true).slice(3), [
    [TOKEN, HYDX, USDC],
    [TOKEN, HYDX, WETH, USDC],
  ]);
  assert.deepEqual(candidatePaths(USDC, USDC), []);
});

test("Aero's classic pools win only by more than 1%", () => {
  const [aero, other] = [hop(2), hop(10)];
  assert.equal(
    best([
      { way: aero, out: 1010n },
      { way: other, out: 1000n },
    ])!.way,
    other,
  );
  assert.equal(
    best([
      { way: aero, out: 1011n },
      { way: other, out: 1000n },
    ])!.way,
    aero,
  );
  assert.equal(best([{ way: other, out: 0n }]), undefined);
});

test("the fee, what reaches you, the minimum, and a part of a route", () => {
  assert.deepEqual([feeOf(10_099n), paidOf(10_099n), minimumOf(10_000n, 50n)], [100n, 9_999n, 9_850n]);
  const route: Route = { token: TOKEN, amount: 100n, minPaid: 90n, hops: [hop(10)] };
  const half = partOf({ route, out: 200n }, 50n, 100n);
  assert.deepEqual([half.out, half.route.amount, half.route.minPaid], [100n, 50n, 45n]);
  assert.equal(partOf({ route, out: 200n }, 150n, 100n).route.minPaid, 90n);
});

test("routes split into swaps of at most 15 million gas, in order", () => {
  const algebra = { token: TOKEN, amount: 1n, minPaid: 0n, hops: [hop(0), hop(0), hop(0)] };
  assert.deepEqual(
    split(Array(5).fill(algebra)).map((swap) => swap.length),
    [4, 1],
  );
});

test("why a route failed, and what a swap did for its caller", () => {
  const tooLittle = encodeErrorResult({ abi: ABI.swapper, errorName: "TooLittle", args: [0n, 1n, 2n] });
  const refused = encodeErrorResult({ abi: ABI.swapper, errorName: "TokenCallFailed", args: [TOKEN] });
  assert.equal(reasonOf(tooLittle), "it would have fetched less than its minimum");
  assert.deepEqual([refusedTransfer(refused), refusedTransfer(tooLittle)], [true, false]);
  const swapper = SWAPPERS[0]!;
  const caller = "0x0000000000000000000000000000000000000001" as const;
  const log = (eventName: "RouteSwapped" | "Swapped", types: string, values: unknown[], who: Address = caller) => ({
    address: swapper.address,
    topics: encodeEventTopics({ abi: ABI.swapper, eventName, args: { caller: who } }) as Hex[],
    data: encodeAbiParameters(parseAbiParameters(types), values),
  });
  const outcome = swappedIn(
    [
      {
        transactionHash: "0x",
        status: "0x1",
        logs: [
          log("RouteSwapped", "uint256, address, uint256, uint256", [0n, TOKEN, 5n, 7n]),
          log("Swapped", "uint256, uint256", [7n, 0n]),
          log("Swapped", "uint256, uint256", [9n, 0n], TOKEN),
        ] as never,
      },
    ],
    swapper,
    caller,
  );
  assert.deepEqual(outcome, {
    swapped: [{ index: 0, token: TOKEN, amountIn: 5n, amountOut: 7n }],
    failed: [],
    paid: 7n,
    fee: 0n,
  });
});
