import { createCoinbaseWalletSDK } from "@coinbase/wallet-sdk";
import { CHAIN_ID } from "./config.ts";
import type { Provider } from "./wallet.ts";

// The build bundles this file with Coinbase's SDK on its own, so the page loads them only when someone picks Coinbase
// Wallet.
export const provider = (): Provider =>
  createCoinbaseWalletSDK({
    appName: "metaDEX Café",
    appChainIds: [CHAIN_ID],
    preference: { options: "all" },
  }).getProvider() as Provider;
