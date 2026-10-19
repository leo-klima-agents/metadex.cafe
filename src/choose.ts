import { now } from "./chain.ts";
import { fill, fillPlural, show } from "./dom.ts";
import { feeFacts, showFeeFacts } from "./fee-facts.ts";
import { bps, count, day, earningPower, list, share, toEarningPower, usd } from "./format.ts";
import { gasCost } from "./gas.ts";
import {
  callsFor,
  statusOf,
  type Account,
  type CarbonImpact,
  type Choice,
  type Holdings,
  type Status,
} from "./hydrex.ts";
import { compare, lastPerThousand } from "./last-epoch.ts";

// Choose: for the accounts picked, voting yourself or Carbon Impact, each with what last epoch's votes earned per
// 1,000 Earning Power at the same prices, what that is for these accounts in a week, and the gas of its calls. Neither
// is picked to begin with.

export type Context = {
  holdings: Holdings;
  accounts: Account[];
  carbonImpact: CarbonImpact | undefined;
  // Whether the page's checks passed, so that joining is on.
  trusted: boolean;
  proceed(choice: Choice, accounts: Account[]): void;
};

const CHOICES: Choice[] = ["self", "join"];

const dialog = document.getElementById("choose") as HTMLDialogElement;
const part = <T extends HTMLElement = HTMLElement>(selector: string) => dialog.querySelector<T>(selector)!;
const title = part("h2");
const states = part(".now");
const proceed = part<HTMLButtonElement>(".continue");
const radio = (choice: Choice) => part<HTMLInputElement>(`input[value="${choice}"]`);
// The gas of each choice's calls, null if it could not be estimated; and the read of the average on Hydrex.
type State = Context & { gas: Map<Choice, number | null>; average: "unread" | "reading" | "read" | "failed" };
let current: State | undefined;

const ids = (accounts: Account[]) => list(accounts.map(({ id }) => `#${id}`));
const is = (accounts: Account[]) => (accounts.length === 1 ? "is" : "are");

// Where the accounts are now, a line for each kind of status.
function describe(accounts: Account[], { owner, epochStart }: Holdings): string[] {
  const byKind = new Map<Status["kind"], { accounts: Account[]; statuses: Status[] }>();
  for (const account of accounts) {
    const status = statusOf(account, owner, now(), epochStart);
    const kind = status.kind === "joined" ? "in" : status.kind === "left-other" ? "self" : status.kind;
    const entry = byKind.get(kind) ?? { accounts: [], statuses: [] };
    entry.accounts.push(account);
    entry.statuses.push(status);
    byKind.set(kind, entry);
  }
  return [...byKind].map(([kind, { accounts: members, statuses }]) => {
    const which = ids(members);
    const names = list([...new Set(statuses.flatMap((status) => ("name" in status ? [status.name] : [])))]);
    switch (kind) {
      case "stopped": {
        const since = Math.min(...statuses.map((status) => ("since" in status ? status.since : Infinity)));
        return `${which} ${is(members)} in ${names}, which stopped voting: ${members.length === 1 ? "it has" : "they have"} earned nothing since ${day(since)}.`;
      }
      case "other":
        return `${which} ${is(members)} in ${names}.`;
      case "in":
        return `${which} ${is(members)} in Carbon Impact.`;
      case "partly":
        return `${which} ${is(members)} only partly in Carbon Impact.`;
      case "left":
        return `${which} ${is(members)} leaving Carbon Impact.`;
      case "self":
        return `${which} ${members.length === 1 ? "votes" : "vote"} with you.`;
      case "delegated":
        return `${which} ${is(members)} delegated to an address this page does not know, and cannot change.`;
      default:
        return `${which} ${members.length === 1 ? "has" : "have"} no votes to give.`;
    }
  });
}

// The average on Hydrex takes thousands of reads, after Carbon Impact's figures: they start once Choose opens.
function readAverage(state: State): void {
  if (state.average !== "unread" || !lastPerThousand()) return;
  state.average = "reading";
  void compare().then((read) => {
    state.average = read ? "read" : "failed";
    refreshChoose();
  });
}

