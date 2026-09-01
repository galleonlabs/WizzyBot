export const ACHIEVEMENT_STORAGE_VERSION = 2 as const;
export const ACHIEVEMENT_AUTHORITY = "onchain-v1" as const;
export const ACHIEVEMENT_METADATA_KEY = "wizzyAchievements";

export const ACHIEVEMENT_SECTIONS = [
  { id: "markets", title: "Market quests" },
  { id: "fees", title: "Fee quests" },
  { id: "magic", title: "Power moves" },
] as const;

export const ACHIEVEMENTS = [
  { id: "first-spell", section: "markets", metric: "positions", target: 1, mark: "I", title: "First spell", description: "Open your first Wizzy market.", xp: 100 },
  { id: "full-spellbook", section: "markets", metric: "markets", target: 6, mark: "VI", title: "Full spellbook", description: "Hold positions in 6 reviewed markets.", xp: 150 },
  { id: "first-fees", section: "fees", metric: "fees", target: 1, mark: "$1", title: "First sparkle", description: "Earn $1 in market fees.", xp: 50 },
  { id: "fee-collector", section: "fees", metric: "fees", target: 10, mark: "10", title: "Fee collector", description: "Earn $10 in market fees.", xp: 75 },
  { id: "pocket-full", section: "fees", metric: "fees", target: 25, mark: "25", title: "Pocket full", description: "Earn $25 in market fees.", xp: 100 },
  { id: "half-century", section: "fees", metric: "fees", target: 50, mark: "50", title: "Half century", description: "Earn $50 in market fees.", xp: 125 },
  { id: "triple-digits", section: "fees", metric: "fees", target: 100, mark: "100", title: "Triple digits", description: "Earn $100 in market fees.", xp: 200 },
  { id: "treasure-chest", section: "fees", metric: "fees", target: 250, mark: "250", title: "Treasure chest", description: "Earn $250 in market fees.", xp: 275 },
  { id: "high-roller", section: "fees", metric: "fees", target: 500, mark: "500", title: "High roller", description: "Earn $500 in market fees.", xp: 350 },
  { id: "fee-legend", section: "fees", metric: "fees", target: 1_000, mark: "1K", title: "Fee legend", description: "Earn $1,000 in market fees.", xp: 500 },
  { id: "compounder", section: "magic", metric: "compounds", target: 1, mark: "C", title: "Compounder", description: "Put your fees back to work.", xp: 150 },
  { id: "range-keeper", section: "magic", metric: "rebalances", target: 1, mark: "R", title: "Range keeper", description: "Rebalance an out-of-range position.", xp: 200 },
] as const;

export type AchievementId = (typeof ACHIEVEMENTS)[number]["id"];
export type AchievementAction = "compound" | "rebalance";

export type AchievementProof = {
  action: AchievementAction;
  chainId: 4663;
  tokenId: string;
  transactionHash: `0x${string}`;
  verifiedAt: string;
};

export type AchievementActionEvidence = {
  action: AchievementAction;
  chainId: 4663;
  tokenId: string;
  transactionHashes: `0x${string}`[];
};

export type AchievementRecord = {
  version: typeof ACHIEVEMENT_STORAGE_VERSION;
  authority: typeof ACHIEVEMENT_AUTHORITY;
  unlockedAt: Partial<Record<AchievementId, string>>;
  maxPositionCount: number;
  maxMarketCount: number;
  feesEarnedUsd: number;
  feeCheckpoints: Record<string, number>;
  compoundCount: number;
  rebalanceCount: number;
  proofs: Partial<Record<AchievementAction, AchievementProof>>;
  updatedAt: string;
};

export type AchievementLevel = {
  level: number;
  title: string;
  minimumXp: number;
  nextMinimumXp: number | null;
};

const LEVELS = [
  { level: 1, title: "Apprentice", minimumXp: 0 },
  { level: 2, title: "Market mage", minimumXp: 200 },
  { level: 3, title: "Liquidity wizard", minimumXp: 500 },
  { level: 4, title: "Fee alchemist", minimumXp: 900 },
  { level: 5, title: "Market archmage", minimumXp: 1_400 },
  { level: 6, title: "Market myth", minimumXp: 2_000 },
] as const;

