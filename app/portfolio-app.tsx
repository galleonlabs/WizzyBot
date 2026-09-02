"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { useAccount, useConfig, useConnect, useDisconnect, type Connector } from "wagmi";
import { createPortal } from "react-dom";
import { parseEther } from "viem";
import { lightRowToView, type PositionView } from "./lib/cards";
import { readJsonPayload } from "./lib/api-payload";
import { loadPositionRows } from "./lib/position-loading";
import { type ChainSlug } from "./lib/chains";
import {
  type AllocationPlan,
  type MarketsPayload,
  type MarketStats,
  type PositionActionKind,
  type PositionActionPlan,
} from "./lib/portfolio-types";
import { impliedEthUsd, summarizePositions } from "./lib/position-math";
import { money, capitalize, short } from "./lib/format";
import { isShotQuery, SHOT_VIEWS } from "./lib/shot-fixture";
import { sendPlanTransactions, type PlanSubmission, type WalletTransaction } from "./lib/wallet-calls";
import { reportClientError, trackProductEvent } from "./lib/telemetry-client";
import { AchievementCenter } from "./achievement-center";
import { SendEthDialog } from "./send-eth-dialog";
import type { AchievementActionEvidence } from "./lib/achievements";
import { ActionSheet, type ActionRequest, type BalanceState, type PlanState } from "./positions/action-sheet";
import { PositionCard, positionKey } from "./positions/position-card";
import { MarketLedger, type MarketEntry } from "./markets/market-ledger";
import { BRAND_ASSETS, ChevronIcon, DisconnectIcon, ExternalLinkIcon, SendIcon, ThemeIcon, WalletIcon, XIcon } from "./ui/icons";

type ViewTab = "positions" | "markets";
type ThemePreference = "system" | "light" | "dark";
type ChainBalances = Record<ChainSlug, BalanceState>;
type ChainLoadState = Record<ChainSlug, "idle" | "loading" | "ready" | "error">;
type SheetTarget = { position: PositionView; action: PositionActionKind };

const BRIDGE_URLS: Record<ChainSlug, string> = {
  base: "https://relay.link/bridge/base",
  robinhood: "https://relay.link/bridge/robinhood",
};
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
const IDLE_CHAINS: ChainLoadState = { base: "idle", robinhood: "idle" };

