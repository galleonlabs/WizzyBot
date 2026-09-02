"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { useAccount, useConfig, useConnect, useDisconnect, type Connector } from "wagmi";
import { createPortal } from "react-dom";
import { lightRowToView, type PositionView } from "./lib/cards";
import { readJsonPayload } from "./lib/api-payload";
import { loadPositionRows } from "./lib/position-loading";
import { type ChainSlug } from "./lib/chains";
import { type CuratedPool, type PoolsPayload, type PositionActionKind, type PositionActionPlan } from "./lib/portfolio-types";
import { impliedEthUsd, positionOrientation, summarizePositions } from "./lib/position-math";
import { money, capitalize, short } from "./lib/format";
import { isShotQuery, SHOT_POOLS, SHOT_VIEWS } from "./lib/shot-fixture";
import { sendPlanTransactions, type PlanSubmission, type WalletTransaction } from "./lib/wallet-calls";
import { reportClientError, trackProductEvent } from "./lib/telemetry-client";
import { AchievementCenter } from "./achievement-center";
import { SendEthDialog } from "./send-eth-dialog";
import type { AchievementActionEvidence } from "./lib/achievements";
import { ActionSheet, type ActionRequest, type BalanceState, type PlanState } from "./positions/action-sheet";
import { PositionCard, positionKey, type CardAction } from "./positions/position-card";
import { PoolTable } from "./pools/pool-table";
import { LpSheet, type LpTarget } from "./pools/lp-sheet";
import { BRAND_ASSETS, ChevronIcon, DisconnectIcon, ExternalLinkIcon, SendIcon, ThemeIcon, WalletIcon, XIcon } from "./ui/icons";

type ViewTab = "pools" | "positions";
type ThemePreference = "system" | "light" | "dark";
type ChainBalances = Record<ChainSlug, BalanceState>;
type ChainLoadState = Record<ChainSlug, "idle" | "loading" | "ready" | "error">;
type SheetTarget = { position: PositionView; action: PositionActionKind };

const EMPTY_BALANCES: ChainBalances = { base: { kind: "idle" }, robinhood: { kind: "idle" } };
const IDLE_CHAINS: ChainLoadState = { base: "idle", robinhood: "idle" };
const EMPTY_POOLS: PoolsPayload = { pools: [], asOf: "", scanned: 0, excluded: 0, degraded: [] };

