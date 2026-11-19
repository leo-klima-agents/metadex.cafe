// Checks the yields that analyze.ts rebuilds from rewards-manager history against the site's own APR code (`paidIn`,
// `per10kOf`, `aprOf`) over the last 192 hours, for the pools with the most power. The site's window ends now, so the
// data must be fresh: run fetch-gauges.ts just before. Exits with an error when a pool differs by more than 5%.
import { aprOf, paidIn, per10kOf, readMarket, readUniverse, whole } from "../src/aero.ts";
import { AERO } from "../src/config.ts";
import { feeSeries, HOUR, load, type Gauges } from "./common.ts";

const SPAN = 192;
const TOLERANCE = 0.05;
const data = load<Gauges>("gauges.json");
const market = await readMarket(readUniverse());
const K = data.hours.length;
const behind = (market.time - data.hours[K - 1]!) / HOUR;
if (behind > 2) throw new Error(`gauges.json ends ${behind.toFixed(1)} hours ago. Run fetch-gauges.ts again first.`);
const aero = data.prices[AERO.toLowerCase()]!;
const rows = [];
let worst = 0;
for (const g of [...market.gauges].sort((a, b) => Number(b.power - a.power)).slice(0, 12)) {
  const saved = data.gauges.find(({ address }) => address === g.address.toLowerCase());
  const paying = paidIn(g, SPAN, market.prices);
  const site = paying && aprOf(per10kOf(paying)!.fees, market.prices);
  if (!saved || site === undefined) {
    rows.push({ pool: g.address, research: "not saved or no site APR" });
    continue;
  }
  const fees = feeSeries(saved, data.hours, data.prices);
  const research = (((fees[K - 1]! - fees[K - 1 - SPAN]!) / SPAN) * 24 * 365) / aero;
  const difference = site ? Math.abs(research / site - 1) : 0;
  worst = Math.max(worst, difference);
  rows.push({
    pool: saved.name,
    power: Math.round(whole(g.power)),
    research: research.toFixed(4),
    site: site.toFixed(4),
    difference: `${(100 * difference).toFixed(1)}%`,
  });
}
console.table(rows);
if (worst > TOLERANCE) {
  console.error(`A pool differs from the site's APR by ${(100 * worst).toFixed(1)}%.`);
  process.exitCode = 1;
}
