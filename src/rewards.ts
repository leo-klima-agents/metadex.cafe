import { getAddress, parseAbi, type Address } from "viem";
import { rewardsAbi } from "./abi.ts";
import { memo } from "./cache.ts";
import { HYDREX_PRICING, HYDX } from "./config.ts";
import { WEEK, clean, moneyAt, type Money } from "./format.ts";
import { automationAt, escrow, voter } from "./hydrex.ts";
import { key, noPrices, pricesAt, pricesAtFlip, worthOf, type Prices, type Token } from "./prices.ts";
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
// thousands of reads, so they are read once, at the priority of the page that first asks. Hydrex only adds pools, so
// the list covers every epoch up to the one under way when it was read.
async function allContracts(start: number, rd: Read): Promise<Contract[]> {
  const readAll = async () => {
    const [length, active] = required(await rd([voter("length"), voter("_epochTimestamp")]));
    const pools = required(await rd(Array.from({ length: Number(length) }, (_, i) => voter("pools", BigInt(i)))));
    return { through: Number(active), contracts: await contractsOf(pools, rd) };
  };
  const found = await memo("contracts", readAll);
  return start < found.through ? found.contracts : (await memo(`contracts ${start}`, readAll)).contracts;
}

// A voter's share of a reward contract's rewards for an epoch, rounded as the contract rounds it.
export const earnedBy = (perEpoch: bigint, supply: bigint, balance: bigint): bigint =>
  (((perEpoch * 10n ** 32n) / supply) * balance) / 10n ** 32n;

// What all votes earned in each of these contracts that had votes in the epoch from `start`, by reward token.
type Paid = Contract & { supply: bigint; paid: { token: Address; amount: bigint }[] };
async function paidIn(contracts: Contract[], start: number, rd: Read): Promise<Paid[]> {
  const at = BigInt(start);
  const totals = await readEach(
    contracts,
    {
      supply: ({ address }) => call(address, rewardsAbi, "totalSupplyAt", at),
      length: ({ address }) => call(address, rewardsAbi, "rewardsListLength"),
    },
    rd,
  );
  const voted = totals
    .map(({ item, supply, length }) => {
      const [total, count] = required([supply, length]);
      return { ...item, supply: total, length: Number(count) };
    })
    .filter(({ supply }) => supply > 0n);
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
  const byContract = Map.groupBy(perEpoch, ({ item }) => item.contract);
  return voted.map((contract) => ({
    pool: contract.pool,
    address: contract.address,
    fee: contract.fee,
    supply: contract.supply,
    paid: (byContract.get(contract) ?? []).map(({ item: { token }, data }) => ({
      token,
      amount: required([data])[0][1],
    })),
  }));
}
// Read once an epoch: every voter takes its share of these, and the epoch's prices need them all.
const allPaid = (start: number, rd: Read) =>
  memo(`paid ${start}`, async () => paidIn(await allContracts(start, rd), start, rd));

// What `holder`'s votes, or all votes when `holder` is undefined, earned in the epoch from `start`, with the votes for
// each pool: in `contracts`, or in every pool's. Contracts not among every pool's are read apart.
async function rewardsOf(start: number, holder: Address | undefined, rd: Read, contracts?: Contract[]) {
  const at = BigInt(start);
  const every = await allContracts(start, rd);
  const own = contracts ?? every;
  const listed = new Set(every.map(({ address }) => key(address)));
  const apart = own.filter(({ address }) => !listed.has(key(address)));
  const wanted = new Set(own.map(({ address }) => key(address)));
  const [all, extra, balances] = await Promise.all([
    allPaid(start, rd),
    apart.length ? paidIn(apart, start, rd) : [],
    holder &&
      readEach(own, { balance: ({ address }) => call(address, rewardsAbi, "balanceOfOwnerAt", holder, at) }, rd),
  ]);
  const paid = [...all.filter(({ address }) => wanted.has(key(address))), ...extra];
  const balanceOf = new Map(balances?.map(({ item, balance }) => [item.address, required([balance])[0]]));
  const voted = paid.flatMap((contract) => {
    const balance = holder ? (balanceOf.get(contract.address) ?? 0n) : contract.supply;
    return balance > 0n ? [{ ...contract, balance }] : [];
  });
  const found = voted.flatMap((contract) =>
    contract.paid.flatMap(({ token, amount: all }) => {
      const amount = holder ? earnedBy(all, contract.supply, contract.balance) : all;
      return amount > 0n ? [{ pool: contract.pool, contract: contract.address, token, amount, fee: contract.fee }] : [];
    }),
  );
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

const allRewards = (start: number, rd: Read) => memo(`all rewards ${start}`, () => rewardsOf(start, undefined, rd));
// The epoch's prices, which every voter's earnings in it share, deep enough for all of each token the epoch paid.
const epochPrices = (start: number, rd: Read): Promise<Prices> =>
  memo(`epoch prices ${start}`, async () => {
    const { rewards } = await allRewards(start, rd);
    const amounts = new Map<string, bigint>();
    for (const { token, amount } of rewards)
      amounts.set(key(token.address), (amounts.get(key(token.address)) ?? 0n) + amount);
    const tokens = tokensIn(rewards);
    if (tokens.some(({ address }) => key(address) === key(HYDX)))
      return pricesAtFlip(tokens, amounts, start + WEEK, rd);
    // HYDX too, which APRs need; but if a pool could not be read, the rewards are priced again without it, so that
    // HYDX alone fails only the APRs.
    const hydx: Token = { address: HYDX, decimals: 18, symbol: "HYDX" };
    const all = await pricesAt([...tokens, hydx], amounts, start + WEEK, rd, HYDREX_PRICING);
    return all.unread ? pricesAtFlip(tokens, amounts, start + WEEK, rd) : all;
  });
const priced = async (start: number, votes: bigint, pools: Pool[], rewards: Reward[], rd: Read): Promise<Earnings> => ({
  start,
  votes,
  pools,
  rewards,
  prices: await epochPrices(start, rd),
});

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
      ? undefined
      : await contractsOf(
          required(await rd(Array.from({ length: Number(length) }, (_, i) => voter("poolVote", holder, BigInt(i))))),
          rd,
        );
  const { rewards, votes: byPool } = await rewardsOf(start, holder, rd, contracts);
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
    allRewards(start, rd),
  ]);
  const pools = [...found.votes].map(([address, poolVotes]) => ({ address, name: "", votes: poolVotes }));
  return priced(start, votes, pools, found.rewards, rd);
}

export async function rewardsFor(automation: Address, start: number, rd: Read = read): Promise<Reward[]> {
  const [votes] = required(await rd([escrow("getPastVotes", automation, BigInt(start))]));
  return votes ? (await rewardsOf(start, automation, rd)).rewards : [];
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
// What `votes` earned at the rate of these earnings' votes, by default at their own prices.
export const shareOf = (earnings: Earnings, votes: bigint, value: Value = valueOf(earnings)): Money =>
  moneyAt(earnings.votes > 0n ? (Number(votes) / Number(earnings.votes)) * value.total : 0, value);
// A year of what the votes earned in an epoch, over what they stand for: a vote of a permanent lock is one HYDX, at the
// same prices. Undefined without votes or a price for HYDX.
export function aprOf(earnings: Earnings, prices = earnings.prices): number | undefined {
  const hydx = prices.of.get(key(HYDX));
  const votes = Number(earnings.votes) / 1e18;
  return hydx && votes > 0 ? ((valueOf(earnings, prices).total / votes) * (365 / 7)) / hydx : undefined;
}
