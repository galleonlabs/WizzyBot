"use client";

import { PrivyProvider } from "@privy-io/react-auth";
import { createSolanaRpc, createSolanaRpcSubscriptions } from "@solana/kit";
import { base, robinhoodChain } from "./lib/chains";

/** Una Privy app (public). Secret is never shipped. */
const DEFAULT_PRIVY_APP_ID = "cmteeqkjc03e20cjl59c9kbwu";

const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID ?? process.env.PRIVY_APP_ID ?? DEFAULT_PRIVY_APP_ID;
const solanaRpcUrl = process.env.NEXT_PUBLIC_SOLANA_RPC_URL ?? "https://api.mainnet-beta.solana.com";
const solanaWsUrl = process.env.NEXT_PUBLIC_SOLANA_WS_URL ?? "wss://api.mainnet-beta.solana.com";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <PrivyProvider
      appId={appId}
      config={{
        loginMethods: ["email"],
        appearance: { theme: "dark", accentColor: "#ff8fa3" },
        embeddedWallets: {
          ethereum: { createOnLogin: "users-without-wallets" },
          solana: { createOnLogin: "users-without-wallets" },
        },
        solana: {
          rpcs: {
            "solana:mainnet": {
              rpc: createSolanaRpc(solanaRpcUrl),
              rpcSubscriptions: createSolanaRpcSubscriptions(solanaWsUrl),
              blockExplorerUrl: "https://explorer.solana.com",
            },
          },
        },
        defaultChain: base,
        supportedChains: [base, robinhoodChain],
      }}
    >
      {children}
    </PrivyProvider>
  );
}
