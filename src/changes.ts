import { encodeEventTopics, numberToHex, pad, parseAbi, toFunctionSelector, type Address, type Hex } from "viem";
import { blockNumber, blockTime, read, readLater, required, rpc, same } from "./chain.ts";
import { ADMIN, CONDUIT, KEEPER } from "./config.ts";
import { WEEK, weekStart } from "./format.ts";
import { ADMIN_ROLE, KEEPER_ROLE, conduit, escrow } from "./hydrex.ts";
import { blockTimes, changes } from "./receipts.ts";

// Carbon Impact's admin key can change its settings at any time, and only some of its changes emit an event. So the
// page finds changes by their effect, as it finds payouts: it reads the settings at the start of each of the last four
// epochs and now, and narrows each stretch where they differ down to the block, which holds the change's transaction.
// A change undone before the next of those reads does not show.

export const EPOCHS = 4;
// A list has no length to read: the page reads this many entries, more than Carbon Impact has ever listed.
const LISTED = 8;
// The newest blocks are skipped: an RPC that is a little behind may not have them yet.
const SETTLED = 5;

export const SETTINGS = [
  "retired",
  "fee",
  "treasury",
  "tokens",
  "routers",
  "credit",
  "names",
  "admin",
  "keeper",
  "approvals",
] as const;
export type Setting = (typeof SETTINGS)[number];
// Each setting as a list of strings, so that two reads compare as text.
export type Settings = Record<Setting, string[]>;

export type Change = {
  block: number;
  time: number;
  txs: Hex[];
  settings: Setting[];
  before: Settings;
  after: Settings;
};
export type PayoutChange = { block: number; time: number; txs: Hex[]; before: Address; after: Address; by?: Address };
// What was searched: from the start of the epoch three before the one at `top`, which is `since`.
export type Window = { since: number; top: number; points: number[] };

const eventsAbi = parseAbi([
  "event PayoutRecipientUpdated(address indexed user, address indexed newRecipient, address indexed updatedBy)",
]);
const PAYOUT_UPDATED = encodeEventTopics({ abi: eventsAbi, eventName: "PayoutRecipientUpdated" })[0];
// The keeper's calls to Carbon Impact, which change no setting.
const KEEPER_CALLS = [
  "function claimSwapAndDistribute(uint256 veTokenId, address[] targets, bytes[] swaps, address[] feeAddresses, address[] bribeAddresses, address[] claimTokens, uint256 retireTonnes, uint256 maxKvcmIn)",
  "function vote(address[] pools, uint256[] weights)",
].map(toFunctionSelector);

const listed = (name: string) => Array.from({ length: LISTED }, (_, i) => conduit(name, BigInt(i)));
const PARTS: Record<Setting, ReturnType<typeof conduit>[]> = {
  retired: [conduit("retireBps")],
  fee: [conduit("treasuryFeeBps")],
  treasury: [conduit("treasury")],
  tokens: listed("distributionTokens"),
  routers: listed("approvedRouters"),
  credit: ["retirementAggregator", "aam", "creditToken", "carbonClass", "creditTokenId", "batchId"].map((name) =>
    conduit(name),
  ),
  names: ["retiringEntityName", "impactBeneficiaryAddress", "beneficiaryString", "retirementMessage"].map((name) =>
    conduit(name),
  ),
  admin: [conduit("hasRole", ADMIN_ROLE, ADMIN)],
  keeper: [conduit("hasRole", KEEPER_ROLE, KEEPER)],
  approvals: [escrow("getConduitApprovalConfig", CONDUIT)],
};

// A tuple, such as what joining approves, gives a string per part, and a list within it one string.
const text = (value: unknown): string[] =>
  Array.isArray(value) ? value.map((part) => (Array.isArray(part) ? part.join(", ") : String(part))) : [String(value)];

// The settings from the reads of PARTS, in its order. A list ends at its first entry that cannot be read; anything
// else must be read.
export function settingsOf(values: unknown[]): Settings {
  let k = 0;
  return Object.fromEntries(
    SETTINGS.map((setting) => {
      const found = values.slice(k, (k += PARTS[setting].length));
      if (setting === "tokens" || setting === "routers") {
        const end = found.indexOf(undefined);
        return [setting, found.slice(0, end < 0 ? undefined : end).map(String)];
      }
      return [setting, required(found).flatMap(text)];
    }),
  ) as Settings;
}

