export const ETH_FUNDING_CHAINS = [
  { id: 1, label: "Ethereum" },
  { id: 8453, label: "Base" },
  { id: 42161, label: "Arbitrum" },
  { id: 10, label: "Optimism" },
  { id: 130, label: "Unichain" },
  { id: 480, label: "World Chain" },
  { id: 81457, label: "Blast" },
  { id: 59144, label: "Linea" },
  { id: 534352, label: "Scroll" },
  { id: 7777777, label: "Zora" },
  { id: 57073, label: "Ink" },
  { id: 2741, label: "Abstract" },
  { id: 34443, label: "Mode" },
  { id: 4663, label: "Robinhood Chain" },
] as const;

export type EthFundingChain = (typeof ETH_FUNDING_CHAINS)[number];

export function ethFundingChain(chainId: number): EthFundingChain {
  const chain = ETH_FUNDING_CHAINS.find((candidate) => candidate.id === chainId);
  if (!chain) throw new Error("Choose a supported ETH network");
  return chain;
}
