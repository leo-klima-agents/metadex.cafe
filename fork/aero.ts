import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { decodeFunctionData } from "viem";
import { aeroVoterAbi, leafVoterAbi } from "../src/abi.ts";
import { AERO_VOTER, LEAF_VOTER } from "../src/config.ts";
import * as h from "./harness.ts";
import { ALLOCATOR, BLOCK, SITE, anvil, connected, heading, review, view } from "./harness.ts";

const STAKE = 2890n;

describe("allocating an sAERO stake against a fork of Base", { timeout: 1_800_000 }, () => {
  h.fork(BLOCK, [ALLOCATOR]);

  test("allocate the stake that can move to the leaders' pools; it is then locked, and a second try is refused", async () => {
    const { page, sent, violations } = await connected({ owner: ALLOCATOR }, { url: `${SITE}/#aero` });
    const aero = view(page, "aero");
    await heading(page, "Aero").waitFor();
    // The largest stake is locked, so the page starts on the largest that can move.
    await aero.getByText(/^Without hindsight, Follow the leaders earned [\d.]+% APR over the last 8 days: /).waitFor();
    assert.equal(await aero.locator("[data-action=aero-stake]").inputValue(), String(STAKE));
    assert.match(await aero.locator("[data-action=aero-stake] option[value='2848']").innerText(), /locked until/);
    assert.match(await aero.locator("[data-text=plan-pay]").innerText(), /a day for sAERO #2890\.$/);
    const rows = aero.locator("[data-list=pick] tr");
    assert.equal(await rows.count(), 10, "the strategy's 10 pools");
    assert.equal(await aero.locator("[data-text=share-total]").innerText(), "100.0%");
    // "Show more pools" adds 10 pools each time, with no share, so what is sent stays the same.
    for (const count of [20, 30]) {
      await aero.getByRole("button", { name: "Show more pools" }).click();
      await rows.nth(count - 1).waitFor();
      assert.equal(await rows.count(), count);
    }
    assert.equal(await aero.locator("[data-text=share-total]").innerText(), "100.0%");

    await aero.getByRole("button", { name: "Allocate" }).click();
    await heading(review(page), "Before you allocate", 2).waitFor();
    assert.match(await review(page).innerText(), /sAERO #2890 will allocate its [\d.]+k allocation power on Base/);
    await review(page).getByText("Simulated on Base: it succeeds.").waitFor();
    await review(page).getByRole("button", { name: "Continue" }).click();
    await h.confirm(page);
    await review(page)
      .getByText(/^Allocated\. sAERO #2890 can be changed again from /)
      .waitFor();
    await review(page).getByRole("button", { name: "Close" }).click();

    // What was sent is what the page showed, and Base now holds it.
    assert.equal(sent.length, 1);
    assert.equal(sent[0]!.to.toLowerCase(), AERO_VOTER.toLowerCase());
    const call = decodeFunctionData({ abi: aeroVoterAbi, data: sent[0]!.data });
    if (call.functionName !== "allocate") throw new Error(`Sent ${call.functionName}, not allocate.`);
    const allotted = call.args[2][0]!.gauges.map(({ gauge }) => gauge.toLowerCase());
    assert.equal(allotted.length, 10);
    const held = (await anvil.readContract({
      address: LEAF_VOTER,
      abi: leafVoterAbi,
      functionName: "allocatedGauges",
      args: [STAKE],
    })) as readonly string[];
    assert.deepEqual(
      held.map((gauge) => gauge.toLowerCase()).sort(),
      [...allotted].sort(),
      "Base holds the pools that were sent",
    );

    // The stake is now locked: the page says so, and keeps it picked.
    await aero
      .locator("[data-text=stake-lock]")
      .getByText(/^Locked until /)
      .waitFor();
    assert.equal(await aero.locator("[data-action=aero-stake]").inputValue(), String(STAKE));
    await aero.getByText(/^sAERO #2890 was allocated less than 47 hours ago\. It can be changed again from /).waitFor();
    assert.equal(await aero.getByRole("button", { name: "Allocate" }).isDisabled(), true);

    // Its page shows the new pools and the lock.
    await aero.locator("[data-text=stake-link]").click();
    await heading(page, "sAERO #2890").waitFor();
    await view(page, "stake")
      .getByText(/^Locked until /)
      .waitFor();
    assert.match(await view(page, "stake").locator("[data-text=pools]").innerText(), /in 10 pools$/);
    assert.deepEqual(violations, []);
  });
});
