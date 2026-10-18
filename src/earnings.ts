import { parseAbi, type Address } from "viem";
import { blockTime, call, read, readLater, required, same } from "./chain.ts";
import { CONDUIT } from "./config.ts";
import { WEEK, clean } from "./format.ts";
import { escrow, voter } from "./hydrex.ts";
import { pricesAt, usdOf, type Token } from "./prices.ts";

// What votes earned in an epoch that has ended, from Hydrex's reward contracts. Each pool's gauge has two: one for the
// pool's fees and one for incentives. They keep each epoch's votes and rewards, so an ended epoch's figures are final.

export type Pool = { address: Address; name: string; votes: bigint };
type Reward = { pool: Address; token: Token; amount: bigint; fee: boolean };
export type Earnings = {
  // The epoch runs from start to start + WEEK.
  start: number;
  votes: bigint;
  pools: Pool[];
  rewards: Reward[];
  // Dollars per whole token, by lower-case address.
  prices: Map<string, number>;
};

const rewardsAbi = parseAbi([
  "function totalSupplyAt(uint256 time) view returns (uint256)",
  "function balanceOfOwnerAt(address owner, uint256 time) view returns (uint256)",
  "function rewardsListLength() view returns (uint256)",
  "function rewardTokens(uint256 index) view returns (address)",
  "function rewardData(address token, uint256 time) view returns (uint256 periodFinish, uint256 rewardsPerEpoch, uint256 lastUpdateTime)",
]);
const poolAbi = parseAbi([
  "function token0() view returns (address)",
  "function token1() view returns (address)",
  "function symbol() view returns (string)",
]);
const tokenAbi = parseAbi(["function symbol() view returns (string)", "function decimals() view returns (uint8)"]);

// An epoch's rewards are final only once Hydrex's own epoch has moved on: until someone calls its minter after the flip,
// rewards can still be added to the epoch that just ended.
async function lastEpoch(): Promise<{ start: number; now: number }> {
  const [now, active] = required(await read([blockTime, voter("_epochTimestamp")])) as bigint[];
  return { start: Number(active) - WEEK, now: Number(now) };
}

async function allPools(reader: typeof read = read): Promise<Address[]> {
  const [length] = required(await reader([voter("length")])) as bigint[];
  return required(
    await reader(Array.from({ length: Number(length) }, (_, i) => voter("pools", BigInt(i)))),
  ) as Address[];
}

type Bribes = { pool: Address; fees: Address; incentives: Address };

async function bribesOf(pools: Address[], reader: typeof read = read): Promise<Bribes[]> {
  const gauges = required(await reader(pools.map((pool) => voter("gauges", pool)))) as Address[];
  const bribes = required(
    await reader(gauges.flatMap((gauge) => [voter("internal_bribes", gauge), voter("external_bribes", gauge)])),
  ) as Address[];
  return pools.map((pool, i) => ({ pool, fees: bribes[2 * i]!, incentives: bribes[2 * i + 1]! }));
}

// A voter's share of a reward contract's rewards for an epoch, rounded as the contract rounds it.
export const earnedBy = (perEpoch: bigint, supply: bigint, balance: bigint): bigint =>
  (((perEpoch * 10n ** 32n) / supply) * balance) / 10n ** 32n;

type Found = {
  rewards: { pool: Address; token: Address; amount: bigint; fee: boolean }[];
  votes: Map<Address, bigint>;
};

