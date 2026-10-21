import type { Address } from "viem";
import { now, same, type Receipt } from "./chain.ts";
import { AUTOMATIONS, DEFAULT_OUTPUT, SWAPPERS, swapperOf, type Output, type Swapper } from "./config.ts";
import { clone, fill, fillAddress, show, showHex } from "./dom.ts";
import { tokensOf } from "./earnings.ts";
import { count, figure, fraction, list, usd } from "./format.ts";
import { earningsOf, onEarnings } from "./last-epoch.ts";
import { pricesAt, usdOf, type Token } from "./prices.ts";
import type { Amount } from "./receipts.ts";
import { openReview, type Hooks, type ReviewPage, type Slip } from "./review.ts";
import { hrefOf, type Route as PageRoute } from "./routes.ts";
import {
  APPROVAL_GAS,
  feeOf,
  findRoute,
  minimumOf,
  poolName,
  paidOf,
  quoteAll,
  reasonOf,
  simulate,
  split,
  swapChecks,
  swapGas,
  swapReturns,
  swappedIn,
  type Found,
  type Route,
} from "./swap.ts";
import { approveSlip, costs, gasUsd, pathWords, swapSlip, type Costs } from "./swap-calls.ts";
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
const form = view.querySelector<HTMLElement>(".swap-form")!;
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
  // Dollars per whole token, by the page's own prices, if it has one.
  price?: number | undefined;
  // undefined until its routes are read; null when the swapper has none.
  found?: Found | null;
  failed: boolean;
  // What its quote is worth in dollars, and why it is not ticked by default.
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
  prices: Map<string, number>;
  costs?: Costs | undefined;
  reading: boolean;
  failed: boolean;
  done: number;
};

export type SwapContext = { connection(): Connection | undefined; hooks: Hooks };
let context: SwapContext;
let scans = 0;
let scan: Scan | undefined;
// Each output's failed checks, once run, and the payout's tokens and amounts to tick, for the visit.
let failedOutputs: Map<Output, string[]> | undefined;
let prefilled: Map<string, bigint> | undefined;
let allowances: Allowance[] | undefined;
const listeners: (() => void)[] = [];

const key = (address: string): string => address.toLowerCase();
const margin = (): bigint => BigInt(marginSelect.value);
const swapperShown = (): Swapper => {
  const shown = route();
  return swapperOf(shown.view === "swap" ? shown.output : DEFAULT_OUTPUT)!;
};
export const outputOff = (swapper: Swapper): boolean => !failedOutputs || failedOutputs.get(swapper.output)!.length > 0;
const tell = (): void => listeners.forEach((listener) => listener());

// Called once something the App shows from here changes: the swap's line, or the approvals left.
export const onSwapChange = (listener: () => void): void => void listeners.push(listener);

// The App's line on the swap: how many tokens are worth swapping, and what they would fetch, once read.
export function swapLine(): { count: number; usd: number; reading: boolean } | undefined {
  if (!scan) return undefined;
  const worth = scan.rows.filter((row) => row.found && !row.reason);
  return { count: worth.length, usd: worth.reduce((sum, row) => sum + (row.worth ?? 0), 0), reading: scan.reading };
}

export const allowancesLeft = (): Allowance[] | undefined => allowances;

// The payout's tokens and amounts, to tick on the swap's page.
export function prefill(amounts: Amount[]): void {
  prefilled = new Map(amounts.map(({ token, amount }) => [key(token), amount]));
  know(amounts.map(({ token }) => token));
  const owner = context.connection()?.address;
  if (owner) void startScan(owner, swapperShown());
}

// What the output is worth, in its own units for each dollar, if it has a price.
function inOutput(dollars: number, scanned: Scan): bigint | undefined {
  const price = scanned.prices.get(key(scanned.swapper.token));
  if (!price) return undefined;
  return BigInt(Math.floor((dollars / price) * 10 ** scanned.swapper.decimals));
}

const outputUsd = (amount: bigint, scanned: Scan): number | undefined => {
  const price = scanned.prices.get(key(scanned.swapper.token));
  return price === undefined ? undefined : usdOf(amount, scanned.swapper.decimals, price);
};