function render({ accounts, carbonImpact, trusted, gas, average }: State): void {
  const time = now();
  const votes = accounts.reduce((sum, account) => sum + account.votes, 0n);
  const thousands = Number(toEarningPower(votes)) / 1e21;
  const power = `${earningPower(votes)} Earning Power`;
  const per = lastPerThousand();
  const kept = carbonImpact ? (1 - Number(carbonImpact.retireBps) / 1e4) * (1 - Number(carbonImpact.feeBps) / 1e4) : 0;
  fill(dialog, {
    "self-figures":
      per?.all !== undefined
        ? `Last epoch, the average on Hydrex was ${usd(per.all)} per 1,000 Earning Power: ${usd(per.all * thousands)} for ${power}.`
        : average === "failed"
          ? "What the average on Hydrex earned last epoch could not be read from Base."
          : "Reading what the average on Hydrex earned last epoch…",
    "join-figures":
      per && carbonImpact
        ? `Last epoch, its votes earned ${usd(per.ours)} per 1,000 Earning Power: ${usd(per.ours * thousands)} for ${power}, of which ${usd(per.ours * thousands * kept)} would have reached you.`
        : "What its votes earned last epoch is not read from Base yet.",
  });
  show(".same-prices", per?.all !== undefined, dialog);
  fill(dialog, {
    "retired-share": carbonImpact ? share(carbonImpact.retireBps) : "a share",
    "compare-retired": carbonImpact ? bps(carbonImpact.retireBps) : "…",
    "compare-fee": carbonImpact ? bps(carbonImpact.feeBps) : "…",
    "compare-max-fee": carbonImpact ? bps(carbonImpact.maxFeeBps) : "…",
  });
  const facts = part(".facts-here");
  if (carbonImpact && facts.firstElementChild) showFeeFacts(facts, carbonImpact);
  else if (carbonImpact) facts.replaceChildren(feeFacts(carbonImpact));
  show(".facts-fold", !!carbonImpact, dialog);
  for (const choice of CHOICES) {
    const steps = callsFor(choice, accounts, time);
    const off = choice === "join" && !trusted;
    const input = radio(choice);
    input.disabled = off || !steps.length;
    if (input.disabled) input.checked = false;
    const cost = gas.get(choice);
    const gasText =
      cost === undefined ? "gas being estimated…" : cost === null ? "gas not estimated" : `${usd(cost)} in gas`;
    const calls = off
      ? "Joining is off: this page's checks of Carbon Impact failed."
      : steps.length
        ? `${count(steps.length, "call", "calls")}, ${gasText}.`
        : choice === "join"
          ? "Nothing to change: Carbon Impact can't take more of them."
          : "Nothing this page can change for them.";
    fill(dialog.querySelector(`[data-choice="${choice}"]`)!, { calls });
  }
  proceed.disabled = !CHOICES.some((choice) => radio(choice).checked);
}

// Shows the dialog again, with what was read since it opened.
export function refreshChoose(read: Partial<Pick<Context, "carbonImpact" | "trusted">> = {}): void {
  if (!current || !dialog.open) return;
  Object.assign(current, read);
  readAverage(current);
  render(current);
}

export function openChoose(context: Context): void {
  const { holdings, accounts } = context;
  const state: State = { ...context, gas: new Map(), average: "unread" };
  current = state;
  fill(dialog, { which: ids(accounts), "choose-count": count(accounts.length, "account", "accounts") });
  fillPlural(dialog, accounts.length);
  states.replaceChildren(
    ...describe(accounts, holdings).map((text) => {
      const item = document.createElement("li");
      item.textContent = text;
      return item;
    }),
  );
  part(".facts-here").replaceChildren();
  for (const fold of dialog.querySelectorAll("details")) fold.open = false;
  for (const choice of CHOICES) radio(choice).checked = false;
  dialog.showModal();
  title.focus();
  refreshChoose();
  for (const choice of CHOICES) {
    const steps = callsFor(choice, accounts, now());
    if (!steps.length) continue;
    gasCost(holdings.owner, steps)
      .then(
        (cost) => state.gas.set(choice, cost),
        (error) => {
          console.error(error);
          state.gas.set(choice, null);
        },
      )
      .finally(() => state === current && refreshChoose());
  }
}

export const closeChoose = (): void => dialog.close();

dialog.addEventListener("change", () => current && render(current));
proceed.addEventListener("click", () => {
  const state = current;
  const choice = CHOICES.find((option) => radio(option).checked);
  if (!state || !choice) return;
  closeChoose();
  state.proceed(choice, state.accounts);
});
part(".cancel").addEventListener("click", closeChoose);
// A link to a section closes the dialog, so that the section shows.
dialog.addEventListener("click", (event) => {
  if ((event.target as Element).closest('a[href^="#"]')) closeChoose();
});
dialog.addEventListener("close", () => (current = undefined));
