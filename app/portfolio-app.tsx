"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { usePrivy, useWallets } from "@privy-io/react-auth";
import {
  useSignTransaction,
  useWallets as useSolanaWallets,
  type ConnectedStandardSolanaWallet,
} from "@privy-io/react-auth/solana";
import { formatEther, parseEther } from "viem";
import { lightRowToView, priceLabel, type PositionView } from "./lib/cards";
import { positionValueUsd, summarizePositions } from "./lib/portfolio-summary";
import { type ChainSlug } from "./lib/chains";
import {
  type CuratedMarket,
  type EthFundingChain,
  type AllocationMarketPlan,
  type MarketsPayload,
  type MarketStats,
  type RobinhoodIndexBreadthPolicy,
  type RobinhoodIndexBreadthTier,
  type RobinhoodIndexPlan,
  type IndexMigrationPlan,
  type PositionActionPlan,
  type SolanaCuratedMarket,
} from "./lib/portfolio-types";
import { type SolanaPositionActionPlan } from "./lib/solana-position-server";
import { executeSolanaPositionAction } from "./lib/solana-wallet";
import { isShotQuery, SHOT_VIEWS } from "./lib/shot-fixture";
import { relaySucceeded, sendWalletCalls, type ConnectedEvmWallet } from "./lib/wallet-calls";
import { reportClientError, trackProductEvent } from "./lib/telemetry-client";

type ViewTab = "overview" | "markets";
type ThemePreference = "system" | "light" | "dark";
type PlanState = { kind: "idle" | "planning" | "ready" | "signing" | "waiting" | "submitted" | "error"; message?: string };
type AnyPositionActionPlan = PositionActionPlan | SolanaPositionActionPlan;
type IndexChain = ChainSlug | "solana";
type IndexMarket = {
  market: CuratedMarket | SolanaCuratedMarket;
  chain: IndexChain;
  indexWeightBps: number;
};
type AvailableIndexUpdate = {
  migrationId: string;
  position: PositionView;
  fromSymbol: string;
  toSymbol: string;
};
type ViewTransitionDocument = Document & {
  startViewTransition?: (update: () => void | Promise<void>) => { finished: Promise<void> };
};

const INDEX_MARKET_COUNT = 6;
const FOMO_URL = "https://fomo.family/r/makemememarkets";
const BRAND_ASSETS = {
  base: "https://assets.relay.link/icons/8453/light.png",
  robinhood: "https://assets.relay.link/icons/4663/light.png",
  solana: "https://assets.relay.link/icons/792703809/light.png",
  fomo: "https://fomo.family/favicon.svg",
  gecko: "https://www.geckoterminal.com/favicon.ico",
} as const;

const EMPTY_MARKETS: MarketsPayload = {
  catalog: { version: 1, updatedAt: "", fees: { allocateBps: 15, withdrawBps: 15, rebalanceBps: 15, compoundBps: 200 }, migrations: [], chains: [] },
  solana: {
    slug: "solana",
    chainId: 792703809,
    label: "Solana",
    accent: "#8b5cf6",
    minimumAllocationLamports: "300000000",
    gasReserveLamports: "25000000",
    markets: [],
  },
  index: {
    chain: "robinhood",
    breadthUnitWei: "50000000000000000",
    minimumAmountWei: "50000000000000000",
    maximumConstituents: INDEX_MARKET_COUNT,
    tiers: [],
    selectionRules: { minimumPoolAgeDays: 30, minimumLiquidityUsd: 75_000, quoteSymbol: "WETH", venue: "Uniswap v3" },
  },
  fundingChains: [{ id: 8453, label: "Base" }, { id: 4663, label: "Robinhood Chain" }],
  stats: [],
  source: "",
};

