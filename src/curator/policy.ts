import type { CuratorPolicy } from "./config.js";

export type CuratorChain = "base" | "robinhood" | "solana";
export type CuratorRisk = "established" | "emerging" | "experimental";

export type CuratorObservation = {
  marketId: string;
  chain: CuratorChain;
  name: string;
  symbol: string;
  token: string;
  pool: string;
  protocol: string;
  incumbent: boolean;
  catalogStatus: "active" | "paused" | "watch";
  risk: CuratorRisk;
  identity: "reviewed" | "watch";
  liquidityUsd: number | null;
  volume24hUsd: number | null;
  fees24hUsd: number | null;
  feeAprPct: number | null;
  priceUsd: number | null;
  priceChange24hPct: number | null;
  marketCapUsd: number | null;
  poolAgeDays: number | null;
  holderCount: number | null;
  topHolderPct: number | null;
  socialLinks: number;
  securityAvailable: boolean;
  securityFlags: string[];
  sourceUrl: string | null;
  observedAt: string;
};

export type CuratorSnapshot = {
  version: 1;
  observedAt: string;
  markets: CuratorObservation[];
};

export type MarketHistorySummary = {
  marketId: string;
  observations: number;
  historyHours: number;
  observationCoveragePct: number;
  medianLiquidityUsd: number | null;
  minimumLiquidityUsd: number | null;
  liquidityDrop24hPct: number | null;
  medianVolume24hUsd: number | null;
  medianFeeAprPct: number | null;
  p90AbsPriceChange24hPct: number | null;
  latestMarketCapUsd: number | null;
  latestPoolAgeDays: number | null;
  latestHolderCount: number | null;
  latestTopHolderPct: number | null;
  latestSocialLinks: number;
  latestSecurityAvailable: boolean;
  identity: "reviewed" | "watch";
  securityFlags: string[];
};

export type MarketEvaluation = {
  marketId: string;
  chain: CuratorChain;
  symbol: string;
  risk: CuratorRisk;
  incumbent: boolean;
  recommendation: "hold" | "review" | "pause" | "observe" | "eligible" | "reject";
  estimatedCapacityUsd: number | null;
  quality: {
    score: number;
    confidence: "low" | "medium" | "high";
    depth: number;
    flow: number;
    durability: number;
    resilience: number;
    trust: number;
  };
  reasons: string[];
  summary: MarketHistorySummary;
};

export type ReplacementProposal = {
  chain: CuratorChain;
  candidateMarketId: string;
  candidateSymbol: string;
  incumbentMarketId: string;
  incumbentSymbol: string;
  candidateFeeAprPct: number;
  incumbentFeeAprPct: number;
  aprMultiple: number;
  candidateQualityScore: number;
  incumbentQualityScore: number;
  qualityAdvantage: number;
  liquidityRatio: number;
};

function finite(values: Array<number | null>): number[] {
  return values.filter((value): value is number => value !== null && Number.isFinite(value));
}

function quantile(values: number[], fraction: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * fraction) - 1));
  return sorted[index] ?? null;
}

function median(values: Array<number | null>): number | null {
  return quantile(finite(values), 0.5);
}

function ageHours(first: string, last: string): number {
  return Math.max(0, (Date.parse(last) - Date.parse(first)) / 3_600_000);
}

