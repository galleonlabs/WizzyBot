import { useCallback, useEffect, useRef, useState, type CSSProperties, type MutableRefObject } from "react";
import { createPortal } from "react-dom";
import type { PositionView } from "./lib/cards";
import { summarizePositions } from "./lib/portfolio-summary";
import {
  ACHIEVEMENTS,
  ACHIEVEMENT_SECTIONS,
  achievementLevel,
  achievementProgress,
  achievementXp,
  emptyAchievementRecord,
  mergeAchievementRecords,
  normalizeAchievementRecord,
  observeAchievementProgress,
  recordAchievementAction,
  type AchievementAction,
  type AchievementId,
  type AchievementRecord,
} from "./lib/achievements";
import { isShotQuery } from "./lib/shot-fixture";
import { reportClientError, trackProductEvent } from "./lib/telemetry-client";

type PositionState = "idle" | "loading" | "ready" | "error";

const PREVIEW_RECORD = normalizeAchievementRecord({
  maxPositionCount: 6,
  maxMarketCount: 6,
  maxFeesUsd: 124.72,
  compoundCount: 1,
  rebalanceCount: 0,
  unlockedAt: {
    "first-spell": "2026-08-25T12:00:00.000Z",
    "full-spellbook": "2026-08-25T12:00:00.000Z",
    "fee-collector": "2026-08-27T12:00:00.000Z",
    "triple-digits": "2026-08-30T12:00:00.000Z",
    compounder: "2026-08-28T12:00:00.000Z",
  },
});

