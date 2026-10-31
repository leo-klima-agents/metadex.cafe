import type { Currency } from "./config.ts";
import { earningsDue, loadEarnings, loadShares } from "./earnings.ts";
import { setCurrency } from "./format.ts";
import { showTopics, type Topic } from "./rpc.ts";
import { onUpdate, update } from "./state.ts";
import { checkAccount, initAccount, renderAccount } from "./views/account.ts";
import { renderApp } from "./views/app.ts";
import { initConnection, renderConnection } from "./views/connect.ts";
import { $, linkAddresses } from "./views/dom.ts";
import { initHydrex, renderAutomationView, renderHydrex } from "./views/hydrex.ts";
import { closed } from "./views/review.ts";
import { onRoute, type View } from "./views/router.ts";
import {
  appPayouts,
  checks,
  doubleEspresso,
  failed,
  holdings,
  matchaLatte,
  reloadAccounts,
  session,
} from "./views/session.ts";
import { initSwap, renderSwap, rewardsRead } from "./views/swap.ts";

// Every page reads what the others show too; only the order differs, the page shown first.
const TOPICS: Record<View, Topic[]> = {
  home: [],
  about: [],
  app: ["earnings", "payouts", "swap"],
  hydrex: ["earnings", "shares", "payouts"],
  automation: ["earnings", "shares", "payouts"],
  account: ["earnings", "shares", "payouts"],
  swap: ["earnings", "swap"],
};

linkAddresses();
initConnection();
initHydrex();
initAccount();
initSwap();
onRoute((route) => {
  showTopics(TOPICS[route.view]);
  update();
});
onUpdate(() => {
  renderConnection();
  renderApp();
  renderHydrex();
  renderAutomationView();
  renderAccount();
  renderSwap();
  if (!matchaLatte.failed && !checks.failed) $("#error").hidden = true;
});
$<HTMLSelectElement>("#currency").addEventListener("change", (event) => {
  setCurrency((event.target as HTMLSelectElement).value as Currency);
  update();
});
$("#reload").addEventListener("click", () => location.reload());
closed.push((submitted) => submitted && void reloadAccounts());

// Whatever is missing, or from an epoch that has ended, so the page moves on by itself.
function catchUp(): void {
  if (session.accounts?.due()) session.accounts.check();
  matchaLatte.check();
  checks.check();
  doubleEspresso.check();
  // Last epoch's rewards name Hydrex's reward tokens, which the swap lists.
  if (earningsDue()) void loadEarnings().then(rewardsRead);
  const found = holdings();
  if (found) void loadShares(found);
  appPayouts.check();
  checkAccount();
  update();
}

matchaLatte.read().catch(failed);
checks.read().catch(failed);
catchUp();
setInterval(catchUp, 30_000);
