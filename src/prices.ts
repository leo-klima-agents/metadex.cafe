import {
  concat,
  encodeAbiParameters,
  encodePacked,
  erc20Abi,
  getContractAddress,
  keccak256,
  parseAbi,
  zeroAddress,
  type Abi,
  type Address,
  type Hex,
} from "viem";
import { memo } from "./cache.ts";
import * as config from "./config.ts";
import type { Anchor, Exchange, ExchangeKind, Fiat, PricedKind } from "./config.ts";
import { figure, money, moneyAt, type Basis, type Money, type Rates } from "./format.ts";
import { blockClock, blockTime, call, firstBlockAt, read, same, settledBelow, type Call, type Read } from "./rpc.ts";

export type Token = { address: Address; decimals: number; symbol: string };
// Prices per whole token, keyed by lower-case address. `unread` if some pools could not be read, so some tokens may
// lack a price. `sources` holds the pool that priced each token, for pricing it again at another time.
export type Prices = Basis & { of: Map<string, number>; unread?: true; sources?: Map<string, Source> };
export function key(address: Address): Address;
export function key(address: string): string;
export function key(address: string): string {
  return address.toLowerCase();
}
export const noPrices = (): Prices => ({ unit: "USD", of: new Map() });
// How much of each token will be priced, keyed by lower-case address.
export type Amounts = Map<string, bigint> | Promise<Map<string, bigint>>;
export const worthOf = (amount: bigint, decimals: number, price: number): number =>
  (Number(amount) / 10 ** decimals) * price;

export type Hop = { exchange: number; pool: Address; tokenOut: Address; fee: number; tickSpacing: number };
// `stable` is set only for reserve pools, and is true for those on the stable curve.
export type Way = Hop & { tokenIn: Address; stable?: boolean };
export const BY_ID = [...config.EXCHANGES].sort((a, b) => a.id - b.id);
export const exchangeOf = (id: number): Exchange => BY_ID[id]!;
export const pairKey = (a: Address, b: Address): string => `${key(a)} ${key(b)}`;

const factoryAbis = {
  algebra: parseAbi([
    "function poolByPair(address, address) view returns (address)",
    "function poolDeployer() view returns (address)",
    "function POOL_INIT_CODE_HASH() view returns (bytes32)",
  ]),
  pair: parseAbi([
    "function getPair(address, address, bool stable) view returns (address)",
    "function pairCodeHash() view returns (bytes32)",
  ]),
  solidly: parseAbi([
    "function getPool(address, address) view returns (address)",
    "function implementation() view returns (address)",
  ]),
  aerodrome: parseAbi([
    "function getPool(address, address, bool stable) view returns (address)",
    "function implementation() view returns (address)",
  ]),
  slipstream: parseAbi([
    "function getPool(address, address, int24 tickSpacing) view returns (address)",
    "function tickSpacings() view returns (int24[])",
    "function poolImplementation() view returns (address)",
  ]),
  v2: parseAbi(["function getPair(address, address) view returns (address)"]),
  v3: parseAbi(["function getPool(address, address, uint24 fee) view returns (address)"]),
  v4: parseAbi(["function extsload(bytes32 startSlot, uint256 nSlots) view returns (bytes32[])"]),
} satisfies Record<ExchangeKind, Abi>;
// Uniswap v4's standard hookless pools, as [fee, tick spacing]. Uniswap v3 uses the same fee tiers.
const V4_POOLS = [
  [100, 1],
  [500, 10],
  [3000, 60],
  [10_000, 200],
] as const;

// The storage slot of a pool's state in Uniswap v4's PoolManager, whose pools mapping sits at slot 6, keyed by pool id.
function v4Slot([a, b]: [Address, Address], fee: number, tickSpacing: number): Hex {
  const types = ["address", "address", "uint24", "int24", "address"].map((type) => ({ type }));
  const id = keccak256(encodeAbiParameters(types, [a, b, fee, tickSpacing, zeroAddress]));
  return keccak256(encodeAbiParameters([{ type: "bytes32" }, { type: "uint256" }], [id, 6n]));
}

