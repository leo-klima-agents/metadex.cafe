import { maxUint256, type Address } from "viem";
import { AUTOMATIONS, HYDX, SWAPPERS, swapperOf, type Swapper, type Token } from "../config.ts";
import { figuresOf } from "../earnings.ts";
import { between, bps, figure, fixed, fraction, list as words, money, rounded, utc, type Money } from "../format.ts";
import { costs, ethCost, pricesNow, worthOf, type Costs, type Prices } from "../prices.ts";
import { routeTogether } from "../routing.ts";
import { gasPaid, now, simulate, timeOf, type Receipt } from "../rpc.ts";
import { update } from "../state.ts";
import {
  APPROVAL_GAS,
  MIDDLES,
  approve,
  feeOf,
  findRoute,
  minimumOf,
  paidOf,
  quoteAll,
  reasonOf,
  refusedTransfer,
  routeResults,
  runInOrder,
  soldOf,
  split,
  swapCall,
  swapGas,
  swappedIn,
  venueOf,
  type Found,
  type Result,
  type Route,
} from "../swap.ts";
import { allowancesOf, holdingsOf, isHydrex, know, known, lookalike, tokensOf, type Allowance } from "../tokens.ts";
import { key, same, sum } from "../util.ts";
import { walletAssets, type Connection } from "../wallet.ts";
import { $, $$, busy, clone, fill, isBusy, list, setState, type Value } from "./dom.ts";
import { closed, openReview, type Slip } from "./review.ts";
import { hrefOf, onRoute, route } from "./router.ts";
import { checks, session, swapsOff } from "./session.ts";

const view = $(".view[data-view=swap]");
const tokensBox = $("#tokens");
const summary = $("#summary");
const reviewButton = $("#review-swap");
const margin = () => BigInt($<HTMLSelectElement>("#margin").value);
const output = (): Swapper => swapperOf(route().output ?? "usdc")!;
// A quote 2% under the page's own price says so; a token ticks itself when its quote is worth twice its gas.
const CHECK = 0.02;
const CLEARS = 2;

type Row = {
  token: Token;
  like?: Token | undefined;
  allowance: bigint;
  amount: bigint;
  price?: number | undefined;
  // undefined until routed; null with no route.
  found?: Found | null;
  failed: boolean;
  worth?: number | undefined;
  reason?: string | undefined;
  ticked: boolean;
  touched: boolean;
};
type Scan = {
  id: number;
  owner: Address;
  swapper: Swapper;
  rows: Row[];
  tokens: Map<string, Token>;
  prices: Prices;
  costs?: Costs | undefined;
  reading: boolean;
  failed: boolean;
};
// The ticked tokens routed together: each token's parts, and what each fetches when Base runs them all in order.
type Part = { route: Route; out: bigint | undefined };
type Together = { key: string; parts: Map<string, Part[]>; gas: bigint | undefined };
let scans = 0;
let scan: Scan | undefined;
let prefilled: Map<string, bigint> | undefined;
let rescan = false;
let together: Together | undefined;
let routing: { key: string; done: Promise<void> } | undefined;
let routeLater: ReturnType<typeof setTimeout> | undefined;
let allowances: { owner: Address; found?: Allowance[]; tokens?: Map<string, Token> } | undefined;
let failure = "";

// The App's line on the swap: tokens worth swapping, and what they fetch.
export function swapLine(): { count: number; worth: Money; reading: boolean; failed: boolean } | undefined {
  if (!scan) return undefined;
  const worth = scan.rows.filter((row) => row.found && !row.reason);
  return {
    count: worth.length,
    worth: { value: sum(worth.map((row) => row.worth ?? 0)), unit: scan.prices.unit },
    reading: scan.reading,
    failed: scan.failed,
  };
}
export const allowancesLeft = (): Allowance[] | undefined =>
  allowances && same(allowances.owner, session.connection?.address ?? "") ? allowances.found : undefined;

// A payout's tokens and amounts, to tick on the swap's page.
export function prefill(amounts: { token: Address; amount: bigint }[]): void {
  prefilled = new Map(amounts.map(({ token, amount }) => [key(token), amount]));
  know(amounts.map(({ token }) => token));
  if (session.connection) void startScan(session.connection.address, output());
}

const priceOf = (scanned: Scan | undefined, token: Address) => scanned?.prices.of.get(key(token));
const inOutput = (value: number, scanned: Scan): bigint | undefined => {
  const price = priceOf(scanned, scanned.swapper.token);
  return price ? BigInt(Math.floor((value / price) * 10 ** scanned.swapper.decimals)) : undefined;
};
const gasCostOf = (gas: bigint, found: Costs | undefined, prices: Prices | undefined) =>
  found ? ethCost(gas * found.gasPrice, prices) : undefined;
