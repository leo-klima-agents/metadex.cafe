// Reads, for every stake that ever allocated, whether it is still staked, and who can allocate it. A stake that was
// withdrawn lost its allocations then, with no GaugesAllocated event, so its last allocation's end is unknown.
import { readFileSync, writeFileSync } from "node:fs";
import { aeroEscrowAbi, leafVoterAbi } from "../src/abi.ts";
import { AERO_ESCROW, LEAF_VOTER } from "../src/config.ts";
import { contract, readEach } from "../src/rpc.ts";

const allocations: { id: string }[] = JSON.parse(
  readFileSync(new URL("./data/allocations.json", import.meta.url), "utf8"),
);
const ids = [...new Set(allocations.map(({ id }) => id))].map(BigInt);
const escrow = contract(AERO_ESCROW, aeroEscrowAbi);
const leaf = contract(LEAF_VOTER, leafVoterAbi);
const found = await readEach(ids, {
  staked: (id) => escrow("staked", id),
  owner: (id) => escrow("ownerOf", id),
  state: (id) => leaf("tokenStates", id),
});
const out = Object.fromEntries(
  found.map(({ item, staked, owner, state }) => [
    item.toString(),
    {
      amount: staked?.amount.toString() ?? "0",
      permanent: staked?.isPermanent ?? false,
      end: Number(staked?.end ?? 0),
      owner: owner?.toLowerCase() ?? null,
      operator: state?.[0].toLowerCase() ?? null,
    },
  ]),
);
writeFileSync(new URL("./data/stakes.json", import.meta.url), JSON.stringify(out));
console.error(`Saved ${ids.length} stakes, ${found.filter(({ staked }) => !staked?.amount).length} no longer staked.`);