export function PortfolioApp() {
  const wagmiConfig = useConfig();
  const { address, status: accountStatus } = useAccount();
  const { connect, connectors, error: connectError, isPending: connectPending, reset: resetConnect } = useConnect();
  const { disconnect } = useDisconnect();
  const ready = accountStatus !== "reconnecting";
  const authenticated = accountStatus === "connected";
  const [tab, setTab] = useState<ViewTab>("pools");
  const [theme, setTheme] = useState<ThemePreference>("dark");
  const [balances, setBalances] = useState<ChainBalances>(EMPTY_BALANCES);
  const [pools, setPools] = useState<PoolsPayload>(EMPTY_POOLS);
  const [poolsState, setPoolsState] = useState<"loading" | "ready" | "error">("loading");
  const [positions, setPositions] = useState<PositionView[]>([]);
  const [chainState, setChainState] = useState<ChainLoadState>(IDLE_CHAINS);
  const [ethUsdByChain, setEthUsdByChain] = useState<Partial<Record<ChainSlug, number>>>({});
  const [previewMode, setPreviewMode] = useState(false);
  const [sheet, setSheet] = useState<SheetTarget | null>(null);
  const [lpTarget, setLpTarget] = useState<LpTarget | null>(null);
  const [actionPlan, setActionPlan] = useState<PositionActionPlan | null>(null);
  const [actionState, setActionState] = useState<PlanState>({ kind: "idle" });
  const [sendOpen, setSendOpen] = useState(false);
  const [connectOpen, setConnectOpen] = useState(false);
  const positionsRequestRef = useRef(0);
  const balanceRequestRef = useRef(0);
  const actionRequestRef = useRef<ActionRequest | null>(null);
  const authStateRef = useRef<"loading" | "signed-in" | "signed-out">("loading");
  const achievementActionRef = useRef<((evidence: AchievementActionEvidence) => Promise<void>) | null>(null);

  async function sendEvmBatch(input: {
    owner: string;
    chainId: number;
    transactions: readonly WalletTransaction[];
    onStep?: (message: string) => void;
  }): Promise<PlanSubmission> {
    return sendPlanTransactions({
      config: wagmiConfig,
      owner: input.owner,
      chainId: input.chainId,
      transactions: input.transactions,
      onProgress: ({ step, total, description }) => {
        input.onStep?.(total > 1 ? `${description} · ${step} of ${total}` : description);
      },
    });
  }

  const loadBalances = useCallback(async () => {
    const requestId = ++balanceRequestRef.current;
    if (!authenticated || !address) {
      setBalances(EMPTY_BALANCES);
      return;
    }
    setBalances({ base: { kind: "loading" }, robinhood: { kind: "loading" } });
    const entries = await Promise.all((["base", "robinhood"] as const).map(async (chain) => {
      try {
        const response = await fetch(`/api/balance?address=${encodeURIComponent(address)}&chain=${chain}`, { cache: "no-store" });
        const payload = await readJsonPayload(response) as { balanceWei?: string; error?: string };
        if (!response.ok || payload.balanceWei === undefined) throw new Error(payload.error ?? `Could not read ${chain} balance`);
        return [chain, { kind: "ready", balanceWei: payload.balanceWei } satisfies BalanceState] as const;
      } catch (error) {
        reportClientError("balance", error);
        return [chain, { kind: "error" } satisfies BalanceState] as const;
      }
    }));
    if (requestId !== balanceRequestRef.current) return;
    setBalances(Object.fromEntries(entries) as ChainBalances);
  }, [address, authenticated]);

  async function sendRobinhoodEth(recipient: `0x${string}`, amountWei: string, onSubmitted: () => void): Promise<`0x${string}` | null> {
    if (!address) throw new Error("Connect your wallet first.");
    trackProductEvent("ETH Send Started", { chainId: 4663 });
    try {
      const confirmed = await sendEvmBatch({
        owner: address,
        chainId: 4663,
        transactions: [{ to: recipient, data: "0x", value: amountWei, description: "Send ETH on Robinhood Chain" }],
        onStep: () => onSubmitted(),
      });
      const transactionHash = confirmed.transactionHashes[0] ?? null;
      await loadBalances();
      trackProductEvent("ETH Send Confirmed", { chainId: 4663, transactionHash });
      return transactionHash;
    } catch (error) {
      reportClientError("send-eth", error);
      throw error;
    }
  }

  const loadPools = useCallback(async (attempt = 0) => {
    if (attempt === 0) setPoolsState("loading");
    try {
      const response = await fetch("/api/pools", { cache: "no-cache" });
      const payload = await readJsonPayload(response) as PoolsPayload & { error?: string; warming?: boolean };
      if (response.status === 202 && payload.warming) {
        // A cold instance is still sweeping. Poll until the first snapshot lands.
        if (attempt < 20) window.setTimeout(() => void loadPools(attempt + 1), 4_000);
        else setPoolsState("error");
        return;
      }
      if (!response.ok || !Array.isArray(payload.pools)) throw new Error(payload.error ?? "Could not load pools");
      setPools(payload);
      setPoolsState("ready");
    } catch (error) {
      setPoolsState("error");
      reportClientError("markets", error);
    }
  }, []);

  const loadPositions = useCallback(async () => {
    const requestId = ++positionsRequestRef.current;
    if (!authenticated || !address) {
      setPositions([]);
      setChainState(IDLE_CHAINS);
      return;
    }
    setChainState({ base: "loading", robinhood: "loading" });
    try {
      // Each chain lands independently so a slow RPC never hides the other network.
      const result = await loadPositionRows(address, fetch, 25_000, ({ chain, rows, ethUsd }) => {
        if (requestId !== positionsRequestRef.current) return;
        const next = rows.map((row) => row && typeof row === "object" ? lightRowToView(row as Record<string, unknown>) : null)
          .filter((row): row is PositionView => Boolean(row) && !row!.closed);
        setPositions((current) => [...current.filter((position) => position.chain !== chain), ...next]);
        if (ethUsd) setEthUsdByChain((current) => ({ ...current, [chain]: ethUsd }));
        setChainState((current) => ({ ...current, [chain]: "ready" }));
      });
      if (requestId !== positionsRequestRef.current) return;
      if (result.failedChains.length) {
        setChainState((current) => Object.fromEntries(Object.entries(current).map(([chain, state]) => [chain, result.failedChains.includes(chain as ChainSlug) ? "error" : state])) as ChainLoadState);
      }
      result.errors.forEach((error) => reportClientError("positions", error));
    } catch (error) {
      if (requestId !== positionsRequestRef.current) return;
      setChainState({ base: "error", robinhood: "error" });
      reportClientError("positions", error);
    }
  }, [address, authenticated]);

  useEffect(() => {
    const saved = window.localStorage.getItem("wizzy-theme") ?? window.localStorage.getItem("una-theme");
    if (saved === "system" || saved === "light" || saved === "dark") setTheme(saved);
  }, []);

  useEffect(() => {
    if (!ready) return;
    const next = authenticated ? "signed-in" : "signed-out";
    if (authStateRef.current !== next) {
      trackProductEvent(authenticated ? "Session Restored" : "Session Ready", { authenticated });
      authStateRef.current = next;
    }
  }, [authenticated, ready]);

  useEffect(() => {
    void loadBalances();
  }, [loadBalances]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("view") === "positions") setTab("positions");
    if (isShotQuery()) {
      setPreviewMode(true);
      setPositions(SHOT_VIEWS);
      setChainState({ base: "ready", robinhood: "ready" });
      setPools({ pools: SHOT_POOLS, asOf: new Date().toISOString(), scanned: 3, excluded: 0, degraded: [] });
      setPoolsState("ready");
      return;
    }
    void loadPools();
  }, [loadPools]);

  useEffect(() => {
    if (!previewMode && !isShotQuery()) void loadPositions();
  }, [loadPositions, previewMode]);

  useEffect(() => {
    if (previewMode || isShotQuery()) return;
    setSheet(null);
    setLpTarget(null);
    setActionPlan(null);
    setActionState({ kind: "idle" });
  }, [address, authenticated, previewMode]);

  const poolsByAddress = useMemo(() => new Map(pools.pools.map((pool) => [`${pool.chain}:${pool.pool.toLowerCase()}`, pool])), [pools]);
  const hasPortfolioAccess = authenticated || previewMode;
  const impliedEth = useMemo(() => impliedEthUsd(positions), [positions]);
  const ethUsdFor = useCallback((chain?: string) => (chain === "base" || chain === "robinhood" ? ethUsdByChain[chain] : undefined) ?? ethUsdByChain.base ?? ethUsdByChain.robinhood ?? impliedEth, [ethUsdByChain, impliedEth]);
  const poolFor = useCallback((position: PositionView) => position.pool && position.chain ? poolsByAddress.get(`${position.chain}:${position.pool.toLowerCase()}`) : undefined, [poolsByAddress]);

  function changeTab(next: ViewTab) {
    if (next === tab) return;
    setTab(next);
    const url = new URL(window.location.href);
    if (next === "pools") url.searchParams.delete("view");
    else url.searchParams.set("view", next);
    window.history.replaceState(null, "", `${url.pathname}${url.search}`);
  }

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

  function startLogin(source: "header" | "positions" | "pools") {
    trackProductEvent("Login Started", { source });
    resetConnect();
    setConnectOpen(true);
  }

  function openPool(pool: CuratedPool) {
    if (!authenticated && !previewMode) {
      startLogin("pools");
      return;
    }
    trackProductEvent("Pool Opened", { chainId: pool.chainId, venue: pool.venue, reviewed: pool.reviewed });
    setLpTarget({ kind: "new", pool });
  }

  async function requestPositionActionPlan(position: PositionView, request: ActionRequest): Promise<PositionActionPlan> {
    if (!address || !position.tokenId || !position.chain) throw new Error("Connect your wallet first.");
    const response = await fetch("/api/portfolio/action", {
      method: "POST",
      headers: { "content-type": "application/json" },
      cache: "no-store",
      body: JSON.stringify({
        owner: address,
        chain: position.chain,
        tokenId: position.tokenId,
        action: request.action,
        percent: request.percent,
        protocol: position.protocol === "V2" || position.protocol === "V3" || position.protocol === "V4" ? position.protocol : undefined,
        venue: position.venue === "aerodrome-slipstream" || position.venue === "uniswap-v3" ? position.venue : undefined,
        positionManager: position.positionManager,
      }),
    });
    const payload = await readJsonPayload(response) as { plan?: PositionActionPlan; error?: string };
    if (!response.ok || !payload.plan) throw new Error(payload.error ?? `Could not prepare ${request.action}`);
    return payload.plan;
  }

  function openAction(position: PositionView, action: CardAction) {
    if (action === "add") {
      const orientation = positionOrientation(position);
      const memeAddress = orientation.quoteIsToken0 === null ? undefined : orientation.quoteIsToken0 ? position.address1 : position.address0;
      const memeDecimals = orientation.quoteIsToken0 ? position.decimals1 : position.decimals0;
      if (!memeAddress) return;
      trackProductEvent("Position Action Opened", { action, chainId: position.chain === "robinhood" ? 4663 : 8453 });
      setLpTarget({ kind: "add", position, meme: { address: memeAddress, symbol: orientation.memeSymbol, decimals: memeDecimals ?? 18 }, image: poolFor(position)?.token.imageUrl });
      return;
    }
    actionRequestRef.current = null;
    setActionPlan(null);
    setActionState({ kind: "idle" });
    setSheet({ position, action });
    trackProductEvent("Position Action Opened", { action, chainId: position.chain === "robinhood" ? 4663 : 8453 });
  }

  function closeSheet() {
    if (actionState.kind === "signing" || actionState.kind === "waiting") return;
    setSheet(null);
    setActionPlan(null);
    setActionState({ kind: "idle" });
    actionRequestRef.current = null;
  }

  function resetSheet() {
    if (actionState.kind === "signing" || actionState.kind === "waiting") return;
    setActionPlan(null);
    setActionState({ kind: "idle" });
    actionRequestRef.current = null;
  }

  async function preparePositionAction(request: ActionRequest) {
    const target = sheet;
    if (!target || !address) return;
    actionRequestRef.current = request;
    setActionPlan(null);
    setActionState({ kind: "planning", message: "Quoting…" });
    try {
      const plan = await requestPositionActionPlan(target.position, request);
      if (actionRequestRef.current !== request) return;
      setActionPlan(plan);
      setActionState({ kind: "ready" });
    } catch (error) {
      if (actionRequestRef.current !== request) return;
      setActionState({ kind: "error", message: error instanceof Error ? error.message : `Could not prepare ${request.action}` });
      reportClientError("position-action", error);
    }
  }

  async function executePositionAction() {
    const target = sheet;
    const request = actionRequestRef.current;
    if (!actionPlan || !address || !target || !request) return;
    if (actionPlan.owner.toLowerCase() !== address.toLowerCase()) {
      setActionPlan(null);
      setActionState({ kind: "error", message: "Your wallet changed. Review this action again." });
      return;
    }
    try {
      setActionState({ kind: "signing", message: "Refreshing the quote…" });
      const freshPlan = await requestPositionActionPlan(target.position, request);
      setActionPlan(freshPlan);
      setActionState({ kind: "signing", message: "Confirm in your wallet" });
      await sendEvmBatch({
        owner: freshPlan.owner,
        chainId: freshPlan.chainId,
        transactions: freshPlan.transactions,
        onStep: (message) => setActionState({ kind: "waiting", message }),
      });
      await Promise.all([loadPositions(), loadBalances()]);
      setActionState({ kind: "submitted", message: successMessage(freshPlan) });
      trackProductEvent(freshPlan.kind === "withdraw" ? "Withdrawal Confirmed" : freshPlan.kind === "decrease" ? "Reduce Confirmed" : "Fees Collected", { chainId: freshPlan.chainId });
    } catch (error) {
      setActionState({ kind: "error", message: error instanceof Error ? error.message : "Wallet submission failed" });
      reportClientError("position-action", error);
    }
  }

  function sellAfterExit(position: PositionView, token: { address: string; symbol: string; decimals: number }) {
    const image = poolFor(position)?.token.imageUrl;
    setSheet(null);
    setActionPlan(null);
    setActionState({ kind: "idle" });
    setLpTarget({ kind: "sell", position, token, image });
  }

  const sheetBusy = actionState.kind === "planning" || actionState.kind === "signing" || actionState.kind === "waiting";

  return (
    <main className="market-app">
      <div className="wizzy-atmosphere" aria-hidden="true">
        <span className="wizzy-ghost wizzy-ghost-1" />
        <span className="wizzy-ghost wizzy-ghost-2" />
        <span className="wizzy-ghost wizzy-ghost-3" />
        <span className="wizzy-ghost wizzy-ghost-4" />
        <span className="wizzy-ghost wizzy-ghost-5" />
        <span className="wizzy-ghost wizzy-ghost-6" />
      </div>
      <header className="market-nav">
        <button className="wizzy-wordmark" type="button" onClick={() => changeTab("pools")} aria-label="Wizzy pools">
          <picture className="wizzy-mark" aria-hidden="true">
            {theme === "system" ? <source media="(prefers-color-scheme: dark)" srcSet="/brand/wizzy-mascot-dark.svg" /> : null}
            <img src={theme === "dark" ? "/brand/wizzy-mascot-dark.svg" : "/brand/wizzy-mascot-light.svg"} alt="" />
          </picture>
          <span>Wizzy</span>
        </button>
        <nav aria-label="Primary navigation">
          {([{ id: "pools", label: "Pools" }, { id: "positions", label: "Positions" }] as const).map((item) => (
            <button key={item.id} type="button" className={tab === item.id ? "is-active" : ""} onClick={() => changeTab(item.id)}>{item.label}</button>
          ))}
        </nav>
        <div className="nav-actions">
          <AchievementCenter
            address={address}
            authenticated={authenticated}
            positionsState={chainState.base === "loading" || chainState.robinhood === "loading" ? "loading" : chainState.base === "idle" ? "idle" : "ready"}
            onConnect={() => startLogin("header")}
            preview={previewMode}
            actionRef={achievementActionRef}
          />
          <a className="social-button" href="https://x.com/wizzydotmeme" target="_blank" rel="noreferrer" aria-label="Follow Wizzy on X" title="@wizzydotmeme on X" onClick={() => trackProductEvent("X Opened", { location: "header" })}>
            <XIcon />
          </a>
          <button className="theme-button" type="button" onClick={cycleTheme} aria-label={`Theme: ${capitalize(theme)}. Switch to ${theme === "dark" ? "light" : theme === "light" ? "system" : "dark"}.`} title={`Theme: ${capitalize(theme)}`}>
            <ThemeIcon preference={theme} />
          </button>
          {!ready ? <span className="wallet-skeleton" /> : authenticated ? (
            <WalletMenu address={address ?? "Wallet"} onSend={() => { setSendOpen(true); void loadBalances(); trackProductEvent("ETH Send Opened", { chainId: 4663 }); }} onDisconnect={() => { trackProductEvent("Logout Started"); disconnect(); }} />
          ) : (
            <button className="wallet-button wallet-connect" type="button" onClick={() => startLogin("header")} aria-label="Connect wallet"><WalletIcon /><span>Connect</span></button>
          )}
        </div>
      </header>

      {previewMode ? <div className="preview-banner">Illustrative preview · development only</div> : null}

      <div className="market-shell" data-view={tab}>
        {tab === "pools" ? (
          <section className="pools-page">
            <header className="page-head">
              <div>
                <h1>Meme yield, curated.</h1>
                <p>Every ETH-paired meme pool on Uniswap and Aerodrome across Base and Robinhood Chain, minus the scams and the dust. Swap into the exact tokens with Relay, then open the position on the venue.</p>
              </div>
              <span className="network-lockup" aria-label="Built on Base and Robinhood Chain">
                <span className="network-icons" aria-hidden="true"><img src={BRAND_ASSETS.base} alt="" /><img src={BRAND_ASSETS.robinhood} alt="" /></span>
                <span className="network-name"><small>Curating</small><b>Base + Robinhood</b></span>
              </span>
            </header>
            {poolsState === "ready" ? <p className="pool-meta">{pools.pools.length} pools listed · {pools.pools.filter((pool) => pool.reviewed).length} hand-reviewed · {pools.excluded} filtered out{pools.degraded.length ? " · partial sweep" : ""}{pools.asOf ? ` · updated ${relativeTime(pools.asOf)}` : ""}</p> : null}
            <PoolTable pools={pools.pools} state={poolsState} onSelect={openPool} onRetry={() => void loadPools()} />
            <p className="pool-footnote">Wizzy adds a 0.3% fee inside each Relay quote. Nothing is charged on collecting, reducing, or exiting, and Wizzy never holds your funds.</p>
          </section>
        ) : (
          <PositionsPage
            authenticated={hasPortfolioAccess}
            positions={positions}
            chainState={chainState}
            ethUsdFor={ethUsdFor}
            poolFor={poolFor}
            busy={sheetBusy}
            onConnect={() => startLogin("positions")}
            onRetry={() => void loadPositions()}
            onNew={() => changeTab("pools")}
            onAction={openAction}
          />
        )}
      </div>

      {sheet ? <ActionSheet
        key={`${positionKey(sheet.position)}-${sheet.action}`}
        position={positions.find((candidate) => positionKey(candidate) === positionKey(sheet.position)) ?? sheet.position}
        action={sheet.action}
        image={poolFor(sheet.position)?.token.imageUrl}
        plan={actionPlan}
        state={actionState}
        onPlan={(request) => void preparePositionAction(request)}
        onExecute={() => void executePositionAction()}
        onReset={resetSheet}
        onClose={closeSheet}
        onSell={(token) => sellAfterExit(sheet.position, token)}
      /> : null}
      {lpTarget ? <LpSheet
        key={lpTarget.kind === "new" ? lpTarget.pool.id : `${lpTarget.kind}-${positionKey(lpTarget.position)}`}
        target={lpTarget}
        owner={address}
        onClose={() => setLpTarget(null)}
        onCompleted={() => { void loadBalances(); void loadPositions(); }}
      /> : null}
      {address ? <SendEthDialog open={sendOpen} owner={address} balanceWei={balances.robinhood.kind === "ready" ? balances.robinhood.balanceWei : undefined} onClose={() => setSendOpen(false)} onSend={sendRobinhoodEth} /> : null}
      <ConnectWalletDialog
        open={connectOpen && !authenticated}
        connectors={connectors}
        pending={connectPending}
        error={connectError}
        onPick={(connector) => connect({ connector }, { onSuccess: () => setConnectOpen(false) })}
        onClose={() => { setConnectOpen(false); resetConnect(); }}
      />
    </main>
  );
}

