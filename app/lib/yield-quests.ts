export const YIELD_QUEST_STORAGE_VERSION = 1 as const;
export const YIELD_QUEST_AUTHORITY = "wizzy-stable" as const;
export const YIELD_QUEST_METADATA_KEY = "wizzyYieldQuests";

export const YIELD_QUEST_SECTIONS = [
  { id: "yield", title: "Yield quests" },
  { id: "stack", title: "Stack quests" },
  { id: "streak", title: "Steady hands" },
] as const;

export const YIELD_QUESTS = [
  { id: "first-drip", section: "yield", metric: "venues", target: 1, mark: "I", title: "First drip", description: "Make your first yield deposit.", xp: 100 },
  { id: "full-spread", section: "yield", metric: "venues", target: 4, mark: "IV", title: "Full spread", description: "Earn in every curated venue at once.", xp: 150 },
  { id: "stack-100", section: "stack", metric: "stack", target: 100, mark: "100", title: "Three figures", description: "Stack $100 of earning USDC.", xp: 75 },
  { id: "stack-500", section: "stack", metric: "stack", target: 500, mark: "500", title: "Half a rack", description: "Stack $500 of earning USDC.", xp: 125 },
  { id: "stack-1k", section: "stack", metric: "stack", target: 1_000, mark: "1K", title: "Four figures", description: "Stack $1,000 of earning USDC.", xp: 200 },
  { id: "stack-5k", section: "stack", metric: "stack", target: 5_000, mark: "5K", title: "Serious stacker", description: "Stack $5,000 of earning USDC.", xp: 300 },
  { id: "stack-10k", section: "stack", metric: "stack", target: 10_000, mark: "10K", title: "Vault whale", description: "Stack $10,000 of earning USDC.", xp: 500 },
  { id: "steady-week", section: "streak", metric: "streak", target: 7, mark: "7d", title: "Steady hands", description: "Stay deposited for a full week.", xp: 200 },
  { id: "steady-month", section: "streak", metric: "streak", target: 30, mark: "30d", title: "Diamond drip", description: "Stay deposited for a full month.", xp: 350 },
] as const;

export type YieldQuestId = (typeof YIELD_QUESTS)[number]["id"];

export type YieldQuestRecord = {
  version: typeof YIELD_QUEST_STORAGE_VERSION;
  authority: typeof YIELD_QUEST_AUTHORITY;
  unlockedAt: Partial<Record<YieldQuestId, string>>;
  maxVenueCount: number;
  maxStackUsd: number;
  depositedSince: string | null;
  updatedAt: string;
};

export type YieldLevel = {
  level: number;
  title: string;
  minimumXp: number;
  nextMinimumXp: number | null;
};

const LEVELS = [
  { level: 1, title: "Yield apprentice", minimumXp: 0 },
  { level: 2, title: "Stable sorcerer", minimumXp: 200 },
  { level: 3, title: "Vault wizard", minimumXp: 500 },
  { level: 4, title: "Yield alchemist", minimumXp: 900 },
  { level: 5, title: "Index archmage", minimumXp: 1_400 },
  { level: 6, title: "Stable myth", minimumXp: 2_000 },
] as const;

const QUEST_IDS = new Set<YieldQuestId>(YIELD_QUESTS.map((quest) => quest.id));

export function emptyYieldQuestRecord(now = new Date().toISOString()): YieldQuestRecord {
  return {
    version: YIELD_QUEST_STORAGE_VERSION,
    authority: YIELD_QUEST_AUTHORITY,
    unlockedAt: {},
    maxVenueCount: 0,
    maxStackUsd: 0,
    depositedSince: null,
    updatedAt: now,
  };
}

