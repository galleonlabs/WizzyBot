"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useAddFunds, usePrivy, useWallets } from "@privy-io/react-auth";
import { readJsonPayload } from "./lib/api-payload";
import { reportClientError, trackProductEvent } from "./lib/telemetry-client";
import { sendWalletCallsAndWait, type ConnectedEvmWallet, type WalletTransaction } from "./lib/wallet-calls";

const BASE_CHAIN_ID = 8453;

type StableVaultRow = {
  id: string;
  name: string;
  symbol: string;
  venue: string;
  curatorName: string;
  vault: `0x${string}`;
  weightBps: number;
  status: "active" | "paused" | "watch";
  risk: string;
  color: string;
  netApy: number | null;
  totalAssetsUsd: number | null;
};

type StableMarketsPayload = {
  version: number;
  updatedAt: string;
  asset: { address: `0x${string}`; symbol: string; decimals: number };
  fees: { allocateBps: number; withdrawBps: number };
  minimumDepositUnits: string;
  vaults: StableVaultRow[];
  blendedNetApy: number | null;
};

type StablePlan = {
  kind: "stable-index";
  totalAmountUnits: string;
  serviceFeeBps: number;
  serviceFeeUnits: string;
  netAmountUnits: string;
  allocations: Array<{ vaultId: string; name: string; curatorName: string; amountUnits: string; weightBps: number }>;
  transactions: WalletTransaction[];
};

type WithdrawPlan = {
  kind: "stable-withdraw";
  estimatedAssetsUnits: string;
  serviceFeeUnits: string;
  withdrawals: Array<{ vaultId: string; estimatedAssets: string }>;
  transactions: WalletTransaction[];
};

type PositionRow = {
  vaultId: string;
  name: string;
  curatorName: string;
  weightBps: number;
  shares: string;
  assetsUnits: string;
};

type FlowState =
  | { kind: "idle" }
  | { kind: "planning" }
  | { kind: "ready"; message: string }
  | { kind: "submitting"; message: string }
  | { kind: "done"; message: string }
  | { kind: "error"; message: string };

