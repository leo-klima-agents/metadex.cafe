import assert from "node:assert/strict";
import { test } from "node:test";
import { gunzipSync } from "node:zlib";
import {
  decodeFunctionData,
  encodeAbiParameters,
  encodeFunctionResult,
  erc20Abi,
  multicall3Abi,
  parseAbi,
  type Address,
  type Hex,
} from "viem";
import { BLOCK_SCHEDULE, GZIP_RPCS, RPCS } from "../src/config.ts";
import {
  BATCH_BYTES,
  blockClock,
  call,
  codeAt,
  firstBlockAt,
  GZIP_FROM,
  REST_MAX,
  restFor,
  poll,
  read,
  regroup,
  rpc,
  scheduled,
  settledBelow,
  showTags,
  sliced,
  simulate,
  timeoutFor,
} from "../src/rpc.ts";

type Handler = (
  url: string,
  body: { method: string; params: unknown[] },
  gzipped: boolean,
) => Response | Promise<Response>;
const serve = (handler: Handler) => {
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    const gzipped = (init.headers as Record<string, string>)["content-encoding"] === "gzip";
    const body = gzipped ? gunzipSync(init.body as ArrayBuffer) : init.body;
    return handler(url, JSON.parse(String(body)), gzipped);
  }) as never;
};
const reply = (result: unknown) => Response.json({ jsonrpc: "2.0", id: 1, result });

test("sliced work gives the page turns while it runs, and keeps the order of what it maps", async () => {
  let turns = 0;
  const other = setInterval(() => turns++, 0);
  const busy = (ms: number) => {
    const start = performance.now();
    while (performance.now() - start < ms);
  };
  const out = await sliced([1, 2, 3, 4, 5, 6], (each, i) => {
    busy(6);
    return each * 10 + i;
  });
  clearInterval(other);
  assert.deepEqual(out, [10, 21, 32, 43, 54, 65]);
  // 36 ms of work in slices of about 10 ms: the timer gets a turn between slices.
  assert.ok(turns >= 2, `${turns} turns`);
});

test("a time's first block, from the blocks' own times, whatever the time between blocks", async () => {
  // These times do not follow Base's schedule, so no schedule is given.
  const GENESIS = 1_686_789_347;
  const timeAt = (block: number) =>
    GENESIS + 2 * Math.min(block, 1e6) + Math.max(0, Math.min(block, 2e6) - 1e6) + 3 * Math.max(0, block - 2e6);
  let reads = 0;
  const reader = async (block: number) => (reads++, timeAt(block));
  const top = 3_000_000;
  for (const block of [10, 999_999, 1_000_000, 1_500_001, 2_000_000, 2_500_000, top]) {
    reads = 0;
    const time = timeAt(block);
    assert.equal(await firstBlockAt(time, top, timeAt(top), reader, undefined, []), block, `block ${block}`);
    const before = timeAt(block - 1) >= time - 1 ? block - 1 : block;
    assert.equal(await firstBlockAt(time - 1, top, timeAt(top), reader, undefined, []), before);
    assert.ok(reads <= 2 * 26, `${reads} reads for block ${block}, in two searches`);
  }
  for (const pace of [2, 1, 3, 12]) {
    reads = 0;
    const evenly = async (block: number) => (reads++, GENESIS + pace * block);
    const time = GENESIS + pace * 52_000_001;
    assert.deepEqual(
      [await firstBlockAt(time, 53_000_000, GENESIS + pace * 53_000_000, evenly, undefined, []), reads],
      [52_000_001, 3],
    );
    reads = 0;
    const above = [53_000_005, GENESIS + pace * 53_000_005] as const;
    assert.deepEqual(
      [await firstBlockAt(time, 53_000_000, GENESIS + pace * 53_000_000, evenly, above, []), reads],
      [52_000_001, 2],
      "with a newer block given, the pace needs no read",
    );
  }
});

