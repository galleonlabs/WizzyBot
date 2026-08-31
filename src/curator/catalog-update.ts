import { z } from "zod";
import type { MarketCatalog } from "../markets/catalog.js";
import type { CuratorConfig } from "./config.js";
import type { CuratorReport } from "./run.js";

const ResearchSourceSchema = z.object({
  url: z.string().url(),
  title: z.string().min(1).max(200),
  finding: z.string().min(1).max(500),
});

const CandidateReviewSchema = z.object({
  candidateId: z.string().regex(/^[a-z0-9-]+$/),
  identity: z.enum(["reviewed", "watch"]),
  rationale: z.array(z.string().min(1).max(500)).min(1).max(10),
  sources: z.array(ResearchSourceSchema).max(12),
});

export const CuratorResearchDecisionSchema = z.object({
  schemaVersion: z.literal(1),
  verdict: z.enum(["no_change", "replace"]),
  summary: z.string().min(1).max(1_500),
  candidateReviews: z.array(CandidateReviewSchema).max(32),
  replacement: z.object({
    fromMarketId: z.string().regex(/^[a-z0-9-]+$/),
    toMarketId: z.string().regex(/^[a-z0-9-]+$/),
    rationale: z.array(z.string().min(1).max(500)).min(1).max(10),
  }).nullable(),
}).superRefine((decision, ctx) => {
  if ((decision.verdict === "replace") !== Boolean(decision.replacement)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["replacement"], message: "replacement must match the verdict" });
  }
});

export type CuratorResearchDecision = z.infer<typeof CuratorResearchDecisionSchema>;

export type CentralizedCatalogUpdate = {
  curatorConfig: CuratorConfig;
  catalog: MarketCatalog;
  changedFiles: Array<"src/config/curator.json" | "src/config/markets.json">;
  appliedReviews: string[];
  appliedReplacement: null | { fromMarketId: string; toMarketId: string };
  appliedPauses: string[];
};

export function planCentralizedCatalogUpdate(input: {
  report: CuratorReport;
  decision: CuratorResearchDecision;
  curatorConfig: CuratorConfig;
  catalog: MarketCatalog;
  today: string;
}): CentralizedCatalogUpdate {
  const decision = CuratorResearchDecisionSchema.parse(input.decision);
  if (decision.schemaVersion !== 1) throw new Error("Unsupported curator research decision");
  if (input.report.version !== 1 || input.report.role !== "curator") throw new Error("Invalid deterministic curator report");
  if (input.report.configVersion !== input.curatorConfig.version) throw new Error("Curator report does not match the current candidate registry");

  const curatorConfig = structuredClone(input.curatorConfig);
  const catalog = structuredClone(input.catalog);
  const sleeveTokens = new Set(
    catalog.chains.flatMap((chain) => chain.markets.filter((market) => market.sleeve).map((market) => market.token.toLowerCase())),
  );
  const sleeveIds = new Set(
    catalog.chains.flatMap((chain) => chain.markets.filter((market) => market.sleeve).map((market) => market.id)),
  );
  for (const candidate of curatorConfig.candidates) {
    if (sleeveTokens.has(candidate.token.toLowerCase())) {
      throw new Error(`Candidate ${candidate.id} is the related-party sleeve token; the curator never ranks or selects it`);
    }
  }
  const candidates = new Map(curatorConfig.candidates.map((candidate) => [candidate.id, candidate]));
  const evaluations = new Map(input.report.evaluations.map((evaluation) => [evaluation.marketId, evaluation]));
  const appliedReviews: string[] = [];

  for (const review of decision.candidateReviews) {
    const candidate = candidates.get(review.candidateId);
    if (!candidate) throw new Error(`Research reviewed unknown candidate ${review.candidateId}`);
    if (review.identity === "reviewed") {
      assertResearchEvidence(review.sources);
      const evaluation = evaluations.get(review.candidateId);
      if (!evaluation || evaluation.incumbent) throw new Error(`Research is missing candidate evidence for ${review.candidateId}`);
    }
    if (candidate.identity !== review.identity) {
      candidate.identity = review.identity;
      appliedReviews.push(`${review.candidateId}:${review.identity}`);
    }
  }

  if (appliedReviews.length) {
    curatorConfig.version += 1;
    curatorConfig.updatedAt = input.today;
  }

  let appliedReplacement: CentralizedCatalogUpdate["appliedReplacement"] = null;
  if (decision.replacement) {
    const replacement = input.report.replacements.find((proposal) =>
      proposal.chain === "robinhood"
      && proposal.incumbentMarketId === decision.replacement!.fromMarketId
      && proposal.candidateMarketId === decision.replacement!.toMarketId
    );
    if (!replacement) throw new Error("Agent replacement is not authorized by the deterministic curator report");
    if (sleeveIds.has(replacement.incumbentMarketId) || sleeveIds.has(replacement.candidateMarketId)) {
      throw new Error("The related-party sleeve is outside curator replacement authority");
    }
    const candidate = input.curatorConfig.candidates.find((row) => row.id === replacement.candidateMarketId);
    if (!candidate || candidate.chain !== "robinhood" || candidate.identity !== "reviewed") {
      throw new Error("Replacement candidate was not reviewed before this curator run");
    }
    const candidateEvaluation = evaluations.get(candidate.id);
    if (candidateEvaluation?.recommendation !== "eligible") throw new Error("Replacement candidate is not policy-eligible");

    const robinhood = catalog.chains.find((chain) => chain.slug === "robinhood");
    if (!robinhood) throw new Error("Robinhood catalog is missing");
    const outgoing = robinhood.markets.find((market) => market.id === replacement.incumbentMarketId);
    if (!outgoing || outgoing.status !== "active") throw new Error("Replacement incumbent is not active");
    if (robinhood.markets.some((market) => market.id === candidate.id)) throw new Error("Replacement candidate already exists in the catalog");
    const tickSpacing = tickSpacingFor(candidate.feePips);
    outgoing.status = "paused";
    robinhood.markets.push({
      id: candidate.id,
      name: candidate.name,
      symbol: candidate.symbol,
      token: candidate.token,
      tokenDecimals: outgoing.tokenDecimals,
      quoteToken: outgoing.quoteToken,
      quoteSymbol: outgoing.quoteSymbol,
      quoteDecimals: outgoing.quoteDecimals,
      protocol: "V3",
      pool: candidate.pool,
      fee: candidate.feePips,
      tickSpacing,
      rangeWidthPct: outgoing.rangeWidthPct,
      weightBps: outgoing.weightBps,
      status: "active",
      risk: candidate.risk,
      color: colorFor(candidate.id),
    });
    const nextVersion = catalog.version + 1;
    catalog.migrations.push({
      id: `curator-${nextVersion}-${outgoing.id}-to-${candidate.id}`,
      chain: "robinhood",
      fromMarketId: outgoing.id,
      toMarketId: candidate.id,
      effectiveAt: input.today,
    });
    catalog.version = nextVersion;
    catalog.updatedAt = input.today;
    appliedReplacement = { fromMarketId: outgoing.id, toMarketId: candidate.id };
  }

  const appliedPauses: string[] = [];
  for (const evaluation of input.report.evaluations) {
    if (!evaluation.incumbent || evaluation.recommendation !== "pause") continue;
    const chain = catalog.chains.find((row) => row.slug === evaluation.chain);
    if (!chain) continue;
    const market = chain.markets.find((row) => row.id === evaluation.marketId);
    if (!market || market.status !== "active") continue;
    const remaining = chain.markets.filter((row) => row.status === "active" && row.id !== market.id);
    if (!remaining.length) throw new Error(`Refusing to pause ${market.id}: it is the last active ${chain.slug} market`);
    market.status = "paused";
    redistributeWeight(remaining, market.weightBps);
    appliedPauses.push(`${market.id}:${evaluation.reasons.join("; ")}`);
  }
  if (appliedPauses.length && !appliedReplacement) {
    catalog.version += 1;
    catalog.updatedAt = input.today;
  }

  const changedFiles: CentralizedCatalogUpdate["changedFiles"] = [];
  if (appliedReviews.length) changedFiles.push("src/config/curator.json");
  if (appliedReplacement || appliedPauses.length) changedFiles.push("src/config/markets.json");
  return { curatorConfig, catalog, changedFiles, appliedReviews, appliedReplacement, appliedPauses };
}