const ACHIEVEMENT_IDS = new Set<AchievementId>(ACHIEVEMENTS.map((achievement) => achievement.id));

export function emptyAchievementRecord(now = new Date().toISOString()): AchievementRecord {
  return {
    version: ACHIEVEMENT_STORAGE_VERSION,
    authority: ACHIEVEMENT_AUTHORITY,
    unlockedAt: {},
    maxPositionCount: 0,
    maxMarketCount: 0,
    feesEarnedUsd: 0,
    feeCheckpoints: {},
    compoundCount: 0,
    rebalanceCount: 0,
    proofs: {},
    updatedAt: now,
  };
}

export function normalizeAchievementRecord(value: unknown, now = new Date().toISOString()): AchievementRecord {
  const fallback = emptyAchievementRecord(now);
  if (!value || typeof value !== "object" || Array.isArray(value)) return fallback;
  const source = value as Record<string, unknown>;
  if (source.v === ACHIEVEMENT_STORAGE_VERSION && source.a === "o1") return normalizeCompactRecord(source, now);
  // Version 1 accepted client-authored counters. Never import those values into
  // the authoritative record: v2 is rebuilt from live positions and receipts.
  if (source.version !== ACHIEVEMENT_STORAGE_VERSION || source.authority !== ACHIEVEMENT_AUTHORITY) return fallback;
  const rawUnlocked = source.unlockedAt && typeof source.unlockedAt === "object" && !Array.isArray(source.unlockedAt)
    ? source.unlockedAt as Record<string, unknown>
    : {};
  const unlockedAt: AchievementRecord["unlockedAt"] = {};
  for (const [id, date] of Object.entries(rawUnlocked)) {
    if (!ACHIEVEMENT_IDS.has(id as AchievementId) || typeof date !== "string" || !Number.isFinite(Date.parse(date))) continue;
    unlockedAt[id as AchievementId] = new Date(date).toISOString();
  }
  const proofs = normalizeProofs(source.proofs);
  return evaluateAchievementUnlocks({
    ...fallback,
    unlockedAt,
    maxPositionCount: safeCount(source.maxPositionCount),
    maxMarketCount: safeCount(source.maxMarketCount),
    feesEarnedUsd: safeAmount(source.feesEarnedUsd),
    feeCheckpoints: normalizeFeeCheckpoints(source.feeCheckpoints),
    compoundCount: proofs.compound ? 1 : 0,
    rebalanceCount: proofs.rebalance ? 1 : 0,
    proofs,
    updatedAt: typeof source.updatedAt === "string" && Number.isFinite(Date.parse(source.updatedAt))
      ? new Date(source.updatedAt).toISOString()
      : now,
  }, now).record;
}

/** Compact persistence keeps the achievement record inexpensive to store and transfer. */
export function serializeAchievementRecord(record: AchievementRecord): string {
  const compact: Record<string, unknown> = {
    v: ACHIEVEMENT_STORAGE_VERSION,
    a: "o1",
    d: ACHIEVEMENTS.map((quest) => record.unlockedAt[quest.id] ? Math.floor(Date.parse(record.unlockedAt[quest.id]!) / 1_000) : 0),
    p: record.maxPositionCount,
    m: record.maxMarketCount,
    f: Math.round(record.feesEarnedUsd * 100) / 100,
    k: record.feeCheckpoints,
    u: Math.floor(Date.parse(record.updatedAt) / 1_000),
  };
  if (record.proofs.compound) compact.c = compactProof(record.proofs.compound);
  if (record.proofs.rebalance) compact.r = compactProof(record.proofs.rebalance);
  return JSON.stringify(compact);
}