export const settingsAt = async (block: number): Promise<Settings> =>
  settingsOf(await readLater(Object.values(PARTS).flat(), block));

export const changed = (before: Settings, after: Settings): Setting[] =>
  SETTINGS.filter((setting) => before[setting].join("\n") !== after[setting].join("\n"));

// The blocks where the epochs of the window start, and the last settled block. Base makes a block every two seconds.
export async function searchWindow(): Promise<Window> {
  const [latest, time] = required(await read([blockNumber, blockTime])) as bigint[];
  const top = Number(latest) - SETTLED;
  const topTime = Number(time) - 2 * SETTLED;
  const epoch = weekStart(topTime);
  const starts = Array.from({ length: EPOCHS }, (_, i) => epoch - (EPOCHS - 1 - i) * WEEK);
  const points = [...starts.map((start) => top - Math.ceil((topTime - start) / 2)), top];
  return { since: starts[0]!, top, points: points.filter((point, i) => point > 0 && point !== points[i - 1]) };
}

// Each block within the points at which `at` changed, with its value just before and at that block.
export async function changedBlocks<T>(
  at: (block: number) => Promise<T>,
  points: number[],
): Promise<{ block: number; before: T; after: T }[]> {
  const seen = new Map<number, T>();
  const key = async (block: number): Promise<string> => {
    if (!seen.has(block)) seen.set(block, await at(block));
    return JSON.stringify(seen.get(block));
  };
  const keys = await Promise.all(points.map(key));
  const stretches = await Promise.all(
    points.slice(1).map((to, i) => changes(key, points[i]!, to, keys[i]!, keys[i + 1]!, 1)),
  );
  // A stretch of one block: the value at the block before it was read on the way down.
  return stretches.flat().map(([, block]) => ({ block, before: seen.get(block - 1)!, after: seen.get(block)! }));
}

type Block = { transactions: { hash: Hex; to: Address | null; input: Hex }[] };

// The transactions in the block that called Carbon Impact other than as its keeper. An admin key that calls it
// through another contract leaves none: the page then links to the block.
async function settingTxs(block: number): Promise<Hex[]> {
  const { transactions } = await rpc<Block>("eth_getBlockByNumber", [numberToHex(block), true], { later: true });
  return transactions
    .filter(({ to, input }) => to && same(to, CONDUIT) && !KEEPER_CALLS.includes(input.slice(0, 10) as Hex))
    .map(({ hash }) => hash);
}

export async function settingsChanges(window: Window): Promise<Change[]> {
  const found = (await changedBlocks(settingsAt, window.points)).map((change) => ({
    ...change,
    settings: changed(change.before, change.after),
  }));
  const blocks = found.map(({ block }) => block);
  const [times, txs] = await Promise.all([blockTimes(blocks), Promise.all(blocks.map(settingTxs))]);
  return found.map((change, i) => ({ ...change, time: times.get(change.block)!, txs: txs[i]! }));
}

type Log = { topics: Hex[]; transactionHash: Hex };

// Changes to where the owner's payouts go. Each emits an event that names who made it: the owner, or the admin key.
export async function payoutChanges(owner: Address, window: Window): Promise<PayoutChange[]> {
  const at = async (block: number): Promise<Address> => {
    const [payout] = required(await readLater([conduit("getEffectiveRecipientForOwner", owner)], block));
    return payout as Address;
  };
  const found = await changedBlocks(at, window.points);
  const blocks = found.map(({ block }) => block);
  const [times, logs] = await Promise.all([
    blockTimes(blocks),
    Promise.all(
      blocks.map((block) =>
        rpc<Log[]>(
          "eth_getLogs",
          [
            {
              address: CONDUIT,
              topics: [PAYOUT_UPDATED, pad(owner)],
              fromBlock: numberToHex(block),
              toBlock: numberToHex(block),
            },
          ],
          { later: true },
        ),
      ),
    ),
  ]);
  return found.map(({ block, before, after }, i) => {
    const events = logs[i]!;
    const by = events.at(-1)?.topics[3];
    return {
      block,
      time: times.get(block)!,
      txs: [...new Set(events.map(({ transactionHash }) => transactionHash))],
      before,
      after,
      ...(by && { by: `0x${by.slice(-40)}` as Address }),
    };
  });
}
