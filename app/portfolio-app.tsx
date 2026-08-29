"use client";

import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import { usePrivy, useWallets } from "@privy-io/react-auth";
import {
  useSignTransaction,
  useWallets as useSolanaWallets,
  type ConnectedStandardSolanaWallet,
} from "@privy-io/react-auth/solana";
import { Keypair } from "@solana/web3.js";
import { formatEther, parseEther } from "viem";
import { lightRowToView, type PositionView } from "./lib/cards";
import { type ChainSlug } from "./lib/chains";
import {
  type CuratedMarket,
  type MarketsPayload,
  type MarketStats,
  type MemeIndexPlan,
  type PositionActionPlan,
  type SolanaCuratedMarket,
} from "./lib/portfolio-types";
import { type SolanaPositionActionPlan } from "./lib/solana-position-server";
import { executeSolanaPositionAction, executeSolanaZaps } from "./lib/solana-wallet";
import { type SolanaZapPlan } from "./lib/solana-zap-server";
import { isShotQuery, SHOT_VIEWS } from "./lib/shot-fixture";
import { relaySucceeded, sendWalletCalls, type ConnectedEvmWallet } from "./lib/wallet-calls";

type ViewTab = "overview" | "markets" | "positions";
type PlanState = { kind: "idle" | "planning" | "ready" | "signing" | "waiting" | "submitted" | "error"; message?: string };
type AnyPositionActionPlan = PositionActionPlan | SolanaPositionActionPlan;
type IndexChain = ChainSlug | "solana";
type IndexMarket = {
  market: CuratedMarket | SolanaCuratedMarket;
  chain: IndexChain;
  indexWeightBps: number;
};

const CHAIN_SHARES: Record<IndexChain, number> = { base: 6_000, robinhood: 1_500, solana: 2_500 };
const BRAND_ASSETS = {
  base: "https://assets.relay.link/icons/8453/light.png",
  robinhood: "https://assets.relay.link/icons/4663/light.png",
  solana: "https://assets.relay.link/icons/792703809/light.png",
  uniswap: "https://avatars.githubusercontent.com/u/36115574?v=4",
  aerodrome: "https://avatars.githubusercontent.com/u/139490796?v=4",
  meteora: "https://avatars.githubusercontent.com/u/126859799?v=4",
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
  stats: [],
  source: "",
};

