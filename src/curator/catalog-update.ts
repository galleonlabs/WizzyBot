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

const CandidateNominationSchema = z.object({
  discoveryId: z.string().regex(/^[a-z0-9-]+$/),
  identity: z.enum(["reviewed", "watch"]),
  rationale: z.array(z.string().min(1).max(500)).min(1).max(10),
  sources: z.array(ResearchSourceSchema).min(3).max(12),
});

export const CuratorResearchDecisionSchema = z.object({
  schemaVersion: z.literal(1),
  verdict: z.enum(["no_change", "replace"]),
  summary: z.string().min(1).max(1_500),
  candidateReviews: z.array(CandidateReviewSchema).max(32),
  candidateNominations: z.array(CandidateNominationSchema).max(16),
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
  appliedNominations: string[];
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
  const candidates = new Map(curatorConfig.candidates.map((candidate) => [candidate.id, candidate]));
  const evaluations = new Map(input.report.evaluations.map((evaluation) => [evaluation.marketId, evaluation]));
  const appliedReviews: string[] = [];
  const appliedNominations: string[] = [];

  const discoveries = new Map(input.report.discoveries.map((discovery) => [discovery.id, discovery]));
  for (const nomination of decision.candidateNominations) {
    const discovery = discoveries.get(nomination.discoveryId);
    if (!discovery) throw new Error(`Research nominated unknown discovery ${nomination.discoveryId}`);
    assertResearchEvidence(nomination.sources, discovery.chain);
    if (candidates.has(discovery.id)) throw new Error(`Candidate ${discovery.id} is already tracked`);
    const duplicate = [
      ...curatorConfig.candidates.filter((candidate) => candidate.chain !== "solana"),
      ...catalog.chains.flatMap((chain) => chain.markets),
    ].some((candidate) => candidate.token.toLowerCase() === discovery.token.toLowerCase()
      || candidate.pool.toLowerCase() === discovery.pool.toLowerCase());
    if (duplicate) throw new Error(`Discovery ${discovery.id} duplicates a tracked token or pool`);
    const candidate = {
      id: discovery.id,
      name: discovery.name,
      symbol: discovery.symbol,
      feePips: discovery.feePips,
      risk: "experimental" as const,
      identity: nomination.identity,
      chain: discovery.chain,
      token: discovery.token,
      pool: discovery.pool,
      protocol: "V3" as const,
      sources: nomination.sources.map((source) => source.url),
    };
    curatorConfig.candidates.push(candidate);
    candidates.set(candidate.id, candidate);
    appliedNominations.push(`${candidate.id}:${candidate.identity}`);
  }

  for (const review of decision.candidateReviews) {
    const candidate = candidates.get(review.candidateId);
    if (!candidate) throw new Error(`Research reviewed unknown candidate ${review.candidateId}`);
    if (review.identity === "reviewed") {
      assertResearchEvidence(review.sources, candidate.chain);
      const evaluation = evaluations.get(review.candidateId);
      if (!evaluation || evaluation.incumbent) throw new Error(`Research is missing candidate evidence for ${review.candidateId}`);
    }
    if (candidate.identity !== review.identity) {
      candidate.identity = review.identity;
      appliedReviews.push(`${review.candidateId}:${review.identity}`);
    }
  }

  if (appliedReviews.length || appliedNominations.length) {
    curatorConfig.version += 1;
    curatorConfig.updatedAt = input.today;
  }

  let appliedReplacement: CentralizedCatalogUpdate["appliedReplacement"] = null;
  if (decision.replacement) {
    const replacement = input.report.replacements.find((proposal) =>
      proposal.incumbentMarketId === decision.replacement!.fromMarketId
      && proposal.candidateMarketId === decision.replacement!.toMarketId
    );
    if (!replacement) throw new Error("Agent replacement is not authorized by the deterministic curator report");
    const candidate = input.curatorConfig.candidates.find((row) => row.id === replacement.candidateMarketId);
    if (!candidate || candidate.chain !== replacement.chain || candidate.identity !== "reviewed") {
      throw new Error("Replacement candidate was not reviewed before this curator run");
    }
    if (candidate.chain === "solana") throw new Error("Solana candidates cannot be added to the EVM market catalog");
    const candidateEvaluation = evaluations.get(candidate.id);
    if (candidateEvaluation?.recommendation !== "eligible") throw new Error("Replacement candidate is not policy-eligible");

    const chain = catalog.chains.find((row) => row.slug === replacement.chain);
    if (!chain) throw new Error(`${replacement.chain} catalog is missing`);
    const outgoing = chain.markets.find((market) => market.id === replacement.incumbentMarketId);
    if (!outgoing || outgoing.status !== "active") throw new Error("Replacement incumbent is not active");
    if (chain.markets.some((market) => market.id === candidate.id)) throw new Error("Replacement candidate already exists in the catalog");
    const tickSpacing = candidate.protocol === "AERODROME_SLIPSTREAM" ? candidate.tickSpacing : tickSpacingFor(candidate.feePips);
    if (!tickSpacing) throw new Error(`${candidate.id} is missing tick spacing`);
    outgoing.status = "paused";
    chain.markets.push({
      id: candidate.id,
      name: candidate.name,
      symbol: candidate.symbol,
      token: candidate.token,
      tokenDecimals: outgoing.tokenDecimals,
      quoteToken: outgoing.quoteToken,
      quoteSymbol: outgoing.quoteSymbol,
      quoteDecimals: outgoing.quoteDecimals,
      protocol: candidate.protocol,
      ...(candidate.protocol === "AERODROME_SLIPSTREAM" ? { aerodromeDeployment: candidate.aerodromeDeployment } : {}),
      pool: candidate.pool,
      fee: candidate.feePips,
      tickSpacing,
      rangeWidthPct: outgoing.rangeWidthPct,
      status: "active",
      risk: candidate.risk,
      color: colorFor(candidate.id),
      liquidityVenues: [],
    });
    catalog.version += 1;
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
    appliedPauses.push(`${market.id}:${evaluation.reasons.join("; ")}`);
  }
  if (appliedPauses.length && !appliedReplacement) {
    catalog.version += 1;
    catalog.updatedAt = input.today;
  }

  const changedFiles: CentralizedCatalogUpdate["changedFiles"] = [];
  if (appliedReviews.length || appliedNominations.length) changedFiles.push("src/config/curator.json");
  if (appliedReplacement || appliedPauses.length) changedFiles.push("src/config/markets.json");
  return { curatorConfig, catalog, changedFiles, appliedReviews, appliedNominations, appliedReplacement, appliedPauses };
}

function assertResearchEvidence(
  sources: CuratorResearchDecision["candidateReviews"][number]["sources"],
  chain: CuratorConfig["candidates"][number]["chain"] | "base" | "robinhood",
): void {
  if (sources.length < 3) throw new Error("A reviewed identity requires at least three cited sources");
  const hosts = new Set(sources.map((source) => new URL(source.url).hostname.toLowerCase().replace(/^www\./, "")));
  if (hosts.size < 2) throw new Error("A reviewed identity requires evidence from at least two independent hosts");
  const requiredEvidenceHosts: Record<typeof chain, Set<string>> = {
    base: new Set(["geckoterminal.com", "basescan.org", "base.blockscout.com"]),
    robinhood: new Set(["geckoterminal.com", "robinhoodchain.blockscout.com"]),
    solana: new Set(["geckoterminal.com", "solscan.io", "explorer.solana.com"]),
  };
  if (![...hosts].some((host) => requiredEvidenceHosts[chain].has(host))) {
    throw new Error(`A reviewed ${chain} identity requires chain-specific explorer or GeckoTerminal evidence`);
  }
}

function tickSpacingFor(fee: number): number {
  const spacing = new Map([[100, 1], [500, 10], [3_000, 60], [10_000, 200]]).get(fee);
  if (!spacing) throw new Error(`Unsupported Uniswap V3 fee tier ${fee}`);
  return spacing;
}

function colorFor(id: string): string {
  const palette = ["#5ef0b6", "#f4c851", "#8ba8ff", "#ff8a62", "#d39aff", "#ff6f83"];
  const index = [...id].reduce((sum, character) => sum + character.charCodeAt(0), 0) % palette.length;
  return palette[index]!;
}
