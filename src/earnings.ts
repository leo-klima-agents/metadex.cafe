import { getAddress, type Address } from "viem";
import { ABI, AUTOMATIONS, type Automation, type Kind, type Token } from "./config.ts";
import { WEEK, weekStart, type Money } from "./format.ts";
import { escrow, voter, type Account, type Holdings } from "./hydrex.ts";
import { pricesNow, worthOf, type Prices } from "./prices.ts";
import { blockTime, call, now, readFor, required, type Read } from "./rpc.ts";
import { RETRY, reader, update, type Reader } from "./state.ts";
import { tokensOf } from "./tokens.ts";
import { memo, same } from "./util.ts";

// What votes earned in an ended epoch, from each pool's two reward contracts: its fees', and its incentives'. They keep
// each epoch's votes and rewards, so the figures are final. All are valued at prices now.
export type Reward = { pool: Address; contract: Address; token: Token; amount: bigint; fee: boolean };
// `voted`: whether it voted for the epoch; `start` begins it, `start + WEEK` ends it.
export type Earnings = { start: number; votes: bigint; voted: boolean; rewards: Reward[]; prices: Prices };

// Rewards may still come until someone calls Hydrex's minter after the flip, so the last epoch is Hydrex's own word.
export async function lastEpoch(): Promise<number> {
  const [, active] = required(await readFor("earnings")([blockTime, voter("_epochTimestamp")])) as bigint[];
  return Number(active) - WEEK;
}

type Contract = { pool: Address; address: Address; fee: boolean };
const scan = readFor("earnings", "shares", "payouts");
async function contractsOf(pools: Address[], reader: Read): Promise<Contract[]> {
  const gauges = required(await reader(pools.map((pool) => voter("gauges", pool)))) as Address[];
  const bribes = required(
    await reader(gauges.flatMap((gauge) => [voter("internal_bribes", gauge), voter("external_bribes", gauge)])),
  ) as Address[];
  return pools.flatMap((pool, i) => [
    { pool, address: bribes[2 * i]!, fee: true },
    { pool, address: bribes[2 * i + 1]!, fee: false },
  ]);
}

// Every pool's reward contracts: thousands of reads, made once, holding every epoch before `through`.
let everyPool: Promise<{ through: number; contracts: Contract[] }> | undefined;
async function allContracts(start: number): Promise<Contract[]> {
  const read = async () => {
    const [length, through] = required(await scan([voter("length"), voter("_epochTimestamp")])) as bigint[];
    const pools = required(await scan(Array.from({ length: Number(length) }, (_, i) => voter("pools", BigInt(i)))));
    return { through: Number(through), contracts: await contractsOf(pools as Address[], scan) };
  };
  everyPool ??= read();
  everyPool.catch(() => (everyPool = undefined));
  const found = await everyPool;
  if (start < found.through) return found.contracts;
  everyPool = read();
  return (await everyPool).contracts;
}

// A voter's share of a contract's epoch rewards, rounded as the contract rounds it.
export const earnedBy = (perEpoch: bigint, supply: bigint, balance: bigint): bigint =>
  (((perEpoch * 10n ** 32n) / supply) * balance) / 10n ** 32n;

// What `holder`'s votes earned in the epoch from `start` in these contracts, in tokens that have decimals.
async function rewardsOf(contracts: Contract[], start: number, holder: Address, reader: Read) {
  const totals = required(
    await reader(
      contracts.flatMap(({ address }) => [
        call(address, ABI.rewards, "totalSupplyAt", start),
        call(address, ABI.rewards, "rewardsListLength"),
        call(address, ABI.rewards, "balanceOfOwnerAt", holder, start),
      ]),
    ),
  ) as bigint[];
  const voted = contracts
    .map((contract, i) => {
      const [supply, length, balance] = totals.slice(3 * i, 3 * i + 3) as [bigint, bigint, bigint];
      return { ...contract, supply, length: Number(length), balance };
    })
    .filter(({ supply, balance }) => supply > 0n && balance > 0n);
  const listed = required(
    await reader(
      voted.flatMap(({ address, length }) =>
        Array.from({ length }, (_, i) => call(address, ABI.rewards, "rewardTokens", BigInt(i))),
      ),
    ),
  ) as Address[];
  let k = 0;
  const pairs = voted.flatMap((contract) =>
    listed.slice(k, (k += contract.length)).map((token) => ({ contract, token })),
  );
  const data = required(
    await reader(pairs.map(({ contract, token }) => call(contract.address, ABI.rewards, "rewardData", token, start))),
  ) as (readonly bigint[])[];
  const tokens = await tokensOf(
    pairs.map(({ token }) => token),
    reader,
  );
  const rewards = pairs.flatMap(({ contract: { pool, address, fee, supply, balance }, token }, i): Reward[] => {
    const amount = earnedBy(data[i]![1]!, supply, balance);
    const known = tokens.get(token.toLowerCase());
    return amount > 0n && known ? [{ pool, contract: address, token: known, amount, fee }] : [];
  });
  return { rewards, voted: voted.length > 0 };
}

