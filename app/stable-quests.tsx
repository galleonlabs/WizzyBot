"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { readJsonPayload } from "./lib/api-payload";
import { reportClientError, trackProductEvent } from "./lib/telemetry-client";
import {
  emptyYieldQuestRecord,
  normalizeYieldQuestRecord,
  yieldLevel,
  yieldQuestProgress,
  yieldQuestXp,
  YIELD_QUEST_SECTIONS,
  YIELD_QUESTS,
  type YieldQuestId,
  type YieldQuestRecord,
} from "./lib/yield-quests";

export function YieldQuestCenter({ authenticated, getAccessToken, onConnect, refreshSignal }: {
  authenticated: boolean;
  getAccessToken: () => Promise<string | null>;
  onConnect: () => void;
  refreshSignal: number;
}) {
  const [record, setRecord] = useState<YieldQuestRecord>(emptyYieldQuestRecord());
  const [open, setOpen] = useState(false);
  const [toastId, setToastId] = useState<YieldQuestId | null>(null);
  const [syncing, setSyncing] = useState(false);
  const dialogRef = useRef<HTMLElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  const xp = yieldQuestXp(record);
  const level = yieldLevel(xp);
  const unlockedCount = YIELD_QUESTS.filter((quest) => record.unlockedAt[quest.id]).length;

  const sync = useCallback(async (announce: boolean) => {
    if (!authenticated) return;
    setSyncing(true);
    try {
      // Privy issues the access token shortly after login; skip quietly while
      // it warms up — the next trigger syncs.
      let token: string | null = null;
      for (let attempt = 0; attempt < 3; attempt += 1) {
        token = await getAccessToken();
        if (token) break;
        if (attempt === 2) return;
        await new Promise((resolve) => window.setTimeout(resolve, 1_000));
      }
      const response = await fetch("/api/stable/quests", {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({ type: "sync" }),
      });
      const payload = await readJsonPayload(response) as { record?: unknown; newlyUnlocked?: unknown; error?: string };
      if (!response.ok || !payload.record) throw new Error(payload.error ?? "Quest sync failed");
      setRecord(normalizeYieldQuestRecord(payload.record));
      const fresh = Array.isArray(payload.newlyUnlocked)
        ? payload.newlyUnlocked.filter((id): id is YieldQuestId => YIELD_QUESTS.some((quest) => quest.id === id))
        : [];
      if (fresh.length) {
        const latest = fresh[fresh.length - 1]!;
        if (announce) setToastId(latest);
        for (const id of fresh) {
          const quest = YIELD_QUESTS.find((candidate) => candidate.id === id);
          trackProductEvent("Quest Completed", { questId: id, xp: quest?.xp ?? 0 });
        }
      }
    } catch (error) {
      reportClientError("achievements", error);
    } finally {
      setSyncing(false);
    }
  }, [authenticated, getAccessToken]);

  useEffect(() => {
    if (!authenticated) {
      setRecord(emptyYieldQuestRecord());
      return;
    }
    void sync(true);
  }, [authenticated, refreshSignal, sync]);

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
    if (authenticated) void sync(false);
  };

  const toast = toastId ? YIELD_QUESTS.find((quest) => quest.id === toastId) : null;
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
            <p id="quest-board-description">Make yield, stack USDC, and level up your spellbook.</p>
          </div>
          <strong><span>{xp}</span> XP</strong>
        </div>
        <LevelProgress xp={xp} level={level} unlockedCount={unlockedCount} />
        <div className="quest-sections">
          {YIELD_QUEST_SECTIONS.map((section) => {
            const quests = YIELD_QUESTS.filter((quest) => quest.section === section.id);
            const completed = quests.filter((quest) => record.unlockedAt[quest.id]).length;
            return <section className="quest-section" aria-labelledby={`quest-section-${section.id}`} key={section.id}>
              <header><h3 id={`quest-section-${section.id}`}>{section.title}</h3><span>{completed}/{quests.length} complete</span></header>
              <div className="achievement-list" role="list">
                {quests.map((quest, index) => {
                  const unlockedAt = record.unlockedAt[quest.id];
                  const progress = yieldQuestProgress(record, quest.id);
                  const progressPct = Math.max(0, Math.min(100, (progress.current / progress.target) * 100));
                  return <article className={unlockedAt ? "is-unlocked" : "is-locked"} role="listitem" key={quest.id}>
                    <span className={`achievement-mark is-${index % 3}`} aria-hidden="true">{quest.mark}</span>
                    <div className="achievement-copy">
                      <span className="achievement-title-row"><b>{quest.title}</b><strong>+{quest.xp} XP</strong></span>
                      <p>{quest.description}</p>
                      <span className="achievement-progress" role="progressbar" aria-label={`${quest.title}: ${progress.label}`} aria-valuemin={0} aria-valuemax={progress.target} aria-valuenow={progress.current} style={{ "--achievement-progress": `${progressPct}%` } as CSSProperties}><i /></span>
                      <small>{unlockedAt ? `Completed ${formatEarnedDate(unlockedAt)}` : authenticated ? syncing ? "Reading your wallet" : progress.label : "Connect to start"}</small>
                    </div>
                  </article>;
                })}
              </div>
            </section>;
          })}
        </div>
        {!authenticated ? <footer className="trophy-case-footer"><span><b>Begin your first quest.</b><small>Connect a wallet and your first deposit earns 100 XP.</small></span><button type="button" onClick={() => { setOpen(false); onConnect(); }}>Connect wallet</button></footer> : null}
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

function LevelProgress({ xp, level, unlockedCount }: { xp: number; level: ReturnType<typeof yieldLevel>; unlockedCount: number }) {
  const complete = level.nextMinimumXp === null;
  const target = level.nextMinimumXp ?? xp;
  const span = Math.max(1, target - level.minimumXp);
  const current = complete ? span : Math.max(0, xp - level.minimumXp);
  const percent = complete ? 100 : Math.min(100, (current / span) * 100);
  return <section className="level-progress" aria-label="Level progress">
    <span><b>{complete ? "Top level" : `${target - xp} XP to level ${level.level + 1}`}</b><small>{unlockedCount === 0 ? "Your journey starts here." : `${unlockedCount} of ${YIELD_QUESTS.length} quests complete.`}</small></span>
    <span role="progressbar" aria-label={complete ? "Top level reached" : `${target - xp} XP to next level`} aria-valuemin={0} aria-valuemax={span} aria-valuenow={current} style={{ "--level-progress": `${percent}%` } as CSSProperties}><i /></span>
  </section>;
}

function formatEarnedDate(value: string): string {
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" }).format(new Date(value));
}
