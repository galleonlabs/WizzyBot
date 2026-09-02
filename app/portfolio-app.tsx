"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { useAccount, useConfig, useConnect, useDisconnect, type Connector } from "wagmi";
import { createPortal } from "react-dom";
import { formatEther, parseEther } from "viem";
import { compositionShares, lightRowToView, positionRangeGeometry, positionRangePreview, positionRangePreviewForTicks, priceLabel, type PositionView, type RangePreset } from "./lib/cards";
import { readJsonPayload } from "./lib/api-payload";
import { loadPositionRows } from "./lib/position-loading";
import { positionFeesEth, positionValueEth, positionValueUsd } from "./lib/portfolio-summary";
import { type ChainSlug } from "./lib/chains";
import {
  type CuratedMarket,
  type AllocationPlan,
  type MarketsPayload,
  type MarketStats,
  type PoolActivityItem,
  type PoolActivityPayload,
  type PositionActionPlan,
} from "./lib/portfolio-types";
import { isShotQuery, SHOT_VIEWS } from "./lib/shot-fixture";
import { sendPlanTransactions, type PlanSubmission, type WalletTransaction } from "./lib/wallet-calls";
import { reportClientError, trackProductEvent } from "./lib/telemetry-client";
import { AchievementCenter } from "./achievement-center";
import { SendEthDialog } from "./send-eth-dialog";
import type { AchievementActionEvidence } from "./lib/achievements";

type ViewTab = "overview" | "markets";
type ThemePreference = "system" | "light" | "dark";
type PlanState = { kind: "idle" | "planning" | "ready" | "signing" | "waiting" | "submitted" | "error"; message?: string };
type BalanceState = { kind: "idle" | "loading" | "ready" | "error"; balanceWei?: string };
type ChainBalances = Record<ChainSlug, BalanceState>;
type AnyPositionActionPlan = PositionActionPlan;
type PositionActionKind = "collect" | "compound" | "increase" | "rebalance" | "withdraw";
type MarketChain = ChainSlug | "solana";
type MarketEntry = {
  market: CuratedMarket;
  chain: MarketChain;
};
const MARKET_SKELETON_COUNT = 6;
const MARKETS_PER_PAGE = 8;
const FOMO_REFERRER = "makemememarkets";
const BRIDGE_URLS: Record<ChainSlug, string> = {
  base: "https://relay.link/bridge/base",
  robinhood: "https://relay.link/bridge/robinhood",
};
const POOL_ACTIVITY_REFRESH_MS = 60_000;
const PREVIEW_POOL_ACTIVITY: PoolActivityItem[] = [
  { id: "preview-1", kind: "added", marketId: "robinhood-pons", symbol: "PONS", pair: "PONS/WETH", wethAmount: "9.34", transactionHash: "0xpreview", transactionUrl: "#", blockNumber: "3" },
  { id: "preview-2", kind: "removed", marketId: "robinhood-ai", symbol: "AI", pair: "AI/WETH", wethAmount: "0.61", transactionHash: "0xpreview", transactionUrl: "#", blockNumber: "2" },
  { id: "preview-3", kind: "added", marketId: "robinhood-cashcat", symbol: "CASHCAT", pair: "CASHCAT/WETH", wethAmount: "1.82", transactionHash: "0xpreview", transactionUrl: "#", blockNumber: "1" },
];
const PREVIEW_WITHDRAWAL_PLAN: PositionActionPlan = {
  kind: "withdraw",
  owner: "0x1111111111111111111111111111111111111111",
  chain: "robinhood",
  chainId: 4663,
  tokenId: "941",
  pair: "CASHCAT/WETH",
  execution: "wallet_transactions",
  atomic: false,
  expectedConfirmations: 1,
  serviceFeeBps: 0,
  serviceFee: [],
  settlement: { asset: "ETH", minimumAmountWei: "19118000000000000", marketSymbol: "CASHCAT" },
  transactions: [],
  allowedTargets: [],
  createdAt: "2026-08-30T00:00:00.000Z",
  expiresAt: "2099-08-30T00:00:00.000Z",
  notices: [],
};
const BRAND_ASSETS = {
  base: "https://assets.relay.link/icons/8453/light.png",
  robinhood: "https://assets.relay.link/icons/4663/light.png",
  solana: "https://assets.relay.link/icons/792703809/light.png",
  fomo: "https://fomo.family/favicon.svg",
} as const;

const EMPTY_MARKETS: MarketsPayload = {
  catalog: { version: 1, updatedAt: "", chains: [] },
  solana: {
    slug: "solana",
    chainId: 792703809,
    label: "Solana",
    accent: "#8b5cf6",
    minimumAllocationLamports: "300000000",
    gasReserveLamports: "25000000",
    markets: [],
  },
  fundingChains: [{ id: 8453, label: "Base" }, { id: 4663, label: "Robinhood Chain" }],
  stats: [],
  source: "",
};
const EMPTY_BALANCES: ChainBalances = { base: { kind: "idle" }, robinhood: { kind: "idle" } };

