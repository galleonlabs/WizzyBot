"use client";

import Link from "next/link";

export function TopNav({
  active,
  account,
  ready,
  authenticated,
  onLogin,
  onLogout,
  onTab,
}: {
  active?: "positions" | "agent";
  account?: string | null;
  ready?: boolean;
  authenticated?: boolean;
  onLogin?: () => void;
  onLogout?: () => void;
  onTab?: (tab: "positions" | "agent") => void;
}) {
  return (
    <header className="topnav">
      <Link className="wordmark" href="/">
        <i className="mark" aria-hidden="true" />
        UNA
      </Link>
      <nav className="topnav-links" aria-label="Primary">
        <Link
          className={active === "positions" ? "is-on" : undefined}
          href="/app"
          onClick={(event) => {
            if (!onTab) return;
            event.preventDefault();
            onTab("positions");
          }}
        >
          Positions
        </Link>
        <Link
          className={active === "agent" ? "is-on" : undefined}
          href="/app?tab=agent"
          onClick={(event) => {
            if (!onTab) return;
            event.preventDefault();
            onTab("agent");
          }}
        >
          Agent
        </Link>
      </nav>
      <div className="topnav-meta">
        <span className="net">Base</span>
        {ready === false ? (
          <span className="ghost">…</span>
        ) : authenticated ? (
          <button className="ghost" type="button" onClick={onLogout}>
            {account ?? "Sign out"}
          </button>
        ) : (
          <button className="btn btn-connect" type="button" onClick={onLogin}>
            Email
          </button>
        )}
      </div>
    </header>
  );
}
