"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useAddFunds, usePrivy, useWallets } from "@privy-io/react-auth";
import { YieldQuestCenter } from "./stable-quests";
import { readJsonPayload } from "./lib/api-payload";
import { reportClientError, trackProductEvent } from "./lib/telemetry-client";
import { sendWalletCallsAndWait, type ConnectedEvmWallet, type WalletTransaction } from "./lib/wallet-calls";

const BASE_CHAIN_ID = 8453;
const BASE_LOGO = "https://assets.relay.link/icons/8453/light.png";

type ThemePreference = "system" | "light" | "dark";
type ViewTab = "overview" | "markets";

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
  imageUrl?: string;
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
  const { ready, authenticated, user, login, logout, getAccessToken } = usePrivy();
  const { wallets } = useWallets();
  const { addFunds } = useAddFunds();

  const wallet = useMemo(() => {
    const preferred = user?.wallet?.address?.toLowerCase();
    return wallets.find((candidate) => candidate.address.toLowerCase() === preferred) ?? wallets[0];
  }, [user?.wallet?.address, wallets]);
  const address = wallet?.address ?? user?.wallet?.address;

  const [theme, setTheme] = useState<ThemePreference>("dark");
  const [tab, setTab] = useState<ViewTab>("overview");
  const [markets, setMarkets] = useState<StableMarketsPayload | null>(null);
  const [marketsState, setMarketsState] = useState<"loading" | "ready" | "error">("loading");
  const [amount, setAmount] = useState("100");
  const [plan, setPlan] = useState<StablePlan | null>(null);
  const [depositState, setDepositState] = useState<FlowState>({ kind: "idle" });
  const [positions, setPositions] = useState<PositionRow[]>([]);
  const [walletUnits, setWalletUnits] = useState<string | null>(null);
  const [positionsState, setPositionsState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [withdrawPlan, setWithdrawPlan] = useState<WithdrawPlan | null>(null);
  const [withdrawState, setWithdrawState] = useState<FlowState>({ kind: "idle" });
  const [fundingMessage, setFundingMessage] = useState<string | null>(null);
  const [questSignal, setQuestSignal] = useState(0);

  useEffect(() => {
    const saved = window.localStorage.getItem("wizzy-theme") ?? window.localStorage.getItem("una-theme");
    if (saved === "system" || saved === "light" || saved === "dark") setTheme(saved);
  }, []);

  function cycleTheme() {
    const next: ThemePreference = theme === "dark" ? "light" : theme === "light" ? "system" : "dark";
    setTheme(next);
    if (next === "system") delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = next;
    try {
      window.localStorage.setItem("wizzy-theme", next);
    } catch {
      // The selected theme still applies for this session when storage is unavailable.
    }
    const existingMeta = document.getElementById("wizzy-theme-color");
    if (next === "system") existingMeta?.remove();
    else {
      const meta = existingMeta ?? document.head.appendChild(document.createElement("meta"));
      meta.id = "wizzy-theme-color";
      meta.setAttribute("name", "theme-color");
      meta.setAttribute("content", next === "dark" ? "#09090d" : "#f8f5ef");
    }
  }

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
    setDepositState({ kind: "submitting", message: "Confirm in your wallet…" });
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
      setQuestSignal((current) => current + 1);
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
    setWithdrawState({ kind: "submitting", message: "Confirm in your wallet…" });
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
      setQuestSignal((current) => current + 1);
    } catch (error) {
      setWithdrawState({ kind: "error", message: error instanceof Error ? error.message : "The withdrawal could not be completed" });
      reportClientError("position-action", error);
    }
  }

  async function fundUsdc() {
    if (!authenticated || !address || !markets) { login(); return; }
    setFundingMessage("Opening Privy funding…");
    trackProductEvent("Cross-chain Funding Started", { destinationChainId: BASE_CHAIN_ID });
    try {
      const result = await addFunds({
        destination: { address, chain: `eip155:${BASE_CHAIN_ID}`, asset: markets.asset.address },
        crypto: { slippageBps: 100 },
      });
      if (result.method !== "crypto" || result.status !== "completed") throw new Error("Privy did not complete the deposit");
      setFundingMessage("USDC arrived on Base. You can make yield now.");
      trackProductEvent("Cross-chain Funding Completed", { destinationChainId: BASE_CHAIN_ID });
      void loadPositions();
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      setFundingMessage(message.includes("USER_EXITED") ? null : "Privy could not route that deposit. Try another chain or asset.");
      if (!message.includes("USER_EXITED")) reportClientError("cross-chain-funding", error);
    }
  }

  const showPlan = plan && (depositState.kind === "ready" || depositState.kind === "submitting");

  return (
    <main className="index-app">
      <div className="wizzy-atmosphere" aria-hidden="true">
        <span className="wizzy-ghost wizzy-ghost-1" />
        <span className="wizzy-ghost wizzy-ghost-2" />
        <span className="wizzy-ghost wizzy-ghost-3" />
        <span className="wizzy-ghost wizzy-ghost-4" />
        <span className="wizzy-ghost wizzy-ghost-5" />
        <span className="wizzy-ghost wizzy-ghost-6" />
      </div>
      <div className="nav-stack">
        <header className="index-nav">
          <button className="wizzy-wordmark" type="button" onClick={() => setTab("overview")} aria-label="Wizzy overview">
            <picture className="wizzy-mark" aria-hidden="true">
              {theme === "system" ? <source media="(prefers-color-scheme: dark)" srcSet="/brand/wizzy-mascot-dark.svg" /> : null}
              <img src={theme === "dark" ? "/brand/wizzy-mascot-dark.svg" : "/brand/wizzy-mascot-light.svg"} alt="" />
            </picture>
            <span>Wizzy</span>
          </button>
          <nav aria-label="Primary navigation">
            {([{ id: "overview", label: "Earn" }, { id: "markets", label: "Venues" }] as const).map((item) => (
              <button key={item.id} type="button" className={tab === item.id ? "is-active" : ""} onClick={() => setTab(item.id)}>{item.label}</button>
            ))}
          </nav>
          <div className="nav-actions">
            <YieldQuestCenter authenticated={authenticated} getAccessToken={getAccessToken} onConnect={() => login()} refreshSignal={questSignal} />
            <a className="social-button" href="https://x.com/wizzydotmeme" target="_blank" rel="noreferrer" aria-label="Follow Wizzy on X" title="@wizzydotmeme on X" onClick={() => trackProductEvent("X Opened", { location: "header" })}>
              <XIcon />
            </a>
            <button className="theme-button" type="button" onClick={cycleTheme} aria-label={`Theme: ${capitalize(theme)}. Switch to ${theme === "dark" ? "light" : theme === "light" ? "system" : "dark"}.`} title={`Theme: ${capitalize(theme)}`}>
              <ThemeIcon preference={theme} />
            </button>
            {!ready ? <span className="wallet-skeleton" /> : authenticated ? (
              <StableWalletMenu address={address ?? "Wallet"} onDisconnect={() => { trackProductEvent("Logout Started"); void logout(); }} />
            ) : (
              <button className="wallet-button wallet-connect" type="button" onClick={() => login()} aria-label="Connect wallet"><WalletIcon /><span>Connect</span></button>
            )}
          </div>
        </header>
      </div>

      <div className="index-shell" data-view={tab}>
        {tab === "overview" ? (
          <>
          <section className="index-hero">
            <div className="hero-stage">
              <div className="hero-copy">
                <h1>Make Stable Yield</h1>
                <p>Deposit USDC into a curated index of Base yield vaults and earn.<br /><span>Agents pick the venues and watch them around the clock. You keep custody.</span></p>
              </div>
              <div className="index-showcase" aria-label="Base yield index">
                <div className="network-lockup" aria-label="Built on Base">
                  <img src={BASE_LOGO} alt="" />
                  <span className="network-name"><small>Built on</small><b>Base</b></span>
                </div>
                <div className={`hero-token-field ${marketsState === "loading" ? "is-loading" : ""}`}>
                  {(marketsState === "loading" ? placeholderVaults() : activeVaults).map((vault, index) => (
                    <span className="hero-token" key={vault.id} style={{ "--token-index": index } as CSSProperties}>
                      <VenueIcon vault={vault} />
                      {vault.curatorName ? <b>{vault.curatorName}</b> : null}
                    </span>
                  ))}
                </div>
              </div>
            </div>
            <aside className="market-action" aria-label="Make yield">
              <label className={`amount-field ${amountError ? "is-invalid" : ""}`}>
                <span className="amount-heading"><span>You deposit</span>{authenticated && walletUnits !== null ? <span className="wallet-balance" role="status" title="Base USDC balance">Balance <b>{formatUnits(BigInt(walletUnits), decimals)} USDC</b></span> : null}</span>
                <span className="amount-input"><input id="deposit-amount" name="depositAmount" inputMode="decimal" value={amount} placeholder="0.00" onChange={(event) => { setAmount(event.target.value); setPlan(null); if (depositState.kind !== "idle") setDepositState({ kind: "idle" }); }} aria-label="USDC amount" aria-invalid={Boolean(amountError)} aria-describedby={amountError ? "amount-error" : undefined} /><b>USDC</b></span>
                {amountError ? <small className="amount-error" id="amount-error">{amountError}</small> : null}
              </label>

              <div className="funding-choice">
                <span><b>USDC on another chain?</b><small>Bridge to your Wizzy account.</small></span>
                <button className="cross-chain-fund" type="button" disabled={!ready} onClick={() => void fundUsdc()}>
                  <UsdcIcon />Add USDC
                </button>
              </div>
              {fundingMessage ? <p className="funding-status is-submitted" aria-live="polite">{fundingMessage}</p> : null}

              <div className={`market-output ${marketsState === "loading" ? "is-loading" : ""}`} aria-label="Index venues">
                <span className="market-breadth">
                  <span className="market-stack" role="img" aria-label={marketsState === "loading" ? "Reading venues" : activeVaults.map((vault) => vault.name).join(", ")}>
                    {(marketsState === "loading" ? placeholderVaults() : activeVaults).map((vault) => (
                      <VenueIcon vault={vault} key={vault.id} />
                    ))}
                  </span>
                  <span><b>{marketsState === "loading" ? "Reading venues" : `${activeVaults.length} venues`}</b><small>{marketsState === "loading" ? "Current index" : "Curated Base vaults"}</small></span>
                </span>
                <span className="action-economics"><small>Blended net APY</small><b>{formatApy(markets?.blendedNetApy)}</b></span>
              </div>

              {showPlan ? <div className="stable-plan" aria-live="polite">
                {plan.allocations.map((allocation) => <div className="stable-plan-row" key={allocation.vaultId}>
                  <span>{allocation.name}<small>{allocation.curatorName}</small></span>
                  <b>{formatUnits(BigInt(allocation.amountUnits), decimals)} USDC</b>
                </div>)}
                <div className="stable-plan-row is-fee"><span>Service fee ({(plan.serviceFeeBps / 100).toFixed(2)}%)</span><b>{formatUnits(BigInt(plan.serviceFeeUnits), decimals)} USDC</b></div>
                <button className="fund-button" type="button" disabled={depositState.kind === "submitting"} onClick={() => void executeDeposit()}>
                  {depositState.kind === "submitting" ? depositState.message : "Confirm deposit"}
                </button>
                <button className="ghost-cancel" type="button" disabled={depositState.kind === "submitting"} onClick={() => { setPlan(null); setDepositState({ kind: "idle" }); }}>Cancel</button>
              </div> : (
                <button className="fund-button" type="button" disabled={!ready || marketsState !== "ready" || Boolean(amountError) || depositState.kind === "planning"} onClick={() => void prepareDeposit()}>
                  {!ready ? "Preparing wallets…" : marketsState !== "ready" ? "Reading venues…" : !authenticated ? "Connect and earn" : depositState.kind === "planning" ? "Planning…" : "Make yield"}
                </button>
              )}
              {depositState.kind === "error" || depositState.kind === "done" ? <p className={`funding-status is-${depositState.kind === "done" ? "submitted" : "error"}`} aria-live="polite">{depositState.message}</p> : null}
              <p className="action-assurance">Base · Self-custodial · Withdraw any time</p>
            </aside>
          </section>
          {authenticated ? (
            <section className="index-main stable-yield-section" aria-label="Your yield">
              <header className="index-title-row"><div><h1>Your yield</h1><p>{positions.length ? `Earning across ${positions.length} venue${positions.length === 1 ? "" : "s"}.` : "Your first deposit starts earning immediately."}</p></div>{positions.length ? <b className="stable-total">{formatUnits(totalHeld, decimals)} USDC</b> : null}</header>
              {positionsState === "loading" ? <p className="stable-status">Reading your positions…</p> : null}
              {positionsState === "error" ? <p className="stable-status is-error">Could not read positions. <button type="button" className="stable-inline-button" onClick={() => void loadPositions()}>Retry</button></p> : null}
              {positions.length ? <div className="stable-plan">
                {positions.map((row) => <div className="stable-plan-row" key={row.vaultId}>
                  <span>{row.name}<small>{row.curatorName}</small></span>
                  <b>{formatUnits(BigInt(row.assetsUnits), decimals)} USDC</b>
                </div>)}
                <div className="stable-plan-actions">
                  <button type="button" className="stable-ghost-button" disabled={withdrawState.kind === "planning" || withdrawState.kind === "submitting"} onClick={() => void prepareWithdraw(5_000)}>Withdraw half</button>
                  <button type="button" className="stable-ghost-button" disabled={withdrawState.kind === "planning" || withdrawState.kind === "submitting"} onClick={() => void prepareWithdraw(10_000)}>Withdraw all</button>
                </div>
                {withdrawPlan && (withdrawState.kind === "ready" || withdrawState.kind === "submitting") ? <>
                  <div className="stable-plan-row"><span>Estimated return</span><b>{formatUnits(BigInt(withdrawPlan.estimatedAssetsUnits), decimals)} USDC</b></div>
                  <div className="stable-plan-row is-fee"><span>Withdrawal fee</span><b>{formatUnits(BigInt(withdrawPlan.serviceFeeUnits), decimals)} USDC</b></div>
                  <button className="fund-button" type="button" disabled={withdrawState.kind === "submitting"} onClick={() => void executeWithdraw()}>
                    {withdrawState.kind === "submitting" ? withdrawState.message : "Confirm withdrawal"}
                  </button>
                  <button className="ghost-cancel" type="button" disabled={withdrawState.kind === "submitting"} onClick={() => { setWithdrawPlan(null); setWithdrawState({ kind: "idle" }); }}>Cancel</button>
                </> : null}
                {withdrawState.kind === "error" || withdrawState.kind === "done" ? <p className={`stable-status is-${withdrawState.kind}`} aria-live="polite">{withdrawState.message}</p> : null}
              </div> : null}
            </section>
          ) : null}
          </>
        ) : (
          <section className="index-main markets-view">
            <header className="index-title-row">
              <div><h1>The venues</h1><p>Wizzy agents review vault health, curators, and timelocks every six hours. Rates are variable and set by each venue.</p></div>
            </header>
            <div className="stable-venues">
              {(markets?.vaults ?? []).map((vault) => <div className={`stable-venue ${vault.status !== "active" ? "is-paused" : ""}`} key={vault.id}>
                <span className="stable-venue-badge" style={{ background: vault.imageUrl ? "var(--surface-2)" : vault.color }} aria-hidden="true">{vault.imageUrl ? <img src={vault.imageUrl} alt="" /> : vault.symbol.slice(0, 1).toUpperCase()}</span>
                <span className="stable-venue-name"><b>{vault.name}</b><small>{vault.curatorName} · {vault.venue}{vault.status !== "active" ? " · paused" : ""}</small></span>
                <span className="stable-venue-stat"><small>Weight</small><b>{(vault.weightBps / 100).toFixed(0)}%</b></span>
                <span className="stable-venue-stat"><small>TVL</small><b>{formatUsd(vault.totalAssetsUsd)}</b></span>
                <span className="stable-venue-stat"><small>Net APY</small><b>{formatApy(vault.netApy)}</b></span>
              </div>)}
              {marketsState === "loading" ? <p className="stable-status">Reading the index…</p> : null}
            </div>
          </section>
        )}
      </div>

      <footer className="stable-footer">
        <span>Wizzy · Base · Self-custodial</span>
        <a href="/legacy">Legacy meme index</a>
      </footer>
    </main>
  );
}