// Whether a row is worth its gas, and why not, in words.
function judge(row: Row, scanned: Scan): void {
  const { found } = row;
  if (row.failed) {
    row.reason = "its routes could not be read";
    return;
  }
  if (found === undefined) return;
  if (found === null) {
    row.reason = row.price === undefined ? "no price, no pool the swapper can use" : "no pool the swapper can use";
    return;
  }
  row.worth =
    outputUsd(found.out, scanned) ??
    (row.price === undefined ? undefined : usdOf(row.amount, row.token.decimals, row.price));
  const gas = found.gas + (row.allowance < row.amount ? APPROVAL_GAS : 0n);
  const cost = scanned.costs ? (gasUsd(gas, scanned.costs) ?? 0) : 0;
  row.reason = row.worth === undefined ? "no price" : row.worth < CLEARS * cost ? "worth less than its gas" : undefined;
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
    "swap-fetches": found ? ` ≈ ${figure(found.out, swapper.decimals)} ${swapper.symbol}` : "",
  });
  const routeLine = node.querySelector(".swap-route")!;
  if (found === undefined && !row.failed) routeLine.textContent = "Finding its route…";
  else if (found) {
    const { hops } = found.route;
    const names = hops.map((hop, i) => {
      const next = scanned.tokens.get(key(hop.tokenOut))?.symbol ?? "?";
      const name = hops.length === 1 ? poolName(hop) : poolOnly(hop);
      return i === hops.length - 1 ? name : `${name} → ${next}`;
    });
    routeLine.textContent = `${names.join(" → ")}${row.reason ? `: ${row.reason}` : ""}`;
  } else routeLine.textContent = row.reason ?? "";
  show(".swap-lookalike", !!row.like, node);
  if (row.like) fill(node, { "swap-like": row.like.symbol });
  // A quote far under the page's own price says so, with both.
  const page = row.price === undefined ? undefined : usdOf(row.amount, token.decimals, row.price);
  const quoted = found ? outputUsd(found.out, scanned) : undefined;
  const under = !row.reason && page !== undefined && quoted !== undefined && quoted < page * (1 - CHECK);
  show(".swap-check", under, node);
  if (under) {
    fill(node, {
      "swap-check-words": `The quote, ${usd(quoted!)}, is ${fraction(1 - quoted! / page!)} under the page's own price for it, ${usd(page!)}. Check it before you swap.`,
    });
  }
  fillAddress(node, "swap-address", token.address);
}

const poolOnly = (hop: Route["hops"][number]): string => routeName(hop.exchange);
const routeName = (exchange: number): string =>
  [
    "Hydrex",
    "Hydrex",
    "Aero",
    "Aero",
    "Aero",
    "Aerodrome",
    "Aerodrome",
    "Aerodrome",
    "Aerodrome",
    "Uniswap v2",
    "Uniswap v3",
    "Uniswap v4",
  ][exchange]!;

function drawAll(): void {
  const signedIn = !!context.connection();
  form.hidden = !signedIn;
  const swapper = swapperShown();
  for (const input of view.querySelectorAll<HTMLInputElement>('input[name="output"]')) {
    const each = swapperOf(input.value)!;
    input.checked = each === swapper;
    input.disabled = !!failedOutputs && outputOff(each);
    show(".output-off", input.disabled, input.closest("label")!);
  }
  const off = failedOutputs ? SWAPPERS.filter(outputOff) : [];
  show(".swap-off", off.length > 0, view);
  fill(view, { "swap-off-outputs": list(off.map(({ symbol }) => symbol)) });
  if (!scan || !signedIn) return;
  const scanned = scan;
  show(".swap-failed", scanned.failed, view);
  show(".swap-none", !scanned.reading && !scanned.failed && !scanned.rows.length, view);
  const total = scanned.rows.length;
  status.hidden = !scanned.reading;
  status.textContent = !total ? "Reading your tokens…" : `Finding routes: ${scanned.done} of ${total}`;
  const ticked = scanned.rows.filter((row) => row.ticked && row.found);
  fill(view, { "swap-ticked": total ? `· ${ticked.length} of ${total} ticked` : "" });
  summarise(scanned, ticked);
}

