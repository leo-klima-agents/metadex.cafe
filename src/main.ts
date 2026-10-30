import { showTopics, type Topic } from "./chain.ts";
import { AUTOMATIONS } from "./config.ts";
import { clone, groupAllHex, pendAll } from "./dom.ts";
import { setCurrency, type Currency } from "./format.ts";
import type { Route } from "./routes.ts";
import { earningsDue, onEarnings } from "./last-epoch.ts";
import { initAccounts, showAccounts } from "./views/accounts.ts";
import { initApp, showApp } from "./views/app.ts";
import {
  doubleEspresso,
  checks,
  matchaLatte,
  loadAllEarnings,
  readAverage,
  showDoubleEspresso,
  showCountdown,
  showRecords,
} from "./views/automations.ts";
import { initConnection, loadAccounts } from "./views/connection.ts";
import { failed, hooks, session, views } from "./views/page.ts";
import { appPayouts } from "./views/payouts.ts";
import { catchUpPosition, initPosition, showPosition, showShares } from "./views/position.ts";
import { onRoute } from "./views/router.ts";
import { initSwap } from "./views/swap.ts";

// The page starts here: it marks pending what it will read, sets up each view, then reads Base, and again every half a
// minute whatever is due. Each view is in src/views/.

// Every page reads the same: what each view shows, as soon as what it needs is read. Only the order differs: the reads
// of what the page shown draws go first, and the others as slots free, so that each page opens with what the others
// show read, or under way. Home and About draw none.
const TOPICS: Record<Route["view"], Topic[]> = {
  home: [],
  about: [],
  // The payouts need what the automations earned; so do the swap's rows, which list Hydrex's rewards.
  app: ["earnings", "payouts", "swap"],
  hydrex: ["earnings", "average", "shares", "payouts"],
  // Each automation's page lists the wallet's accounts in it, with their late payouts and Double Espresso's claims.
  product: ["earnings", "average", "shares", "payouts"],
  position: ["earnings", "shares", "payouts"],
  swap: ["earnings", "swap"],
};
onRoute((route) => showTopics(TOPICS[route.view]));

// Where a list or a page is read, cards of bars where its items will show, three, or as many as the slot says, or the
// tiles of a page's key figures.
for (const slot of document.querySelectorAll<HTMLElement>(".loading-slot")) {
  const loading = clone("loading");
  const cards = loading.querySelector(".skeleton")!;
  cards.classList.toggle("tiles", "tiles" in slot.dataset);
  cards.append(...Array.from({ length: Number(slot.dataset.cards ?? 3) }, () => document.createElement("li")));
  slot.append(loading);
}
pendAll(document);
groupAllHex(document);
// The footer's currency, for the visit: every figure in money is drawn again in it.
const currencySelect = document.querySelector<HTMLSelectElement>("footer .currency")!;
currencySelect.addEventListener("change", () => setCurrency(currencySelect.value as Currency));
// A reload keeps the hash, and so the view.
document.querySelector("#error .again")!.addEventListener("click", () => location.reload());

// Each view sets how it is drawn again as it starts, before anything is read.
views.catchUp = catchUp;
initSwap({ connection: () => session.connection, hooks });
initAccounts();
initPosition();
initApp();
initConnection();

// Each read of figures, whoever started it, shows on the menu, on the automations' pages and in the accounts' shares:
// what an account in that automation earned, pending until then, or nothing once no epoch can be read.
onEarnings((_, outcome) => {
  void showShares();
  readAverage();
  showDoubleEspresso();
  showRecords();
  showApp();
  if (outcome === "same") return;
  showAccounts(true);
  showPosition();
});

// Reads again whatever is missing or from an epoch that has ended, so that the page moves on by itself.
function catchUp(): void {
  if (session.accounts?.due()) void loadAccounts(true);
  // The wallet's own account moves on with the wallet's accounts.
  catchUpPosition();
  matchaLatte.check();
  checks.check();
  if (earningsDue(AUTOMATIONS)) loadAllEarnings();
  readAverage();
  // Reads what the accounts' votes earned that failed before, once due again.
  void showShares();
  doubleEspresso.check();
  appPayouts.check();
}

function tick(): void {
  catchUp();
  showApp();
  showCountdown();
}

matchaLatte.read().catch(failed);
checks.read().catch(failed);
doubleEspresso.check();
loadAllEarnings();
readAverage();
setInterval(tick, 30_000);