type PoolFound = Omit<Way, "tokenIn" | "tokenOut">;
type Lookup = { call: Call; found(reply: unknown): PoolFound | undefined };
// The reads that find a pair's pools on an exchange, one per curve, fee tier or tick spacing. `pair` must be sorted by
// address.
function lookupsOn(exchange: Exchange, pair: [Address, Address], spacings: Map<number, number[]>): Lookup[] {
  const { id, factory, kind } = exchange;
  const abi: Abi = factoryAbis[kind];
  const lookup = (name: string, args: unknown[], way: Partial<PoolFound> = {}): Lookup => ({
    call: call(factory, abi, name, ...pair, ...args),
    found: (pool) =>
      typeof pool === "string" && !same(pool, zeroAddress)
        ? { exchange: id, pool: pool as Address, fee: 0, tickSpacing: 0, ...way }
        : undefined,
  });
  const curves = (name: string) => [false, true].map((stable) => lookup(name, [stable], { stable }));
  switch (kind) {
    case "algebra":
      return [lookup("poolByPair", [])];
    case "pair":
      return curves("getPair");
    case "aerodrome":
      return curves("getPool");
    case "solidly":
      return [lookup("getPool", [], { stable: !!exchange.stable })];
    case "v2":
      return [lookup("getPair", [])];
    case "slipstream":
      return (spacings.get(id) ?? []).map((spacing) => lookup("getPool", [spacing], { tickSpacing: spacing }));
    case "v3":
      return V4_POOLS.map(([fee]) => lookup("getPool", [fee], { fee }));
    case "v4":
      // A pool exists once its price is set, which makes slot0 non-zero, and is worth quoting while its liquidity, the
      // low 128 bits of the fourth slot, is non-zero.
      return V4_POOLS.map(([fee, tickSpacing]) => ({
        call: call(factory, abi, "extsload", v4Slot(pair, fee, tickSpacing), 4n),
        found: (reply) => {
          const [slot0, , , liquidity] = (reply as Hex[] | undefined) ?? [];
          if (!slot0 || !liquidity || !BigInt(slot0) || !(BigInt(liquidity) % 2n ** 128n)) return undefined;
          return { exchange: id, pool: zeroAddress, fee, tickSpacing };
        },
      }));
  }
}

// Where a factory puts its pools, so that their addresses are known without asking it, as each factory's verified
// source says: EIP-1167 clones of an implementation, made by the factory, or whole contracts made by a deployer, whose
// init code hashes to one of `hashes`, each with CREATE2 and a salt of the sorted pair.
export type Placement = { implementation: Address } | { deployer: Address; hashes: Hex[] };
const cloneAt = (factory: Address, implementation: Address, salt: Hex): Address =>
  getContractAddress({
    opcode: "CREATE2",
    from: factory,
    salt,
    bytecode: concat([
      "0x3d602d80600a3d3981f3363d3d373d3d3d363d73",
      implementation,
      "0x5af43d82803e903d91602b57fd5bf3",
    ]),
  });
// A Slipstream pool's salt is keccak256(abi.encode(token0, token1, tickSpacing)). `pair` must be sorted by address.
export const slipstreamPool = (factory: Address, implementation: Address, pair: [Address, Address], spacing: number) =>
  cloneAt(
    factory,
    implementation,
    keccak256(encodeAbiParameters([{ type: "address" }, { type: "address" }, { type: "int24" }], [...pair, spacing])),
  );
// Every pool `exchange` could have for `pair`, sorted by address: one per tick spacing for Slipstream; for Aero's basic
// pools, whose stable and volatile pools have a factory each, salted keccak256(abi.encodePacked(token0, token1)), one;
// for Aerodrome's and Hydrex's classic ones, salted keccak256(abi.encodePacked(token0, token1, stable)), one per curve
// and code hash; and for Hydrex Integral (Algebra), salted keccak256(abi.encode(token0, token1)), one.
export function placedPools(
  exchange: Exchange,
  placement: Placement,
  pair: [Address, Address],
  spacings: number[] = [],
): PoolFound[] {
  const { id, kind, factory } = exchange;
  const found = (pool: Address, way: Partial<PoolFound> = {}): PoolFound => ({
    exchange: id,
    pool,
    fee: 0,
    tickSpacing: 0,
    ...way,
  });
  const packed = (stable?: boolean) =>
    keccak256(
      stable === undefined
        ? encodePacked(["address", "address"], pair)
        : encodePacked(["address", "address", "bool"], [...pair, stable]),
    );
  if ("implementation" in placement) {
    const { implementation } = placement;
    if (kind === "slipstream")
      return spacings.map((spacing) =>
        found(slipstreamPool(factory, implementation, pair, spacing), { tickSpacing: spacing }),
      );
    if (kind === "solidly") return [found(cloneAt(factory, implementation, packed()), { stable: !!exchange.stable })];
    if (kind === "aerodrome")
      return [false, true].map((stable) => found(cloneAt(factory, implementation, packed(stable)), { stable }));
    return [];
  }
  const { deployer, hashes } = placement;
  const made = (salt: Hex, hash: Hex) =>
    getContractAddress({ opcode: "CREATE2", from: deployer, salt, bytecodeHash: hash });
  if (kind === "pair")
    return [false, true].flatMap((stable) => hashes.map((hash) => found(made(packed(stable), hash), { stable })));
  if (kind === "algebra") {
    const salt = keccak256(encodeAbiParameters([{ type: "address" }, { type: "address" }], pair));
    return hashes.map((hash) => found(made(salt, hash)));
  }
  return [];
}

