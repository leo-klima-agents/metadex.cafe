import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { encodeAbiParameters, encodeEventTopics, parseAbi, parseAbiParameters, type Address, type Hex } from "viem";
import { resetRateLimits } from "../src/chain.ts";
import { WALK_LIMIT, claimsOf, forgetClaims, readClaimsAt, totals, walkClaims, type Claim } from "../src/claims.ts";
import type { Log } from "../src/receipts.ts";

const abi = parseAbi([
  "event Claimed(uint256 indexed tokenId, address indexed owner, address indexed caller, address[] tokens, uint256[] amounts, uint256[] fees, uint256 previousClaimBlock)",
]);
const OWNER: Address = "0x60924601E73EBc5C2Bd9244c788d93e0710a6c93";
const KEEPER: Address = "0x40FBFe5312330f278824ddbB7521ab77409192f0";
const STRANGER: Address = "0x000000000000000000000000000000000000dEaD";
const USDC: Address = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const WETH: Address = "0x4200000000000000000000000000000000000006";

let index = 0;
function claimed(id: bigint, block: number, previous: number, amounts: [Address, bigint][], caller = KEEPER): Log {
  return {
    topics: encodeEventTopics({ abi, eventName: "Claimed", args: { tokenId: id, owner: OWNER, caller } }) as [
      Hex,
      ...Hex[],
    ],
    data: encodeAbiParameters(parseAbiParameters("address[], uint256[], uint256[], uint256"), [
      amounts.map(([token]) => token),
      amounts.map(([, amount]) => amount),
      amounts.map(([, amount]) => amount / 100n),
      BigInt(previous),
    ]),
    transactionHash: `0x${(++index).toString(16).padStart(64, "0")}`,
    blockNumber: `0x${block.toString(16)}`,
    logIndex: `0x${index.toString(16)}`,
  };
}

// A fake AutoMaxi: the claims' logs, read a block at a time for the accounts asked.
function autoMaxi(logs: Log[]) {
  const reads: { block: number; ids: bigint[] }[] = [];
  const all = claimsOf(logs);
  const claimsAt = async (block: number, ids: bigint[]): Promise<Claim[]> => {
    reads.push({ block, ids });
    return all.filter((claim) => claim.block === block && ids.includes(claim.id));
  };
  return { claimsAt, reads };
}

const blocks = (claims: Claim[]) => claims.map(({ block }) => block);

test("an account's claims, newest first, back to the start of the epoch of its last one", async () => {
  // The keeper's claim at 1,000, after one at 400 in the epoch before; then a stranger's dust at 1,500.
  const { claimsAt, reads } = autoMaxi([
    claimed(1n, 400, 0, [[USDC, 5_000_000n]]),
    claimed(1n, 1_000, 400, [
      [USDC, 12_000_000n],
      [WETH, 10n ** 15n],
    ]),
    claimed(1n, 1_500, 1_000, [[USDC, 1n]], STRANGER),
  ]);
  const walks = await walkClaims(new Map([[1n, { from: 1_500, since: 900 }]]), claimsAt);
  const walk = walks.get(1n)!;
  assert.deepEqual(blocks(walk.claims), [1_500, 1_000]);
  assert.equal(walk.stopped, false);
  assert.deepEqual(
    reads.map(({ block }) => block),
    [1_500, 1_000],
    "the claim before the epoch is not read",
  );
  assert.deepEqual(
    walk.claims.map(({ caller }) => caller),
    [STRANGER, KEEPER],
  );
});