export function AchievementCenter({
  address,
  authenticated,
  positions,
  positionsState,
  getAccessToken,
  onConnect,
  preview,
  actionRef,
}: {
  address?: string;
  authenticated: boolean;
  positions: PositionView[];
  positionsState: PositionState;
  getAccessToken: () => Promise<string | null>;
  onConnect: () => void;
  preview: boolean;
  actionRef: MutableRefObject<((action: AchievementAction) => void) | null>;
}) {
  const [record, setRecord] = useState<AchievementRecord>(() => emptyAchievementRecord());
  const [loadedOwner, setLoadedOwner] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [toastId, setToastId] = useState<AchievementId | null>(null);
  const recordRef = useRef(record);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const owner = preview ? "preview" : address?.toLowerCase() ?? null;
  const xp = achievementXp(record);
  const level = achievementLevel(xp);
  const unlockedCount = Object.keys(record.unlockedAt).length;

  const persistLocal = useCallback((next: AchievementRecord) => {
    if (!owner || owner === "preview") return;
    try {
      window.localStorage.setItem(storageKey(owner), JSON.stringify(next));
    } catch {
      // Privy remains the durable copy if local storage is unavailable.
    }
  }, [owner]);

  const persistRemote = useCallback(async (next: AchievementRecord) => {
    if (!authenticated || !owner || owner === "preview") return;
    try {
      const token = await getAccessToken();
      if (!token) return;
      const response = await fetch("/api/achievements", {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({ record: next }),
      });
      if (!response.ok) throw new Error(`Achievement sync failed with ${response.status}`);
    } catch (error) {
      reportClientError("achievements", error);
    }
  }, [authenticated, getAccessToken, owner]);

  const commitRecord = useCallback((next: AchievementRecord, newlyUnlocked: AchievementId[] = [], sync = true) => {
    recordRef.current = next;
    setRecord(next);
    persistLocal(next);
    if (sync) void persistRemote(next);
    if (!newlyUnlocked.length) return;
    const latest = newlyUnlocked[newlyUnlocked.length - 1]!;
    setToastId(latest);
    for (const id of newlyUnlocked) {
      const achievement = ACHIEVEMENTS.find((candidate) => candidate.id === id);
      trackProductEvent("Quest Completed", { questId: id, xp: achievement?.xp ?? 0 });
    }
  }, [persistLocal, persistRemote]);

  useEffect(() => {
    let active = true;
    setToastId(null);
    if (!owner) {
      const empty = emptyAchievementRecord();
      recordRef.current = empty;
      setRecord(empty);
      setLoadedOwner(null);
      return;
    }
    if (owner === "preview") {
      recordRef.current = PREVIEW_RECORD;
      setRecord(PREVIEW_RECORD);
      setLoadedOwner(owner);
      if (isShotQuery() && new URLSearchParams(window.location.search).get("state") === "achievements") setOpen(true);
      return;
    }
    let local = emptyAchievementRecord();
    try {
      const saved = window.localStorage.getItem(storageKey(owner));
      if (saved) local = normalizeAchievementRecord(JSON.parse(saved));
    } catch {
      // Continue with the remote copy.
    }
    recordRef.current = local;
    setRecord(local);
    setLoadedOwner(owner);
    void (async () => {
      try {
        const token = await getAccessToken();
        if (!token) return;
        const response = await fetch("/api/achievements", { headers: { authorization: `Bearer ${token}` }, cache: "no-store" });
        if (!response.ok) throw new Error(`Achievement load failed with ${response.status}`);
        const payload = await response.json() as { record?: unknown };
        if (!active || !payload.record) return;
        const merged = mergeAchievementRecords(recordRef.current, normalizeAchievementRecord(payload.record));
        commitRecord(merged, [], false);
      } catch (error) {
        if (active) reportClientError("achievements", error);
      }
    })();
    return () => { active = false; };
  }, [commitRecord, getAccessToken, owner]);

  useEffect(() => {
    if (!owner || loadedOwner !== owner || positionsState !== "ready") return;
    const activePositions = positions.filter((position) => !position.closed);
    const marketKeys = new Set(activePositions.map((position) => position.marketId ?? `${position.chain ?? "unknown"}:${position.pair}`));
    const feesUsd = summarizePositions(activePositions).feesUsd;
    const result = observeAchievementProgress(recordRef.current, {
      positionCount: activePositions.length,
      marketCount: marketKeys.size,
      feesUsd,
    });
    if (JSON.stringify(result.record) !== JSON.stringify(recordRef.current)) commitRecord(result.record, result.newlyUnlocked);
  }, [commitRecord, loadedOwner, owner, positions, positionsState]);

  const recordAction = useCallback((action: AchievementAction) => {
    const result = recordAchievementAction(recordRef.current, action);
    commitRecord(result.record, result.newlyUnlocked);
  }, [commitRecord]);

  useEffect(() => {
    actionRef.current = recordAction;
    return () => { actionRef.current = null; };
  }, [actionRef, recordAction]);

  useEffect(() => {
    if (!toastId) return;
    const timeout = window.setTimeout(() => setToastId(null), 5_500);
    return () => window.clearTimeout(timeout);
  }, [toastId]);

  useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.requestAnimationFrame(() => dialogRef.current?.querySelector<HTMLElement>("button")?.focus());
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current) return;
      const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], [tabindex]:not([tabindex="-1"])'));
      if (!focusable.length) return;
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKeyDown);
      (triggerRef.current ?? previouslyFocused)?.focus();
    };
  }, [open]);

  const openQuests = () => {
    setOpen(true);
    trackProductEvent("Quest Board Opened", { xp, level: level.level, completed: unlockedCount, authenticated });
  };

  const toast = toastId ? ACHIEVEMENTS.find((achievement) => achievement.id === toastId) : null;
  const portal = typeof document === "undefined" ? null : createPortal(<>
    {open ? <div className="achievement-backdrop" onPointerDown={(event) => { if (event.currentTarget === event.target) setOpen(false); }}>
      <section ref={dialogRef} className="trophy-case" role="dialog" aria-modal="true" aria-labelledby="quest-board-title" aria-describedby="quest-board-description">
        <header className="trophy-case-header">
          <span className="trophy-case-identity"><img src="/brand/wizzy-mascot-32.png" alt="" /><span><small>Wizzy level {level.level}</small><b>{level.title}</b></span></span>
          <button type="button" onClick={() => setOpen(false)}>Close</button>
        </header>
        <div className="trophy-case-intro">
          <div>
            <h2 id="quest-board-title">Quests</h2>
            <p id="quest-board-description">Make markets, stack fees, and level up your spellbook.</p>
          </div>
          <strong><span>{xp}</span> XP</strong>
        </div>
        <LevelProgress xp={xp} level={level} unlockedCount={unlockedCount} />
        <div className="quest-sections">
          {ACHIEVEMENT_SECTIONS.map((section) => {
            const quests = ACHIEVEMENTS.filter((achievement) => achievement.section === section.id);
            const completed = quests.filter((quest) => record.unlockedAt[quest.id]).length;
            return <section className="quest-section" aria-labelledby={`quest-section-${section.id}`} key={section.id}>
              <header><h3 id={`quest-section-${section.id}`}>{section.title}</h3><span>{completed}/{quests.length} complete</span></header>
              <div className="achievement-list" role="list">
                {quests.map((achievement, index) => {
                  const unlockedAt = record.unlockedAt[achievement.id];
                  const progress = achievementProgress(record, achievement.id);
                  const progressPct = Math.max(0, Math.min(100, (progress.current / progress.target) * 100));
                  return <article className={unlockedAt ? "is-unlocked" : "is-locked"} role="listitem" key={achievement.id}>
                    <span className={`achievement-mark is-${index % 3}`} aria-hidden="true">{achievement.mark}</span>
                    <div className="achievement-copy">
                      <span className="achievement-title-row"><b>{achievement.title}</b><strong>+{achievement.xp} XP</strong></span>
                      <p>{achievement.description}</p>
                      <span className="achievement-progress" role="progressbar" aria-label={`${achievement.title}: ${progress.label}`} aria-valuemin={0} aria-valuemax={progress.target} aria-valuenow={progress.current} style={{ "--achievement-progress": `${progressPct}%` } as CSSProperties}><i /></span>
                      <small>{unlockedAt ? `Completed ${formatEarnedDate(unlockedAt)}` : authenticated ? positionsState === "loading" ? "Reading your wallet" : progress.label : "Connect to start"}</small>
                    </div>
                  </article>;
                })}
              </div>
            </section>;
          })}
        </div>
        {!authenticated ? <footer className="trophy-case-footer"><span><b>Begin your first quest.</b><small>Connect a wallet and your first market earns 100 XP.</small></span><button type="button" onClick={() => { setOpen(false); onConnect(); }}>Connect wallet</button></footer> : null}
      </section>
    </div> : null}
    {toast ? <button className="achievement-toast" type="button" onClick={() => { setToastId(null); openQuests(); }} aria-label={`${toast.title} complete. Open quests.`}>
      <span className="achievement-toast-mascot"><img src="/brand/wizzy-mascot-32.png" alt="" /><i /><i /><i /></span>
      <span><small>Quest complete</small><b>{toast.title}</b></span>
      <strong>+{toast.xp} XP</strong>
    </button> : null}
  </>, document.body);
  return <>
    <button ref={triggerRef} className="achievement-trigger" type="button" onClick={openQuests} aria-label={`${xp} XP. Level ${level.level} ${level.title}. Open quests.`} aria-haspopup="dialog" aria-expanded={open}>
      <span><b>{xp}</b><small>XP</small></span>
      <span className="achievement-trigger-level">Quests</span>
    </button>
    {portal}
  </>;
}

