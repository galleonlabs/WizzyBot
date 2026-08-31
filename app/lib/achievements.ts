export const ACHIEVEMENT_STORAGE_VERSION = 1 as const;
export const ACHIEVEMENT_METADATA_KEY = "wizzyAchievements";

export const ACHIEVEMENT_SECTIONS = [
  { id: "markets", title: "Market quests" },
  { id: "fees", title: "Fee quests" },
  { id: "magic", title: "Power moves" },
] as const;

export const ACHIEVEMENTS = [
  { id: "first-spell", section: "markets", metric: "positions", target: 1, mark: "I", title: "First spell", description: "Open your first Wizzy market.", xp: 100 },
  { id: "full-spellbook", section: "markets", metric: "markets", target: 6, mark: "VI", title: "Full spellbook", description: "Hold all 6 index markets.", xp: 150 },
  { id: "first-fees", section: "fees", metric: "fees", target: 1, mark: "$1", title: "First sparkle", description: "Have $1 in fees ready to collect.", xp: 50 },
  { id: "fee-collector", section: "fees", metric: "fees", target: 10, mark: "10", title: "Fee collector", description: "Have $10 in fees ready to collect.", xp: 75 },
  { id: "pocket-full", section: "fees", metric: "fees", target: 25, mark: "25", title: "Pocket full", description: "Have $25 in fees ready to collect.", xp: 100 },
  { id: "half-century", section: "fees", metric: "fees", target: 50, mark: "50", title: "Half century", description: "Have $50 in fees ready to collect.", xp: 125 },
  { id: "triple-digits", section: "fees", metric: "fees", target: 100, mark: "100", title: "Triple digits", description: "Have $100 in fees ready to collect.", xp: 200 },
  { id: "treasure-chest", section: "fees", metric: "fees", target: 250, mark: "250", title: "Treasure chest", description: "Have $250 in fees ready to collect.", xp: 275 },
  { id: "high-roller", section: "fees", metric: "fees", target: 500, mark: "500", title: "High roller", description: "Have $500 in fees ready to collect.", xp: 350 },
  { id: "fee-legend", section: "fees", metric: "fees", target: 1_000, mark: "1K", title: "Fee legend", description: "Have $1,000 in fees ready to collect.", xp: 500 },
  { id: "compounder", section: "magic", metric: "compounds", target: 1, mark: "C", title: "Compounder", description: "Put your fees back to work.", xp: 150 },
  { id: "range-keeper", section: "magic", metric: "rebalances", target: 1, mark: "R", title: "Range keeper", description: "Rebalance an out-of-range position.", xp: 200 },
] as const;

export type AchievementId = (typeof ACHIEVEMENTS)[number]["id"];
export type AchievementAction = "compound" | "rebalance";

export type AchievementRecord = {
  version: typeof ACHIEVEMENT_STORAGE_VERSION;
  unlockedAt: Partial<Record<AchievementId, string>>;
  maxPositionCount: number;
  maxMarketCount: number;
  maxFeesUsd: number;
  compoundCount: number;
  rebalanceCount: number;
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
  { level: 5, title: "Index archmage", minimumXp: 1_400 },
  { level: 6, title: "Market myth", minimumXp: 2_000 },
] as const;

const ACHIEVEMENT_IDS = new Set<AchievementId>(ACHIEVEMENTS.map((achievement) => achievement.id));

export function emptyAchievementRecord(now = new Date().toISOString()): AchievementRecord {
  return {
    version: ACHIEVEMENT_STORAGE_VERSION,
    unlockedAt: {},
    maxPositionCount: 0,
    maxMarketCount: 0,
    maxFeesUsd: 0,
    compoundCount: 0,
    rebalanceCount: 0,
    updatedAt: now,
  };
}

export function normalizeAchievementRecord(value: unknown, now = new Date().toISOString()): AchievementRecord {
  const fallback = emptyAchievementRecord(now);
  if (!value || typeof value !== "object" || Array.isArray(value)) return fallback;
  const source = value as Record<string, unknown>;
  const rawUnlocked = source.unlockedAt && typeof source.unlockedAt === "object" && !Array.isArray(source.unlockedAt)
    ? source.unlockedAt as Record<string, unknown>
    : {};
  const unlockedAt: AchievementRecord["unlockedAt"] = {};
  for (const [id, date] of Object.entries(rawUnlocked)) {
    if (!ACHIEVEMENT_IDS.has(id as AchievementId) || typeof date !== "string" || !Number.isFinite(Date.parse(date))) continue;
    unlockedAt[id as AchievementId] = new Date(date).toISOString();
  }
  return evaluateAchievementUnlocks({
    ...fallback,
    unlockedAt,
    maxPositionCount: safeCount(source.maxPositionCount),
    maxMarketCount: safeCount(source.maxMarketCount),
    maxFeesUsd: safeAmount(source.maxFeesUsd),
    compoundCount: safeCount(source.compoundCount),
    rebalanceCount: safeCount(source.rebalanceCount),
    updatedAt: typeof source.updatedAt === "string" && Number.isFinite(Date.parse(source.updatedAt))
      ? new Date(source.updatedAt).toISOString()
      : now,
  }, now).record;
}

export function mergeAchievementRecords(
  left: AchievementRecord,
  right: AchievementRecord,
  now = new Date().toISOString(),
): AchievementRecord {
  const unlockedAt: AchievementRecord["unlockedAt"] = {};
  for (const achievement of ACHIEVEMENTS) {
    const dates = [left.unlockedAt[achievement.id], right.unlockedAt[achievement.id]].filter((date): date is string => Boolean(date));
    if (dates.length) unlockedAt[achievement.id] = dates.sort((a, b) => Date.parse(a) - Date.parse(b))[0]!;
  }
  return evaluateAchievementUnlocks({
    version: ACHIEVEMENT_STORAGE_VERSION,
    unlockedAt,
    maxPositionCount: Math.max(left.maxPositionCount, right.maxPositionCount),
    maxMarketCount: Math.max(left.maxMarketCount, right.maxMarketCount),
    maxFeesUsd: Math.max(left.maxFeesUsd, right.maxFeesUsd),
    compoundCount: Math.max(left.compoundCount, right.compoundCount),
    rebalanceCount: Math.max(left.rebalanceCount, right.rebalanceCount),
    updatedAt: now,
  }, now).record;
}

export function observeAchievementProgress(
  record: AchievementRecord,
  observation: { positionCount: number; marketCount: number; feesUsd: number },
  now = new Date().toISOString(),
): { record: AchievementRecord; newlyUnlocked: AchievementId[] } {
  return evaluateAchievementUnlocks({
    ...record,
    maxPositionCount: Math.max(record.maxPositionCount, safeCount(observation.positionCount)),
    maxMarketCount: Math.max(record.maxMarketCount, safeCount(observation.marketCount)),
    maxFeesUsd: Math.max(record.maxFeesUsd, safeAmount(observation.feesUsd)),
    updatedAt: now,
  }, now);
}

export function recordAchievementAction(
  record: AchievementRecord,
  action: AchievementAction,
  now = new Date().toISOString(),
): { record: AchievementRecord; newlyUnlocked: AchievementId[] } {
  return evaluateAchievementUnlocks({
    ...record,
    compoundCount: record.compoundCount + (action === "compound" ? 1 : 0),
    rebalanceCount: record.rebalanceCount + (action === "rebalance" ? 1 : 0),
    updatedAt: now,
  }, now);
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
  if (quest.metric === "fees") return feeProgress(record.maxFeesUsd, quest.target);
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
          ? record.maxFeesUsd
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
