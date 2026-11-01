import { getAddress, parseAbi, type Address } from "viem";
import { rewardsAbi } from "./abi.ts";
import { memo } from "./cache.ts";
import { AUTOMATIONS } from "./config.ts";
import { WEEK, clean, moneyAt, type Money } from "./format.ts";
import { escrow, voter } from "./hydrex.ts";
import { key, pricesAtFlip, worthOf, type Prices, type Read, type Token } from "./prices.ts";
import { blockTime, call, read, required, same } from "./rpc.ts";
import { tokensOf } from "./tokens.ts";

// What votes earned in an epoch that has ended, from Hydrex's reward contracts: each pool's gauge has one for the
// pool's fees and one for incentives, which keep each epoch's votes and rewards.

export type Pool = { address: Address; name: string; votes: bigint };
export type Reward = { pool: Address; contract: Address; token: Token; amount: bigint; fee: boolean };
// The epoch runs from start to start + WEEK; its prices are those at the flip that ended it.
export type Earnings = { start: number; votes: bigint; pools: Pool[]; rewards: Reward[]; prices: Prices };

const poolAbi = parseAbi([
  "function token0() view returns (address)",
  "function token1() view returns (address)",
  "function symbol() view returns (string)",
]);

// An epoch's rewards are final only once Hydrex's own epoch has moved on, as it does once someone calls its minter:
// so the last epoch to have ended is Hydrex's word.
export async function lastEpoch(): Promise<number> {
  const [, active] = required(await read([blockTime, voter("_epochTimestamp")])) as bigint[];
  return Number(active) - WEEK;
}

type Contract = { pool: Address; address: Address; fee: boolean };
async function contractsOf(pools: Address[], rd: Read): Promise<Contract[]> {
  const gauges = required(await rd(pools.map((pool) => voter("gauges", pool)))) as Address[];
  const bribes = required(
    await rd(gauges.flatMap((gauge) => [voter("internal_bribes", gauge), voter("external_bribes", gauge)])),
  ) as Address[];
  return pools.flatMap((pool, i) => [
    { pool, address: bribes[2 * i]!, fee: true },
    { pool, address: bribes[2 * i + 1]!, fee: false },
  ]);
}
// Every pool's reward contracts: thousands of reads, made once, for the average and whoever voted again since an epoch
// began. Hydrex only adds pools, so they hold every epoch up to the one under way when read.
async function allContracts(start: number): Promise<Contract[]> {
  const readAll = async () => {
    const [length, active] = required(await read([voter("length"), voter("_epochTimestamp")])) as bigint[];
    const pools = required(
      await read(Array.from({ length: Number(length) }, (_, i) => voter("pools", BigInt(i)))),
    ) as Address[];
    return { through: Number(active), contracts: await contractsOf(pools, read) };
  };
  const found = await memo("contracts", readAll);
  return start < found.through ? found.contracts : (await memo(`contracts ${start}`, readAll)).contracts;
}

// A voter's share of a reward contract's rewards for an epoch, rounded as the contract rounds it.
export const earnedBy = (perEpoch: bigint, supply: bigint, balance: bigint): bigint =>
  (((perEpoch * 10n ** 32n) / supply) * balance) / 10n ** 32n;

