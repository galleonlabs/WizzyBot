"use client";

import { PrivyProvider } from "@privy-io/react-auth";
import { base } from "viem/chains";

/** UnaBot Privy app (public). Secret is never shipped. */
const DEFAULT_PRIVY_APP_ID = "cmte7ydie07zb0djopp7gds6m";

const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID ?? process.env.PRIVY_APP_ID ?? DEFAULT_PRIVY_APP_ID;

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <PrivyProvider
      appId={appId}
      config={{
        loginMethods: ["email"],
        appearance: { theme: "dark", accentColor: "#c8f542" },
        embeddedWallets: { ethereum: { createOnLogin: "users-without-wallets" } },
        defaultChain: base,
        supportedChains: [base],
      }}
    >
      {children}
    </PrivyProvider>
  );
}