export function PortfolioApp() {
  const { ready, authenticated, login, logout, user } = usePrivy();
  const { wallets } = useWallets();
  const { ready: solanaReady, wallets: solanaWallets } = useSolanaWallets();
  const { signTransaction } = useSignTransaction();
  const [tab, setTab] = useState<ViewTab>("overview");
  const [amount, setAmount] = useState("0.10");
  const [markets, setMarkets] = useState<MarketsPayload>(EMPTY_MARKETS);
  const [marketsState, setMarketsState] = useState<"loading" | "ready" | "error">("loading");
  const [positions, setPositions] = useState<PositionView[]>([]);
  const [positionsState, setPositionsState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [previewMode, setPreviewMode] = useState(false);
  const [plan, setPlan] = useState<MemeIndexPlan | null>(null);
  const [planState, setPlanState] = useState<PlanState>({ kind: "idle" });
  const [actionPlan, setActionPlan] = useState<AnyPositionActionPlan | null>(null);
  const [actionState, setActionState] = useState<PlanState>({ kind: "idle" });

  const wallet = useMemo(() => {
    const preferred = user?.wallet?.address?.toLowerCase();
    return wallets.find((candidate) => candidate.address.toLowerCase() === preferred) ?? wallets[0];
  }, [user?.wallet?.address, wallets]);
  const solanaWallet = useMemo(() => solanaWallets.find((candidate) => candidate.standardWallet.name.toLowerCase().includes("privy")) ?? solanaWallets[0], [solanaWallets]);
  const address = wallet?.address ?? user?.wallet?.address;
  const solanaAddress = solanaWallet?.address;

  const loadPositions = useCallback(async () => {
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
      const settled = await Promise.allSettled(requests);
      const payloads = settled.filter((result): result is PromiseFulfilledResult<unknown[]> => result.status === "fulfilled").map((result) => result.value);
      if (!payloads.length) throw new Error("Could not read any wallet positions");
      const next = payloads.flat().map((row) => row && typeof row === "object" ? lightRowToView(row as Record<string, unknown>) : null)
        .filter((row): row is PositionView => Boolean(row));
      setPositions(next);
      setPositionsState("ready");
    } catch {
      setPositions([]);
      setPositionsState("error");
    }
  }, [address, authenticated, solanaAddress, solanaReady]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const requested = params.get("view");
    if (requested === "markets" || requested === "positions") setTab(requested);
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
  }, [amount]);

  const activeMarkets = useMemo<IndexMarket[]>(() => {
    const evm = markets.catalog.chains.flatMap((chain) => chain.markets
      .filter((market) => market.status === "active")
      .map((market) => ({ market, chain: chain.slug, indexWeightBps: Math.round((market.weightBps * CHAIN_SHARES[chain.slug]) / 10_000) })));
    const solana = markets.solana.markets
      .filter((market) => market.status === "active")
      .map((market) => ({ market, chain: "solana" as const, indexWeightBps: Math.round((market.weightBps * CHAIN_SHARES.solana) / 10_000) }));
    return [...evm, ...solana];
  }, [markets]);
  const stats = useMemo(() => new Map(markets.stats.map((row) => [row.marketId, row])), [markets.stats]);
  const feeApr = weightedFeeApr(activeMarkets, stats);

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
    if (!solanaReady || !solanaWallet) {
      setPlanState({ kind: "error", message: "Your Solana wallet is still being created. Try again in a moment." });
      return;
    }
    let amountWei: bigint;
    try {
      amountWei = parseEther(amount);
    } catch {
      setPlanState({ kind: "error", message: "Enter a valid ETH amount." });
      return;
    }
    setPlanState({ kind: "planning", message: "Getting the latest route for your deposit…" });
    setPlan(null);
    try {
      const response = await fetch("/api/portfolio/index", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ owner: address, solanaOwner: solanaWallet.address, amountWei: amountWei.toString() }),
      });
      const payload = await response.json() as { plan?: MemeIndexPlan; error?: string };
      if (!response.ok || !payload.plan) throw new Error(payload.error ?? "Could not prepare the index deposit");
      setPlan(payload.plan);
      setPlanState({ kind: "ready", message: "Review your deposit and fees before continuing." });
    } catch (error) {
      setPlanState({ kind: "error", message: error instanceof Error ? error.message : "Could not prepare the index deposit" });
    }
  }

  async function executeIndex() {
    if (!plan || !wallet || !solanaWallet || !address) return;
    if (Date.now() >= Date.parse(plan.expiresAt)) {
      setPlanState({ kind: "error", message: "This deposit quote expired. Review a fresh one before continuing." });
      return;
    }
    const connected = wallet as unknown as ConnectedEvmWallet;
    const [fund, robinhood, solana] = plan.stages;
    try {
      setPlanState({ kind: "signing", message: "Make markets: approve your deposit on Base." });
      await sendWalletCalls({ wallet: connected, owner: address, chainId: fund.chainId, transactions: fund.transactions });
      setPlanState({ kind: "waiting", message: "Moving your deposit to Robinhood and Solana…" });
      await Promise.all([
        waitForRelay(fund.robinhoodBridge.statusPath),
        waitForRelay(fund.solanaBridge.statusPath),
      ]);

      setPlanState({ kind: "signing", message: "Base is live. Approve your Robinhood markets." });
      await sendWalletCalls({ wallet: connected, owner: address, chainId: robinhood.chainId, transactions: robinhood.transactions });

      const zaps: Array<{ plan: SolanaZapPlan; position: Keypair }> = [];
      for (const [marketIndex, market] of solana.markets.entries()) {
        setPlanState({ kind: "planning", message: `Preparing ${market.symbol} on Solana · ${marketIndex + 1} of ${solana.markets.length}` });
        const position = Keypair.generate();
        const response = await fetch("/api/portfolio/solana", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ owner: solanaWallet.address, marketId: market.marketId, amountLamports: market.amountLamports, position: position.publicKey.toBase58() }),
        });
        const payload = await response.json() as { plan?: SolanaZapPlan; error?: string };
        if (!response.ok || !payload.plan) throw new Error(payload.error ?? `Could not prepare ${market.symbol} on Solana`);
        zaps.push({ plan: payload.plan, position });
      }
      await executeSolanaZaps({
        zaps,
        wallet: solanaWallet as ConnectedStandardSolanaWallet,
        signTransaction,
        onProgress: ({ market: symbol, step, total, label }) => setPlanState({
          kind: step === 0 ? "signing" : "waiting",
          message: step === 0 ? "Approve every Solana market in one wallet review." : `${label} · ${symbol} · ${step} of ${total}`,
        }),
      });
      setPlanState({ kind: "submitted", message: "Your market positions are being confirmed. They will appear here after the networks settle." });
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
      constituentCount={activeMarkets.length}
      stats={stats}
      onLogin={() => void login()}
      onAction={preparePositionAction}
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
          <span className="una-mark" aria-hidden="true"><i /><b /></span>
          <span>Una</span>
        </button>
        <nav aria-label="Primary navigation">
          {([{ id: "overview", label: "Make" }, { id: "markets", label: "Index" }, { id: "positions", label: "Positions" }] as const).map((item) => (
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
            <>
              <section className="index-hero">
                <div className="hero-stage">
                  <div className="hero-copy">
                    <h1>Make meme markets.</h1>
                    <p>One deposit. Eight positions. Fees from every trade.</p>
                  </div>
                  <IndexShowcase markets={activeMarkets} stats={stats} loading={marketsState === "loading"} />
                </div>
                <MarketAction
                  amount={amount}
                  onAmount={setAmount}
                  markets={activeMarkets}
                  stats={stats}
                  loading={marketsState === "loading"}
                  feeApr={feeApr}
                  ready={ready && solanaReady}
                  onPrepare={() => void prepareIndex()}
                  plan={plan}
                  state={planState}
                  onExecute={() => void executeIndex()}
                  onCancel={() => { setPlan(null); setPlanState({ kind: "idle" }); }}
                />
              </section>
              <section className="index-main">
                <MarketLedger markets={activeMarkets} stats={stats} state={marketsState} compact />
                {positionLedger}
              </section>
            </>
          ) : tab === "markets" ? (
            <section className="index-main markets-view">
              <header className="index-title-row">
                <div><h1>Eight markets. One index.</h1><p>Live pool performance across Base, Robinhood, and Solana.</p></div>
                <button className="icon-button" type="button" onClick={() => void (previewMode ? Promise.resolve() : loadPositions())} aria-label="Refresh market data"><RefreshIcon /></button>
              </header>
              <MarketLedger markets={activeMarkets} stats={stats} state={marketsState} />
            </section>
          ) : (
            <section className="index-main markets-view">
              {positionLedger}
            </section>
          )}
      </div>
    </main>
  );
}

