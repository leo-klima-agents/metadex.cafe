import { AUTOMATIONS } from "../config.ts";
import { count, money } from "../format.ts";
import { canLeave, hasVotes, otherName, statusOf, type Account } from "../hydrex.ts";
import { overdue } from "../payouts.ts";
import { now } from "../rpc.ts";
import { same } from "../util.ts";
import { $, fill, list, setState, type Value } from "./dom.ts";
import { review } from "./hydrex.ts";
import { waitsWords } from "./account.ts";
import { openClaim } from "./claim.ts";
import { hrefOf } from "./router.ts";
import { appPayouts, holdings, session } from "./session.ts";
import { allowancesLeft, resetReview, swapLine } from "./swap.ts";

const view = $(".view[data-view=app]");
type Need = {
  key: string;
  shape: string;
  words: string;
  link?: [string, string];
  button?: [string, (button: HTMLElement) => void];
};

// What needs the wallet, across the products, each with one action.
function needs(): Need[] | undefined {
  const found = holdings();
  if (!found) return undefined;
  const items: Need[] = [];
  const toHydrex: [string, string] = [hrefOf({ view: "hydrex" }), "Change"];
  const statuses = found.accounts
    .filter(hasVotes)
    .map((account) => ({ account, status: statusOf(account, found.owner, now(), found.epochStart) }));
  const unvoted = statuses.filter(({ status }) => status.kind === "unvoted").length;
  const stopped = statuses.filter(({ status }) => status.kind === "stopped").length;
  if (unvoted)
    items.push({
      key: "unvoted",
      shape: "stopped",
      words: `${count(unvoted, "Hydrex account", "Hydrex accounts")} didn't vote last epoch`,
      link: toHydrex,
    });
  if (stopped)
    items.push({
      key: "stopped",
      shape: "stopped",
      words: `${count(stopped, "Hydrex account", "Hydrex accounts")} in ${stopped === 1 ? "a stopped automation" : "stopped automations"}`,
      link: toHydrex,
    });
  for (const { account, status } of statuses)
    if (status.kind === "partly")
      items.push({
        key: `partly ${account.id}`,
        shape: "stopped",
        words: `Hydrex account #${account.id} is partly in ${status.automation.name}`,
        link: [hrefOf({ view: "account", id: account.id }), "Change"],
      });
  for (const entry of appPayouts.found?.entries ?? [])
    if (overdue(appPayouts.found, entry))
      items.push({
        key: `overdue ${entry.account.id}`,
        shape: "stopped",
        words: `Hydrex account #${entry.account.id}: payout overdue, ${waitsWords(entry, appPayouts.found)}`,
        button: ["Claim now", (button) => void openClaim([entry], button)],
      });
  const left = allowancesLeft();
  if (left?.length)
    items.push({
      key: "approvals",
      shape: "idle",
      words: `${count(left.length, "token approval hasn't", "token approvals haven't")} been used`,
      button: ["Reset", () => void resetReview(allowancesLeft() ?? [])],
    });
  return items;
}

// What the wallet lets the automations do, each with the call that undoes it.
function allows(accounts: Account[]) {
  return accounts.flatMap((account) => [
    ...AUTOMATIONS.filter((automation) => canLeave(account, automation)).map((automation) => {
      const [votes, claims] = [same(account.delegate, automation.address), same(account.claimer, automation.address)];
      return {
        account,
        words: `Hydrex account #${account.id} · ${automation.name}: ${votes && claims ? "votes and claims" : votes ? "votes" : "claims"}`,
      };
    }),
    ...(otherName(account.delegate)
      ? [{ account, words: `Hydrex account #${account.id} · ${otherName(account.delegate)}: votes` }]
      : []),
  ]);
}

export function renderApp(): void {
  const found = holdings();
  const items = needs();
  const box = $("#needs");
  setState(box, !items ? (session.accounts?.failed ? "empty" : "loading") : items.length ? "ready" : "empty");
  fill(box, { "needs-count": items?.length ? `· ${items.length}` : "" });
  list(
    $("#needs-list"),
    "need",
    items ?? [],
    ({ key }) => key,
    (row, need) => {
      $(".shape", row).dataset.shape = need.shape;
      fill(row, {
        words: need.words,
        link: need.link ? { text: need.link[1], href: need.link[0] } : "",
        button: need.button?.[0] ?? "",
      });
      $("a", row).hidden = !need.link;
      $("button", row).hidden = !need.button;
      $("button", row).onclick = (event) => need.button?.[1](event.currentTarget as HTMLElement);
    },
  );
  const full = found?.accounts.filter(({ amount }) => amount > 0n) ?? [];
  const inEach = AUTOMATIONS.flatMap((automation) => {
    const n = full.filter((account) => {
      const status = statusOf(account, found!.owner, now(), found!.epochStart);
      return (status.kind === "in" || status.kind === "joined") && status.automation === automation;
    }).length;
    return n ? [`${n} in ${automation.name}`] : [];
  });
  const line = swapLine();
  const swapYours: Value = !session.connection
    ? ""
    : !line || (line.reading && !line.count)
      ? undefined
      : line.failed
        ? "Not read"
        : line.count
          ? `${count(line.count, "token", "tokens")} · ${money(line.worth)}${line.reading ? " so far" : ""}`
          : "Nothing to swap";
  fill(view, {
    "hydrex-yours":
      !session.connection || session.accounts?.failed
        ? ""
        : found
          ? [count(full.length, "Hydrex account", "Hydrex accounts"), ...inEach].join(" · ")
          : undefined,
    "swap-yours": swapYours,
  });
  list(
    $("#allows-accounts"),
    "allowance",
    allows(found?.accounts ?? []),
    ({ words }) => words,
    (row, { account, words }) => {
      fill(row, { words, button: "Leave" });
      $("button", row).onclick = () => review([account], "leave", undefined);
    },
  );
}