/**
 * Spreads a paused market's weight across the remaining active markets in
 * proportion to their existing weights, keeping the active total at 10,000 bps
 * (largest-remainder rounding, ties broken by market id for determinism).
 */
function redistributeWeight(markets: Array<{ id: string; weightBps: number }>, freedBps: number): void {
  const remainingTotal = markets.reduce((sum, market) => sum + market.weightBps, 0);
  const target = remainingTotal + freedBps;
  const shares = markets.map((market) => {
    const exact = (market.weightBps * target) / remainingTotal;
    return { market, floor: Math.floor(exact), remainder: exact - Math.floor(exact) };
  });
  let leftover = target - shares.reduce((sum, share) => sum + share.floor, 0);
  shares.sort((a, b) => b.remainder - a.remainder || a.market.id.localeCompare(b.market.id));
  for (const share of shares) {
    share.market.weightBps = share.floor + (leftover > 0 ? 1 : 0);
    leftover -= leftover > 0 ? 1 : 0;
  }
}

function assertResearchEvidence(sources: CuratorResearchDecision["candidateReviews"][number]["sources"]): void {
  if (sources.length < 3) throw new Error("A reviewed identity requires at least three cited sources");
  const hosts = new Set(sources.map((source) => new URL(source.url).hostname.toLowerCase().replace(/^www\./, "")));
  if (hosts.size < 2) throw new Error("A reviewed identity requires evidence from at least two independent hosts");
  if (![...hosts].some((host) => host === "geckoterminal.com" || host === "robinhoodchain.blockscout.com")) {
    throw new Error("A reviewed identity requires GeckoTerminal or Robinhood Blockscout evidence");
  }
}

function tickSpacingFor(fee: number): number {
  const spacing = new Map([[100, 1], [500, 10], [3_000, 60], [10_000, 200]]).get(fee);
  if (!spacing) throw new Error(`Unsupported Robinhood fee tier ${fee}`);
  return spacing;
}

function colorFor(id: string): string {
  const palette = ["#5ef0b6", "#f4c851", "#8ba8ff", "#ff8a62", "#d39aff", "#ff6f83"];
  const index = [...id].reduce((sum, character) => sum + character.charCodeAt(0), 0) % palette.length;
  return palette[index]!;
}