// What a voter's votes, or all votes, earned in the epoch from `start` in the contracts, and the votes for each pool.
async function rewardsOf(contracts: Contract[], start: number, holder: Address | undefined, rd: Read) {
  const width = holder ? 3 : 2;
  const totals = required(
    await rd(
      contracts.flatMap(({ address }) => [
        call(address, rewardsAbi, "totalSupplyAt", start),
        call(address, rewardsAbi, "rewardsListLength"),
        ...(holder ? [call(address, rewardsAbi, "balanceOfOwnerAt", holder, start)] : []),
      ]),
    ),
  ) as bigint[];
  const voted = contracts
    .map((contract, i) => {
      const [supply, length, balance = supply] = totals.slice(width * i, width * i + width) as bigint[];
      return { ...contract, supply: supply!, length: Number(length), balance: balance! };
    })
    .filter(({ supply, balance }) => supply > 0n && balance > 0n);
  const tokens = required(
    await rd(
      voted.flatMap(({ address, length }) =>
        Array.from({ length }, (_, i) => call(address, rewardsAbi, "rewardTokens", BigInt(i))),
      ),
    ),
  ) as Address[];
  let k = 0;
  const listed = voted.map((contract) => ({ ...contract, tokens: tokens.slice(k, (k += contract.length)) }));
  const data = required(
    await rd(
      listed.flatMap(({ address, tokens }) =>
        tokens.map((token) => call(address, rewardsAbi, "rewardData", token, start)),
      ),
    ),
  ) as bigint[][];
  k = 0;
  const found = listed.flatMap(({ pool, address: contract, fee, supply, balance, tokens }) =>
    tokens.flatMap((token) => {
      const perEpoch = data[k++]![1]!;
      const amount = holder ? earnedBy(perEpoch, supply, balance) : perEpoch;
      return amount > 0n ? [{ pool, contract, token, amount, fee }] : [];
    }),
  );
  const named = await tokensOf(
    found.map(({ token }) => token),
    rd,
  );
  const rewards = found.flatMap(({ token, ...reward }) =>
    named.has(key(token)) ? [{ ...reward, token: named.get(key(token))! }] : [],
  );
  // A vote for a pool counts in both of its contracts.
  return { rewards, votes: new Map(voted.map(({ pool, balance }) => [pool, balance])) };
}

async function priced(start: number, votes: bigint, pools: Pool[], rewards: Reward[], rd: Read): Promise<Earnings> {
  const amounts = new Map<string, bigint>();
  for (const { token, amount } of rewards) amounts.set(token.address, (amounts.get(token.address) ?? 0n) + amount);
  const tokens = [...new Map(rewards.map(({ token }) => [token.address, token])).values()];
  return { start, votes, pools, rewards, prices: await pricesAtFlip(tokens, amounts, start + WEEK, rd) };
}

// What a voter's votes earned in the epoch from `start`: an automation's, its pools named, or an owner's. Its rewards
// go to the votes standing when the epoch starts. A voter that has not voted since the epoch before began, or had no
// votes, earned nothing. Hydrex's Voter keeps only a voter's latest pools: until it votes again, as the automations do
// just before each flip, after which they are found among every pool's.
export async function votesEarned(holder: Address, start: number, named: boolean, rd: Read = read): Promise<Earnings> {
  const [voted, length, votes] = required(
    await rd([voter("lastVoted", holder), voter("poolVoteLength", holder), escrow("getPastVotes", holder, start)]),
  ) as bigint[];
  if (!votes || Number(voted) < start - WEEK)
    return {
      start,
      votes: votes!,
      pools: [],
      rewards: [],
      prices: { unit: "USD", of: new Map(), standIns: new Map() },
    };
  const contracts =
    Number(voted) >= start + WEEK
      ? await allContracts(start)
      : await contractsOf(
          required(
            await rd(Array.from({ length: Number(length) }, (_, i) => voter("poolVote", holder, BigInt(i)))),
          ) as Address[],
          rd,
        );
  const { rewards, votes: byPool } = await rewardsOf(contracts, start, holder, rd);
  const used = [...byPool];
  const parts = named
    ? await rd(used.flatMap(([pool]) => ["token0", "token1", "symbol"].map((name) => call(pool, poolAbi, name))))
    : [];
  const symbols = await tokensOf(parts.filter((part, i) => i % 3 < 2 && part) as Address[], rd);
  const symbol = (address: unknown) => symbols.get(key(address as string))?.symbol ?? "?";
  // A pool goes by its two tokens; a classic pair by its own symbol; a vault by both.
  const pools = used.map(([address, poolVotes], i): Pool => {
    if (!named) return { address, name: "", votes: poolVotes };
    const [token0, token1, own] = parts.slice(3 * i, 3 * i + 3);
    const kind = clean(own as string | undefined);
    const pair = token0 && token1 ? `${symbol(token0)} / ${symbol(token1)}` : "";
    return {
      address,
      name: /^[sv]AMM-/.test(kind) ? kind : pair && kind ? `${pair} (${kind})` : pair || kind || address,
      votes: poolVotes,
    };
  });
  pools.sort((a, b) => (a.votes === b.votes ? 0 : a.votes > b.votes ? -1 : 1));
  return priced(start, votes!, pools, rewards, rd);
}