// Pools found, keyed by exchange id and sorted pair, cached until the page reloads. A failed lookup says so to those
// waiting on it, and is dropped so that the next call retries it.
type Looked = { found: PoolFound[]; failed: boolean };
const pools = new Map<string, Promise<Looked>>();
let spacingsRead: Promise<Map<number, number[]>> | undefined;
function spacings(rd: Read): Promise<Map<number, number[]>> {
  const slipstreams = BY_ID.filter(({ kind }) => kind === "slipstream");
  return (spacingsRead ??= rd(
    slipstreams.map(({ factory }) => call(factory, factoryAbis.slipstream, "tickSpacings")),
  ).then(
    (replies) => {
      if (replies.includes(undefined)) spacingsRead = undefined;
      return new Map(
        slipstreams.flatMap(({ id }, i) => {
          const found = replies[i];
          return found ? [[id, [...found]]] : [];
        }),
      );
    },
    (error: unknown) => {
      spacingsRead = undefined;
      throw error;
    },
  ));
}

// Where each factory whose pools' addresses can be computed puts them, by exchange id, read once, and again after a
// failure, leaving out an exchange whose answer is missing. A factory that an upgrade could change is read too: its
// pairs are looked for at its `codeHash` and, if another, at the one it gives now.
const PLACED: readonly ExchangeKind[] = ["slipstream", "solidly", "aerodrome", "pair", "algebra"];
let placementsRead: Promise<Map<number, Placement>> | undefined;
function placements(rd: Read): Promise<Map<number, Placement>> {
  const placed = BY_ID.filter(({ kind }) => PLACED.includes(kind));
  const asks = placed.map(({ factory, kind }): Call[] => {
    const abi: Abi = factoryAbis[kind];
    if (kind === "slipstream") return [call(factory, abi, "poolImplementation")];
    if (kind === "pair") return [call(factory, abi, "pairCodeHash")];
    if (kind === "algebra") return [call(factory, abi, "poolDeployer"), call(factory, abi, "POOL_INIT_CODE_HASH")];
    return [call(factory, abi, "implementation")];
  });
  return (placementsRead ??= rd(asks.flat()).then(
    (replies) => {
      if (replies.includes(undefined)) placementsRead = undefined;
      let next = 0;
      return new Map(
        placed.flatMap((exchange, i): [number, Placement][] => {
          const got = asks[i]!.map(() => replies[next++] as Address | Hex | undefined);
          if (got.includes(undefined)) return [];
          const { id, kind, factory, codeHash } = exchange;
          if (kind === "pair") {
            const hashes = [
              ...new Set([codeHash, got[0]].flatMap((hash) => (hash ? [hash.toLowerCase() as Hex] : []))),
            ];
            return [[id, { deployer: factory, hashes }]];
          }
          if (kind === "algebra") return [[id, { deployer: got[0] as Address, hashes: [got[1] as Hex] }]];
          return [[id, { implementation: got[0] as Address }]];
        }),
      );
    },
    (error: unknown) => {
      placementsRead = undefined;
      throw error;
    },
  ));
}