// Base's blocks: one every 2 seconds until block 53,556,127, Denim's first, then five a second. Times are in whole
// seconds.
const DENIM = 53_556_127;
const baseTime = (block: number) =>
  block < DENIM ? 1_686_789_347 + 2 * block : 1_793_901_601 + Math.floor((block - DENIM) / 5);
const NEWEST = 55_148_356;
const isFirst = (time: number, block: number, timeOf: (block: number) => number) =>
  timeOf(block) >= time && timeOf(block - 1) < time;

test("Base's schedule says a time's first block, before and after Denim", () => {
  assert.deepEqual(
    [1_793_901_599, 1_793_901_600, 1_793_901_601, 1_793_901_602, 1_686_789_348, 1].map((time) =>
      scheduled(time, BLOCK_SCHEDULE),
    ),
    [DENIM - 1, DENIM, DENIM, DENIM + 5, 1, 0],
  );
  for (const block of [1, 40_000_000, DENIM - 1, DENIM, DENIM + 1, DENIM + 4, DENIM + 5, NEWEST]) {
    const time = baseTime(block);
    assert.ok(isFirst(time, scheduled(time, BLOCK_SCHEDULE)!, baseTime) || baseTime(block - 1) === time, `${block}`);
  }
  assert.equal(scheduled(1_793_901_601, []), undefined);
});

test("on Base, a time's first block is the schedule's, checked with it and the one before, read together", async () => {
  const top = NEWEST - 50;
  for (const back of [11, 60, 1_800, 2 * 86_400, 4 * 86_400, 8 * 86_400, 400 * 86_400]) {
    const time = baseTime(NEWEST) - back;
    let [reads, waiting, most] = [0, 0, 0];
    const reader = async (block: number) => {
      [reads, waiting, most] = [reads + 1, waiting + 1, Math.max(most, waiting + 1)];
      await Promise.resolve();
      waiting--;
      return baseTime(block);
    };
    const found = await firstBlockAt(time, top, baseTime(top), reader, [NEWEST, baseTime(NEWEST)]);
    assert.ok(isFirst(time, found, baseTime), `${back} s back`);
    assert.deepEqual([reads, most], [2, 2], `${back} s back`);
  }
});

test("a block clock searches below the newest block, or below a block given, and reads each block's time once", async () => {
  const asked: (number | "latest" | undefined)[] = [];
  const rd = async (_: unknown, options?: { block?: number | "latest" }): Promise<any> => {
    asked.push(options?.block);
    return options?.block === undefined ? [NEWEST, baseTime(NEWEST)] : [baseTime(options.block as number)];
  };
  const { firstAt } = await blockClock(rd);
  const time = baseTime(NEWEST) - 1_800;
  const found = await firstAt(time);
  assert.ok(isFirst(time, found, baseTime));
  const top = settledBelow(NEWEST);
  assert.equal(await firstAt(time, top), found);
  assert.deepEqual(asked, [undefined, found, found - 1, top], "the newest block's time is known already");
});

test("with five blocks a second and no schedule, or a wrong one, a search takes a few reads", async () => {
  // Five blocks share each second, so a guess at a block of the right second may not be the first of it.
  const GENESIS = 1_686_789_347;
  const timeOf = (block: number) => GENESIS + Math.floor(block / 5);
  const newest = 300_000_000;
  const top = newest - 50;
  for (const schedule of [[], BLOCK_SCHEDULE]) {
    for (const back of [11, 60, 1_800, 2 * 86_400, 8 * 86_400, 400 * 86_400]) {
      for (let late = 0; late < 5; late++) {
        const time = timeOf(newest) - back - late;
        let reads = 0;
        const reader = async (block: number) => (reads++, timeOf(block));
        const found = await firstBlockAt(time, top, timeOf(top), reader, [newest, timeOf(newest)], schedule);
        assert.ok(isFirst(time, found, timeOf), `${back + late} s back`);
        assert.ok(reads <= (schedule.length ? 8 : 6), `${reads} reads for ${back + late} s back`);
      }
    }
  }
});

