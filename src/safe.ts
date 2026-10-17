import SafeAppsSDK from "@safe-global/safe-apps-sdk";
import type { Provider } from "./wallet.ts";

// The build bundles this file with Safe's SDK on its own, so the page loads them only when it runs in a frame.

/**
 * Safe{Wallet}'s provider when the page runs in it as a Safe App, else undefined. Safe{Wallet} has a second to answer.
 * It answers the requests the page makes, and sends calls as one Safe transaction for the owners to sign.
 */
export async function provider(): Promise<Provider | undefined> {
  const sdk = new SafeAppsSDK({ allowedDomains: [/^https:\/\/app\.safe\.global$/] });
  const info = await Promise.race([
    sdk.safe.getInfo(),
    new Promise<undefined>((resolve) => setTimeout(resolve, 1_000)),
  ]);
  if (!info) return undefined;
  const chainId = `0x${info.chainId.toString(16)}`;
  return {
    async request({ method, params }) {
      switch (method) {
        case "eth_accounts":
          return [info.safeAddress];
        case "eth_chainId":
          return chainId;
        case "wallet_getCapabilities":
          return { [chainId]: { atomic: { status: "supported" } } };
        case "wallet_sendCalls": {
          const [{ calls }] = params as [{ calls: { to: string; data: string }[] }];
          const txs = calls.map(({ to, data }) => ({ to, data, value: "0" }));
          // Safe{Wallet} answers "Transaction was rejected" when the user closes its window: the usual code says so.
          const { safeTxHash } = await sdk.txs.send({ txs }).catch((error: Error) => {
            throw Object.assign(error, /rejected/i.test(error.message) ? { code: 4001 } : {});
          });
          return { id: safeTxHash };
        }
        default:
          throw Object.assign(new Error(`Safe{Wallet} does not answer ${method} here.`), { code: 4200 });
      }
    },
  };
}