// Each pair's pools, keyed by `pairKey` of the pair as given, in the order of `exchanges`. Lookups not yet cached go in
// a single read, `LOOKUPS` calls to a batch since each is cheap, unless Uniswap v4's, which read more, are among them.
const LOOKUPS = 1_000;
export const waysFor = async (
  pairs: readonly (readonly [Address, Address])[],
  exchanges: Exchange[] = BY_ID,
  rd: Read = read,
): Promise<Map<string, Way[]>> => (await lookUp(pairs, exchanges, rd)).ways;
// The same, and whether a lookup failed, leaving out pools it would have found.
async function lookUp(
  pairs: readonly (readonly [Address, Address])[],
  exchanges: Exchange[],
  rd: Read,
): Promise<{ ways: Map<string, Way[]>; failed: boolean }> {
  const sorted = (a: Address, b: Address): [Address, Address] => (key(a) < key(b) ? [a, b] : [b, a]);
  const at = (exchange: Exchange, pair: readonly [Address, Address]) => `${exchange.id} ${pairKey(...sorted(...pair))}`;
  const missing = [
    ...new Map(pairs.flatMap((pair) => exchanges.map((e) => [at(e, pair), [e, sorted(...pair)] as const]))).entries(),
  ].filter(([id]) => !pools.has(id));
  if (missing.length) {
    const needsSpacings = missing.some(([, [exchange]]) => exchange.kind === "slipstream");
    // With `codeAt`, pools are found at their computed addresses in one ask, rather than by asking each factory for
    // each pair, curve and tick spacing. A factory is asked only for what could not be computed or checked: its
    // placement could not be read, or the check did not answer.
    const { codeAt } = rd;
    const placing = !!codeAt && missing.some(([, [exchange]]) => PLACED.includes(exchange.kind));
    const ask = (lookups: Lookup[][]) => {
      const calls = lookups.flat().map(({ call }) => call);
      const light = lookups.every((each, i) => !each.length || missing[i]![1][0].kind !== "v4");
      return calls.length ? rd(calls, light ? { perBatch: LOOKUPS } : {}) : Promise.resolve([]);
    };
    const answersTo = (lookups: Lookup[][], replies: unknown[]) => {
      let next = 0;
      return lookups.map((each) => each.map(() => replies[next++]));
    };
    const all = Promise.all([
      needsSpacings ? spacings(rd) : new Map<number, number[]>(),
      placing ? placements(rd).catch(() => new Map<number, Placement>()) : new Map<number, Placement>(),
    ]).then(async ([known, placed]) => {
      const candidates = missing.map(([, [exchange, pair]]) => {
        const placement = codeAt && PLACED.includes(exchange.kind) ? placed.get(exchange.id) : undefined;
        if (!placement || (exchange.kind === "slipstream" && !known.has(exchange.id))) return undefined;
        return placedPools(exchange, placement, pair, known.get(exchange.id));
      });
      const first = missing.map(([, [exchange, pair]], i) => (candidates[i] ? [] : lookupsOn(exchange, pair, known)));
      const [replies, held] = await Promise.all([
        ask(first),
        codeAt && candidates.some((list) => list?.length)
          ? codeAt(candidates.flatMap((list) => list ?? []).map(({ pool }) => pool))
          : [],
      ]);
      let nextHeld = 0;
      const holds = candidates.map((list) => list?.map(() => held[nextHeld++]));
      // Checks that did not answer are asked of the factory instead.
      const again = missing.map(([, [exchange, pair]], i) =>
        holds[i]?.includes(undefined) ? lookupsOn(exchange, pair, known) : [],
      );
      const answers = answersTo(first, replies);
      const answersAgain = answersTo(again, await ask(again));
      return missing.map(([, [exchange]], i) => {
        const lookups = again[i]!.length ? again[i]! : first[i]!;
        const replied = again[i]!.length ? answersAgain[i]! : answers[i]!;
        const unknown = exchange.kind === "slipstream" && !known.has(exchange.id);
        const looked = lookups.flatMap((lookup, j) => lookup.found(replied[j]) ?? []);
        const computed = again[i]!.length ? [] : (candidates[i] ?? []).filter((_, j) => holds[i]![j]);
        return { failed: replied.includes(undefined) || unknown, found: [...looked, ...computed] };
      });
    });
    missing.forEach(([id], i) => {
      const found = all.then(
        (each) => {
          if (each[i]!.failed) pools.delete(id);
          return each[i]!;
        },
        (error: unknown) => {
          pools.delete(id);
          throw error;
        },
      );
      pools.set(id, found);
    });
  }
  const unique = [...new Map(pairs.map((pair) => [pairKey(...pair), pair])).values()];
  let failed = false;
  const ways = new Map(
    await Promise.all(
      unique.map(async ([tokenIn, tokenOut]) => {
        const looked = await Promise.all(exchanges.map((exchange) => pools.get(at(exchange, [tokenIn, tokenOut]))!));
        if (looked.some((each) => each.failed)) failed = true;
        const found = looked.flatMap((each) => each.found);
        return [pairKey(tokenIn, tokenOut), found.map((way) => ({ ...way, tokenIn, tokenOut }))] as const;
      }),
    ),
  );
  return { ways, failed };
}

// Prices are averages over the 30 minutes up to a block, from the running sums pools keep, read at either end of the
// window with the blocks' times. A pool prices a token only if it holds at least $250 of each side and ten times the
// value priced.
export const WINDOW = 1800;
const FLOOR = 250;
const DEPTH = 10;

const pairAbi = parseAbi([
  "function getReserves() view returns (uint256 reserve0, uint256 reserve1, uint256 blockTimestampLast)",
  "function observe(uint32[] secondsAgos) view returns (uint256[] reserve0Cumulatives, uint256[] reserve1Cumulatives)",
  "function currentCumulativePrices() view returns (uint256 reserve0Cumulative, uint256 reserve1Cumulative, uint256 blockTimestamp)",
]);
const slipstreamAbi = parseAbi([
  "function slot0() view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, bool unlocked)",
  "function liquidity() view returns (uint128)",
  "function observe(uint32[] secondsAgos) view returns (int56[] tickCumulatives, uint160[] secondsPerLiquidityCumulativeX128s)",
]);
const algebraPoolAbi = parseAbi([
  "function getReserves() view returns (uint128 reserve0, uint128 reserve1)",
  "function plugin() view returns (address)",
  "function globalState() view returns (uint160 price, int24 tick, uint16 lastFee, uint8 pluginConfig, uint16 communityFee, bool unlocked)",
  "function liquidity() view returns (uint128)",
  "function getTimepoints(uint32[] secondsAgos) view returns (int56[] tickCumulatives, uint88[] volatilityCumulatives)",
]);
const feedAbi = parseAbi([
  "function latestRoundData() view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)",
]);