function IndexShowcase({ markets, stats, loading }: { markets: IndexMarket[]; stats: Map<string, MarketStats>; loading: boolean }) {
  return <div className="index-showcase" aria-label="Meme market index">
    <div className={`hero-token-field ${loading ? "is-loading" : ""}`}>
      {(loading ? Array.from({ length: 8 }, (_, index) => ({ market: { id: String(index), symbol: "", color: "" } })) : markets).map(({ market }, index) => (
        <span className="hero-token" key={market.id} style={{ "--token-index": index } as CSSProperties}>
          <TokenIcon symbol={market.symbol} src={stats.get(market.id)?.tokenImageUrl} color={market.color} />
          {market.symbol ? <b>{market.symbol}</b> : null}
        </span>
      ))}
    </div>
    <div className="brand-rail" aria-label="Networks and venues">
      <BrandLogo brand="base" label="Base" />
      <BrandLogo brand="robinhood" label="Robinhood" />
      <BrandLogo brand="solana" label="Solana" />
      <span className="brand-divider" aria-hidden="true" />
      <BrandLogo brand="uniswap" label="Uniswap" />
      <BrandLogo brand="aerodrome" label="Aerodrome" />
      <BrandLogo brand="meteora" label="Meteora" />
    </div>
  </div>;
}