function LevelProgress({ xp, level, unlockedCount }: { xp: number; level: ReturnType<typeof achievementLevel>; unlockedCount: number }) {
  const complete = level.nextMinimumXp === null;
  const target = level.nextMinimumXp ?? xp;
  const span = Math.max(1, target - level.minimumXp);
  const current = complete ? span : Math.max(0, xp - level.minimumXp);
  const percent = complete ? 100 : Math.min(100, (current / span) * 100);
  return <section className="level-progress" aria-label="Level progress">
    <span><b>{complete ? "Top level" : `${target - xp} XP to level ${level.level + 1}`}</b><small>{unlockedLabel(unlockedCount)}</small></span>
    <span role="progressbar" aria-label={complete ? "Top level reached" : `${target - xp} XP to next level`} aria-valuemin={0} aria-valuemax={span} aria-valuenow={current} style={{ "--level-progress": `${percent}%` } as CSSProperties}><i /></span>
  </section>;
}

function unlockedLabel(count: number): string {
  return count === 0 ? "Your journey starts here." : `${count} of ${ACHIEVEMENTS.length} quests complete.`;
}

function storageKey(owner: string): string {
  return `wizzy-achievements-v1:${owner}`;
}

function formatEarnedDate(value: string): string {
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" }).format(new Date(value));
}