type Pool = { address: Address; exchange: Exchange; stable: boolean; token: Token; anchor: Anchor };
export type Source = Pool;
type Measured = { pool: Pool; price: number; depth: number };
// The window's last block, and the search for its first.
type Window = { start(): Promise<number>; end: number };
const whole = (amount: bigint, decimals: number): number => Number(amount) / 10 ** decimals;

// Token0's price in token1, in whole tokens, at a concentrated pool's tick.
export const tickPrice = (tick: number, decimals0: number, decimals1: number): number =>
  1.0001 ** tick * 10 ** (decimals0 - decimals1);
// Token0's price in token1 from whole-token reserves: x × y = k, or x³y + xy³ = k if stable.
export const pairPrice = (x: number, y: number, stable: boolean): number =>
  stable ? (3 * x * x * y + y ** 3) / (x ** 3 + 3 * x * y * y) : y / x;

// Every kind of pool sorts its tokens by address.
const tokenFirst = ({ token, anchor }: Pool): boolean => key(token.address) < key(anchor.address);
const sides = (pool: Pool): [Address, Address] =>
  tokenFirst(pool) ? [pool.token.address, pool.anchor.address] : [pool.anchor.address, pool.token.address];
const decimalsOf = (pool: Pool): [number, number] =>
  tokenFirst(pool) ? [pool.token.decimals, pool.anchor.decimals] : [pool.anchor.decimals, pool.token.decimals];
const inAnchor = (pool: Pool, price0: number): number => (tokenFirst(pool) ? price0 : 1 / price0);

// How a kind of pool prices. `state` lists its reads at the window's end, from which `reserves` takes its reserves;
// `sums` is the read of its running sums, made at both ends; `price` gives token0's price in token1 from how fast the
// sums grew.
type Pricing = {
  state(pool: Pool): Call[];
  reserves(state: unknown[]): readonly bigint[];
  sums(pool: Pool, state: unknown[]): Call;
  summed(reply: unknown): readonly bigint[] | undefined;
  price(perSecond: number[], pool: Pool): number | undefined;
};
const reservesRead = ({ address }: Pool) => [call(address, pairAbi, "getReserves")];
const reservesIn = ([reserves]: unknown[]) => reserves as readonly bigint[];
// The first of each list `observe` and `getTimepoints` return, for a time 0 seconds ago.
const firstOfEach = (reply: unknown) => (reply as readonly (readonly bigint[])[] | undefined)?.map((each) => each[0]!);
// Basic pools sum their reserves, and concentrated pools their tick.
const fromReserves = ([x, y]: number[], pool: Pool) => {
  const [decimals0, decimals1] = decimalsOf(pool);
  const [reserve0, reserve1] = [x! / 10 ** decimals0, y! / 10 ** decimals1];
  return reserve0 > 0 && reserve1 > 0 ? pairPrice(reserve0, reserve1, pool.stable) : undefined;
};
const fromTick = ([tick]: number[], pool: Pool) => tickPrice(tick!, ...decimalsOf(pool));
// A concentrated pool's reserves: what it holds of each token, but no more than a basic pool with its liquidity at its
// price would hold, so that liquidity parked away from the price does not count.
function inRange(held: readonly bigint[], sqrtPriceX96: bigint, liquidity: bigint): bigint[] {
  if (!sqrtPriceX96) return [0n, 0n];
  const near = [(liquidity << 96n) / sqrtPriceX96, (liquidity * sqrtPriceX96) >> 96n];
  return near.map((each, i) => (held[i]! < each ? held[i]! : each));
}