export function PortfolioApp() {
  const { ready, authenticated, login, logout, user } = usePrivy();
  const { wallets } = useWallets();
  const { ready: solanaReady, wallets: solanaWallets } = useSolanaWallets();
  const { signTransaction } = useSignTransaction();
  const [tab, setTab] = useState<ViewTab>("overview");
  const [theme, setTheme] = useState<ThemePreference>("dark");
  const [amount, setAmount] = useState("1.00");
  const [sourceChainId, setSourceChainId] = useState(4663);
  const [markets, setMarkets] = useState<MarketsPayload>(EMPTY_MARKETS);
  const [marketsState, setMarketsState] = useState<"loading" | "ready" | "error">("loading");
  const [positions, setPositions] = useState<PositionView[]>([]);
  const [positionsState, setPositionsState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [previewMode, setPreviewMode] = useState(false);
  const [plan, setPlan] = useState<RobinhoodIndexPlan | null>(null);
  const [planState, setPlanState] = useState<PlanState>({ kind: "idle" });
  const [actionPlan, setActionPlan] = useState<AnyPositionActionPlan | null>(null);
  const [actionState, setActionState] = useState<PlanState>({ kind: "idle" });
  const [migrationPlan, setMigrationPlan] = useState<IndexMigrationPlan | null>(null);
  const [migrationState, setMigrationState] = useState<PlanState>({ kind: "idle" });
  const positionsRequestRef = useRef(0);
  const authStateRef = useRef<"loading" | "signed-in" | "signed-out">("loading");

  const wallet = useMemo(() => {
    const preferred = user?.wallet?.address?.toLowerCase();
    return wallets.find((candidate) => candidate.address.toLowerCase() === preferred) ?? wallets[0];
  }, [user?.wallet?.address, wallets]);
  const solanaWallet = useMemo(() => solanaWallets.find((candidate) => candidate.standardWallet.name.toLowerCase().includes("privy")) ?? solanaWallets[0], [solanaWallets]);
  const address = wallet?.address ?? user?.wallet?.address;
  const solanaAddress = solanaWallet?.address;

  const loadPositions = useCallback(async () => {
    const requestId = ++positionsRequestRef.current;
    if (!authenticated || !address) {
      setPositions([]);
      setPositionsState("idle");
      return;
    }
    setPositionsState("loading");
    try {
      const requests = (["base", "robinhood"] as const).map(async (chain) => {
        const response = await fetch(`/api/positions?owner=${encodeURIComponent(address)}&chain=${chain}`);
        const payload = await response.json() as { positions?: unknown[]; error?: string };
        if (!response.ok || payload.error) throw new Error(payload.error ?? `Could not load ${chain} positions`);
        return payload.positions ?? [];
      });
      if (solanaReady && solanaAddress) requests.push((async () => {
        const response = await fetch(`/api/portfolio/solana/positions?owner=${encodeURIComponent(solanaAddress)}`);
        const payload = await response.json() as { positions?: unknown[]; error?: string };
        if (!response.ok || payload.error) throw new Error(payload.error ?? "Could not load Solana positions");
        return payload.positions ?? [];
      })());
      const payloads = await Promise.all(requests);
      if (requestId !== positionsRequestRef.current) return;
      const next = payloads.flat().map((row) => row && typeof row === "object" ? lightRowToView(row as Record<string, unknown>) : null)
        .filter((row): row is PositionView => Boolean(row));
      setPositions(next);
      setPositionsState("ready");
    } catch (error) {
      if (requestId !== positionsRequestRef.current) return;
      setPositions([]);
      setPositionsState("error");
      reportClientError("positions", error);
    }
  }, [address, authenticated, solanaAddress, solanaReady]);

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
    const params = new URLSearchParams(window.location.search);
    const requested = params.get("view");
    if (requested === "markets" || requested === "positions") setTab("markets");
    if (isShotQuery()) {
      setPreviewMode(true);
      setPositions(SHOT_VIEWS);
      setPositionsState("ready");
    }
    fetch("/api/markets")
      .then(async (response) => {
        const payload = await response.json() as MarketsPayload;
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
    setPlan(null);
    setPlanState({ kind: "idle" });
  }, [amount, sourceChainId]);

  const activeMarkets = useMemo<IndexMarket[]>(() => {
    const robinhood = markets.catalog.chains.find((chain) => chain.slug === "robinhood");
    return robinhood?.markets
      .filter((market) => market.status === "active")
      .map((market) => ({ market, chain: "robinhood" as const, indexWeightBps: market.weightBps })) ?? [];
  }, [markets]);
  const selectedTier = useMemo(() => selectIndexTier(markets.index, amount), [amount, markets.index]);
  const amountError = useMemo(() => validateIndexAmount(markets.index, amount), [amount, markets.index]);
  const selectedMarkets = useMemo(() => {
    if (!markets.index.tiers.length) return activeMarkets;
    if (!selectedTier) return [];
    const ids = new Set(selectedTier.marketIds);
    return activeMarkets
      .filter(({ market }) => ids.has(market.id))
      .sort((a, b) => marketTierIndex(markets.index, a.market.id) - marketTierIndex(markets.index, b.market.id) || b.indexWeightBps - a.indexWeightBps);
  }, [activeMarkets, markets.index, selectedTier]);
  const stats = useMemo(() => new Map(markets.stats.map((row) => [row.marketId, row])), [markets.stats]);
  const feeApr = weightedFeeApr(selectedMarkets, stats);
  const availableIndexUpdates = useMemo<AvailableIndexUpdate[]>(() => {
    const robinhood = markets.catalog.chains.find((chain) => chain.slug === "robinhood");
    if (!robinhood) return [];
    const symbols = new Map(robinhood.markets.map((market) => [market.id, market.symbol]));
    return markets.catalog.migrations
      .filter((migration) => Date.parse(migration.effectiveAt) <= Date.now())
      .flatMap((migration) => positions
      .filter((position) => position.chain === "robinhood" && !position.closed && position.marketId === migration.fromMarketId && position.tokenId)
      .map((position) => ({
        migrationId: migration.id,
        position,
        fromSymbol: symbols.get(migration.fromMarketId) ?? position.symbol0,
        toSymbol: symbols.get(migration.toMarketId) ?? "the new market",
      })));
  }, [markets.catalog, positions]);
  const hasPortfolioAccess = authenticated || previewMode;

  function changeTab(next: ViewTab) {
    if (next === tab) return;
    const update = () => {
      setTab(next);
      const url = new URL(window.location.href);
      if (next === "overview") url.searchParams.delete("view");
      else url.searchParams.set("view", next);
      window.history.replaceState(null, "", `${url.pathname}${url.search}`);
    };
    const transitionDocument = document as ViewTransitionDocument;
    if (transitionDocument.startViewTransition && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      transitionDocument.startViewTransition(async () => {
        update();
        await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
      });
    } else {
      update();
    }
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
    try {
      login();
    } catch (error) {
      reportClientError("auth", error);
    }
  }

  async function prepareIndex() {
    if (!authenticated || !address) {
      startLogin("make-markets");
      return;
    }
    let amountWei: bigint;
    try {
      amountWei = parseEther(amount);
    } catch {
      setPlanState({ kind: "error", message: "Enter a valid ETH amount." });
      return;
    }
    setPlanState({ kind: "planning", message: "Getting the latest price for your deposit…" });
    setPlan(null);
    trackProductEvent("Index Quote Started", { originChainId: sourceChainId });
    try {
      const response = await fetch("/api/portfolio/index", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ owner: address, amountWei: amountWei.toString(), originChainId: sourceChainId }),
      });
      const payload = await response.json() as { plan?: RobinhoodIndexPlan; error?: string };
      if (!response.ok || !payload.plan) throw new Error(payload.error ?? "Could not prepare the index deposit");
      setPlan(payload.plan);
      setPlanState({ kind: "ready", message: "Review your deposit and fees before continuing." });
      trackProductEvent("Index Quote Ready", { originChainId: sourceChainId, constituents: payload.plan.constituentCount });
    } catch (error) {
      setPlanState({ kind: "error", message: error instanceof Error ? error.message : "Could not prepare the index deposit" });
      reportClientError("index-plan", error);
    }
  }

  async function executeIndex() {
    if (!plan || !wallet || !address) return;
    if (Date.now() >= Date.parse(plan.expiresAt)) {
      setPlanState({ kind: "error", message: "This deposit quote expired. Review a fresh one before continuing." });
      return;
    }
    const connected = wallet as unknown as ConnectedEvmWallet;
    const funding = plan.stages.find((stage) => stage.id === "fund-robinhood");
    const robinhood = plan.stages.find((stage) => stage.id === "make-robinhood-markets");
    if (!robinhood) {
      setPlanState({ kind: "error", message: "This deposit plan is incomplete. Please prepare it again." });
      return;
    }
    try {
      trackProductEvent("Index Submit Started", { originChainId: plan.sourceChainId, constituents: plan.constituentCount });
      if (funding) {
        setPlanState({ kind: "signing", message: `Approve your ETH deposit from ${funding.chainLabel}.` });
        await sendWalletCalls({ wallet: connected, owner: address, chainId: funding.chainId, transactions: funding.transactions });
        setPlanState({ kind: "waiting", message: "Moving your ETH to Robinhood Chain…" });
        await waitForRelay(funding.bridge.statusPath);
      }

      setPlanState({ kind: "signing", message: `Approve ${plan.constituentCount} Robinhood market positions.` });
      await sendWalletCalls({ wallet: connected, owner: address, chainId: robinhood.chainId, transactions: robinhood.transactions });
      setPlanState({ kind: "submitted", message: "Your Robinhood positions are being confirmed. They will appear in Markets shortly." });
      trackProductEvent("Index Submitted", { originChainId: plan.sourceChainId, constituents: plan.constituentCount });
      window.setTimeout(() => void loadPositions(), 8_000);
    } catch (error) {
      setPlanState({ kind: "error", message: error instanceof Error ? error.message : "The deposit could not be completed" });
      reportClientError("index-submit", error);
    }
  }

  async function preparePositionAction(position: PositionView, action: "compound" | "withdraw") {
    if (!address || !position.tokenId || !position.chain) return;
    setActionPlan(null);
    setActionState({ kind: "planning", message: `${action === "compound" ? "Collecting and redepositing" : "Preparing to withdraw"} ${position.pair}…` });
    try {
      const isSolana = position.chain === "solana";
      if (isSolana && (!solanaWallet || !position.marketId)) throw new Error("Your Solana wallet is not ready");
      const response = await fetch(isSolana ? "/api/portfolio/solana/action" : "/api/portfolio/action", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(isSolana ? {
          owner: solanaWallet!.address,
          marketId: position.marketId,
          position: position.tokenId,
          action,
        } : {
          owner: address,
          chain: position.chain,
          tokenId: position.tokenId,
          action,
          venue: position.venue,
          positionManager: position.positionManager,
        }),
      });
      const payload = await response.json() as { plan?: AnyPositionActionPlan; error?: string };
      if (!response.ok || !payload.plan) throw new Error(payload.error ?? `Could not prepare ${action}`);
      setActionPlan(payload.plan);
      setActionState({ kind: "ready", message: "Ready for your wallet approval." });
    } catch (error) {
      setActionState({ kind: "error", message: error instanceof Error ? error.message : `Could not prepare ${action}` });
      reportClientError("position-action", error);
    }
  }

  async function executePositionAction() {
    if (!actionPlan || !wallet || !address) return;
    if (Date.now() >= Date.parse(actionPlan.expiresAt)) {
      setActionState({ kind: "error", message: "This quote expired. Prepare it again." });
      return;
    }
    try {
      setActionState({ kind: "signing", message: "Approve this position update in your wallet." });
      if (actionPlan.chain === "solana") {
        if (!solanaWallet) throw new Error("Your Solana wallet is not ready");
        await executeSolanaPositionAction({
          plan: actionPlan,
          wallet: solanaWallet as ConnectedStandardSolanaWallet,
          signTransaction,
          onProgress: ({ step, total, label }) => setActionState({
            kind: step === 0 ? "signing" : "waiting",
            message: step === 0 ? "Approve the Solana position update." : `${label} · ${step} of ${total}`,
          }),
        });
      } else {
        await sendWalletCalls({ wallet: wallet as unknown as ConnectedEvmWallet, owner: address, chainId: actionPlan.chainId, transactions: actionPlan.transactions });
      }
      setActionState({ kind: "submitted", message: "Submitted. Your position will refresh after confirmation." });
      window.setTimeout(() => void loadPositions(), 8_000);
    } catch (error) {
      setActionState({ kind: "error", message: error instanceof Error ? error.message : "Wallet submission failed" });
      reportClientError("position-action", error);
    }
  }

  async function prepareIndexMigration(update: AvailableIndexUpdate) {
    if (!address || !update.position.tokenId) return;
    setMigrationPlan(null);
    setMigrationState({ kind: "planning", message: `Quoting ${update.fromSymbol} → ${update.toSymbol}…` });
    try {
      const response = await fetch("/api/portfolio/migrate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ owner: address, tokenId: update.position.tokenId, migrationId: update.migrationId }),
      });
      const payload = await response.json() as { plan?: IndexMigrationPlan; error?: string };
      if (!response.ok || !payload.plan) throw new Error(payload.error ?? "Could not prepare the index update");
      setMigrationPlan(payload.plan);
      setMigrationState({ kind: "ready", message: "Review the replacement and fee before updating." });
    } catch (error) {
      setMigrationState({ kind: "error", message: error instanceof Error ? error.message : "Could not prepare the index update" });
      reportClientError("index-migration", error);
    }
  }

  async function executeIndexMigration() {
    if (!migrationPlan || !wallet || !address) return;
    if (Date.now() >= Date.parse(migrationPlan.expiresAt)) {
      setMigrationState({ kind: "error", message: "This update quote expired. Prepare it again." });
      return;
    }
    try {
      setMigrationState({ kind: "signing", message: "Approve this index update in your wallet." });
      await sendWalletCalls({
        wallet: wallet as unknown as ConnectedEvmWallet,
        owner: address,
        chainId: migrationPlan.chainId,
        transactions: migrationPlan.transactions,
      });
      setMigrationState({ kind: "submitted", message: "Index update submitted. Your new position will appear after confirmation." });
      window.setTimeout(() => void loadPositions(), 8_000);
    } catch (error) {
      setMigrationState({ kind: "error", message: error instanceof Error ? error.message : "The index update could not be submitted" });
      reportClientError("index-migration", error);
    }
  }

  const positionLedger = (
    <PositionLedger
      authenticated={hasPortfolioAccess}
      positions={positions}
      state={positionsState}
      stats={stats}
      onStart={() => hasPortfolioAccess ? changeTab("overview") : startLogin("markets")}
      onRetry={() => void loadPositions()}
      onAction={preparePositionAction}
      actionPlan={actionPlan}
      actionState={actionState}
      onExecute={executePositionAction}
      onCancel={() => { setActionPlan(null); setActionState({ kind: "idle" }); }}
      updates={availableIndexUpdates}
      migrationPlan={migrationPlan}
      migrationState={migrationState}
      onPrepareMigration={(update) => void prepareIndexMigration(update)}
      onExecuteMigration={() => void executeIndexMigration()}
      onCancelMigration={() => { setMigrationPlan(null); setMigrationState({ kind: "idle" }); }}
    />
  );
  const indexLedger = (
    <section className="index-section index-catalog">
      <header className="section-title">
        <div><h2>Robinhood Wizzy Index</h2><p>Actively curated as meme markets change.</p></div>
      </header>
      <MarketLedger markets={activeMarkets} stats={stats} state={marketsState} policy={markets.index} />
    </section>
  );

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
      <header className="index-nav">
        <button className="wizzy-wordmark" type="button" onClick={() => changeTab("overview")} aria-label="Wizzy overview">
          <picture className="wizzy-mark" aria-hidden="true">
            {theme === "system" ? <source media="(prefers-color-scheme: dark)" srcSet="/brand/wizzy-mascot-dark.svg" /> : null}
            <img src={theme === "dark" ? "/brand/wizzy-mascot-dark.svg" : "/brand/wizzy-mascot-light.svg"} alt="" />
          </picture>
          <span>Wizzy</span>
        </button>
        <nav aria-label="Primary navigation">
          {([{ id: "overview", label: "Make" }, { id: "markets", label: "Markets" }] as const).map((item) => (
            <button key={item.id} type="button" className={tab === item.id ? "is-active" : ""} onClick={() => changeTab(item.id)}>{item.label}</button>
          ))}
        </nav>
        <div className="nav-actions">
          <a className="social-button" href="https://x.com/wizzydotmeme" target="_blank" rel="noreferrer" aria-label="Follow Wizzy on X" title="@wizzydotmeme on X" onClick={() => trackProductEvent("X Opened", { location: "header" })}>
            <XIcon />
          </a>
          <button className="theme-button" type="button" onClick={cycleTheme} aria-label={`Theme: ${capitalize(theme)}. Switch to ${theme === "dark" ? "light" : theme === "light" ? "system" : "dark"}.`} title={`Theme: ${capitalize(theme)}`}>
            <ThemeIcon preference={theme} />
          </button>
          {!ready ? <span className="wallet-skeleton" /> : authenticated ? (
            <button className="wallet-button" type="button" onClick={() => { trackProductEvent("Logout Started"); void logout(); }} aria-label={`Sign out ${short(address ?? "wallet")}`} title="Sign out">
              <WalletIcon /><span>{short(address ?? "Wallet")}</span>
            </button>
          ) : (
            <button className="wallet-button wallet-connect" type="button" onClick={() => startLogin("header")} aria-label="Connect wallet"><WalletIcon /><span>Connect</span></button>
          )}
        </div>
      </header>

      {previewMode ? <div className="preview-banner">Illustrative preview · development only</div> : null}

      <div className="index-shell" data-view={tab}>
          {tab === "overview" ? (
            <section className="index-hero">
                <div className="hero-stage">
                  <div className="hero-copy">
                    <h1>Make Meme Markets</h1>
                    <p>Deposit ETH into a curated index of meme markets and earn.<br /><span>Updated and managed by agents on Robinhood Chain.</span></p>
                  </div>
                  <IndexShowcase markets={activeMarkets} stats={stats} loading={marketsState === "loading"} />
                </div>
                <MarketAction
                  amount={amount}
                  onAmount={setAmount}
                  sourceChainId={sourceChainId}
                  onSourceChain={setSourceChainId}
                  fundingChains={markets.fundingChains}
                  markets={selectedMarkets}
                  stats={stats}
                  loading={marketsState === "loading"}
                  feeApr={feeApr}
                  amountError={amountError}
                  maximumConstituents={markets.index.maximumConstituents || INDEX_MARKET_COUNT}
                  ready={ready}
                  onPrepare={() => void prepareIndex()}
                  plan={plan}
                  state={planState}
                  onExecute={() => void executeIndex()}
                  onCancel={() => { setPlan(null); setPlanState({ kind: "idle" }); }}
                />
            </section>
          ) : (
            <section className="index-main markets-view">
              <header className="index-title-row">
                <div><h1>{hasPortfolioAccess ? "Your markets" : "The live index"}</h1><p>{hasPortfolioAccess ? (positions.length ? `${positions.length} position${positions.length === 1 ? "" : "s"} in this wallet.` : "Your wallet is connected. New positions appear here.") : "Wizzy agents regularly review which markets qualify."}</p></div>
              </header>
              {hasPortfolioAccess ? positionLedger : null}
              {indexLedger}
              {!hasPortfolioAccess ? positionLedger : null}
            </section>
          )}
      </div>
    </main>
  );
}