const gasValueIn = (scanned: Scan) => (gas: bigint) => {
  const cost = gasCostOf(gas, scanned.costs, scanned.prices);
  return cost ? (inOutput(cost.value, scanned) ?? 0n) : 0n;
};
const tickedOf = (scanned: Scan) => scanned.rows.filter((row) => row.ticked && row.found);
const tickedKey = (scanned: Scan, ticked = tickedOf(scanned)) =>
  `${scanned.id} ${ticked.map((row) => `${key(row.token.address)}:${row.amount}`).join(" ")}`;
const togetherFor = (scanned: Scan) => (together?.key === tickedKey(scanned) ? together : undefined);
const partsOf = (row: Row, found: Together | undefined): Part[] =>
  found?.parts.get(key(row.token.address)) ?? [
    { route: { ...row.found!.route, amount: row.amount, minPaid: 0n }, out: row.found!.out },
  ];
function fetchesOf(row: Row, scanned: Scan): bigint | undefined {
  if (!row.found) return undefined;
  const parts = partsOf(row, row.ticked ? togetherFor(scanned) : undefined);
  return parts.every(({ out }) => out === undefined)
    ? undefined
    : parts.reduce((total, { out }) => total + (out ?? 0n), 0n);
}

// The output's amounts all to one number of places, enough for a cent at its price, so a column lines up.
function figures(swapper: Swapper, prices: Prices | undefined) {
  const price = prices?.of.get(key(swapper.token));
  const places = Math.min(
    swapper.decimals,
    Math.max(2, price ? Math.ceil(Math.log10(price) + 2 - 0.05) : swapper.places),
  );
  const worth = (amount: bigint): Money | undefined =>
    price === undefined ? undefined : { value: worthOf(amount, swapper.decimals, price), unit: prices!.unit };
  return {
    exact: (amount: bigint) => `${fixed(amount, swapper.decimals, places)} ${swapper.symbol}`,
    worth,
    cents: (amount: bigint) => {
      const found = worth(amount);
      return found ? money(found, true) : "";
    },
    shown: (amount: bigint) => rounded(amount, swapper.decimals, places),
  };
}
// The quote, the 1% as what lies between the two around it so the bill adds up, what reaches you, the least, and gas.
function bill(
  root: ParentNode,
  { out, least, gas }: { out: bigint; least: bigint; gas: bigint },
  swapper: Swapper,
  prices: Prices | undefined,
  found: Costs | undefined,
): void {
  const { exact, worth, cents, shown } = figures(swapper, prices);
  const paid = out - feeOf(out);
  const [outWorth, paidWorth] = [worth(out), worth(paid)];
  const wei = found && gas * found.gasPrice;
  const gasCost = wei === undefined ? undefined : ethCost(wei, prices);
  fill(root, {
    quoted: exact(out),
    "quoted-worth": cents(out),
    fee: exact(shown(paid) - shown(out)),
    "fee-worth": outWorth && paidWorth ? money(between(outWorth, paidWorth), true) : "",
    paid: exact(paid),
    "paid-worth": cents(paid),
    least: exact(least),
    "least-worth": cents(least),
    gas: wei === undefined ? `${gas.toLocaleString("en-GB")} gas` : `${figure(wei, 18)} ETH`,
    "gas-worth": gasCost ? money(gasCost, true) : "",
  });
}

// How far under the page's own price an amount fetches, beyond CHECK; not for a whole balance.
function underPrice(
  token: Token,
  amount: bigint,
  out: bigint,
  swapper: Swapper,
  prices: Prices | undefined,
): number | undefined {
  const [price, outputPrice] = [prices?.of.get(key(token.address)), prices?.of.get(key(swapper.token))];
  if (price === undefined || outputPrice === undefined || amount === maxUint256) return undefined;
  const [sold, fetched] = [worthOf(amount, token.decimals, price), worthOf(out, swapper.decimals, outputPrice)];
  return sold > 0 && fetched < sold * (1 - CHECK) ? 1 - fetched / sold : undefined;
}

function judge(row: Row, scanned: Scan): void {
  if (row.failed) return void (row.reason = "Not read");
  if (row.found === undefined) return;
  if (row.found === null) return void (row.reason = "No route");
  const price = priceOf(scanned, scanned.swapper.token);
  row.worth =
    price !== undefined
      ? worthOf(row.found.out, scanned.swapper.decimals, price)
      : row.price === undefined
        ? undefined
        : worthOf(row.amount, row.token.decimals, row.price);
  const cost =
    gasCostOf(row.found.gas + (row.allowance < row.amount ? APPROVAL_GAS : 0n), scanned.costs, scanned.prices)?.value ??
    0;
  row.reason = row.worth === undefined ? "No price" : row.worth < CLEARS * cost ? "Below gas" : undefined;
}
const ticksItself = (row: Row) => !!row.found && !row.reason && (!prefilled || prefilled.has(key(row.token.address)));
const worthFirst = (row: Row) => (row.reason || row.worth === undefined ? -1 : row.worth);