function MarketAction({ amount, onAmount, markets, stats, loading, feeApr, ready, onPrepare, plan, state, onExecute, onCancel }: {
  amount: string;
  onAmount: (amount: string) => void;
  markets: IndexMarket[];
  stats: Map<string, MarketStats>;
  loading: boolean;
  feeApr: number | null;
  ready: boolean;
  onPrepare: () => void;
  plan: MemeIndexPlan | null;
  state: PlanState;
  onExecute: () => void;
  onCancel: () => void;
}) {
  const constituentCount = markets.length;
  return (
    <aside className="market-action" aria-label="Make markets">
      <label className="amount-field">
        <span>You deposit</span>
        <span className="amount-input"><input inputMode="decimal" value={amount} onChange={(event) => onAmount(event.target.value)} aria-label="ETH amount" /><b>ETH</b></span>
      </label>

      <div className={`market-output ${loading ? "is-loading" : ""}`} aria-label="Index positions">
        <span><small>You get</small><b>{constituentCount || "Eight"} LP positions</b><em>Across three networks</em></span>
        <span className="market-stack" aria-label={loading ? "Reading markets" : markets.map(({ market }) => market.symbol).join(", ")}>
          {loading ? Array.from({ length: 5 }, (_, index) => <i key={index} />) : markets.map(({ market }) => <TokenIcon key={market.id} symbol={market.symbol} src={stats.get(market.id)?.tokenImageUrl} color={market.color} />)}
        </span>
      </div>

      <div className="action-economics">
        <div><span>Fee APR</span><b>{formatFeeApr(feeApr)}</b></div>
        <small>24h annualized</small>
      </div>

      {state.kind !== "idle" ? <PlanPreview plan={plan} state={state} onExecute={onExecute} onCancel={onCancel} /> : (
        <button className="fund-button" type="button" disabled={!ready} onClick={onPrepare}>
          {!ready ? "Preparing wallets…" : "Make markets"}<ArrowIcon />
        </button>
      )}
      <p className="action-assurance"><span>3 wallet approvals</span><span>Self-custodial</span></p>
    </aside>
  );
}

function PlanPreview({ plan, state, onExecute, onCancel }: { plan: MemeIndexPlan | null; state: PlanState; onExecute: () => void; onCancel: () => void }) {
  const feeWei = plan
    ? BigInt(plan.stages[0].allocation.serviceFeeWei) + BigInt(plan.stages[1].allocation.serviceFeeWei) + BigInt(plan.stages[0].solanaServiceFeeWei)
    : 0n;
  const relayFee = plan
    ? Number(plan.stages[0].robinhoodBridge.relayerFeeUsd ?? 0) + Number(plan.stages[0].solanaBridge.relayerFeeUsd ?? 0)
    : 0;
  const busy = state.kind === "planning" || state.kind === "signing" || state.kind === "waiting";
  const title = state.kind === "ready" ? "Review deposit" : state.kind === "error" ? "Deposit not ready" : state.kind === "submitted" ? "Deposit submitted" : "Preparing deposit";
  return (
    <section className={`plan-preview is-${state.kind}`} aria-live="polite">
      <header><span>{title}</span><button type="button" onClick={onCancel} disabled={busy}>Cancel</button></header>
      <p>{state.message}</p>
      {plan ? <dl>
        <div><dt>Deposit</dt><dd>{trimEth(BigInt(plan.totalAmountWei))} ETH</dd></div>
        <div><dt>Markets</dt><dd>{plan.constituentCount} across 3 networks</dd></div>
        <div><dt>Una fee</dt><dd>{trimEth(feeWei)} ETH</dd></div>
        <div><dt>Network costs</dt><dd>{relayFee > 0 ? `$${relayFee.toFixed(2)}` : "Included in quote"}</dd></div>
      </dl> : <div className="plan-loading"><i /><i /><i /></div>}
      {state.kind === "ready" && plan ? <>
        <p className="approval-note">Your wallet will ask for {plan.expectedWalletSteps} approvals across Base, Robinhood, and Solana. Each approval creates positions you own.</p>
        <p className="risk-note">Meme prices can fall, and trading fees may not cover losses.</p>
        <button className="fund-button" type="button" onClick={onExecute}>Make markets<ArrowIcon /></button>
      </> : null}
      {state.kind === "error" ? <button className="secondary-button" type="button" onClick={onCancel}>Try again</button> : null}
    </section>
  );
}