// Aero's basic pools.
const aero: Pricing = {
  state: reservesRead,
  reserves: reservesIn,
  sums: ({ address }) => call(address, pairAbi, "observe", [0]),
  summed: firstOfEach,
  price: fromReserves,
};
// Aerodrome's and Hydrex's classic pools.
const classic: Pricing = {
  state: reservesRead,
  reserves: reservesIn,
  sums: ({ address }) => call(address, pairAbi, "currentCumulativePrices"),
  summed: (reply) => (reply as readonly bigint[] | undefined)?.slice(0, 2),
  price: fromReserves,
};
// Aero's and Aerodrome's concentrated pools.
const slipstream: Pricing = {
  state: (pool) => [
    ...sides(pool).map((token) => call(token, erc20Abi, "balanceOf", pool.address)),
    call(pool.address, slipstreamAbi, "slot0"),
    call(pool.address, slipstreamAbi, "liquidity"),
  ],
  reserves: ([held0, held1, slot0, liquidity]) =>
    inRange([held0, held1] as bigint[], (slot0 as readonly [bigint])[0], liquidity as bigint),
  sums: ({ address }) => call(address, slipstreamAbi, "observe", [0]),
  summed: firstOfEach,
  price: fromTick,
};
// Hydrex Integral's concentrated pools, whose plugin keeps the sums.
const algebra: Pricing = {
  state: ({ address }) => [
    call(address, algebraPoolAbi, "getReserves"),
    call(address, algebraPoolAbi, "plugin"),
    call(address, algebraPoolAbi, "globalState"),
    call(address, algebraPoolAbi, "liquidity"),
  ],
  reserves: ([reserves, , globalState, liquidity]) =>
    inRange(reserves as bigint[], (globalState as readonly [bigint])[0], liquidity as bigint),
  sums: (_, [, plugin]) => call(plugin as Address, algebraPoolAbi, "getTimepoints", [0]),
  summed: firstOfEach,
  price: fromTick,
};
const KINDS: Record<PricedKind, Pricing> = { solidly: aero, aerodrome: classic, pair: classic, slipstream, algebra };
function pricingOf({ kind, name }: Exchange): Pricing {
  const found = (KINDS as Partial<Record<ExchangeKind, Pricing>>)[kind];
  if (!found) throw new Error(`${name} cannot price tokens.`);
  return found;
}

const logged = (error: unknown): undefined => void console.error(error);
// Each pool's average price over the window, in the prices' unit, and its depth at its end. Pools without an average,
// such as those younger than the window, and pools too thin for the amount priced are dropped; one holding less than
// `FLOOR` of its anchor is dropped before its sums are read. Undefined if a read failed, which leaves only these pools
// unpriced.
async function measure(
  pools: Pool[],
  prices: Prices,
  amounts: Amounts,
  window: Window,
  rd: Read,
): Promise<Measured[] | undefined> {
  if (!pools.length) return [];
  const start = window.start();
  const asked = pools.map((pool) => pricingOf(pool.exchange).state(pool));
  const replies = await rd(asked.flat(), { block: window.end }).catch(logged);
  if (!replies) return undefined;
  let next = 0;
  const ready = pools.flatMap((pool, i) => {
    const state = replies.slice(next, (next += asked[i]!.length));
    if (state.includes(undefined)) return [];
    const kind = pricingOf(pool.exchange);
    const [decimals0, decimals1] = decimalsOf(pool);
    const [reserve0, reserve1] = kind.reserves(state);
    const [x, y] = [whole(reserve0!, decimals0), whole(reserve1!, decimals1)];
    const [tokenReserve, anchorReserve] = tokenFirst(pool) ? [x, y] : [y, x];
    const anchorPrice = prices.of.get(key(pool.anchor.address))!;
    return anchorReserve * anchorPrice >= FLOOR
      ? [{ pool, kind, state, tokenReserve, anchorReserve, anchorPrice }]
      : [];
  });
  if (!ready.length) return [];
  const sums = [...ready.map(({ pool, kind, state }) => kind.sums(pool, state)), blockTime];
  const [before, after] = await Promise.all([
    start.then((block) => rd(sums, { block })).catch(logged),
    rd(sums, { block: window.end }).catch(logged),
  ]);
  if (!before || !after) return undefined;
  const elapsed = Number(after.at(-1)) - Number(before.at(-1));
  if (!(elapsed > 0)) return [];
  const sized = await amounts;
  return ready.flatMap(({ pool, kind, tokenReserve, anchorReserve, anchorPrice }, i): Measured[] => {
    const [first, last] = [kind.summed(before[i]), kind.summed(after[i])];
    const perSecond = first && last && first.map((sum, j) => Number(last[j]! - sum) / elapsed);
    const price0 = perSecond && kind.price(perSecond, pool);
    const price = price0 && inAnchor(pool, price0) * anchorPrice;
    if (!price || !Number.isFinite(price)) return [];
    const depth = Math.min(tokenReserve * price, anchorReserve * anchorPrice);
    const value = whole(sized.get(key(pool.token.address)) ?? 0n, pool.token.decimals) * price;
    return depth >= Math.max(FLOOR, DEPTH * value) ? [{ pool, price, depth }] : [];
  });
}