test("10 seconds of blocks are skipped as unsettled: 50 since Denim, 5 before", () => {
  assert.deepEqual(
    [NEWEST, DENIM, DENIM - 1, 52_694_000].map((block) => block - settledBelow(block, BLOCK_SCHEDULE)),
    [50, 50, 5, 5],
  );
  assert.equal(settledBelow(100, []), 95);
});

test("waiting for an answer asks every 0.2 s for 10 s, then every 2 s, for up to 10 minutes", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
  const asked: number[] = [];
  const waiting = poll(async () => void asked.push(Date.now()));
  for (let ms = 0; ms <= 600_000; ms += 200) {
    await new Promise((done) => setImmediate(done));
    t.mock.timers.tick(200);
  }
  assert.equal(await waiting, undefined);
  const fast = Array.from({ length: 51 }, (_, i) => i * 200);
  const slow = Array.from({ length: 295 }, (_, i) => 10_000 + 2_000 * i).filter((ms) => ms > 10_000 && ms < 600_000);
  assert.deepEqual(asked, [...fast, ...slow]);
});

test("a busy RPC hands over to the next; an unwanted answer is taken only when none is wanted", async () => {
  const asked: string[] = [];
  serve((url) => (asked.push(url), url === RPCS[0] ? new Response("", { status: 429 }) : reply("0x1")));
  assert.equal(await rpc("eth_chainId", []), "0x1");
  assert.deepEqual(asked, RPCS.slice(0, 2));
  serve((url) => reply(url === RPCS[2] ? ["log"] : []));
  assert.deepEqual(await rpc("eth_getLogs", [], { want: (logs) => (logs as unknown[]).length > 0 }), ["log"]);
  serve(() => reply([]));
  assert.deepEqual(await rpc("eth_getLogs", [], { want: (logs) => (logs as unknown[]).length > 0 }), []);
  serve(() => reply(null));
  await assert.rejects(rpc("eth_getTransactionReceipt", ["0x"]));
});

// A fresh copy of rpc.ts, so that what one test teaches it about the RPCs doesn't carry over to the next.
const fresh = async () => (await import(`../src/rpc.ts?${Math.random()}`)) as typeof import("../src/rpc.ts");
const wait = (ms: number) => new Promise((done) => setTimeout(done, ms));
const [ZIPPER, OTHER] = RPCS as [string, string];
const LARGE = ["0x" + "ab".repeat(GZIP_FROM)];
const SMALL = ["0x"];

test("large requests go gzipped to the RPCs that read gzip, and plain to the others", async () => {
  assert.deepEqual(GZIP_RPCS, [ZIPPER], "the RPC asked first reads gzip");
  const { rpc } = await fresh();
  const asked: [string, boolean][] = [];
  let down = false;
  serve((url, { params }, gzipped) => {
    asked.push([url, gzipped]);
    assert.ok(params[0] === SMALL[0] || params[0] === LARGE[0], "the body is read back as it was sent");
    return url === ZIPPER && down ? new Response("", { status: 503 }) : reply("0x1");
  });
  const askedFor = async (params: string[]) => {
    asked.length = 0;
    assert.equal(await rpc("eth_call", params), "0x1");
    return [...asked];
  };
  assert.deepEqual(await askedFor(SMALL), [[ZIPPER, false]]);
  assert.deepEqual(await askedFor(LARGE), [[ZIPPER, true]]);
  down = true;
  assert.deepEqual(await askedFor(LARGE), [
    [ZIPPER, true],
    [OTHER, false],
  ]);
});

test("an RPC that says it can't read gzip is sent the request again plain, and plain ones from then on", async () => {
  const refusals = [
    () => new Response("unsupported content encoding", { status: 415 }),
    () => Response.json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }, { status: 400 }),
  ];
  for (const refusal of refusals) {
    const { rpc, gzipping } = await fresh();
    const asked: boolean[] = [];
    serve((url, _, gzipped) => {
      if (url !== ZIPPER) return new Response("", { status: 429 });
      asked.push(gzipped);
      return gzipped ? refusal() : reply("0x1");
    });
    assert.equal(await rpc("eth_call", LARGE), "0x1");
    assert.equal(await rpc("eth_call", LARGE), "0x1");
    assert.deepEqual(asked, [true, false, false]);
    assert.equal(gzipping(ZIPPER), false);
  }
});

