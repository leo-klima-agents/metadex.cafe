import { maxUint256, type Address } from "viem";
import { gasPaid, includedAt, now, readFor, same, type Receipt } from "../chain.ts";
import { AUTOMATIONS, DEFAULT_OUTPUT, HYDX, SWAPPERS, swapperOf, type Swapper } from "../config.ts";
import { PENDING, busy, clone, fill, fillAddress, pendWorth, setText, show, showWorth, showWorthIn } from "../dom.ts";
import { tokensOf } from "../earnings.ts";
import {
  between,
  bps,
  figure,
  fixed,
  fraction,
  list,
  money,
  moneyAt,
  rounded,
  short,
  utc,
  type Money,
} from "../format.ts";
import { earningsOf, onEarnings } from "../last-epoch.ts";
import { pricesIn, pricesNow, worthOf, type Prices, type Token } from "../prices.ts";
import type { Amount } from "../receipts.ts";
import { checks } from "./automations.ts";
import { views } from "./page.ts";
import { openReview, type Hooks, type ReviewPage, type Slip } from "./review.ts";
import { routeTogether, type Sale } from "../routing.ts";
import { hrefOf, type Route as PageRoute } from "../routes.ts";
import {
  APPROVAL_GAS,
  MIDDLES,
  feeOf,
  findRoute,
  minimumOf,
  paidOf,
  quoteAll,
  reasonOf,
  refusedTransfer,
  routeResults,
  runInOrder,
  simulate,
  soldOf,
  split,
  swapCall,
  swapGas,
  swappedIn,
  type Found,
  type Result,
  type Route,
} from "../swap.ts";
import { approveSlip, costs, ethCost, gasCost, hopsWords, swapSlip, type Costs } from "../swap-calls.ts";
import {
  allowancesOf,
  describe,
  holdingsOf,
  isHydrex,
  know,
  known,
  lookalike,
  type Allowance,
  type Listed,
} from "../tokens.ts";
import { onRoute, route } from "./router.ts";
import { walletAssets, type Connection } from "../wallet.ts";

// The swap's page, `#swap`: the output first, then the wallet's tokens, each with its route and what it fetches, then
// what the ticked ones fetch together, and the review. The App's line on the swap and its leftover approvals come from
// here too.

const view = document.querySelector<HTMLElement>('.view[data-view="swap"]')!;
const summary = view.querySelector<HTMLElement>(".swap-summary")!;
const rowsList = view.querySelector<HTMLElement>(".swap-rows")!;
const status = view.querySelector<HTMLElement>(".swap-status")!;
const reviewButton = view.querySelector<HTMLButtonElement>(".swap-review")!;
const reviewFailed = view.querySelector<HTMLElement>(".swap-review-failed")!;
const marginSelect = view.querySelector<HTMLSelectElement>(".swap-margin")!;
const allowanceList = view.querySelector<HTMLElement>(".allowances")!;

// A quote more than this far under the page's own price says so: the swapper's sources ask holders to check quotes
// through Hydrex's Algebra and Aero's Slipstream pools against another price.
const CHECK = 0.02;
// A token is ticked by default only when its quote clears its gas twice over.
const CLEARS = 2;
const WORKERS = 3;

type Row = {
  token: Token;
  like?: Listed | undefined;
  balance: bigint;
  allowance: bigint;
  amount: bigint;
  // Its price per whole token, by the page's own prices, if it has one.
  price?: number | undefined;
  // undefined until its routes are read; null when the swapper has none.
  found?: Found | null;
  failed: boolean;
  // What its quote is worth at those prices, and why it is not ticked by default.
  worth?: number | undefined;
  reason?: string | undefined;
  ticked: boolean;
  touched: boolean;
  node: HTMLElement;
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
  done: number;
};

export type SwapContext = { connection(): Connection | undefined; hooks: Hooks };
let context: SwapContext;
// The swap's own reads, which go first on its page and wait their turn elsewhere. A review's are always the page's own.
const swapReads = readFor("swap");
let scans = 0;
let scan: Scan | undefined;
// The payout's tokens and amounts to tick, for the visit.
let prefilled: Map<string, bigint> | undefined;
// Whether a scan under way should be followed by another, as when new tokens became known meanwhile.
let rescan = false;
let allowances: Allowance[] | undefined;
let allowancesOwner: Address | undefined;
let allowanceReads = 0;
const listeners: (() => void)[] = [];

// The ticked tokens' routes, found together, for the tokens and amounts `key` names: each token's parts, and what each
// fetches when Base runs them all in order, after the approvals they need; undefined for a part that would not go
// through. Without Base's answer, they are the tokens' own routes and quotes. And the routes being found.
type Part = { route: Route; out: bigint | undefined };
type Together = { key: string; parts: Map<string, Part[]>; gas: bigint | undefined };
let together: Together | undefined;
let routing: { key: string; done: Promise<void> } | undefined;
let routeLater: ReturnType<typeof setTimeout> | undefined;
// While Review checks the swap, its button waits, whatever is drawn meanwhile.
let reviewing = false;
// Ticking several tokens in a row starts one search, once they settle.
const SETTLE = 400;

const key = (address: string): string => address.toLowerCase();
const margin = (): bigint => BigInt(marginSelect.value);
const swapperShown = (): Swapper => {
  const shown = route();
  return swapperOf(shown.view === "swap" ? shown.output : DEFAULT_OUTPUT)!;
};
// Whether the page's RPCs serve Base, once the checks have read it. The swappers are immutable, so nothing else about
// them can change: until this is read, and unless it holds, no swap is offered.
const onBase = (): boolean | undefined =>
  checks.value && ![...checks.value.failed.values()].some((failed) => failed.includes("chain"));
export const swapsOff = (): boolean => onBase() !== true;
const tell = (): void => listeners.forEach((listener) => listener());

// Called once something the App shows from here changes: the swap's line, or the approvals left.
export const onSwapChange = (listener: () => void): void => void listeners.push(listener);