// Prices each token from its deepest pool against an anchor already priced; of two pools equally deep, the one whose
// exchange comes first in `exchanges` wins.
async function inPools(
  tokens: Token[],
  prices: Prices,
  amounts: Amounts,
  window: Window,
  exchanges: Exchange[],
  rd: Read,
) {
  if (!tokens.length) return;
  const anchors = config.ANCHORS.filter(({ address }) => prices.of.has(key(address)));
  const pairs = tokens.flatMap((token) => anchors.map((anchor) => ({ token, anchor })));
  const { ways, failed } = await lookUp(
    pairs.map(({ token, anchor }) => [token.address, anchor.address]),
    exchanges,
    rd,
  );
  if (failed) prices.unread = true;
  const rank = (pool: Pool) => exchanges.findIndex(({ id }) => id === pool.exchange.id);
  const candidates = pairs
    .flatMap(({ token, anchor }) =>
      ways.get(pairKey(token.address, anchor.address))!.map((way): Pool => ({
        address: way.pool,
        exchange: exchangeOf(way.exchange),
        stable: !!way.stable,
        token,
        anchor,
      })),
    )
    .sort((a, b) => rank(a) - rank(b));
  const measured = await measure(candidates, prices, amounts, window, rd);
  if (!measured) prices.unread = true;
  for (const [token, pools] of Map.groupBy(measured ?? [], ({ pool }) => key(pool.token.address))) {
    const deepest = pools.reduce((most, each) => (each.depth > most.depth ? each : most));
    prices.of.set(token, deepest.price);
    prices.sources?.set(token, deepest.pool);
  }
}

// The last block at or before each time asked for, shared by every pricing. Prices now start from the newest block's
// time, which moves on, so only the latest such start is kept.
const blocksAt = new Map<number, Promise<number>>();
let nowStart: number | undefined;
// Forgets every pool, block and quote found, for tests.
export function forget(): void {
  pools.clear();
  spacingsRead = undefined;
  placementsRead = undefined;
  blocksAt.clear();
  nowStart = undefined;
  quotes.clear();
}

// Prices per whole token over the 30 minutes up to `time`, or up to the newest block if earlier, ending at least
// `settledBelow` it. Anchors take their Chainlink feeds' answers and fiat feeds give each currency's rate; with no
// anchor feed, prices are in USDC, at 1. Pools then price the anchors without a feed, then the other tokens. `amounts`,
// how much of each token will be priced, may be a promise: pools are read meanwhile and judged once it is known.
// `tiers` are searched in order, each only for what those before left unpriced.
export async function pricesAt(
  tokens: Token[],
  amounts: Amounts,
  time: number,
  rd: Read = read,
  tiers = config.PRICING,
): Promise<Prices> {
  tiers.flat().forEach(pricingOf);
  const early = tokens.some(({ address }) => !config.ANCHORS.some((anchor) => same(anchor.address, address)));
  const { window, prices } = await fedAt(time, early, rd);
  const anchors = config.ANCHORS.map(({ address, decimals }) => ({ address, decimals, symbol: "" }));
  for (const each of [anchors, tokens])
    for (const exchanges of tiers)
      await inPools(
        each.filter(({ address }) => !prices.of.has(key(address))),
        prices,
        amounts,
        window,
        exchanges,
        rd,
      );
  return prices;
}
// Prices at `time` from the pools that priced each token at another time, which reads far less than searching again.
// A token whose pool was too thin, too young or unread then has no price.
export async function pricesFrom(
  sources: Map<string, Source>,
  amounts: Amounts,
  time: number,
  rd: Read = read,
): Promise<Prices> {
  const { window, prices } = await fedAt(time, sources.size > 0, rd);
  const isAnchor = ({ token }: Source) => config.ANCHORS.some(({ address }) => same(address, token.address));
  for (const anchors of [true, false]) {
    const pools = [...sources.values()].filter(
      (pool) =>
        isAnchor(pool) === anchors &&
        !prices.of.has(key(pool.token.address)) &&
        prices.of.has(key(pool.anchor.address)),
    );
    const measured = await measure(pools, prices, amounts, window, rd);
    if (!measured) prices.unread = true;
    for (const { pool, price } of measured ?? []) {
      prices.of.set(key(pool.token.address), price);
      prices.sources!.set(key(pool.token.address), pool);
    }
  }
  return prices;
}
// The 30 minutes up to `time`, or up to the newest block if earlier, ending at least `settledBelow` it, and the
// anchors' and currencies' feeds at its end. With `early`, the search for its first block starts at once.
async function fedAt(time: number, early: boolean, rd: Read): Promise<{ window: Window; prices: Prices }> {
  // Both ends are searched for down from `top`, at first at the pace from it to the newest block, and share the blocks
  // they read.
  const { newest, newestTime, timeOf } = await blockClock(rd);
  const top = settledBelow(newest);
  const lastBlockAt = async (at: number): Promise<number> => {
    const topTime = await timeOf(top);
    if (at >= topTime) return top;
    const known = blocksAt.get(at);
    if (known) return known;
    const found = firstBlockAt(at + 1, top, topTime, timeOf, [newest, newestTime]).then((first) => first - 1);
    if (time >= newestTime) {
      if (nowStart !== undefined) blocksAt.delete(nowStart);
      nowStart = at;
    }
    blocksAt.set(at, found);
    found.catch(() => blocksAt.get(at) === found && blocksAt.delete(at));
    return found;
  };
  let start: Promise<number> | undefined;
  const startOf = (): Promise<number> => {
    if (!start) {
      start = lastBlockAt(Math.min(time, newestTime) - WINDOW);
      start.catch(() => undefined);
    }
    return start;
  };
  if (early) void startOf();
  const window: Window = { end: time >= newestTime ? top : await lastBlockAt(time), start: startOf };
  const fiat = Object.entries(config.FIAT_FEEDS) as [Fiat, Address][];
  const feeds = [...config.ANCHORS.map(({ feed }) => feed), ...fiat.map(([, feed]) => feed)];
  const rounds = await rd(
    feeds.map((feed) => call(feed, feedAbi, "latestRoundData")),
    { block: window.end },
  );
  const answers = rounds.map((round) => round && Number(round[1]) / 1e8);
  const [anchorFeeds, fiatFeeds] = [answers.slice(0, config.ANCHORS.length), answers.slice(config.ANCHORS.length)];
  const fed = config.ANCHORS.flatMap(({ address }, i) =>
    anchorFeeds[i] === undefined ? [] : [[key(address), anchorFeeds[i]] as const],
  );
  const rates: Rates = Object.fromEntries(
    fiat.flatMap(([currency], i) => (fiatFeeds[i] === undefined ? [] : [[currency, fiatFeeds[i]]])),
  );
  const prices: Prices = fed.length
    ? { unit: "USD", rates, of: new Map(fed), sources: new Map() }
    : { unit: "USDC", rates: {}, of: new Map([[key(config.USDC), 1]]), sources: new Map() };
  return { window, prices };
}

