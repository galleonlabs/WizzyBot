"use client";

import { useCallback, useEffect, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { Chat } from "./chat";
import { isPositionView, type PositionView } from "./lib/cards";
import { applyListPayload, applyStatusView, applyToolOutput, emptyPanel, type PanelState } from "./lib/panel";
import { isShotQuery, SHOT_VIEWS } from "./lib/shot-fixture";
import { LpPanel } from "./lp-panel";
import { TopNav } from "./top-nav";

export function Cockpit() {
  const { ready, authenticated, login, logout, user } = usePrivy();
  const [panel, setPanel] = useState<PanelState>(emptyPanel);
  const [tab, setTab] = useState<"positions" | "agent">("positions");
  const [sheet, setSheet] = useState(false);
  const [shot, setShot] = useState(false);
  const address = user?.wallet?.address;
  const account = user?.email?.address ?? (address ? short(address) : null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("tab") === "agent") {
      setTab("agent");
    }
    if (isShotQuery()) {
      setShot(true);
      setPanel({
        positions: SHOT_VIEWS,
        selected: SHOT_VIEWS[0],
        selectedId: SHOT_VIEWS[0]?.tokenId,
      });
      if (params.get("detail") === "1") setSheet(true);
    }
  }, []);

  useEffect(() => {
    if (shot) return;
    if (!authenticated || !address) {
      setPanel(emptyPanel);
      setSheet(false);
      return;
    }
    let cancelled = false;
    fetch(`/api/positions?owner=${encodeURIComponent(address)}`)
      .then((r) => r.json())
      .then((payload: unknown) => {
        if (!cancelled) setPanel((prev) => applyListPayload(prev, payload));
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setPanel((prev) => ({
            ...prev,
            loadError: err instanceof Error ? err.message : "Could not load positions.",
          }));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [authenticated, address, shot]);

  const onToolOutput = useCallback((toolName: string | undefined, output: unknown) => {
    setPanel((prev) => {
      const next = applyToolOutput(prev, toolName, output);
      if (next.projection && next.positions.length === 0) {
        queueMicrotask(() => setSheet(true));
      }
      return next;
    });
  }, []);

  const onSelect = useCallback((view: PositionView) => {
    setPanel((prev) => ({ ...prev, selected: view, selectedId: view.tokenId, projection: undefined }));
    setSheet(true);
    setTab("positions");
    if (!view.tokenId) return;
    fetch(`/api/positions/${encodeURIComponent(view.tokenId)}`)
      .then((r) => r.json())
      .then((payload: unknown) => {
        if (payload && typeof payload === "object" && "view" in payload) {
          const next = (payload as { view: unknown }).view;
          if (isPositionView(next)) setPanel((prev) => applyStatusView(prev, next));
        }
      })
      .catch(() => {
        /* list row is enough */
      });
  }, []);

  function onTab(next: "positions" | "agent") {
    setTab(next);
    if (next === "agent") {
      queueMicrotask(() => document.querySelector<HTMLInputElement>(".composer input")?.focus());
    }
  }

  function onNew() {
    setTab("agent");
    queueMicrotask(() => document.querySelector<HTMLInputElement>(".composer input")?.focus());
  }

  return (
    <div className="cockpit" data-tab={tab}>
      <TopNav
        active={tab}
        account={account}
        ready={ready}
        authenticated={authenticated}
        onLogin={() => void login()}
        onLogout={() => void logout()}
        onTab={onTab}
      />

      <Chat
        authenticated={authenticated}
        onLogin={() => void login()}
        onToolOutput={onToolOutput}
        lastConfirm={panel.confirm}
      />
      <LpPanel
        connected={authenticated || shot}
        ready={ready || shot}
        onLogin={() => void login()}
        onNew={onNew}
        onBack={() => setSheet(false)}
        sheetOpen={sheet}
        state={panel}
        onSelect={onSelect}
      />

      <nav className="app-tabs" aria-label="App sections">
        <button className={tab === "positions" ? "is-on" : ""} type="button" onClick={() => onTab("positions")}>
          Positions
        </button>
        <button className={tab === "agent" ? "is-on" : ""} type="button" onClick={() => onTab("agent")}>
          Agent
        </button>
      </nav>
    </div>
  );
}

function short(value: string): string {
  if (value.length <= 12) return value;
  if (value.startsWith("0x")) return `${value.slice(0, 6)}…${value.slice(-4)}`;
  return value;
}
