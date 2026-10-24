import type { Address } from "viem";
import { now, same, type Receipt } from "./chain.ts";
import { AUTOMATIONS, DEFAULT_OUTPUT, HYDX, SWAPPERS, swapperOf, type Swapper } from "./config.ts";
import { clone, fill, fillAddress, show, showWorth } from "./dom.ts";
import { tokensOf } from "./earnings.ts";
import { bps, count, figure, fraction, list, money, moneyAt, short, type Money } from "./format.ts";
import { earningsOf, onEarnings } from "./last-epoch.ts";
import { pricesIn, pricesNow, worthOf, type Prices, type Token } from "./prices.ts";
import type { Amount } from "./receipts.ts";
import { openReview, type Hooks, type ReviewPage, type Slip } from "./review.ts";
import { hrefOf, type Route as PageRoute } from "./routes.ts";
import {
  APPROVAL_GAS,
  MIDDLES,
  feeOf,
  findRoute,
  minimumOf,
  paidOf,
  quoteAll,
  reasonOf,
  simulate,
  split,
  onBase,
  swapGas,
  swapReturns,
  swappedIn,
  type Found,
  type Route,
} from "./swap.ts";
import { approveSlip, costs, ethCost, gasCost, hopsWords, swapSlip, type Costs } from "./swap-calls.ts";
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
} from "./tokens.ts";
import { onRoute, route } from "./views.ts";
import { walletAssets, type Connection } from "./wallet.ts";

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
let scans = 0;
let scan: Scan | undefined;
// Whether the page's RPCs serve Base, once read, and the payout's tokens and amounts to tick, for the visit.
let base: boolean | undefined;
let prefilled: Map<string, bigint> | undefined;
// Whether a scan under way should be followed by another, as when new tokens became known meanwhile.
let rescan = false;
let allowances: Allowance[] | undefined;
const listeners: (() => void)[] = [];

const key = (address: string): string => address.toLowerCase();
const margin = (): bigint => BigInt(marginSelect.value);
const swapperShown = (): Swapper => {
  const shown = route();
  return swapperOf(shown.view === "swap" ? shown.output : DEFAULT_OUTPUT)!;
};
// Until the page has read that its RPCs serve Base, and unless they do, no swap is offered.
export const swapsOff = (): boolean => base !== true;
const tell = (): void => listeners.forEach((listener) => listener());

// Called once something the App shows from here changes: the swap's line, or the approvals left.
export const onSwapChange = (listener: () => void): void => void listeners.push(listener);

// The App's line on the swap: how many tokens are worth swapping, and what they would fetch, once read.
export function swapLine(): { count: number; worth: Money; reading: boolean } | undefined {
  if (!scan) return undefined;
  const worth = scan.rows.filter((row) => row.found && !row.reason);
  const value = worth.reduce((sum, row) => sum + (row.worth ?? 0), 0);
  return { count: worth.length, worth: moneyAt(value, scan.prices), reading: scan.reading };
}

export const allowancesLeft = (): Allowance[] | undefined => allowances;

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

const outputValue = (amount: bigint, scanned: Scan): number | undefined => {
  const price = scanned.prices.of.get(key(scanned.swapper.token));
  return price === undefined ? undefined : worthOf(amount, scanned.swapper.decimals, price);
};

// An amount of the output, exactly, then what it is worth at the prices, if they price the output, quieter: as a quote.
function showOutput(element: Element, amount: bigint, swapper: Swapper, prices: Prices | undefined, sign = ""): void {
  const price = prices?.of.get(key(swapper.token));
  showWorth(
    element,
    `${sign}${figure(amount, swapper.decimals)} ${swapper.symbol}`,
    price === undefined
      ? undefined
      : () => `${sign}${money(moneyAt(worthOf(amount, swapper.decimals, price), prices!))}`,
  );
}

// Gas, as a quote: in the ETH that pays it, then what it is worth, if ETH has a price.
function showGas(element: Element, wei: bigint, prices: Prices | undefined): void {
  const cost = ethCost(wei, prices);
  showWorth(element, `${figure(wei, 18)} ETH`, cost && (() => money(cost)));
}