function IndexShowcase({ markets, stats, loading }: { markets: IndexMarket[]; stats: Map<string, MarketStats>; loading: boolean }) {
  return <div className="index-showcase" aria-label="Robinhood Wizzy Index">
    <div className="network-lockup" aria-label="Built on Robinhood Chain">
      <img src={BRAND_ASSETS.robinhood} alt="" />
      <span className="network-name"><small>Built on</small><b>Robinhood Chain</b></span>
    </div>
    <div className={`hero-token-field ${loading ? "is-loading" : ""}`}>
      {(loading ? Array.from({ length: INDEX_MARKET_COUNT }, (_, index) => ({ market: { id: String(index), symbol: "", color: "" } })) : markets).map(({ market }, index) => (
        <span className="hero-token" key={market.id} style={{ "--token-index": index } as CSSProperties}>
          <TokenIcon symbol={market.symbol} src={stats.get(market.id)?.tokenImageUrl} color={market.color} />
          {market.symbol ? <b>{market.symbol}</b> : null}
        </span>
      ))}
    </div>
  </div>;
}

function MarketAction({ amount, onAmount, sourceChainId, onSourceChain, fundingChains, markets, stats, loading, feeApr, amountError, maximumConstituents, ready, onPrepare, plan, state, onExecute, onCancel }: {
  amount: string;
  onAmount: (amount: string) => void;
  sourceChainId: number;
  onSourceChain: (chainId: number) => void;
  fundingChains: EthFundingChain[];
  markets: IndexMarket[];
  stats: Map<string, MarketStats>;
  loading: boolean;
  feeApr: number | null;
  amountError: string | null;
  maximumConstituents: number;
  ready: boolean;
  onPrepare: () => void;
  plan: RobinhoodIndexPlan | null;
  state: PlanState;
  onExecute: () => void;
  onCancel: () => void;
}) {
  const constituentCount = markets.length;
  return (
    <aside className="market-action" aria-label="Make markets">
      <label className={`amount-field ${amountError ? "is-invalid" : ""}`}>
        <span>You deposit</span>
        <span className="amount-input"><input id="deposit-amount" name="depositAmount" inputMode="decimal" value={amount} onChange={(event) => onAmount(event.target.value)} aria-label="ETH amount" aria-invalid={Boolean(amountError)} aria-describedby={amountError ? "amount-error" : undefined} /><b>ETH</b></span>
        {amountError ? <small className="amount-error" id="amount-error">{amountError}</small> : null}
      </label>

      <ChainPicker value={sourceChainId} chains={fundingChains} onChange={onSourceChain} />

      <div className={`market-output ${loading ? "is-loading" : ""}`} aria-label="Index markets">
        <span className="market-breadth">
          <span className="market-stack" role="img" aria-label={loading ? "Reading markets" : markets.map(({ market }) => market.symbol).join(", ")}>
            {loading ? Array.from({ length: INDEX_MARKET_COUNT }, (_, index) => <i key={index} />) : markets.map(({ market }) => <TokenIcon key={market.id} symbol={market.symbol} src={stats.get(market.id)?.tokenImageUrl} color={market.color} />)}
          </span>
          <span><b>{loading ? "Reading markets" : `${constituentCount} markets`}</b><small>{loading ? "Current index" : constituentCount >= maximumConstituents ? "Full index" : "More with a larger deposit"}</small></span>
        </span>
        <span className="action-economics"><small>24h fee APR</small><b>{formatFeeApr(feeApr)}</b></span>
      </div>

      {state.kind !== "idle" ? <PlanPreview plan={plan} state={state} onExecute={onExecute} onCancel={onCancel} /> : (
        <button className="fund-button" type="button" disabled={!ready || loading || Boolean(amountError)} onClick={onPrepare}>
          {!ready ? "Preparing wallets…" : loading ? "Reading markets…" : "Make markets"}
        </button>
      )}
      <p className="action-assurance">Robinhood Chain · Self-custodial</p>
    </aside>
  );
}

