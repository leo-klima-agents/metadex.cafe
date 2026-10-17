import {
  decodeErrorResult,
  decodeFunctionResult,
  encodeFunctionData,
  keccak256,
  type Abi,
  type Address,
  type Hex,
} from "viem";
import { multicall3Abi } from "./abi.ts";
import { MULTICALL3, RPCS } from "./config.ts";

const CHUNK = 200;
const IMPLEMENTATION_SLOT = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";

export type Call = { address: Address; abi: Abi; functionName: string; args: unknown[] };

/**
 * Whether two addresses are the same, whatever their case. Unlike viem's isAddressEqual, it never throws, as for the
 * "undefined" of a read that failed.
 */
export const same = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase();

export const call = (address: Address, abi: Abi, functionName: string, ...args: unknown[]): Call => ({
  address,
  abi,
  functionName,
  args,
});

/** Asks each RPC in turn until one answers, giving each five seconds. */
export async function rpc<T>(method: string, params: unknown[]): Promise<T> {
  for (const url of RPCS) {
    // Not AbortSignal.timeout(), which the browsers inside older wallet apps lack.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5_000);
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
        signal: controller.signal,
      });
      const { result } = (await response.json()) as { result?: T };
      if (result !== undefined) return result;
    } catch {
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error(`No Base RPC answered ${method}.`);
}

/** Results in the order of the calls, through Multicall3; undefined for a call that reverts. */
export async function read(calls: Call[]): Promise<unknown[]> {
  const chunks: Promise<unknown[]>[] = [];
  for (let i = 0; i < calls.length; i += CHUNK) chunks.push(aggregate(calls.slice(i, i + CHUNK)));
  return (await Promise.all(chunks)).flat();
}

async function aggregate(calls: Call[]): Promise<unknown[]> {
  const data = encodeFunctionData({
    abi: multicall3Abi,
    functionName: "aggregate3",
    args: [calls.map((c) => ({ target: c.address, allowFailure: true, callData: encodeFunctionData(c as never) }))],
  });
  const reply = await rpc<Hex>("eth_call", [{ to: MULTICALL3, data }, "latest"]);
  const results = decodeFunctionResult({ abi: multicall3Abi, functionName: "aggregate3", data: reply });
  return results.map(({ success, returnData }, i) => {
    if (!success || returnData === "0x") return undefined;
    try {
      return decodeFunctionResult({ ...calls[i]!, data: returnData } as never);
    } catch {
      return undefined;
    }
  });
}

/** keccak256 of the code at an address. */
export const codeHash = async (address: Address): Promise<Hex> =>
  keccak256(await rpc<Hex>("eth_getCode", [address, "latest"]));

/** The implementation behind an EIP-1967 proxy. */
export async function implementation(proxy: Address): Promise<Address> {
  return `0x${(await rpc<Hex>("eth_getStorageAt", [proxy, IMPLEMENTATION_SLOT, "latest"])).slice(-40)}`;
}

/** Runs calls one after the other from an address, without sending them. The first that fails and why, if any. */
export async function simulate(
  from: Address,
  calls: { to: Address; data: Hex }[],
): Promise<{ index: number; reason: string } | undefined> {
  type Result = { status: Hex; returnData: Hex; error?: { message?: string } };
  const [block] = await rpc<{ calls: Result[] }[]>("eth_simulateV1", [
    { blockStateCalls: [{ calls: calls.map(({ to, data }) => ({ from, to, data })) }] },
    "latest",
  ]);
  const results = block?.calls ?? [];
  if (results.length !== calls.length) throw new Error("No Base RPC simulated the calls.");
  const index = results.findIndex(({ status }) => status !== "0x1");
  if (index < 0) return undefined;
  const { returnData, error } = results[index]!;
  return { index, reason: revertReason(returnData) ?? error?.message ?? "no reason given" };
}

/** The message of a revert with a reason string, such as "Not token owner". */
function revertReason(data: Hex): string | undefined {
  try {
    const { args } = decodeErrorResult({ abi: [], data });
    return String(args?.[0]);
  } catch {
    return undefined;
  }
}

export const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Waits until Base includes a transaction, while following says to, then whether it succeeded; undefined once the page
 * stops following. A transaction the wallet replaced never comes: the page stops when its review closes.
 */
export async function included(hash: Hex, following: () => boolean): Promise<boolean | undefined> {
  while (following()) {
    const receipt = await rpc<{ status: Hex } | null>("eth_getTransactionReceipt", [hash]).catch(() => null);
    if (receipt) return receipt.status === "0x1";
    await sleep(2_000);
  }
  return undefined;
}