test("a JSON-RPC error or a busy answer to a gzipped request is not taken as gzip refused", async () => {
  const { rpc, gzipping } = await fresh();
  const asked: [string, boolean][] = [];
  let answer = () => Response.json({ jsonrpc: "2.0", id: 1, error: { code: -32602, message: "bad" } }, { status: 400 });
  serve((url, _, gzipped) => (asked.push([url, gzipped]), url === ZIPPER ? answer() : reply("0x1")));
  assert.equal(await rpc("eth_call", LARGE), "0x1");
  assert.deepEqual(asked, [
    [ZIPPER, true],
    [OTHER, false],
  ]);
  for (const status of [408, 429, 503]) {
    answer = () => new Response("<html>", { status });
    assert.equal(await rpc("eth_call", LARGE), "0x1");
  }
  assert.equal(gzipping(ZIPPER), true);
});

test("gzip stops only after gzipped requests keep failing to get through while plain ones do", async () => {
  const { rpc, gzipping } = await fresh();
  let gzipped: "read" | "dropped" | "slow" = "dropped";
  let othersAnswer = true;
  const asked: boolean[] = [];
  serve(async (url, _, zipped) => {
    if (url !== ZIPPER) return othersAnswer ? reply("0x1") : new Response("", { status: 429 });
    asked.push(zipped);
    if (!zipped || gzipped === "read") return reply("0x1");
    await wait(200);
    throw gzipped === "slow" ? new DOMException("Timed out.", "TimeoutError") : new TypeError("Failed to fetch");
  });
  // While it is resting, the others are asked first. They are busy here, so it is asked once its rest is over.
  const reach = async () => {
    othersAnswer = false;
    asked.length = 0;
    assert.equal(await rpc("eth_call", SMALL), "0x1");
    assert.deepEqual(asked, [false]);
    othersAnswer = true;
  };
  const drop = async (times = 1) => {
    asked.length = 0;
    await Promise.all(Array.from({ length: times }, () => rpc("eth_call", LARGE)));
    assert.deepEqual(asked, Array(times).fill(true), "a gzipped request that fails is not sent again plain at once");
  };
  await drop();
  await reach();
  await drop(3);
  await reach();
  gzipped = "slow";
  await drop();
  gzipped = "dropped";
  await reach();
  await drop();
  assert.equal(
    gzipping(ZIPPER),
    true,
    "two count: the first came before any plain request reached it, the three in flight together count as one, and " +
      "a timeout doesn't count",
  );
  await reach();
  gzipped = "read";
  await drop();
  gzipped = "dropped";
  await reach();
  await drop();
  await reach();
  await drop();
  assert.equal(gzipping(ZIPPER), true, "a gzipped request that gets through starts the count again");
  await reach();
  await drop();
  assert.equal(gzipping(ZIPPER), false, "after three in a row, requests go plain");
});

test("a busy RPC rests a second, twice as long each time it is busy again, or as long as it asks", () => {
  assert.deepEqual(
    [1, 2, 3, 4, 5].map((count) => restFor(count)),
    [1_000, 2_000, 4_000, 8_000, 8_000],
  );
  assert.equal(REST_MAX, 8_000);
  assert.equal(restFor(1, "3"), 3_000);
  assert.equal(restFor(3, "0"), 0);
  assert.equal(restFor(1, "60"), REST_MAX);
  assert.equal(restFor(2, "Wed, 21 Oct 2026 07:28:00 GMT"), 2_000, "a date is not read");
  assert.equal(restFor(1, " "), 1_000);
});