function ChainPicker({ value, chains, onChange }: { value: number; chains: EthFundingChain[]; onChange: (chainId: number) => void }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const selected = chains.find((chain) => chain.id === value) ?? chains[0];
  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);
  if (!selected) return null;
  return <div className="funding-choice" ref={rootRef}>
    <span>Pay from</span>
    <button className="chain-picker-trigger" type="button" onClick={() => setOpen((current) => !current)} aria-haspopup="listbox" aria-expanded={open} aria-controls="source-chain-options">
      <img src={relayChainIcon(selected.id)} alt="" />
      <span><b>{selected.label}</b><small>ETH network</small></span>
      <ChevronIcon />
    </button>
    {open ? <div className="chain-picker-popover" id="source-chain-options" role="listbox" aria-label="Pay from network">
      <header><b>Pay from</b><small>Choose where your ETH is now</small></header>
      <div className="chain-picker-options">
        {chains.map((chain) => <button type="button" role="option" aria-selected={chain.id === value} key={chain.id} onClick={() => { onChange(chain.id); setOpen(false); }}>
          <img src={relayChainIcon(chain.id)} alt="" />
          <span>{chain.label}</span>
          {chain.id === value ? <CheckIcon /> : null}
        </button>)}
      </div>
    </div> : null}
    <input type="hidden" id="source-chain" name="sourceChain" value={value} />
  </div>;
}