export function renderSwap(): void {
  const swapper = output();
  for (const input of $$<HTMLInputElement>("#outputs input")) input.checked = input.value === swapper.output;
  $("#swap-off").hidden = !checksFailed();
  renderAllowances();
  const scanned = session.connection ? scan : undefined;
  if (!scanned) return void fill(view, { ticked: "" });
  setState(
    tokensBox,
    scanned.failed ? "failed" : scanned.rows.length ? "ready" : scanned.reading ? "loading" : "empty",
  );
  list(
    $(".list", tokensBox),
    "token-row",
    scanned.rows,
    (row) => key(row.token.address),
    (node, row) => {
      const box = $<HTMLInputElement>(".pick", node);
      box.checked = row.ticked;
      box.disabled = !row.found;
      box.setAttribute("aria-label", `Sell ${row.token.symbol}`);
      box.onchange = () => {
        [row.ticked, row.touched] = [box.checked, true];
        renderSwap();
      };
      const fetches = fetchesOf(row, scanned);
      const { exact, cents } = figures(swapper, scanned.prices);
      const under =
        row.reason || fetches === undefined
          ? undefined
          : underPrice(row.token, row.amount, fetches, swapper, scanned.prices);
      fill(node, {
        symbol: row.token.symbol,
        amount: figure(row.amount, row.token.decimals),
        fetches: fetches !== undefined ? exact(fetches) : row.found === undefined && !row.failed ? undefined : "",
        worth: fetches !== undefined ? cents(fetches) : "",
        route: row.reason ?? (row.found && fetches === undefined ? "Base would skip it" : ""),
        warning: [
          row.like ? `Not the usual ${row.like.symbol}` : "",
          under === undefined ? "" : `Quote ${fraction(under)} under price`,
        ]
          .filter(Boolean)
          .join(" · "),
      });
    },
  );
  const ticked = tickedOf(scanned);
  fill(view, { ticked: scanned.rows.length ? `· ${ticked.length} of ${scanned.rows.length}` : "" });
  const found = togetherFor(scanned);
  const routingNow = !!ticked.length && !found && !scanned.reading && !swapsOff();
  setState(summary, ticked.length ? "ready" : "empty");
  fill(summary, {
    "swap-status": !ticked.length ? "" : !checksRead() ? "Checking Base…" : routingNow ? "Routing them together…" : "",
    "swap-failed": failure,
  });
  reviewButton.setAttribute("aria-disabled", String(!ticked.length || swapsOff() || isBusy(reviewButton)));
  if (!ticked.length) return;
  if (routingNow) routeSoon(scanned);
  const parts = ticked.flatMap((row) => partsOf(row, found));
  const going = parts.flatMap(({ out }) => (out === undefined ? [] : [out]));
  const routes = parts.map(({ route }) => route);
  const swaps = split(routes).length;
  const gas =
    found?.gas ?? BigInt(ticked.filter((row) => row.allowance < row.amount).length) * APPROVAL_GAS + swapGas(routes);
  bill(
    summary,
    { out: going.reduce((a, b) => a + b, 0n), least: going.reduce((a, b) => a + minimumOf(b, margin()), 0n), gas },
    swapper,
    scanned.prices,
    scanned.costs,
  );
  if (swaps > 1) fill(summary, { "swap-status": `${swaps} swaps` });
}
const checksRead = () => !!checks.value;
const checksFailed = () => checksRead() && swapsOff();

// The ticked tokens routed together, once the ticks settle for 400 ms.
function routeSoon(scanned: Scan): void {
  if (routing?.key === tickedKey(scanned)) return;
  clearTimeout(routeLater);
  routeLater = setTimeout(() => void routeTicked(scanned), 400);
}

// Each token's own route, or parts through other pools, whichever fetches more net of gas when Base runs them in order.
function routeTicked(scanned: Scan): Promise<void> {
  const ticked = tickedOf(scanned);
  const id = tickedKey(scanned, ticked);
  if (!ticked.length || togetherFor(scanned)) return Promise.resolve();
  if (routing?.key === id) return routing.done;
  clearTimeout(routeLater);
  const { swapper, owner } = scanned;
  const gasValue = gasValueIn(scanned);
  const allowance = (token: Address) => ticked.find((row) => same(row.token.address, token))?.allowance ?? 0n;
  const runOf = (plan: Route[][]) => runInOrder(owner, swapper, plan.flat(), allowance);
  const own = ticked.map((row) => partsOf(row, undefined).map(({ route }) => route));
  const find = async () => {
    const sales = ticked.map((row) => ({
      token: row.token.address,
      amount: row.amount,
      found: row.found!,
      hydrex: isHydrex(row.token.address),
    }));
    const [ownRun, parted] = await Promise.all([
      runOf(own),
      routeTogether(sales, swapper, gasValue).catch((error: unknown) => void console.error(error)),
    ]);
    const plans = parted ? [own, parted] : [own];
    const runs = [ownRun, parted && (await runOf(parted))];
    const net = runs.map(
      (run) =>
        run &&
        run.results.reduce((total, result) => total + (result?.done ? result.amountOut : 0n), 0n) - gasValue(run.gas),
    );
    const chosen = net[1] !== undefined && (net[0] === undefined || net[1] > net[0]) ? 1 : 0;
    const run = runs[chosen];
    let next = 0;
    const parts = new Map(
      ticked.map((row, i) => [
        key(row.token.address),
        plans[chosen]![i]!.map((route): Part => {
          const result = run?.results[next++];
          return { route, out: run ? (result?.done ? result.amountOut : undefined) : row.found!.out };
        }),
      ]),
    );
    return { parts, gas: run?.gas };
  };
  const done = (async () => {
    const found = await find().catch((error: unknown) => {
      console.error(error);
      return { parts: new Map(ticked.map((row) => [key(row.token.address), partsOf(row, undefined)])), gas: undefined };
    });
    if (routing?.key !== id || scan !== scanned) return;
    together = { key: id, ...found };
    routing = undefined;
    renderSwap();
  })();
  routing = { key: id, done };
  done.catch(console.error).finally(() => routing?.key === id && (routing = undefined));
  return done;
}