// A swap's figures, as the summary and the bill both show them: what it fetches, in the element `fetched` names, the 1%,
// what reaches you, the least that may, and the gas; without the gas price, `noCosts`.
function showBill(
  root: ParentNode,
  fetched: string,
  { out, fee, least, gas }: { out: bigint; fee: bigint; least: bigint; gas: bigint },
  swapper: Swapper,
  prices: Prices | undefined,
  found: Costs | undefined,
  noCosts: string,
): void {
  const part = (name: string) => root.querySelector(`.${name}`)!;
  showOutput(part(fetched), out, swapper, prices);
  showOutput(part("swap-fee"), fee, swapper, prices, "− ");
  showOutput(part("swap-paid"), out - fee, swapper, prices);
  showOutput(part("swap-least"), least, swapper, prices);
  if (found) showGas(part("swap-gas"), gas * found.gasPrice, prices);
  else fill(root, { "swap-gas": noCosts });
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
  const fetches = node.querySelector(".swap-fetches")!;
  if (found) showOutput(fetches, found.out, swapper, scanned.prices);
  else fetches.replaceChildren();
  // Only why a token is not ticked, or that its route is being found: the route itself is in the review.
  const routeLine = node.querySelector(".swap-route")!;
  routeLine.textContent = found === undefined && !row.failed ? "…" : (row.reason ?? "");
  show(".swap-lookalike", !!row.like, node);
  if (row.like) fill(node, { "swap-like": row.like.symbol });
  // A quote far under the page's own price says so, with both.
  const page = row.price === undefined ? undefined : worthOf(row.amount, token.decimals, row.price);
  const quoted = found ? outputValue(found.out, scanned) : undefined;
  const under = !row.reason && page !== undefined && quoted !== undefined && quoted < page * (1 - CHECK);
  show(".swap-check", under, node);
  if (under) {
    fill(node, {
      "swap-check-words": `Quote ${fraction(1 - quoted! / page!)} under price`,
    });
  }
  fillAddress(node, "swap-address", token.address, short(token.address));
}

function drawAll(): void {
  const signedIn = !!context.connection();
  // Without a wallet, the outputs show, and the tokens' list says that no wallet is connected.
  show(".swap-approvals-open, .add-token", signedIn, view);
  const swapper = swapperShown();
  for (const input of view.querySelectorAll<HTMLInputElement>('input[name="output"]')) {
    input.checked = swapperOf(input.value) === swapper;
    input.disabled = base === false;
    show(".output-off", input.disabled, input.closest("label")!);
  }
  show(".swap-off", base === false, view);
  show(".swap-unchecked", base === undefined, view);
  if (!scan || !signedIn) {
    status.hidden = summary.hidden = true;
    show(".swap-failed, .swap-none", false, view);
    return void fill(view, { "swap-ticked": "" });
  }
  summary.hidden = false;
  const scanned = scan;
  show(".swap-failed", scanned.failed, view);
  show(".swap-none", !scanned.reading && !scanned.failed && !scanned.rows.length, view);
  const total = scanned.rows.length;
  status.hidden = !scanned.reading;
  status.textContent = !total ? "Loading…" : `Routes: ${scanned.done} of ${total}`;
  const ticked = scanned.rows.filter((row) => row.ticked && row.found);
  fill(view, { "swap-ticked": total ? `· ${ticked.length} of ${total}` : "" });
  summarise(scanned, ticked);
}

// What the ticked tokens fetch together, row by row: the quote, less the 1%, is what reaches you, and the slippage picked
// sets the least that may. Gas is paid apart, in ETH. Each in tokens, then what it is worth.
function summarise(scanned: Scan, ticked: Row[]): void {
  const { swapper } = scanned;
  const sells = view.querySelector<HTMLElement>(".swap-sells")!;
  const breakdown = view.querySelector<HTMLElement>(".breakdown")!;
  const splitLine = view.querySelector<HTMLElement>(".swap-split")!;
  reviewButton.disabled = !ticked.length || swapsOff();
  sells.hidden = ticked.length > 0;
  breakdown.hidden = !ticked.length;
  if (!ticked.length) return void (splitLine.hidden = true);
  const out = ticked.reduce((sum, row) => sum + row.found!.out, 0n);
  const least = ticked.reduce((sum, row) => sum + minimumOf(row.found!.out, margin()), 0n);
  const fee = ticked.reduce((sum, row) => sum + feeOf(row.found!.out), 0n);
  const approvals = ticked.filter((row) => row.allowance < row.amount).length;
  const swaps = split(ticked.map((row) => row.found!.route)).length;
  const gas = BigInt(approvals) * APPROVAL_GAS + swapGas(ticked.map((row) => row.found!.route));
  const { costs: found, prices } = scanned;
  showBill(breakdown, "swap-quoted", { out, fee, least, gas }, swapper, prices, found, "…");
  splitLine.hidden = swaps < 2;
  splitLine.textContent = `${swaps} swaps`;
}