export function StableApp() {
  const { ready, authenticated, user, login, logout } = usePrivy();
  const { wallets } = useWallets();
  const { addFunds } = useAddFunds();

  const wallet = useMemo(() => {
    const preferred = user?.wallet?.address?.toLowerCase();
    return wallets.find((candidate) => candidate.address.toLowerCase() === preferred) ?? wallets[0];
  }, [user?.wallet?.address, wallets]);
  const address = wallet?.address ?? user?.wallet?.address;

  const [markets, setMarkets] = useState<StableMarketsPayload | null>(null);
  const [marketsState, setMarketsState] = useState<"loading" | "ready" | "error">("loading");
  const [view, setView] = useState<"earn" | "venues">("earn");
  const [amount, setAmount] = useState("100");
  const [plan, setPlan] = useState<StablePlan | null>(null);
  const [depositState, setDepositState] = useState<FlowState>({ kind: "idle" });
  const [positions, setPositions] = useState<PositionRow[]>([]);
  const [walletUnits, setWalletUnits] = useState<string | null>(null);
  const [positionsState, setPositionsState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [withdrawPlan, setWithdrawPlan] = useState<WithdrawPlan | null>(null);
  const [withdrawState, setWithdrawState] = useState<FlowState>({ kind: "idle" });
  const [fundingMessage, setFundingMessage] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/stable/markets")
      .then(async (response) => {
        const payload = await readJsonPayload(response) as StableMarketsPayload & { error?: string };
        if (!response.ok || payload.error) throw new Error(payload.error ?? "Could not load the yield index");
        setMarkets(payload);
        setMarketsState("ready");
      })
      .catch((error) => {
        setMarketsState("error");
        reportClientError("markets", error);
      });
  }, []);

  const loadPositions = useCallback(async () => {
    if (!authenticated || !address) {
      setPositions([]);
      setWalletUnits(null);
      setPositionsState("idle");
      return;
    }
    setPositionsState("loading");
    try {
      const response = await fetch(`/api/stable/positions?owner=${encodeURIComponent(address)}`, { cache: "no-store" });
      const payload = await readJsonPayload(response) as { positions?: PositionRow[]; walletUnits?: string; error?: string };
      if (!response.ok || payload.error) throw new Error(payload.error ?? "Could not read your yield positions");
      setPositions(payload.positions ?? []);
      setWalletUnits(payload.walletUnits ?? null);
      setPositionsState("ready");
    } catch (error) {
      setPositionsState("error");
      reportClientError("positions", error);
    }
  }, [address, authenticated]);

  useEffect(() => { void loadPositions(); }, [loadPositions]);

  const decimals = markets?.asset.decimals ?? 6;
  const minimum = markets ? BigInt(markets.minimumDepositUnits) : 0n;
  const amountUnits = useMemo(() => parseUnitsSafe(amount, decimals), [amount, decimals]);
  const amountError = !amount.trim()
    ? null
    : amountUnits === null
      ? "Enter a valid USDC amount."
      : markets && amountUnits < minimum
        ? `Minimum deposit is ${formatUnits(minimum, decimals)} USDC.`
        : null;
  const activeVaults = useMemo(() => (markets?.vaults ?? []).filter((vault) => vault.status === "active"), [markets]);
  const totalHeld = positions.reduce((sum, row) => sum + BigInt(row.assetsUnits), 0n);

  async function prepareDeposit() {
    if (!authenticated) { login(); return; }
    if (!address || !amountUnits || amountError) return;
    setDepositState({ kind: "planning" });
    setPlan(null);
    try {
      const response = await fetch("/api/stable/index", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ owner: address, amountUnits: amountUnits.toString() }),
      });
      const payload = await readJsonPayload(response) as { plan?: StablePlan; error?: string };
      if (!response.ok || !payload.plan) throw new Error(payload.error ?? "Could not plan the deposit");
      setPlan(payload.plan);
      setDepositState({ kind: "ready", message: "Review the split and fee, then confirm in your wallet." });
      trackProductEvent("Stable Quote Ready", { vaults: payload.plan.allocations.length });
    } catch (error) {
      setDepositState({ kind: "error", message: error instanceof Error ? error.message : "Could not plan the deposit" });
      reportClientError("index-plan", error);
    }
  }

  async function executeDeposit() {
    if (!plan || !address || !wallet) return;
    setDepositState({ kind: "submitting", message: "Confirm the batch in your wallet…" });
    try {
      await sendWalletCallsAndWait({
        wallet: wallet as unknown as ConnectedEvmWallet,
        owner: address,
        chainId: BASE_CHAIN_ID,
        transactions: plan.transactions,
        onSubmitted: () => setDepositState({ kind: "submitting", message: "Deposit submitted. Waiting for Base…" }),
      });
      setDepositState({ kind: "done", message: "Deposited. Your USDC is earning across the index." });
      setPlan(null);
      trackProductEvent("Stable Deposit Completed", { amountUnits: plan.totalAmountUnits });
      void loadPositions();
    } catch (error) {
      setDepositState({ kind: "error", message: error instanceof Error ? error.message : "The deposit could not be completed" });
      reportClientError("index-submit", error);
    }
  }

  async function prepareWithdraw(fractionBps: number) {
    if (!address) return;
    setWithdrawState({ kind: "planning" });
    setWithdrawPlan(null);
    try {
      const response = await fetch("/api/stable/withdraw", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ owner: address, fractionBps }),
      });
      const payload = await readJsonPayload(response) as { plan?: WithdrawPlan; error?: string };
      if (!response.ok || !payload.plan) throw new Error(payload.error ?? "Could not plan the withdrawal");
      setWithdrawPlan(payload.plan);
      setWithdrawState({ kind: "ready", message: "Review the withdrawal, then confirm in your wallet." });
    } catch (error) {
      setWithdrawState({ kind: "error", message: error instanceof Error ? error.message : "Could not plan the withdrawal" });
      reportClientError("position-action", error);
    }
  }

  async function executeWithdraw() {
    if (!withdrawPlan || !address || !wallet) return;
    setWithdrawState({ kind: "submitting", message: "Confirm the batch in your wallet…" });
    try {
      await sendWalletCallsAndWait({
        wallet: wallet as unknown as ConnectedEvmWallet,
        owner: address,
        chainId: BASE_CHAIN_ID,
        transactions: withdrawPlan.transactions,
        onSubmitted: () => setWithdrawState({ kind: "submitting", message: "Withdrawal submitted. Waiting for Base…" }),
      });
      setWithdrawState({ kind: "done", message: "Withdrawn back to USDC in your wallet." });
      setWithdrawPlan(null);
      trackProductEvent("Stable Withdraw Completed", {});
      void loadPositions();
    } catch (error) {
      setWithdrawState({ kind: "error", message: error instanceof Error ? error.message : "The withdrawal could not be completed" });
      reportClientError("position-action", error);
    }
  }

  async function fundUsdc() {
    if (!authenticated || !address || !markets) { login(); return; }
    setFundingMessage("Opening Privy funding…");
    try {
      const result = await addFunds({
        destination: { address, chain: `eip155:${BASE_CHAIN_ID}`, asset: markets.asset.address },
        crypto: { slippageBps: 100 },
      });
      if (result.method !== "crypto" || result.status !== "completed") throw new Error("Privy did not complete the deposit");
      setFundingMessage("USDC arrived on Base. You can deposit now.");
      void loadPositions();
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      setFundingMessage(message.includes("USER_EXITED") ? null : "Privy could not route that deposit. Try another chain or asset.");
      if (!message.includes("USER_EXITED")) reportClientError("cross-chain-funding", error);
    }
  }

  return <div className="stable-shell">
    <header className="stable-header">
      <span className="stable-brand"><b>Wizzy</b></span>
      <nav className="stable-nav" aria-label="Views">
        {([{ id: "earn", label: "Earn" }, { id: "venues", label: "Venues" }] as const).map((item) => (
          <button key={item.id} type="button" className={view === item.id ? "is-active" : ""} onClick={() => setView(item.id)}>{item.label}</button>
        ))}
      </nav>
      <span className="stable-account">
        {authenticated && address
          ? <>
            <span className="stable-address" title={address}>{address.slice(0, 6)}…{address.slice(-4)}</span>
            <button type="button" className="stable-ghost-button" onClick={() => void logout()}>Sign out</button>
          </>
          : <button type="button" className="stable-cta-small" disabled={!ready} onClick={() => login()}>Connect</button>}
      </span>
    </header>

    {view === "earn" ? <main className="stable-main">
      <section className="stable-hero">
        <h1>Make Stable Yield</h1>
        <p>One USDC deposit, spread across Base&apos;s most trusted yield vaults. Wizzy curates the venues; you keep custody of every position.</p>
        <p className="stable-fineprint">Rates are variable and set by each venue. Nothing here is guaranteed.</p>
      </section>

      <section className="stable-widget" aria-label="Deposit">
        <label className="stable-amount">
          <span>You deposit</span>
          <span className="stable-amount-row">
            <input
              inputMode="decimal"
              name="stableAmount"
              value={amount}
              onChange={(event) => { setAmount(event.target.value); setPlan(null); if (depositState.kind !== "idle") setDepositState({ kind: "idle" }); }}
              aria-label="Deposit amount in USDC"
            />
            <b>USDC</b>
          </span>
          {amountError ? <small className="stable-error">{amountError}</small> : null}
        </label>

        <div className="stable-meta">
          <span><b>{marketsState === "ready" ? `${activeVaults.length} venues` : "Reading venues"}</b><small>Curated Base vaults</small></span>
          <span className="stable-apy"><small>Blended net APY</small><b>{formatApy(markets?.blendedNetApy)}</b></span>
        </div>

        <div className="stable-funding">
          <span><b>Need USDC on Base?</b><small>{walletUnits !== null ? `Wallet: ${formatUnits(BigInt(walletUnits), decimals)} USDC` : "Bridge or buy straight into your wallet."}</small></span>
          <button type="button" className="stable-ghost-button" onClick={() => void fundUsdc()}>Add USDC</button>
        </div>
        {fundingMessage ? <p className="stable-status" aria-live="polite">{fundingMessage}</p> : null}

        {plan && (depositState.kind === "ready" || depositState.kind === "submitting") ? <div className="stable-plan" aria-live="polite">
          {plan.allocations.map((allocation) => <div className="stable-plan-row" key={allocation.vaultId}>
            <span>{allocation.name}<small>{allocation.curatorName}</small></span>
            <b>{formatUnits(BigInt(allocation.amountUnits), decimals)} USDC</b>
          </div>)}
          <div className="stable-plan-row is-fee"><span>Service fee ({(plan.serviceFeeBps / 100).toFixed(2)}%)</span><b>{formatUnits(BigInt(plan.serviceFeeUnits), decimals)} USDC</b></div>
          <div className="stable-plan-actions">
            <button type="button" className="stable-cta" disabled={depositState.kind === "submitting"} onClick={() => void executeDeposit()}>
              {depositState.kind === "submitting" ? depositState.message : "Confirm deposit"}
            </button>
            <button type="button" className="stable-ghost-button" disabled={depositState.kind === "submitting"} onClick={() => { setPlan(null); setDepositState({ kind: "idle" }); }}>Cancel</button>
          </div>
        </div> : <button
          type="button"
          className="stable-cta"
          disabled={!ready || marketsState !== "ready" || Boolean(amountError) || depositState.kind === "planning"}
          onClick={() => void prepareDeposit()}
        >
          {!authenticated ? "Connect and earn" : depositState.kind === "planning" ? "Planning…" : "Review deposit"}
        </button>}
        {depositState.kind === "error" || depositState.kind === "done" ? <p className={`stable-status is-${depositState.kind}`} aria-live="polite">{depositState.message}</p> : null}
        <small className="stable-custody">Base · Self-custodial · Withdraw any time</small>
      </section>

      {authenticated ? <section className="stable-positions" aria-label="Your yield">
        <div className="stable-positions-head">
          <h2>Your yield</h2>
          {positions.length ? <b>{formatUnits(totalHeld, decimals)} USDC</b> : null}
        </div>
        {positionsState === "loading" ? <p className="stable-status">Reading your positions…</p> : null}
        {positionsState === "error" ? <p className="stable-status is-error">Could not read positions. <button type="button" className="stable-inline-button" onClick={() => void loadPositions()}>Retry</button></p> : null}
        {positionsState === "ready" && !positions.length ? <p className="stable-status">No positions yet. Your first deposit starts earning immediately.</p> : null}
        {positions.map((row) => <div className="stable-plan-row" key={row.vaultId}>
          <span>{row.name}<small>{row.curatorName}</small></span>
          <b>{formatUnits(BigInt(row.assetsUnits), decimals)} USDC</b>
        </div>)}
        {positions.length ? <div className="stable-plan-actions">
          <button type="button" className="stable-ghost-button" disabled={withdrawState.kind === "planning" || withdrawState.kind === "submitting"} onClick={() => void prepareWithdraw(5_000)}>Withdraw half</button>
          <button type="button" className="stable-ghost-button" disabled={withdrawState.kind === "planning" || withdrawState.kind === "submitting"} onClick={() => void prepareWithdraw(10_000)}>Withdraw all</button>
        </div> : null}
        {withdrawPlan && (withdrawState.kind === "ready" || withdrawState.kind === "submitting") ? <div className="stable-plan" aria-live="polite">
          <div className="stable-plan-row"><span>Estimated return</span><b>{formatUnits(BigInt(withdrawPlan.estimatedAssetsUnits), decimals)} USDC</b></div>
          <div className="stable-plan-row is-fee"><span>Withdrawal fee</span><b>{formatUnits(BigInt(withdrawPlan.serviceFeeUnits), decimals)} USDC</b></div>
          <div className="stable-plan-actions">
            <button type="button" className="stable-cta" disabled={withdrawState.kind === "submitting"} onClick={() => void executeWithdraw()}>
              {withdrawState.kind === "submitting" ? withdrawState.message : "Confirm withdrawal"}
            </button>
            <button type="button" className="stable-ghost-button" disabled={withdrawState.kind === "submitting"} onClick={() => { setWithdrawPlan(null); setWithdrawState({ kind: "idle" }); }}>Cancel</button>
          </div>
        </div> : null}
        {withdrawState.kind === "error" || withdrawState.kind === "done" ? <p className={`stable-status is-${withdrawState.kind}`} aria-live="polite">{withdrawState.message}</p> : null}
      </section> : null}
    </main> : <main className="stable-main">
      <section className="stable-hero">
        <h1>The venues</h1>
        <p>Wizzy&apos;s curated Base vault index. Reviewed venues, institutional curators, locked policy weights.</p>
      </section>
      <section className="stable-venues" aria-label="Vault index">
        {(markets?.vaults ?? []).map((vault) => <div className={`stable-venue ${vault.status !== "active" ? "is-paused" : ""}`} key={vault.id}>
          <span className="stable-venue-badge" style={{ background: vault.color }} aria-hidden="true">{vault.symbol.slice(0, 1).toUpperCase()}</span>
          <span className="stable-venue-name"><b>{vault.name}</b><small>{vault.curatorName} · {vault.venue}</small></span>
          <span className="stable-venue-stat"><small>Weight</small><b>{(vault.weightBps / 100).toFixed(0)}%</b></span>
          <span className="stable-venue-stat"><small>TVL</small><b>{formatUsd(vault.totalAssetsUsd)}</b></span>
          <span className="stable-venue-stat"><small>Net APY</small><b>{formatApy(vault.netApy)}</b></span>
        </div>)}
        {marketsState === "loading" ? <p className="stable-status">Reading the index…</p> : null}
      </section>
    </main>}

    <footer className="stable-footer">
      <span>Wizzy · Base · Self-custodial</span>
      <a href="/legacy">Legacy meme index</a>
    </footer>
  </div>;
}

function parseUnitsSafe(value: string, decimals: number): bigint | null {
  const trimmed = value.trim();
  if (!/^\d+(\.\d+)?$/.test(trimmed)) return null;
  const [whole, fraction = ""] = trimmed.split(".");
  if (fraction.length > decimals) return null;
  return BigInt(whole + fraction.padEnd(decimals, "0"));
}

function formatUnits(value: bigint, decimals: number): string {
  const raw = value.toString().padStart(decimals + 1, "0");
  const whole = raw.slice(0, raw.length - decimals) || "0";
  const fraction = raw.slice(raw.length - decimals).slice(0, 2).replace(/0+$/, "");
  return `${Number(whole).toLocaleString("en")}${fraction ? `.${fraction}` : ""}`;
}

function formatApy(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return `${(value * 100).toFixed(2)}%`;
}

function formatUsd(value: number | null): string {
  if (value === null) return "—";
  if (value >= 1e9) return `$${(value / 1e9).toFixed(1)}B`;
  if (value >= 1e6) return `$${(value / 1e6).toFixed(0)}M`;
  return `$${Math.round(value / 1e3)}K`;
}
