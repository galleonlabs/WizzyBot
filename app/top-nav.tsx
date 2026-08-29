"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { CHAIN_META, CHAIN_SLUGS, parseChainSlug, type ChainSlug } from "./lib/chains";

function chainFromLocation(): ChainSlug {
  if (typeof window === "undefined") return "base";
  try {
    return parseChainSlug(new URLSearchParams(window.location.search).get("chain"));
  } catch {
    return "base";
  }
}

function writeChainQuery(slug: ChainSlug) {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  url.searchParams.set("chain", slug);
  window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
}

export function TopNav({
  active,
  account,
  ready,
  authenticated,
  chain,
  onLogin,
  onLogout,
  onTab,
  onChain,
}: {
  active?: "positions" | "agent";
  account?: string | null;
  ready?: boolean;
  authenticated?: boolean;
  chain?: ChainSlug;
  onLogin?: () => void;
  onLogout?: () => void;
  onTab?: (tab: "positions" | "agent") => void;
  onChain?: (slug: ChainSlug) => void;
}) {
  const [uncontrolled, setUncontrolled] = useState<ChainSlug>("base");

  useEffect(() => {
    setUncontrolled(chainFromLocation());
  }, []);

  const current = chain ?? uncontrolled;

  function selectChain(slug: ChainSlug) {
    writeChainQuery(slug);
    setUncontrolled(slug);
    onChain?.(slug);
  }

  const positionsHref = `/app?chain=${current}`;
  const agentHref = `/app?tab=agent&chain=${current}`;

  return (
    <header className="topnav">
      <Link className="wordmark" href="/">
        <i className="mark" aria-hidden="true" />
        Una
      </Link>
      <nav className="topnav-links" aria-label="Primary">
        <Link
          className={active === "positions" ? "is-on" : undefined}
          href={positionsHref}
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
          href={agentHref}
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
        <div className="net" role="group" aria-label="Chain">
          {CHAIN_SLUGS.map((slug) => (
            <button
              key={slug}
              type="button"
              className={current === slug ? "is-on" : undefined}
              aria-pressed={current === slug}
              onClick={() => selectChain(slug)}
            >
              {CHAIN_META[slug].label}
            </button>
          ))}
        </div>
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