export function observeOnchainPortfolio(
  record: AchievementRecord,
  observation: {
    positionCount: number;
    marketCount: number;
    positions: readonly { key: string; feesUsd: number }[];
  },
  now = new Date().toISOString(),
): { record: AchievementRecord; newlyUnlocked: AchievementId[] } {
  const feeCheckpoints = { ...record.feeCheckpoints };
  let feesEarnedUsd = record.feesEarnedUsd;
  for (const position of observation.positions) {
    if (!/^[a-z0-9:_-]{1,180}$/.test(position.key)) continue;
    const current = safeAmount(position.feesUsd);
    const previous = feeCheckpoints[position.key];
    feesEarnedUsd += previous === undefined ? current : Math.max(0, current - previous);
    feeCheckpoints[position.key] = current;
  }
  return evaluateAchievementUnlocks({
    ...record,
    maxPositionCount: Math.max(record.maxPositionCount, safeCount(observation.positionCount)),
    maxMarketCount: Math.max(record.maxMarketCount, safeCount(observation.marketCount)),
    feesEarnedUsd: safeAmount(feesEarnedUsd),
    feeCheckpoints: trimFeeCheckpoints(feeCheckpoints),
    updatedAt: now,
  }, now);
}

export function recordVerifiedAchievementAction(
  record: AchievementRecord,
  proof: AchievementProof,
): { record: AchievementRecord; newlyUnlocked: AchievementId[] } {
  const existing = record.proofs[proof.action];
  if (existing) return { record, newlyUnlocked: [] };
  return evaluateAchievementUnlocks({
    ...record,
    compoundCount: proof.action === "compound" ? 1 : record.compoundCount,
    rebalanceCount: proof.action === "rebalance" ? 1 : record.rebalanceCount,
    proofs: { ...record.proofs, [proof.action]: proof },
    updatedAt: proof.verifiedAt,
  }, proof.verifiedAt);
}

export function achievementXp(record: AchievementRecord): number {
  return ACHIEVEMENTS.reduce((total, achievement) => total + (record.unlockedAt[achievement.id] ? achievement.xp : 0), 0);
}

export function achievementLevel(xp: number): AchievementLevel {
  let index = 0;
  for (let candidate = 0; candidate < LEVELS.length; candidate += 1) {
    if (xp >= LEVELS[candidate]!.minimumXp) index = candidate;
  }
  const current = LEVELS[index]!;
  const next = LEVELS[index + 1];
  return {
    level: current.level,
    title: current.title,
    minimumXp: current.minimumXp,
    nextMinimumXp: next?.minimumXp ?? null,
  };
}

export function achievementProgress(record: AchievementRecord, id: AchievementId): { current: number; target: number; label: string } {
  const quest = ACHIEVEMENTS.find((achievement) => achievement.id === id)!;
  if (quest.metric === "positions") {
    const current = Math.min(record.maxPositionCount, quest.target);
    return { current, target: quest.target, label: `${current} of ${quest.target} market` };
  }
  if (quest.metric === "markets") {
    const current = Math.min(record.maxMarketCount, quest.target);
    return { current, target: quest.target, label: `${current} of ${quest.target} markets` };
  }
  if (quest.metric === "fees") return feeProgress(record.feesEarnedUsd, quest.target);
  if (quest.metric === "compounds") {
    return { current: Math.min(record.compoundCount, quest.target), target: quest.target, label: record.compoundCount ? "Compounded" : "Not yet compounded" };
  }
  return { current: Math.min(record.rebalanceCount, quest.target), target: quest.target, label: record.rebalanceCount ? "Rebalanced" : "Not yet rebalanced" };
}

function evaluateAchievementUnlocks(
  record: AchievementRecord,
  now: string,
): { record: AchievementRecord; newlyUnlocked: AchievementId[] } {
  const unlockedAt = { ...record.unlockedAt };
  const newlyUnlocked: AchievementId[] = [];
  const unlock = (id: AchievementId, earned: boolean) => {
    if (!earned || unlockedAt[id]) return;
    unlockedAt[id] = now;
    newlyUnlocked.push(id);
  };
  for (const quest of ACHIEVEMENTS) {
    const value = quest.metric === "positions"
      ? record.maxPositionCount
      : quest.metric === "markets"
        ? record.maxMarketCount
        : quest.metric === "fees"
          ? record.feesEarnedUsd
          : quest.metric === "compounds"
            ? record.compoundCount
            : record.rebalanceCount;
    unlock(quest.id, value >= quest.target);
  }
  return { record: { ...record, unlockedAt, updatedAt: now }, newlyUnlocked };
}

