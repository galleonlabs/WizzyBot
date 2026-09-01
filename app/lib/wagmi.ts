import { fallback, http } from "viem";
import { createConfig } from "wagmi";
import { injected } from "wagmi/connectors";
import { base, robinhoodChain } from "./chains";

/**
 * External wallets only. EIP-6963 discovery surfaces every installed browser
 * wallet; `injected` is the fallback for wallets that predate the standard.
 * Transactions are signed and paid by the user's own wallet on both chains.
 */
export const wagmiConfig = createConfig({
  chains: [robinhoodChain, base],
  connectors: [injected()],
  transports: {
    [robinhoodChain.id]: fallback([http(), http("https://robinhood-rpc.publicnode.com")]),
    [base.id]: http(),
  },
});
