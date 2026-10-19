import { ADMIN } from "./config.ts";
import { clone, fill, fillAddress, fillTime, show } from "./dom.ts";
import { bps, integer, share, utc } from "./format.ts";
import { MAX_RETIRE_BPS, type CarbonImpact } from "./hydrex.ts";

// Carbon Impact's fee facts: the same six rows, in the same order, on its page, in Choose and in the review, as read
// from Base, with the block.

export function showFeeFacts(root: ParentNode, found: CarbonImpact): void {
  fill(root, {
    "fact-retired": share(found.retireBps),
    "fact-fee": bps(found.feeBps),
    "fact-max-retired": bps(MAX_RETIRE_BPS),
    "fact-max-fee": bps(found.maxFeeBps),
    "fact-entity": found.entity,
    "fact-block": integer(found.block),
  });
  fillAddress(root, "fact-treasury", found.treasury);
  fillAddress(root, "fact-admin", ADMIN);
  show(".fact-admin-known", found.admin, root);
  show(".fact-admin-unknown", !found.admin, root);
  fillTime(root, "fact-time", found.time, utc);
}

export function feeFacts(found: CarbonImpact): DocumentFragment {
  const part = clone("fee-facts-slip");
  showFeeFacts(part, found);
  return part;
}