export function normalizeYieldQuestRecord(input: unknown): YieldQuestRecord {
  const empty = emptyYieldQuestRecord();
  if (!input || typeof input !== "object") return empty;
  const raw = input as Partial<YieldQuestRecord>;
  const unlockedAt: YieldQuestRecord["unlockedAt"] = {};
  if (raw.unlockedAt && typeof raw.unlockedAt === "object") {
    for (const [id, at] of Object.entries(raw.unlockedAt)) {
      if (QUEST_IDS.has(id as YieldQuestId) && typeof at === "string") unlockedAt[id as YieldQuestId] = at;
    }
  }
  return {
    ...empty,
    unlockedAt,
    maxVenueCount: finite(raw.maxVenueCount),
    maxStackUsd: finite(raw.maxStackUsd),
    depositedSince: typeof raw.depositedSince === "string" ? raw.depositedSince : null,
    updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : empty.updatedAt,
  };
}

export function serializeYieldQuestRecord(record: YieldQuestRecord): string {
  return JSON.stringify(record);
}

/** Folds one onchain observation into the record and unlocks earned quests. */
export function observeYieldPortfolio(
  record: YieldQuestRecord,
  observed: { venueCount: number; stackUsd: number },
  now = new Date(),
): { record: YieldQuestRecord; newlyUnlocked: YieldQuestId[] } {
  const next = structuredClone(record);
  const nowIso = now.toISOString();
  next.maxVenueCount = Math.max(next.maxVenueCount, observed.venueCount);
  next.maxStackUsd = Math.max(next.maxStackUsd, observed.stackUsd);
  if (observed.venueCount > 0 && !next.depositedSince) next.depositedSince = nowIso;
  if (observed.venueCount === 0) next.depositedSince = null;
  const streakDays = next.depositedSince ? (now.getTime() - Date.parse(next.depositedSince)) / 86_400_000 : 0;

  const newlyUnlocked: YieldQuestId[] = [];
  for (const quest of YIELD_QUESTS) {
    if (next.unlockedAt[quest.id]) continue;
    const current = quest.metric === "venues" ? next.maxVenueCount : quest.metric === "stack" ? next.maxStackUsd : streakDays;
    if (current >= quest.target) {
      next.unlockedAt[quest.id] = nowIso;
      newlyUnlocked.push(quest.id);
    }
  }
  next.updatedAt = nowIso;
  return { record: next, newlyUnlocked };
}

export function yieldQuestXp(record: YieldQuestRecord): number {
  return YIELD_QUESTS.reduce((sum, quest) => sum + (record.unlockedAt[quest.id] ? quest.xp : 0), 0);
}

export function yieldLevel(xp: number): YieldLevel {
  let current: YieldLevel = { ...LEVELS[0], nextMinimumXp: LEVELS[1]?.minimumXp ?? null };
  for (const [index, level] of LEVELS.entries()) {
    if (xp >= level.minimumXp) current = { ...level, nextMinimumXp: LEVELS[index + 1]?.minimumXp ?? null };
  }
  return current;
}

export function yieldQuestProgress(record: YieldQuestRecord, id: YieldQuestId): { current: number; target: number; label: string } {
  const quest = YIELD_QUESTS.find((candidate) => candidate.id === id)!;
  if (record.unlockedAt[id]) return { current: quest.target, target: quest.target, label: "Complete" };
  const streakDays = record.depositedSince ? (Date.now() - Date.parse(record.depositedSince)) / 86_400_000 : 0;
  const current = quest.metric === "venues"
    ? Math.min(record.maxVenueCount, quest.target)
    : quest.metric === "stack"
      ? Math.min(record.maxStackUsd, quest.target)
      : Math.min(streakDays, quest.target);
  const label = quest.metric === "stack"
    ? `$${Math.floor(current).toLocaleString("en")} of $${quest.target.toLocaleString("en")}`
    : quest.metric === "streak"
      ? `${Math.floor(current)} of ${quest.target} days`
      : `${Math.floor(current)} of ${quest.target}`;
  return { current: Math.floor(current), target: quest.target, label };
}

function finite(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;
}