test("accounts claimed in the same block share each read, and an account never claimed reads nothing", async () => {
  const { claimsAt, reads } = autoMaxi([
    claimed(1n, 1_000, 0, [[USDC, 1_000_000n]]),
    claimed(2n, 1_000, 0, [[USDC, 2_000_000n]]),
    claimed(3n, 1_200, 0, [[USDC, 3_000_000n]]),
  ]);
  const walks = await walkClaims(
    new Map([
      [1n, { from: 1_000, since: 900 }],
      [2n, { from: 1_000, since: 900 }],
      [3n, { from: 1_200, since: 900 }],
      [4n, { from: 0, since: 0 }],
    ]),
    claimsAt,
  );
  assert.deepEqual(
    reads.sort((a, b) => a.block - b.block),
    [
      { block: 1_000, ids: [1n, 2n] },
      { block: 1_200, ids: [3n] },
    ],
  );
  assert.deepEqual(
    [1n, 2n, 3n, 4n].map((id) => blocks(walks.get(id)!.claims)),
    [[1_000], [1_000], [1_200], []],
  );
});

test("several claims of one account in a block: the first points back, the later ones to the block itself", async () => {
  const { claimsAt } = autoMaxi([
    claimed(1n, 700, 0, [[USDC, 1_000_000n]]),
    claimed(1n, 1_000, 700, [[USDC, 2_000_000n]]),
    claimed(1n, 1_000, 1_000, [[WETH, 10n ** 14n]]),
    claimed(1n, 1_000, 1_000, [], STRANGER),
  ]);
  const walk = (await walkClaims(new Map([[1n, { from: 1_000, since: 600 }]]), claimsAt)).get(1n)!;
  assert.deepEqual(blocks(walk.claims), [1_000, 1_000, 700], "a claim that received nothing is left out");
});

test("a long history of dust stops the walk after a set number of blocks, and says so", async () => {
  const logs = Array.from({ length: 15 }, (_, i) => claimed(1n, 1_000 + i, i ? 999 + i : 0, [[USDC, 1n]], STRANGER));
  const { claimsAt, reads } = autoMaxi(logs);
  const walk = (await walkClaims(new Map([[1n, { from: 1_014, since: 900 }]]), claimsAt)).get(1n)!;
  assert.equal(reads.length, WALK_LIMIT);
  assert.equal(walk.claims.length, WALK_LIMIT);
  assert.equal(walk.stopped, true);
  const short = (await walkClaims(new Map([[1n, { from: 1_014, since: 1_010 }]]), autoMaxi(logs).claimsAt)).get(1n)!;
  assert.equal(short.claims.length, 5);
  assert.equal(short.stopped, false, "it reached the start of the epoch first");
});

test("what the claims received, the fee, and what reached the owner, token by token", () => {
  const claims = claimsOf([
    claimed(1n, 1_000, 0, [
      [USDC, 12_000_000n],
      [WETH, 10n ** 15n],
    ]),
    claimed(1n, 1_500, 1_000, [[USDC, 150n]], STRANGER),
  ]);
  assert.deepEqual(blocks(claims), [1_500, 1_000], "newest first");
  assert.deepEqual(totals(claims), {
    received: [
      { token: USDC, amount: 12_000_150n },
      { token: WETH, amount: 10n ** 15n },
    ],
    fees: [
      { token: USDC, amount: 120_001n },
      { token: WETH, amount: 10n ** 13n },
    ],
    paid: [
      { token: USDC, amount: 11_880_149n },
      { token: WETH, amount: 99n * 10n ** 13n },
    ],
  });
});

test("a block of logs without a claim AutoMaxi recorded there is from an RPC behind, and the next one is asked", async () => {
  const replies: Log[][] = [[], [claimed(7n, 2_000, 0, [[USDC, 1_000_000n]])]];
  let asked = 0;
  globalThis.fetch = async () => {
    asked++;
    const result = replies.shift() ?? [];
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result }));
  };
  const found = await readClaimsAt(2_000, [7n]);
  assert.deepEqual(blocks(found), [2_000]);
  assert.equal(asked, 2);
  await readClaimsAt(2_000, [7n]);
  assert.equal(asked, 2, "a block's claims for an account are read once");
});

const original = globalThis.fetch;
beforeEach(() => {
  resetRateLimits();
  forgetClaims();
});
afterEach(() => (globalThis.fetch = original));