// The App's line on the swap: how many tokens are worth swapping, and what they would fetch, once read, or so far.
export function swapLine(): { count: number; worth: Money; reading: boolean; failed: boolean } | undefined {
  if (!scan) return undefined;
  const worth = scan.rows.filter((row) => row.found && !row.reason);
  const value = worth.reduce((sum, row) => sum + (row.worth ?? 0), 0);
  return { count: worth.length, worth: moneyAt(value, scan.prices), reading: scan.reading, failed: scan.failed };
}

// The wallet's approvals left, once read: none while those read are another account's, as after the wallet switched.
export const allowancesLeft = (): Allowance[] | undefined => {
  const owner = context.connection()?.address;
  return owner && same(allowancesOwner ?? "", owner) ? allowances : undefined;
};

// The payout's tokens and amounts, to tick on the swap's page.
export function prefill(amounts: Amount[]): void {
  prefilled = new Map(amounts.map(({ token, amount }) => [key(token), amount]));
  know(amounts.map(({ token }) => token));
  const owner = context.connection()?.address;
  if (owner) void startScan(owner, swapperShown());
}

// A sum at the page's prices, in the output's own units, if it has a price.
function inOutput(value: number, scanned: Scan): bigint | undefined {
  const price = scanned.prices.of.get(key(scanned.swapper.token));
  if (!price) return undefined;
  return BigInt(Math.floor((value / price) * 10 ** scanned.swapper.decimals));
}

// What `gas` costs in the output, at the scan's prices: nothing without them.
const gasValueIn = (scanned: Scan) => (gas: bigint) => {
  const cost = scanned.costs && gasCost(gas, scanned.costs, scanned.prices);
  return cost ? (inOutput(cost.value, scanned) ?? 0n) : 0n;
};

const tickedOf = (scanned: Scan): Row[] => scanned.rows.filter((row) => row.ticked && row.found);
const tickedKey = (scanned: Scan, ticked: Row[]): string =>
  `${scanned.id} ${ticked.map((row) => `${key(row.token.address)}:${row.amount}`).join(" ")}`;

// The ticked tokens' routes found together, if found for these tokens and amounts.
function togetherFor(scanned: Scan, ticked = tickedOf(scanned)): Together | undefined {
  return together?.key === tickedKey(scanned, ticked) ? together : undefined;
}

// A ticked row's parts, as found together, or else its own route and quote.
function partsOf(row: Row, found: Together | undefined): Part[] {
  return (
    found?.parts.get(key(row.token.address)) ?? [
      { route: { ...row.found!.route, amount: row.amount, minPaid: 0n }, out: row.found!.out },
    ]
  );
}

// What a row fetches: as found together, while it is ticked and they are; or else its own quote. Undefined without a
// route, or if Base found none of its parts would go through.
function fetchesOf(row: Row, scanned: Scan): bigint | undefined {
  if (!row.found) return undefined;
  const parts = partsOf(row, row.ticked ? togetherFor(scanned) : undefined);
  if (parts.every(({ out }) => out === undefined)) return undefined;
  return parts.reduce((sum, { out }) => sum + (out ?? 0n), 0n);
}

const outputValue = (amount: bigint, scanned: Scan): number | undefined => {
  const price = scanned.prices.of.get(key(scanned.swapper.token));
  return price === undefined ? undefined : worthOf(amount, scanned.swapper.decimals, price);
};

// How many decimal places the output's amounts take, all of them alike, so that they line up at the point: enough to
// show each to the cent at the output's price, 2 for USDC, 6 for WETH; without a price, the output's own.
function placesOf(swapper: Swapper, price: number | undefined): number {
  const places = price ? Math.ceil(Math.log10(price) + 2 - 0.05) : swapper.places;
  return Math.min(swapper.decimals, Math.max(2, places));
}

// How the output's amounts show: exactly, to the places of all of them, with its symbol; and what each is worth at the
// prices, if they price the output.
function outputFigures(swapper: Swapper, prices: Prices | undefined) {
  const price = prices?.of.get(key(swapper.token));
  const places = placesOf(swapper, price);
  return {
    exact: (amount: bigint) => `${fixed(amount, swapper.decimals, places)} ${swapper.symbol}`,
    worth: (amount: bigint): Money | undefined =>
      price === undefined ? undefined : moneyAt(worthOf(amount, swapper.decimals, price), prices!),
    // An amount as it shows, so that what lies between two can show too.
    shown: (amount: bigint) => rounded(amount, swapper.decimals, places),
  };
}

// A sum, to the cent, so that a column of them lines up at the point.
const inCents = (sum: Money | undefined) => sum && (() => money(sum, { cents: true }));

// An amount of the output, exactly, then what it is worth, in an element of its own.
function showOutput(elements: [Element, Element], amount: bigint, swapper: Swapper, prices: Prices | undefined): void {
  const { exact, worth } = outputFigures(swapper, prices);
  showWorthIn(...elements, exact(amount), inCents(worth(amount)));
}

// A swap's figures, as the summary and the bill both show them, each as a quote, what it is worth under it: what it
// fetches, in the element `fetched` names, the 1%, what reaches you, the least that may, and the gas, in the ETH that pays
// it; without the gas price, in gas. The 1% shows as what lies between the two around it, as they show, so that the
// bill adds up as it reads.
function showBill(
  root: ParentNode,
  fetched: string,
  { out, fee, least, gas }: { out: bigint; fee: bigint; least: bigint; gas: bigint },
  swapper: Swapper,
  prices: Prices | undefined,
  found: Costs | undefined,
): void {
  const part = (name: string) => root.querySelector(`.${name}`)!;
  const { exact, worth, shown } = outputFigures(swapper, prices);
  const paid = out - fee;
  const [outWorth, paidWorth] = [worth(out), worth(paid)];
  showWorth(part(fetched), exact(out), inCents(outWorth));
  showWorth(part("swap-fee"), exact(shown(paid) - shown(out)), inCents(outWorth && between(outWorth, paidWorth!)));
  showWorth(part("swap-paid"), exact(paid), inCents(paidWorth));
  showWorth(part("swap-least"), exact(least), inCents(worth(least)));
  if (!found) return void fill(root, { "swap-gas": `${gas.toLocaleString("en-GB")} gas` });
  const wei = gas * found.gasPrice;
  showWorth(part("swap-gas"), `${figure(wei, 18)} ETH`, inCents(ethCost(wei, prices)));
}