function PositionsPage({ authenticated, positions, chainState, ethUsdFor, poolFor, busy, onConnect, onRetry, onNew, onAction }: {
  authenticated: boolean;
  positions: PositionView[];
  chainState: ChainLoadState;
  ethUsdFor: (chain?: string) => number | undefined;
  poolFor: (position: PositionView) => CuratedPool | undefined;
  busy: boolean;
  onConnect: () => void;
  onRetry: () => void;
  onNew: () => void;
  onAction: (position: PositionView, action: CardAction) => void;
}) {
  const loading = chainState.base === "loading" || chainState.robinhood === "loading";
  const failed = (["base", "robinhood"] as const).filter((chain) => chainState[chain] === "error");
  const settled = !loading && chainState.base !== "idle";
  const summary = summarizePositions(positions);
  const sorted = [...positions].sort((a, b) => (b.positionUsd ?? 0) - (a.positionUsd ?? 0));
  return <section className="positions-page" id="positions">
    <header className="page-head">
      <div>
        <h1>Positions</h1>
        <p>{authenticated
          ? positions.length ? `${positions.length} open position${positions.length === 1 ? "" : "s"} across Base and Robinhood.` : "Every LP position in your wallet, with one-transaction actions."
          : "Connect your wallet to see and manage your liquidity."}</p>
      </div>
      {authenticated ? <button className="page-cta" type="button" onClick={onNew}>Find a pool</button> : null}
    </header>
    {authenticated && positions.length ? <dl className="portfolio-summary" aria-label="Portfolio summary">
      <div><dt>Total value</dt><dd>{summary.priced ? money(summary.valueUsd) : "—"}</dd></div>
      <div><dt>Unclaimed fees</dt><dd className={summary.feesUsd > 0 ? "positive" : ""}>{summary.priced ? money(summary.feesUsd) : "—"}</dd></div>
      <div><dt>In range</dt><dd>{summary.inRange} of {summary.total}</dd></div>
    </dl> : null}
    {!authenticated ? <EmptyState title="See your positions" body="Connect to view value, fees, ranges, and one-transaction actions in one place." action="Connect wallet" onAction={onConnect} /> : null}
    {authenticated && settled && !positions.length && !failed.length ? <EmptyState title="No positions yet" body="Pick a curated pool, swap into its tokens, and open your first one on the venue." action="Browse pools" onAction={onNew} /> : null}
    {authenticated && failed.length ? <EmptyState variant="error" title={`Could not read ${failed.map((chain) => chain === "base" ? "Base" : "Robinhood").join(" or ")}`} body="The network did not answer in time. Positions on that chain are hidden until it does." action="Try again" onAction={onRetry} /> : null}
    <div className="position-grid">
      {sorted.map((position) => <PositionCard
        key={positionKey(position)}
        view={position}
        ethUsd={ethUsdFor(position.chain)}
        poolApr={poolFor(position)?.feeApr24hPct ?? null}
        image={poolFor(position)?.token.imageUrl}
        busy={busy}
        onAction={(action) => onAction(position, action)}
      />)}
      {authenticated && loading ? (["base", "robinhood"] as const).filter((chain) => chainState[chain] === "loading").map((chain) => (
        <div className="lp-card is-skeleton" key={chain} aria-live="polite" aria-label={`Reading ${chain === "base" ? "Base" : "Robinhood"} positions`}>
          <span className="lp-skeleton-line is-title" /><span className="lp-skeleton-line" /><span className="lp-skeleton-line is-chart" />
          <small>Reading {chain === "base" ? "Base" : "Robinhood"}…</small>
        </div>
      )) : null}
    </div>
  </section>;
}

