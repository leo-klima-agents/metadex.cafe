import { decodeFunctionResult, encodeFunctionData, keccak256, parseAbi, type Abi, type Address, type Hex } from "viem";
import { MULTICALL3, RPCS } from "./config.ts";

export type Call = { address: Address; abi: Abi; functionName: string; args: unknown[] };

const multicall3Abi = parseAbi([
  "function aggregate3((address target, bool allowFailure, bytes callData)[] calls) payable returns ((bool success, bytes returnData)[])",
  "function getCurrentBlockTimestamp() view returns (uint256 timestamp)",
]);
const EIP1967_IMPLEMENTATION_SLOT = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";
const CHUNK = 200;

// Unlike viem's isAddressEqual, it never throws, as on the undefined of a read that failed.
export const same = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase();

export const call = (address: Address, abi: Abi, functionName: string, ...args: unknown[]): Call => ({
  address,
  abi,
  functionName,
  args,
});

export const blockTime = call(MULTICALL3, multicall3Abi, "getCurrentBlockTimestamp");

export async function rpc<T>(method: string, params: unknown[]): Promise<T> {
  for (const url of RPCS) {
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
        signal: AbortSignal.timeout(5_000),
      });
      const { result } = (await response.json()) as { result?: T };
      if (result !== undefined) return result;
    } catch {}
  }
  throw new Error(`No Base RPC answered ${method}.`);
}

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

export const codeHash = async (address: Address): Promise<Hex> =>
  keccak256(await rpc<Hex>("eth_getCode", [address, "latest"]));

export const implementation = async (proxy: Address): Promise<Address> =>
  `0x${(await rpc<Hex>("eth_getStorageAt", [proxy, EIP1967_IMPLEMENTATION_SLOT, "latest"])).slice(-40)}`;

export async function included(hash: Hex): Promise<boolean | undefined> {
  const end = Date.now() + 10 * 60_000;
  while (Date.now() < end) {
    const receipt = await rpc<{ status: Hex } | null>("eth_getTransactionReceipt", [hash]).catch(() => null);
    if (receipt) return receipt.status === "0x1";
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
  return undefined;
}