// Whether a row is worth its gas, and why not, in words.
function judge(row: Row, scanned: Scan): void {
  const { found } = row;
  if (row.failed) {
    row.reason = "Not read";
    return;
  }
  if (found === undefined) return;
  if (found === null) {
    row.reason = "No route";
    return;
  }
  row.worth =
    outputValue(found.out, scanned) ??
    (row.price === undefined ? undefined : worthOf(row.amount, row.token.decimals, row.price));
  const gas = found.gas + (row.allowance < row.amount ? APPROVAL_GAS : 0n);
  const cost = scanned.costs ? (gasCost(gas, scanned.costs, scanned.prices)?.value ?? 0) : 0;
  row.reason = row.worth === undefined ? "No price" : row.worth < CLEARS * cost ? "Below gas" : undefined;
}

// Whether a quoted row ticks itself, unless ticked by hand: worth swapping, and among a payout's tokens when the page
// opened for one.
const ticksItself = (row: Row): boolean =>
  !!row.found && !row.reason && (!prefilled || prefilled.has(key(row.token.address)));

// A quoted row's rank in the list: by what its quote is worth, those not worth swapping last.
const worthFirst = (row: Row): number => (row.reason || row.worth === undefined ? -1 : row.worth);

function drawRow(row: Row, scanned: Scan): void {
  const { node, token, found } = row;
  const box = node.querySelector<HTMLInputElement>(".pick")!;
  box.checked = row.ticked;
  box.disabled = !found;
  box.ariaLabel = `Sell ${token.symbol}`;
  const { swapper } = scanned;
  fill(node, {
    "swap-symbol": token.symbol,
    "swap-amount": figure(row.amount, token.decimals),
  });
  const quote = [node.querySelector(".swap-fetches")!, node.querySelector(".swap-worth")!] as [Element, Element];
  const fetches = fetchesOf(row, scanned);
  const routing = found === undefined && !row.failed;
  // While its route is found, its quote keeps the place of both its lines.
  if (fetches !== undefined) showOutput(quote, fetches, swapper, scanned.prices);
  else showWorthIn(...quote, routing ? PENDING : "");
  // Only why a token is not ticked, or that Base would skip it among the others: the route itself is in the review.
  const skipped = !!found && fetches === undefined;
  setText(node.querySelector(".swap-route")!, row.reason ?? (skipped ? "Base would skip it" : ""));
  show(".swap-lookalike", !!row.like, node);
  if (row.like) fill(node, { "swap-like": row.like.symbol });
  // A quote far under the page's own price says so, with both.
  const under =
    row.reason || fetches === undefined ? undefined : underPrice(token, row.amount, fetches, swapper, scanned.prices);
  show(".swap-check", under !== undefined, node);
  if (under !== undefined) fill(node, { "swap-check-words": `Quote ${fraction(under)} under price` });
  fillAddress(node, "swap-address", token.address, short(token.address));
}

function drawAll(): void {
  const signedIn = !!context.connection();
  // Without a wallet, the outputs show, and the tokens' list offers the wallets to connect.
  show(".swap-approvals-open", signedIn, view);
  const swapper = swapperShown();
  for (const input of view.querySelectorAll<HTMLInputElement>('input[name="output"]')) {
    input.checked = swapperOf(input.value) === swapper;
    input.disabled = onBase() === false;
    show(".output-off", input.disabled, input.closest("label")!);
  }
  show(".swap-off", onBase() === false, view);
  if (!scan || !signedIn) {
    status.hidden = summary.hidden = true;
    show(".swap-failed, .swap-none, .add-token", false, view);
    return void fill(view, { "swap-ticked": "" });
  }
  summary.hidden = false;
  const scanned = scan;
  show(".swap-failed", scanned.failed, view);
  // A token to add by its address is offered only when the page found none to sell.
  show(".swap-none, .add-token", !scanned.reading && !scanned.failed && !scanned.rows.length, view);
  const total = scanned.rows.length;
  // Only until the wallet's tokens show: then each row says that its route is being found, and nothing moves once all
  // are.
  status.hidden = !scanned.reading || total > 0;
  const ticked = scanned.rows.filter((row) => row.ticked && row.found);
  fill(view, { "swap-ticked": total ? `· ${ticked.length} of ${total}` : "" });
  summarise(scanned, ticked);
}

// The bill's figures, each an amount and what it is worth.
const BILL = ["swap-quoted", "swap-fee", "swap-paid", "swap-least", "swap-gas"];

// What the ticked tokens fetch together, row by row: the quote, less the 1%, is what reaches you, and the slippage picked
// sets the least that may. Gas is paid apart, in ETH. Each in tokens, then what it is worth. Until their routes are
// found together, and run through Base in order, each token's own quote, which the bar says.
function summarise(scanned: Scan, ticked: Row[]): void {
  const { swapper } = scanned;
  const sells = view.querySelector<HTMLElement>(".swap-sells")!;
  const breakdown = view.querySelector<HTMLElement>(".breakdown")!;
  const splitLine = view.querySelector<HTMLElement>(".swap-split")!;
  reviewButton.disabled = !ticked.length || swapsOff() || reviewing;
  // Until the page has read that its RPCs serve Base, which is soon, the button waits, and says why.
  show(".swap-checking", !!ticked.length && onBase() === undefined, view);
  // While the wallet's tokens are quoted, those worth swapping tick themselves: until one does, the bill keeps its place,
  // unless the owner ticked or unticked one already.
  const waiting = !ticked.length && scanned.reading && !scanned.failed && !scanned.rows.some((row) => row.touched);
  sells.hidden = ticked.length > 0 || waiting;
  breakdown.hidden = !ticked.length && !waiting;
  const found = togetherFor(scanned, ticked);
  const waits = !!ticked.length && !found && !scanned.reading && !swapsOff();
  show(".swap-routing", waits, view);
  if (waiting) for (const name of BILL) pendWorth(breakdown.querySelector(`.${name}`)!);
  if (!ticked.length) return void (splitLine.hidden = true);
  if (waits) routeSoon(scanned);
  const parts = ticked.flatMap((row) => partsOf(row, found));
  const going = parts.flatMap(({ out }) => (out === undefined ? [] : [out]));
  const out = going.reduce((sum, each) => sum + each, 0n);
  const least = going.reduce((sum, each) => sum + minimumOf(each, margin()), 0n);
  const fee = going.reduce((sum, each) => sum + feeOf(each), 0n);
  const routes = parts.map(({ route }) => route);
  const approvals = ticked.filter((row) => row.allowance < row.amount).length;
  const swaps = split(routes).length;
  const gas = found?.gas ?? BigInt(approvals) * APPROVAL_GAS + swapGas(routes);
  const { costs, prices } = scanned;
  showBill(breakdown, "swap-quoted", { out, fee, least, gas }, swapper, prices, costs);
  splitLine.hidden = swaps < 2;
  splitLine.textContent = `${swaps} swaps`;
}