function MarketLedger({ markets, stats, state, compact = false }: { markets: IndexMarket[]; stats: Map<string, MarketStats>; state: "loading" | "ready" | "error"; compact?: boolean }) {
  return (
    <section className={`market-ledger ${compact ? "is-compact" : ""}`}>
      <header><h2>The index</h2><span className="market-data-note">{markets.length || 8} markets</span></header>
      <div className="market-table-wrap">
        <table className={`market-table ${compact ? "is-compact" : ""}`}>
          <thead><tr><th>Market</th><th>Fee APR</th><th>24h volume</th><th>TVL</th><th>Venue</th>{compact ? null : <th>Risk</th>}</tr></thead>
          <tbody>
            {state === "loading" ? Array.from({ length: compact ? 5 : 8 }, (_, index) => <tr className="skeleton-row" key={index}><td colSpan={compact ? 5 : 6}><i /></td></tr>) : null}
            {state === "error" ? <tr><td colSpan={compact ? 5 : 6} className="table-message">Market data is temporarily unavailable.</td></tr> : null}
            {state === "ready" ? markets.map(({ market, chain }) => {
              const row = stats.get(market.id);
              const quote = chain === "solana" ? "SOL" : "WETH";
              return <tr key={market.id}>
                <td><span className="pair-cell"><TokenIcon symbol={market.symbol} src={row?.tokenImageUrl} color={market.color} /><span><b>{market.symbol}/{quote}</b><small>{market.name}</small></span></span></td>
                <td><b className="fee-apr">{formatFeeApr(row?.trailingFeeAprPct ?? null)}</b><small className="cell-note">24h annualized</small></td>
                <td>{compactMoney(row?.volume24hUsd)}</td>
                <td>{compactMoney(row?.liquidityUsd)}</td>
                <td><VenueTrail chain={chain} protocol={market.protocol} /></td>
                {compact ? null : <td><span className={`risk-label is-${market.risk}`}>{market.risk === "established" ? "Established" : "Emerging"}</span></td>}
              </tr>;
            }) : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function PositionLedger({ authenticated, positions, state, constituentCount, stats, onLogin, onAction, actionPlan, actionState, onExecute, onCancel }: {
  authenticated: boolean;
  positions: PositionView[];
  state: "idle" | "loading" | "ready" | "error";
  constituentCount: number;
  stats: Map<string, MarketStats>;
  onLogin: () => void;
  onAction: (position: PositionView, action: "compound" | "withdraw") => void;
  actionPlan: AnyPositionActionPlan | null;
  actionState: PlanState;
  onExecute: () => void;
  onCancel: () => void;
}) {
  const summary = summarizePositions(positions, constituentCount);
  return (
    <section className="position-ledger" id="positions">
      <header><h2>Your positions</h2>{!authenticated ? <button type="button" onClick={onLogin}>Connect</button> : null}</header>
      {actionState.kind !== "idle" ? (
        <section className={`action-preview is-${actionState.kind}`} aria-live="polite">
          <div><b>{actionPlan ? `${actionPlan.kind === "compound" ? "Collect fees" : "Withdraw"} · ${actionPlan.pair}` : "Preparing your position"}</b><p>{actionState.message}</p></div>
          {actionPlan ? <span>{(actionPlan.serviceFeeBps / 100).toFixed(2)}% Una fee</span> : null}
          <div className="action-buttons">{actionState.kind === "ready" ? <button className="small-primary" type="button" onClick={onExecute}>Approve</button> : null}<button type="button" onClick={onCancel} disabled={actionState.kind === "planning" || actionState.kind === "signing"}>Close</button></div>
        </section>
      ) : null}
      {!authenticated ? <div className="position-empty"><LockIcon /><p>Connect to see the positions held by your wallets.</p></div> : null}
      {authenticated && state === "loading" ? <div className="position-empty"><p>Reading your wallets…</p></div> : null}
      {authenticated && state === "error" ? <div className="position-empty"><p>We could not read your positions. Nothing has moved.</p></div> : null}
      {authenticated && state === "ready" && positions.length === 0 ? <div className="position-empty"><p>Your positions will appear here after your first deposit.</p></div> : null}
      {positions.length ? <section className="portfolio-summary" aria-label="Portfolio summary">
        <div className="coverage-stat">
          <span>Index coverage</span>
          <strong>{summary.coverage}<small> of {constituentCount || 8} markets</small></strong>
          <div className="coverage-track" role="progressbar" aria-label="Index market coverage" aria-valuemin={0} aria-valuemax={constituentCount || 8} aria-valuenow={summary.coverage}><i style={{ width: `${summary.coveragePct}%` }} /></div>
          <p>{summary.coverage === (constituentCount || 8) ? "Full index live" : `${(constituentCount || 8) - summary.coverage} markets not found yet`}</p>
        </div>
        <div><span>Position value</span><strong>{summary.priced ? money(summary.valueUsd) : "—"}</strong><small>{summary.priced} of {positions.length} priced</small></div>
        <div><span>Fees ready</span><strong>{summary.feesPriced ? money(summary.feesUsd) : "—"}</strong><small>Unclaimed across priced positions</small></div>
        <div><span>Earning now</span><strong>{summary.earning}</strong><small>of {positions.length} positions in range</small></div>
        <div><span>Fee APR</span><strong>{formatFeeAprFraction(summary.feeApr)}</strong><small>Across priced positions</small></div>
      </section> : null}
      {positions.length ? <div className="position-list">{positions.map((position) => <article key={`${position.chain}-${position.protocol}-${position.positionManager ?? "default"}-${position.tokenId}`}>
        <span className="position-pair"><TokenIcon symbol={position.symbol0} src={position.marketId ? stats.get(position.marketId)?.tokenImageUrl : undefined} /><span><b>{position.pair}</b><small>{position.chainLabel}{position.venueLabel ? ` · ${position.venueLabel}` : ""}</small></span></span>
        <span><small>Value</small><b>{position.lpUsd === undefined ? "—" : money(position.lpUsd)}</b></span>
        <span><small>Fees</small><b>{position.feesUsd === undefined ? "—" : money(position.feesUsd)}</b></span>
        <span><small>Fee APR</small><b>{formatFeeAprFraction(position.feeApr ?? null)}</b></span>
        <span className={`position-range is-${position.status}`}>{position.status === "in-range" ? "In range" : position.status === "oor" ? "Out of range" : "Closed"}</span>
        <span className="position-actions"><button type="button" onClick={() => onAction(position, "compound")} disabled={position.closed || !position.inRange} title={!position.inRange ? "Rebalancing is required before compounding" : undefined}>Compound</button><button type="button" onClick={() => onAction(position, "withdraw")} disabled={position.closed}>Withdraw</button></span>
      </article>)}</div> : null}
    </section>
  );
}

function summarizePositions(positions: PositionView[], constituentCount: number) {
  const markets = new Set(positions.map((position) => position.marketId ?? `${position.chain}:${position.pair}`));
  const priced = positions.filter((position) => position.lpUsd !== undefined);
  const feesPriced = positions.filter((position) => position.feesUsd !== undefined);
  const aprPositions = positions.filter((position) => position.feeApr !== undefined);
  const aprWeight = aprPositions.reduce((sum, position) => sum + (position.lpUsd ?? 1), 0);
  const total = constituentCount || 8;
  const coverage = Math.min(total, markets.size);
  return {
    coverage,
    coveragePct: total ? (coverage / total) * 100 : 0,
    priced: priced.length,
    valueUsd: priced.reduce((sum, position) => sum + position.lpUsd!, 0),
    feesPriced: feesPriced.length,
    feesUsd: feesPriced.reduce((sum, position) => sum + position.feesUsd!, 0),
    earning: positions.filter((position) => position.status === "in-range").length,
    feeApr: aprWeight ? aprPositions.reduce((sum, position) => sum + position.feeApr! * (position.lpUsd ?? 1), 0) / aprWeight : null,
  };
}

function weightedFeeApr(markets: IndexMarket[], stats: Map<string, MarketStats>): number | null {
  const available = markets.filter(({ market }) => stats.get(market.id)?.trailingFeeAprPct != null);
  if (!available.length) return null;
  const weight = available.reduce((sum, row) => sum + row.indexWeightBps, 0);
  return available.reduce((sum, row) => sum + (stats.get(row.market.id)!.trailingFeeAprPct! * row.indexWeightBps) / weight, 0);
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

function signedMoney(value: number): string {
  return `${value > 0 ? "+" : ""}${money(value)}`;
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
function RefreshIcon() { return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 11a8 8 0 1 0-2.34 5.66M20 11V5m0 6h-6"/></svg>; }
function LockIcon() { return <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="10" width="14" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg>; }
function ArrowIcon() { return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14m-5-5 5 5-5 5"/></svg>; }
