import { encodeAbiParameters, keccak256, parseAbi, zeroAddress, type Abi, type Address, type Hex } from "viem";
import { call, read, same, type Call } from "./chain.ts";
import { EXCHANGES, type Exchange } from "./config.ts";

// Each exchange's pools of two tokens, from its factory, kept for the visit: the swap's routes and the prices share them.

export type Hop = { exchange: number; pool: Address; tokenOut: Address; fee: number; tickSpacing: number };
// A pool that trades one token for another. `stable` is set for a pool of reserves, true on the stable curve.
export type Way = Hop & { tokenIn: Address; stable?: boolean };

// The exchanges in the order of the swapper's enum, which a hop names.
export const BY_ID = [...EXCHANGES].sort((a, b) => a.id - b.id);
export const exchangeOf = (id: number): Exchange => BY_ID[id]!;

const algebraFactoryAbi = parseAbi(["function poolByPair(address tokenA, address tokenB) view returns (address)"]);
const pairFactoryAbi = parseAbi([
  "function getPair(address tokenA, address tokenB, bool stable) view returns (address)",
]);
const solidlyFactoryAbi = parseAbi(["function getPool(address tokenA, address tokenB) view returns (address)"]);
const aerodromeFactoryAbi = parseAbi([
  "function getPool(address tokenA, address tokenB, bool stable) view returns (address)",
]);
const slipstreamFactoryAbi = parseAbi([
  "function getPool(address tokenA, address tokenB, int24 tickSpacing) view returns (address)",
  "function tickSpacings() view returns (int24[])",
]);
const v2FactoryAbi = parseAbi(["function getPair(address tokenA, address tokenB) view returns (address)"]);
const v3FactoryAbi = parseAbi(["function getPool(address tokenA, address tokenB, uint24 fee) view returns (address)"]);
const poolManagerAbi = parseAbi(["function extsload(bytes32 startSlot, uint256 nSlots) view returns (bytes32[])"]);

// Uniswap v3's fee tiers, and v4's standard pools without hooks, as [fee, tick spacing].
const V3_FEES = [100, 500, 3000, 10_000];
const V4_POOLS: [number, number][] = [
  [100, 1],
  [500, 10],
  [3000, 60],
  [10_000, 200],
];
// Where Uniswap v4's PoolManager keeps its pools' state, by pool id.
const V4_POOLS_SLOT = 6n;

const key = (address: string): string => address.toLowerCase();
export const pairKey = (a: Address, b: Address): string => `${key(a)} ${key(b)}`;

// A read that finds a pool, and the pool its reply gives, if any.
type Lookup = { call: Call; way(reply: unknown): Way | undefined };

function wayOf(
  exchange: Exchange,
  a: Address,
  b: Address,
  pool: unknown,
  fee = 0,
  tickSpacing = 0,
  stable?: boolean,
): Way | undefined {
  if (typeof pool !== "string" || same(pool, zeroAddress)) return undefined;
  const way: Way = { exchange: exchange.id, pool: pool as Address, tokenIn: a, tokenOut: b, fee, tickSpacing };
  return stable === undefined ? way : { ...way, stable };
}

function v4Slot(a: Address, b: Address, fee: number, tickSpacing: number): Hex {
  const [currency0, currency1] = key(a) < key(b) ? [a, b] : [b, a];
  const id = keccak256(
    encodeAbiParameters(
      [{ type: "address" }, { type: "address" }, { type: "uint24" }, { type: "int24" }, { type: "address" }],
      [currency0, currency1, fee, tickSpacing, zeroAddress],
    ),
  );
  return keccak256(encodeAbiParameters([{ type: "bytes32" }, { type: "uint256" }], [id, V4_POOLS_SLOT]));
}

// An exchange's reads for the pools that could trade `a` for `b`: one per curve, fee tier or tick spacing.
export function lookupsOn(exchange: Exchange, a: Address, b: Address, spacings: Map<number, number[]>): Lookup[] {
  const { factory, kind } = exchange;
  const one = (abi: Abi, name: string, stable?: boolean): Lookup[] => [
    { call: call(factory, abi, name, a, b), way: (pool) => wayOf(exchange, a, b, pool, 0, 0, stable) },
  ];
  // A factory of both curves, which it takes as its third argument.
  const curves = (abi: Abi, name: string): Lookup[] =>
    [false, true].map((stable) => ({
      call: call(factory, abi, name, a, b, stable),
      way: (pool: unknown) => wayOf(exchange, a, b, pool, 0, 0, stable),
    }));
  switch (kind) {
    case "algebra":
      return one(algebraFactoryAbi, "poolByPair");
    case "pair":
      return curves(pairFactoryAbi, "getPair");
    case "solidly":
      return one(solidlyFactoryAbi, "getPool", !!exchange.stable);
    case "aerodrome":
      return curves(aerodromeFactoryAbi, "getPool");
    case "slipstream":
      return (spacings.get(exchange.id) ?? []).map((spacing) => ({
        call: call(factory, slipstreamFactoryAbi, "getPool", a, b, spacing),
        way: (pool: unknown) => wayOf(exchange, a, b, pool, 0, spacing),
      }));
    case "v2":
      return one(v2FactoryAbi, "getPair");
    case "v3":
      return V3_FEES.map((fee) => ({
        call: call(factory, v3FactoryAbi, "getPool", a, b, fee),
        way: (pool: unknown) => wayOf(exchange, a, b, pool, fee),
      }));
    case "v4":
      // A pool is there once its price is set, and worth trying while it holds liquidity.
      return V4_POOLS.map(([fee, spacing]) => ({
        call: call(factory, poolManagerAbi, "extsload", v4Slot(a, b, fee, spacing), 4n),
        way: (reply: unknown) => {
          const [slot0, , , liquidity] = (reply as readonly Hex[] | undefined) ?? [];
          if (!slot0 || !liquidity || BigInt(slot0) === 0n || BigInt(liquidity) % 2n ** 128n === 0n) return undefined;
          return { exchange: exchange.id, pool: zeroAddress, tokenIn: a, tokenOut: b, fee, tickSpacing: spacing };
        },
      }));
  }
}