// Finds the ticked tokens' routes together, once the ticks settle.
function routeSoon(scanned: Scan): void {
  if (routing?.key === tickedKey(scanned, tickedOf(scanned))) return;
  clearTimeout(routeLater);
  routeLater = setTimeout(() => void routeTicked(scanned), SETTLE);
}

// The ticked tokens' routes, together: each token's own, or in parts through other pools if the router finds that
// better, whichever fetches more, net of gas, when Base runs them in order. A search for other tokens or amounts, or
// another scan, takes over.
function routeTicked(scanned: Scan): Promise<void> {
  const ticked = tickedOf(scanned);
  const id = tickedKey(scanned, ticked);
  if (!ticked.length || togetherFor(scanned, ticked)) return Promise.resolve();
  if (routing?.key === id) return routing.done;
  clearTimeout(routeLater);
  const { swapper, owner } = scanned;
  const gasValue = gasValueIn(scanned);
  const allowance = (token: Address) => ticked.find((row) => same(row.token.address, token))?.allowance ?? 0n;
  const runOf = (plan: Route[][]) => runInOrder(owner, swapper, plan.flat(), allowance);
  const find = async (): Promise<Omit<Together, "key">> => {
    const sales: Sale[] = ticked.map((row) => ({
      token: row.token.address,
      amount: row.amount,
      found: row.found!,
      hydrex: isHydrex(row.token.address),
    }));
    const own = ticked.map((row) => partsOf(row, undefined).map(({ route }) => route));
    // The tokens' own routes run through Base while the router looks for others.
    const [ownRun, parted] = await Promise.all([
      runOf(own),
      routeTogether(sales, swapper, gasValue).catch((error: unknown) => {
        console.error(error);
        return undefined;
      }),
    ]);
    const plans = parted ? [own, parted] : [own];
    const runs = [ownRun, parted && (await runOf(parted))];
    const net = runs.map((run) =>
      run
        ? run.results.reduce((sum, result) => sum + (result?.done ? result.amountOut : 0n), 0n) - gasValue(run.gas)
        : undefined,
    );
    const chosen = net[1] !== undefined && (net[0] === undefined || net[1] > net[0]) ? 1 : 0;
    const run = runs[chosen];
    const results = run?.results ?? [];
    let next = 0;
    const parts = new Map(
      ticked.map((row, i) => [
        key(row.token.address),
        plans[chosen]![i]!.map((route): Part => {
          const result = results[next++];
          // Without Base's answer, the token's own quote.
          const out = run ? (result?.done ? result.amountOut : undefined) : row.found!.out;
          return { route, out };
        }),
      ]),
    );
    return { parts, gas: run?.gas };
  };
  const done = (async () => {
    // Should finding them fail, each token's own route and quote, rather than the search again at each drawing.
    const found = await find().catch((error: unknown) => {
      console.error(error);
      return { parts: new Map(ticked.map((row) => [key(row.token.address), partsOf(row, undefined)])), gas: undefined };
    });
    if (routing?.key !== id || scan !== scanned) return;
    together = { key: id, ...found };
    routing = undefined;
    scanned.rows.forEach((row) => drawRow(row, scanned));
    drawAll();
  })();
  routing = { key: id, done };
  done.catch(console.error).finally(() => {
    if (routing?.key === id) routing = undefined;
  });
  return done;
}

function rowNode(): HTMLElement {
  const node = clone("swap-row").firstElementChild as HTMLElement;
  node.querySelector<HTMLInputElement>(".pick")!.addEventListener("change", (event) => {
    const target = scan?.rows.find((each) => each.node === node);
    if (!target) return;
    target.ticked = (event.target as HTMLInputElement).checked;
    target.touched = true;
    scan!.rows.forEach((row) => drawRow(row, scan!));
    drawAll();
  });
  return node;
}