// A voter's earnings in the epoch from `start`. Rewards go to the votes standing as it starts, cast in the epoch before;
// one that cast none since then earned nothing. The Voter holds only each voter's latest pools, until it votes again,
// as the automations do just before each flip: from then on, its rewards are found among every pool's.
async function votesEarned(holder: Address, start: number, reader: Read): Promise<Earnings> {
  const [voted, length, votes] = required(
    await reader([voter("lastVoted", holder), voter("poolVoteLength", holder), escrow("getPastVotes", holder, start)]),
  ) as bigint[];
  if (!votes || Number(voted) < start - WEEK)
    return { start, votes: votes!, voted: false, rewards: [], prices: { unit: "USD", of: new Map() } };
  const contracts =
    Number(voted) >= start + WEEK
      ? await allContracts(start)
      : await contractsOf(
          required(
            await reader(Array.from({ length: Number(length) }, (_, i) => voter("poolVote", holder, BigInt(i)))),
          ) as Address[],
          reader,
        );
  const { rewards, voted: inPools } = await rewardsOf(contracts, start, holder, reader);
  const amounts = new Map<string, bigint>();
  for (const { token, amount } of rewards)
    amounts.set(token.address.toLowerCase(), (amounts.get(token.address.toLowerCase()) ?? 0n) + amount);
  const tokens = [...new Map(rewards.map(({ token }) => [token.address.toLowerCase(), token])).values()];
  return { start, votes: votes!, voted: inPools, rewards, prices: await pricesNow(tokens, amounts, reader) };
}

// An automation's rewards in an epoch, for the payouts; each ended epoch's never change.
export const rewardsFor = memo(
  async ([automation, start]: [Address, number]): Promise<Reward[]> => {
    const payouts = readFor("payouts");
    const [votes] = required(await payouts([escrow("getPastVotes", automation, start)]));
    return votes === 0n ? [] : (await rewardsOf(await allContracts(start), start, automation, payouts)).rewards;
  },
  Infinity,
  ([automation, start]) => `${automation.toLowerCase()} ${start}`,
);

export const valueOf = ({ rewards, prices }: Earnings): Money => {
  let value = 0;
  for (const { token, amount } of rewards) {
    const price = prices.of.get(token.address.toLowerCase());
    if (price !== undefined) value += worthOf(amount, token.decimals, price);
  }
  return { value, unit: prices.unit };
};
const perThousand = (earnings: Earnings, value = valueOf(earnings).value): Money => ({
  value: earnings.votes > 0n ? value / (Number(earnings.votes) / 1e21) : 0,
  unit: earnings.prices.unit,
});

// The epoch shown: read again once one has ended, every five minutes until Hydrex moves on.
const stale = (start: number, since: number) => start < weekStart(now()) - WEEK && since > RETRY;
export const epoch: Reader<number> = reader(lastEpoch, { stale });
async function epochStart(): Promise<number | undefined> {
  if (epoch.reading || epoch.value === undefined || epoch.due()) await epoch.read().catch(() => {});
  return epoch.value;
}
const noEpoch = () => epoch.value === undefined && epoch.failed;

// Each automation's figures, kept when a read for a new epoch fails.
const figures = new Map<Kind, Reader<Earnings>>(
  AUTOMATIONS.map(({ kind, address }) => [
    kind,
    reader(
      async (before) => {
        const start = await epochStart();
        if (start === undefined) throw new Error("Hydrex's last epoch could not be read.");
        return before?.start === start ? before : votesEarned(address, start, readFor("earnings"));
      },
      { stale: ({ start }, since) => stale(start, since) },
    ),
  ]),
);
export const figuresOf = ({ kind }: Automation): Reader<Earnings> => figures.get(kind)!;
export const earningsDue = (): boolean => AUTOMATIONS.some((each) => figuresOf(each).due());
export const loadEarnings = (): Promise<unknown> =>
  Promise.all(
    AUTOMATIONS.map((each) =>
      figuresOf(each)
        .read()
        .catch(() => {}),
    ),
  );
// What an automation's votes earned per 1,000 votes: undefined until read, null with no votes then.
export function perThousandOf(automation: Automation): Money | null | undefined {
  const found = figuresOf(automation).value;
  return found && (found.votes ? perThousand(found) : null);
}
// An automation's figures for the epoch from `start` or later, read first if need be.
export async function lastEarnings(automation: Automation, start = 0): Promise<Earnings> {
  if ((epoch.value ?? -1) < start) await epoch.read().catch(() => {});
  if ((figuresOf(automation).value?.start ?? -1) < start)
    await figuresOf(automation)
      .read()
      .catch(() => {});
  const found = figuresOf(automation).value;
  if (!found) throw new Error(`What ${automation.name}'s votes earned last epoch could not be read.`);
  return found;
}