test("an RPC that was busy is asked first again once its rest is over", async () => {
  const { rpc } = await fresh();
  const asked: string[] = [];
  let busy = true;
  serve((url) => {
    asked.push(url);
    return url === ZIPPER && busy ? new Response("", { status: 429 }) : reply("0x1");
  });
  assert.equal(await rpc("eth_call", SMALL), "0x1");
  assert.deepEqual(asked, [ZIPPER, OTHER]);
  busy = false;
  asked.length = 0;
  assert.equal(await rpc("eth_call", SMALL), "0x1");
  assert.deepEqual(asked, [OTHER], "while it rests, the next one is asked first");
  await wait(1_050);
  asked.length = 0;
  assert.equal(await rpc("eth_call", SMALL), "0x1");
  assert.deepEqual(asked, [ZIPPER]);
});

test("requests turned down together count as one towards a longer rest", async () => {
  const { rpc } = await fresh();
  const times: number[] = [];
  let busy = 3;
  serve(async (url) => {
    if (url !== ZIPPER) return new Response("", { status: 429 });
    times.push(performance.now());
    if (busy-- <= 0) return reply("0x1");
    await wait(150);
    return new Response("", { status: 429 });
  });
  await Promise.all([1, 2, 3].map(() => rpc("eth_call", SMALL)));
  const gap = times[3]! - times[2]!;
  assert.ok(gap > 900 && gap < 2_000, `asked again after ${Math.round(gap)} ms, not after 4 s`);
});

test("reads go through Multicall3; a call that fails reads as undefined", async () => {
  const abi = parseAbi(["function aggregate3((address,bool,bytes)[]) returns ((bool success, bytes returnData)[])"]);
  serve((_, { params }) => {
    const { args } = decodeFunctionData({ abi, data: (params[0] as { data: `0x${string}` }).data });
    const results = (args[0] as unknown[]).map((_, i) => ({
      success: i === 0,
      returnData: i === 0 ? encodeAbiParameters([{ type: "uint256" }], [42n]) : ("0x" as const),
    }));
    return reply(encodeFunctionResult({ abi, functionName: "aggregate3", result: results }));
  });
  const balance = call(
    "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    erc20Abi,
    "balanceOf",
    "0x0000000000000000000000000000000000000001",
  );
  assert.deepEqual(await read([balance, balance]), [42n, undefined]);
});

test("replies to groups of calls read together go back to their groups", () => {
  assert.deepEqual(regroup([["a", "b"], [], ["c"]], [1, 2, 3]), [[1, 2], [], [3]]);
});

test("reads for the page shown go first; the others never hold more than two slots", async () => {
  const started: string[] = [];
  const pending: (() => void)[] = [];
  serve((_, { params }) => {
    started.push(params[0] as string);
    return new Promise((done) => pending.push(() => done(reply("0x1"))));
  });
  showTags(["swap"]);
  const all = ["a", "b", "c", "d", "e"].map((id) => rpc("x", [id], { tag: "payouts" }));
  all.push(rpc("x", ["shown"], { tag: "swap" }), rpc("x", ["untagged"]));
  await new Promise((done) => setTimeout(done, 300));
  assert.deepEqual(started.sort(), ["a", "b", "shown", "untagged"].sort(), "two slots stay free for the page shown");
  const later = rpc("x", ["shown later"], { tag: "swap" });
  await new Promise((done) => setTimeout(done, 100));
  assert.ok(started.includes("shown later"), "and its next read takes one at once");
  for (let round = 0; round < 4; round++) {
    pending.splice(0).forEach((go) => go());
    await new Promise((done) => setTimeout(done, 100));
  }
  await Promise.all([...all, later]);
  assert.equal(started.length, 8);
});

test("an RPC that answers other than JSON-RPC, even in JSON, or does not answer, is asked again", async () => {
  let asked = 0;
  serve(() => {
    asked++;
    if (asked === 1) return Response.json(null);
    if (asked <= 3)
      return asked % 2 ? new Response("<html>") : Promise.reject(new DOMException("Slow.", "TimeoutError"));
    return reply("0x2");
  });
  assert.equal(await rpc("eth_chainId", []), "0x2");
  assert.equal(asked, 4);
});