function StableWalletMenu({ address, onDisconnect }: { address: string; onDisconnect: () => void }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);

  return <div className="wallet-menu-root" ref={rootRef}>
    <button className="wallet-button" type="button" aria-expanded={open} onClick={() => setOpen((current) => !current)}>
      <WalletIcon /><span>{address.length > 12 ? `${address.slice(0, 6)}…${address.slice(-4)}` : address}</span>
    </button>
    {open ? <div className="wallet-menu" role="menu">
      <button type="button" role="menuitem" onClick={() => {
        void navigator.clipboard?.writeText(address).then(() => { setCopied(true); window.setTimeout(() => setCopied(false), 1_500); });
      }}>{copied ? "Copied" : "Copy address"}</button>
      <a role="menuitem" href="/legacy">Legacy meme index</a>
      <button type="button" role="menuitem" onClick={() => { setOpen(false); onDisconnect(); }}>Disconnect</button>
    </div> : null}
  </div>;
}

function VenueIcon({ vault }: { vault: StableVaultRow }) {
  return <span className={`token-icon ${vault.imageUrl ? "is-logo" : ""}`} style={{ backgroundColor: vault.imageUrl ? "var(--surface-2)" : vault.color || "var(--surface-3)" }} aria-hidden="true">
    {vault.imageUrl ? <img src={vault.imageUrl} alt="" /> : <b>{vault.symbol.slice(0, 1).toUpperCase()}</b>}
  </span>;
}