// Reads the wallet's tokens, their prices, and each one's route into the output, the ticked and the most valuable
// first. Another scan, as of another output, takes over. With `quoted`, as when more tokens became known, the wallet
// holds what it held: its rows stay as they are until the new scan knows its tokens, so that nothing moves meanwhile,
// and those it holds the same amount of keep their quotes, so that only the others are quoted. Otherwise, as after a
// swap, the rows go at once, so that none shows what the wallet may no longer hold.
async function startScan(owner: Address, swapper: Swapper, quoted = false): Promise<void> {
  const id = ++scans;
  const kept = scan && same(scan.owner, owner) && scan.swapper === swapper ? scan : undefined;
  const scanned: Scan = {
    id,
    owner,
    swapper,
    rows: [],
    tokens: new Map(),
    prices: pricesIn("USD"),
    reading: true,
    failed: false,
    done: 0,
  };
  const current = () => scans === id;
  const begin = (): void => {
    scan = scanned;
    rowsList.replaceChildren(...scanned.rows.map(({ node }) => node));
    drawAll();
    tell();
  };
  if (!quoted || !kept) begin();
  try {
    // Hydrex's reward tokens, as last epoch's rewards name them, once read, and the wallet's own list where it offers one.
    knowRewards();
    const connection = context.connection();
    if (connection) know(await walletAssets(connection));
    const tokens = [...new Set(known().map(key))] as Address[];
    const holdings = await holdingsOf(owner, tokens, swapper.address, swapReads);
    const held = tokens.filter((token) => holdings.get(token)!.balance > 0n && !same(token, swapper.token));
    // The tokens routes pass through are named in them, held or not.
    const [described, found] = await Promise.all([
      describe([...held, swapper.token, ...MIDDLES, HYDX]),
      costs().catch(() => undefined),
    ]);
    if (!current()) return;
    scanned.tokens = described;
    scanned.costs = found;
    const amounts = new Map(held.map((token) => [token, holdings.get(token)!.balance]));
    scanned.prices = await pricesNow([...described.values()], amounts, swapReads).catch((error: unknown) => {
      console.error(error);
      return pricesIn("USD");
    });
    if (!current()) return;
    const rows = held.flatMap((address): Row[] => {
      const token = described.get(address);
      if (!token) return [];
      const { balance, allowance } = holdings.get(address)!;
      const asked = prefilled?.get(address);
      const amount = asked !== undefined && asked < balance ? asked : balance;
      const keptRow = kept?.rows.find((row) => same(row.token.address, address) && row.amount === amount);
      const row = {
        token,
        like: lookalike(token),
        balance,
        allowance,
        amount,
        price: scanned.prices.of.get(address),
        failed: false,
        ticked: keptRow?.touched ? keptRow.ticked : false,
        touched: !!keptRow?.touched,
      };
      if (quoted && keptRow && keptRow.found !== undefined && !keptRow.failed) {
        const again: Row = { ...row, found: keptRow.found, node: keptRow.node };
        // Judged again at the new scan's prices and gas: one not ticked by hand ticks itself by them.
        judge(again, scanned);
        if (!again.touched) again.ticked = ticksItself(again);
        scanned.done++;
        return [again];
      }
      return [{ ...row, node: rowNode() }];
    });
    // Those quoted already where they would be once all are; the others by value.
    const value = (row: Row) =>
      row.found !== undefined
        ? worthFirst(row)
        : row.price === undefined
          ? -1
          : worthOf(row.amount, row.token.decimals, row.price);
    rows.sort((a, b) => value(b) - value(a));
    scanned.rows = rows;
    begin();
    rows.forEach((row) => drawRow(row, scanned));
    // The payout's tokens first, then by value.
    const queue = rows
      .filter((row) => row.found === undefined)
      .sort(
        (a, b) => Number(prefilled?.has(key(b.token.address)) ?? 0) - Number(prefilled?.has(key(a.token.address)) ?? 0),
      );
    let next = 0;
    const gasValue = gasValueIn(scanned);
    await Promise.all(
      Array.from({ length: WORKERS }, async () => {
        while (next < queue.length && current()) {
          const row = queue[next++]!;
          try {
            row.found =
              (await findRoute(
                row.token.address,
                row.amount,
                swapper,
                isHydrex(row.token.address),
                gasValue,
                swapReads,
              )) ?? null;
          } catch (error) {
            console.error(error);
            row.failed = true;
          }
          if (!current()) return;
          judge(row, scanned);
          if (!row.touched) row.ticked = ticksItself(row);
          scanned.done++;
          drawRow(row, scanned);
          drawAll();
        }
      }),
    );
  } catch (error) {
    console.error(error);
    if (current()) {
      scanned.failed = true;
      if (scan !== scanned) begin();
    }
  } finally {
    if (current() && rescan) {
      rescan = false;
      rescanNow();
    } else if (current()) {
      // By value, once all are quoted: those worth swapping first.
      scanned.rows.sort((a, b) => worthFirst(b) - worthFirst(a));
      rowsList.replaceChildren(...scanned.rows.map(({ node }) => node));
      scanned.reading = false;
      drawAll();
      tell();
    }
  }
}

// The wallet's approvals to the swappers, of the tokens the page knows.
async function readAllowances(): Promise<void> {
  const connection = context.connection();
  const statusLine = view.querySelector<HTMLElement>(".allowances-status")!;
  const reading = view.querySelector<HTMLElement>(".allowances-reading")!;
  if (!connection) {
    allowances = undefined;
    allowanceReads++;
    reading.hidden = true;
    statusLine.textContent = "Connect a wallet.";
    allowanceList.replaceChildren();
    show(".allowances-all", false, view);
    return tell();
  }
  // Until the wallet's are read, cards of bars where they will show; read again, as after a reset, they stay until then.
  // Only the last read draws: one for a wallet let go since, or overtaken by another, draws nothing.
  const owner = connection.address;
  const id = ++allowanceReads;
  const current = () => id === allowanceReads && same(context.connection()?.address ?? "", owner);
  if (!allowances || !same(allowancesOwner ?? "", owner)) {
    statusLine.textContent = "";
    allowanceList.replaceChildren();
    reading.hidden = false;
  }
  try {
    const found = await allowancesOf(owner, [...new Set(known().map(key))] as Address[], swapReads);
    if (!current()) return;
    const tokens = await describe(found.map(({ token }) => token));
    if (!current()) return;
    [allowances, allowancesOwner] = [found, owner];
    reading.hidden = true;
    statusLine.textContent = found.length ? "" : "None";
    allowanceList.replaceChildren(
      ...found.map((allowance) => {
        const item = clone("allowance");
        const token = tokens.get(key(allowance.token));
        const swapper = SWAPPERS.find(({ address }) => same(address, allowance.spender))!;
        fill(item, {
          "allowance-symbol": token?.symbol ?? allowance.token,
          "allowance-amount": token ? figure(allowance.amount, token.decimals) : String(allowance.amount),
          "allowance-swapper": swapper.symbol,
        });
        item.querySelector(".reset")!.addEventListener("click", () => resetReview([allowance]));
        return item;
      }),
    );
    show(".allowances-all", found.length > 1, view);
  } catch (error) {
    console.error(error);
    if (!current()) return;
    reading.hidden = true;
    statusLine.textContent = "Reading the approvals failed.";
  }
  tell();
}

