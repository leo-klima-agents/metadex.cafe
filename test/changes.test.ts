import assert from "node:assert/strict";
import { test } from "node:test";
import { SETTINGS, changed, changedBlocks, settingsOf, type Settings } from "../src/changes.ts";

const KVCM = "0x00fBAC94Fec8D4089d3fe979F39454F48c71A65d";
const AZUSD = "0x3595ca37596D5895B70EFAB592ac315D5B9809B2";
const ROUTER = "0x6131B5fae19EA4f9D964eAc0408E4408b66337b5";
const TREASURY = "0xd9e966a6Bfa2aE2113a34Bb4dd02ded921DA50aF";
const LISTED = 8;

// The reads in the order the page makes them: a list reads past its end, which fails.
function reads({ fee = 0n, tokens = [KVCM, AZUSD], name = "Hydrex" } = {}): unknown[] {
  const list = (items: string[]) => Array.from({ length: LISTED }, (_, i) => items[i]);
  return [
    3333n,
    fee,
    TREASURY,
    ...list(tokens),
    ...list([ROUTER, ROUTER]),
    "0xdA0A793D7C32AB80bcdab7F8c725c96DB22464f4",
    "0x1C24239309398220883207681602BfF4D10fbde1",
    "0x3bF21F28262eFfF8E2d30be3818e3B88539D7CCB",
    "0x0008f35758a4318942EcB5d5414116ce7B1Ede2d",
    0n,
    0n,
    name,
    "0xcba0000027bd78edf6714DE3bCC312360E469502",
    "",
    "Programmatic carbon retirement",
    true,
    true,
    [[3, 5], true, ""],
  ];
}

test("the settings, each as strings: lists end at their first failed read, and a tuple keeps its parts", () => {
  const settings = settingsOf(reads());
  assert.deepEqual(Object.keys(settings), [...SETTINGS]);
  assert.deepEqual(settings.retired, ["3333"]);
  assert.deepEqual(settings.tokens, [KVCM, AZUSD]);
  assert.deepEqual(settings.routers, [ROUTER, ROUTER]);
  assert.deepEqual(settings.admin, ["true"]);
  assert.deepEqual(settings.approvals, ["3, 5", "true", ""]);
  const failed = reads();
  failed[1] = undefined;
  assert.throws(() => settingsOf(failed), /A read from Base failed/, "only a list may end in a failed read");
});

test("which settings differ", () => {
  const before = settingsOf(reads());
  assert.deepEqual(changed(before, settingsOf(reads())), []);
  assert.deepEqual(changed(before, settingsOf(reads({ fee: 50n, tokens: [KVCM] }))), ["fee", "tokens"]);
  assert.deepEqual(changed(before, settingsOf(reads({ name: "Klima" }))), ["names"]);
});

test("each block where the settings changed, between reads at the start of each epoch, with the value on each side", async () => {
  // The fee goes to 50 at block 1,234,567 and back to 0 at 1,500,001; the name changes at 2,000,000.
  const at = async (block: number): Promise<Settings> =>
    settingsOf(
      reads({
        fee: block >= 1_234_567 && block < 1_500_001 ? 50n : 0n,
        name: block >= 2_000_000 ? "Klima" : "Hydrex",
      }),
    );
  let count = 0;
  const counted = (block: number) => {
    count++;
    return at(block);
  };
  const found = await changedBlocks(counted, [1_000_000, 1_302_400, 1_604_800, 1_907_200, 2_100_000]);
  assert.deepEqual(
    found.map(({ block, before, after }) => [block, changed(before, after)]),
    [
      [1_234_567, ["fee"]],
      [1_500_001, ["fee"]],
      [2_000_000, ["names"]],
    ],
  );
  assert.ok(count < 80, `${count} reads`);
  assert.deepEqual(await changedBlocks(at, [1, 302_401]), [], "nothing changed");
  const undone = await changedBlocks(at, [1_200_000, 1_600_000]);
  assert.deepEqual(undone, [], "a change undone between two reads does not show");
});
