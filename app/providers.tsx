"use client";

import { PrivyProvider } from "@privy-io/react-auth";
import { toSolanaWalletConnectors } from "@privy-io/react-auth/solana";
import { abstract, arbitrum, blast, ink, linea, mainnet, mode, optimism, scroll, unichain, worldchain, zora } from "viem/chains";
import { base, robinhoodChain } from "./lib/chains";
import { PRIVY_APP_ID } from "./lib/privy-config";
const solanaConnectors = toSolanaWalletConnectors();

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <PrivyProvider
      appId={PRIVY_APP_ID}
      config={{
        loginMethods: ["wallet", "email"],
        appearance: { theme: "dark", accentColor: "#ff6f83" },
        embeddedWallets: {
          ethereum: { createOnLogin: "all-users" },
          solana: { createOnLogin: "all-users" },
        },
        externalWallets: {
          solana: { connectors: solanaConnectors },
        },
        defaultChain: robinhoodChain,
        supportedChains: [mainnet, base, arbitrum, optimism, unichain, worldchain, blast, linea, scroll, zora, ink, abstract, mode, robinhoodChain],
      }}
    >
      {children}
    </PrivyProvider>
  );
}