export function PortfolioApp() {
  const wagmiConfig = useConfig();
  const { address, status: accountStatus } = useAccount();
  const { connect, connectors, error: connectError, isPending: connectPending, reset: resetConnect } = useConnect();
  const { disconnect } = useDisconnect();
  const ready = accountStatus !== "reconnecting";
  const authenticated = accountStatus === "connected";
  const [tab, setTab] = useState<ViewTab>("positions");
  const [theme, setTheme] = useState<ThemePreference>("dark");
  const [balances, setBalances] = useState<ChainBalances>(EMPTY_BALANCES);
  const [markets, setMarkets] = useState<MarketsPayload>(EMPTY_MARKETS);
  const [marketsState, setMarketsState] = useState<"loading" | "ready" | "error">("loading");
  const [positions, setPositions] = useState<PositionView[]>([]);
  const [chainState, setChainState] = useState<ChainLoadState>(IDLE_CHAINS);
  const [ethUsdByChain, setEthUsdByChain] = useState<Partial<Record<ChainSlug, number>>>({});
  const [previewMode, setPreviewMode] = useState(false);
  const [sheet, setSheet] = useState<SheetTarget | null>(null);
  const [actionPlan, setActionPlan] = useState<PositionActionPlan | null>(null);
  const [actionState, setActionState] = useState<PlanState>({ kind: "idle" });
  const [zapMarketId, setZapMarketId] = useState<string | null>(null);
  const [zapAmount, setZapAmount] = useState("0.05");
  const [zapPlan, setZapPlan] = useState<AllocationPlan | null>(null);
  const [zapState, setZapState] = useState<PlanState>({ kind: "idle" });
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
    if (params.get("view") === "markets") setTab("markets");
    if (isShotQuery()) {
      setPreviewMode(true);
      setPositions(SHOT_VIEWS);
      setChainState({ base: "ready", robinhood: "ready" });
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
    setSheet(null);
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
  const impliedEth = useMemo(() => impliedEthUsd(positions), [positions]);
  const ethUsdFor = useCallback((chain?: string) => (chain === "base" || chain === "robinhood" ? ethUsdByChain[chain] : undefined) ?? ethUsdByChain.base ?? ethUsdByChain.robinhood ?? impliedEth, [ethUsdByChain, impliedEth]);

  function changeTab(next: ViewTab) {
    if (next === tab) return;
    setTab(next);
    const url = new URL(window.location.href);
    if (next === "positions") url.searchParams.delete("view");
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

  function startLogin(source: "header" | "positions" | "markets") {
    trackProductEvent("Login Started", { source });
    resetConnect();
    setConnectOpen(true);
  }

  function fundChain(chain: ChainSlug) {
    if (!authenticated || !address) {
      startLogin("positions");
      return;
    }
    const destinationChainId = chain === "robinhood" ? 4663 : 8453;
    trackProductEvent("Cross-chain Funding Started", { destinationChainId });
    window.open(`${BRIDGE_URLS[chain]}?toAddress=${address}`, "_blank", "noopener,noreferrer");
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
        amountWei: request.amountWei,
        percent: request.percent,
        tickLower: request.tickLower,
        tickUpper: request.tickUpper,
        settle: request.settle,
        protocol: position.protocol === "V2" || position.protocol === "V3" || position.protocol === "V4" ? position.protocol : undefined,
        venue: position.venue === "aerodrome-slipstream" || position.venue === "uniswap-v3" ? position.venue : undefined,
        positionManager: position.positionManager,
      }),
    });
    const payload = await readJsonPayload(response) as { plan?: PositionActionPlan; error?: string };
    if (!response.ok || !payload.plan) throw new Error(payload.error ?? `Could not prepare ${request.action}`);
    return payload.plan;
  }

  function openSheet(position: PositionView, action: PositionActionKind) {
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
    if (!sameAddress(actionPlan.owner, address)) {
      setActionPlan(null);
      setActionState({ kind: "error", message: "Your wallet changed. Review this action again." });
      return;
    }
    try {
      setActionState({ kind: "signing", message: "Refreshing the quote…" });
      const freshPlan = await requestPositionActionPlan(target.position, request);
      setActionPlan(freshPlan);
      setActionState({ kind: "signing", message: "Confirm in your wallet" });
      const confirmedEvm = await sendEvmBatch({
        owner: freshPlan.owner,
        chainId: freshPlan.chainId,
        transactions: freshPlan.transactions,
        onStep: (message) => setActionState({ kind: "waiting", message }),
      });
      await Promise.all([loadPositions(), loadBalances()]);
      if (freshPlan.kind === "withdraw") {
        setZapPlan(null);
        setZapState({ kind: "idle" });
      }
      setActionState({ kind: "submitted", message: successMessage(freshPlan) });
      if ((freshPlan.kind === "compound" || freshPlan.kind === "rebalance") && freshPlan.chain === "robinhood" && confirmedEvm) {
        const transactionHashes = confirmedEvm.transactionHashes;
        if (transactionHashes.length) void achievementActionRef.current?.({
          action: freshPlan.kind,
          chainId: 4663,
          tokenId: freshPlan.tokenId,
          transactionHashes,
        });
      }
      trackProductEvent(eventName(freshPlan.kind), { chainId: freshPlan.chainId });
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
      setZapState({ kind: "submitted", message: "Position opened. The NFT is in your wallet." });
      setZapPlan(null);
      trackProductEvent("Zap Confirmed", { marketId });
    } catch (error) {
      setZapState({ kind: "error", message: error instanceof Error ? error.message : "The position could not be opened" });
      reportClientError("market-submit", error);
    }
  }

  const positionImage = (position: PositionView) => positionTokenImage(position, activeMarkets, stats);
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
        <button className="wizzy-wordmark" type="button" onClick={() => changeTab("positions")} aria-label="Wizzy positions">
          <picture className="wizzy-mark" aria-hidden="true">
            {theme === "system" ? <source media="(prefers-color-scheme: dark)" srcSet="/brand/wizzy-mascot-dark.svg" /> : null}
            <img src={theme === "dark" ? "/brand/wizzy-mascot-dark.svg" : "/brand/wizzy-mascot-light.svg"} alt="" />
          </picture>
          <span>Wizzy</span>
        </button>
        <nav aria-label="Primary navigation">
          {([{ id: "positions", label: "Positions" }, { id: "markets", label: "Markets" }] as const).map((item) => (
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
        {tab === "positions" ? (
          <PositionsPage
            authenticated={hasPortfolioAccess}
            positions={positions}
            chainState={chainState}
            ethUsdFor={ethUsdFor}
            stats={stats}
            imageFor={positionImage}
            busy={sheetBusy}
            onConnect={() => startLogin("positions")}
            onRetry={() => void loadPositions()}
            onNew={() => changeTab("markets")}
            onAction={openSheet}
          />
        ) : (
          <section className="markets-page">
            <header className="page-head">
              <div>
                <h1>Markets</h1>
                <p>Reviewed meme pools on Base and Robinhood Chain. Add ETH to open a new position in your wallet.</p>
              </div>
              <span className="network-lockup" aria-label="Built on Base and Robinhood Chain">
                <span className="network-icons" aria-hidden="true"><img src={BRAND_ASSETS.base} alt="" /><img src={BRAND_ASSETS.robinhood} alt="" /></span>
                <span className="network-name"><small>Built on</small><b>Base + Robinhood</b></span>
              </span>
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
        )}
      </div>

      {sheet ? <ActionSheet
        key={`${positionKey(sheet.position)}-${sheet.action}`}
        position={positions.find((candidate) => positionKey(candidate) === positionKey(sheet.position)) ?? sheet.position}
        action={sheet.action}
        ethUsd={ethUsdFor(sheet.position.chain)}
        image={positionImage(sheet.position)}
        balance={authenticated && (sheet.position.chain === "base" || sheet.position.chain === "robinhood") ? balances[sheet.position.chain] : null}
        plan={actionPlan}
        state={actionState}
        onPlan={(request) => void preparePositionAction(request)}
        onExecute={() => void executePositionAction()}
        onReset={resetSheet}
        onClose={closeSheet}
        onFund={() => { if (sheet.position.chain === "base" || sheet.position.chain === "robinhood") fundChain(sheet.position.chain); }}
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

function PositionsPage({ authenticated, positions, chainState, ethUsdFor, stats, imageFor, busy, onConnect, onRetry, onNew, onAction }: {
  authenticated: boolean;
  positions: PositionView[];
  chainState: ChainLoadState;
  ethUsdFor: (chain?: string) => number | undefined;
  stats: Map<string, MarketStats>;
  imageFor: (position: PositionView) => string | null | undefined;
  busy: boolean;
  onConnect: () => void;
  onRetry: () => void;
  onNew: () => void;
  onAction: (position: PositionView, action: PositionActionKind) => void;
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
          ? positions.length ? `${positions.length} open position${positions.length === 1 ? "" : "s"} across Base and Robinhood.` : "Every LP position in your wallet, ready to manage."
          : "Connect your wallet to see and manage your liquidity."}</p>
      </div>
      {authenticated ? <button className="page-cta" type="button" onClick={onNew}>New position</button> : null}
    </header>
    {authenticated && positions.length ? <dl className="portfolio-summary" aria-label="Portfolio summary">
      <div><dt>Total value</dt><dd>{summary.priced ? money(summary.valueUsd) : "—"}</dd></div>
      <div><dt>Unclaimed fees</dt><dd className={summary.feesUsd > 0 ? "positive" : ""}>{summary.priced ? money(summary.feesUsd) : "—"}</dd></div>
      <div><dt>In range</dt><dd>{summary.inRange} of {summary.total}</dd></div>
    </dl> : null}
    {!authenticated ? <EmptyState title="See your positions" body="Connect to view value, fees, ranges, and every action in one place." action="Connect wallet" onAction={onConnect} /> : null}
    {authenticated && settled && !positions.length && !failed.length ? <EmptyState title="No positions yet" body="Pick a reviewed market and add ETH to open your first one." action="Browse markets" onAction={onNew} /> : null}
    {authenticated && failed.length ? <EmptyState variant="error" title={`Could not read ${failed.map((chain) => chain === "base" ? "Base" : "Robinhood").join(" or ")}`} body="The network did not answer in time. Positions on that chain are hidden until it does." action="Try again" onAction={onRetry} /> : null}
    <div className="position-grid">
      {sorted.map((position) => <PositionCard
        key={positionKey(position)}
        view={position}
        ethUsd={ethUsdFor(position.chain)}
        stat={position.marketId ? stats.get(position.marketId) : undefined}
        image={imageFor(position)}
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

function positionTokenImage(position: PositionView, markets: MarketEntry[], stats: Map<string, MarketStats>): string | null | undefined {
  if (position.marketId) {
    const direct = stats.get(position.marketId)?.tokenImageUrl;
    if (direct) return direct;
  }
  const market = markets.find(({ market }) =>
    (position.pool && "pool" in market && market.pool.toLowerCase() === position.pool.toLowerCase())
    || market.symbol.toLowerCase() === position.symbol0.toLowerCase()
    || market.symbol.toLowerCase() === position.symbol1.toLowerCase(),
  )?.market;
  if (!market) return undefined;
  return stats.get(market.id)?.tokenImageUrl ?? ("imageUrl" in market ? market.imageUrl : undefined);
}

function successMessage(plan: PositionActionPlan): string {
  if (plan.kind === "withdraw") return plan.settlement ? "Your ETH is back in your wallet." : "Both pool tokens are back in your wallet.";
  if (plan.kind === "decrease") return `${plan.removal?.percent ?? ""}% of the position is back in your wallet.`.trim();
  if (plan.kind === "rebalance") return "Your liquidity is earning in its new range.";
  if (plan.kind === "increase") return "Your added liquidity is in this position.";
  if (plan.kind === "collect") return "Your fees are in your wallet.";
  return "Your fees are back at work.";
}

function eventName(kind: PositionActionKind): string {
  if (kind === "withdraw") return "Withdrawal Confirmed";
  if (kind === "decrease") return "Reduce Confirmed";
  if (kind === "rebalance") return "Rebalance Confirmed";
  if (kind === "increase") return "Liquidity Increased";
  if (kind === "collect") return "Fees Collected";
  return "Compound Confirmed";
}

function sameAddress(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}