// The wallet's tokens, their prices, and each one's route, three at a time. With `quoted`, as when more tokens became
// known, the rows stay until the new scan knows its tokens, and those held alike keep their quotes.
async function startScan(owner: Address, swapper: Swapper, quoted = false): Promise<void> {
  const id = ++scans;
  const kept = scan && same(scan.owner, owner) && scan.swapper === swapper ? scan : undefined;
  const scanned: Scan = {
    id,
    owner,
    swapper,
    rows: [],
    tokens: new Map(),
    prices: { unit: "USD", of: new Map() },
    reading: true,
    failed: false,
  };
  const current = () => scans === id;
  if (!quoted || !kept) scan = scanned;
  update();
  try {
    knowRewards();
    if (session.connection) know(await walletAssets(session.connection));
    const all = [...new Set(known().map(key))] as Address[];
    const held = await holdingsOf(owner, all, swapper.address);
    const mine = all.filter((token) => held.get(token)!.balance > 0n && !same(token, swapper.token));
    const [tokens, found] = await Promise.all([
      tokensOf([...mine, swapper.token, ...MIDDLES, HYDX]),
      costs().catch(() => undefined),
    ]);
    if (!current()) return;
    scanned.tokens = tokens;
    scanned.costs = found;
    scanned.prices = await pricesNow(
      [...tokens.values()],
      new Map(mine.map((token) => [token, held.get(token)!.balance])),
    ).catch((error: unknown) => (console.error(error), scanned.prices));
    if (!current()) return;
    scanned.rows = mine.flatMap((address): Row[] => {
      const token = tokens.get(address);
      if (!token) return [];
      const { balance, allowance } = held.get(address)!;
      const asked = prefilled?.get(address);
      const amount = asked !== undefined && asked < balance ? asked : balance;
      const before = kept?.rows.find((row) => same(row.token.address, address) && row.amount === amount);
      const row: Row = {
        token,
        like: lookalike(token),
        allowance,
        amount,
        price: scanned.prices.of.get(address),
        failed: false,
        ticked: !!before?.touched && before.ticked,
        touched: !!before?.touched,
      };
      if (quoted && before && before.found !== undefined && !before.failed) {
        row.found = before.found;
        judge(row, scanned);
        if (!row.touched) row.ticked = ticksItself(row);
      }
      return [row];
    });
    const value = (row: Row) =>
      row.found !== undefined
        ? worthFirst(row)
        : row.price === undefined
          ? -1
          : worthOf(row.amount, row.token.decimals, row.price);
    scanned.rows.sort((a, b) => value(b) - value(a));
    scan = scanned;
    update();
    const queue = scanned.rows
      .filter((row) => row.found === undefined)
      .sort((a, b) => Number(!!prefilled?.has(key(b.token.address))) - Number(!!prefilled?.has(key(a.token.address))));
    const gasValue = gasValueIn(scanned);
    await Promise.all(
      [0, 1, 2].map(async () => {
        for (let row = queue.shift(); row && current(); row = queue.shift()) {
          try {
            row.found =
              (await findRoute(row.token.address, row.amount, swapper, isHydrex(row.token.address), gasValue)) ?? null;
          } catch (error) {
            console.error(error);
            row.failed = true;
          }
          judge(row, scanned);
          if (!row.touched) row.ticked = ticksItself(row);
          update();
        }
      }),
    );
  } catch (error) {
    console.error(error);
    if (current()) [scanned.failed, scan] = [true, scanned];
  } finally {
    if (current() && rescan) {
      rescan = false;
      rescanNow();
    } else if (current()) {
      scanned.rows.sort((a, b) => worthFirst(b) - worthFirst(a));
      scanned.reading = false;
      update();
    }
  }
}

