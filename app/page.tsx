"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { usePrivy } from "@privy-io/react-auth";
import { PairDiscs } from "./pair-discs";
import { TopNav } from "./top-nav";

const PREVIEW = [
  {
    pair: "WETH/USDC",
    symbol0: "WETH",
    symbol1: "USDC",
    fee: "0.05%",
    protocol: "v3",
    status: "in-range" as const,
    usd: "$24,180.00",
    fees: "$42.16",
    band: { left: 22, width: 48, current: 46 },
  },
  {
    pair: "cbBTC/USDC",
    symbol0: "cbBTC",
    symbol1: "USDC",
    fee: "0.30%",
    protocol: "v3",
    status: "in-range" as const,
    usd: "$9,640.00",
    fees: "$18.02",
    band: { left: 18, width: 54, current: 61 },
  },
  {
    pair: "WETH/USDC",
    symbol0: "WETH",
    symbol1: "USDC",
    fee: "0.01%",
    protocol: "v4",
    status: "oor" as const,
    usd: "$3,210.00",
    fees: "$1.44",
    band: { left: 58, width: 22, current: 18 },
  },
];

export default function Page() {
  const router = useRouter();
  const { ready, authenticated, login } = usePrivy();

  async function emailThenApp() {
    if (!authenticated) await login();
    router.push("/app");
  }

  return (
    <main className="landing">
      <TopNav ready={ready} authenticated={authenticated} onLogin={() => void login()} />

      <section className="landing-body">
        <div className="landing-hero">
          <h1>
            Liquidity, as an agent.
          </h1>
          <p className="sub">v2, v3, and v4. You hold the NFT.</p>
          <div className="cta-row">
            <Link className="btn btn-accent" href="/app">
              Open app
            </Link>
            {ready && !authenticated ? (
              <button className="btn" type="button" onClick={() => void emailThenApp()}>
                Continue with email
              </button>
            ) : null}
          </div>
        </div>

        <aside className="landing-preview" aria-hidden="true">
          <header className="lp-head">
            <span>Positions</span>
            <span className="muted">preview</span>
          </header>
          <div className="lp-list">
            {PREVIEW.map((row) => (
              <div className="lp-row lp-row-mock" key={`${row.pair}-${row.protocol}-${row.fee}`}>
                <PairDiscs symbol0={row.symbol0} symbol1={row.symbol1} />
                <div className="lp-id">
                  <span className="lp-pair">{row.pair}</span>
                  <span className="lp-id-meta">
                    {row.fee} · {row.protocol}
                  </span>
                </div>
                <span className="pill" data-status={row.status}>
                  {row.status === "in-range" ? "in range" : "OOR"}
                </span>
                <div className="strip strip-compact" data-tone={row.status === "oor" ? "oor" : "in"}>
                  <div className="strip-track">
                    <i className="strip-band" style={{ left: `${row.band.left}%`, width: `${row.band.width}%` }} />
                    <i className="strip-current" style={{ left: `${row.band.current}%` }} />
                  </div>
                </div>
                <div className="lp-money">
                  <span className="lp-usd-n">{row.usd}</span>
                  <span className="muted">fees {row.fees}</span>
                </div>
              </div>
            ))}
          </div>
        </aside>
      </section>

      <footer className="landing-foot">
        <span>Dry-run first. Confirm to go live.</span>
      </footer>
    </main>
  );
}
