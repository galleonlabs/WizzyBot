import { getAddress, isAddress, type Address } from "viem";
import { z } from "zod";
import rawCatalog from "../config/markets.json" with { type: "json" };
import type { ChainSlug } from "../chains.js";

const AddressSchema = z.string().refine(isAddress, "invalid EVM address").transform((value) => getAddress(value));
const PoolIdSchema = z.string().regex(/^0x[0-9a-fA-F]{64}$/, "invalid v4 pool id");

const LiquidityVenueSchema = z.discriminatedUnion("protocol", [
  z.object({
    protocol: z.literal("V2"),
    pool: AddressSchema,
  }),
  z.object({
    protocol: z.literal("V4"),
    poolId: PoolIdSchema,
    quoteSymbol: z.literal("ETH"),
    fee: z.number().int().positive(),
    tickSpacing: z.number().int().positive(),
    hooks: AddressSchema,
  }),
]);

const MarketSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  name: z.string().min(1),
  symbol: z.string().min(1),
  token: AddressSchema,
  tokenDecimals: z.number().int().min(0).max(36),
  quoteToken: AddressSchema,
  quoteSymbol: z.string().min(1),
  quoteDecimals: z.number().int().min(0).max(36),
  protocol: z.enum(["V3", "AERODROME_SLIPSTREAM"]),
  aerodromeDeployment: z.enum(["legacy", "min-unstake"]).optional(),
  pool: AddressSchema,
  fee: z.number().int().positive(),
  tickSpacing: z.number().int().positive(),
  rangeWidthPct: z.number().positive().lt(100),
  status: z.enum(["active", "paused", "watch"]),
  risk: z.enum(["established", "emerging", "experimental"]),
  coingeckoId: z.string().min(1).optional(),
  imageUrl: z.string().url().optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  liquidityVenues: z.array(LiquidityVenueSchema).max(2).default([]),
});

const ChainMarketSchema = z.object({
  slug: z.enum(["base", "robinhood"]),
  chainId: z.number().int().positive(),
  label: z.string().min(1),
  accent: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  minimumAllocationWei: z.string().regex(/^\d+$/),
  markets: z.array(MarketSchema).min(1),
});

const CatalogSchema = z.object({
  version: z.number().int().positive(),
  updatedAt: z.string().date(),
  fees: z.object({
    allocateBps: z.number().int().min(0).max(10_000),
    withdrawBps: z.number().int().min(0).max(10_000),
    rebalanceBps: z.number().int().min(0).max(10_000),
    compoundBps: z.number().int().min(0).max(10_000),
  }),
  chains: z.array(ChainMarketSchema).length(2),
}).superRefine((catalog, ctx) => {
  const ids = new Set<string>();
  for (const [chainIndex, chain] of catalog.chains.entries()) {
    for (const market of chain.markets) {
      if (ids.has(market.id)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["chains", chainIndex, "markets"], message: `duplicate market id ${market.id}` });
      }
      ids.add(market.id);
      if (market.token.toLowerCase() === market.quoteToken.toLowerCase()) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["chains", chainIndex, "markets"], message: `${market.id} token pair must be distinct` });
      }
      if (market.protocol === "AERODROME_SLIPSTREAM" && chain.slug !== "base") {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["chains", chainIndex, "markets"], message: `${market.id} Aerodrome venue must be on Base` });
      }
      if (market.protocol === "AERODROME_SLIPSTREAM" && !market.aerodromeDeployment) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["chains", chainIndex, "markets"], message: `${market.id} requires an Aerodrome deployment` });
      }
      if (market.protocol === "V3" && market.aerodromeDeployment) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["chains", chainIndex, "markets"], message: `${market.id} has an unused Aerodrome deployment` });
      }
      const alternativeProtocols = market.liquidityVenues.map((venue) => venue.protocol);
      if (new Set(alternativeProtocols).size !== alternativeProtocols.length) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["chains", chainIndex, "markets"], message: `${market.id} has duplicate alternative protocols` });
      }
    }
  }
});

export type CuratedMarket = z.infer<typeof MarketSchema>;
export type CuratedChain = z.infer<typeof ChainMarketSchema>;
export type MarketCatalog = z.infer<typeof CatalogSchema>;

export function parseMarketCatalog(input: unknown): MarketCatalog {
  return CatalogSchema.parse(input);
}

const catalog: MarketCatalog = parseMarketCatalog(rawCatalog);

export function getMarketCatalog(): MarketCatalog {
  return catalog;
}

export function chainCatalog(slug: ChainSlug): CuratedChain {
  const chain = catalog.chains.find((candidate) => candidate.slug === slug);
  if (!chain) throw new Error(`No market catalog for ${slug}`);
  return chain;
}

export function activeMarkets(slug: ChainSlug, marketIds?: readonly string[]): CuratedMarket[] {
  const selected = marketIds ? new Set(marketIds) : undefined;
  const markets = chainCatalog(slug).markets.filter(
    (market) => market.status === "active" && (!selected || selected.has(market.id)),
  );
  if (selected) {
    const missing = [...selected].filter((id) => !markets.some((market) => market.id === id));
    if (missing.length) throw new Error(`Unknown or inactive markets: ${missing.join(", ")}`);
  }
  if (!markets.length) throw new Error(`No active markets selected for ${slug}`);
  return markets;
}

export function allowedMarketAddresses(slug: ChainSlug): Address[] {
  const out = new Set<Address>();
  for (const market of chainCatalog(slug).markets) {
    out.add(market.token);
    out.add(market.quoteToken);
    out.add(market.pool);
  }
  return [...out];
}