// Hydrex's reward tokens, from last epoch's rewards: whether some are new.
function knowRewards(): boolean {
  const before = known().length;
  for (const automation of AUTOMATIONS)
    know(figuresOf(automation).value?.rewards.map(({ token }) => token.address) ?? [], true);
  return known().length > before;
}
function rescanNow(): void {
  if (session.connection) void startScan(session.connection.address, scan?.swapper ?? output(), true);
}
// The wallet changed, or what it holds did: its tokens and approvals again; a payout's amounts no longer apply.
export function walletChanged(): void {
  prefilled = undefined;
  if (!session.connection) {
    scans++;
    [scan, allowances] = [undefined, undefined];
    return update();
  }
  void startScan(session.connection.address, output());
  void readAllowances();
}
export function rewardsRead(): void {
  if (!knowRewards()) return;
  if (scan?.reading) rescan = true;
  else rescanNow();
}

async function readAllowances(): Promise<void> {
  const owner = session.connection?.address;
  if (!owner) return;
  const these: NonNullable<typeof allowances> = same(allowances?.owner ?? "", owner) ? { ...allowances! } : { owner };
  allowances = these;
  update();
  try {
    const found = await allowancesOf(owner, [...new Set(known().map(key))] as Address[]);
    const tokens = await tokensOf(found.map(({ token }) => token));
    if (allowances === these) Object.assign(these, { found, tokens });
  } catch (error) {
    console.error(error);
  }
  update();
}

// Every list of the swappers' approvals: the App's and the swap's.
function renderAllowances(): void {
  const found = allowancesLeft();
  for (const place of $$(".allowances"))
    list(
      place,
      "allowance",
      found ?? [],
      ({ token, spender }) => `${token}${spender}`,
      (row, allowance) => {
        const token = allowances?.tokens?.get(key(allowance.token));
        const swapper = SWAPPERS.find(({ address }) => same(address, allowance.spender))!;
        fill(row, {
          words: `${token?.symbol ?? allowance.token} ${token ? figure(allowance.amount, token.decimals) : allowance.amount} · ${swapper.symbol} swapper`,
          button: "Reset",
        });
        $("button", row).onclick = () => void resetReview([allowance]);
      },
    );
  $("#reset-all").hidden = (found?.length ?? 0) < 2;
}

// approve(swapper, amount), and its reset to nothing.
function approveSlip(token: Token, swapper: Swapper, amount: bigint): Slip {
  const amountWords = `${figure(amount, token.decimals)} ${token.symbol}`;
  return {
    ...approve(token.address, swapper.address, amount),
    title: amount ? "Token approval" : "Token approval reset",
    says: amount
      ? `Let the ${swapper.symbol} swapper take ${amountWords} from you`
      : `Reset ${token.symbol}'s approval of the ${swapper.symbol} swapper`,
    on: `The ${token.symbol} token contract`,
    call: "approve",
    fields: [
      { label: "Spender", code: swapper.address, description: `The ${swapper.symbol} swapper` },
      { label: "Amount", code: `${amount}`, description: amount ? amountWords : "Nothing" },
    ],
  };
}
const symbolOf = (tokens: Map<string, Token>, address: Address) => tokens.get(key(address))?.symbol ?? address;
// "ZORA → WETH → USDC via Aerodrome, Uniswap": no pool addresses, as the wallet shows none.
const hopsWords = (route: Route, tokens: Map<string, Token>) =>
  `${[route.token, ...route.hops.map(({ tokenOut }) => tokenOut)].map((token) => symbolOf(tokens, token)).join(" → ")} via ${[...new Set(route.hops.map(venueOf))].join(", ")}`;
// The swap, with a deadline and skip-failed: a route under its minimum is skipped, its token kept.
function swapSlip(
  swapper: Swapper,
  routes: Route[],
  deadline: bigint,
  tokens: Map<string, Token>,
  tip: bigint | undefined,
  whole = false,
): Slip {
  const least = routes.reduce((total, { minPaid }) => total + minPaid, 0n);
  const sold = new Set(routes.map(({ token }) => key(token))).size;
  const together = (text: string) => text.replaceAll(" ", " ");
  return {
    ...swapCall(swapper, routes, deadline),
    ...(tip !== undefined && { tip }),
    title: `Swap into ${swapper.symbol}`,
    says: `Sell ${sold === 1 ? "1 token" : `${sold} tokens`} for at least ${figure(least, swapper.decimals)} ${swapper.symbol}`,
    on: `The ${swapper.symbol} swapper`,
    call: "swap",
    fields: [
      ...routes.map((route, i) => {
        const token = tokens.get(key(route.token));
        const amount = whole
          ? `All your ${symbolOf(tokens, route.token)} (up to what this approves)`
          : together(token ? `${figure(route.amount, token.decimals)} ${token.symbol}` : `${route.amount}`);
        const between = route.hops.slice(0, -1).map(({ tokenOut }) => symbolOf(tokens, tokenOut));
        const path = [
          amount,
          ...between,
          together(`${figure(route.minPaid, swapper.decimals)}+ ${swapper.symbol}`),
        ].join(" → ");
        return {
          label: routes.length === 1 ? "Route" : `Route ${i + 1}`,
          words: `${path} via ${[...new Set(route.hops.map(venueOf))].join(", ")}`,
        };
      }),
      { label: "Deadline", code: `${deadline}`, description: utc(Number(deadline)) },
      { label: "Skip failed", code: "true", description: "A route under its minimum is skipped." },
    ],
  };
}

