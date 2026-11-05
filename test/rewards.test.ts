import assert from "node:assert/strict";
import { test } from "node:test";
import {
  decodeFunctionData,
  encodeFunctionResult,
  erc20Abi,
  multicall3Abi,
  parseAbi,
  zeroAddress,
  type Abi,
  type Address,
  type Hex,
} from "viem";
import { escrowAbi, rewardsAbi, voterAbi } from "../src/abi.ts";
import { ANCHORS, FIAT_FEEDS, WETH } from "../src/config.ts";
import { WEEK } from "../src/format.ts";
import { key, type Token } from "../src/prices.ts";
import { read, type Read } from "../src/rpc.ts";
import { allEarnings, earnedBy, aprOf, shareOf, valueOf, votesEarned, type Earnings } from "../src/rewards.ts";

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
  };
  const { fees, incentives, total, byPool, unit } = valueOf(earnings);
  assert.deepEqual(
    [fees, incentives, total, ...byPool.values()].map(round),
    [14.774868, 663.16829, 677.943158, 14.774868, 663.16829],
  );
  assert.deepEqual([...byPool.keys(), unit], [key(POOL), key(OTHER), "USD"]);
});

test("what some votes earned at the rate of others', and their APR, at their prices or another's", () => {
  const PLAIN: Token = { address: "0x00000000000000000000000000000000000000aa", decimals: 18, symbol: "PLAIN" };
  // An automation's 5 PLAIN were priced at $4, but all of Hydrex's 80 PLAIN were too many for PLAIN's pools.
  const mine = {
    start: 1_791_417_600,
    votes: 4n * 10n ** 21n,
    pools: [],
    rewards: [pay(USDC, 1_000_000_000n), pay(USDC, 50_000_000n, OTHER), pay(PLAIN, 5n * 10n ** 18n)],
    prices: { unit: "USD" as const, of: new Map([...PRICES, [key(PLAIN.address), 4]]) },
  };
  const all = {
    ...mine,
    votes: 4n * 10n ** 22n,
    rewards: [pay(USDC, 10_500_000_000n), pay(PLAIN, 80n * 10n ** 18n)],
    prices: { unit: "USD" as const, of: PRICES },
  };
  assert.equal(round(shareOf(mine, 10n ** 21n).value), 267.5, "a quarter of $1,070");
  // A week's $0.2675 a vote, or $0.2625 without PLAIN, for a year of weeks, over HYDX at $0.025.
  const near = (a: number | undefined, b: number) =>
    assert.ok(a !== undefined && Math.abs(a - b) < 1e-9, `${a} ≠ ${b}`);
  near(aprOf(mine), ((1_070 / 4_000) * (365 / 7)) / 0.025);
  near(aprOf(mine, all.prices), ((1_050 / 4_000) * (365 / 7)) / 0.025);
  const unpriced = {
    ...mine.prices,
    of: new Map([...mine.prices.of].filter(([token]) => token !== key(HYDX.address))),
  };
  assert.equal(aprOf(mine, unpriced), undefined, "no price for HYDX, no APR");
  assert.equal(aprOf({ ...mine, votes: 0n }), undefined, "no votes, no APR");
  assert.equal(shareOf({ ...mine, votes: 0n }, 10n ** 21n).value, 0, "no votes, no rate");
});

