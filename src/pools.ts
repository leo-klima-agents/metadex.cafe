import { encodeAbiParameters, keccak256, zeroAddress, type Abi, type Address, type Hex } from "viem";
import { ABI, EXCHANGES, type Exchange } from "./config.ts";
import { call, read, type Call, type Read } from "./rpc.ts";
import { key, same } from "./util.ts";

export type Hop = { exchange: number; pool: Address; tokenOut: Address; fee: number; tickSpacing: number };
// `stable` is set for a pool of reserves: true on the stable curve.
export type Way = Hop & { tokenIn: Address; stable?: boolean };

// In the order of the swapper's enum, which a hop names.
export const BY_ID = [...EXCHANGES].sort((a, b) => a.id - b.id);
export const exchangeOf = (id: number): Exchange => BY_ID[id]!;
export const pairKey = (a: Address, b: Address): string => `${key(a)} ${key(b)}`;

// Uniswap v3's fee tiers; v4's standard pools without hooks as [fee, tick spacing], kept by its PoolManager at slot 6.
const V3_FEES = [100, 500, 3000, 10_000];
const V4_POOLS = [
  [100, 1],
  [500, 10],
  [3000, 60],
  [10_000, 200],
] as const;

function v4Slot(a: Address, b: Address, fee: number, tickSpacing: number): Hex {
  const [currency0, currency1] = key(a) < key(b) ? [a, b] : [b, a];
  const types = ["address", "address", "uint24", "int24", "address"].map((type) => ({ type }));
  const id = keccak256(encodeAbiParameters(types, [currency0, currency1, fee, tickSpacing, zeroAddress]));
  return keccak256(encodeAbiParameters([{ type: "bytes32" }, { type: "uint256" }], [id, 6n]));
}

type Lookup = { call: Call; way(reply: unknown): Way | undefined };

// An exchange's reads for the pools that could trade `a` for `b`: one per curve, fee tier or tick spacing.
export function lookupsOn(exchange: Exchange, a: Address, b: Address, spacings: Map<number, number[]>): Lookup[] {
  const { factory, kind, id } = exchange;
  const lookup = (abi: Abi, name: string, args: unknown[], fee = 0, tickSpacing = 0, stable?: boolean): Lookup => ({
    call: call(factory, abi, name, a, b, ...args),
    way: (pool) =>
      typeof pool !== "string" || same(pool, zeroAddress)
        ? undefined
        : {
            exchange: id,
            pool: pool as Address,
            tokenIn: a,
            tokenOut: b,
            fee,
            tickSpacing,
            ...(stable !== undefined && { stable }),
          },
  });
  switch (kind) {
    case "algebra":
      return [lookup(ABI.factory, "poolByPair", [])];
    case "pair":
      return [false, true].map((stable) => lookup(ABI.pairFactory, "getPair", [stable], 0, 0, stable));
    case "solidly":
      return [lookup(ABI.factory, "getPool", [], 0, 0, !!exchange.stable)];
    case "aerodrome":
      return [false, true].map((stable) => lookup(ABI.stableFactory, "getPool", [stable], 0, 0, stable));
    case "slipstream":
      return (spacings.get(id) ?? []).map((spacing) => lookup(ABI.slipstreamFactory, "getPool", [spacing], 0, spacing));
    case "v2":
      return [lookup(ABI.factory, "getPair", [])];
    case "v3":
      return V3_FEES.map((fee) => lookup(ABI.v3Factory, "getPool", [fee], fee));
    case "v4":
      // There once its price is set, and worth trying while it holds liquidity.
      return V4_POOLS.map(([fee, spacing]) => ({
        call: call(factory, ABI.factory, "extsload", v4Slot(a, b, fee, spacing), 4n),
        way: (reply) => {
          const [slot0, , , liquidity] = (reply as readonly Hex[] | undefined) ?? [];
          if (!slot0 || !liquidity || BigInt(slot0) === 0n || BigInt(liquidity) % 2n ** 128n === 0n) return undefined;
          return { exchange: id, pool: zeroAddress, tokenIn: a, tokenOut: b, fee, tickSpacing: spacing };
        },
      }));
  }
}

const SLIPSTREAMS = BY_ID.filter(({ kind }) => kind === "slipstream");
// Each Slipstream factory's tick spacings; if one fails, it is left out, and all are asked again next time.
let spacingsRead: Promise<Map<number, number[]>> | undefined;
function spacings(reader: Read): Promise<Map<number, number[]>> {
  const found = (spacingsRead ??= reader(
    SLIPSTREAMS.map(({ factory }) => call(factory, ABI.factory, "tickSpacings")),
  ).then((replies) => {
    if (replies.includes(undefined)) spacingsRead = undefined;
    return new Map(
      SLIPSTREAMS.flatMap(({ id }, i) => {
        const reply = replies[i] as readonly number[] | undefined;
        return reply ? [[id, reply.map(Number)] as const] : [];
      }),
    );
  }));
  found.catch(() => (spacingsRead = undefined));
  return found;
}

// Each exchange's pools of a pair, kept for the visit; a failed lookup is not kept: it is not the same as no pool.
const kept = new Map<string, Promise<Way[]>>();

// Each pair's pools on the exchanges given, in their order, by pairKey. Lookups not yet kept go in one read.
export async function waysFor(
  pairs: [Address, Address][],
  exchanges: Exchange[] = BY_ID,
  reader: Read = read,
): Promise<Map<string, Way[]>> {
  const at = (exchange: Exchange, [a, b]: [Address, Address]) => `${exchange.id} ${pairKey(a, b)}`;
  const unique = [...new Map(pairs.map((pair) => [pairKey(...pair), pair])).values()];
  const missing = unique.flatMap((pair) =>
    exchanges.filter((exchange) => !kept.has(at(exchange, pair))).map((exchange) => ({ exchange, pair })),
  );
  if (missing.length) {
    const all = (async () => {
      const known = missing.some(({ exchange }) => exchange.kind === "slipstream") ? await spacings(reader) : new Map();
      const each = missing.map(({ exchange, pair: [a, b] }) => lookupsOn(exchange, a, b, known));
      const replies = await reader(each.flat().map(({ call }) => call));
      let next = 0;
      return each.map((lookups, i) => {
        const answers = lookups.map(() => replies[next++]);
        const { exchange } = missing[i]!;
        const failed = answers.includes(undefined) || (exchange.kind === "slipstream" && !known.has(exchange.id));
        return { ways: lookups.flatMap((lookup, j) => lookup.way(answers[j]) ?? []), failed };
      });
    })();
    missing.forEach(({ exchange, pair }, i) => {
      const id = at(exchange, pair);
      const forget = () => kept.get(id) === ways && kept.delete(id);
      const ways = all.then((each) => {
        if (each[i]!.failed) forget();
        return each[i]!.ways;
      });
      kept.set(id, ways);
      ways.catch(forget);
    });
  }
  return new Map(
    await Promise.all(
      unique.map(async (pair) => {
        const each = await Promise.all(exchanges.map((exchange) => kept.get(at(exchange, pair))!));
        return [pairKey(...pair), each.flat()] as const;
      }),
    ),
  );
}