export async function resetReview(these: Allowance[]): Promise<void> {
  const { connection } = session;
  if (!connection || !these.length) return;
  const tokens = await tokensOf(these.map(({ token }) => token));
  const title = these.length === 1 ? "Reset an approval" : `Reset ${these.length} approvals`;
  openReview({
    name: title,
    steps: these.map(({ token, spender }) =>
      approveSlip(
        tokens.get(key(token)) ?? { address: token, decimals: 0, symbol: token },
        SWAPPERS.find(({ address }) => same(address, spender))!,
        0n,
      ),
    ),
    checkHref: hrefOf({ view: "swap", output: "usdc", section: "approvals" }),
    connection,
    outcome: "Reset.",
  });
}

// A swap: each route with its minimum, and the approvals it needs. `approve` is what to approve of a token when not what
// its routes sell, as for a whole balance after a claim.
export type Plan = {
  swapper: Swapper;
  items: { token: Token; route: Route; out: bigint; allowance: bigint; approve?: bigint }[];
  margin: bigint;
};
export async function planSteps(plan: Plan, connection: Connection, tokens: Map<string, Token>, whole = false) {
  const safe = !!connection.wallet.propose;
  const found = await costs().catch(() => undefined);
  const deadline = BigInt(now() + (safe ? 86_400 : 1_800));
  const approvals = soldOf(plan.items)
    .filter(({ total, allowance, approve }) => approve !== undefined || allowance < total)
    .map(({ token, total, approve }) => approveSlip(token, plan.swapper, approve ?? total));
  const swaps = split(plan.items.map(({ route }) => route));
  const slips = [
    ...approvals,
    ...swaps.map((group) => swapSlip(plan.swapper, group, deadline, tokens, safe ? undefined : found?.tip, whole)),
  ];
  return { approvals, swaps, slips };
}

async function reviewSwap(): Promise<void> {
  const scanned = scan;
  const { connection } = session;
  if (!connection || !scanned || !tickedOf(scanned).length || swapsOff() || isBusy(reviewButton)) return;
  busy(reviewButton);
  failure = "";
  try {
    await routeTicked(scanned);
    const found = togetherFor(scanned);
    const plan: Plan = {
      swapper: scanned.swapper,
      margin: margin(),
      items: tickedOf(scanned).flatMap((row) =>
        partsOf(row, found).map(({ route, out = (row.found!.out * route.amount) / row.amount }) => ({
          token: row.token,
          route: { ...route, minPaid: minimumOf(out, margin()) },
          out,
          allowance: row.allowance,
        })),
      ),
    };
    failure = (await openSwapReview(plan, connection, scanned.tokens, scanned.costs, scanned.prices)) ?? "";
  } catch (error) {
    console.error(error);
    failure = "Checking the swap failed. Nothing was sent.";
  } finally {
    busy(reviewButton, false);
    renderSwap();
  }
}