test("a simulated call that reverts returns the revert's data, which RPCs put in its error", async () => {
  const refused = "0x77c522ea0000000000000000000000000000000000000000000000000000000000002105";
  serve(() =>
    reply([
      {
        calls: [
          { status: "0x1", returnData: "0x01", gasUsed: "0x10" },
          { status: "0x0", returnData: "0x", gasUsed: "0x20", error: { code: 3, message: "reverted", data: refused } },
          { status: "0x0", returnData: "0x02", gasUsed: "0x30" },
        ],
      },
    ]),
  );
  const to = "0x0000000000000000000000000000000000000001";
  const found = await simulate(to, [
    { to, data: "0x" },
    { to, data: "0x" },
    { to, data: "0x" },
  ]);
  assert.deepEqual(
    found.map(({ ok, returnData, gas }) => [ok, returnData, gas]),
    [
      [true, "0x01", 16n],
      [false, refused, 32n],
      [false, "0x02", 48n],
    ],
  );
});

test("which addresses hold code is one creation's answer for each 2,000 of them, a byte each", async () => {
  const addresses = Array.from({ length: 2_500 }, (_, i): Address => `0x${(i + 1).toString(16).padStart(40, "0")}`);
  const sent: Hex[] = [];
  serve((_, { method, params }) => {
    const [{ to, data }] = params as [{ to?: Address; data: Hex }];
    assert.equal(method, "eth_call");
    assert.equal(to, undefined, "no contract is called");
    sent.push(data);
    // After the 47-byte program come 20 bytes for each address. Here, addresses ending in an odd digit hold code.
    const asked = data.slice(2 + 94).match(/.{40}/g)!;
    return reply(`0x${asked.map((hex) => (parseInt(hex.at(-1)!, 16) % 2 ? "01" : "00")).join("")}`);
  });
  const found = await codeAt(addresses);
  assert.deepEqual(
    sent.map((data) => (data.length - 2 - 94) / 40),
    [2_000, 500],
  );
  assert.deepEqual(
    found,
    addresses.map((address) => parseInt(address.at(-1)!, 16) % 2 === 1),
  );
  serve(() => reply("0x01"));
  assert.deepEqual(
    await codeAt(addresses.slice(0, 3)),
    [undefined, undefined, undefined],
    "an answer of the wrong length",
  );
});

test("a request has 5 seconds, and longer the more it sends, as if six shared an upload of 1 Mbit/s", () => {
  assert.equal(timeoutFor(0), 5_000);
  assert.equal(timeoutFor(125_000), 11_000);
  assert.ok(timeoutFor(576_000) > 30_000, "a batch of a thousand lookups");
});

test("reads go in batches of at most 200 calls, and of at most 100 kB of calldata", async () => {
  const abi = parseAbi(["function f(bytes) view returns (uint256)"]);
  const sizes: number[] = [];
  serve((_, { params }) => {
    const [{ data }] = params as [{ data: Hex }];
    const { args } = decodeFunctionData({ abi: multicall3Abi, data });
    const calls = args[0] as readonly unknown[];
    sizes.push(calls.length);
    assert.ok((data.length - 2) / 2 <= BATCH_BYTES + 100, "within the cap, but for the batch's own few words");
    return reply(
      encodeFunctionResult({
        abi: multicall3Abi,
        functionName: "aggregate3",
        result: calls.map(() => ({ success: true, returnData: encodeAbiParameters([{ type: "uint256" }], [7n]) })),
      }),
    );
  });
  const to: Address = "0x0000000000000000000000000000000000000001";
  const small = await read(Array.from({ length: 450 }, () => call(to, abi, "f", "0x")));
  assert.deepEqual(sizes, [200, 200, 50]);
  sizes.length = 0;
  // Each call's data is 1,092 bytes, padded to 1,120, and Multicall3 adds 160 more. So 78 calls fit in 100 kB.
  const large = await read(Array.from({ length: 200 }, () => call(to, abi, "f", `0x${"ab".repeat(1_024)}`)));
  assert.deepEqual(sizes, [78, 78, 44]);
  assert.ok([...small, ...large].every((value) => value === 7n));
});