export function summarizeMarketHistory(observations: CuratorObservation[], snapshotMinutes = 60): MarketHistorySummary {
  if (!observations.length) throw new Error("Cannot summarize empty market history");
  const ordered = [...observations].sort((a, b) => Date.parse(a.observedAt) - Date.parse(b.observedAt));
  const latest = ordered.at(-1)!;
  const latestAt = Date.parse(latest.observedAt);
  const recent = ordered.filter((row) => latestAt - Date.parse(row.observedAt) <= 24 * 3_600_000);
  const prior24h = [...ordered].reverse().find((row) => latestAt - Date.parse(row.observedAt) >= 23 * 3_600_000);
  const liquidityDrop24hPct = latest.liquidityUsd !== null && prior24h?.liquidityUsd && prior24h.liquidityUsd > 0
    ? Math.max(0, ((prior24h.liquidityUsd - latest.liquidityUsd) / prior24h.liquidityUsd) * 100)
    : null;
  const historyHours = ageHours(ordered[0]!.observedAt, latest.observedAt);
  const expectedObservations = historyHours === 0 ? 1 : Math.floor(historyHours * 60 / snapshotMinutes) + 1;
  return {
    marketId: latest.marketId,
    observations: ordered.length,
    historyHours,
    observationCoveragePct: Math.min(100, ordered.length / expectedObservations * 100),
    medianLiquidityUsd: median(ordered.map((row) => row.liquidityUsd)),
    minimumLiquidityUsd: quantile(finite(ordered.map((row) => row.liquidityUsd)), 0),
    liquidityDrop24hPct,
    medianVolume24hUsd: median(ordered.map((row) => row.volume24hUsd)),
    medianFeeAprPct: median(ordered.map((row) => row.feeAprPct)),
    p90AbsPriceChange24hPct: quantile(finite(ordered.map((row) => row.priceChange24hPct === null ? null : Math.abs(row.priceChange24hPct))), 0.9),
    latestMarketCapUsd: latest.marketCapUsd,
    latestPoolAgeDays: latest.poolAgeDays,
    latestHolderCount: latest.holderCount,
    latestTopHolderPct: latest.topHolderPct,
    latestSocialLinks: latest.socialLinks,
    latestSecurityAvailable: recent.some((row) => row.securityAvailable),
    identity: latest.identity,
    securityFlags: [...new Set(recent.flatMap((row) => row.securityFlags))],
  };
}

function marketFloor(incumbent: boolean, policy: CuratorPolicy): number {
  return incumbent ? policy.incumbentLiquidityUsd : policy.minimumLiquidityUsd;
}

function scaled(value: number | null, floor: number, ceiling: number, points: number): number {
  if (value === null || !Number.isFinite(value) || value <= 0) return 0;
  if (value <= floor) return value / floor * points * 0.4;
  if (value >= ceiling) return points;
  return points * (0.4 + 0.6 * (value - floor) / (ceiling - floor));
}