export const pricesNow = (tokens: Token[], amounts: Amounts = new Map(), rd: Read = read): Promise<Prices> =>
  pricesAt(tokens, amounts, Infinity, rd);
// An epoch's prices, from Hydrex's pools only: little of its rewards is priced only elsewhere, and looking there too
// takes twice as long. They are kept for the epoch, so a pool that could not be read fails them.
export async function pricesAtFlip(
  tokens: Token[],
  amounts: Map<string, bigint>,
  flip: number,
  rd: Read = read,
): Promise<Prices> {
  const prices = await pricesAt(tokens, amounts, flip, rd, config.HYDREX_PRICING);
  if (prices.unread) throw new Error("Some pools could not be read from Base.");
  return prices;
}
// Prices now without amounts, as a market would quote them, for weighing rewards against one another, not for showing.
// Each token's quote is shared for five minutes; a failed read is made again by the next caller.
const QUOTED = 5 * 60_000;
const quotes = new Map<string, { at: number; reading: Promise<Prices> }>();
export async function quotesOf(asked: Token[], rd: Read = read): Promise<Pick<Prices, "of" | "unread">> {
  const tokens = [...new Map(asked.map((token) => [key(token.address), token])).values()];
  const fresh = (address: Address) => {
    const quote = quotes.get(key(address));
    return quote && performance.now() - quote.at < QUOTED ? quote : undefined;
  };
  const missing = tokens.filter(({ address }) => !fresh(address));
  if (missing.length) {
    const reading = pricesNow(missing, new Map(), rd).catch((error: unknown): Prices => {
      console.error(error);
      return { ...noPrices(), unread: true };
    });
    const quote = { at: performance.now(), reading };
    for (const { address } of missing) quotes.set(key(address), quote);
    void reading.then(({ unread }) => {
      if (unread)
        for (const { address } of missing) if (quotes.get(key(address)) === quote) quotes.delete(key(address));
    });
  }
  const readings = tokens.map(({ address }) => quotes.get(key(address))!.reading);
  const found = await Promise.all(readings);
  const of = new Map<string, number>();
  tokens.forEach(({ address }, i) => {
    const price = found[i]!.of.get(key(address));
    if (price !== undefined) of.set(key(address), price);
  });
  return { of, ...(found.some(({ unread }) => unread) && { unread: true }) };
}

// The anchors' prices now, which include ETH's for gas costs; read at most once a minute.
export const anchorsNow = (): Promise<Prices | undefined> =>
  memo("anchors", () => pricesNow([]), 60_000).catch(() => undefined);

export function ethCost(wei: bigint, prices: Prices | undefined): Money | undefined {
  const eth = prices?.of.get(key(config.WETH));
  return prices && eth !== undefined ? moneyAt(worthOf(wei, 18, eth), prices) : undefined;
}
export const gasWords = (wei: bigint, prices: Prices | undefined): string => {
  const cost = ethCost(wei, prices);
  return cost ? money(cost, true) : `${figure(wei, 18)} ETH`;
};