function EmptyState({ variant = "default", title, body, action, onAction }: { variant?: "default" | "error"; title: string; body: string; action: string; onAction: () => void }) {
  return <section className={`portfolio-empty is-${variant}`}>
    <span className="empty-symbol"><img src="/brand/wizzy-mascot-32.png" alt="" /></span>
    <div className="empty-copy"><h3>{title}</h3><p>{body}</p></div>
    <button className="empty-action" type="button" onClick={onAction}>{action}</button>
  </section>;
}

function ConnectWalletDialog({ open, connectors, pending, error, onPick, onClose }: {
  open: boolean;
  connectors: readonly Connector[];
  pending: boolean;
  error: Error | null;
  onPick: (connector: Connector) => void;
  onClose: () => void;
}) {
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);
  if (!open || typeof document === "undefined") return null;
  // EIP-6963 discovery lists each installed wallet with its own icon. The
  // generic injected fallback only earns a row when nothing was discovered.
  const discovered = connectors.filter((connector) => connector.id !== "injected");
  const list = discovered.length ? discovered : connectors;
  return createPortal(<div className="send-eth-backdrop" onPointerDown={(event) => { if (event.currentTarget === event.target && !pending) onClose(); }}>
    <section className="send-eth-dialog connect-dialog" role="dialog" aria-modal="true" aria-labelledby="connect-wallet-title" aria-describedby="connect-wallet-description">
      <header>
        <span><img src="/brand/wizzy-mascot-32.png" alt="" /><span><small>Wizzy</small><b>Base + Robinhood</b></span></span>
        <button type="button" onClick={onClose} disabled={pending}>Close</button>
      </header>
      <div className="send-eth-body">
        <div className="send-eth-heading"><h2 id="connect-wallet-title">Connect a wallet</h2><p id="connect-wallet-description">Your wallet holds every position. Wizzy never takes custody.</p></div>
        {list.length ? <div className="connect-options">
          {list.map((connector) => (
            <button key={connector.uid} type="button" disabled={pending} onClick={() => onPick(connector)}>
              {connector.icon ? <img src={connector.icon} alt="" /> : <WalletIcon />}
              <b>{connector.name}</b>
              <ChevronIcon />
            </button>
          ))}
        </div> : <p className="connect-empty">No browser wallet found. Install Rabby, MetaMask, or Coinbase Wallet, then reload.</p>}
        {error ? <p className="send-eth-error" role="alert">{connectErrorMessage(error)}</p> : null}
      </div>
    </section>
  </div>, document.body);
}

