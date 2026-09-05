import { getAddress, isAddress } from "viem";
import { z } from "zod";
import { addressesFor } from "../chains.js";
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

const VenueAdditionSchema = z.object({
  discoveryId: z.string().regex(/^[a-z0-9-]+$/),
  marketId: z.string().regex(/^[a-z0-9-]+$/),
  rationale: z.array(z.string().min(1).max(500)).min(1).max(10),
  sources: z.array(ResearchSourceSchema).min(3).max(12),
});

const MarketAdmissionSchema = z.object({
  candidateMarketId: z.string().regex(/^[a-z0-9-]+$/),
  rationale: z.array(z.string().min(1).max(500)).min(1).max(10),
});

export const CuratorResearchDecisionSchema = z.object({
  schemaVersion: z.literal(2),
  verdict: z.enum(["no_change", "update"]),
  summary: z.string().min(1).max(1_500),
  candidateReviews: z.array(CandidateReviewSchema),
  candidateNominations: z.array(CandidateNominationSchema).max(16),
  venueAdditions: z.array(VenueAdditionSchema).max(16),
  marketAdmissions: z.array(MarketAdmissionSchema).max(32),
});

export type CuratorResearchDecision = z.infer<typeof CuratorResearchDecisionSchema>;

export type CentralizedCatalogUpdate = {
  curatorConfig: CuratorConfig;
  catalog: MarketCatalog;
  changedFiles: Array<"src/config/curator.json" | "src/config/markets.json">;
  appliedReviews: string[];
  appliedNominations: string[];
  appliedVenues: string[];
  appliedAdmissions: string[];
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
  if (decision.schemaVersion !== 2) throw new Error("Unsupported curator research decision");
  if (input.report.version !== 1 || input.report.role !== "curator") throw new Error("Invalid deterministic curator report");
  if (input.report.configVersion !== input.curatorConfig.version) throw new Error("Curator report does not match the current candidate registry");

  const curatorConfig = structuredClone(input.curatorConfig);
  const catalog = structuredClone(input.catalog);
  const candidates = new Map(curatorConfig.candidates.map((candidate) => [candidate.id, candidate]));
  const evaluations = new Map(input.report.evaluations.map((evaluation) => [evaluation.marketId, evaluation]));
  const appliedReviews: string[] = [];
  const appliedNominations: string[] = [];
  const appliedVenues: string[] = [];

  const discoveries = new Map(input.report.discoveries.map((discovery) => [discovery.id, discovery]));
  for (const nomination of decision.candidateNominations) {
    const discovery = discoveries.get(nomination.discoveryId);
    if (!discovery) throw new Error(`Research nominated unknown discovery ${nomination.discoveryId}`);
    if (discovery.kind !== "candidate" || !discovery.executionReady || discovery.protocol !== "V3" || !isAddress(discovery.pool)) {
      throw new Error(`Discovery ${discovery.id} is a research lead, not an executable V3 catalog candidate`);
    }
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
      tokenDecimals: discovery.tokenDecimals,
      chain: discovery.chain,
      token: discovery.token,
      pool: discovery.pool,
      protocol: discovery.protocol,
      liquidityVenues: discovery.venues.flatMap((venue) =>
        venue.protocol === "V2" && venue.autoAttachable && isAddress(venue.pool)
          ? [{ protocol: "V2" as const, pool: getAddress(venue.pool) }]
          : []
      ).slice(0, 1),
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

  for (const addition of decision.venueAdditions) {
    const discovery = discoveries.get(addition.discoveryId);
    if (!discovery) throw new Error(`Research selected unknown venue discovery ${addition.discoveryId}`);
    if (discovery.kind !== "venue" || discovery.marketId !== addition.marketId) {
      throw new Error(`Discovery ${addition.discoveryId} does not belong to market ${addition.marketId}`);
    }
    if (!discovery.executionReady || discovery.protocol !== "V2" || !isAddress(discovery.pool)) {
      throw new Error(`Discovery ${addition.discoveryId} is not an attachable Uniswap V2 venue`);
    }
    assertResearchEvidence(addition.sources, discovery.chain);
    const chain = catalog.chains.find((entry) => entry.slug === discovery.chain);
    const market = chain?.markets.find((entry) => entry.id === addition.marketId);
    if (!market || market.token.toLowerCase() !== discovery.token.toLowerCase()) {
      throw new Error(`Tracked market ${addition.marketId} does not match venue discovery ${addition.discoveryId}`);
    }
    if (market.liquidityVenues.some((venue) => venue.protocol === "V2")) {
      throw new Error(`${market.id} already has a Uniswap V2 venue`);
    }
    market.liquidityVenues.push({ protocol: "V2", pool: getAddress(discovery.pool) });
    appliedVenues.push(`${market.id}:V2:${getAddress(discovery.pool)}`);
  }

  const appliedAdmissions: string[] = [];
  for (const admission of decision.marketAdmissions) {
    const proposal = input.report.admissions.find((candidate) => candidate.candidateMarketId === admission.candidateMarketId);
    if (!proposal) throw new Error(`Market admission ${admission.candidateMarketId} is not authorized by the deterministic curator report`);
    const candidate = input.curatorConfig.candidates.find((row) => row.id === admission.candidateMarketId);
    if (!candidate || candidate.chain !== proposal.chain || candidate.identity !== "reviewed") {
      throw new Error("Market admission requires a previously reviewed candidate");
    }
    if (candidate.chain === "solana") throw new Error("Solana candidates cannot be added to the EVM market catalog");
    const candidateEvaluation = evaluations.get(candidate.id);
    if (candidateEvaluation?.recommendation !== "eligible") throw new Error("Market admission candidate is not policy-eligible");
    const chain = catalog.chains.find((row) => row.slug === candidate.chain);
    if (!chain) throw new Error(`${candidate.chain} catalog is missing`);
    if (chain.markets.some((market) => market.id === candidate.id || market.token.toLowerCase() === candidate.token.toLowerCase())) {
      throw new Error("Market admission candidate already exists in the catalog");
    }
    const quote = chain.markets[0];
    if (!quote) throw new Error(`${candidate.chain} catalog has no quote-asset configuration`);
    const tickSpacing = candidate.protocol === "AERODROME_SLIPSTREAM" ? candidate.tickSpacing : tickSpacingFor(candidate.feePips);
    if (!tickSpacing) throw new Error(`${candidate.id} is missing tick spacing`);
    chain.markets.push({
      id: candidate.id,
      name: candidate.name,
      symbol: candidate.symbol,
      token: candidate.token,
      tokenDecimals: candidate.tokenDecimals,
      quoteToken: addressesFor(candidate.chain).weth,
      quoteSymbol: "WETH",
      quoteDecimals: 18,
      protocol: candidate.protocol,
      ...(candidate.protocol === "AERODROME_SLIPSTREAM" ? { aerodromeDeployment: candidate.aerodromeDeployment } : {}),
      pool: candidate.pool,
      fee: candidate.feePips,
      tickSpacing,
      rangeWidthPct: candidate.risk === "established" ? 30 : candidate.risk === "emerging" ? 40 : 50,
      status: "active",
      risk: candidate.risk,
      color: colorFor(candidate.id),
      liquidityVenues: candidate.liquidityVenues ?? [],
    });
    appliedAdmissions.push(candidate.id);
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
  if (appliedVenues.length || appliedAdmissions.length || appliedPauses.length) {
    catalog.version = input.catalog.version + 1;
    catalog.updatedAt = input.today;
  }

  const changedFiles: CentralizedCatalogUpdate["changedFiles"] = [];
  if (appliedReviews.length || appliedNominations.length) changedFiles.push("src/config/curator.json");
  if (appliedVenues.length || appliedAdmissions.length || appliedPauses.length) changedFiles.push("src/config/markets.json");
  return { curatorConfig, catalog, changedFiles, appliedReviews, appliedNominations, appliedVenues, appliedAdmissions, appliedPauses };
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
