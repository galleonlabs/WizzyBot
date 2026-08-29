"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { Chat } from "./chat";
import { isPositionView, type PositionView } from "./lib/cards";
import { applyListPayload, applyStatusView, applyToolOutput, emptyPanel, type PanelState } from "./lib/panel";
import { LpPanel } from "./lp-panel";

export function Cockpit() {
  const { ready, authenticated, login, logout, user } = usePrivy();
  const [panel, setPanel] = useState<PanelState>(emptyPanel);
  const address = user?.wallet?.address;
  const account = user?.email?.address ?? (address ? short(address) : null);

  useEffect(() => {
    if (!authenticated || !address) {
      setPanel(emptyPanel);
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
  }, [authenticated, address]);

  const onToolOutput = useCallback((toolName: string | undefined, output: unknown) => {
    setPanel((prev) => applyToolOutput(prev, toolName, output));
  }, []);

  const onSelect = useCallback((view: PositionView) => {
    setPanel((prev) => ({ ...prev, selected: view, selectedId: view.tokenId, projection: undefined }));
    if (!view.tokenId) return;
    fetch(`/api/positions/${encodeURIComponent(view.tokenId)}`)
      .then((r) => r.json())
      .then((payload: unknown) => {
        if (payload && typeof payload === "object" && "view" in payload) {
          const view = (payload as { view: unknown }).view;
          if (isPositionView(view)) setPanel((prev) => applyStatusView(prev, view));
        }
      })
      .catch(() => {
        /* list row is enough */
      });
  }, []);

  return (
    <div className="cockpit">
      <header className="cockpit-bar">
        <Link className="wordmark" href="/">
          <i className="mark" aria-hidden="true" />
          UNA
        </Link>
        <div className="chat-bar-meta">
          <span>Base · dry-run default</span>
          {!ready ? (
            <span>…</span>
          ) : authenticated ? (
            <button className="ghost" type="button" onClick={() => void logout()}>
              {account ?? "Sign out"}
            </button>
          ) : (
            <button className="ghost" type="button" onClick={() => void login()}>
              Email login
            </button>
          )}
        </div>
      </header>

      <Chat
        authenticated={authenticated}
        onLogin={() => void login()}
        onToolOutput={onToolOutput}
        lastConfirm={panel.confirm}
      />
      <LpPanel
        connected={authenticated}
        ready={ready}
        onLogin={() => void login()}
        state={panel}
        onSelect={onSelect}
      />

      <footer className="cockpit-foot">
        <span>Dry-run first. Confirm to go live.</span>
        <span>You hold the NFT.</span>
      </footer>
    </div>
  );
}

function short(value: string): string {
  if (value.length <= 12) return value;
  if (value.startsWith("0x")) return `${value.slice(0, 6)}…${value.slice(-4)}`;
  return value;
}
