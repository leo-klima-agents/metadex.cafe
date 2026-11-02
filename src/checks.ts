import { memo, use } from "./cache.ts";
import * as config from "./config.ts";
import { AUTOMATIONS, type Kind } from "./config.ts";
import { escrow } from "./hydrex.ts";
import { implementation, read, readEach, required, rpc, same } from "./rpc.ts";

// What the page checks of Base before it lets anyone join an automation or swap, read again every hour.

// The checks that fail, by the id of their message on the page, for each automation: whether the RPCs serve Base;
// whether Hydrex's VotingEscrow and its approval logic are those the page knows, as an upgrade could change what
// joining allows; and whether joining each automation is on, and approves its claims and votes only. A read that fails
// fails them all, as not read, rather than as a check.
export async function failedChecks(): Promise<Map<Kind, string[]>> {
  const [chainId, impl, [logic], configs] = await Promise.all([
    rpc<string>("eth_chainId", []),
    implementation(config.VOTING_ESCROW),
    read([escrow("approvalLogic")]).then(required),
    readEach(AUTOMATIONS, { config: ({ address }) => escrow("getConduitApprovalConfig", address) }),
  ]);
  const failing = (checks: Record<string, boolean>) =>
    Object.entries(checks).flatMap(([id, fails]) => (fails ? [id] : []));
  const all = failing({
    chain: Number(chainId) !== config.CHAIN_ID,
    upgrade: !same(impl, config.VOTING_ESCROW_IMPLEMENTATION),
    logic: !same(logic, config.APPROVAL_LOGIC),
  });
  return new Map(
    configs.map(({ item: { kind, actions }, config }) => {
      const [approved, active] = required([config])[0];
      const id = kind === "matcha-latte" ? "approvals" : `${kind}-approvals`;
      return [kind, [...all, ...failing({ [id]: !active || approved.join() !== actions.join() })]];
    }),
  );
}

const HOUR = 3_600_000;
export const checks = () => use("checks", failedChecks, HOUR);
export const checksRead = () => memo("checks", failedChecks, HOUR);
// Swaps are off while the RPCs serve another chain than Base; undefined until the checks are read.
export const swapsOff = (): boolean | undefined => {
  const found = checks().value;
  return found && [...found.values()].some((failed) => failed.includes("chain"));
};
