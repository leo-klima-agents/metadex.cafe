import { getAddress, parseAbi, type Address } from "viem";
import { blockTime, call, read, readFor, required, same, sharedRead, type Topic } from "./chain.ts";
import { AUTOMATIONS } from "./config.ts";
import { WEEK, clean } from "./format.ts";
import { escrow, voter } from "./hydrex.ts";
import { pricesAtFlip, pricesIn, worthOf, type Prices, type Token } from "./prices.ts";

// What votes earned in an epoch that has ended, from Hydrex's reward contracts. Each pool's gauge has two: one for the
// pool's fees and one for incentives. They keep each epoch's votes and rewards, so an ended epoch's figures are final.

export type Pool = { address: Address; name: string; votes: bigint };
// A pool's reward in one token, and the contract that pays it: the pool's fees contract, or its incentives contract.
export type Reward = { pool: Address; contract: Address; token: Token; amount: bigint; fee: boolean };
export type Earnings = {
  // The epoch runs from start to start + WEEK.
  start: number;
  votes: bigint;
  pools: Pool[];
  rewards: Reward[];
  // At the flip that ended it.
  prices: Prices;
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
// rewards can still be added to the epoch that just ended. So the last epoch to have ended is Hydrex's own word.
export async function lastEpoch(): Promise<{ start: number; now: number }> {
  const [now, active] = required(await read([blockTime, voter("_epochTimestamp")])) as bigint[];
  return { start: Number(active) - WEEK, now: Number(now) };
}

// A pool's reward contracts: its fees contract and its incentives contract.
type Contract = { pool: Address; address: Address; fee: boolean };

// Every pool's reward contracts, for Hydrex's average and for whoever voted again since an epoch began: thousands of
// reads, made once, and shared, at the priority of the reads that wait on them. As Hydrex only ever adds pools, they
// hold every epoch Hydrex had ended when they were read, `through` the one then under way: they are read again only
// for a later epoch.
type Contracts = { through: number; contracts: Contract[] };
let kept: { read: Promise<Contracts>; join(topic: Topic): void } | undefined;

async function allContracts(start: number, topic: Topic): Promise<Contract[]> {
  kept ??= keep();
  const these = kept;
  these.join(topic);
  const found = await these.read;
  if (start < found.through) return found.contracts;
  if (kept === these) kept = keep();
  kept.join(topic);
  return (await kept.read).contracts;
}

function keep(): NonNullable<typeof kept> {
  const shared = sharedRead();
  const these = { read: readContracts(shared.read), join: shared.join };
  these.read.catch(() => {
    if (kept === these) kept = undefined;
  });
  return these;
}

async function readContracts(reader: typeof read): Promise<Contracts> {
  const [length, active] = required(await reader([voter("length"), voter("_epochTimestamp")])) as bigint[];
  const pools = required(
    await reader(Array.from({ length: Number(length) }, (_, i) => voter("pools", BigInt(i)))),
  ) as Address[];
  return { through: Number(active), contracts: await contractsOf(pools, reader) };
}

async function contractsOf(pools: Address[], reader: typeof read): Promise<Contract[]> {
  const gauges = required(await reader(pools.map((pool) => voter("gauges", pool)))) as Address[];
  const bribes = required(
    await reader(gauges.flatMap((gauge) => [voter("internal_bribes", gauge), voter("external_bribes", gauge)])),
  ) as Address[];
  return pools.flatMap((pool, i) => [
    { pool, address: bribes[2 * i]!, fee: true },
    { pool, address: bribes[2 * i + 1]!, fee: false },
  ]);
}

// A voter's share of a reward contract's rewards for an epoch, rounded as the contract rounds it.
export const earnedBy = (perEpoch: bigint, supply: bigint, balance: bigint): bigint =>
  (((perEpoch * 10n ** 32n) / supply) * balance) / 10n ** 32n;

type Found = {
  rewards: { pool: Address; contract: Address; token: Address; amount: bigint; fee: boolean }[];
  votes: Map<Address, bigint>;
};

// What one voter's votes, or all votes, earned in the epoch from `start` in some reward contracts, and the votes for each
// pool. Pools without its votes are left out.
async function rewardsOf(
  contracts: Contract[],
  start: number,
  holder: Address | undefined,
  reader: typeof read,
): Promise<Found> {
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
  const rewards = listed.flatMap(({ pool, address: contract, fee, supply, balance, tokens }) =>
    tokens.flatMap((token) => {
      const perEpoch = data[k++]![1]!;
      const amount = holder ? earnedBy(perEpoch, supply, balance) : perEpoch;
      return amount > 0n ? [{ pool, contract, token, amount, fee }] : [];
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

// The rewards in tokens whose decimals are known, with their tokens.
const withTokens = (rewards: Found["rewards"], tokens: Map<string, Token>): Reward[] =>
  rewards.flatMap(({ token, ...reward }) => {
    const known = tokens.get(token.toLowerCase());
    return known ? [{ ...reward, token: known }] : [];
  });

async function priced(
  start: number,
  now: number,
  votes: bigint,
  pools: Pool[],
  found: Found,
  tokens: Map<string, Token>,
  reader: typeof read = read,
): Promise<Earnings> {
  const rewards = withTokens(found.rewards, tokens);
  const amounts = new Map<string, bigint>();
  for (const { token, amount } of rewards) amounts.set(token.address, (amounts.get(token.address) ?? 0n) + amount);
  // Only the tokens earned: the pools' own tokens are read only to name the pools.
  const earned = [...tokens.values()].filter(({ address }) => amounts.has(address));
  const prices = await pricesAtFlip(earned, amounts, start + WEEK, now, reader);
  return { start, votes, pools, rewards, prices };
}

// What an automation's votes earned in the epoch from `start`, its pools named.
export const readEarnings = (automation: Address, start: number): Promise<Earnings> =>
  votesEarned(automation, start, "earnings", true);

// What one voter's votes earned in the epoch from `start`, such as an owner who votes with their accounts themselves;
// its pools go unnamed.
export const readVoterEarnings = (holder: Address, start: number): Promise<Earnings> =>
  votesEarned(holder, start, "shares", false);

// What a voter's votes earned in the epoch from `start`: an automation's, or an owner's. Its rewards go to the votes
// standing when it starts, which a vote in the epoch before may have cast. A voter that has not voted since the epoch
// before began, as an automation that stopped (hasStopped), or that had no votes when it started, earned nothing in it:
// no pools, and no rewards. Hydrex's Voter keeps only each voter's latest votes: its few pools, until it votes again,
// as the automations do just before each flip. From then on, its rewards are found among every pool's reward
// contracts. `named` names each pool by its tokens, as an automation's page lists them.
async function votesEarned(holder: Address, start: number, topic: Topic, named: boolean): Promise<Earnings> {
  const reader = readFor(topic);
  const [now, voted, length, votes] = required(
    await reader([
      blockTime,
      voter("lastVoted", holder),
      voter("poolVoteLength", holder),
      escrow("getPastVotes", holder, start),
    ]),
  ) as bigint[];
  if (!votes || Number(voted) < start - WEEK)
    return { start, votes: votes!, pools: [], rewards: [], prices: pricesIn("USD") };
  const contracts =
    Number(voted) >= start + WEEK
      ? await allContracts(start, topic)
      : await contractsOf(
          required(
            await reader(Array.from({ length: Number(length) }, (_, i) => voter("poolVote", holder, BigInt(i)))),
          ) as Address[],
          reader,
        );
  const found = await rewardsOf(contracts, start, holder, reader);
  const used = [...found.votes];
  const parts = named
    ? await reader(used.flatMap(([pool]) => ["token0", "token1", "symbol"].map((name) => call(pool, poolAbi, name))))
    : [];
  const pairs = used.map(
    (_, i) => parts.slice(3 * i, 3 * i + 3) as [Address | undefined, Address | undefined, string | undefined],
  );
  const tokens = await tokensOf(
    [
      ...found.rewards.map(({ token }) => token),
      ...pairs.flatMap(([token0, token1]) => (token0 && token1 ? [token0, token1] : [])),
    ],
    reader,
  );
  const symbol = (address: Address) => tokens.get(address.toLowerCase())?.symbol ?? "?";
  // A pool is named by its two tokens. A classic pair goes by its own symbol; a vault by both.
  const poolsOf = used.map(([address, poolVotes], i): Pool => {
    if (!named) return { address, name: "", votes: poolVotes };
    const [token0, token1, own = ""] = pairs[i]!;
    const kind = clean(own);
    const pair = token0 && token1 ? `${symbol(token0)} / ${symbol(token1)}` : "";
    const name = /^[sv]AMM-/.test(kind) ? kind : pair && kind ? `${pair} (${kind})` : pair || kind || address;
    return { address, name, votes: poolVotes };
  });
  poolsOf.sort((a, b) => (a.votes === b.votes ? 0 : a.votes > b.votes ? -1 : 1));
  return priced(start, Number(now), votes!, poolsOf, found, tokens, reader);
}

// What an automation's votes earned in the epoch from `start`, reward by reward, unpriced, for the payouts: unless it had
// no votes then. An ended epoch's never change, so each is read once.
const paidBy = new Map<string, Promise<Reward[]>>();

export function rewardsFor(automation: Address, start: number): Promise<Reward[]> {
  const key = `${automation.toLowerCase()} ${start}`;
  let found = paidBy.get(key);
  if (!found) {
    found = readFor("payouts")([escrow("getPastVotes", automation, start)]).then(async ([votes]) => {
      if (required([votes])[0] === 0n) return [];
      const { rewards } = await rewardsOf(await allContracts(start, "payouts"), start, automation, readFor("payouts"));
      const tokens = await tokensOf(
        rewards.map(({ token }) => token),
        readFor("payouts"),
      );
      return withTokens(rewards, tokens);
    });
    paidBy.set(key, found);
    found.catch(() => paidBy.delete(key));
  }
  return found;
}

// For tests: the rewards read are kept for the rest of the session, and the reward contracts for the epoch.
export function forgetRewards(): void {
  paidBy.clear();
  kept = undefined;
}

// What all votes on Hydrex earned in the same epoch, for the average. Thousands of reads.
export async function readAllEarnings(start: number): Promise<Earnings> {
  const [[now, votes], found] = await Promise.all([
    readFor("average")([blockTime, voter("totalWeightAt", start)]).then((values) => required(values) as bigint[]),
    allContracts(start, "average").then((all) => rewardsOf(all, start, undefined, readFor("average"))),
  ]);
  const voted = [...found.votes].map(([address, poolVotes]) => ({ address, name: "", votes: poolVotes }));
  const tokens = await tokensOf(
    found.rewards.map(({ token }) => token),
    readFor("average"),
  );
  return priced(start, Number(now), votes!, voted, found, tokens, readFor("average"));
}

// Who held each account's votes when the epoch from `start` began, and how many: an account counts for whoever held them.
export type Stake = { delegate: Address; votes: bigint };
export async function stakesOf(ids: bigint[], start: number): Promise<Map<bigint, Stake>> {
  const found = await readFor("shares")(
    ids.flatMap((id) => [escrow("delegates", id, start), escrow("balanceOfNFTAt", id, start)]),
  );
  return new Map(
    ids.flatMap((id, i) => {
      const [delegate, votes] = found.slice(2 * i, 2 * i + 2) as [Address | undefined, bigint | undefined];
      return delegate && votes ? [[id, { delegate, votes }]] : [];
    }),
  );
}

// Whose votes earned what the accounts' did, for those in none of the page's automations: whoever held their votes,
// mostly their owner. Each once.
export const holdersOf = (stakes: Iterable<Stake | undefined>): Address[] => [
  ...new Set(
    [...stakes].flatMap((stake) =>
      stake && !AUTOMATIONS.some(({ address }) => same(address, stake.delegate)) ? [getAddress(stake.delegate)] : [],
    ),
  ),
];

// What was earned, in all and by pool, in the prices' unit. A token without a price counts for nothing.
export function valueOf({ rewards, prices }: Earnings) {
  let [fees, incentives] = [0, 0];
  const byPool = new Map<string, number>();
  for (const { pool, token, amount, fee } of rewards) {
    const price = prices.of.get(token.address.toLowerCase());
    if (price === undefined) continue;
    const value = worthOf(amount, token.decimals, price);
    byPool.set(pool.toLowerCase(), (byPool.get(pool.toLowerCase()) ?? 0) + value);
    if (fee) fees += value;
    else incentives += value;
  }
  return { total: fees + incentives, fees, incentives, byPool, unit: prices.unit, rates: prices.rates };
}
