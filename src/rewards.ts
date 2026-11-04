import { getAddress, parseAbi, type Address } from "viem";
import { rewardsAbi } from "./abi.ts";
import { memo } from "./cache.ts";
import { WEEK, clean, moneyAt, type Money } from "./format.ts";
import { automationAt, escrow, voter } from "./hydrex.ts";
import { key, noPrices, pricesAtFlip, worthOf, type Prices, type Token } from "./prices.ts";
import { call, read, readEach, required, type Read } from "./rpc.ts";
import { tokensOf } from "./tokens.ts";

// What votes earned in an ended epoch, from Hydrex's reward contracts. Each pool's gauge has two, one for the pool's
// fees and one for incentives, and each keeps every epoch's votes and rewards.

type Pool = { address: Address; name: string; votes: bigint };
export type Reward = { pool: Address; contract: Address; token: Token; amount: bigint; fee: boolean };
// The epoch runs from start to start + WEEK; its prices are those at the flip that ended it.
export type Earnings = { start: number; votes: bigint; pools: Pool[]; rewards: Reward[]; prices: Prices };

const poolAbi = parseAbi([
  "function token0() view returns (address)",
  "function token1() view returns (address)",
  "function symbol() view returns (string)",
]);

// An epoch's rewards are final only once Hydrex's own epoch moves on, which happens when someone calls its minter. So
// Hydrex, not the clock, says which epoch ended last.
export async function lastEpoch(): Promise<number> {
  const [active] = required(await read([voter("_epochTimestamp")]));
  return Number(active) - WEEK;
}

type Contract = { pool: Address; address: Address; fee: boolean };
async function contractsOf(pools: Address[], rd: Read): Promise<Contract[]> {
  const gauges = required(await rd(pools.map((pool) => voter("gauges", pool))));
  const bribes = await readEach(
    pools.map((pool, i) => ({ pool, gauge: gauges[i]! })),
    {
      fees: ({ gauge }) => voter("internal_bribes", gauge),
      incentives: ({ gauge }) => voter("external_bribes", gauge),
    },
    rd,
  );
  return bribes.flatMap(({ item: { pool }, fees, incentives }) => {
    if (!fees || !incentives) throw new Error("A read from Base failed.");
    return [
      { pool, address: fees, fee: true },
      { pool, address: incentives, fee: false },
    ];
  });
}
// Every pool's reward contracts, for the average and for voters who voted again after an epoch began. They take
// thousands of reads, so they are read once. Hydrex only adds pools, so the list covers every epoch up to the one under
// way when it was read.
async function allContracts(start: number): Promise<Contract[]> {
  const readAll = async () => {
    const [length, active] = required(await read([voter("length"), voter("_epochTimestamp")]));
    const pools = required(await read(Array.from({ length: Number(length) }, (_, i) => voter("pools", BigInt(i)))));
    return { through: Number(active), contracts: await contractsOf(pools, read) };
  };
  const found = await memo("contracts", readAll);
  return start < found.through ? found.contracts : (await memo(`contracts ${start}`, readAll)).contracts;
}

// A voter's share of a reward contract's rewards for an epoch, rounded as the contract rounds it.
export const earnedBy = (perEpoch: bigint, supply: bigint, balance: bigint): bigint =>
  (((perEpoch * 10n ** 32n) / supply) * balance) / 10n ** 32n;

