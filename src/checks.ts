import { memo, use } from "./cache.ts";
import * as config from "./config.ts";
import { AUTOMATIONS, type Kind } from "./config.ts";
import { escrow } from "./hydrex.ts";
import { implementation, read, readEach, required, rpc, same } from "./rpc.ts";

// For each automation, the ids of the checks that fail; `src/views/hydrex.ts` words each one for the page. The checks:
// the RPCs serve Base; Hydrex's VotingEscrow and its approval logic are the ones the page knows, since an upgrade could
// change what joining allows; and joining each automation is on and approves only its claims and votes. If a read
// fails, this throws, so the checks count as not read rather than failed.
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
// Swaps are off while the RPCs serve a chain other than Base. `undefined` until the checks are read.
export const swapsOff = (): boolean | undefined => {
  const found = checks().value;
  return found && [...found.values()].some((failed) => failed.includes("chain"));
};