function placeholderVaults(): StableVaultRow[] {
  return Array.from({ length: 4 }, (_, index) => ({
    id: String(index), name: "", symbol: "", venue: "", curatorName: "", vault: "0x0000000000000000000000000000000000000000",
    weightBps: 0, status: "active", risk: "", color: "", netApy: null, totalAssetsUsd: null,
  }));
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
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

function ThemeIcon({ preference }: { preference: ThemePreference }) {
  if (preference === "light") return <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4.4" /><path d="M12 2.6v2.8M12 18.6v2.8M21.4 12h-2.8M5.4 12H2.6M18.6 5.4l-2 2M7.4 16.6l-2 2M18.6 18.6l-2-2M7.4 7.4l-2-2" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" /></svg>;
  if (preference === "dark") return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.2 14.2A8.1 8.1 0 0 1 9.8 3.8a8.1 8.1 0 1 0 10.4 10.4Z" /></svg>;
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.2a8.8 8.8 0 1 0 0 17.6ZM12 3.2a8.8 8.8 0 1 1 0 17.6" fill="none" stroke="currentColor" strokeWidth="1.9" /><path d="M12 3.2a8.8 8.8 0 0 1 0 17.6Z" /></svg>;
}

function WalletIcon() { return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7.5A2.5 2.5 0 0 1 6.5 5H18v3H6.5a1.5 1.5 0 0 0 0 3H20v8H6a2 2 0 0 1-2-2V7.5Z"/><circle cx="16.5" cy="15" r="1.25"/></svg>; }

function XIcon() { return <svg className="x-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231Zm-1.161 17.52h1.833L7.084 4.126H5.117Z" /></svg>; }

function UsdcIcon() { return <svg viewBox="0 0 24 24" aria-hidden="true" width="14" height="14"><circle cx="12" cy="12" r="10" fill="#2775CA" /><path d="M12 5.6c.5 0 .9.4.9.9v.6c1.8.3 3 1.4 3.1 2.9h-1.8c-.1-.8-.8-1.4-2.1-1.4-1.3 0-2 .5-2 1.3 0 .7.5 1 1.9 1.3l1 .2c2.1.4 3.2 1.2 3.2 2.9 0 1.6-1.2 2.7-3.3 3v.6c0 .5-.4.9-.9.9s-.9-.4-.9-.9v-.6c-2-.3-3.2-1.4-3.3-3h1.8c.1.9 1 1.5 2.3 1.5 1.4 0 2.1-.5 2.1-1.3 0-.7-.5-1.1-2-1.4l-1-.2c-2-.4-3.1-1.2-3.1-2.9 0-1.5 1.2-2.6 3.2-2.9v-.6c0-.5.4-.9.9-.9Z" fill="#fff" /></svg>; }