function feeProgress(value: number, target: number): { current: number; target: number; label: string } {
  const current = Math.min(value, target);
  return { current, target, label: `${formatAchievementMoney(current)} of ${formatAchievementMoney(target)} fees` };
}

function formatAchievementMoney(value: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: value < 10 ? 2 : 0 }).format(value);
}

function safeCount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.min(10_000, Math.floor(value))) : 0;
}

function safeAmount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.min(1_000_000_000, value)) : 0;
}

function normalizeProofs(value: unknown): AchievementRecord["proofs"] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const source = value as Record<string, unknown>;
  const proofs: AchievementRecord["proofs"] = {};
  for (const action of ["compound", "rebalance"] as const) {
    const candidate = source[action];
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) continue;
    const proof = candidate as Record<string, unknown>;
    if (
      proof.action !== action ||
      proof.chainId !== 4663 ||
      typeof proof.tokenId !== "string" || !/^\d+$/.test(proof.tokenId) ||
      typeof proof.transactionHash !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(proof.transactionHash) ||
      typeof proof.verifiedAt !== "string" || !Number.isFinite(Date.parse(proof.verifiedAt))
    ) continue;
    proofs[action] = {
      action,
      chainId: 4663,
      tokenId: proof.tokenId,
      transactionHash: proof.transactionHash.toLowerCase() as `0x${string}`,
      verifiedAt: new Date(proof.verifiedAt).toISOString(),
    };
  }
  return proofs;
}

function normalizeCompactRecord(source: Record<string, unknown>, now: string): AchievementRecord {
  const updatedAt = epochDate(source.u) ?? now;
  const unlockedAt: AchievementRecord["unlockedAt"] = {};
  if (Array.isArray(source.d)) {
    for (const [index, value] of source.d.entries()) {
      const quest = ACHIEVEMENTS[index];
      const date = epochDate(value);
      if (quest && date) unlockedAt[quest.id] = date;
    }
  }
  const proofs: AchievementRecord["proofs"] = {
    compound: expandCompactProof("compound", source.c),
    rebalance: expandCompactProof("rebalance", source.r),
  };
  return evaluateAchievementUnlocks({
    version: ACHIEVEMENT_STORAGE_VERSION,
    authority: ACHIEVEMENT_AUTHORITY,
    unlockedAt,
    maxPositionCount: safeCount(source.p),
    maxMarketCount: safeCount(source.m),
    feesEarnedUsd: safeAmount(source.f),
    feeCheckpoints: normalizeFeeCheckpoints(source.k),
    compoundCount: proofs.compound ? 1 : 0,
    rebalanceCount: proofs.rebalance ? 1 : 0,
    proofs,
    updatedAt,
  }, updatedAt).record;
}

function compactProof(proof: AchievementProof): [string, `0x${string}`, number] {
  return [proof.tokenId, proof.transactionHash, Math.floor(Date.parse(proof.verifiedAt) / 1_000)];
}

function expandCompactProof(action: AchievementAction, value: unknown): AchievementProof | undefined {
  if (!Array.isArray(value) || value.length !== 3) return undefined;
  const [tokenId, transactionHash, verified] = value;
  const verifiedAt = epochDate(verified);
  if (
    typeof tokenId !== "string" || !/^\d+$/.test(tokenId) ||
    typeof transactionHash !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(transactionHash) ||
    !verifiedAt
  ) return undefined;
  return { action, chainId: 4663, tokenId, transactionHash: transactionHash.toLowerCase() as `0x${string}`, verifiedAt };
}

function epochDate(value: unknown): string | undefined {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) return undefined;
  const date = new Date(value * 1_000);
  return Number.isFinite(date.getTime()) ? date.toISOString() : undefined;
}

function normalizeFeeCheckpoints(value: unknown): Record<string, number> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const checkpoints: Record<string, number> = {};
  for (const [key, amount] of Object.entries(value as Record<string, unknown>)) {
    if (!/^[a-z0-9:_-]{1,180}$/.test(key)) continue;
    checkpoints[key] = safeAmount(amount);
  }
  return trimFeeCheckpoints(checkpoints);
}

function trimFeeCheckpoints(value: Record<string, number>): Record<string, number> {
  return Object.fromEntries(Object.entries(value).slice(-16));
}