// What one voter's votes, or all votes, earned in the epoch from `start`, and the votes for each pool. Pools without
// its votes are left out.
async function rewardsOf(all: Bribes[], start: number, holder?: Address, reader: typeof read = read): Promise<Found> {
  const contracts = all.flatMap(({ pool, fees, incentives }) => [
    { pool, address: fees, fee: true },
    { pool, address: incentives, fee: false },
  ]);
  const totals = required(
    await reader(
      contracts.flatMap(({ address }) => [
        call(address, rewardsAbi, "totalSupplyAt", start),
        call(address, rewardsAbi, "rewardsListLength"),
        ...(holder ? [call(address, rewardsAbi, "balanceOfOwnerAt", holder, start)] : []),
      ]),
    ),
  ) as bigint[];
  const width = holder ? 3 : 2;
  const voted = contracts
    .map((contract, i) => {
      const [supply, length, balance = supply] = totals.slice(width * i, width * i + width) as bigint[];
      return { ...contract, supply: supply!, length: Number(length), balance: balance! };
    })
    .filter(({ supply, balance }) => supply > 0n && balance > 0n);
  const tokens = required(
    await reader(
      voted.flatMap(({ address, length }) =>
        Array.from({ length }, (_, i) => call(address, rewardsAbi, "rewardTokens", BigInt(i))),
      ),
    ),
  ) as Address[];
  let k = 0;
  const listed = voted.map((contract) => ({ ...contract, tokens: tokens.slice(k, (k += contract.length)) }));
  const data = required(
    await reader(
      listed.flatMap(({ address, tokens }) =>
        tokens.map((token) => call(address, rewardsAbi, "rewardData", token, start)),
      ),
    ),
  ) as (readonly bigint[])[];
  k = 0;
  const rewards = listed.flatMap(({ pool, fee, supply, balance, tokens }) =>
    tokens.flatMap((token) => {
      const perEpoch = data[k++]![1]!;
      const amount = holder ? earnedBy(perEpoch, supply, balance) : perEpoch;
      return amount > 0n ? [{ pool, token, amount, fee }] : [];
    }),
  );
  // A vote for a pool counts in both of its contracts.
  return { rewards, votes: new Map(voted.map(({ pool, balance }) => [pool, balance])) };
}

// Each token's symbol and decimals, by lower-case address. Tokens without decimals cannot be counted: they are left out.
export async function tokensOf(addresses: Address[], reader: typeof read = read): Promise<Map<string, Token>> {
  const unique = [...new Set(addresses.map((address) => address.toLowerCase()))] as Address[];
  const found = await reader(
    unique.flatMap((address) => [call(address, tokenAbi, "symbol"), call(address, tokenAbi, "decimals")]),
  );
  return new Map(
    unique.flatMap((address, i) => {
      const [symbol, decimals] = found.slice(2 * i, 2 * i + 2) as [string | undefined, number | undefined];
      return decimals === undefined ? [] : [[address, { address, decimals, symbol: clean(symbol) || "?" }]];
    }),
  );
}

async function priced(
  start: number,
  now: number,
  votes: bigint,
  pools: Pool[],
  found: Found,
  tokens: Map<string, Token>,
  reader: typeof read = read,
): Promise<Earnings> {
  const rewards = found.rewards.flatMap(({ pool, token, amount, fee }) => {
    const known = tokens.get(token.toLowerCase());
    return known ? [{ pool, token: known, amount, fee }] : [];
  });
  const amounts = new Map<string, bigint>();
  for (const { token, amount } of rewards) amounts.set(token.address, (amounts.get(token.address) ?? 0n) + amount);
  // Only the tokens earned: the pools' own tokens are read only to name the pools.
  const earned = [...tokens.values()].filter(({ address }) => amounts.has(address));
  const prices = await pricesAt(earned, amounts, start + WEEK, now, reader);
  return { start, votes, pools, rewards, prices };
}

