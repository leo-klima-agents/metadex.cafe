import assert from "node:assert/strict";
import { test } from "node:test";
import { zeroAddress, type Address } from "viem";
import { CONDUIT as conduit } from "../src/config.ts";
import { WEEK } from "../src/format.ts";
import { poolName, status, type Account } from "../src/hydrex.ts";

const OWNER: Address = "0x96107D30577872Ee4c572A2B6E6fD254a89bBD20";
const USDC_CONDUIT: Address = "0xE57b3Ea02336B9b418cA523aB5aD6f479d93bD1D";
const STRANGER: Address = "0x000000000000000000000000000000000000dEaD";
const START = 1_792_022_400; // Thu 15 Oct 2026, 00:00 UTC
const NOW = START + 86_400;

const account = (changes: Partial<Account> = {}): Account => ({
  id: 1n,
  name: "",
  amount: 10n ** 18n,
  end: 0,
  lockType: 2,
  votes: 10n ** 18n,
  delegate: OWNER,
  delegateAtStart: OWNER,
  claimer: zeroAddress,
  ...changes,
});
const statusOf = (changes: Partial<Account>) => status(account(changes), OWNER, NOW, START);

test("in the automation, joined this week, and left this week", () => {
  assert.deepEqual(statusOf({ delegate: conduit, delegateAtStart: conduit, claimer: conduit }), { kind: "in" });
  assert.deepEqual(statusOf({ delegate: conduit, claimer: conduit }), { kind: "joined", date: START + WEEK });
  assert.deepEqual(statusOf({ delegateAtStart: conduit }), { kind: "left", date: START + WEEK });
});

test("votes without claims, or claims without votes, is only partly in", () => {
  assert.deepEqual(statusOf({ delegate: conduit, delegateAtStart: conduit }), { kind: "partly" });
  assert.deepEqual(statusOf({ claimer: conduit }), { kind: "partly" });
});

test("other delegates: the owner, nobody, another of Hydrex's automations, any other address", () => {
  assert.deepEqual(statusOf({}), { kind: "self" });
  assert.deepEqual(statusOf({ delegate: zeroAddress }), { kind: "self" });
  assert.deepEqual(statusOf({ delegate: USDC_CONDUIT.toLowerCase() as Address }), { kind: "other", name: "USDC" });
  assert.deepEqual(statusOf({ delegate: STRANGER }), { kind: "delegated", to: STRANGER });
});

test("an empty account or an ended lock says so first", () => {
  assert.deepEqual(statusOf({ amount: 0n, delegate: conduit, claimer: conduit }), { kind: "empty" });
  assert.deepEqual(statusOf({ lockType: 0, end: NOW }), { kind: "ended" });
  assert.deepEqual(statusOf({ lockType: 0, end: NOW + 1 }), { kind: "self" });
  assert.deepEqual(statusOf({ lockType: 1, end: 0 }), { kind: "self" });
});

test("pools are named by their pair and kind, else their symbol, else their address", () => {
  const pool: Address = "0xBeEF086b8807Dc5E5A1740C5E3a7C4c366eA6ab5";
  assert.equal(poolName(pool, { token0: "AVNT", token1: "USDC" }), "AVNT/USDC");
  assert.equal(poolName(pool, { token0: "GOO", token1: "cbBTC", symbol: "vAMM-GOO/cbBTC" }), "GOO/cbBTC · vAMM");
  assert.equal(poolName(pool, { token0: "wtSGOV", token1: "USDC", symbol: "pcALM" }), "wtSGOV/USDC · pcALM");
  assert.equal(poolName(pool, { symbol: "steakEURC" }), "steakEURC");
  assert.equal(poolName(pool, {}), "0xBeEF…6ab5");
});
