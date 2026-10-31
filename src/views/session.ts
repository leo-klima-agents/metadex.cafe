import type { Address } from "viem";
import { DOUBLE_ESPRESSO, type Automation } from "../config.ts";
import { weekStart } from "../format.ts";
import { failedChecks, paidBpsOf, readAccounts, readFreshness, readMatchaLatte, type Holdings } from "../hydrex.ts";
import { payouts } from "../payouts.ts";
import { now, sawBlock } from "../rpc.ts";
import { RETRY, SOON, reader, type Reader } from "../state.ts";
import { same } from "../util.ts";
import type { Connection } from "../wallet.ts";

// What every view shares: the wallet, its Hydrex accounts and payouts, and the automations' state.
export const session: { connection?: Connection | undefined; accounts?: Reader<Holdings> | undefined } = {};
export const holdings = (): Holdings | undefined => session.accounts?.value;
export const owns = (owner: Address): boolean => !!session.connection && same(owner, session.connection.address);
export const appPayouts = payouts();

export function useWallet(connection: Connection | undefined): void {
  session.accounts?.forget();
  session.connection = connection;
  appPayouts.forget();
  session.accounts =
    connection &&
    reader(() => readAccounts(connection.address), { stale: (found) => weekStart(now()) > found.epochStart });
}
// Reads the wallet's accounts again, as after a transaction: what was read stays until then.
export async function reloadAccounts(): Promise<void> {
  const found = await session.accounts?.refresh().catch(() => undefined);
  if (!found) return;
  sawBlock(found.time);
  void appPayouts.load(found);
}

const newEpoch = (found: { epochStart: number }) => weekStart(now()) > found.epochStart;
// Matcha Latte's settings, again in each new epoch, and five minutes after a read that left some unread.
export const matchaLatte = reader(readMatchaLatte, {
  retry: SOON,
  stale: (found, since) =>
    newEpoch(found) ||
    ([found.voted, found.feeBps, found.maxFeeBps, found.feeRecipient].includes(undefined) && since >= RETRY),
});
export const doubleEspresso = reader(() => readFreshness(DOUBLE_ESPRESSO), { retry: SOON, stale: newEpoch });
// Until the checks have run, joining and swaps are off. They run again each hour.
export const checks = reader(failedChecks, { retry: SOON, stale: (_, since) => since >= 3_600_000 });
export const joinable = ({ kind }: Automation): boolean => checks.value?.get(kind)?.length === 0;
export const swapsOff = (): boolean => !checks.value || checks.value.get(DOUBLE_ESPRESSO.kind)!.includes("chain");

// The share of what an automation's votes earn that reaches the owner, once known.
export function paidShare({ kind }: Automation): number | undefined {
  if (kind === DOUBLE_ESPRESSO.kind) return 0.99;
  const paid = matchaLatte.value && paidBpsOf(matchaLatte.value);
  return paid === undefined ? undefined : Number(paid) / 10_000;
}

export function failed(error: unknown): void {
  console.error(error);
  document.getElementById("error")!.hidden = false;
}
