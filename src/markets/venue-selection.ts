export const VENUE_SELECTION_METHODOLOGY = "venue-quality-v1";

export type VenueKey = "PRIMARY" | "V2" | "V4";
export type VenueProtocol = "V2" | "V3" | "V4" | "AERODROME_SLIPSTREAM";

export type VenueObservation = {
  key: VenueKey;
  protocol: VenueProtocol;
  poolReference: `0x${string}`;
  executable: boolean;
  pairVerified: boolean;
  liquidityUsd: number | null;
  volume24hUsd: number | null;
  feePips: number;
  poolAgeDays: number | null;
  priceChange24hPct: number | null;
  estimatedEntryCostUsd: number | null;
  observedAt: string;
  sourceUrl?: string | null;
};

export type RankedVenue = VenueObservation & {
  eligible: boolean;
  score: number | null;
  rejectionReasons: VenueRejectionReason[];
};

export type VenueRejectionReason =
  | "not_executable"
  | "pair_not_verified"
  | "missing_live_evidence"
  | "stale_observation"
  | "liquidity_below_floor"
  | "pool_too_new";

export type VenueSelection = {
  methodology: typeof VENUE_SELECTION_METHODOLOGY;
  selectedKey: VenueKey;
  selectedProtocol: VenueProtocol;
  selectedPoolReference: `0x${string}`;
  switched: boolean;
  confidence: "high" | "guarded" | "fallback";
  decisionReasons: string[];
  ranked: RankedVenue[];
};

export type VenueSelectionPolicy = {
  minimumLiquidityUsd: number;
  minimumPoolAgeDays: number;
  maximumObservationAgeMinutes: number;
  minimumSwitchScoreAdvantage: number;
  minimumSwitchLiquidityRatio: number;
};

export const DEFAULT_VENUE_SELECTION_POLICY: VenueSelectionPolicy = {
  minimumLiquidityUsd: 50_000,
  minimumPoolAgeDays: 14,
  maximumObservationAgeMinutes: 15,
  minimumSwitchScoreAdvantage: 8,
  minimumSwitchLiquidityRatio: 0.4,
};

export function selectBestVenue(
  observations: readonly VenueObservation[],
  options: { now?: string; policy?: Partial<VenueSelectionPolicy> } = {},
): VenueSelection {
  const primary = observations.find((observation) => observation.key === "PRIMARY");
  if (!primary) throw new Error("Venue selection requires a PRIMARY observation");
  const nowMs = Date.parse(options.now ?? new Date().toISOString());
  if (!Number.isFinite(nowMs)) throw new Error("Venue selection requires a valid decision time");
  const policy = { ...DEFAULT_VENUE_SELECTION_POLICY, ...options.policy };

  const eligibleInputs = observations.filter((observation) => rejectionReasons(observation, nowMs, policy).length === 0);
  const maximumLiquidity = Math.max(...eligibleInputs.map((observation) => observation.liquidityUsd ?? 0), 1);
  const maximumVolume = Math.max(...eligibleInputs.map((observation) => observation.volume24hUsd ?? 0), 1);
  const ranked = observations
    .map((observation): RankedVenue => {
      const rejected = rejectionReasons(observation, nowMs, policy);
      return {
        ...observation,
        eligible: rejected.length === 0,
        score: rejected.length ? null : scoreVenue(observation, maximumLiquidity, maximumVolume),
        rejectionReasons: rejected,
      };
    })
    .sort((a, b) => (b.score ?? -1) - (a.score ?? -1) || (b.liquidityUsd ?? 0) - (a.liquidityUsd ?? 0));

  const eligible = ranked.filter((candidate) => candidate.eligible);
  const rankedPrimary = ranked.find((candidate) => candidate.key === "PRIMARY")!;
  const leader = eligible[0];
  if (!leader) return fallback(primary, ranked, ["No venue had complete, fresh eligibility evidence; retained the reviewed primary pool."]);
  if (!rankedPrimary.eligible) {
    return selection(leader, ranked, leader.key !== "PRIMARY", "guarded", [
      leader.key === "PRIMARY"
        ? "The reviewed primary pool is the only eligible venue."
        : "The reviewed primary pool was ineligible, so the highest-quality eligible venue was selected.",
    ]);
  }
  if (leader.key === "PRIMARY") {
    return selection(primary, ranked, false, "high", ["The reviewed primary pool remains the highest-quality eligible venue."]);
  }

  const scoreAdvantage = (leader.score ?? 0) - (rankedPrimary.score ?? 0);
  const liquidityRatio = (leader.liquidityUsd ?? 0) / Math.max(rankedPrimary.liquidityUsd ?? 0, 1);
  if (scoreAdvantage < policy.minimumSwitchScoreAdvantage || liquidityRatio < policy.minimumSwitchLiquidityRatio) {
    return selection(primary, ranked, false, "high", [
      "The leading alternative did not clear both the quality and liquidity switch thresholds; retained the incumbent pool.",
    ]);
  }
  return selection(leader, ranked, true, "high", [
    `The selected venue cleared the incumbent by ${scoreAdvantage.toFixed(1)} quality points with ${(liquidityRatio * 100).toFixed(0)}% of its liquidity.`,
  ]);
}