// Every exchange's, in the swapper's order.
export const lookups = (a: Address, b: Address, spacings: Map<number, number[]>): Lookup[] =>
  BY_ID.flatMap((exchange) => lookupsOn(exchange, a, b, spacings));

// Each Slipstream factory's tick spacings, read once for each reader, as a reader of a past block may find others. A
// factory that does not answer is left out, and asked again the next time.
const spacingsRead = new WeakMap<typeof read, Promise<Map<number, number[]>>>();

function spacings(reader: typeof read): Promise<Map<number, number[]>> {
  const kept = spacingsRead.get(reader);
  if (kept) return kept;
  const slipstreams = BY_ID.filter(({ kind }) => kind === "slipstream");
  const found = reader(slipstreams.map(({ factory }) => call(factory, slipstreamFactoryAbi, "tickSpacings"))).then(
    (replies) => {
      if (replies.includes(undefined) && spacingsRead.get(reader) === found) spacingsRead.delete(reader);
      return new Map(
        slipstreams.flatMap(({ id }, i) => {
          const reply = replies[i] as readonly number[] | undefined;
          return reply ? [[id, reply.map(Number)] as const] : [];
        }),
      );
    },
  );
  spacingsRead.set(reader, found);
  found.catch(() => spacingsRead.get(reader) === found && spacingsRead.delete(reader));
  return found;
}

// The pools found, by reader, then by exchange and pair. A lookup that fails, or whose tick spacings are unknown, is
// not kept, so that it is asked again: it is not the same as finding no pool.
const kept = new WeakMap<typeof read, Map<string, Promise<Way[]>>>();

// Each pair's pools on the exchanges given, in their order, by pairKey. Lookups not yet kept go in one read.
export async function waysFor(
  pairs: [Address, Address][],
  exchanges: Exchange[] = BY_ID,
  reader: typeof read = read,
): Promise<Map<string, Way[]>> {
  const found = kept.get(reader) ?? new Map<string, Promise<Way[]>>();
  kept.set(reader, found);
  const at = (exchange: Exchange, [a, b]: [Address, Address]) => `${exchange.id} ${pairKey(a, b)}`;
  const unique = [...new Map(pairs.map((pair) => [pairKey(...pair), pair])).values()];
  const missing = unique.flatMap((pair) =>
    exchanges.filter((exchange) => !found.has(at(exchange, pair))).map((exchange) => ({ exchange, pair })),
  );
  if (missing.length) {
    const slipstream = missing.some(({ exchange }) => exchange.kind === "slipstream");
    const all = (slipstream ? spacings(reader) : Promise.resolve(new Map<number, number[]>())).then(async (known) => {
      const each = missing.map(({ exchange, pair: [a, b] }) => lookupsOn(exchange, a, b, known));
      const replies = await reader(each.flat().map(({ call }) => call));
      let next = 0;
      return each.map((list, i) => {
        const answers = list.map(() => replies[next++]);
        const { exchange } = missing[i]!;
        return {
          ways: list.flatMap((lookup, j) => lookup.way(answers[j]) ?? []),
          failed: answers.includes(undefined) || (exchange.kind === "slipstream" && !known.has(exchange.id)),
        };
      });
    });
    missing.forEach(({ exchange, pair }, i) => {
      const id = at(exchange, pair);
      const forget = () => found.get(id) === ways && found.delete(id);
      const ways: Promise<Way[]> = all.then((each) => {
        if (each[i]!.failed) forget();
        return each[i]!.ways;
      });
      found.set(id, ways);
      ways.catch(forget);
    });
  }
  return new Map(
    await Promise.all(
      unique.map(async (pair) => {
        const each = await Promise.all(exchanges.map((exchange) => found.get(at(exchange, pair))!));
        return [pairKey(...pair), each.flat()] as const;
      }),
    ),
  );
}