// What all votes on Hydrex earned in the epoch, for the average.
export async function allEarnings(start: number, rd: Read = read): Promise<Earnings> {
  const [[votes], found] = await Promise.all([
    rd([voter("totalWeightAt", start)]).then(required) as Promise<bigint[]>,
    allContracts(start).then((all) => rewardsOf(all, start, undefined, rd)),
  ]);
  const pools = [...found.votes].map(([address, poolVotes]) => ({ address, name: "", votes: poolVotes }));
  return priced(start, votes!, pools, found.rewards, rd);
}

// What an automation's votes earned in the epoch, reward by reward, unpriced, for the payouts.
export async function rewardsFor(automation: Address, start: number, rd: Read = read): Promise<Reward[]> {
  const [votes] = required(await rd([escrow("getPastVotes", automation, start)]));
  return votes ? (await rewardsOf(await allContracts(start), start, automation, rd)).rewards : [];
}

// Who held each account's votes when the epoch from `start` began, and how many.
export type Stake = { delegate: Address; votes: bigint };
export async function stakesOf(ids: bigint[], start: number, rd: Read = read): Promise<Map<bigint, Stake>> {
  const found = await rd(ids.flatMap((id) => [escrow("delegates", id, start), escrow("balanceOfNFTAt", id, start)]));
  return new Map(
    ids.flatMap((id, i) => {
      const [delegate, votes] = found.slice(2 * i, 2 * i + 2) as [Address?, bigint?];
      return delegate && votes ? [[id, { delegate, votes }]] : [];
    }),
  );
}
// Whoever held the accounts' votes, other than the page's automations: mostly their owner. Each once.
export const holdersOf = (stakes: Iterable<Stake>): Address[] => [
  ...new Set(
    [...stakes].flatMap(({ delegate }) =>
      AUTOMATIONS.some(({ address }) => same(address, delegate)) ? [] : [getAddress(delegate)],
    ),
  ),
];

// What was earned, in all and by pool, at the prices given, or the earnings' own. A token without a price counts for
// nothing.
export function valueOf({ rewards, prices: own }: Earnings, prices = own) {
  let [fees, incentives] = [0, 0];
  const byPool = new Map<string, number>();
  for (const { pool, token, amount, fee } of rewards) {
    const price = prices.of.get(key(token.address));
    if (price === undefined) continue;
    const value = worthOf(amount, token.decimals, price);
    byPool.set(key(pool), (byPool.get(key(pool)) ?? 0) + value);
    if (fee) fees += value;
    else incentives += value;
  }
  return { total: fees + incentives, fees, incentives, byPool, unit: prices.unit, rates: prices.rates };
}
// Per 1,000 votes, which have 18 decimals.
export const perThousand = (value: number, votes: bigint): number => (votes > 0n ? value / (Number(votes) / 1e21) : 0);
export const perThousandOf = (earnings: Earnings): Money => {
  const value = valueOf(earnings);
  return moneyAt(perThousand(value.total, earnings.votes), value);
};
// Some votes' earnings per 1,000 votes against all of Hydrex's, at the same prices so that they compare fairly.
export function versus(earnings: Earnings, all: Earnings): number | undefined {
  const ratio =
    perThousand(valueOf(earnings, all.prices).total, earnings.votes) / perThousand(valueOf(all).total, all.votes);
  return earnings.start === all.start && Number.isFinite(ratio) ? ratio : undefined;
}