function PlanPreview({ plan, state, onExecute, onCancel }: { plan: RobinhoodIndexPlan | null; state: PlanState; onExecute: () => void; onCancel: () => void }) {
  const funding = plan?.stages.find((stage) => stage.id === "fund-robinhood");
  const robinhood = plan?.stages.find((stage) => stage.id === "make-robinhood-markets");
  const feeWei = robinhood ? BigInt(robinhood.allocation.serviceFeeWei) : 0n;
  const relayFee = Number(funding?.bridge.relayerFeeUsd ?? 0);
  const relayImpact = funding?.bridge.impactPercent ?? null;
  const swapProtection = robinhood ? maximumSwapProtection(robinhood.allocation.markets) : null;
  const busy = state.kind === "planning" || state.kind === "signing" || state.kind === "waiting";
  const title = state.kind === "ready" ? "Review deposit" : state.kind === "error" ? "Deposit not ready" : state.kind === "submitted" ? "Deposit submitted" : "Preparing deposit";
  return (
    <section className={`plan-preview is-${state.kind}`} aria-live="polite">
      <header><span>{title}</span><button type="button" onClick={onCancel} disabled={busy}>Cancel</button></header>
      <p>{state.message}</p>
      {plan ? <>
        <div className="review-amount"><span>You deposit</span><strong>{trimEth(BigInt(plan.totalAmountWei))}<small> ETH</small></strong></div>
        <dl>
          <div><dt>Pay from</dt><dd><img src={relayChainIcon(plan.sourceChainId)} alt="" />{plan.sourceChainLabel}</dd></div>
          <div><dt>You’ll open</dt><dd>{plan.constituentCount} Robinhood position{plan.constituentCount === 1 ? "" : "s"}</dd></div>
          <div><dt>Wizzy fee</dt><dd>{trimEth(feeWei)} ETH</dd></div>
          {funding ? <><div><dt>Relay fee</dt><dd>{relayFee > 0 ? `$${relayFee.toFixed(2)}` : "Included"}</dd></div><div><dt>Bridge price change</dt><dd>{formatPercent(relayImpact)}</dd></div></> : null}
          <div><dt>Swap protection</dt><dd>{swapProtection}</dd></div>
          <div><dt>Network fee</dt><dd>Shown by your wallet</dd></div>
        </dl>
      </> : <div className="plan-loading"><i /><i /><i /></div>}
      {state.kind === "ready" && plan ? <>
        <p className="approval-note">{funding ? `Two approvals: move your ETH from ${plan.sourceChainLabel}, then open the positions.` : "One approval opens every position."} Everything stays in your wallet.</p>
        <p className="risk-note">Meme prices can fall, and trading fees may not cover losses.</p>
        <button className="fund-button" type="button" onClick={onExecute}>Make markets</button>
      </> : null}
      {state.kind === "error" ? <button className="secondary-button" type="button" onClick={onCancel}>Try again</button> : null}
    </section>
  );
}