// What `holder`'s votes, or all votes when `holder` is undefined, earned in these contracts in the epoch from `start`,
// with the votes for each pool.
async function rewardsOf(contracts: Contract[], start: number, holder: Address | undefined, rd: Read) {
  const at = BigInt(start);
  const totals = await readEach(
    contracts,
    {
      supply: ({ address }) => call(address, rewardsAbi, "totalSupplyAt", at),
      length: ({ address }) => call(address, rewardsAbi, "rewardsListLength"),
      balance: holder ? ({ address }) => call(address, rewardsAbi, "balanceOfOwnerAt", holder, at) : undefined,
    },
    rd,
  );
  const voted = totals
    .map(({ item, supply, length, balance }) => {
      const [total, count] = required([supply, length]);
      return { ...item, supply: total, length: Number(count), balance: holder ? required([balance])[0] : total };
    })
    .filter(({ supply, balance }) => supply > 0n && balance > 0n);
  const listed = await readEach(
    voted.flatMap((contract) => Array.from({ length: contract.length }, (_, index) => ({ contract, index }))),
    { token: ({ contract, index }) => call(contract.address, rewardsAbi, "rewardTokens", BigInt(index)) },
    rd,
  );
  const perEpoch = await readEach(
    listed.map(({ item: { contract }, token }) => ({ contract, token: required([token])[0] })),
    { data: ({ contract, token }) => call(contract.address, rewardsAbi, "rewardData", token, at) },
    rd,
  );
  const found = perEpoch.flatMap(({ item: { contract, token }, data }) => {
    const [[, rewards]] = required([data]);
    const amount = holder ? earnedBy(rewards, contract.supply, contract.balance) : rewards;
    return amount > 0n ? [{ pool: contract.pool, contract: contract.address, token, amount, fee: contract.fee }] : [];
  });
  const named = await tokensOf(
    found.map(({ token }) => token),
    rd,
  );
  const rewards = found.flatMap(({ token, ...reward }) => {
    const known = named.get(key(token));
    return known ? [{ ...reward, token: known }] : [];
  });
  // A vote for a pool counts in both of its contracts, so keying by pool counts it once.
  return { rewards, votes: new Map(voted.map(({ pool, balance }) => [pool, balance])) };
}

export const tokensIn = (rewards: Reward[]): Token[] => [
  ...new Map(rewards.map(({ token }) => [key(token.address), token])).values(),
];

async function priced(start: number, votes: bigint, pools: Pool[], rewards: Reward[], rd: Read): Promise<Earnings> {
  const amounts = new Map<string, bigint>();
  for (const { token, amount } of rewards)
    amounts.set(key(token.address), (amounts.get(key(token.address)) ?? 0n) + amount);
  return { start, votes, pools, rewards, prices: await pricesAtFlip(tokensIn(rewards), amounts, start + WEEK, rd) };
}

// What a voter earned in the epoch from `start`: an automation, whose pools are `named`, or an owner. Rewards go to the
// votes standing when the epoch starts. A voter with no votes then, or that has not voted since the epoch before began,
// earned nothing. Hydrex's Voter keeps only a voter's latest pools, so once it votes again, as the automations do just
// before each flip, its pools are found among every pool's.
export async function votesEarned(holder: Address, start: number, named: boolean, rd: Read = read): Promise<Earnings> {
  const [voted, length, votes] = required(
    await rd([
      voter("lastVoted", holder),
      voter("poolVoteLength", holder),
      escrow("getPastVotes", holder, BigInt(start)),
    ]),
  );
  if (!votes || Number(voted) < start - WEEK) return { start, votes, pools: [], rewards: [], prices: noPrices() };
  const contracts =
    Number(voted) >= start + WEEK
      ? await allContracts(start)
      : await contractsOf(
          required(await rd(Array.from({ length: Number(length) }, (_, i) => voter("poolVote", holder, BigInt(i))))),
          rd,
        );
  const { rewards, votes: byPool } = await rewardsOf(contracts, start, holder, rd);
  const used = [...byPool];
  const pools = named ? await withNames(used, rd) : used.map(([address, votes]) => ({ address, name: "", votes }));
  pools.sort((a, b) => (a.votes === b.votes ? 0 : a.votes > b.votes ? -1 : 1));
  return priced(start, votes, pools, rewards, rd);
}
// Names a pool by its two tokens, a classic pair (`sAMM-`, `vAMM-`) by its own symbol, and a vault by both.
async function withNames(used: [Address, bigint][], rd: Read): Promise<Pool[]> {
  const found = await readEach(
    used,
    {
      token0: ([pool]) => call(pool, poolAbi, "token0"),
      token1: ([pool]) => call(pool, poolAbi, "token1"),
      kind: ([pool]) => call(pool, poolAbi, "symbol"),
    },
    rd,
  );
  const symbols = await tokensOf(
    found.flatMap(({ token0, token1 }) => [token0, token1]).filter((token) => token !== undefined),
    rd,
  );
  const symbol = (address: Address) => symbols.get(key(address))?.symbol ?? "?";
  return found.map(({ item: [address, votes], token0, token1, kind: own }) => {
    const kind = clean(own);
    const pair = token0 && token1 ? `${symbol(token0)} / ${symbol(token1)}` : "";
    return {
      address,
      name: /^[sv]AMM-/.test(kind) ? kind : pair && kind ? `${pair} (${kind})` : pair || kind || address,
      votes,
    };
  });
}

