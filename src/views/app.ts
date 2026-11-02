import { AUTOMATIONS } from "../config.ts";
import * as data from "../data.ts";
import { count } from "../format.ts";
import * as hydrex from "../hydrex.ts";
import { overdue } from "../payouts.ts";
import { hrefOf } from "../routes.ts";
import { now, same } from "../rpc.ts";
import { actions, state } from "../state.ts";
import { $, fill, frag, link, list, shown, stateOf, status, type Value } from "../ui.ts";
import { waitsWords } from "./account.ts";
import { change } from "./hydrex.ts";
import { openClaim } from "./claim.ts";
import { allowances, drawAllowances, swapLine } from "./swap.ts";

const view = $('[data-view="app"]');
type Need = { key: string; shape: string; words: string; act: Value };

export function drawApp(): void {
  const holdings = data.accounts();
  const found = holdings.value && data.payouts(holdings.value).value;
  const needs: Need[] = [];
  const button = (text: string, action: string, arg = "") => {
    const el = Object.assign(document.createElement("button"), {
      type: "button",
      className: "Button--secondary Button--compact",
      textContent: text,
    });
    el.dataset.action = action;
    el.dataset.arg = arg;
    return el;
  };
  // A link that does a button's job is drawn as one.
  const changeLink = (href: string) =>
    Object.assign(link(href, "Change"), { className: "Button Button--secondary Button--compact" });
  const toHydrex = changeLink(hrefOf({ view: "hydrex" }));
  if (holdings.value) {
    const { owner, accounts, epochStart } = holdings.value;
    const statuses = accounts
      .filter(hydrex.hasVotes)
      .map((account) => ({ account, status: hydrex.statusOf(account, owner, now(), epochStart) }));
    const unvoted = statuses.filter(({ status }) => status.kind === "unvoted").length;
    const stopped = statuses.filter(({ status }) => status.kind === "stopped").length;
    if (unvoted)
      needs.push({
        key: "unvoted",
        shape: "stopped",
        words: `${count(unvoted, "Hydrex account", "Hydrex accounts")} didn't vote last epoch`,
        act: toHydrex,
      });
    if (stopped)
      needs.push({
        key: "stopped",
        shape: "stopped",
        words: `${count(stopped, "Hydrex account", "Hydrex accounts")} in ${stopped === 1 ? "a stopped automation" : "stopped automations"}`,
        act: changeLink(hrefOf({ view: "hydrex" })),
      });
    for (const { account, status: st } of statuses)
      if (st.kind === "partly")
        needs.push({
          key: `partly ${account.id}`,
          shape: "stopped",
          words: `Hydrex account #${account.id} is partly in ${st.automation.name}`,
          act: changeLink(hrefOf({ view: "account", id: account.id })),
        });
    for (const entry of found ? overdue(found) : [])
      needs.push({
        key: `overdue ${entry.account.id}`,
        shape: "stopped",
        words: `Hydrex account #${entry.account.id}: payout overdue, ${waitsWords(entry.standing, found!)}`,
        act: button("Claim now", "claim-app", String(entry.account.id)),
      });
  }
  const left = allowances().value ?? [];
  if (left.length)
    needs.push({
      key: "allowances",
      shape: "idle",
      words: `${count(left.length, "token approval hasn't", "token approvals haven't")} been used`,
      act: button("Reset", "reset", "all"),
    });
  fill(view, {
    needs: stateOf(holdings, !needs.length),
    "needs-count": needs.length ? String(needs.length) : "",
    "swap-yours": state.connection ? swapLine() : null,
    "hydrex-yours": !state.connection
      ? null
      : shown(holdings, ({ owner, accounts, epochStart }) => {
          const full = accounts.filter(({ amount }) => amount > 0n);
          const counts = AUTOMATIONS.flatMap((automation) => {
            const n = full.filter((account) => {
              const st = hydrex.statusOf(account, owner, now(), epochStart);
              return (st.kind === "in" || st.kind === "joined") && st.automation === automation;
            }).length;
            return n ? [`${n} in ${automation.name}`] : [];
          });
          return [count(full.length, "Hydrex account", "Hydrex accounts"), ...counts].join(" · ");
        }),
  });
  list(
    $("[data-list=need]", view),
    needs,
    ({ key }) => key,
    (li, need) => fill(li, { words: frag(status(need.shape, ""), need.words), act: need.act }),
  );
  const approvals = (holdings.value?.accounts ?? []).flatMap((account) => [
    ...AUTOMATIONS.filter((automation) => hydrex.canLeave(account, automation)).map((automation) => {
      const votes = same(account.delegate, automation.address);
      const claims = same(account.claimer, automation.address);
      return {
        account,
        words: `Hydrex account #${account.id} · ${automation.name}: ${votes && claims ? "votes and claims" : votes ? "votes" : "claims"}`,
        action: "leave",
      };
    }),
    ...(hydrex.otherName(account.delegate)
      ? [
          {
            account,
            words: `Hydrex account #${account.id} · ${hydrex.otherName(account.delegate)}: votes`,
            action: "self",
          },
        ]
      : []),
  ]);
  list(
    $("[data-list=approval]", view),
    approvals,
    ({ words }) => words,
    (li, { words, account, action }) => {
      fill(li, { words });
      li.querySelector("button")!.dataset.arg = `${action} ${account.id}`;
    },
  );
  drawAllowances($("[data-list=allowance]", view));
}

actions.approval = (el) => {
  const [action, id] = el.dataset.arg!.split(" ");
  const account = data.accounts().value?.accounts.find((each) => each.id === BigInt(id!));
  if (account) change([account], action as "leave" | "self");
};
actions["claim-app"] = (el) => {
  const holdings = data.accounts().value;
  const found = holdings && data.payouts(holdings).value;
  const entry = found && overdue(found).find(({ account }) => String(account.id) === el.dataset.arg);
  if (entry) void openClaim([entry]);
};