test("an epoch's rewards are read once for every voter, on its own pools or not, each reading its votes, and priced once", async (t) => {
  const START = 1_791_417_600;
  const NOW = START + WEEK + 3 * 86_400;
  const NEWEST = 1_000_000;
  // Lower case throughout, as maps key by it; Base's answers come checksummed and are lowered before use.
  const at = (n: number): Address => `0x${n.toString(16).padStart(40, "0")}`;
  const [P1, P2, G1, G2, F1, I1, F2, I2, A, B] = [0x11, 0x12, 0x21, 0x22, 0x31, 0x32, 0x41, 0x42, 0xa1, 0xb1].map(
    at,
  ) as [Address, Address, Address, Address, Address, Address, Address, Address, Address, Address];
  const weth = WETH.toLowerCase() as Address;
  const pools = [P1, P2];
  const gauges = new Map([
    [P1, G1],
    [P2, G2],
  ]);
  const bribes = new Map([
    [G1, [F1, I1]],
    [G2, [F2, I2]],
  ]);
  // P1's contracts hold 100 votes, P2's 50; A has 40 in P1, and B 10 in P1 and 25 in P2.
  const supply = new Map([
    [F1, 100n],
    [I1, 100n],
    [F2, 50n],
    [I2, 50n],
  ]);
  const paid = new Map<Address, [Address, bigint][]>([
    [F1, [[USDC.address.toLowerCase() as Address, 1_000_000n]]],
    [I1, [[weth, 10n ** 18n]]],
    [F2, [[USDC.address.toLowerCase() as Address, 500_000n]]],
    [I2, []],
  ]);
  const votes = new Map([
    [
      A,
      new Map([
        [F1, 40n],
        [I1, 40n],
      ]),
    ],
    [
      B,
      new Map([
        [F1, 10n],
        [I1, 10n],
        [F2, 25n],
        [I2, 25n],
      ]),
    ],
  ]);
  const more = parseAbi([
    "function latestRoundData() view returns (uint80, int256, uint256, uint256, uint80)",
    "function getBlockNumber() view returns (uint256)",
    "function getPair(address, address, bool stable) view returns (address)",
    "function poolByPair(address, address) view returns (address)",
  ]);
  const abi = [...voterAbi, ...escrowAbi, ...rewardsAbi, ...erc20Abi, ...multicall3Abi, ...more] as Abi;
  const asked = new Map<string, number>();
  const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
  const answer = (to: Address, functionName: string, args: readonly unknown[], time: number): unknown => {
    const target = to.toLowerCase() as Address;
    const arg = (i: number) => (args[i] as Address).toLowerCase() as Address;
    switch (functionName) {
      case "getBlockNumber":
        return BigInt(NEWEST);
      // HYDX, which APRs need, has no pool here.
      case "getPair":
      case "poolByPair":
        return zeroAddress;
      case "getCurrentBlockTimestamp":
        return BigInt(time);
      case "latestRoundData": {
        const anchor = ANCHORS.find(({ feed }) => same(feed, target));
        return [1n, anchor && same(anchor.address, weth) ? 2_000n * 10n ** 8n : 10n ** 8n, 0n, 0n, 1n];
      }
      case "length":
        return 2n;
      case "_epochTimestamp":
        return BigInt(START + WEEK);
      case "pools":
        return pools[Number(args[0])];
      case "gauges":
        return gauges.get(arg(0));
      case "internal_bribes":
        return bribes.get(arg(0))![0];
      case "external_bribes":
        return bribes.get(arg(0))![1];
      // A voted again since the epoch ended, so its pools are found among every pool's; B last voted as it began.
      case "lastVoted":
        return BigInt(arg(0) === A ? START + WEEK + 60 : START - 60);
      case "poolVoteLength":
        return arg(0) === A ? 1n : 2n;
      case "poolVote":
        return pools[Number(args[1])];
      case "getPastVotes":
        return 100n;
      case "totalWeightAt":
        return 150n;
      case "totalSupplyAt":
        return supply.get(target);
      case "rewardsListLength":
        return BigInt(paid.get(target)!.length);
      case "rewardTokens":
        return paid.get(target)![Number(args[0])]![0];
      case "rewardData":
        return [0n, paid.get(target)!.find(([token]) => same(token, arg(0)))![1], 0n];
      case "balanceOfOwnerAt":
        return votes.get(arg(0))!.get(target) ?? 0n;
      case "symbol":
        return same(target, weth) ? "WETH" : "USDC";
      case "decimals":
        return same(target, weth) ? 18 : 6;
    }
    throw new Error(`Unexpected ${functionName}`);
  };
  t.mock.method(globalThis, "fetch", async (_: unknown, init: RequestInit) => {
    const [{ data }, block] = JSON.parse(String(init.body)).params as [{ data: Hex }, string];
    const time = block === "latest" ? NOW : NOW - (NEWEST - Number(block)) * 2;
    const calls = decodeFunctionData({ abi: multicall3Abi, data }).args[0] as unknown as readonly {
      target: Address;
      callData: Hex;
    }[];
    const result = calls.map(({ target, callData }) => {
      const { functionName, args = [] } = decodeFunctionData({ abi, data: callData });
      asked.set(functionName, (asked.get(functionName) ?? 0) + 1);
      const value = answer(target, functionName, args, time);
      return { success: true, returnData: encodeFunctionResult({ abi, functionName, result: value } as never) };
    });
    return Response.json({ result: encodeFunctionResult({ abi: multicall3Abi, functionName: "aggregate3", result }) });
  });

  // Each through its own read, as each page's are tagged: every call, the pools' list included, goes through one.
  const through = new Map<string, number>();
  const own: Read = (calls, options) => {
    for (const { functionName } of calls) through.set(functionName, (through.get(functionName) ?? 0) + 1);
    return read(calls, options);
  };
  const [a, b, all] = await Promise.all([
    votesEarned(A, START, false, own),
    votesEarned(B, START, false, own),
    allEarnings(START, own),
  ]);
  for (const name of ["length", "pools", "gauges", "internal_bribes", "external_bribes"])
    assert.equal(through.get(name), asked.get(name), `${name} goes through the caller's read`);
  const amounts = ({ rewards }: Earnings) =>
    rewards.map(({ contract, token, amount }) => [contract, token.symbol, amount]);
  assert.deepEqual(amounts(a), [
    [F1, "USDC", 400_000n],
    [I1, "WETH", 4n * 10n ** 17n],
  ]);
  assert.deepEqual(amounts(b), [
    [F1, "USDC", 100_000n],
    [I1, "WETH", 10n ** 17n],
    [F2, "USDC", 250_000n],
  ]);
  assert.deepEqual(amounts(all), [
    [F1, "USDC", 1_000_000n],
    [I1, "WETH", 10n ** 18n],
    [F2, "USDC", 500_000n],
  ]);
  assert.deepEqual(
    a.pools.map(({ address, votes }) => [address, votes]),
    [[P1, 40n]],
  );
  // Every pool's rewards are read once; A, which voted again, reads its votes in every pool's contracts, and B in its
  // own pools'.
  assert.deepEqual(
    ["totalSupplyAt", "rewardsListLength", "rewardTokens", "rewardData", "balanceOfOwnerAt"].map((name) =>
      asked.get(name),
    ),
    [4, 4, 3, 3, 8],
  );
  // One pricing, which every voter's earnings share.
  assert.ok(a.prices === b.prices && b.prices === all.prices);
  assert.equal(asked.get("latestRoundData"), ANCHORS.length + Object.keys(FIAT_FEEDS).length);
  assert.equal(all.prices.of.get(key(weth)), 2_000);
});