// A review that resets approvals to nothing: one approve(swapper, 0) for each.
export async function resetReview(these: Allowance[]): Promise<void> {
  const connection = context.connection();
  if (!connection || !these.length) return;
  const tokens = await describe(these.map(({ token }) => token));
  const steps = these.map(({ token, spender }) => {
    const described = tokens.get(key(token)) ?? { address: token, decimals: 0, symbol: token };
    return approveSlip(
      described,
      SWAPPERS.find(({ address }) => same(address, spender))!,
      0n,
    );
  });
  const title = these.length === 1 ? "Reset an approval" : `Reset ${these.length} approvals`;
  openReview({
    name: title,
    pages: [{ title }],
    steps,
    checkHref: hrefOf({ view: "swap", output: DEFAULT_OUTPUT, section: "approvals" }),
    connection,
    hooks: {
      ...context.hooks,
      closed: (submitted) => {
        context.hooks.closed(submitted);
        if (submitted) void readAllowances();
      },
    },
  });
}

// The review of a swap: the routes, each with its minimum, and the approvals it needs, run through Base first. A token may
// go in parts, each a route of its own. `approve` is what to approve of its token, when not what its routes sell, as for
// a swap of a whole balance after a claim. `margin` is the slippage that sets the minimums.
export type Plan = {
  swapper: Swapper;
  items: { token: Token; route: Route; out: bigint; allowance: bigint; approve?: bigint }[];
  margin: bigint;
};

export async function planSteps(
  plan: Plan,
  connection: Connection,
  tokens: Map<string, Token>,
  whole = false,
): Promise<{ approvals: Slip[]; swaps: Route[][]; slips: Slip[] }> {
  const safe = !!connection.wallet.propose;
  const found = await costs().catch(() => undefined);
  const deadline = BigInt(now() + (safe ? 86_400 : 1_800));
  // One approval a token, for all its parts.
  const approvals = soldOf(plan.items)
    .filter(({ total, allowance, approve }) => approve !== undefined || allowance < total)
    .map(({ token, total, approve }) => approveSlip(token, plan.swapper, approve ?? total));
  const swaps = split(plan.items.map(({ route }) => route));
  const tip = safe ? undefined : found?.tip;
  const slips = [...approvals, ...swaps.map((group) => swapSlip(plan.swapper, group, deadline, tokens, tip, whole))];
  return { approvals, swaps, slips };
}

async function reviewSwap(): Promise<void> {
  const connection = context.connection();
  const scanned = scan;
  if (!connection || !scanned) return;
  const { swapper } = scanned;
  if (!tickedOf(scanned).length || swapsOff() || reviewing) return;
  reviewing = true;
  busy(reviewButton);
  reviewFailed.hidden = true;
  try {
    // The routes found together, once found.
    await routeTicked(scanned);
    const ticked = tickedOf(scanned);
    const found = togetherFor(scanned, ticked);
    const plan: Plan = {
      swapper,
      margin: margin(),
      // A part Base found would not go through has its share of the token's own quote, should Base not answer now.
      items: ticked.flatMap((row) =>
        partsOf(row, found).map(({ route, out = (row.found!.out * route.amount) / row.amount }) => ({
          token: row.token,
          route: { ...route, minPaid: minimumOf(out, margin()) },
          out,
          allowance: row.allowance,
        })),
      ),
    };
    const opened = await openSwapReview(plan, connection, scanned.tokens, scanned.costs, scanned.prices);
    if (opened) {
      reviewFailed.textContent = opened;
      reviewFailed.hidden = false;
    }
  } catch (error) {
    console.error(error);
    reviewFailed.textContent = "Checking the swap failed. Nothing was sent.";
    reviewFailed.hidden = false;
  } finally {
    reviewing = false;
    busy(reviewButton, false);
    drawAll();
  }
}