// What the ticked tokens fetch together: earned, then taken, then what reaches you, and the calls the wallet will see.
function summarise(scanned: Scan, ticked: Row[]): void {
  const { swapper } = scanned;
  const sells = view.querySelector(".swap-sells")!;
  const costsLine = view.querySelector<HTMLElement>(".swap-costs")!;
  const splitLine = view.querySelector<HTMLElement>(".swap-split")!;
  reviewButton.disabled = !ticked.length || outputOff(swapper);
  if (!ticked.length) {
    sells.replaceChildren(Object.assign(document.createElement("b"), { textContent: "Tick the tokens to sell." }));
    costsLine.hidden = splitLine.hidden = true;
    return;
  }
  const out = ticked.reduce((sum, row) => sum + row.found!.out, 0n);
  const least = ticked.reduce((sum, row) => sum + minimumOf(row.found!.out, margin()), 0n);
  const fee = ticked.reduce((sum, row) => sum + feeOf(row.found!.out), 0n);
  const approvals = ticked.filter((row) => row.allowance < row.amount).length;
  const swaps = split(ticked.map((row) => row.found!.route)).length;
  const gas = BigInt(approvals) * APPROVAL_GAS + swapGas(ticked.map((row) => row.found!.route));
  const dollars = scanned.costs && gasUsd(gas, scanned.costs);
  const symbol = swapper.symbol;
  sells.textContent = `Sells ${count(ticked.length, "token", "tokens")} for ≈ ${figure(paidOf(out), swapper.decimals)} ${symbol}, at least ${figure(least, swapper.decimals)} ${symbol}.`;
  const calls = `${count(approvals + swaps, "call", "calls")}: ${count(approvals, "approval", "approvals")}, ${count(swaps, "swap", "swaps")}`;
  costsLine.textContent = `Swap's 1%: ≈ ${figure(fee, swapper.decimals)} ${symbol} · Gas ${dollars === undefined ? "…" : usd(dollars)} · ${calls}`;
  costsLine.hidden = false;
  splitLine.hidden = swaps < 2;
  splitLine.textContent = `This takes ${swaps} swaps: one transaction holds about 15 million gas.`;
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
    prices: new Map(),
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
    const [described, found] = await Promise.all([describe([...held, swapper.token]), costs().catch(() => undefined)]);
    if (!current()) return;
    scanned.tokens = described;
    scanned.costs = found;
    const amounts = new Map(held.map((token) => [token, holdings.get(token)!.balance]));
    scanned.prices = await pricesAt([...described.values()], amounts, now(), now()).catch((error: unknown) => {
      console.error(error);
      return new Map<string, number>();
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
        price: scanned.prices.get(address),
        failed: false,
        ticked: keptRow?.touched ? keptRow.ticked : false,
        touched: !!keptRow?.touched,
      };
      return [{ ...row, node: rowNode() }];
    });
    const value = (row: Row) => (row.price === undefined ? -1 : usdOf(row.amount, row.token.decimals, row.price));
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
      const dollars = scanned.costs && gasUsd(gas, scanned.costs);
      return dollars === undefined ? 0n : (inOutput(dollars, scanned) ?? 0n);
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
    if (current()) {
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
    statusLine.textContent = "Connect a wallet to see its approvals.";
    allowanceList.replaceChildren();
    show(".allowances-all", false, view);
    return tell();
  }
  statusLine.textContent = "Reading the approvals…";
  const owner = connection.address;
  try {
    const found = await allowancesOf(owner, [...new Set(known().map(key))] as Address[]);
    if (!same(context.connection()?.address ?? "", owner)) return;
    allowances = found;
    const tokens = await describe(found.map(({ token }) => token));
    statusLine.textContent = found.length
      ? `${count(found.length, "approval is", "approvals are")} left.`
      : "Nothing is approved: no swapper can take any token from this wallet.";
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
    statusLine.textContent = "The approvals could not be read from Base.";
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
// is what to approve, when not the route's amount, as for a swap of a whole balance after a claim.
export type Plan = {
  swapper: Swapper;
  items: { token: Token; route: Route; out: bigint; allowance: bigint; approve?: bigint }[];
};

export async function planSteps(
  plan: Plan,
  connection: Connection,
  tokens: Map<string, Token>,
  whole = false,
): Promise<{ approvals: Slip[]; swaps: Route[][]; slips: Slip[]; deadline: bigint }> {
  const safe = !!connection.wallet.propose;
  const found = await costs().catch(() => undefined);
  const deadline = BigInt(now() + (safe ? 86_400 : 1_800));
  const approvals = plan.items
    .filter(({ route, allowance, approve }) => approve !== undefined || allowance < route.amount)
    .map(({ token, route, approve }) => approveSlip(token, plan.swapper, approve ?? route.amount));
  const swaps = split(plan.items.map(({ route }) => route));
  const tip = safe ? undefined : found?.tip;
  const slips = [...approvals, ...swaps.map((group) => swapSlip(plan.swapper, group, deadline, tokens, tip, whole))];
  return { approvals, swaps, slips, deadline };
}

async function reviewSwap(): Promise<void> {
  const connection = context.connection();
  const scanned = scan;
  if (!connection || !scanned) return;
  const { swapper } = scanned;
  const ticked = scanned.rows.filter((row) => row.ticked && row.found);
  if (!ticked.length || outputOff(swapper)) return;
  const plan: Plan = {
    swapper,
    items: ticked.map((row) => ({
      token: row.token,
      route: { ...row.found!.route, amount: row.amount, minPaid: minimumOf(row.found!.out, margin()) },
      out: row.found!.out,
      allowance: row.allowance,
    })),
  };
  reviewButton.disabled = true;
  reviewFailed.hidden = true;
  reviewButton.textContent = "Running the swap through Base…";
  try {
    const opened = await openSwapReview(plan, connection, scanned.tokens, scanned.costs);
    if (opened) {
      reviewFailed.textContent = opened;
      reviewFailed.hidden = false;
    }
  } finally {
    reviewButton.textContent = "Review";
    drawAll();
  }
}

// Opens the swap's review, or says why not.
export async function openSwapReview(
  plan: Plan,
  connection: Connection,
  tokens: Map<string, Token>,
  found?: Costs,
  before: Slip[] = [],
  pagesBefore: ReviewPage[] = [],
  whole = false,
  name = `Swap into ${plan.swapper.symbol}`,
): Promise<string | undefined> {
  const { swapper } = plan;
  const { approvals, swaps, slips } = await planSteps(plan, connection, tokens, whole);

  const steps = [...before, ...slips];
  const simulated = await simulate(connection.address, steps).catch((error: unknown) => {
    console.error(error);
    return undefined;
  });
  const firstSwap = before.length + approvals.length;
  if (simulated) {
    const failed = simulated.findIndex(({ ok }) => !ok);
    if (failed >= 0 && failed < firstSwap)
      return `Base refused a call when the page ran them: “${steps[failed]!.says}” Nothing was sent.`;
    if (failed >= 0) return "Base refused the swap when the page ran it: the quotes may have moved. Nothing was sent.";
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
      "line-amount": whole ? "all that the claim brings" : figure(route.amount, token.decimals),
      "line-fetches": reason
        ? "skipped"
        : `≈ ${figure(paidOf(fetched), swapper.decimals)} ${swapper.symbol}, at least ${figure(route.minPaid, swapper.decimals)}`,
    });
    line.querySelector(".line-route")!.replaceChildren(
      ...pathWords(route, tokens).map((word) => {
        if (typeof word === "string") return word;
        const code = document.createElement("code");
        code.translate = false;
        showHex(code, word.code);
        return code;
      }),
    );
    show(".line-skip", !!reason, line);
    if (reason) fill(line, { "line-skip-words": `It would be skipped: ${reason}. It would stay in your wallet.` });
    lines.append(line);
  }
  const fee = feeOf(out);
  const gas = simulated
    ? simulated.slice(before.length).reduce((sum, { gas }) => sum + gas, 0n)
    : BigInt(approvals.length) * APPROVAL_GAS + swapGas(plan.items.map(({ route }) => route));
  const dollars = found ? gasUsd(gas, found) : undefined;
  fill(body, {
    "swap-fetched": `≈ ${figure(out, swapper.decimals)} ${swapper.symbol}`,
    "swap-fee": `≈ −${figure(fee, swapper.decimals)} ${swapper.symbol}`,
    "swap-paid": `≈ ${figure(out - fee, swapper.decimals)} ${swapper.symbol}`,
    "swap-least": `At least ${figure(least, swapper.decimals)} ${swapper.symbol}`,
    "swap-gas": `${dollars === undefined ? `about ${gas.toLocaleString("en-GB")} gas` : usd(dollars)} for ${count(slips.length, "call", "calls")}`,
    "swap-simulated": simulated
      ? "The page ran the approvals and the swap through Base just now: these figures are the swap's own."
      : "The page could not run the swap through Base just now: these figures are the quotes'.",
  });
  const safe = !!connection.wallet.propose;
  show(".swap-safe", safe, body);
  show(".swap-tip", !safe, body);
  const pages: ReviewPage[] = [
    ...pagesBefore,
    { title: "What you swap", body },
    { title: "What your wallet will ask" },
  ];
  openReview({
    name,
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
      const step = swapSlip(swapper, group, deadline, tokens, found?.tip, whole);
      const names = under.map((route) => tokens.get(key(route.token))?.symbol ?? route.token);
      return {
        step,
        ...(under.length && {
          changed: `The quotes moved: ${list(names)} would now fetch less than ${under.length === 1 ? "its" : "their"} minimum, and would stay in your wallet.`,
        }),
      };
    },
    outcomeOf: async (receipts) => swapReceipt(receipts, plan, tokens),
  });
  return undefined;
}

