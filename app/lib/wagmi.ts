import { fallback, http } from "viem";
import { arbitrum, mainnet, optimism } from "viem/chains";
import { createConfig } from "wagmi";
import { injected } from "wagmi/connectors";
import { base, robinhoodChain } from "./chains";

/**
 * External wallets only. EIP-6963 discovery surfaces every installed browser
 * wallet; `injected` is the fallback for wallets that predate the standard.
 * Positions live on Base and Robinhood Chain; Ethereum, Arbitrum, and
 * Optimism are pay-from networks for Relay deposits.
 */
export const wagmiConfig = createConfig({
  chains: [base, robinhoodChain, mainnet, arbitrum, optimism],
  connectors: [injected()],
  transports: {
    [robinhoodChain.id]: fallback([http(), http("https://robinhood-rpc.publicnode.com")]),
    [base.id]: http(),
    [mainnet.id]: http("https://eth.merkle.io"),
    [arbitrum.id]: http("https://arb1.arbitrum.io/rpc"),
    [optimism.id]: http("https://mainnet.optimism.io"),
  },
});