// Opens the swap's review, or says why not. Gas is valued at the prices the swap was judged at.
//
// The routes run through Base first, in order and with no minimum: each fetches what the pools those before it moved
// pay, and its minimum is that, less the slippage. A route that would not go through even so is left out of the swap,
// and the bill says why. Without Base's answer, the minimums are the plan's own.
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
  let simulated = await simulate(connection.address, tried.slips).catch((error: unknown) => {
    console.error(error);
    return undefined;
  });
  if (simulated) {
    const failed = simulated.findIndex(({ ok }) => !ok);
    if (failed >= 0 && failed < tried.approvals.length)
      return `Base refused “${tried.slips[failed]!.says}” Nothing was sent.`;
    if (failed >= 0) return "Base refused the swap: the quotes may have moved. Nothing was sent.";
  }
  // What each route fetches, as Base found it, or as planned without its answer for every call; and why one would not
  // go through.
  const results = routeResults(simulated, tried.approvals.length, tried.swaps);
  if (!results) simulated = undefined;
  const items = plan.items.map((item, i) => {
    const result = results?.get(zeroed[i]!.route);
    const { out, reason }: { out: bigint; reason?: string } = !result
      ? { out: item.out }
      : result.done && result.amountOut > 0n
        ? { out: result.amountOut }
        : { out: 0n, reason: result.done ? "a pool gave nothing for it" : reasonOf(result.reason) };
    const minPaid = simulated ? minimumOf(out, plan.margin) : item.route.minPaid;
    return { item: { ...item, out, route: { ...item.route, minPaid } }, reason };
  });
  const going = items.flatMap(({ item, reason }) => (reason ? [] : [item]));
  if (!going.length) return "Base would skip every token: none can be swapped now. Nothing was sent.";
  const { approvals, swaps, slips } = await planSteps({ ...plan, items: going }, connection, tokens);
  const steps = slips;
  // Its gas, without the routes left out, once run again.
  if (simulated && going.length < items.length) {
    const again = await simulate(connection.address, steps).catch(() => undefined);
    simulated = again?.every(({ ok }) => ok) ? again : simulated;
  }
  const firstSwap = approvals.length;
  // What the bill shows each token fetches, for the receipt to compare with.
  const quoted = new Map<string, bigint>();
  for (const { token, out } of going) quoted.set(key(token.address), (quoted.get(key(token.address)) ?? 0n) + out);
  // A bill: each token, or each part of one, what it fetches and its route by its tokens and pools, then what they all
  // fetch, the 1%, what reaches you, and the least that may, which the slippage sets. Gas heads it, as it is paid apart,
  // in ETH. Each sum in tokens, then what it is worth.
  const body = clone("swap-before");
  const lines = body.querySelector(".swap-lines")!;
  let out = 0n;
  let least = 0n;
  for (const { item, reason } of items) {
    const { token, route, out: fetched } = item;
    const line = clone("swap-line");
    out += fetched;
    if (!reason) least += route.minPaid;
    fill(line, {
      "line-symbol": token.symbol,
      "line-amount": figure(route.amount, token.decimals),
      "line-fetches": reason ? "Skipped" : "",
      "line-route": hopsWords(route, tokens),
    });
    const fetches = [line.querySelector(".line-fetches")!, line.querySelector(".line-worth")!] as [Element, Element];
    if (!reason) showOutput(fetches, fetched, swapper, prices);
    show(".line-skip", !!reason, line);
    if (reason) fill(line, { "line-skip-words": `Skipped: ${reason}` });
    // What it fetches far under the page's own price says so, as on the swap's page.
    const under = reason ? undefined : underPrice(token, route.amount, fetched, swapper, prices);
    show(".line-check", under !== undefined, line);
    if (under !== undefined) fill(line, { "line-check-words": `${fraction(under)} under price` });
    lines.append(line);
  }
  const fee = feeOf(out);
  const gas = simulated
    ? simulated.reduce((sum, { gas }) => sum + gas, 0n)
    : BigInt(approvals.length) * APPROVAL_GAS + swapGas(going.map(({ route }) => route));

  showBill(body, "swap-fetched", { out, fee, least, gas }, swapper, prices, found);
  fill(body, {
    "swap-output": swapper.symbol,
    "swap-slippage": `Minimum at ${bps(plan.margin)} slippage`,
    "swap-simulated": "Not simulated: these are quotes.",
  });
  show(".swap-simulated", !simulated, body);
  const pages: ReviewPage[] = [{ title: "Quote", body }, {}];
  openReview({
    name: ["Swap into ", { code: swapper.symbol }],
    pages,
    steps,
    checkHref: hrefOf({ view: "swap", output: swapper.output, section: "check" }),
    connection,
    hooks: {
      ...context.hooks,
      closed: (submitted) => {
        context.hooks.closed(submitted);
        if (submitted) walletChanged();
      },
    },
    atomic: true,
    // Without batching, the page quotes again before it asks for each swap, as approvals take minutes: with a fresh
    // deadline, and the same minimums, never lower.
    prepare: async (i) => {
      const g = i - firstSwap;
      const group = swaps[g];
      if (!group) return undefined;
      const deadline = BigInt(now() + 1_800);
      const fresh = await freshResults(connection.address, swapper, group, deadline);
      const under = group.filter((route, j) => !fresh[j]?.done || paidOf(fresh[j]!.amountOut) < route.minPaid);
      const step = swapSlip(swapper, group, deadline, tokens, found?.tip);
      const names = under.map((route) => tokens.get(key(route.token))?.symbol ?? route.token);
      return {
        step,
        ...(under.length && {
          changed: `The quotes moved: ${list(names)} will be kept.`,
        }),
      };
    },
    outcomeOf: async (receipts) => {
      const hashes = receipts.map(({ transactionHash }) => transactionHash);
      const [gas, time] = await Promise.all([gasPaid(hashes, connection.address), includedAt(receipts)]);
      return swapReceipt(receipts, { ...plan, items: going }, tokens, connection.address, prices, {
        quoted,
        gas,
        time,
      });
    },
  });
  return undefined;
}

// What each route of a swap fetches now, in order, as Base runs it alone, its approvals given: or else as quoted, each as
// if first, when Base cannot say, or a token refused the transfer, as when an RPC has not seen its approval yet.
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

// How far under the page's own price a token's amount fetches, if more than CHECK and both have prices; not for a whole
// balance, whose amount is not known yet.
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

