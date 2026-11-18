// Checks the yields that analyze.ts rebuilds from rewards-manager history against the site's own APR code (`paidIn`,
// `per10kOf`, `aprOf`) over the last 192 hours, for the pools with the most power.
import { readFileSync } from "node:fs";
import { aprOf, paidIn, per10kOf, readMarket, readUniverse, whole } from "../src/aero.ts";

const data = JSON.parse(readFileSync(new URL("./data/gauges.json", import.meta.url), "utf8"));
const market = await readMarket(readUniverse());
const K = data.hours.length;
const span = 192;
const price = (a: string) => data.prices[a.toLowerCase()] ?? 0;
const aero = price("0x3f5bf3edac59d650d8fdf9657a71f2f904a3a4ee");
const rows = [];
for (const g of [...market.gauges].sort((a, b) => Number(b.power - a.power)).slice(0, 12)) {
  const saved = data.gauges.find((s: { address: string }) => s.address === g.address.toLowerCase());
  const fee = (index: string) => {
    const snap = saved.snaps[index];
    if (!snap) return 0;
    return (
      (Number(BigInt(snap.acc0)) / 1e6 / 10 ** saved.token0.decimals) * price(saved.token0.address) +
      (Number(BigInt(snap.acc1)) / 1e6 / 10 ** saved.token1.decimals) * price(saved.token1.address)
    );
  };
  const mine = (((fee(saved.index[K - 1]) - fee(saved.index[K - 1 - span])) / span) * 24 * 365) / aero;
  const paying = paidIn(g, span, market.prices);
  const site = paying && aprOf(per10kOf(paying)!.fees, market.prices);
  rows.push({ pool: saved.name, power: Math.round(whole(g.power)), research: mine.toFixed(4), site: site?.toFixed(4) });
}
console.table(rows);
