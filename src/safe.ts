import SafeAppsSDK from "@safe-global/safe-apps-sdk";
import type { Provider } from "./wallet.ts";

export async function provider(): Promise<Provider | undefined> {
  const sdk = new SafeAppsSDK({ allowedDomains: [/^https:\/\/app\.safe\.global$/] });
  // In any other frame, nothing answers.
  const timeout = new Promise<undefined>((resolve) => setTimeout(resolve, 1_000));
  const info = await Promise.race([sdk.safe.getInfo(), timeout]);
  if (!info) return undefined;
  return {
    async request({ method, params }) {
      if (method === "eth_requestAccounts") return [info.safeAddress];
      if (method === "eth_chainId") return `0x${info.chainId.toString(16)}`;
      if (method !== "wallet_sendCalls") {
        throw Object.assign(new Error(`Safe{Wallet} does not answer ${method} here.`), { code: 4200 });
      }
      const [{ calls }] = params as [{ calls: { to: string; data: string }[] }];
      const txs = calls.map(({ to, data }) => ({ to, data, value: "0" }));
      // Safe{Wallet} says "Transaction was rejected" when the user closes its window.
      await sdk.txs.send({ txs }).catch((error: Error) => {
        throw Object.assign(error, /rejected/i.test(error.message) ? { code: 4001 } : {});
      });
    },
  };
}