// What Carbon Impact's votes earned in the last epoch that has ended, or undefined if that is still the epoch `known`.
// Hydrex's Voter keeps only each voter's latest votes. Between its vote just before an epoch ends and the flip, those
// are already the next epoch's, so the pools are then found from every pool's reward contracts instead.
export async function readEarnings(known?: number): Promise<Earnings | undefined> {
  const { start, now } = await lastEpoch();
  if (start === known) return undefined;
  const [voted, length, votes] = required(
    await read([voter("lastVoted", CONDUIT), voter("poolVoteLength", CONDUIT), escrow("getPastVotes", CONDUIT, start)]),
  ) as bigint[];
  const pools =
    Number(voted) >= start + WEEK
      ? await allPools()
      : (required(
          await read(Array.from({ length: Number(length) }, (_, i) => voter("poolVote", CONDUIT, BigInt(i)))),
        ) as Address[]);
  const found = await rewardsOf(await bribesOf(pools), start, CONDUIT);
  const used = [...found.votes];
  const parts = await read(
    used.flatMap(([pool]) => ["token0", "token1", "symbol"].map((name) => call(pool, poolAbi, name))),
  );
  const pairs = used.map(
    (_, i) => parts.slice(3 * i, 3 * i + 3) as [Address | undefined, Address | undefined, string | undefined],
  );
  const tokens = await tokensOf([
    ...found.rewards.map(({ token }) => token),
    ...pairs.flatMap(([token0, token1]) => (token0 && token1 ? [token0, token1] : [])),
  ]);
  const symbol = (address: Address) => tokens.get(address.toLowerCase())?.symbol ?? "?";
  // A pool is named by its two tokens. A classic pair goes by its own symbol; a vault by both.
  const named = used.map(([address, poolVotes], i): Pool => {
    const [token0, token1, own = ""] = pairs[i]!;
    const kind = clean(own);
    const pair = token0 && token1 ? `${symbol(token0)} / ${symbol(token1)}` : "";
    const name = /^[sv]AMM-/.test(kind) ? kind : pair && kind ? `${pair} (${kind})` : pair || kind || address;
    return { address, name, votes: poolVotes };
  });
  named.sort((a, b) => (a.votes === b.votes ? 0 : a.votes > b.votes ? -1 : 1));
  return priced(start, now, votes!, named, found, tokens);
}

// What all votes on Hydrex earned in the same epoch, for the average. Thousands of reads, after the page's own.
export async function readAllEarnings(start: number): Promise<Earnings> {
  const [[now, votes], pools] = await Promise.all([
    readLater([blockTime, voter("totalWeightAt", start)]).then((values) => required(values) as bigint[]),
    allPools(readLater),
  ]);
  const found = await rewardsOf(await bribesOf(pools, readLater), start, undefined, readLater);
  const voted = [...found.votes].map(([address, poolVotes]) => ({ address, name: "", votes: poolVotes }));
  const tokens = await tokensOf(
    found.rewards.map(({ token }) => token),
    readLater,
  );
  return priced(start, Number(now), votes!, voted, found, tokens, readLater);
}

// Each account's share of Carbon Impact's votes in the epoch from `start`: its votes then, if it was in Carbon Impact.
export async function sharesOf(ids: bigint[], start: number, votes: bigint): Promise<Map<bigint, number>> {
  const found = await read(ids.flatMap((id) => [escrow("delegates", id, start), escrow("balanceOfNFTAt", id, start)]));
  return new Map(
    ids.flatMap((id, i) => {
      const [delegate, power] = found.slice(2 * i, 2 * i + 2) as [Address | undefined, bigint | undefined];
      return delegate && power && votes > 0n && same(delegate, CONDUIT) ? [[id, Number(power) / Number(votes)]] : [];
    }),
  );
}

// Dollars earned, in all and by pool. A token without a price counts for nothing.
export function valueOf({ rewards, prices }: Earnings) {
  let [fees, incentives] = [0, 0];
  const byPool = new Map<string, number>();
  for (const { pool, token, amount, fee } of rewards) {
    const price = prices.get(token.address.toLowerCase());
    if (price === undefined) continue;
    const usd = usdOf(amount, token.decimals, price);
    byPool.set(pool.toLowerCase(), (byPool.get(pool.toLowerCase()) ?? 0) + usd);
    if (fee) fees += usd;
    else incentives += usd;
  }
  return { usd: fees + incentives, fees, incentives, byPool };
}