// The swap's receipt, from its events: when Base included it, at `time`, or else now, and the gas it cost, when `gas` is
// known; each token sold, what it
// fetched, and how that compares with what `quoted` says the review showed; then what they fetched, the 1%, and what
// reached you, each with what it is worth. A token that was skipped stays in the wallet with its approval, which it
// offers to reset.
export function swapReceipt(
  receipts: Receipt[],
  plan: Plan,
  tokens: Map<string, Token>,
  caller: Address,
  prices?: Prices,
  {
    quoted,
    gas,
    time = now(),
  }: { quoted?: Map<string, bigint>; gas?: bigint | undefined; time?: number | undefined } = {},
): DocumentFragment {
  const { swapper } = plan;
  // As many decimal places as the bill had, so that the receipt's figures line up at the point too, and add up.
  const { exact, worth, shown } = outputFigures(swapper, prices);
  const { swapped, failed, paid } = swappedIn(receipts, swapper, caller);
  const receipt = clone("swap-receipt");
  const part = (name: string) => receipt.querySelector(`.${name}`)!;
  const fetched = swapped.reduce((sum, { amountOut }) => sum + amountOut, 0n);
  fill(receipt, { "swap-receipt-output": swapper.symbol, "swap-receipt-time": utc(time) });
  part("swap-receipt-time").setAttribute("datetime", new Date(time * 1000).toISOString());
  if (gas !== undefined) {
    showWorth(part("swap-receipt-gas"), `${figure(gas, 18)} ETH`, inCents(ethCost(gas, prices)));
    show(".swap-receipt-gas-line", true, receipt);
  }
  // Each token once, its parts added up.
  const sold = new Map<string, { token: Address; amountIn: bigint; amountOut: bigint }>();
  for (const { token, amountIn, amountOut } of swapped) {
    const each = sold.get(key(token)) ?? { token, amountIn: 0n, amountOut: 0n };
    each.amountIn += amountIn;
    each.amountOut += amountOut;
    sold.set(key(token), each);
  }
  part("swap-lines").replaceChildren(
    ...[...sold.values()].map(({ token, amountIn, amountOut }) => {
      const line = clone("swap-line");
      const described = tokens.get(key(token));
      // A whole balance, as after a claim, or a token some of whose parts were skipped, may not be what was quoted: it
      // compares only when it is.
      const planned = plan.items
        .filter((each) => same(each.token.address, token))
        .reduce((sum, { route }) => sum + route.amount, 0n);
      const quote = quoted?.get(key(token));
      const compares = quote && planned === amountIn;
      fill(line, {
        "line-symbol": described?.symbol ?? token,
        "line-amount": described ? figure(amountIn, described.decimals) : String(amountIn),
        "line-route": compares ? versusQuote(amountOut, quote) : "",
      });
      showOutput(
        [line.querySelector(".line-fetches")!, line.querySelector(".line-worth")!],
        amountOut,
        swapper,
        prices,
      );
      return line;
    }),
  );
  const [outWorth, paidWorth] = [worth(fetched), worth(paid)];
  showWorth(part("swap-receipt-fetched"), exact(fetched), inCents(outWorth));
  showWorth(
    part("swap-receipt-fee"),
    exact(shown(paid) - shown(fetched)),
    inCents(outWorth && between(outWorth, paidWorth!)),
  );
  showWorth(part("swap-receipt-paid"), exact(paid), inCents(paidWorth));
  part("swap-receipt-skipped").replaceChildren(
    ...[...new Map(failed.map((each) => [key(each.token), each])).values()].map(({ token, reason }) => {
      const item = clone("swap-skipped");
      fill(item, {
        "skipped-symbol": tokens.get(key(token))?.symbol ?? token,
        "skipped-reason": reasonOf(reason),
      });
      item
        .querySelector(".reset")!
        .addEventListener("click", () => resetReview([{ token, spender: swapper.address, amount: 1n }]));
      return item;
    }),
  );
  return receipt;
}

// How what a token fetched compares with what the review showed, to a tenth of a percent: "+0.2% vs quote", or "As
// quoted" within that.
function versusQuote(out: bigint, quote: bigint): string {
  const tenths = Number(((out - quote) * 1000n) / quote);
  return tenths ? `${tenths > 0 ? "+" : "−"}${(Math.abs(tenths) / 10).toFixed(1)}% vs quote` : "As quoted";
}

// Hydrex's reward tokens, from what the automations' votes earned last epoch. Whether some are new to the page.
function knowRewards(): boolean {
  const before = known().length;
  for (const automation of AUTOMATIONS) {
    const found = earningsOf(automation);
    if (found)
      know(
        found.rewards.map(({ token }) => token.address),
        true,
      );
  }
  return known().length > before;
}

// The wallet's tokens read again, as they were scanned last, once more tokens became known: the quotes found stay.
function rescanNow(): void {
  const owner = context.connection()?.address;
  if (owner) void startScan(owner, scan?.swapper ?? swapperShown(), true);
}

// The wallet changed, or what it holds did: read its tokens and approvals again. A payout's amounts no longer apply.
export function walletChanged(): void {
  prefilled = undefined;
  const connection = context.connection();
  if (!connection) {
    scans++;
    scan = undefined;
    rowsList.replaceChildren();
    drawAll();
    void readAllowances();
    return;
  }
  void startScan(connection.address, swapperShown());
  void readAllowances();
}

export function initSwap(given: SwapContext): void {
  context = given;
  views.swap = drawAll;
  view.querySelector(".output-choices")!.replaceChildren(
    ...SWAPPERS.map((swapper) => {
      const choice = clone("output-choice");
      const input = choice.querySelector("input")!;
      input.value = swapper.output;
      fill(choice, { "output-symbol": swapper.symbol });
      input.addEventListener("change", () => {
        const next: PageRoute = { view: "swap", output: swapper.output };
        location.hash = hrefOf(next);
      });
      return choice;
    }),
  );
  marginSelect.addEventListener("change", drawAll);
  reviewButton.addEventListener("click", () => void reviewSwap());
  view.querySelector(".swap-again")!.addEventListener("click", walletChanged);
  view.querySelector(".reset-all")!.addEventListener("click", () => void resetReview(allowances ?? []));
  const input = view.querySelector<HTMLInputElement>(".add-address")!;
  const addFailed = view.querySelector<HTMLElement>(".add-failed")!;
  view.querySelector(".add-button")!.addEventListener("click", async () => {
    addFailed.hidden = true;
    const text = input.value.trim();
    if (!/^0x[0-9a-fA-F]{40}$/.test(text)) {
      addFailed.textContent = "That is not an address.";
      addFailed.hidden = false;
      return;
    }
    const found = await tokensOf([text as Address]).catch(() => new Map<string, Token>());
    if (!found.size) {
      addFailed.textContent = "No token at that address on Base.";
      addFailed.hidden = false;
      return;
    }
    know([text as Address]);
    input.value = "";
    rescanNow();
  });
  // An output's page reads the tokens into it; a section opens its fold.
  onRoute((next) => {
    if (next.view !== "swap") return drawAll();
    const owner = context.connection()?.address;
    if (owner && (!scan || scan.swapper.output !== next.output || !same(scan.owner, owner)))
      void startScan(owner, swapperOf(next.output)!);
    drawAll();
  });
  // Last epoch's figures can take long to read the first time: their tokens join the list once read, after a scan
  // under way.
  onEarnings((_, outcome) => {
    if (outcome !== "read" || !knowRewards()) return;
    if (scan?.reading) rescan = true;
    else rescanNow();
  });
}
