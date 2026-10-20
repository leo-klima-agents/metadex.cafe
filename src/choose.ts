import { clone, fill, fillPlural, show } from "./dom.ts";
import { usd } from "./format.ts";

// Choose: for the accounts picked, each automation that fits them and voting yourself, with last epoch's figures per
// 1,000 Earning Power, what that rate would pay them in a week, and the gas of the change. A table compares the facts.

export const FACTS = ["pays", "taken", "most", "leaving"] as const;
export type Fact = (typeof FACTS)[number];

export type Option = {
  name: string;
  // Last epoch's dollars per 1,000 Earning Power once read, null for an automation with no record yet, or undefined
  // for voting yourself, which depends on the votes.
  perThousand: Promise<number | null> | undefined;
  // The share of it paid to the owner.
  paidShare: number;
  // Each fact, as the page itself states it.
  facts: Record<Fact, Node[]>;
  // Whether the accounts are all in it already.
  now: boolean;
  // The button, if the accounts can move to it, with the dollars of gas the calls cost.
  pick?: { label: string; gas: Promise<number | undefined>; go(): void };
};

const dialog = document.getElementById("choose") as HTMLDialogElement;

// `power` is the accounts' Earning Power, with 18 decimals.
export function openChoose(which: string, n: number, power: bigint, options: Option[]): void {
  fill(dialog, { "choose-which": which });
  const thousands = Number(power) / 1e21;
  dialog.querySelector(".options")!.replaceChildren(
    ...options.map(({ name, perThousand, paidShare, now, pick }) => {
      const item = clone("option");
      fillPlural(item, n);
      fill(item, {
        "option-name": name,
        "option-per-power": perThousand ? "…" : "Depends on your votes",
        "option-week": perThousand ? "…" : "—",
        "option-gas": pick ? "…" : "—",
      });
      const [rate, week] = [".option-per-power", ".option-week"].map((part) => item.querySelector(part)!) as [
        Element,
        Element,
      ];
      perThousand?.then(
        (value) => {
          rate.textContent = value === null ? "No record yet" : usd(value);
          week.textContent = value === null ? "—" : `${usd(value * thousands * paidShare)} paid to you`;
        },
        () => (rate.textContent = week.textContent = "Not read yet"),
      );
      show(".option-now", now, item);
      const button = item.querySelector<HTMLButtonElement>(".option-pick")!;
      button.hidden = !pick;
      if (pick) {
        const gas = item.querySelector(".option-gas")!;
        button.textContent = pick.label;
        button.addEventListener("click", () => {
          dialog.close();
          pick.go();
        });
        pick.gas.then(
          (dollars) => (gas.textContent = dollars === undefined ? "Not known" : usd(dollars)),
          () => (gas.textContent = "Not known"),
        );
      }
      return item;
    }),
  );
  const row = (name: string, cells: (string | Node)[][], header = false) =>
    dialog.querySelector(`.compare-${name}`)!.replaceChildren(
      ...(header ? [document.createElement("td")] : [dialog.querySelector(`.compare-${name} th`)!]),
      ...cells.map((content) => {
        const cell = document.createElement(header ? "th" : "td");
        if (header) cell.scope = "col";
        cell.replaceChildren(...content);
        return cell;
      }),
    );
  row(
    "names",
    options.map(({ name }) => [name]),
    true,
  );
  for (const fact of FACTS) {
    row(
      fact,
      options.map(({ facts }) => facts[fact]),
    );
  }
  dialog.showModal();
}

// A change of wallet, or of its address, closes it: its accounts are another owner's.
export const closeChoose = (): void => dialog.close();

dialog.querySelector(".choose-close")!.addEventListener("click", () => dialog.close());
// A link closes the dialog, so that its target shows.
dialog.addEventListener("click", (event) => {
  if ((event.target as Element).closest('a[href^="#"]')) dialog.close();
});
