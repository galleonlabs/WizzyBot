import { defineChain } from "viem";
import { base } from "viem/chains";

export type ChainSlug = "base" | "robinhood";

export const ROBINHOOD_RPC_DEFAULT = "https://rpc.mainnet.chain.robinhood.com";

export const robinhoodChain = defineChain({
  id: 4663,
  name: "Robinhood",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [ROBINHOOD_RPC_DEFAULT] } },
  blockExplorers: {
    default: { name: "Blockscout", url: "https://robinhoodchain.blockscout.com" },
  },
});

export const CHAIN_META: Record<ChainSlug, { slug: ChainSlug; id: number; label: string }> = {
  base: { slug: "base", id: 8453, label: "Base" },
  robinhood: { slug: "robinhood", id: 4663, label: "Robinhood" },
};

export const CHAIN_SLUGS: readonly ChainSlug[] = ["base", "robinhood"];

export function parseChainSlug(input?: string | null): ChainSlug {
  const v = (input ?? "base").trim().toLowerCase();
  if (!v || v === "base" || v === "8453") return "base";
  if (v === "robinhood" || v === "rh" || v === "4663") return "robinhood";
  throw new Error("Unknown chain. Use base|robinhood.");
}

export function labelForChainId(id: number): string {
  return id === 4663 ? "Robinhood" : "Base";
}

export function slugForChainId(id: number): ChainSlug {
  return id === 4663 ? "robinhood" : "base";
}

export { base, robinhoodChain as robinhood };
