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
  type PositionActionPlan,
  type SolanaCuratedMarket,
} from "./lib/portfolio-types";
import { type SolanaPositionActionPlan } from "./lib/solana-position-server";
import { executeSolanaPositionAction } from "./lib/solana-wallet";
import { isShotQuery, SHOT_VIEWS } from "./lib/shot-fixture";
import { relaySucceeded, sendWalletCalls, type ConnectedEvmWallet } from "./lib/wallet-calls";

type ViewTab = "overview" | "markets";
type PlanState = { kind: "idle" | "planning" | "ready" | "signing" | "waiting" | "submitted" | "error"; message?: string };
type AnyPositionActionPlan = PositionActionPlan | SolanaPositionActionPlan;
type IndexChain = ChainSlug | "solana";
type IndexMarket = {
  market: CuratedMarket | SolanaCuratedMarket;
  chain: IndexChain;
  indexWeightBps: number;
};

const INDEX_MARKET_COUNT = 6;
const FOMO_URL = "https://fomo.family/";
const GECKO_URL = "https://www.geckoterminal.com/robinhood/pools";
const BRAND_ASSETS = {
  base: "https://assets.relay.link/icons/8453/light.png",
  robinhood: "https://assets.relay.link/icons/4663/light.png",
  solana: "https://assets.relay.link/icons/792703809/light.png",
  uniswap: "https://avatars.githubusercontent.com/u/36115574?v=4",
  aerodrome: "https://avatars.githubusercontent.com/u/139490796?v=4",
  meteora: "https://avatars.githubusercontent.com/u/126859799?v=4",
  fomo: "https://fomo.family/favicon.svg",
  gecko: "https://www.geckoterminal.com/favicon.ico",
} as const;

const EMPTY_MARKETS: MarketsPayload = {
  catalog: { version: 1, updatedAt: "", fees: { allocateBps: 15, withdrawBps: 15, rebalanceBps: 15, compoundBps: 200 }, chains: [] },
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
  const [amount, setAmount] = useState("1.00");
  const [sourceChainId, setSourceChainId] = useState(8453);
  const [markets, setMarkets] = useState<MarketsPayload>(EMPTY_MARKETS);
  const [marketsState, setMarketsState] = useState<"loading" | "ready" | "error">("loading");
  const [positions, setPositions] = useState<PositionView[]>([]);
  const [positionsState, setPositionsState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [previewMode, setPreviewMode] = useState(false);
  const [plan, setPlan] = useState<RobinhoodIndexPlan | null>(null);
  const [planState, setPlanState] = useState<PlanState>({ kind: "idle" });
  const [actionPlan, setActionPlan] = useState<AnyPositionActionPlan | null>(null);
  const [actionState, setActionState] = useState<PlanState>({ kind: "idle" });
  const positionsRequestRef = useRef(0);

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
    } catch {
      if (requestId !== positionsRequestRef.current) return;
      setPositions([]);
      setPositionsState("error");
    }
  }, [address, authenticated, solanaAddress, solanaReady]);

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
      .catch(() => setMarketsState("error"));
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

  function changeTab(next: ViewTab) {
    setTab(next);
    const url = new URL(window.location.href);
    if (next === "overview") url.searchParams.delete("view");
    else url.searchParams.set("view", next);
    window.history.replaceState(null, "", `${url.pathname}${url.search}`);
  }

  async function prepareIndex() {
    if (!authenticated || !address) {
      await login();
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
    } catch (error) {
      setPlanState({ kind: "error", message: error instanceof Error ? error.message : "Could not prepare the index deposit" });
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
      if (funding) {
        setPlanState({ kind: "signing", message: `Approve your ETH deposit from ${funding.chainLabel}.` });
        await sendWalletCalls({ wallet: connected, owner: address, chainId: funding.chainId, transactions: funding.transactions });
        setPlanState({ kind: "waiting", message: "Moving your ETH to Robinhood Chain…" });
        await waitForRelay(funding.bridge.statusPath);
      }

      setPlanState({ kind: "signing", message: `Approve ${plan.constituentCount} Robinhood market positions.` });
      await sendWalletCalls({ wallet: connected, owner: address, chainId: robinhood.chainId, transactions: robinhood.transactions });
      setPlanState({ kind: "submitted", message: "Your Robinhood positions are being confirmed. They will appear in Markets shortly." });
      window.setTimeout(() => void loadPositions(), 8_000);
    } catch (error) {
      setPlanState({ kind: "error", message: error instanceof Error ? error.message : "The deposit could not be completed" });
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
    }
  }

  const positionLedger = (
    <PositionLedger
      authenticated={authenticated || previewMode}
      positions={positions}
      state={positionsState}
      stats={stats}
      onLogin={() => void login()}
      onStart={() => changeTab("overview")}
      onRetry={() => void loadPositions()}
      onAction={preparePositionAction}
      markets={selectedMarkets}
      actionPlan={actionPlan}
      actionState={actionState}
      onExecute={executePositionAction}
      onCancel={() => { setActionPlan(null); setActionState({ kind: "idle" }); }}
    />
  );

  return (
    <main className="index-app">
      <header className="index-nav">
        <button className="una-wordmark" type="button" onClick={() => changeTab("overview")} aria-label="Una overview">
          <picture className="una-mark" aria-hidden="true">
            <source media="(prefers-color-scheme: dark)" srcSet="/brand/una-mascot-dark.svg" />
            <img src="/brand/una-mascot-light.svg" alt="" />
          </picture>
          <span>Una</span>
        </button>
        <nav aria-label="Primary navigation">
          {([{ id: "overview", label: "Make" }, { id: "markets", label: "Markets" }] as const).map((item) => (
            <button key={item.id} type="button" className={tab === item.id ? "is-active" : ""} onClick={() => changeTab(item.id)}>{item.label}</button>
          ))}
        </nav>
        <div className="nav-actions">
          {!ready ? <span className="wallet-skeleton" /> : authenticated ? (
            <button className="wallet-button" type="button" onClick={() => void logout()} title="Sign out">
              <WalletIcon /> {short(address ?? "Wallet")}
            </button>
          ) : (
            <button className="wallet-button wallet-connect" type="button" onClick={() => void login()}><WalletIcon /> Connect</button>
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
                    <p>Deposit ETH into a curated index of meme markets, starting with Robinhood Chain.</p>
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
                <div><h1>Robinhood Una Index</h1><p>{positions.length ? `${positions.length} position${positions.length === 1 ? "" : "s"} in this wallet.` : "Una agents regularly review which markets qualify."}</p></div>
                <ReferenceLinks />
              </header>
              {positionLedger}
              <section className="index-section">
                <header className="section-title">
                  <div><h2>Inside the index</h2><p>Actively curated as meme markets change.</p></div>
                  <span>v{markets.catalog.version}</span>
                </header>
                <MarketLedger markets={activeMarkets} stats={stats} state={marketsState} policy={markets.index} />
              </section>
            </section>
          )}
      </div>
    </main>
  );
}