// Who held each account's votes as the epoch began, and how many: an account earns through whoever did. Read once an
// epoch; those whose read failed, again five minutes later. Then what each holder outside the page's automations earned.
type Stake = { delegate: Address; votes: bigint };
let stakes:
  { start: number; of: Map<bigint, Stake | undefined>; asking: Set<bigint>; failed: Map<bigint, number> } | undefined;
const voters = new Map<string, Reader<Earnings>>();

export async function loadShares({ accounts }: Holdings): Promise<void> {
  const start = await epochStart();
  if (start === undefined) return;
  if (stakes?.start !== start) {
    stakes = { start, of: new Map(), asking: new Set(), failed: new Map() };
    voters.clear();
  }
  const known = stakes;
  const time = Date.now();
  const missing = accounts
    .map(({ id, amount }) => (amount > 0n ? id : -1n))
    .filter(
      (id) =>
        id >= 0n && !known.of.has(id) && !known.asking.has(id) && time - (known.failed.get(id) ?? -Infinity) >= RETRY,
    );
  if (missing.length) {
    for (const id of missing) known.asking.add(id);
    const found = await readFor("shares")(
      missing.flatMap((id) => [escrow("delegates", id, start), escrow("balanceOfNFTAt", id, start)]),
    ).catch((error: unknown) => void console.error(error));
    for (const [i, id] of missing.entries()) {
      known.asking.delete(id);
      if (!found) {
        known.failed.set(id, time);
        continue;
      }
      known.failed.delete(id);
      const [delegate, votes] = found.slice(2 * i, 2 * i + 2) as [Address | undefined, bigint | undefined];
      known.of.set(id, delegate && votes ? { delegate, votes } : undefined);
    }
    update();
  }
  const holders = new Set(
    [...known.of.values()].flatMap((stake) =>
      stake && !AUTOMATIONS.some(({ address }) => same(address, stake.delegate)) ? [getAddress(stake.delegate)] : [],
    ),
  );
  await Promise.all(
    [...holders].map((holder) => {
      const name = holder.toLowerCase();
      if (!voters.has(name))
        voters.set(
          name,
          reader(() => votesEarned(holder, start, readFor("shares"))),
        );
      const these = voters.get(name)!;
      return these.value || these.reading || !these.due() ? undefined : these.read().catch(() => {});
    }),
  );
}

const voterOf = (holder: Address) => (stakes?.start === epoch.value ? voters.get(holder.toLowerCase()) : undefined);

// What an account's votes earned: its part of whoever held them. Undefined until read; null for none, or a failure.
export function earnedByAccount({ id, amount }: Account): Money | null | undefined {
  if (amount === 0n || noEpoch()) return null;
  if (!stakes || stakes.start !== epoch.value) return undefined;
  if (!stakes.of.has(id)) return stakes.failed.has(id) ? null : undefined;
  const stake = stakes.of.get(id);
  if (!stake) return null;
  const automation = AUTOMATIONS.find(({ address }) => same(address, stake.delegate));
  const holder = automation ? figuresOf(automation) : voterOf(stake.delegate);
  const found = holder?.value;
  if (!found) return holder?.failed ? null : undefined;
  if (automation && found.start < stakes.start && !holder.failed) return undefined;
  if (found.start !== stakes.start || !found.votes || !found.voted) return null;
  return { value: (Number(stake.votes) / Number(found.votes)) * valueOf(found).value, unit: found.prices.unit };
}

// What an owner's own votes earned per 1,000 votes: "none" if none of the accounts' votes were theirs, "unvoted" if they
// did not vote; undefined until read; null on failure.
export function ownPerThousand({ owner, accounts }: Holdings): Money | "none" | "unvoted" | null | undefined {
  if (noEpoch()) return null;
  if (!stakes || stakes.start !== epoch.value) return undefined;
  const ids = accounts.filter(({ amount }) => amount > 0n).map(({ id }) => id);
  const unread = ids.filter((id) => !stakes!.of.has(id));
  if (unread.length) return unread.some((id) => stakes!.failed.has(id)) ? null : undefined;
  if (!ids.some((id) => same(stakes!.of.get(id)?.delegate ?? "", owner))) return "none";
  const holder = voterOf(owner);
  const found = holder?.value;
  if (!found) return holder?.failed ? null : undefined;
  if (!found.votes) return "none";
  return found.voted ? perThousand(found) : "unvoted";
}