function rejectionReasons(
  observation: VenueObservation,
  nowMs: number,
  policy: VenueSelectionPolicy,
): VenueRejectionReason[] {
  const reasons: VenueRejectionReason[] = [];
  if (!observation.executable) reasons.push("not_executable");
  if (!observation.pairVerified) reasons.push("pair_not_verified");
  if (!validNonNegative(observation.liquidityUsd) || !validNonNegative(observation.volume24hUsd) || !validNonNegative(observation.poolAgeDays)) {
    reasons.push("missing_live_evidence");
  }
  const observedAt = Date.parse(observation.observedAt);
  if (!Number.isFinite(observedAt) || nowMs - observedAt > policy.maximumObservationAgeMinutes * 60_000 || observedAt > nowMs + 60_000) {
    reasons.push("stale_observation");
  }
  if (validNonNegative(observation.liquidityUsd) && observation.liquidityUsd < policy.minimumLiquidityUsd) {
    reasons.push("liquidity_below_floor");
  }
  if (validNonNegative(observation.poolAgeDays) && observation.poolAgeDays < policy.minimumPoolAgeDays) {
    reasons.push("pool_too_new");
  }
  return reasons;
}

function scoreVenue(observation: VenueObservation, maximumLiquidity: number, maximumVolume: number): number {
  const liquidity = observation.liquidityUsd ?? 0;
  const volume = observation.volume24hUsd ?? 0;
  const dailyFeeRate = liquidity > 0 ? volume * (observation.feePips / 1_000_000) / liquidity : 0;
  const depthScore = 35 * Math.sqrt(liquidity / maximumLiquidity);
  const volumeScore = 20 * Math.sqrt(volume / maximumVolume);
  // A single 24h fee spike can contribute at most 20 points.
  const feeScore = 20 * Math.min(dailyFeeRate / 0.0025, 1);
  const durabilityScore = 10 * Math.min((observation.poolAgeDays ?? 0) / 180, 1);
  const stabilityScore = observation.priceChange24hPct === null
    ? 5
    : 10 * (1 - Math.min(Math.abs(observation.priceChange24hPct) / 80, 1));
  const costScore = observation.estimatedEntryCostUsd === null
    ? 2.5
    : 5 * (1 - Math.min(observation.estimatedEntryCostUsd / 25, 1));
  return round(depthScore + volumeScore + feeScore + durabilityScore + stabilityScore + costScore);
}

function selection(
  venue: VenueObservation | RankedVenue,
  ranked: RankedVenue[],
  switched: boolean,
  confidence: VenueSelection["confidence"],
  decisionReasons: string[],
): VenueSelection {
  return {
    methodology: VENUE_SELECTION_METHODOLOGY,
    selectedKey: venue.key,
    selectedProtocol: venue.protocol,
    selectedPoolReference: venue.poolReference,
    switched,
    confidence,
    decisionReasons,
    ranked,
  };
}

function fallback(primary: VenueObservation, ranked: RankedVenue[], decisionReasons: string[]): VenueSelection {
  return selection(primary, ranked, false, "fallback", decisionReasons);
}

function validNonNegative(value: number | null): value is number {
  return value !== null && Number.isFinite(value) && value >= 0;
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}