export function PortfolioApp() {
  const wagmiConfig = useConfig();
  const { address, status: accountStatus } = useAccount();
  const { connect, connectors, error: connectError, isPending: connectPending, reset: resetConnect } = useConnect();
  const { disconnect } = useDisconnect();
  const ready = accountStatus !== "reconnecting";
  const authenticated = accountStatus === "connected";
  const [tab, setTab] = useState<ViewTab>("overview");
  const [theme, setTheme] = useState<ThemePreference>("dark");
  const [balances, setBalances] = useState<ChainBalances>(EMPTY_BALANCES);
  const [markets, setMarkets] = useState<MarketsPayload>(EMPTY_MARKETS);
  const [marketsState, setMarketsState] = useState<"loading" | "ready" | "error">("loading");
  const [positions, setPositions] = useState<PositionView[]>([]);
  const [positionsState, setPositionsState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [previewMode, setPreviewMode] = useState(false);
  const [actionPlan, setActionPlan] = useState<AnyPositionActionPlan | null>(null);
  const [actionState, setActionState] = useState<PlanState>({ kind: "idle" });
  const [zapMarketId, setZapMarketId] = useState<string | null>(null);
  const [zapAmount, setZapAmount] = useState("0.05");
  const [zapPlan, setZapPlan] = useState<AllocationPlan | null>(null);
  const [zapState, setZapState] = useState<PlanState>({ kind: "idle" });
  const [sendOpen, setSendOpen] = useState(false);
  const [connectOpen, setConnectOpen] = useState(false);
  const positionsRequestRef = useRef(0);
  const balanceRequestRef = useRef(0);
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

  const loadPositions = useCallback(async () => {
    const requestId = ++positionsRequestRef.current;
    if (!authenticated || !address) {
      setPositions([]);
      setPositionsState("idle");
      return;
    }
    setPositionsState("loading");
    try {
      const result = await loadPositionRows(address);
      if (requestId !== positionsRequestRef.current) return;
      const next = result.rows.map((row) => row && typeof row === "object" ? lightRowToView(row as Record<string, unknown>) : null)
        .filter((row): row is PositionView => Boolean(row));
      setPositions(next);
      setPositionsState(result.failedChains.length === 2 ? "error" : "ready");
      result.errors.forEach((error) => reportClientError("positions", error));
    } catch (error) {
      if (requestId !== positionsRequestRef.current) return;
      setPositions([]);
      setPositionsState("error");
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
    const requested = params.get("view");
    if (requested === "markets" || requested === "positions") setTab("markets");
    if (isShotQuery()) {
      setPreviewMode(true);
      setPositions(SHOT_VIEWS);
      setPositionsState("ready");
      const previewState = params.get("state");
      if (previewState === "deposit-success") {
        setZapState({ kind: "submitted", message: "Market made. Your position NFT is in your wallet." });
      }
      if (previewState === "withdraw-ready" || previewState === "withdraw-success") {
        setActionPlan(PREVIEW_WITHDRAWAL_PLAN);
        setActionState({
          kind: previewState === "withdraw-ready" ? "ready" : "submitted",
          message: previewState === "withdraw-ready" ? "Review the ETH return before continuing." : "Your ETH is back in your wallet.",
        });
      }
    }
    fetch("/api/markets", { cache: "no-cache" })
      .then(async (response) => {
        const payload = await readJsonPayload(response) as MarketsPayload;
        if (!response.ok) throw new Error("Could not load markets");
        setMarkets(payload);
        setMarketsState("ready");
      })
      .catch((error) => {
        setMarketsState("error");
        reportClientError("markets", error);
      });
  }, []);

  useEffect(() => {
    if (!previewMode && !isShotQuery()) void loadPositions();
  }, [loadPositions, previewMode]);

  useEffect(() => {
    if (previewMode || isShotQuery()) return;
    setZapPlan(null);
    setZapState({ kind: "idle" });
    setActionPlan(null);
    setActionState({ kind: "idle" });
  }, [address, authenticated, previewMode]);

  const activeMarkets = useMemo<MarketEntry[]>(() => {
    return markets.catalog.chains.flatMap((chain) => chain.markets
      .filter((market) => market.status === "active")
      .map((market) => ({ market, chain: chain.slug })));
  }, [markets]);
  const stats = useMemo(() => new Map(markets.stats.map((row) => [row.marketId, row])), [markets.stats]);
  const hasPortfolioAccess = authenticated || previewMode;

  function changeTab(next: ViewTab) {
    if (next === tab) return;
    setTab(next);
    const url = new URL(window.location.href);
    if (next === "overview") url.searchParams.delete("view");
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

  function startLogin(source: "header" | "make-markets" | "markets") {
    trackProductEvent("Login Started", { source });
    resetConnect();
    setConnectOpen(true);
  }

  function fundChain(chain: ChainSlug) {
    if (!authenticated || !address) {
      startLogin("make-markets");
      return;
    }
    const destinationChainId = chain === "robinhood" ? 4663 : 8453;
    trackProductEvent("Cross-chain Funding Started", { destinationChainId });
    window.open(`${BRIDGE_URLS[chain]}?toAddress=${address}`, "_blank", "noopener,noreferrer");
  }

  async function requestPositionActionPlan(input: {
    position: PositionView;
    action: PositionActionKind;
    amountWei?: string;
    rangePreset?: RangePreset;
  }): Promise<AnyPositionActionPlan> {
    if (!address || !input.position.tokenId || !input.position.chain) throw new Error("Connect your wallet first.");
    const response = await fetch("/api/portfolio/action", {
      method: "POST",
      headers: { "content-type": "application/json" },
      cache: "no-store",
      body: JSON.stringify({
        owner: address,
        chain: input.position.chain,
        tokenId: input.position.tokenId,
        action: input.action,
        amountWei: input.amountWei,
        protocol: input.position.protocol === "V2" || input.position.protocol === "V3" || input.position.protocol === "V4" ? input.position.protocol : undefined,
        venue: input.position.venue,
        positionManager: input.position.positionManager,
        rangePreset: input.action === "rebalance" ? input.rangePreset : undefined,
      }),
    });
    const payload = await readJsonPayload(response) as { plan?: AnyPositionActionPlan; error?: string };
    if (!response.ok || !payload.plan) throw new Error(payload.error ?? `Could not prepare ${input.action}`);
    return payload.plan;
  }

  async function preparePositionAction(position: PositionView, action: PositionActionKind, rangePreset?: RangePreset, amount?: string) {
    if (!address || !position.tokenId || !position.chain) return;
    let amountWei: string | undefined;
    if (action === "increase") {
      try {
        const parsedAmount = parseEther(amount ?? "0");
        if (parsedAmount <= 0n) throw new Error("Enter an ETH amount to add.");
        amountWei = parsedAmount.toString();
      } catch {
        setActionPlan(null);
        setActionState({ kind: "error", message: "Enter a valid ETH amount." });
        return;
      }
    }
    const withdrawsToEth = positionSettlesToEth(position);
    const planningVerb = action === "collect"
      ? "Preparing to collect fees from"
      : action === "compound"
      ? "Preparing to reinvest"
      : action === "increase"
        ? "Preparing to add liquidity to"
      : action === "rebalance"
        ? "Preparing a new range for"
        : withdrawsToEth ? "Preparing an ETH withdrawal for" : "Preparing to withdraw";
    setActionPlan(null);
    setActionState({ kind: "planning", message: `${planningVerb} ${position.pair}…` });
    try {
      const plan = await requestPositionActionPlan({ position, action, amountWei, rangePreset });
      setActionPlan(plan);
      const message = action === "collect"
        ? "Review the fees returning to your wallet."
        : action === "compound"
        ? "Review the fees ready to reinvest."
        : action === "increase"
          ? "Review the ETH being added to this position."
        : action === "rebalance"
          ? "Review the new range before continuing."
          : withdrawsToEth ? "Review the ETH return before continuing." : "Review the withdrawal before continuing.";
      setActionState({ kind: "ready", message });
    } catch (error) {
      setActionState({ kind: "error", message: error instanceof Error ? error.message : `Could not prepare ${action}` });
      reportClientError("position-action", error);
    }
  }

  async function executePositionAction() {
    if (!actionPlan || !address) return;
    if (!sameAddress(actionPlan.owner, address)) {
      setActionPlan(null);
      setActionState({ kind: "error", message: "Your wallet changed. Review this action again." });
      return;
    }
    try {
      const position = positions.find((candidate) => candidate.chain === actionPlan.chain && candidate.tokenId === actionPlan.tokenId);
      if (!position) throw new Error("This position changed. Reload it before continuing.");
      setActionState({ kind: "planning", message: "Refreshing the position and checking the latest chain state…" });
      const freshPlan = await requestPositionActionPlan({
        position,
        action: actionPlan.kind,
        amountWei: actionPlan.funding?.amountWei,
        rangePreset: actionPlan.range?.preset,
      });
      setActionPlan(freshPlan);
      const settlesToEth = freshPlan.kind === "withdraw" && freshPlan.settlement?.asset === "ETH";
      setActionState({ kind: "signing", message: "Approve this position update in your wallet." });
      const confirmedEvm = await sendEvmBatch({
        owner: freshPlan.owner,
        chainId: freshPlan.chainId,
        transactions: freshPlan.transactions,
        onStep: (message) => setActionState({ kind: "waiting", message }),
      });
      await Promise.all([loadPositions(), loadBalances()]);
      if (freshPlan.kind === "withdraw") {
        // The exit invalidates the earlier zap celebration. Returning to Make
        // must show a fresh form, never a stale "Market made" state.
        setZapPlan(null);
        setZapState({ kind: "idle" });
      }
      setActionState({
        kind: "submitted",
        message: positionActionSuccessMessage(freshPlan, settlesToEth),
      });
      if ((freshPlan.kind === "compound" || freshPlan.kind === "rebalance") && freshPlan.chain === "robinhood" && confirmedEvm) {
        const transactionHashes = confirmedEvm.transactionHashes;
        if (transactionHashes.length) void achievementActionRef.current?.({
          action: freshPlan.kind,
          chainId: 4663,
          tokenId: freshPlan.tokenId,
          transactionHashes,
        });
      }
      trackProductEvent(freshPlan.kind === "withdraw" ? "Withdrawal Confirmed" : freshPlan.kind === "rebalance" ? "Rebalance Confirmed" : freshPlan.kind === "increase" ? "Liquidity Increased" : freshPlan.kind === "collect" ? "Fees Collected" : "Compound Confirmed", { chainId: freshPlan.chainId });
    } catch (error) {
      setActionState({ kind: "error", message: error instanceof Error ? error.message : "Wallet submission failed" });
      reportClientError("position-action", error);
    }
  }

  function openZap(marketId: string) {
    setZapMarketId((current) => current === marketId ? null : marketId);
    setZapPlan(null);
    setZapState({ kind: "idle" });
    trackProductEvent("Zap Opened", { marketId });
  }

  async function requestAllocationPlan(input: { owner: string; chain: ChainSlug; amountWei: string; marketId: string }): Promise<AllocationPlan> {
    const response = await fetch("/api/portfolio/allocate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      cache: "no-store",
      body: JSON.stringify({
        owner: input.owner,
        chain: input.chain,
        amountWei: input.amountWei,
        marketId: input.marketId,
      }),
    });
    const payload = await readJsonPayload(response) as { plan?: AllocationPlan; error?: string };
    if (!response.ok || !payload.plan) throw new Error(payload.error ?? "Could not quote this market");
    return payload.plan;
  }

  async function prepareZap(marketId: string) {
    if (!authenticated || !address) {
      startLogin("markets");
      return;
    }
    const selected = activeMarkets.find((entry) => entry.market.id === marketId);
    if (!selected || selected.chain === "solana") {
      setZapState({ kind: "error", message: "This market is no longer available." });
      return;
    }
    let amountWei: bigint;
    try {
      amountWei = parseEther(zapAmount || "0");
    } catch {
      setZapState({ kind: "error", message: "Enter a valid ETH amount." });
      return;
    }
    setZapState({ kind: "planning", message: "Quoting the pool…" });
    setZapPlan(null);
    try {
      const plan = await requestAllocationPlan({ owner: address, chain: selected.chain, amountWei: amountWei.toString(), marketId });
      setZapPlan(plan);
      setZapState({ kind: "ready", message: "Review the position, then confirm in your wallet." });
      trackProductEvent("Zap Quote Ready", { marketId });
    } catch (error) {
      setZapState({ kind: "error", message: error instanceof Error ? error.message : "Could not quote this market" });
      reportClientError("market-plan", error);
    }
  }

  async function executeZap() {
    if (!zapPlan || !address) return;
    if (!sameAddress(zapPlan.owner, address)) {
      setZapPlan(null);
      setZapState({ kind: "error", message: "Your wallet changed. Review a fresh quote before continuing." });
      return;
    }
    try {
      const marketId = zapPlan.markets[0]?.marketId;
      if (!marketId) throw new Error("This market quote is incomplete. Review it again.");
      setZapState({ kind: "planning", message: "Refreshing the pool quote and checking the latest chain state…" });
      const freshPlan = await requestAllocationPlan({
        owner: address,
        chain: zapPlan.chain,
        amountWei: zapPlan.amountWei,
        marketId,
      });
      setZapPlan(freshPlan);
      setZapState({ kind: "signing", message: "Approve the market in your wallet." });
      await sendEvmBatch({
        owner: freshPlan.owner,
        chainId: freshPlan.chainId,
        transactions: freshPlan.transactions,
        onStep: (message) => setZapState({ kind: "waiting", message }),
      });
      await loadPositions();
      setZapState({ kind: "submitted", message: "Market made. Your position NFT is in your wallet." });
      setZapPlan(null);
      trackProductEvent("Zap Confirmed", { marketId });
    } catch (error) {
      setZapState({ kind: "error", message: error instanceof Error ? error.message : "The market could not be made" });
      reportClientError("market-submit", error);
    }
  }

  const positionLedger = (
    <PositionLedger
      authenticated={hasPortfolioAccess}
      positions={positions}
      state={positionsState}
      markets={activeMarkets}
      stats={stats}
      onStart={() => hasPortfolioAccess ? changeTab("overview") : startLogin("markets")}
      onRetry={() => void loadPositions()}
      onAction={preparePositionAction}
      actionPlan={actionPlan}
      actionState={actionState}
      onExecute={executePositionAction}
      onCancel={() => { setActionPlan(null); setActionState({ kind: "idle" }); }}
      balances={authenticated ? balances : null}
      onFund={fundChain}
    />
  );
  const marketLedger = (
    <section className="market-section market-catalog">
      <header className="section-title">
        <div><h2>Meme markets</h2><p>Reviewed every six hours.</p></div>
      </header>
      <MarketLedger
        markets={activeMarkets}
        stats={stats}
        state={marketsState}
        zapMarketId={zapMarketId}
        zapAmount={zapAmount}
        zapPlan={zapPlan}
        zapState={zapState}
        onOpenZap={openZap}
        onZapAmount={(next) => { setZapAmount(next); setZapPlan(null); if (zapState.kind !== "idle") setZapState({ kind: "idle" }); }}
        onPrepareZap={(id) => void prepareZap(id)}
        onExecuteZap={() => void executeZap()}
        onCloseZap={() => { setZapMarketId(null); setZapPlan(null); setZapState({ kind: "idle" }); }}
        balances={authenticated ? balances : null}
        onFund={fundChain}
      />
    </section>
  );

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
      <div className="nav-stack">
        <header className="market-nav">
          <button className="wizzy-wordmark" type="button" onClick={() => changeTab("overview")} aria-label="Wizzy overview">
            <picture className="wizzy-mark" aria-hidden="true">
              {theme === "system" ? <source media="(prefers-color-scheme: dark)" srcSet="/brand/wizzy-mascot-dark.svg" /> : null}
              <img src={theme === "dark" ? "/brand/wizzy-mascot-dark.svg" : "/brand/wizzy-mascot-light.svg"} alt="" />
            </picture>
            <span>Wizzy</span>
          </button>
          <nav aria-label="Primary navigation">
            {([{ id: "overview", label: "Make" }, { id: "markets", label: "Positions" }] as const).map((item) => (
              <button key={item.id} type="button" className={tab === item.id ? "is-active" : ""} onClick={() => changeTab(item.id)}>{item.label}</button>
            ))}
          </nav>
          <div className="nav-actions">
            <AchievementCenter
              address={address}
              authenticated={authenticated}
              positionsState={positionsState}
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
        <PoolActivityStrip preview={previewMode} />
      </div>

      {previewMode ? <div className="preview-banner">Illustrative preview · development only</div> : null}

      <div className="market-shell" data-view={tab}>
          {tab === "overview" ? (
            <section className="market-hero">
                <div className="hero-stage">
                  <div className="hero-copy">
                    <h1>Make Meme Markets</h1>
                    <p>Add ETH to any listed market. Wizzy selects the best eligible pool, handles the swap, and creates the LP position in your wallet.</p>
                  </div>
                  <MarketShowcase />
                </div>
            </section>
          ) : null}
          {tab === "overview" ? (
            <section className="market-main markets-view home-markets">
              {marketLedger}
            </section>
          ) : (
            <section className="market-main markets-view">
              <header className="market-title-row">
                <div><h1>Your positions</h1><p>{hasPortfolioAccess ? (positions.length ? `${positions.length} position${positions.length === 1 ? "" : "s"} in this wallet.` : "New positions appear here after they are confirmed.") : "Connect your wallet to see positions on Base and Robinhood."}</p></div>
              </header>
              {positionLedger}
            </section>
          )}
      </div>
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

function PoolActivityStrip({ preview }: { preview: boolean }) {
  const [activity, setActivity] = useState<PoolActivityPayload>({ state: "ready", items: [], asOfBlock: null, scannedBlocks: 0, rpcRequests: 2 });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (preview) {
      setActivity({ state: "ready", items: PREVIEW_POOL_ACTIVITY, asOfBlock: "preview", scannedBlocks: 0, rpcRequests: 2 });
      setLoading(false);
      return;
    }
    let active = true;
    let request: AbortController | null = null;
    let pending = false;

    const load = async () => {
      if (document.visibilityState === "hidden" || pending) return;
      pending = true;
      request?.abort();
      request = new AbortController();
      const timeout = window.setTimeout(() => request?.abort(), 8_000);
      try {
        const response = await fetch("/api/pool-activity", { signal: request.signal });
        const payload = await readJsonPayload(response) as PoolActivityPayload;
        if (!response.ok) throw new Error("Could not load pool activity");
        if (active) setActivity((current) => payload.state === "ready" || !current.items.length ? payload : current);
      } catch {
        if (active) setActivity((current) => current.items.length ? current : { state: "unavailable", items: [], asOfBlock: null, scannedBlocks: 0, rpcRequests: 2 });
      } finally {
        window.clearTimeout(timeout);
        pending = false;
        if (active) setLoading(false);
      }
    };
    const refresh = window.setInterval(() => { void load(); }, POOL_ACTIVITY_REFRESH_MS);
    const onVisibility = () => { if (document.visibilityState === "visible") void load(); };
    document.addEventListener("visibilitychange", onVisibility);
    void load();
    return () => {
      active = false;
      request?.abort();
      window.clearInterval(refresh);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [preview]);

  const duration = `${Math.max(36, activity.items.length * 7)}s`;
  return <section className={`pool-activity is-${activity.state}`} aria-label="Pool activity">
    <span className="pool-activity-label">Pool activity</span>
    <div className="pool-activity-window">
      {activity.items.length ? <div className="pool-activity-track" style={{ "--activity-duration": duration } as CSSProperties}>
        <PoolActivityGroup items={activity.items} />
        <PoolActivityGroup items={activity.items} duplicate />
      </div> : <span className="pool-activity-status">{loading ? "Reading active pools" : activity.state === "unavailable" ? "Temporarily unavailable" : "No recent adds or removals"}</span>}
    </div>
  </section>;
}

function PoolActivityGroup({ items, duplicate = false }: { items: PoolActivityItem[]; duplicate?: boolean }) {
  return <span className="pool-activity-group" aria-hidden={duplicate ? "true" : undefined}>
    {items.map((item) => {
      const content = <>
        <span className="pool-activity-kind"><i aria-hidden="true">{item.kind === "added" ? "+" : "−"}</i>{item.kind === "added" ? "Added" : "Removed"}</span>
        <strong>{item.pair}</strong>
        {item.wethAmount ? <span>{item.wethAmount} ETH</span> : null}
        {!duplicate ? <ExternalLinkIcon /> : null}
      </>;
      return duplicate
        ? <span className="pool-activity-item" data-kind={item.kind} key={`duplicate-${item.id}`}>{content}</span>
        : <a className="pool-activity-item" data-kind={item.kind} href={item.transactionUrl} target="_blank" rel="noreferrer" title={`View ${item.kind} liquidity transaction for ${item.pair}`} key={item.id}>{content}</a>;
    })}
  </span>;
}

function MarketShowcase() {
  return <div className="market-showcase" aria-label="Base and Robinhood meme markets">
    <div className="network-lockup" aria-label="Built on Base and Robinhood Chain">
      <span className="network-icons" aria-hidden="true"><img src={BRAND_ASSETS.base} alt="" /><img src={BRAND_ASSETS.robinhood} alt="" /></span>
      <span className="network-name"><small>Built on</small><b>Base + Robinhood</b></span>
    </div>
  </div>;
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

function SuccessCelebration({ label }: { label: string }) {
  return <div className="success-celebration" role="img" aria-label={label}>
    <span className="success-spark success-spark-1" /><span className="success-spark success-spark-2" /><span className="success-spark success-spark-3" /><span className="success-spark success-spark-4" />
    <img src="/brand/wizzy-mascot-dark.svg" alt="" />
    <span className="success-check"><CheckIcon /></span>
  </div>;
}

function MarketLedger({ markets, stats, state, zapMarketId, zapAmount, zapPlan, zapState, onOpenZap, onZapAmount, onPrepareZap, onExecuteZap, onCloseZap, balances, onFund }: {
  markets: MarketEntry[];
  stats: Map<string, MarketStats>;
  state: "loading" | "ready" | "error";
  zapMarketId: string | null;
  zapAmount: string;
  zapPlan: AllocationPlan | null;
  zapState: PlanState;
  onOpenZap: (marketId: string) => void;
  onZapAmount: (next: string) => void;
  onPrepareZap: (marketId: string) => void;
  onExecuteZap: () => void;
  onCloseZap: () => void;
  balances: ChainBalances | null;
  onFund: (chain: ChainSlug) => void;
}) {
  const [chainFilter, setChainFilter] = useState<"all" | ChainSlug>("robinhood");
  const [marketQuery, setMarketQuery] = useState("");
  const [marketPage, setMarketPage] = useState(1);
  const normalizedQuery = marketQuery.trim().toLocaleLowerCase();
  const filteredMarkets = markets.filter(({ market, chain }) => {
    if (chainFilter !== "all" && chain !== chainFilter) return false;
    if (!normalizedQuery) return true;
    return `${market.symbol} ${market.name}`.toLocaleLowerCase().includes(normalizedQuery);
  });
  const pageCount = Math.max(1, Math.ceil(filteredMarkets.length / MARKETS_PER_PAGE));
  const currentPage = Math.min(marketPage, pageCount);
  const pageStart = (currentPage - 1) * MARKETS_PER_PAGE;
  const visibleMarkets = filteredMarkets.slice(pageStart, pageStart + MARKETS_PER_PAGE);
  const selected = markets.find(({ market, chain }) => market.id === zapMarketId && (chain === "base" || chain === "robinhood"));

  useEffect(() => {
    if (!selected) return;
    const previousOverflow = document.body.style.overflow;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCloseZap();
    };
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [onCloseZap, selected]);

  return <>
    <section className="market-ledger">
      <div className="market-table-wrap">
        <div className="market-toolbar">
          <div className="market-filters" aria-label="Filter markets by chain">
            {(["all", "base", "robinhood"] as const).map((chain) => <button key={chain} type="button" className={chainFilter === chain ? "is-active" : ""} aria-pressed={chainFilter === chain} onClick={() => { setChainFilter(chain); setMarketPage(1); }}>{chain === "all" ? "All markets" : chainLabel(chain)}</button>)}
          </div>
          <label className="market-search"><SearchIcon /><input type="search" value={marketQuery} onChange={(event) => { setMarketQuery(event.target.value); setMarketPage(1); }} placeholder="Search markets" aria-label="Search markets" /></label>
        </div>
        <table className="market-table">
          <thead><tr><th>Market</th><th>24h fee APR</th><th>24h volume</th><th>Liquidity</th><th>Action</th></tr></thead>
          <tbody>
            {state === "loading" ? Array.from({ length: MARKET_SKELETON_COUNT }, (_, index) => <tr className="skeleton-row" key={index}><td colSpan={5}><i /></td></tr>) : null}
            {state === "error" ? <tr><td colSpan={5} className="table-message">Market data is temporarily unavailable.</td></tr> : null}
            {state === "ready" && !visibleMarkets.length ? <tr><td colSpan={5} className="table-message">No markets match that search.</td></tr> : null}
            {state === "ready" ? visibleMarkets.map(({ market, chain }) => {
              const row = stats.get(market.id);
              const zappable = chain === "base" || chain === "robinhood";
              return <tr key={market.id}>
                <td><span className="pair-cell"><TokenIcon symbol={market.symbol} src={row?.tokenImageUrl} color={market.color} /><span><b>{market.symbol}/WETH</b><VenueTrail chain={chain} protocol={market.protocol} /></span></span></td>
                <td><b className="fee-apr">{formatFeeApr(row?.trailingFeeAprPct ?? null)}</b></td>
                <td>{compactMoney(row?.volume24hUsd)}</td>
                <td>{compactMoney(row?.liquidityUsd)}</td>
                <td><span className="market-links">
                  {zappable ? <button className="market-link zap-link" type="button" aria-haspopup="dialog" onClick={() => onOpenZap(market.id)} aria-label={`Make the ${market.symbol}/WETH market`}><span className="market-link-label">Make market</span></button> : null}
                  {zappable ? <a className="market-link fomo-link" href={fomoTokenUrl(chain, market.token)} target="_blank" rel="noreferrer" aria-label={`Trade ${market.symbol}/WETH on Fomo`}><img src={BRAND_ASSETS.fomo} alt="" /><span className="market-link-label">Trade on Fomo</span></a> : null}
                </span></td>
              </tr>;
            }) : null}
          </tbody>
        </table>
        {state === "ready" && filteredMarkets.length ? <nav className="market-pagination" aria-label="Market pages">
          <span>{pageStart + 1}–{Math.min(pageStart + MARKETS_PER_PAGE, filteredMarkets.length)} of {filteredMarkets.length}</span>
          <div>
            <button type="button" disabled={currentPage === 1} onClick={() => setMarketPage(currentPage - 1)}>Previous</button>
            <span>Page {currentPage} of {pageCount}</span>
            <button type="button" disabled={currentPage === pageCount} onClick={() => setMarketPage(currentPage + 1)}>Next</button>
          </div>
        </nav> : null}
      </div>
    </section>
    {selected && typeof document !== "undefined" ? createPortal(
      <div className="zap-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onCloseZap(); }}>
        <section className="zap-dialog" role="dialog" aria-modal="true" aria-labelledby="zap-dialog-title">
          <header>
            <span><TokenIcon symbol={selected.market.symbol} src={stats.get(selected.market.id)?.tokenImageUrl} color={selected.market.color} /><span><b id="zap-dialog-title">{selected.market.symbol}/{selected.market.quoteSymbol}</b><small>{chainLabel(selected.chain)} · {zapPlan?.markets[0] ? `${allocationVenueLabel(zapPlan.markets[0])} · ${allocationRangeLabel(zapPlan.markets[0], selected.market)}` : "Best pool selected automatically"}</small></span></span>
            <button type="button" onClick={onCloseZap} aria-label="Close"><CloseIcon /></button>
          </header>
          <ZapPanel
            market={selected.market}
            chain={selected.chain as ChainSlug}
            amount={zapAmount}
            plan={zapPlan}
            state={zapState}
            onAmount={onZapAmount}
            onPrepare={() => onPrepareZap(selected.market.id)}
            onExecute={onExecuteZap}
            balance={balances?.[selected.chain as ChainSlug] ?? null}
            onFund={() => onFund(selected.chain as ChainSlug)}
          />
        </section>
      </div>,
      document.body,
    ) : null}
  </>;
}

function ZapPanel({ market, chain, amount, plan, state, onAmount, onPrepare, onExecute, balance, onFund }: {
  market: CuratedMarket;
  chain: ChainSlug;
  amount: string;
  plan: AllocationPlan | null;
  state: PlanState;
  onAmount: (next: string) => void;
  onPrepare: () => void;
  onExecute: () => void;
  balance: BalanceState | null;
  onFund: () => void;
}) {
  const planMarket = plan?.markets[0];
  const busy = state.kind === "signing" || state.kind === "waiting";
  const needsFunding = hasInsufficientBalance(amount, balance);
  return <div className="zap-panel" aria-label={`Make the ${market.symbol}/WETH market`}>
    <div className="zap-controls">
      <span className="zap-balance"><span>Amount</span>{balance ? <span className="zap-balance-meta"><small role="status">Balance <b>{balance.kind === "ready" && balance.balanceWei !== undefined ? formatWalletBalance(balance.balanceWei) : "—"} ETH</b></small>{needsFunding ? <button type="button" onClick={onFund}>Get {chainLabel(chain)} ETH</button> : null}</span> : null}</span>
      <label className="zap-amount">
        <input autoFocus type="text" inputMode="decimal" enterKeyHint="done" value={amount} placeholder="0.00" onChange={(event) => onAmount(event.target.value)} aria-label="ETH amount" />
        <b>ETH</b>
      </label>
      {plan && (state.kind === "ready" || busy) ? (
        <button className="fund-button zap-cta" type="button" disabled={busy} onClick={onExecute}>
          {busy ? state.message : "Add liquidity"}
        </button>
      ) : (
        <button className="fund-button zap-cta" type="button" disabled={state.kind === "planning"} onClick={onPrepare}>
          {state.kind === "planning" ? "Quoting…" : "Review"}
        </button>
      )}
    </div>
    {plan && planMarket ? <dl className="zap-preview">
      <div><dt>Pool</dt><dd>{allocationVenueLabel(planMarket)} · selected automatically</dd></div>
      <div><dt>You add</dt><dd>{formatWalletBalance(planMarket.mintQuote)} {planMarket.quoteSymbol} + {compactAmount(planMarket.mintMeme, 18)} {market.symbol}</dd></div>
      <div><dt>Wizzy fee</dt><dd>None</dd></div>
    </dl> : null}
    {state.kind === "submitted" || state.kind === "error" ? <p className={`funding-status is-${state.kind === "submitted" ? "submitted" : "error"}`} aria-live="polite">{state.message}</p> : null}
  </div>;
}

function PositionLedger({ authenticated, positions, state, markets, stats, onStart, onRetry, onAction, actionPlan, actionState, onExecute, onCancel, balances, onFund }: {
  authenticated: boolean;
  positions: PositionView[];
  state: "idle" | "loading" | "ready" | "error";
  markets: MarketEntry[];
  stats: Map<string, MarketStats>;
  onStart: () => void;
  onRetry: () => void;
  onAction: (position: PositionView, action: PositionActionKind, rangePreset?: RangePreset, amount?: string) => void;
  actionPlan: AnyPositionActionPlan | null;
  actionState: PlanState;
  onExecute: () => void;
  onCancel: () => void;
  balances: ChainBalances | null;
  onFund: (chain: ChainSlug) => void;
}) {
  const [managedKey, setManagedKey] = useState<string | null>(null);
  const showPositions = authenticated && positions.length > 0;
  const managedPosition = managedKey ? positions.find((position) => positionKey(position) === managedKey) ?? null : null;
  const settlement = actionPlan?.settlement;
  const actionBusy = actionState.kind === "planning" || actionState.kind === "signing" || actionState.kind === "waiting";

  return (
    <section className={`position-ledger ${authenticated ? "" : "is-disconnected"}`} id="positions">
      {actionState.kind !== "idle" && !managedPosition ? <PositionActionReview plan={actionPlan} state={actionState} settlement={settlement} onExecute={onExecute} onCancel={onCancel} /> : null}
      {!authenticated ? <PortfolioEmpty variant="disconnected" onPrimary={onStart} /> : null}
      {authenticated && (state === "idle" || state === "loading") ? <PortfolioEmpty variant="loading" /> : null}
      {authenticated && state === "error" ? <PortfolioEmpty variant="error" onPrimary={onRetry} /> : null}
      {authenticated && state === "ready" && positions.length === 0 ? <PortfolioEmpty variant="empty" onPrimary={onStart} /> : null}
      {showPositions ? <div className="position-list">{positions.map((position) => {
        const key = positionKey(position);
        const expanded = managedKey === key;
        const managerId = `position-manager-${position.chain}-${position.tokenId}`;
        return <div className={`position-list-item ${expanded ? "is-expanded" : ""}`} key={key}>
          <article>
            <span className="position-pair"><TokenIcon symbol={position.symbol0} src={positionTokenImage(position, markets, stats)} /><span><b>{position.pair}</b><small>{position.chainLabel} · {positionVenueLabel(position)}</small></span></span>
            <span><small>Position value</small><b>{positionValueLabel(position)}</b></span>
            <span><small>Ready to collect</small><b>{positionFeesLabel(position)}</b></span>
            <PositionRangeStatus position={position} />
            <button className="position-manage" type="button" aria-expanded={expanded} aria-controls={managerId} disabled={actionBusy} onClick={() => { onCancel(); setManagedKey(expanded ? null : key); }}>{expanded ? "Done" : "Manage"}</button>
          </article>
          {expanded ? <PositionManager
            id={managerId}
            position={position}
            actionPlan={actionPlan}
            actionState={actionState}
            onAction={onAction}
            onExecute={onExecute}
            onCancel={onCancel}
            balance={position.chain === "base" || position.chain === "robinhood" ? balances?.[position.chain] ?? null : null}
            onFund={onFund}
          /> : null}
        </div>;
      })}</div> : null}
    </section>
  );
}

function PositionActionReview({ plan, state, settlement, onExecute, onCancel }: {
  plan: AnyPositionActionPlan | null;
  state: PlanState;
  settlement: PositionActionPlan["settlement"] | undefined;
  onExecute: () => void;
  onCancel: () => void;
}) {
  const busy = state.kind === "planning" || state.kind === "signing" || state.kind === "waiting";
  return <section className={`action-preview is-${state.kind}`} aria-live="polite">
    {state.kind === "submitted" ? <SuccessCelebration label={positionActionSuccessLabel(plan)} /> : null}
    <div className="action-copy"><b>{positionActionTitle(plan, state)}</b><p>{positionActionDescription(plan, state, settlement)}</p></div>
    {plan && state.kind === "ready" ? <span>No Wizzy fee</span> : null}
    <div className="action-buttons">{state.kind === "ready" ? <button className="small-primary" type="button" onClick={onExecute}>{positionActionButtonLabel(plan)}</button> : null}<button type="button" onClick={onCancel} disabled={busy}>Close</button></div>
  </section>;
}

function PositionManager({ id, position, actionPlan, actionState, onAction, onExecute, onCancel, balance, onFund }: {
  id: string;
  position: PositionView;
  actionPlan: AnyPositionActionPlan | null;
  actionState: PlanState;
  onAction: (position: PositionView, action: PositionActionKind, rangePreset?: RangePreset, amount?: string) => void;
  onExecute: () => void;
  onCancel: () => void;
  balance: BalanceState | null;
  onFund: (chain: ChainSlug) => void;
}) {
  const [rangePreset, setRangePreset] = useState<RangePreset>("balanced");
  const [moreOpen, setMoreOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [addAmount, setAddAmount] = useState("0.05");
  const canCollect = position.protocol !== "V2" && hasCollectibleFees(position) && !position.closed;
  const canAdjustRange = (position.protocol === "V3" || position.protocol === "V4") && position.chain !== "solana" && !position.closed;
  const fundingChain: ChainSlug | null = position.chain === "base" || position.chain === "robinhood" ? position.chain : null;
  const canAdd = fundingChain !== null && !position.closed && (position.protocol === "V2" || position.inRange);
  const actionBusy = actionState.kind === "planning" || actionState.kind === "signing" || actionState.kind === "waiting";
  const addAmountValid = isPositiveEthAmount(addAmount);
  const addNeedsFunding = hasInsufficientBalance(addAmount, balance);
  const { share0, share1 } = compositionShares(position);
  const plannedRange = actionPlan?.kind === "rebalance" ? actionPlan.range : undefined;
  const rangePreview = useMemo(() => {
    if (!canAdjustRange) return null;
    try {
      if (plannedRange) {
        return positionRangePreviewForTicks(position, plannedRange.tickLower, plannedRange.tickUpper, plannedRange.currentTick);
      }
      return positionRangePreview(position, rangePreset);
    } catch {
      return null;
    }
  }, [canAdjustRange, plannedRange, position, rangePreset]);
  useEffect(() => {
    setRangePreset("balanced");
    setMoreOpen(false);
    setAddOpen(false);
    setAddAmount("0.05");
  }, [position.chain, position.positionManager, position.protocol, position.tokenId]);
  useEffect(() => {
    if (actionPlan?.kind === "increase" && actionState.kind === "submitted") setAddOpen(false);
  }, [actionPlan?.kind, actionState.kind]);
  return <section className="position-manager" id={id} aria-label={`Manage ${position.pair}`}>
      <div className="position-manager-scroll">
        {rangePreview ? <PositionRangePlanner position={position} preset={rangePreset} preview={rangePreview} previousTickLower={plannedRange?.previousTickLower ?? position.tickLower} previousTickUpper={plannedRange?.previousTickUpper ?? position.tickUpper} disabled={actionBusy} onPreset={(next) => { if (next === rangePreset) return; onCancel(); setRangePreset(next); }} /> : <PositionRangeChart position={position} />}
        <dl className="position-manager-stats" aria-label="Position performance">
          <div><dt>Fees ready</dt><dd className={hasCollectibleFees(position) ? "positive" : ""}>{positionFeesLabel(position)}</dd></div>
          <div><dt>Position fee APR</dt><dd>{formatFeeAprFraction(position.feeApr ?? null)}</dd></div>
        </dl>
        <section className="position-composition" aria-label="Position composition">
          <header><b>Position</b><small>Current token mix</small></header>
          <span className="composition-track" aria-hidden="true"><i style={{ width: `${share0}%` }} /><i style={{ width: `${share1}%` }} /></span>
          <dl><div><dt>{position.symbol0}</dt><dd>{position.amount0}</dd></div><div><dt>{position.symbol1}</dt><dd>{position.amount1}</dd></div></dl>
        </section>
        {actionState.kind !== "idle" ? <PositionActionReview plan={actionPlan} state={actionState} settlement={actionPlan?.settlement} onExecute={onExecute} onCancel={onCancel} /> : null}
      </div>
      {actionState.kind === "idle" ? <footer className={`position-manager-actions ${addOpen ? "is-adding" : ""}`}>
        {addOpen ? <div className="position-add-liquidity">
          <header><small>Manage position</small><b>Add liquidity</b><span>{balance?.kind === "ready" && balance.balanceWei !== undefined ? `${formatWalletBalance(balance.balanceWei)} ETH available` : fundingChain ? `Uses ${chainLabel(fundingChain)} ETH` : "ETH balance unavailable"}</span></header>
          <label className="position-add-amount">
            <input autoFocus type="text" inputMode="decimal" enterKeyHint="done" name="position-add-amount" value={addAmount} onChange={(event) => setAddAmount(event.target.value)} aria-label="ETH to add" />
            <b>ETH</b>
          </label>
          {addNeedsFunding && fundingChain ? <button className="position-add-fund" type="button" onClick={() => onFund(fundingChain)}>Get {chainLabel(fundingChain)} ETH</button> : null}
          <div><button className="position-primary-action" type="button" disabled={!addAmountValid || addNeedsFunding} onClick={() => onAction(position, "increase", undefined, addAmount)}>Review</button><button type="button" onClick={() => setAddOpen(false)}>Cancel</button></div>
        </div> : <>
          {position.protocol === "V2" ? <p><b>Full range by design.</b> V2 fees stay invested in the LP token automatically.</p> : null}
          {canAdd ? <button className="position-primary-action" type="button" onClick={() => setAddOpen(true)} disabled={actionBusy}>Add to this position</button> : null}
          {!canAdd && canAdjustRange && rangePreview ? <button className="position-primary-action" type="button" onClick={() => onAction(position, "rebalance", rangePreset)} disabled={actionBusy}>Rebalance range</button> : null}
          {!canAdjustRange && !canAdd && !position.closed ? <button className="position-primary-action position-withdraw-action" type="button" onClick={() => onAction(position, "withdraw")}>{positionSettlesToEth(position) ? "Withdraw to ETH" : "Withdraw"}</button> : null}
          {canAdjustRange ? <div className={`position-secondary-actions ${moreOpen ? "is-open" : ""}`} id="position-more-actions">
            {canAdd && rangePreview ? <button type="button" onClick={() => onAction(position, "rebalance", rangePreset)} disabled={actionBusy}>Adjust range</button> : null}
            {canCollect ? <button type="button" onClick={() => onAction(position, "collect")} disabled={actionBusy}>Collect fees</button> : null}
            {position.protocol !== "V2" && !position.closed ? <button type="button" onClick={() => onAction(position, "compound")} disabled={!hasCollectibleFees(position) || actionBusy} title="Collect and reinvest claimable fees into this position">Reinvest fees</button> : null}
            <button className="position-withdraw-action" type="button" onClick={() => onAction(position, "withdraw")} disabled={position.closed || actionBusy}>{positionSettlesToEth(position) ? "Withdraw to ETH" : "Withdraw"}</button>
          </div> : null}
          {!canAdjustRange && canAdd ? <button className="position-withdraw-action" type="button" onClick={() => onAction(position, "withdraw")} disabled={actionBusy}>{positionSettlesToEth(position) ? "Withdraw to ETH" : "Withdraw"}</button> : null}
          {canAdjustRange ? <button className="position-more-action" type="button" aria-expanded={moreOpen} aria-controls="position-more-actions" onClick={() => setMoreOpen((open) => !open)} disabled={actionBusy}>{moreOpen ? "Less" : "More"}</button> : null}
        </>}
      </footer> : null}
  </section>;
}

function PositionRangePlanner({ position, preset, preview, previousTickLower, previousTickUpper, disabled, onPreset }: {
  position: PositionView;
  preset: RangePreset;
  preview: ReturnType<typeof positionRangePreview>;
  previousTickLower: number;
  previousTickUpper: number;
  disabled: boolean;
  onPreset: (preset: RangePreset) => void;
}) {
  const ticks = [previousTickLower, previousTickUpper, preview.currentTick, preview.tickLower, preview.tickUpper];
  const rawSpan = Math.max(...ticks) - Math.min(...ticks);
  const padding = Math.max(1, rawSpan * 0.16);
  const domainMin = Math.min(...ticks) - padding;
  const domainMax = Math.max(...ticks) + padding;
  const at = (tick: number) => Math.max(0, Math.min(100, ((tick - domainMin) / (domainMax - domainMin)) * 100));
  const styles = {
    "--old-range-start": `${at(previousTickLower)}%`,
    "--old-range-width": `${at(previousTickUpper) - at(previousTickLower)}%`,
    "--new-range-start": `${at(preview.tickLower)}%`,
    "--new-range-width": `${at(preview.tickUpper) - at(preview.tickLower)}%`,
    "--range-position": `${at(preview.currentTick)}%`,
  } as CSSProperties;
  const choices: Array<{ id: RangePreset; label: string; detail: string }> = [
    { id: "focused", label: "Focused", detail: "Tighter band" },
    { id: "balanced", label: "Balanced", detail: "Current width" },
    { id: "wide", label: "Wide", detail: "More price room" },
  ];
  return <section className="position-range-planner" aria-label="Adjust position price range">
    <header><div><b>Price range</b><small>Choose how tightly liquidity follows the market.</small></div><div className="range-chart-price"><small>Current</small><strong>{priceLabel(preview.currentPrice)}</strong></div></header>
    <div className="range-preset-options" role="group" aria-label="Range width">
      {choices.map((choice) => <button key={choice.id} type="button" className={preset === choice.id ? "is-active" : ""} aria-pressed={preset === choice.id} disabled={disabled} onClick={() => onPreset(choice.id)}><b>{choice.label}</b><small>{choice.detail}</small></button>)}
    </div>
    <div className="range-compare" style={styles} aria-label={`Current ticks ${previousTickLower} to ${previousTickUpper}. New ticks ${preview.tickLower} to ${preview.tickUpper}.`}>
      <LiquidityBars profile={position.liquidityProfile} domainMin={domainMin} domainMax={domainMax} />
      <span className="range-compare-axis" aria-hidden="true" />
      <span className="range-compare-window is-current" aria-hidden="true" />
      <span className="range-compare-window is-new" aria-hidden="true" />
      <span className="range-compare-price" aria-hidden="true"><i /></span>
    </div>
    <div className="range-compare-legend"><span><i className="is-current" />Current</span><span><i className="is-new" />New</span>{position.liquidityProfile ? <span><i className="is-liquidity" />Live pool liquidity</span> : null}</div>
    <dl className="range-preview-values"><div><dt>Min · current → new</dt><dd>{priceLabel(position.price * Math.pow(1.0001, previousTickLower - position.tickCurrent))} <i>→</i> {priceLabel(preview.priceMin)}</dd></div><div><dt>Max · current → new</dt><dd>{priceLabel(position.price * Math.pow(1.0001, previousTickUpper - position.tickCurrent))} <i>→</i> {priceLabel(preview.priceMax)}</dd></div></dl>
    <p className="range-preview-ticks">Ticks {previousTickLower}–{previousTickUpper} → {preview.tickLower}–{preview.tickUpper}</p>
  </section>;
}

function LiquidityBars({ profile, domainMin, domainMax }: {
  profile: PositionView["liquidityProfile"];
  domainMin: number;
  domainMax: number;
}) {
  if (!profile || domainMax <= domainMin) return null;
  const span = domainMax - domainMin;
  const visible = profile.bins.filter((bin) => bin.tickUpper > domainMin && bin.tickLower < domainMax);
  if (!visible.length) return null;
  return <span className="liquidity-profile" aria-hidden="true">
    {visible.map((bin) => {
      const lower = Math.max(domainMin, bin.tickLower);
      const upper = Math.min(domainMax, bin.tickUpper);
      return <i key={`${bin.tickLower}:${bin.tickUpper}`} style={{
        left: `${((lower - domainMin) / span) * 100}%`,
        width: `${Math.max(0.35, ((upper - lower) / span) * 100)}%`,
        height: `${Math.max(3, bin.height * 88)}%`,
      }} />;
    })}
  </span>;
}

function PositionRangeChart({ position }: { position: PositionView }) {
  const geometry = positionRangeGeometry(position);
  const status = position.status === "in-range" ? "In range" : position.status === "oor" ? "Out of range" : "Closed";
  const narrative = position.fullRange
    ? "Active at every price"
    : position.closed
      ? "This position is closed"
      : geometry.currentState === "inside"
        ? `${Math.round(position.percentThroughRange)}% through your range`
        : `Price is ${geometry.currentState} your range`;
  return <section
    className={`position-range-chart is-${position.status} ${position.fullRange ? "is-full-range" : ""}`}
    style={{
      "--range-start": `${geometry.rangeStartPct}%`,
      "--range-end": `${geometry.rangeEndPct}%`,
      "--range-width": `${geometry.rangeEndPct - geometry.rangeStartPct}%`,
      "--range-position": `${geometry.currentPct}%`,
    } as CSSProperties}
    aria-label={`${status}. Current price ${priceLabel(position.price)}. ${narrative}.`}
  >
    <header><div><b>{position.fullRange ? "Full range" : "Price range"}</b><small>{narrative}</small></div><div className="range-chart-price"><small>Current</small><strong>{priceLabel(position.price)}</strong></div></header>
    <div className="range-chart-canvas" aria-hidden="true">
      <span className="range-chart-axis" />
      <span className="range-chart-window" />
      <span className="range-chart-bound is-start" />
      <span className="range-chart-bound is-end" />
      <span className="range-chart-current"><i /></span>
    </div>
    <footer aria-hidden="true">
      <span className="range-chart-bound-label is-start"><small>Min</small><b>{position.fullRange ? "0" : priceLabel(position.priceMin)}</b></span>
      <span className="range-chart-bound-label is-end"><small>Max</small><b>{position.fullRange ? "∞" : priceLabel(position.priceMax, position.priceMax === null)}</b></span>
    </footer>
  </section>;
}

function PositionRangeStatus({ position }: { position: PositionView }) {
  const label = position.status === "in-range" ? "In range" : position.status === "oor" ? "Out of range" : "Closed";
  return <span className={`position-range-status is-${position.status}`}><i />{position.fullRange ? "Full range" : label}</span>;
}

function positionKey(position: PositionView): string {
  return `${position.chain}-${position.protocol}-${position.positionManager ?? "default"}-${position.tokenId}`;
}

function hasCollectibleFees(position: PositionView): boolean {
  if ((position.feesUsd ?? 0) > 0) return true;
  return [position.uncollected0, position.uncollected1].some((amount) => Number(amount.replaceAll(",", "")) > 0);
}

function positionSettlesToEth(position: PositionView): boolean {
  return position.chain === "robinhood" && position.protocol === "V3" && position.venue !== "aerodrome-slipstream";
}

function positionTokenImage(position: PositionView, markets: MarketEntry[], stats: Map<string, MarketStats>): string | null | undefined {
  if (position.marketId) {
    const direct = stats.get(position.marketId)?.tokenImageUrl;
    if (direct) return direct;
  }
  const market = markets.find(({ market }) =>
    (position.pool && "pool" in market && market.pool.toLowerCase() === position.pool.toLowerCase())
    || market.symbol.toLowerCase() === position.symbol0.toLowerCase(),
  )?.market;
  if (!market) return undefined;
  return stats.get(market.id)?.tokenImageUrl ?? ("imageUrl" in market ? market.imageUrl : undefined);
}

function positionVenueLabel(position: PositionView): string {
  if (position.venue === "aerodrome-slipstream") return "Aerodrome Slipstream";
  if (position.protocol === "V2") return "Uniswap V2";
  if (position.protocol === "V3") return "Uniswap V3";
  if (position.protocol === "V4") return "Uniswap V4";
  return position.venueLabel ?? position.protocol;
}

function allocationVenueLabel(market: AllocationPlan["markets"][number]): string {
  if (market.venue === "aerodrome-slipstream") return "Aerodrome Slipstream";
  if (market.protocol === "V2") return "Uniswap V2";
  if (market.protocol === "V4") return "Uniswap V4";
  return "Uniswap V3";
}

function allocationRangeLabel(market: AllocationPlan["markets"][number], catalogMarket: CuratedMarket): string {
  return market.protocol === "V2" ? "full range" : `±${catalogMarket.rangeWidthPct.toFixed(0)}% range`;
}

function positionActionTitle(plan: AnyPositionActionPlan | null, state: PlanState): string {
  if (!plan) return "Preparing your position";
  if (state.kind === "submitted") {
    if (plan.kind === "withdraw") return plan.settlement?.asset === "ETH" ? `${plan.pair} withdrawn to ETH` : `${plan.pair} withdrawn`;
    if (plan.kind === "rebalance") return `${plan.pair} rebalanced`;
    if (plan.kind === "increase") return `Liquidity added to ${plan.pair}`;
    if (plan.kind === "collect") return `${plan.pair} fees collected`;
    return `${plan.pair} fees reinvested`;
  }
  if (plan.kind === "withdraw") return plan.settlement?.asset === "ETH" ? `Withdraw ${plan.pair} to ETH` : `Withdraw ${plan.pair}`;
  if (plan.kind === "rebalance") return `Rebalance ${plan.pair}`;
  if (plan.kind === "increase") return `Add liquidity to ${plan.pair}`;
  if (plan.kind === "collect") return `Collect ${plan.pair} fees`;
  return `Reinvest ${plan.pair} fees`;
}

function positionActionButtonLabel(plan: AnyPositionActionPlan | null): string {
  if (plan?.kind === "withdraw") return plan.settlement?.asset === "ETH" ? "Withdraw to ETH" : "Withdraw";
  if (plan?.kind === "rebalance") return "Rebalance";
  if (plan?.kind === "increase") return "Add liquidity";
  if (plan?.kind === "collect") return "Collect fees";
  return "Reinvest fees";
}

function positionActionSuccessLabel(plan: AnyPositionActionPlan | null): string {
  if (plan?.kind === "withdraw") return plan.settlement?.asset === "ETH" ? "ETH returned" : "Position withdrawn";
  if (plan?.kind === "rebalance") return "Position rebalanced";
  if (plan?.kind === "increase") return "Liquidity added";
  if (plan?.kind === "collect") return "Fees collected";
  return "Fees reinvested";
}

function positionActionSuccessMessage(plan: AnyPositionActionPlan, settlesToEth: boolean): string {
  if (plan.kind === "withdraw") return settlesToEth ? "Your ETH is back in your wallet." : "Your pool tokens are back in your wallet.";
  if (plan.kind === "rebalance") return "Your position is earning in its new range.";
  if (plan.kind === "increase") return "Your added liquidity is now in this position.";
  if (plan.kind === "collect") return "Your fees are in your wallet.";
  return "Your fees are back at work.";
}

function positionActionDescription(
  plan: AnyPositionActionPlan | null,
  state: PlanState,
  settlement: PositionActionPlan["settlement"] | undefined,
): string {
  if (!plan || state.kind !== "ready") return state.message ?? "";
  if (plan.kind === "withdraw" && settlement?.asset === "ETH") {
    return `Close this position and return at least ${trimEth(BigInt(settlement.minimumAmountWei))} ETH to your wallet.`;
  }
  if (plan.kind === "withdraw") return "Close this position and return both pool tokens to your wallet.";
  if (plan.kind === "rebalance" && plan.range) {
    return `Move liquidity from ticks ${plan.range.previousTickLower}–${plan.range.previousTickUpper} to the ${plan.range.preset} range ${plan.range.tickLower}–${plan.range.tickUpper}.`;
  }
  if (plan.kind === "rebalance") return "Move this liquidity into a new range around the current price.";
  if (plan.kind === "increase" && plan.funding) {
    return `Add ${trimEth(BigInt(plan.funding.amountWei))} ETH to this exact position without changing its range. Wizzy does not charge for this action.`;
  }
  if (plan.kind === "collect") return "Return all claimable fees to your wallet without changing the position.";
  return "Collect and reinvest the fees ready to claim.";
}

function PortfolioEmpty({ variant, onPrimary }: {
  variant: "disconnected" | "loading" | "error" | "empty";
  onPrimary?: () => void;
}) {
  const content = variant === "disconnected"
    ? { title: "See your positions", body: "Connect to view value, fees, ranges, and available actions.", action: "Connect wallet" }
    : variant === "error"
      ? { title: "Positions unavailable", body: "We could not read this wallet. Try again.", action: "Try again" }
    : variant === "empty"
        ? { title: "No positions yet", body: "Choose a reviewed market and add liquidity in a few taps.", action: "Make market" }
        : { title: "Reading positions", body: "Checking Base and Robinhood.", action: "" };
  return <section className={`portfolio-empty is-${variant}`} aria-live={variant === "loading" ? "polite" : undefined}>
    <span className="empty-symbol">{variant === "empty" ? <img src="/brand/wizzy-mascot-32.png" alt="" /> : <WalletIcon />}</span>
    <div className="empty-copy">
      <h3>{content.title}</h3>
      <p>{content.body}</p>
    </div>
    {onPrimary && content.action ? <button className="empty-action" type="button" onClick={onPrimary}>{content.action}</button> : null}
  </section>;
}

function chainLabel(chain: MarketChain): string {
  if (chain === "base") return "Base";
  if (chain === "robinhood") return "Robinhood";
  return "Solana";
}

function money(value: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(value);
}

function positionValueLabel(position: PositionView): string {
  const usdValue = positionValueUsd(position);
  if (usdValue !== undefined && usdValue > 0) return money(usdValue);
  const eth = positionValueEth(position);
  return eth === undefined ? "—" : ethValue(eth);
}

function positionFeesLabel(position: PositionView): string {
  if (position.feesUsd !== undefined && position.feesUsd > 0) return money(position.feesUsd);
  const eth = positionFeesEth(position);
  return eth === undefined ? "—" : ethValue(eth);
}

function ethValue(value: number): string {
  return `${new Intl.NumberFormat("en-US", { maximumFractionDigits: 6 }).format(value)} ETH`;
}

function compactMoney(value?: number | null): string {
  if (value == null) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", notation: "compact", maximumFractionDigits: 1 }).format(value);
}

function hasInsufficientBalance(amount: string, balance: BalanceState | null): boolean {
  if (balance?.kind !== "ready" || balance.balanceWei === undefined) return false;
  try {
    return parseEther(amount || "0") > BigInt(balance.balanceWei);
  } catch {
    return false;
  }
}

function isPositiveEthAmount(amount: string): boolean {
  try {
    return parseEther(amount || "0") > 0n;
  } catch {
    return false;
  }
}

function formatFeeApr(value?: number | null): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${value.toFixed(value >= 100 ? 0 : 1)}%`;
}

function formatFeeAprFraction(value?: number | null): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return formatFeeApr(value * 100);
}

function trimEth(value: bigint): string {
  const formatted = formatEther(value);
  const [whole, fraction = ""] = formatted.split(".");
  return fraction ? `${whole}.${fraction.slice(0, 6).replace(/0+$/, "") || "0"}` : whole!;
}

function compactAmount(rawUnits: string, decimals: number): string {
  const value = Number(rawUnits) / 10 ** decimals;
  if (!Number.isFinite(value)) return "0";
  return new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

function formatWalletBalance(balanceWei: string): string {
  const value = Number(formatEther(BigInt(balanceWei)));
  if (value === 0) return "0";
  if (value < 0.0001) return "<0.0001";
  return new Intl.NumberFormat("en-GB", { maximumFractionDigits: value < 1 ? 4 : 3 }).format(value);
}

function sameAddress(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

function short(value: string): string {
  return value.startsWith("0x") && value.length > 12 ? `${value.slice(0, 6)}…${value.slice(-4)}` : value;
}

function capitalize(value: string): string {
  return `${value.slice(0, 1).toUpperCase()}${value.slice(1)}`;
}

function ThemeIcon({ preference }: { preference: ThemePreference }) {
  if (preference === "light") return <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3.5" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></svg>;
  if (preference === "dark") return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 15.2A8.5 8.5 0 0 1 8.8 4 8.5 8.5 0 1 0 20 15.2Z" /></svg>;
  return <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="13" rx="2.5" /><path d="M8 21h8M12 17v4M12 4v13" /></svg>;
}

function TokenIcon({ symbol, src, color }: { symbol: string; src?: string | null; color?: string }) {
  return <span className="token-icon" style={{ backgroundColor: color ?? "var(--surface-3)" }} aria-hidden="true">
    {src ? <img src={src} alt="" /> : <b>{symbol.slice(0, 1)}</b>}
  </span>;
}

function BrandLogo({ brand, label, compact = false }: { brand: keyof typeof BRAND_ASSETS; label: string; compact?: boolean }) {
  return <span className={`brand-logo is-${brand} ${compact ? "is-compact" : ""}`}>
    <img src={BRAND_ASSETS[brand]} alt="" aria-hidden="true" />
    {compact ? null : <span>{label}</span>}
  </span>;
}

function fomoTokenUrl(chain: MarketChain, token: string): string {
  return `https://fomo.family/tokens/${chain}/${token.toLowerCase()}?r=${FOMO_REFERRER}`;
}

function VenueTrail({ chain, protocol }: { chain: MarketChain; protocol: CuratedMarket["protocol"] }) {
  return <span className="venue-trail">
    <BrandLogo brand={chain} label={chainLabel(chain)} compact />
    <span>{chainLabel(chain)}</span><i>{protocol === "AERODROME_SLIPSTREAM" ? "Aerodrome Slipstream" : "Uniswap v3"}</i>
  </span>;
}

function WalletIcon() { return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7.5A2.5 2.5 0 0 1 6.5 5H18v3H6.5a1.5 1.5 0 0 0 0 3H20v8H6a2 2 0 0 1-2-2V7.5Z"/><circle cx="16.5" cy="15" r="1.25"/></svg>; }
function SearchIcon() { return <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="5.5" /><path d="m15 15 4 4" /></svg>; }
function ChevronIcon() { return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 9 5 5 5-5" /></svg>; }
function ExternalLinkIcon() { return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 5h5v5M19 5l-8 8M17 13v5a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1h5" /></svg>; }
function CloseIcon() { return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 7 10 10M17 7 7 17" /></svg>; }
function SendIcon() { return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 14-7-5 14-2.5-5.5L5 12Z" /><path d="m11.5 13.5 3-3" /></svg>; }
function DisconnectIcon() { return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5H6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h3M14 8l4 4-4 4M18 12H9" /></svg>; }
function CheckIcon() { return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 12.5 4 4 8-9" /></svg>; }
function XIcon() { return <svg className="x-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231Zm-1.161 17.52h1.833L7.084 4.126H5.117Z" /></svg>; }