// The swap's receipt, from its events: each token in, what it fetched, the 1%, and what reached you. A token that was
// skipped stays in the wallet with its approval, which it offers to reset.
export function swapReceipt(receipts: Receipt[], plan: Plan, tokens: Map<string, Token>): DocumentFragment {
  const { swapper } = plan;
  const { swapped, failed, paid, fee } = swappedIn(receipts, swapper);
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

// The wallet changed, or what it holds did: read its tokens and approvals again.
export function walletChanged(): void {
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

async function checkSwappers(): Promise<void> {
  failedOutputs = await swapChecks();
  for (const item of view.querySelectorAll<HTMLElement>("[data-check]")) {
    item.querySelector(".check-failed")?.remove();
    const failing = SWAPPERS.filter(({ output }) => failedOutputs!.get(output)!.includes(item.dataset.check!));
    if (!failing.length) continue;
    const mark = clone("check-failed");
    mark.querySelector("b")!.textContent = `Failed for ${list(failing.map(({ symbol }) => symbol))}:`;
    item.prepend(mark);
  }
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
      addFailed.textContent = "That is not an address: it starts with 0x, then 40 digits and letters a to f.";
      addFailed.hidden = false;
      return;
    }
    const found = await tokensOf([text as Address]).catch(() => new Map<string, Token>());
    if (!found.size) {
      addFailed.textContent = "No token answers at that address on Base.";
      addFailed.hidden = false;
      return;
    }
    know([text as Address]);
    input.value = "";
    walletChanged();
  });
  // An output's page reads the tokens into it; a section opens its fold.
  onRoute((next) => {
    if (next.view !== "swap") return drawAll();
    const owner = context.connection()?.address;
    if (owner && (!scan || scan.swapper.output !== next.output || !same(scan.owner, owner)))
      void startScan(owner, swapperOf(next.output)!);
    drawAll();
  });
  // Last epoch's figures can take long to read the first time: their tokens join the list once read.
  onEarnings((_, outcome) => {
    const owner = context.connection()?.address;
    if (outcome === "read" && knowRewards() && owner && scan && !scan.reading) void startScan(owner, scan.swapper);
  });
  checkSwappers().catch(console.error);
  setInterval(() => checkSwappers().catch(console.error), 3_600_000);
}