export async function allEarnings(start: number, rd: Read = read): Promise<Earnings> {
  const [[votes], found] = await Promise.all([
    rd([voter("totalWeightAt", BigInt(start))]).then(required),
    allContracts(start).then((all) => rewardsOf(all, start, undefined, rd)),
  ]);
  const pools = [...found.votes].map(([address, poolVotes]) => ({ address, name: "", votes: poolVotes }));
  return priced(start, votes, pools, found.rewards, rd);
}

export async function rewardsFor(automation: Address, start: number, rd: Read = read): Promise<Reward[]> {
  const [votes] = required(await rd([escrow("getPastVotes", automation, BigInt(start))]));
  return votes ? (await rewardsOf(await allContracts(start), start, automation, rd)).rewards : [];
}

export type Stake = { delegate: Address; votes: bigint };
export async function stakesOf(ids: bigint[], start: number, rd: Read = read): Promise<Map<bigint, Stake>> {
  const found = await readEach(
    ids,
    {
      delegate: (id) => escrow("delegates", id, start),
      votes: (id) => escrow("balanceOfNFTAt", id, BigInt(start)),
    },
    rd,
  );
  return new Map(
    found.flatMap(({ item: id, delegate, votes }) => (delegate && votes ? [[id, { delegate, votes }]] : [])),
  );
}
export const holdersOf = (stakes: Iterable<Stake>): Address[] => [
  ...new Set([...stakes].flatMap(({ delegate }) => (automationAt(delegate) ? [] : [getAddress(delegate)]))),
];

export type Value = ReturnType<typeof valueOf>;
// A token without a price counts for nothing.
export function valueOf({ rewards, prices: own }: Earnings, prices = own) {
  const counted = { fees: 0, incentives: 0 };
  const byPool = new Map<string, number>();
  for (const { pool, token, amount, fee } of rewards) {
    const price = prices.of.get(key(token.address));
    if (price === undefined) continue;
    const value = worthOf(amount, token.decimals, price);
    byPool.set(key(pool), (byPool.get(key(pool)) ?? 0) + value);
    counted[fee ? "fees" : "incentives"] += value;
  }
  return { total: counted.fees + counted.incentives, ...counted, byPool, unit: prices.unit, rates: prices.rates };
}
// Per 1,000 votes, which have 18 decimals.
export const perThousand = (value: number, votes: bigint): number => (votes > 0n ? value / (Number(votes) / 1e21) : 0);
// What `votes` earned at the rate of these earnings' votes, by default at their own prices.
export const shareOf = (earnings: Earnings, votes: bigint, value: Value = valueOf(earnings)): Money =>
  moneyAt(earnings.votes > 0n ? (Number(votes) / Number(earnings.votes)) * value.total : 0, value);
export const perThousandOf = (earnings: Earnings, value?: Value): Money => shareOf(earnings, 10n ** 21n, value);
// The ratio of some votes' earnings per 1,000 votes to all of Hydrex's, both at `all`'s prices so they compare fairly.
export function versus(earnings: Earnings, all: Earnings): number | undefined {
  const ratio =
    perThousand(valueOf(earnings, all.prices).total, earnings.votes) / perThousand(valueOf(all).total, all.votes);
  return earnings.start === all.start && Number.isFinite(ratio) ? ratio : undefined;
}