function MarketLedger({ markets, stats, state, policy }: { markets: IndexMarket[]; stats: Map<string, MarketStats>; state: "loading" | "ready" | "error"; policy: RobinhoodIndexBreadthPolicy }) {
  const orderedMarkets = [...markets].sort(
    (a, b) => marketTierIndex(policy, a.market.id) - marketTierIndex(policy, b.market.id) || b.indexWeightBps - a.indexWeightBps,
  );
  return (
    <section className="market-ledger">
      <div className="market-table-wrap">
        <IndexSnapshot markets={orderedMarkets} stats={stats} state={state} />
        <table className="market-table">
          <thead><tr><th>Market</th><th>Fee APR</th><th>24h volume</th><th>Liquidity</th><th>Explore</th></tr></thead>
          <tbody>
            {state === "loading" ? Array.from({ length: INDEX_MARKET_COUNT }, (_, index) => <tr className="skeleton-row" key={index}><td colSpan={5}><i /></td></tr>) : null}
            {state === "error" ? <tr><td colSpan={5} className="table-message">Market data is temporarily unavailable.</td></tr> : null}
            {state === "ready" ? orderedMarkets.map(({ market, chain }) => {
              const row = stats.get(market.id);
              return <tr key={market.id}>
                <td><span className="pair-cell"><TokenIcon symbol={market.symbol} src={row?.tokenImageUrl} color={market.color} /><span><b>{market.symbol}/WETH</b><VenueTrail chain={chain} /></span></span></td>
                <td><b className="fee-apr">{formatFeeApr(row?.trailingFeeAprPct ?? null)}</b><small className="cell-note">Based on 24h fees</small></td>
                <td>{compactMoney(row?.volume24hUsd)}</td>
                <td>{compactMoney(row?.liquidityUsd)}</td>
                <td><span className="market-links">
                  <a className="market-link gecko-link" href={row?.sourceUrl ?? geckoPoolUrl(market.pool)} target="_blank" rel="noreferrer" aria-label={`View ${market.symbol}/WETH on GeckoTerminal`}><img src={BRAND_ASSETS.gecko} alt="" /><span className="market-link-label">Gecko</span></a>
                  <a className="market-link fomo-link" href={FOMO_URL} target="_blank" rel="noreferrer" aria-label={`Trade ${market.symbol}/WETH on Fomo`}><img src={BRAND_ASSETS.fomo} alt="" /><span className="market-link-label">Trade on Fomo</span></a>
                </span></td>
              </tr>;
            }) : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function IndexSnapshot({ markets, stats, state }: { markets: IndexMarket[]; stats: Map<string, MarketStats>; state: "loading" | "ready" | "error" }) {
  const volume = markets.reduce((sum, { market }) => sum + (stats.get(market.id)?.volume24hUsd ?? 0), 0);
  const liquidity = markets.reduce((sum, { market }) => sum + (stats.get(market.id)?.liquidityUsd ?? 0), 0);
  const feeApr = weightedFeeApr(markets, stats);
  const compositionLabel = markets.map(({ market, indexWeightBps }) => `${market.symbol} ${(indexWeightBps / 100).toFixed(0)}%`).join(", ");
  return <section className={`index-snapshot is-${state}`} aria-label="Live index snapshot">
    <div className="index-snapshot-top">
      <span className="snapshot-origin"><img src={BRAND_ASSETS.robinhood} alt="" /><span><small>Live on</small><b>Robinhood Chain</b></span></span>
      <dl className="index-vitals">
        <div><dt>Fee APR</dt><dd>{formatFeeApr(feeApr)}</dd><small>Based on 24h fees</small></div>
        <div><dt>24h volume</dt><dd>{state === "ready" ? compactMoney(volume) : "—"}</dd><small>Across the index</small></div>
        <div><dt>Liquidity</dt><dd>{state === "ready" ? compactMoney(liquidity) : "—"}</dd><small>Across the index</small></div>
      </dl>
    </div>
    <div className="index-composition">
      <span className="composition-heading"><b>Index composition</b><small>Curator weights</small></span>
      <span className={`composition-track ${state === "loading" ? "is-loading" : ""}`} role="img" aria-label={compositionLabel || "Reading index composition"}>
        {state === "loading" ? Array.from({ length: INDEX_MARKET_COUNT }, (_, index) => <i key={index} />) : markets.map(({ market, indexWeightBps }, index) => <i className="composition-segment" key={market.id} style={{ "--market-color": market.color, "--market-index": index, "--market-weight": indexWeightBps } as CSSProperties} />)}
      </span>
      {state === "ready" ? <span className="composition-key">
        {markets.map(({ market, indexWeightBps }, index) => <span className="composition-item" key={market.id} style={{ "--market-index": index } as CSSProperties}><TokenIcon symbol={market.symbol} src={stats.get(market.id)?.tokenImageUrl} color={market.color} /><span><b>{market.symbol}</b><small>{(indexWeightBps / 100).toFixed(0)}%</small></span></span>)}
      </span> : null}
    </div>
  </section>;
}

function PositionLedger({ authenticated, positions, state, stats, onStart, onRetry, onAction, actionPlan, actionState, onExecute, onCancel, updates, migrationPlan, migrationState, onPrepareMigration, onExecuteMigration, onCancelMigration }: {
  authenticated: boolean;
  positions: PositionView[];
  state: "idle" | "loading" | "ready" | "error";
  stats: Map<string, MarketStats>;
  onStart: () => void;
  onRetry: () => void;
  onAction: (position: PositionView, action: "compound" | "withdraw") => void;
  actionPlan: AnyPositionActionPlan | null;
  actionState: PlanState;
  onExecute: () => void;
  onCancel: () => void;
  updates: AvailableIndexUpdate[];
  migrationPlan: IndexMigrationPlan | null;
  migrationState: PlanState;
  onPrepareMigration: (update: AvailableIndexUpdate) => void;
  onExecuteMigration: () => void;
  onCancelMigration: () => void;
}) {
  const summary = summarizePositions(positions);
  const showPositions = authenticated && positions.length > 0;
  return (
    <section className={`position-ledger ${authenticated ? "" : "is-disconnected"}`} id="positions">
      {updates.length ? <IndexUpdatePanel updates={updates} plan={migrationPlan} state={migrationState} onPrepare={onPrepareMigration} onExecute={onExecuteMigration} onCancel={onCancelMigration} /> : null}
      {actionState.kind !== "idle" ? (
        <section className={`action-preview is-${actionState.kind}`} aria-live="polite">
          <div><b>{actionPlan ? `${actionPlan.kind === "compound" ? "Reinvest fees" : "Withdraw"} · ${actionPlan.pair}` : "Preparing your position"}</b><p>{actionState.message}{actionState.kind === "ready" && actionPlan?.kind === "compound" ? ` Collect fees, deduct Wizzy’s ${(actionPlan.serviceFeeBps / 100).toFixed(0)}% fee, and add the rest back to this position.` : ""}</p></div>
          {actionPlan ? <span>{(actionPlan.serviceFeeBps / 100).toFixed(2)}% Wizzy fee</span> : null}
          <div className="action-buttons">{actionState.kind === "ready" ? <button className="small-primary" type="button" onClick={onExecute}>Approve</button> : null}<button type="button" onClick={onCancel} disabled={actionState.kind === "planning" || actionState.kind === "signing"}>Close</button></div>
        </section>
      ) : null}
      {!authenticated ? <PortfolioEmpty variant="disconnected" onPrimary={onStart} /> : null}
      {authenticated && (state === "idle" || state === "loading") ? <PortfolioEmpty variant="loading" /> : null}
      {authenticated && state === "error" ? <PortfolioEmpty variant="error" onPrimary={onRetry} /> : null}
      {authenticated && state === "ready" && positions.length === 0 ? <PortfolioEmpty variant="empty" onPrimary={onStart} /> : null}
      {showPositions ? <section className="portfolio-summary" aria-label="Portfolio summary">
        <div><span>Position value</span><strong>{summary.priced ? money(summary.valueUsd) : "—"}</strong><small>{summary.priced} of {positions.length} priced</small></div>
        <div><span>Ready to collect</span><strong>{summary.feesPriced ? money(summary.feesUsd) : "—"}</strong><small>Unclaimed fees</small></div>
        <div><span>Earning now</span><strong>{summary.earning}</strong><small>of {positions.length} positions in range</small></div>
        <div><span>Fee APR</span><strong>{formatFeeAprFraction(summary.feeApr)}</strong><small>Across priced positions</small></div>
      </section> : null}
      {showPositions ? <div className="position-list">{positions.map((position) => <article key={`${position.chain}-${position.protocol}-${position.positionManager ?? "default"}-${position.tokenId}`}>
        <span className="position-pair"><TokenIcon symbol={position.symbol0} src={position.marketId ? stats.get(position.marketId)?.tokenImageUrl : undefined} /><span><b>{position.pair}</b><small>{position.chainLabel}{position.venueLabel ? ` · ${position.venueLabel}` : ""}</small></span></span>
        <span><small>Position value</small><b>{positionValueUsd(position) === undefined ? "—" : money(positionValueUsd(position)!)}</b></span>
        <span><small>Ready to collect</small><b>{position.feesUsd === undefined ? "—" : money(position.feesUsd)}</b></span>
        <span><small>Fee APR</small><b>{formatFeeAprFraction(position.feeApr ?? null)}</b></span>
        <PositionRange position={position} />
        <span className="position-actions"><button type="button" onClick={() => onAction(position, "compound")} disabled={position.closed || !position.inRange} title={!position.inRange ? "Rebalancing is required before compounding" : undefined}>Compound</button><button type="button" onClick={() => onAction(position, "withdraw")} disabled={position.closed}>Withdraw</button></span>
      </article>)}</div> : null}
    </section>
  );
}

function IndexUpdatePanel({ updates, plan, state, onPrepare, onExecute, onCancel }: {
  updates: AvailableIndexUpdate[];
  plan: IndexMigrationPlan | null;
  state: PlanState;
  onPrepare: (update: AvailableIndexUpdate) => void;
  onExecute: () => void;
  onCancel: () => void;
}) {
  const busy = state.kind === "planning" || state.kind === "signing";
  if (state.kind !== "idle") return <section className={`index-update-panel is-${state.kind}`} aria-live="polite">
    <header><span><b>{plan ? `${plan.fromMarket.symbol} → ${plan.toMarket.symbol}` : "Preparing index update"}</b><small>{state.message}</small></span><button type="button" onClick={onCancel} disabled={busy}>Close</button></header>
    {plan ? <dl>
      <div><dt>Position replaced</dt><dd>{plan.fromMarket.symbol} → {plan.toMarket.symbol}</dd></div>
      <div><dt>Amount moving</dt><dd>At least {trimEth(BigInt(plan.migratedAmountFloorWei))} ETH</dd></div>
      <div><dt>Wizzy rebalance fee</dt><dd>{trimEth(BigInt(plan.serviceFeeWei))} ETH</dd></div>
      <div><dt>Approval</dt><dd>One atomic wallet batch</dd></div>
    </dl> : null}
    {state.kind === "ready" ? <><p>If any step fails, your original position remains unchanged. Other index positions are untouched.</p><button className="small-primary" type="button" onClick={onExecute}>Update position</button></> : null}
    {state.kind === "error" ? <button className="secondary-button" type="button" onClick={onCancel}>Dismiss</button> : null}
  </section>;
  return <section className="index-update-panel" aria-label="Index update available">
    <div className="index-update-copy"><span className="update-mark"><RefreshIcon /></span><span><b>Index updated</b><small>{updates.length === 1 ? `${updates[0]!.fromSymbol} has been replaced by ${updates[0]!.toSymbol}.` : `${updates.length} positions can move to the latest index.`}</small></span></div>
    <div className="index-update-actions">
      {updates.map((update) => <button className="small-primary" type="button" key={`${update.migrationId}-${update.position.tokenId}`} onClick={() => onPrepare(update)}>Review {update.fromSymbol} update</button>)}
    </div>
  </section>;
}

function PortfolioEmpty({ variant, onPrimary }: {
  variant: "disconnected" | "loading" | "error" | "empty";
  onPrimary?: () => void;
}) {
  const content = variant === "disconnected"
    ? { title: "Reveal your markets", body: "Connect to see position value, fees, range status, and index updates.", action: "Connect wallet" }
    : variant === "error"
      ? { title: "We couldn’t load your positions.", body: "Try again to read your wallet.", action: "Try again" }
    : variant === "empty"
        ? { title: "Your markets will live here.", body: "Make markets once and Wizzy opens every index position your deposit supports.", action: "Make markets" }
        : { title: "Reading your positions.", body: "Your liquidity will appear here.", action: "" };
  return <section className={`portfolio-empty is-${variant}`} aria-live={variant === "loading" ? "polite" : undefined}>
    <span className="empty-symbol">{variant === "empty" ? <img src="/brand/wizzy-mascot-32.png" alt="" /> : <WalletIcon />}</span>
    <div className="empty-copy">
      <h3>{content.title}</h3>
      <p>{content.body}</p>
    </div>
    {onPrimary && content.action ? <button className="empty-action" type="button" onClick={onPrimary}>{content.action}</button> : null}
  </section>;
}

function PositionRange({ position }: { position: PositionView }) {
  const positionPct = position.closed
    ? 50
    : position.tickCurrent < position.tickLower
      ? 0
      : position.tickCurrent > position.tickUpper
        ? 100
        : Math.max(0, Math.min(100, position.percentThroughRange));
  const status = position.status === "in-range" ? "In range" : position.status === "oor" ? "Out of range" : "Closed";
  const description = `${status}. Current price ${priceLabel(position.price)}. Range ${priceLabel(position.priceMin)} to ${priceLabel(position.priceMax, position.priceMax === null)}.`;
  return <span className={`position-range-viz is-${position.status}`} style={{ "--range-position": `${positionPct}%` } as CSSProperties} role="img" aria-label={description}>
    <span className="range-heading"><small>Price range</small><b>{status}</b></span>
    <span className="range-track"><i /><b /></span>
    <span className="range-prices"><small>{priceLabel(position.priceMin)}</small><strong>{priceLabel(position.price)}</strong><small>{priceLabel(position.priceMax, position.priceMax === null)}</small></span>
  </span>;
}

function weightedFeeApr(markets: IndexMarket[], stats: Map<string, MarketStats>): number | null {
  const available = markets.filter(({ market }) => stats.get(market.id)?.trailingFeeAprPct != null);
  if (!available.length) return null;
  const weight = available.reduce((sum, row) => sum + row.indexWeightBps, 0);
  return available.reduce((sum, row) => sum + (stats.get(row.market.id)!.trailingFeeAprPct! * row.indexWeightBps) / weight, 0);
}

function selectIndexTier(policy: RobinhoodIndexBreadthPolicy, amount: string): RobinhoodIndexBreadthTier | null {
  if (!policy.tiers.length) return null;
  let amountWei: bigint;
  try {
    amountWei = parseEther(amount || "0");
  } catch {
    return null;
  }
  return [...policy.tiers].reverse().find((tier) => amountWei >= BigInt(tier.minimumAmountWei)) ?? null;
}

function validateIndexAmount(policy: RobinhoodIndexBreadthPolicy, amount: string): string | null {
  if (!policy.tiers.length) return null;
  if (!amount.trim()) return "Enter an ETH amount.";
  let amountWei: bigint;
  try {
    amountWei = parseEther(amount);
  } catch {
    return "Enter a valid ETH amount.";
  }
  const minimum = BigInt(policy.minimumAmountWei);
  if (amountWei < minimum) return `Minimum deposit is ${trimEth(minimum)} ETH.`;
  return null;
}

function marketTierIndex(policy: RobinhoodIndexBreadthPolicy, marketId: string): number {
  const index = policy.tiers.findIndex((tier) => tier.marketIds.includes(marketId));
  return index === -1 ? Number.MAX_SAFE_INTEGER : index;
}

async function waitForRelay(statusPath: string): Promise<void> {
  for (let attempt = 0; attempt < 90; attempt += 1) {
    const response = await fetch(statusPath, { cache: "no-store" });
    const payload: unknown = await response.json();
    if (!response.ok) throw new Error(payload && typeof payload === "object" && "error" in payload ? String((payload as { error: unknown }).error) : "Could not verify network routing");
    if (relaySucceeded(payload)) return;
    if (relayFailed(payload)) throw new Error("A network route failed or refunded. Check your wallet before retrying.");
    await new Promise((resolve) => window.setTimeout(resolve, 2_000));
  }
  throw new Error("A network route is still pending. Check your wallet before continuing.");
}

function relayFailed(status: unknown): boolean {
  if (!status || typeof status !== "object") return false;
  const value = String((status as Record<string, unknown>).status ?? (status as Record<string, unknown>).state ?? "").toLowerCase();
  return ["failure", "failed", "refunded", "refund"].includes(value);
}

function chainLabel(chain: IndexChain): string {
  if (chain === "base") return "Base";
  if (chain === "robinhood") return "Robinhood";
  return "Solana";
}

function money(value: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(value);
}

function compactMoney(value?: number | null): string {
  if (value == null) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", notation: "compact", maximumFractionDigits: 1 }).format(value);
}

function formatFeeApr(value?: number | null): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${value.toFixed(value >= 100 ? 0 : 1)}%`;
}

function formatFeeAprFraction(value?: number | null): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return formatFeeApr(value * 100);
}

function formatPercent(value?: string | null): string {
  if (!value) return "Included";
  const numeric = Number(value.replace("%", ""));
  if (!Number.isFinite(numeric)) return value;
  return `${numeric.toFixed(numeric >= 1 ? 1 : 2).replace(/\.0+$/, "").replace(/(\.\d*[1-9])0+$/, "$1")}%`;
}

function maximumSwapProtection(markets: AllocationMarketPlan[]): string {
  let maximumBps = 0n;
  for (const market of markets) {
    const quoted = BigInt(market.quotedMemeOut);
    const minimum = BigInt(market.minimumMemeOut);
    if (quoted > 0n && minimum <= quoted) {
      const bps = ((quoted - minimum) * 10_000n) / quoted;
      if (bps > maximumBps) maximumBps = bps;
    }
  }
  return `${(Number(maximumBps) / 100).toFixed(1)}% max`;
}

function relayChainIcon(chainId: number): string {
  return `https://assets.relay.link/icons/${chainId}/light.png`;
}

function trimEth(value: bigint): string {
  const formatted = formatEther(value);
  const [whole, fraction = ""] = formatted.split(".");
  return fraction ? `${whole}.${fraction.slice(0, 6).replace(/0+$/, "") || "0"}` : whole!;
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

function geckoPoolUrl(pool: string): string {
  return `https://www.geckoterminal.com/robinhood/pools/${pool.toLowerCase()}`;
}

function VenueTrail({ chain }: { chain: IndexChain }) {
  return <span className="venue-trail">
    <BrandLogo brand={chain} label={chainLabel(chain)} compact />
    <span>{chainLabel(chain)}</span>
  </span>;
}

function WalletIcon() { return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7.5A2.5 2.5 0 0 1 6.5 5H18v3H6.5a1.5 1.5 0 0 0 0 3H20v8H6a2 2 0 0 1-2-2V7.5Z"/><circle cx="16.5" cy="15" r="1.25"/></svg>; }
function ChevronIcon() { return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 9 5 5 5-5" /></svg>; }
function CheckIcon() { return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 4 4L19 6" /></svg>; }
function RefreshIcon() { return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 7v5h-5M4 17v-5h5" /><path d="M6.1 9a7 7 0 0 1 11.2-2L20 12M4 12l2.7 5a7 7 0 0 0 11.2-2" /></svg>; }
function XIcon() { return <svg className="x-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231Zm-1.161 17.52h1.833L7.084 4.126H5.117Z" /></svg>; }
