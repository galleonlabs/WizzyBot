/** Networks a wallet can pay from. Each one is configured in the app's wallet client and CSP. */
export const RELAY_CHAINS = [
  { id: 8453, label: "Base", slug: "base" },
  { id: 4663, label: "Robinhood Chain", slug: "robinhood" },
  { id: 1, label: "Ethereum", slug: "ethereum" },
  { id: 42161, label: "Arbitrum", slug: "arbitrum" },
  { id: 10, label: "Optimism", slug: "optimism" },
] as const;

/** @deprecated Kept for the hosted agent surface; the app uses RELAY_CHAINS. */
export const ETH_FUNDING_CHAINS = RELAY_CHAINS;

export type RelayChain = (typeof RELAY_CHAINS)[number];

export function relayChain(chainId: number): RelayChain {
  const chain = RELAY_CHAINS.find((candidate) => candidate.id === chainId);
  if (!chain) throw new Error("Choose a supported network");
  return chain;
}