function rowNode(): HTMLElement {
  const node = clone("swap-row").firstElementChild as HTMLElement;
  node.querySelector<HTMLInputElement>(".pick")!.addEventListener("change", (event) => {
    const target = scan?.rows.find((each) => each.node === node);
    if (!target) return;
    target.ticked = (event.target as HTMLInputElement).checked;
    target.touched = true;
    drawAll();
  });
  return node;
}

// Reads the wallet's tokens, their prices, and each one's route into the output, the ticked and the most valuable
// first. Another scan, as of another output, takes over.
async function startScan(owner: Address, swapper: Swapper): Promise<void> {
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
  scan = scanned;
  rowsList.replaceChildren();
  drawAll();
  tell();
  const current = () => scan === scanned;
  try {
    // Hydrex's reward tokens, as last epoch's rewards name them, once read, and the wallet's own list where it offers one.
    knowRewards();
    const connection = context.connection();
    if (connection) know(await walletAssets(connection));
    const tokens = [...new Set(known().map(key))] as Address[];
    const holdings = await holdingsOf(owner, tokens, swapper.address);
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
    scanned.prices = await pricesNow([...described.values()], amounts).catch((error: unknown) => {
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
      return [{ ...row, node: rowNode() }];
    });
    const value = (row: Row) => (row.price === undefined ? -1 : worthOf(row.amount, row.token.decimals, row.price));
    rows.sort((a, b) => value(b) - value(a));
    scanned.rows = rows;
    rowsList.replaceChildren(...rows.map(({ node }) => node));
    rows.forEach((row) => drawRow(row, scanned));
    drawAll();
    // The payout's tokens first, then by value.
    const queue = [...rows].sort(
      (a, b) => Number(prefilled?.has(key(b.token.address)) ?? 0) - Number(prefilled?.has(key(a.token.address)) ?? 0),
    );
    let next = 0;
    const gasValue = (gas: bigint) => {
      const cost = scanned.costs && gasCost(gas, scanned.costs, scanned.prices);
      return cost ? (inOutput(cost.value, scanned) ?? 0n) : 0n;
    };
    await Promise.all(
      Array.from({ length: WORKERS }, async () => {
        while (next < queue.length && current()) {
          const row = queue[next++]!;
          try {
            row.found =
              (await findRoute(row.token.address, row.amount, swapper, isHydrex(row.token.address), gasValue)) ?? null;
          } catch (error) {
            console.error(error);
            row.failed = true;
          }
          if (!current()) return;
          judge(row, scanned);
          const payout = prefilled?.has(key(row.token.address));
          if (!row.touched) row.ticked = !!row.found && !row.reason && (!prefilled || !!payout);
          scanned.done++;
          drawRow(row, scanned);
          drawAll();
        }
      }),
    );
  } catch (error) {
    console.error(error);
    if (current()) scanned.failed = true;
  } finally {
    if (current() && rescan) {
      rescan = false;
      rescanNow();
    } else if (current()) {
      // By value, once all are quoted: those worth swapping first.
      const worth = (row: Row) => (row.reason || row.worth === undefined ? -1 : row.worth);
      scanned.rows.sort((a, b) => worth(b) - worth(a));
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
  if (!connection) {
    allowances = undefined;
    statusLine.textContent = "Connect a wallet.";
    allowanceList.replaceChildren();
    show(".allowances-all", false, view);
    return tell();
  }
  statusLine.textContent = "Loading…";
  const owner = connection.address;
  try {
    const found = await allowancesOf(owner, [...new Set(known().map(key))] as Address[]);
    if (!same(context.connection()?.address ?? "", owner)) return;
    allowances = found;
    const tokens = await describe(found.map(({ token }) => token));
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

// The review of a swap: the routes, each with its minimum, and the approvals it needs, run through Base first. `approve`
// is what to approve, when not the route's amount, as for a swap of a whole balance after a claim. `margin` is the
// slippage that set the minimums, which `yours` says the owner picked.
export type Plan = {
  swapper: Swapper;
  items: { token: Token; route: Route; out: bigint; allowance: bigint; approve?: bigint }[];
  margin: bigint;
  yours?: boolean;
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
  const approvals = plan.items
    .filter(({ route, allowance, approve }) => approve !== undefined || allowance < route.amount)
    .map(({ token, route, approve }) => approveSlip(token, plan.swapper, approve ?? route.amount));
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
  const ticked = scanned.rows.filter((row) => row.ticked && row.found);
  if (!ticked.length || swapsOff()) return;
  const plan: Plan = {
    swapper,
    margin: margin(),
    yours: true,
    items: ticked.map((row) => ({
      token: row.token,
      route: { ...row.found!.route, amount: row.amount, minPaid: minimumOf(row.found!.out, margin()) },
      out: row.found!.out,
      allowance: row.allowance,
    })),
  };
  reviewButton.disabled = true;
  reviewFailed.hidden = true;
  reviewButton.textContent = "Simulating…";
  try {
    const opened = await openSwapReview(plan, connection, scanned.tokens, scanned.costs, scanned.prices);
    if (opened) {
      reviewFailed.textContent = opened;
      reviewFailed.hidden = false;
    }
  } finally {
    reviewButton.textContent = "Review";
    drawAll();
  }
}

// Opens the swap's review, or says why not. Gas is valued at the prices the swap was judged at.
export async function openSwapReview(
  plan: Plan,
  connection: Connection,
  tokens: Map<string, Token>,
  found?: Costs,
  prices?: Prices,
): Promise<string | undefined> {
  const { swapper } = plan;
  const { approvals, swaps, slips } = await planSteps(plan, connection, tokens);
  const steps = slips;
  const simulated = await simulate(connection.address, steps).catch((error: unknown) => {
    console.error(error);
    return undefined;
  });
  const firstSwap = approvals.length;
  if (simulated) {
    const failed = simulated.findIndex(({ ok }) => !ok);
    if (failed >= 0 && failed < firstSwap) return `Base refused “${steps[failed]!.says}” Nothing was sent.`;
    if (failed >= 0) return "Base refused the swap: the quotes may have moved. Nothing was sent.";
  }
  // What each route fetches, as the simulation found it, or as quoted.
  const outcome = new Map<Route, { out: bigint; reason?: string }>();
  swaps.forEach((group, g) => {
    const run = simulated?.[firstSwap + g];
    const results = run ? swapReturns(run.returnData).results : undefined;
    group.forEach((route, i) => {
      const result = results?.[i];
      const item = plan.items.find((each) => each.route === route)!;
      outcome.set(
        route,
        result
          ? result.done
            ? { out: result.amountOut }
            : { out: 0n, reason: reasonOf(result.reason) }
          : { out: item.out },
      );
    });
  });
  // A bill: each token, what it fetches and its route by its tokens and pools, then what they all fetch, the 1%, what
  // reaches you, and the least that may, which the slippage sets. Gas heads it, as it is paid apart, in ETH. Each sum in
  // tokens, then what it is worth.
  const body = clone("swap-before");
  const lines = body.querySelector(".swap-lines")!;
  let out = 0n;
  let least = 0n;
  for (const { token, route } of plan.items) {
    const line = clone("swap-line");
    const { out: fetched, reason } = outcome.get(route)!;
    out += fetched;
    if (!reason) least += route.minPaid;
    fill(line, {
      "line-symbol": token.symbol,
      "line-amount": figure(route.amount, token.decimals),
      "line-fetches": reason ? "Skipped" : "",
      "line-route": hopsWords(route, tokens),
    });
    if (!reason) showOutput(line.querySelector(".line-fetches")!, fetched, swapper, prices);
    show(".line-skip", !!reason, line);
    if (reason) fill(line, { "line-skip-words": `Skipped: ${reason}` });
    lines.append(line);
  }
  const fee = feeOf(out);
  const gas = simulated
    ? simulated.reduce((sum, { gas }) => sum + gas, 0n)
    : BigInt(approvals.length) * APPROVAL_GAS + swapGas(plan.items.map(({ route }) => route));

  showBill(
    body,
    "swap-fetched",
    { out, fee, least, gas },
    swapper,
    prices,
    found,
    `${gas.toLocaleString("en-GB")} gas`,
  );
  fill(body, {
    "swap-output": swapper.symbol,
    "swap-slippage": `${plan.yours ? "Your slippage" : "Slippage"}: ${bps(plan.margin)}`,
    "swap-simulated": "Not simulated: these are quotes.",
  });
  show(".swap-simulated", !simulated, body);
  const pages: ReviewPage[] = [{ title: "What you swap", body }, { title: "What your wallet will ask" }];
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
      const fresh = await quoteAll(group.map((route) => ({ swapper, route: { ...route, minPaid: 0n } })));
      const under = group.filter((route, j) => !fresh[j]?.done || paidOf(fresh[j]!.amountOut) < route.minPaid);
      const deadline = BigInt(now() + 1_800);
      const step = swapSlip(swapper, group, deadline, tokens, found?.tip);
      const names = under.map((route) => tokens.get(key(route.token))?.symbol ?? route.token);
      return {
        step,
        ...(under.length && {
          changed: `The quotes moved: ${list(names)} will be kept.`,
        }),
      };
    },
    outcomeOf: async (receipts) => swapReceipt(receipts, plan, tokens, connection.address),
  });
  return undefined;
}

// The swap's receipt, from its events: each token in, what it fetched, the 1%, and what reached you. A token that was
// skipped stays in the wallet with its approval, which it offers to reset.
export function swapReceipt(
  receipts: Receipt[],
  plan: Plan,
  tokens: Map<string, Token>,
  caller: Address,
): DocumentFragment {
  const { swapper } = plan;
  const { swapped, failed, paid, fee } = swappedIn(receipts, swapper, caller);
  const receipt = clone("swap-receipt");
  const fetched = swapped.reduce((sum, { amountOut }) => sum + amountOut, 0n);
  fill(receipt, {
    "swap-receipt-output": swapper.symbol,
    "swap-receipt-sold": count(swapped.length, "token", "tokens"),
    "swap-receipt-tokens": list(
      swapped.map(({ token, amountIn }) => {
        const described = tokens.get(key(token));
        return described ? `${figure(amountIn, described.decimals)} ${described.symbol}` : `${amountIn} of ${token}`;
      }),
    ),
    "swap-receipt-fetched": `${figure(fetched, swapper.decimals)} ${swapper.symbol}`,
    "swap-receipt-fee": `−${figure(fee, swapper.decimals)} ${swapper.symbol}`,
    "swap-receipt-paid": `${figure(paid, swapper.decimals)} ${swapper.symbol}`,
  });
  receipt.querySelector(".swap-receipt-skipped")!.replaceChildren(
    ...failed.map(({ token, reason }) => {
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

// The wallet's tokens read again, as they were scanned last.
function rescanNow(): void {
  const owner = context.connection()?.address;
  if (owner) void startScan(owner, scan?.swapper ?? swapperShown());
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

async function checkBase(): Promise<void> {
  base = await onBase();
  drawAll();
}

export function initSwap(given: SwapContext): void {
  context = given;
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
  // Until the page has read once that its RPCs serve Base, a failed read is tried again within a minute, by one retry at
  // a time however many reads failed meanwhile, as the hourly one.
  let retry: ReturnType<typeof setTimeout> | undefined;
  const check = (): void => {
    clearTimeout(retry);
    retry = undefined;
    void checkBase().catch((error: unknown) => {
      console.error(error);
      drawAll();
      if (base === undefined) retry ??= setTimeout(check, 60_000);
    });
  };
  check();
  setInterval(check, 3_600_000);
}