// The routes run through Base first, in order, with no minimum: each minimum is what Base found, less the slippage, and a
// route that would not go through even so is left out. Returns why the review did not open.
export async function openSwapReview(
  plan: Plan,
  connection: Connection,
  tokens: Map<string, Token>,
  found?: Costs,
  prices?: Prices,
): Promise<string | undefined> {
  const { swapper } = plan;
  const zeroed = plan.items.map((item) => ({ ...item, route: { ...item.route, minPaid: 0n } }));
  const tried = await planSteps({ ...plan, items: zeroed }, connection, tokens);
  let simulated = await simulate(connection.address, tried.slips).catch((error: unknown) => void console.error(error));
  const refused = simulated?.findIndex(({ ok }) => !ok) ?? -1;
  if (refused >= 0)
    return refused < tried.approvals.length
      ? `Base refused “${tried.slips[refused]!.says}” Nothing was sent.`
      : "Base refused the swap: the quotes may have moved. Nothing was sent.";
  const results = routeResults(simulated || undefined, tried.approvals.length, tried.swaps);
  if (!results) simulated = undefined;
  const items = plan.items.map((item, i) => {
    const result = results?.get(zeroed[i]!.route);
    const { out, reason }: { out: bigint; reason?: string } = !result
      ? { out: item.out }
      : result.done && result.amountOut > 0n
        ? { out: result.amountOut }
        : { out: 0n, reason: result.done ? "a pool gave nothing for it" : reasonOf(result.reason) };
    return {
      item: {
        ...item,
        out,
        route: { ...item.route, minPaid: simulated ? minimumOf(out, plan.margin) : item.route.minPaid },
      },
      reason,
    };
  });
  const going = items.flatMap(({ item, reason }) => (reason ? [] : [item]));
  if (!going.length) return "Base would skip every token: none can be swapped now. Nothing was sent.";
  const { approvals, swaps, slips } = await planSteps({ ...plan, items: going }, connection, tokens);
  if (simulated && going.length < items.length) {
    const again = await simulate(connection.address, slips).catch(() => undefined);
    simulated = again?.every(({ ok }) => ok) ? again : simulated;
  }
  const quoted = new Map<string, bigint>();
  for (const { token, out } of going) quoted.set(key(token.address), (quoted.get(key(token.address)) ?? 0n) + out);
  const quote = $("#quote");
  const { exact, cents } = figures(swapper, prices);
  list(
    $(".lines-list", quote),
    "line",
    items,
    (entry) => `${items.indexOf(entry)}`,
    (line, { item, reason }) => {
      const under = reason ? undefined : underPrice(item.token, item.route.amount, item.out, swapper, prices);
      fill(line, {
        symbol: item.token.symbol,
        amount: figure(item.route.amount, item.token.decimals),
        fetches: reason ? "Skipped" : exact(item.out),
        worth: reason ? "" : cents(item.out),
        route: hopsWords(item.route, tokens),
        warning: reason ? `Skipped: ${reason}` : under === undefined ? "" : `${fraction(under)} under price`,
        button: "",
      });
    },
  );
  const out = going.reduce((total, { out }) => total + out, 0n);
  const gas = simulated
    ? simulated.reduce((total, { gas }) => total + gas, 0n)
    : BigInt(approvals.length) * APPROVAL_GAS + swapGas(going.map(({ route }) => route));
  bill(
    quote,
    { out, least: going.reduce((total, { route }) => total + route.minPaid, 0n), gas },
    swapper,
    prices,
    found,
  );
  fill(quote, {
    output: swapper.symbol,
    slippage: `Minimum at ${bps(plan.margin)} slippage`,
    simulated: simulated ? "" : "Not simulated: these are quotes.",
  });
  openReview({
    name: `Swap into ${swapper.symbol}`,
    intro: { kind: "swap", title: "Quote" },
    steps: slips,
    checkHref: hrefOf({ view: "swap", output: swapper.output, section: "check" }),
    connection,
    atomic: true,
    // One prompt at a time, the page quotes again before each swap, with a fresh deadline and the same minimums.
    prepare: async (i) => {
      const group = swaps[i - approvals.length];
      if (!group) return undefined;
      const deadline = BigInt(now() + 1_800);
      const fresh = await freshResults(connection.address, swapper, group, deadline);
      const under = group.filter((route, j) => !fresh[j]?.done || paidOf(fresh[j]!.amountOut) < route.minPaid);
      const step = swapSlip(swapper, group, deadline, tokens, found?.tip);
      return {
        step,
        ...(under.length && {
          changed: `The quotes moved: ${words(under.map((route) => symbolOf(tokens, route.token)))} will be kept.`,
        }),
      };
    },
    finish: async (receipts) => {
      const hashes = receipts.map(({ transactionHash }) => transactionHash);
      const block = receipts.at(-1)?.blockNumber;
      const [paidGas, at] = await Promise.all([
        gasPaid(hashes, connection.address),
        block ? timeOf(Number(block)).catch(() => undefined) : undefined,
      ]);
      $("#receipts").append(
        swapReceipt(receipts, { ...plan, items: going }, tokens, connection.address, prices, {
          quoted,
          gas: paidGas,
          time: at,
        }),
      );
    },
  });
  return undefined;
}

// Each route alone now, its approvals given; or as quoted, when Base cannot say or a token refused the transfer.
async function freshResults(
  from: Address,
  swapper: Swapper,
  group: Route[],
  deadline: bigint,
): Promise<(Result | undefined)[]> {
  const zeroed = group.map((route) => ({ ...route, minPaid: 0n }));
  const [run] = await simulate(from, [swapCall(swapper, zeroed, deadline)]).catch(() => []);
  const results = routeResults(run ? [run] : undefined, 0, [zeroed]);
  const found = zeroed.map((route) => results?.get(route));
  if (results && found.every((result) => result && (result.done || !refusedTransfer(result.reason)))) return found;
  return quoteAll(zeroed.map((route) => ({ swapper, route })));
}

// A bill from the template: each line a label, a value, and what it is worth under it.
export function receiptOf(
  label: string,
  day: Value,
  lines: [string, Value, Value?][],
  total: [string, Value, Value?][],
  note: Value = "",
): HTMLElement {
  const receipt = clone("receipt");
  fill(receipt, { label, day, note });
  const [main, sum] = $$("dl", receipt);
  for (const [place, rows] of [
    [main!, lines],
    [sum!, total],
  ] as const)
    list(
      place,
      "bill-line",
      rows,
      ([name]) => name,
      (row, [name, value, detail = ""]) => fill(row, { label: name, value, detail }),
    );
  return receipt;
}

