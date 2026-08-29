"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { usePrivy } from "@privy-io/react-auth";

export default function Page() {
  const router = useRouter();
  const { ready, authenticated, login } = usePrivy();

  async function emailThenChat() {
    if (!authenticated) await login();
    router.push("/app");
  }

  return (
    <main className="landing">
      <header className="landing-top">
        <span className="wordmark">
          <i className="mark" aria-hidden="true" />
          UnaBot
        </span>
        <span>Base</span>
      </header>

      <section className="landing-hero">
        <h1>
          Uniswap LP
          <br />
          on autopilot.
        </h1>
        <p className="sub">v2, v3, and v4. You keep the position.</p>
        <div className="cta-row">
          <Link className="btn btn-accent" href="/app">
            Open cockpit
          </Link>
          {ready && !authenticated ? (
            <button className="btn" type="button" onClick={() => void emailThenChat()}>
              Continue with email
            </button>
          ) : null}
        </div>
      </section>

      <footer className="landing-foot">
        <span>Dry-run first. Confirm to go live.</span>
        <span>You keep the NFT.</span>
      </footer>

      <div className="landing-range" aria-hidden="true">
        <i />
      </div>
    </main>
  );
}