function IndexShowcase({ markets, stats, loading }: { markets: IndexMarket[]; stats: Map<string, MarketStats>; loading: boolean }) {
  return <div className="index-showcase" aria-label="Robinhood Una Index">
    <div className={`hero-token-field ${loading ? "is-loading" : ""}`}>
      {(loading ? Array.from({ length: INDEX_MARKET_COUNT }, (_, index) => ({ market: { id: String(index), symbol: "", color: "" } })) : markets).map(({ market }, index) => (
        <span className="hero-token" key={market.id} style={{ "--token-index": index } as CSSProperties}>
          <TokenIcon symbol={market.symbol} src={stats.get(market.id)?.tokenImageUrl} color={market.color} />
          {market.symbol ? <b>{market.symbol}</b> : null}
        </span>
      ))}
    </div>
    <div className="brand-rail" aria-label="Network and venue">
      <BrandLogo brand="robinhood" label="Robinhood" />
      <BrandLogo brand="uniswap" label="Uniswap" />
    </div>
    <ReferenceLinks compact />
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

      <label className="funding-choice">
        <span>Pay from</span>
        <span>
          <img src={relayChainIcon(sourceChainId)} alt="" aria-hidden="true" />
          <select id="source-chain" name="sourceChain" value={sourceChainId} onChange={(event) => onSourceChain(Number(event.target.value))} aria-label="Pay from network">
            {fundingChains.map((chain) => <option value={chain.id} key={chain.id}>{chain.label}</option>)}
          </select>
        </span>
      </label>

      <div className={`market-output ${loading ? "is-loading" : ""}`} aria-label="Index markets">
        <span className="market-breadth">
          <span className="market-stack" aria-label={loading ? "Reading markets" : markets.map(({ market }) => market.symbol).join(", ")}>
            {loading ? Array.from({ length: INDEX_MARKET_COUNT }, (_, index) => <i key={index} />) : markets.map(({ market }) => <TokenIcon key={market.id} symbol={market.symbol} src={stats.get(market.id)?.tokenImageUrl} color={market.color} />)}
          </span>
          <span><b>{loading ? INDEX_MARKET_COUNT : constituentCount} markets</b><small>{constituentCount >= maximumConstituents ? "Full index" : "More with a larger deposit"}</small></span>
        </span>
        <span className="action-economics"><small>24h fee APR</small><b>{formatFeeApr(feeApr)}</b></span>
      </div>

      {state.kind !== "idle" ? <PlanPreview plan={plan} state={state} onExecute={onExecute} onCancel={onCancel} /> : (
        <button className="fund-button" type="button" disabled={!ready || loading || Boolean(amountError)} onClick={onPrepare}>
          {!ready ? "Preparing wallets…" : loading ? "Reading markets…" : "Make markets"}<ArrowIcon />
        </button>
      )}
      <p className="action-assurance">Robinhood Chain · Self-custodial</p>
    </aside>
  );
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
      {plan ? <dl>
        <div><dt>Deposit</dt><dd>{trimEth(BigInt(plan.totalAmountWei))} ETH</dd></div>
        <div><dt>Pay from</dt><dd>{plan.sourceChainLabel}</dd></div>
        <div><dt>Markets</dt><dd>{plan.constituentCount} on Robinhood</dd></div>
        <div><dt>Una fee</dt><dd>{trimEth(feeWei)} ETH</dd></div>
        {funding ? <><div><dt>Relay fee</dt><dd>{relayFee > 0 ? `$${relayFee.toFixed(2)}` : "Included"}</dd></div><div><dt>Bridge price change</dt><dd>{formatPercent(relayImpact)}</dd></div></> : null}
        <div><dt>Swap protection</dt><dd>{swapProtection}</dd></div>
        <div><dt>Network fee</dt><dd>Shown by your wallet</dd></div>
      </dl> : <div className="plan-loading"><i /><i /><i /></div>}
      {state.kind === "ready" && plan ? <>
        <p className="approval-note">{funding ? `Two wallet approvals: deposit from ${plan.sourceChainLabel}, then open ${plan.constituentCount} market positions.` : `One wallet approval opens ${plan.constituentCount} market positions.`} Every position belongs to your wallet.</p>
        <p className="risk-note">Meme prices can fall, and trading fees may not cover losses.</p>
        <button className="fund-button" type="button" onClick={onExecute}>Make markets<ArrowIcon /></button>
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
        <table className="market-table">
          <thead><tr><th>Market</th><th>Fee APR</th><th>24h volume</th><th>Liquidity</th><th>Explore</th></tr></thead>
          <tbody>
            {state === "loading" ? Array.from({ length: INDEX_MARKET_COUNT }, (_, index) => <tr className="skeleton-row" key={index}><td colSpan={5}><i /></td></tr>) : null}
            {state === "error" ? <tr><td colSpan={5} className="table-message">Market data is temporarily unavailable.</td></tr> : null}
            {state === "ready" ? orderedMarkets.map(({ market, chain }) => {
              const row = stats.get(market.id);
              return <tr key={market.id}>
                <td><span className="pair-cell"><TokenIcon symbol={market.symbol} src={row?.tokenImageUrl} color={market.color} /><span><b>{market.symbol}/WETH</b><VenueTrail chain={chain} protocol={market.protocol} /></span></span></td>
                <td><b className="fee-apr">{formatFeeApr(row?.trailingFeeAprPct ?? null)}</b><small className="cell-note">Based on 24h fees</small></td>
                <td>{compactMoney(row?.volume24hUsd)}</td>
                <td>{compactMoney(row?.liquidityUsd)}</td>
                <td><span className="market-links"><a href={row?.sourceUrl ?? geckoPoolUrl(market.pool)} target="_blank" rel="noreferrer">Gecko</a><a href={uniswapSwapUrl(market.token)} target="_blank" rel="noreferrer">Trade</a></span></td>
              </tr>;
            }) : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function PositionLedger({ authenticated, positions, state, stats, markets, onLogin, onStart, onRetry, onAction, actionPlan, actionState, onExecute, onCancel }: {
  authenticated: boolean;
  positions: PositionView[];
  state: "idle" | "loading" | "ready" | "error";
  stats: Map<string, MarketStats>;
  markets: IndexMarket[];
  onLogin: () => void;
  onStart: () => void;
  onRetry: () => void;
  onAction: (position: PositionView, action: "compound" | "withdraw") => void;
  actionPlan: AnyPositionActionPlan | null;
  actionState: PlanState;
  onExecute: () => void;
  onCancel: () => void;
}) {
  const summary = summarizePositions(positions);
  const showPositions = authenticated && positions.length > 0;
  return (
    <section className="position-ledger" id="positions">
      {actionState.kind !== "idle" ? (
        <section className={`action-preview is-${actionState.kind}`} aria-live="polite">
          <div><b>{actionPlan ? `${actionPlan.kind === "compound" ? "Reinvest fees" : "Withdraw"} · ${actionPlan.pair}` : "Preparing your position"}</b><p>{actionState.message}{actionState.kind === "ready" && actionPlan?.kind === "compound" ? ` Collect fees, deduct Una’s ${(actionPlan.serviceFeeBps / 100).toFixed(0)}% fee, and add the rest back to this position.` : ""}</p></div>
          {actionPlan ? <span>{(actionPlan.serviceFeeBps / 100).toFixed(2)}% Una fee</span> : null}
          <div className="action-buttons">{actionState.kind === "ready" ? <button className="small-primary" type="button" onClick={onExecute}>Approve</button> : null}<button type="button" onClick={onCancel} disabled={actionState.kind === "planning" || actionState.kind === "signing"}>Close</button></div>
        </section>
      ) : null}
      {!authenticated ? <PortfolioEmpty variant="disconnected" markets={markets} stats={stats} onPrimary={onLogin} /> : null}
      {authenticated && (state === "idle" || state === "loading") ? <PortfolioEmpty variant="loading" markets={markets} stats={stats} /> : null}
      {authenticated && state === "error" ? <PortfolioEmpty variant="error" markets={markets} stats={stats} onPrimary={onRetry} /> : null}
      {authenticated && state === "ready" && positions.length === 0 ? <PortfolioEmpty variant="empty" markets={markets} stats={stats} onPrimary={onStart} /> : null}
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

function PortfolioEmpty({ variant, markets, stats, onPrimary }: {
  variant: "disconnected" | "loading" | "error" | "empty";
  markets: IndexMarket[];
  stats: Map<string, MarketStats>;
  onPrimary?: () => void;
}) {
  const content = variant === "disconnected"
    ? { title: "One wallet. Your markets.", body: "Connect to see every market position you own.", action: "Connect" }
    : variant === "error"
      ? { title: "We couldn’t load your positions.", body: "Try again to read your wallet.", action: "Try again" }
      : variant === "empty"
        ? { title: "Start making markets.", body: "Deposit ETH to open positions across Una’s index on Robinhood Chain.", action: "Make markets" }
        : { title: "Reading your positions.", body: "Your liquidity will appear here.", action: "" };
  return <section className={`portfolio-empty is-${variant}`} aria-live={variant === "loading" ? "polite" : undefined}>
    <div className="empty-copy">
      <h3>{content.title}</h3>
      <p>{content.body}</p>
      {onPrimary && content.action ? <button type="button" onClick={onPrimary}>{content.action}<ArrowIcon /></button> : null}
    </div>
    <div className="empty-route" aria-label="Robinhood Una Index">
      <span className="route-source"><WalletIcon /><small>Wallet</small></span>
      <span className="route-line"><i /><small>Curated index</small></span>
      <span className="route-destination">
        <span className="market-stack">
          {markets.length ? markets.map(({ market }) => <TokenIcon key={market.id} symbol={market.symbol} src={stats.get(market.id)?.tokenImageUrl} color={market.color} />) : Array.from({ length: INDEX_MARKET_COUNT }, (_, index) => <i key={index} />)}
        </span>
        <span className="empty-networks"><BrandLogo brand="robinhood" label="Robinhood" compact /><BrandLogo brand="uniswap" label="Uniswap" compact /></span>
      </span>
    </div>
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

function ReferenceLinks({ compact = false }: { compact?: boolean }) {
  return <nav className={`reference-links ${compact ? "is-compact" : ""}`} aria-label="Robinhood market research">
    <a href={FOMO_URL} target="_blank" rel="noreferrer"><img src={BRAND_ASSETS.fomo} alt="" />Discover on Fomo <span aria-hidden="true">↗</span></a>
    <a href={GECKO_URL} target="_blank" rel="noreferrer"><img src={BRAND_ASSETS.gecko} alt="" />Live pools <span aria-hidden="true">↗</span></a>
  </nav>;
}

function geckoPoolUrl(pool: string): string {
  return `https://www.geckoterminal.com/robinhood/pools/${pool.toLowerCase()}`;
}

function uniswapSwapUrl(token: string): string {
  return `https://app.uniswap.org/swap?chain=robinhood&inputCurrency=NATIVE&outputCurrency=${token}`;
}

function VenueTrail({ chain, protocol }: { chain: IndexChain; protocol: IndexMarket["market"]["protocol"] }) {
  const venue = chain === "solana" ? "meteora" : protocol === "AERODROME_SLIPSTREAM" ? "aerodrome" : "uniswap";
  const venueLabel = venue === "meteora" ? "Meteora" : venue === "aerodrome" ? "Aerodrome" : "Uniswap";
  return <span className="venue-trail">
    <BrandLogo brand={chain} label={chainLabel(chain)} compact />
    <BrandLogo brand={venue} label={venueLabel} compact />
    <span>{venueLabel}</span>
  </span>;
}

function WalletIcon() { return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7.5A2.5 2.5 0 0 1 6.5 5H18v3H6.5a1.5 1.5 0 0 0 0 3H20v8H6a2 2 0 0 1-2-2V7.5Z"/><circle cx="16.5" cy="15" r="1.25"/></svg>; }
function ArrowIcon() { return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14m-5-5 5 5-5 5"/></svg>; }