function rounded(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

export function assessMarketQuality(
  summary: MarketHistorySummary,
  incumbent: boolean,
  policy: CuratorPolicy,
): MarketEvaluation["quality"] {
  const floor = marketFloor(incumbent, policy);
  const depth = scaled(summary.medianLiquidityUsd, floor, floor * 4, 25);
  const turnover = summary.medianLiquidityUsd && summary.medianVolume24hUsd !== null
    ? summary.medianVolume24hUsd / summary.medianLiquidityUsd
    : null;
  const flow = scaled(summary.medianVolume24hUsd, policy.minimumVolume24hUsd, policy.minimumVolume24hUsd * 8, 8)
    + scaled(turnover, 0.05, 1, 12);
  const durability = scaled(summary.latestPoolAgeDays, policy.minimumPoolAgeDays, 180, 12)
    + scaled(summary.historyHours, 24, policy.candidateProofDays * 24, 8);
  const volatility = summary.p90AbsPriceChange24hPct;
  const priceResilience = volatility === null
    ? 0
    : volatility <= 15
      ? 15
      : volatility <= 30
        ? 10
        : volatility <= policy.maximumPriceChange24hPct
          ? 5
          : 0;
  const drop = summary.liquidityDrop24hPct;
  const liquidityResilience = drop === null ? 0 : drop <= 10 ? 5 : drop <= 25 ? 2 : 0;
  const resilience = priceResilience + liquidityResilience;
  const trust = (summary.identity === "reviewed" ? 5 : 0)
    + (summary.latestSecurityAvailable ? 5 : 0)
    + (summary.latestSecurityAvailable && summary.securityFlags.length === 0 ? 3 : 0)
    + (summary.latestTopHolderPct !== null && summary.latestTopHolderPct <= policy.maximumTopHolderPct ? 2 : 0);
  const score = rounded(depth + flow + durability + resilience + trust);
  const proofComplete = summary.historyHours >= policy.candidateProofDays * 24 && summary.observationCoveragePct >= 80;
  const confidence = !summary.latestSecurityAvailable || summary.historyHours < 24
    ? "low"
    : proofComplete
      ? "high"
      : "medium";
  return {
    score,
    confidence,
    depth: rounded(depth),
    flow: rounded(flow),
    durability: rounded(durability),
    resilience: rounded(resilience),
    trust: rounded(trust),
  };
}

export function evaluateMarket(observations: CuratorObservation[], policy: CuratorPolicy): MarketEvaluation {
  if (!observations.length) throw new Error("Cannot evaluate empty market history");
  const latest = [...observations].sort((a, b) => Date.parse(a.observedAt) - Date.parse(b.observedAt)).at(-1)!;
  const summary = summarizeMarketHistory(observations, policy.snapshotMinutes);
  const reasons: string[] = [];
  const hardSecurityFailure = summary.securityFlags.length > 0;
  const collapsed = summary.liquidityDrop24hPct !== null && summary.liquidityDrop24hPct >= policy.maximumLiquidityDrop24hPct;
  const enoughCoverage = summary.observationCoveragePct >= 80;
  const proofComplete = summary.historyHours >= policy.candidateProofDays * 24 && enoughCoverage;
  const liquidityPass = summary.medianLiquidityUsd !== null && summary.medianLiquidityUsd >= marketFloor(latest.incumbent, policy);
  const volumePass = summary.medianVolume24hUsd !== null && summary.medianVolume24hUsd >= policy.minimumVolume24hUsd;
  const agePass = summary.latestPoolAgeDays !== null && summary.latestPoolAgeDays >= policy.minimumPoolAgeDays;
  const identityPass = summary.identity === "reviewed";
  const securityPass = summary.latestSecurityAvailable;
  const volatilityPass = summary.p90AbsPriceChange24hPct !== null
    && summary.p90AbsPriceChange24hPct <= policy.maximumPriceChange24hPct;
  const concentrationPass = summary.latestTopHolderPct === null
    || summary.latestTopHolderPct <= policy.maximumTopHolderPct;
  const estimatedCapacityUsd = summary.medianLiquidityUsd === null ? null : summary.medianLiquidityUsd * policy.maximumPoolAllocationBps / 10_000;
  const quality = assessMarketQuality(summary, latest.incumbent, policy);
  const qualityPass = quality.score >= policy.minimumQualityScore;

  if (hardSecurityFailure) reasons.push(`security: ${summary.securityFlags.join(", ")}`);
  if (collapsed) reasons.push(`pool liquidity fell ${summary.liquidityDrop24hPct!.toFixed(0)}% in 24h`);
  if (!agePass) reasons.push(summary.latestPoolAgeDays === null ? "pool age is unavailable" : `pool is younger than ${policy.minimumPoolAgeDays} days`);
  if (!liquidityPass) reasons.push(summary.medianLiquidityUsd === null
    ? "pool liquidity data is unavailable"
    : `median pool liquidity is below $${marketFloor(latest.incumbent, policy).toLocaleString()}`);
  if (!volumePass) reasons.push(summary.medianVolume24hUsd === null
    ? "daily volume data is unavailable"
    : `median daily volume is below $${policy.minimumVolume24hUsd.toLocaleString()}`);
  if (!identityPass) reasons.push("token identity and social history still need review");
  if (!securityPass) reasons.push("security provider data is unavailable");
  if (!volatilityPass) reasons.push(summary.p90AbsPriceChange24hPct === null
    ? "price-movement data is unavailable"
    : `90th-percentile daily price move exceeds ${policy.maximumPriceChange24hPct}%`);
  if (!concentrationPass) reasons.push(`largest externally owned holder exceeds ${policy.maximumTopHolderPct}%`);
  if (!latest.incumbent && !qualityPass) reasons.push(`LP quality score is below ${policy.minimumQualityScore}`);
  if (!latest.incumbent && !proofComplete) reasons.push(`candidate needs ${policy.candidateProofDays} tracked days`);

  let recommendation: MarketEvaluation["recommendation"];
  if (hardSecurityFailure || collapsed) recommendation = latest.incumbent ? "pause" : "reject";
  else if (latest.incumbent) recommendation = liquidityPass && volumePass && agePass && securityPass && volatilityPass && concentrationPass ? "hold" : "review";
  else if (!proofComplete || !liquidityPass || !volumePass || !agePass || !identityPass || !securityPass || !volatilityPass || !concentrationPass || !qualityPass) recommendation = "observe";
  else recommendation = "eligible";

  if (!reasons.length) reasons.push(latest.incumbent ? "all maintained-market gates pass" : "all candidate gates pass");
  return { marketId: latest.marketId, chain: latest.chain, symbol: latest.symbol, risk: latest.risk, incumbent: latest.incumbent, recommendation, estimatedCapacityUsd, quality, reasons, summary };
}

function riskRank(risk: CuratorRisk): number {
  return risk === "established" ? 0 : risk === "emerging" ? 1 : 2;
}

export function proposeReplacements(evaluations: MarketEvaluation[], policy: CuratorPolicy): ReplacementProposal[] {
  const proposals: ReplacementProposal[] = [];
  for (const candidate of evaluations.filter((row) => !row.incumbent && row.recommendation === "eligible" && row.summary.medianFeeAprPct !== null)) {
    const incumbent = evaluations
      .filter((row) => row.incumbent
        && row.chain === candidate.chain
        && row.summary.medianFeeAprPct !== null
        && row.recommendation !== "pause"
        && riskRank(row.risk) >= riskRank(candidate.risk))
      .sort((a, b) => {
        if (a.recommendation !== b.recommendation) return a.recommendation === "review" ? -1 : 1;
        if (a.quality.score !== b.quality.score) return a.quality.score - b.quality.score;
        return a.summary.medianFeeAprPct! - b.summary.medianFeeAprPct!;
      })[0];
    if (!incumbent) continue;
    const candidateFeeAprPct = candidate.summary.medianFeeAprPct!;
    const incumbentFeeAprPct = incumbent.summary.medianFeeAprPct!;
    const aprMultiple = candidateFeeAprPct / Math.max(0.01, incumbentFeeAprPct);
    const candidateLiquidity = candidate.summary.medianLiquidityUsd ?? 0;
    const incumbentLiquidity = incumbent.summary.medianLiquidityUsd ?? 0;
    const liquidityRatio = incumbentLiquidity > 0 ? candidateLiquidity / incumbentLiquidity : 0;
    const qualityAdvantage = candidate.quality.score - incumbent.quality.score;
    if (liquidityRatio < policy.minimumReplacementLiquidityRatio) continue;
    const requiredQualityAdvantage = incumbent.recommendation === "review" ? 0 : policy.replacementQualityAdvantage;
    if (qualityAdvantage < requiredQualityAdvantage) continue;
    if (incumbent.recommendation !== "review" && aprMultiple < policy.replacementAprMultiplier) continue;
    proposals.push({
      chain: candidate.chain,
      candidateMarketId: candidate.marketId,
      candidateSymbol: candidate.symbol,
      incumbentMarketId: incumbent.marketId,
      incumbentSymbol: incumbent.symbol,
      candidateFeeAprPct,
      incumbentFeeAprPct,
      aprMultiple,
      candidateQualityScore: candidate.quality.score,
      incumbentQualityScore: incumbent.quality.score,
      qualityAdvantage,
      liquidityRatio,
    });
  }
  return proposals;
}
