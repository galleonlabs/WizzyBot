import { getAddress, isAddress } from "viem";
import { z } from "zod";
import rawConfig from "../config/curator.json" with { type: "json" };

const EvmAddress = z.string().refine(isAddress, "invalid EVM address").transform((value) => getAddress(value));
const Base58Address = z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/);

const PolicySchema = z.object({
  snapshotMinutes: z.number().int().min(15).max(1_440),
  historyDays: z.number().int().min(14).max(365),
  candidateProofDays: z.number().int().min(7),
  minimumPoolAgeDays: z.number().int().min(7),
  minimumLiquidityUsd: z.number().positive(),
  incumbentLiquidityUsd: z.number().positive(),
  minimumVolume24hUsd: z.number().positive(),
  maximumLiquidityDrop24hPct: z.number().positive().max(100),
  maximumPriceChange24hPct: z.number().positive().max(500),
  maximumTopHolderPct: z.number().positive().max(100),
  minimumQualityScore: z.number().int().min(0).max(100),
  maximumPoolAllocationBps: z.number().int().positive().max(1_000),
  replacementAprMultiplier: z.number().min(1).max(10),
  replacementQualityAdvantage: z.number().int().min(0).max(100),
  minimumReplacementLiquidityRatio: z.number().positive().max(1),
});

const CandidateBase = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  name: z.string().min(1),
  symbol: z.string().min(1),
  feePips: z.number().int().positive(),
  risk: z.enum(["established", "emerging", "experimental"]),
  identity: z.enum(["reviewed", "watch"]),
  sources: z.array(z.string().url()).min(2).max(12).optional(),
});

const CandidateSchema = z.discriminatedUnion("chain", [
  CandidateBase.extend({
    chain: z.literal("base"),
    token: EvmAddress,
    pool: EvmAddress,
    protocol: z.enum(["V3", "AERODROME_SLIPSTREAM"]),
    aerodromeDeployment: z.enum(["legacy", "min-unstake"]).optional(),
    tickSpacing: z.number().int().positive().optional(),
  }),
  CandidateBase.extend({
    chain: z.literal("robinhood"),
    token: EvmAddress,
    pool: EvmAddress,
    protocol: z.literal("V3"),
  }),
  CandidateBase.extend({
    chain: z.literal("solana"),
    token: Base58Address,
    pool: Base58Address,
    protocol: z.literal("Meteora DLMM"),
  }),
]);

const CuratorConfigSchema = z.object({
  version: z.number().int().positive(),
  updatedAt: z.string().date(),
  policy: PolicySchema,
  candidates: z.array(CandidateSchema),
}).superRefine((config, ctx) => {
  if (config.policy.incumbentLiquidityUsd > config.policy.minimumLiquidityUsd) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["policy", "incumbentLiquidityUsd"], message: "incumbent floor must not exceed candidate floor" });
  }
  const ids = new Set<string>();
  for (const [index, candidate] of config.candidates.entries()) {
    if (ids.has(candidate.id)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["candidates", index, "id"], message: `duplicate candidate ${candidate.id}` });
    ids.add(candidate.id);
    if (candidate.chain === "base" && candidate.protocol === "AERODROME_SLIPSTREAM" && !candidate.aerodromeDeployment) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["candidates", index, "aerodromeDeployment"], message: `${candidate.id} requires an Aerodrome deployment` });
    }
    if (candidate.chain === "base" && candidate.protocol === "AERODROME_SLIPSTREAM" && !candidate.tickSpacing) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["candidates", index, "tickSpacing"], message: `${candidate.id} requires Aerodrome tick spacing` });
    }
    if (candidate.chain === "base" && candidate.protocol === "V3" && (candidate.aerodromeDeployment || candidate.tickSpacing)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["candidates", index], message: `${candidate.id} has unused Aerodrome settings` });
    }
  }
});

export type CuratorPolicy = z.infer<typeof PolicySchema>;
export type CuratorCandidate = z.infer<typeof CandidateSchema>;
export type CuratorConfig = z.infer<typeof CuratorConfigSchema>;

export function parseCuratorConfig(input: unknown): CuratorConfig {
  return CuratorConfigSchema.parse(input);
}

const config = parseCuratorConfig(rawConfig);

export function getCuratorConfig(): CuratorConfig {
  return config;
}