// The swap's receipt: when, the gas, each token sold and how it compares with the quote, then what reached you. A token
// skipped stays with its approval, which it offers to reset.
export function swapReceipt(
  receipts: Receipt[],
  plan: Plan,
  tokens: Map<string, Token>,
  caller: Address,
  prices?: Prices,
  {
    quoted,
    gas,
    time: at = now(),
  }: { quoted?: Map<string, bigint>; gas?: bigint | undefined; time?: number | undefined } = {},
): HTMLElement {
  const { swapper } = plan;
  const { exact, worth, cents, shown } = figures(swapper, prices);
  const { swapped, failed, paid } = swappedIn(receipts, swapper, caller);
  const fetched = swapped.reduce((total, { amountOut }) => total + amountOut, 0n);
  const gasCost = gas === undefined ? undefined : ethCost(gas, prices);
  const [outWorth, paidWorth] = [worth(fetched), worth(paid)];
  const receipt = receiptOf(
    `Receipt · swap into ${swapper.symbol}`,
    `${utc(at)}${gas === undefined ? "" : ` · gas ${figure(gas, 18)} ETH${gasCost ? ` (${money(gasCost, true)})` : ""}`}`,
    [
      ["Fetched", exact(fetched), cents(fetched)],
      [
        "Swap fee",
        exact(shown(paid) - shown(fetched)),
        outWorth && paidWorth ? money(between(outWorth, paidWorth), true) : "",
      ],
    ],
    [["Paid to you", exact(paid), cents(paid)]],
  );
  const sold = new Map<string, { token: Address; amountIn: bigint; amountOut: bigint }>();
  for (const { token, amountIn, amountOut } of swapped) {
    const each = sold.get(key(token)) ?? { token, amountIn: 0n, amountOut: 0n };
    each.amountIn += amountIn;
    each.amountOut += amountOut;
    sold.set(key(token), each);
  }
  const skipped = [...new Map(failed.map((each) => [key(each.token), each])).values()];
  const lines = [
    ...[...sold.values()].map((each) => ({ ...each, reason: undefined as string | undefined })),
    ...skipped.map(({ token, reason }) => ({ token, amountIn: 0n, amountOut: 0n, reason: reasonOf(reason) })),
  ];
  list(
    $(".lines-list", receipt),
    "line",
    lines,
    ({ token, reason }) => `${key(token)}${reason ? " kept" : ""}`,
    (line, { token, amountIn, amountOut, reason }) => {
      const described = tokens.get(key(token));
      const planned = plan.items
        .filter((each) => same(each.token.address, token))
        .reduce((total, { route }) => total + route.amount, 0n);
      const quote = quoted?.get(key(token));
      const tenths = quote && planned === amountIn ? Number(((amountOut - quote) * 1000n) / quote) : undefined;
      fill(line, {
        symbol: described?.symbol ?? token,
        amount: reason ? "kept" : described ? figure(amountIn, described.decimals) : `${amountIn}`,
        fetches: reason ? "" : exact(amountOut),
        worth: reason ? "" : cents(amountOut),
        route:
          tenths === undefined
            ? ""
            : tenths
              ? `${tenths > 0 ? "+" : "−"}${(Math.abs(tenths) / 10).toFixed(1)}% vs quote`
              : "As quoted",
        warning: reason ?? "",
        button: reason ? "Reset its approval" : "",
      });
      $("button", line).hidden = !reason;
      $("button", line).onclick = () => void resetReview([{ token, spender: swapper.address, amount: 1n }]);
    },
  );
  return receipt;
}

export function initSwap(): void {
  $("#outputs").replaceChildren(
    ...SWAPPERS.map(({ output: value, symbol }) => {
      const label = document.createElement("label");
      const input = Object.assign(document.createElement("input"), { type: "radio", name: "output", value });
      input.onchange = () => (location.hash = hrefOf({ view: "swap", output: value }));
      label.append(
        input,
        " ",
        Object.assign(document.createElement("code"), { textContent: symbol, translate: false }),
      );
      return label;
    }),
  );
  $("#margin").onchange = renderSwap;
  reviewButton.onclick = () => void reviewSwap();
  $(".again", tokensBox).onclick = walletChanged;
  $("#reset-all").onclick = () => void resetReview(allowancesLeft() ?? []);
  const input = $<HTMLInputElement>("#add-address");
  $("#add").onclick = async () => {
    const text = input.value.trim();
    const say = (words: string) => {
      $("#add-failed").textContent = words;
      input.setAttribute("aria-invalid", String(!!words));
    };
    if (!/^0x[0-9a-fA-F]{40}$/.test(text)) return say("That is not an address.");
    const found = await tokensOf([text as Address]).catch(() => new Map());
    if (!found.size) return say("No token at that address on Base.");
    say("");
    know([text as Address]);
    input.value = "";
    rescanNow();
  };
  onRoute((next) => {
    const owner = session.connection?.address;
    if (next.view === "swap" && owner && (!scan || scan.swapper.output !== next.output || !same(scan.owner, owner)))
      void startScan(owner, output());
  });
  closed.push((submitted) => submitted && walletChanged());
}
