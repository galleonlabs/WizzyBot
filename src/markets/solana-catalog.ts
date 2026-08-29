import { z } from "zod";
import rawCatalog from "../config/solana-markets.json" with { type: "json" };

const Base58Schema = z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/);

const SolanaMarketSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  name: z.string().min(1),
  symbol: z.string().min(1),
  token: Base58Schema,
  quoteToken: Base58Schema,
  quoteSymbol: z.literal("SOL"),
  protocol: z.literal("Meteora DLMM"),
  pool: Base58Schema,
  feeBps: z.number().int().positive().max(10_000),
  binStep: z.number().int().positive(),
  rangeDelta: z.number().int().positive().max(34),
  weightBps: z.number().int().positive().max(10_000),
  status: z.enum(["active", "paused", "watch"]),
  risk: z.enum(["established", "emerging", "experimental"]),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
});

const SolanaChainSchema = z.object({
  slug: z.literal("solana"),
  chainId: z.literal(792703809),
  label: z.literal("Solana"),
  accent: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  minimumAllocationLamports: z.string().regex(/^\d+$/),
  gasReserveLamports: z.string().regex(/^\d+$/),
  markets: z.array(SolanaMarketSchema).min(1),
}).superRefine((chain, ctx) => {
  const activeWeight = chain.markets
    .filter((market) => market.status === "active")
    .reduce((sum, market) => sum + market.weightBps, 0);
  if (activeWeight !== 10_000) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["markets"], message: "active market weights must sum to 10,000 bps" });
  }
  const ids = new Set<string>();
  for (const market of chain.markets) {
    if (ids.has(market.id)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["markets"], message: `duplicate market id ${market.id}` });
    ids.add(market.id);
    if (market.token === market.quoteToken) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["markets"], message: `${market.id} token pair must be distinct` });
  }
});

const SolanaCatalogSchema = z.object({
  version: z.number().int().positive(),
  updatedAt: z.string().date(),
  chain: SolanaChainSchema,
});

export type SolanaMarket = z.infer<typeof SolanaMarketSchema>;
export type SolanaChainCatalog = z.infer<typeof SolanaChainSchema>;

const catalog = SolanaCatalogSchema.parse(rawCatalog);

export function getSolanaMarketCatalog(): SolanaChainCatalog {
  return catalog.chain;
}

export function activeSolanaMarkets(): SolanaMarket[] {
  return catalog.chain.markets.filter((market) => market.status === "active");
}