function connectErrorMessage(error: Error): string {
  const message = error.message;
  if (/rejected|denied/i.test(message)) return "The connection request was declined in your wallet.";
  return message.length <= 160 ? message : "The wallet could not connect. Try again.";
}

function WalletMenu({ address, onSend, onDisconnect }: { address: string; onSend: () => void; onDisconnect: () => void }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      triggerRef.current?.focus();
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);

  return <div className="wallet-menu-root" ref={rootRef}>
    <button ref={triggerRef} className="wallet-button" type="button" onClick={() => setOpen((current) => !current)} aria-label={`Wallet ${short(address)}`} aria-haspopup="menu" aria-expanded={open} aria-controls="wallet-menu">
      <WalletIcon /><span>{short(address)}</span><ChevronIcon />
    </button>
    {open ? <div className="wallet-menu-popover" id="wallet-menu" role="menu" aria-label="Wallet menu" onKeyDown={handleMenuNavigation}>
      <header>
        <img src="/brand/wizzy-mascot-32.png" alt="" />
        <span><small>Your wallet</small><b>{short(address)}</b></span>
      </header>
      <div className="wallet-menu-actions">
        <button type="button" role="menuitem" onClick={() => { setOpen(false); onSend(); }}>
          <SendIcon /><span><b>Send ETH</b><small>On Robinhood Chain</small></span>
        </button>
        <a href={`https://robinhoodchain.blockscout.com/address/${address}`} target="_blank" rel="noreferrer" role="menuitem" onClick={() => setOpen(false)}>
          <WalletIcon /><span><b>Explorer</b><small>Your onchain activity</small></span><ExternalLinkIcon />
        </a>
        <button type="button" role="menuitem" onClick={() => { setOpen(false); onDisconnect(); }}>
          <DisconnectIcon /><span><b>Disconnect</b><small>Remove this connection</small></span>
        </button>
      </div>
    </div> : null}
  </div>;
}

function handleMenuNavigation(event: ReactKeyboardEvent<HTMLDivElement>) {
  if (!(["ArrowDown", "ArrowUp", "Home", "End"] as string[]).includes(event.key)) return;
  const items = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('[role="menuitem"]'));
  if (!items.length) return;
  event.preventDefault();
  const current = items.indexOf(document.activeElement as HTMLElement);
  const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : event.key === "ArrowUp" ? (current - 1 + items.length) % items.length : (current + 1) % items.length;
  items[next]?.focus();
}

function successMessage(plan: PositionActionPlan): string {
  if (plan.kind === "withdraw") return "Both pool tokens are back in your wallet.";
  if (plan.kind === "decrease") return `${plan.removal?.percent ?? ""}% of the position is back in your wallet.`.trim();
  return "Your fees are in your wallet.";
}

function relativeTime(iso: string): string {
  const minutes = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60_000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  return `${Math.round(minutes / 60)} h ago`;
}
