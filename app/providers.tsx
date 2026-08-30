"use client";

import { PrivyProvider } from "@privy-io/react-auth";
import { createSolanaRpc, createSolanaRpcSubscriptions } from "@solana/kit";
import { abstract, arbitrum, blast, ink, linea, mainnet, mode, optimism, scroll, unichain, worldchain, zora } from "viem/chains";
import { base, robinhoodChain } from "./lib/chains";

/** Wizzy Privy app (public). Secret is never shipped. */
const DEFAULT_PRIVY_APP_ID = "cmtft1kti01cf0dl73c3zpuem";

const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID ?? process.env.PRIVY_APP_ID ?? DEFAULT_PRIVY_APP_ID;
const solanaRpcUrl = process.env.NEXT_PUBLIC_SOLANA_RPC_URL ?? "https://api.mainnet-beta.solana.com";
const solanaWsUrl = process.env.NEXT_PUBLIC_SOLANA_WS_URL ?? "wss://api.mainnet-beta.solana.com";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <PrivyProvider
      appId={appId}
      config={{
        loginMethods: ["wallet", "email"],
        appearance: { theme: "dark", accentColor: "#ff6f83" },
        embeddedWallets: {
          ethereum: { createOnLogin: "all-users" },
          solana: { createOnLogin: "all-users" },
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
        defaultChain: robinhoodChain,
        supportedChains: [mainnet, base, arbitrum, optimism, unichain, worldchain, blast, linea, scroll, zora, ink, abstract, mode, robinhoodChain],
      }}
    >
      {children}
    </PrivyProvider>
  );
}
