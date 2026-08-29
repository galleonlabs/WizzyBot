"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePrivy, useWallets } from "@privy-io/react-auth";
import {
  useSignTransaction,
  useWallets as useSolanaWallets,
  type ConnectedStandardSolanaWallet,
} from "@privy-io/react-auth/solana";
import { Keypair } from "@solana/web3.js";
import { formatEther, parseEther } from "viem";
import { Chat } from "./chat";
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
import { executeSolanaZaps } from "./lib/solana-wallet";
import { type SolanaZapPlan } from "./lib/solana-zap-server";
import { isShotQuery, SHOT_VIEWS } from "./lib/shot-fixture";
import { relaySucceeded, sendWalletCalls, type ConnectedEvmWallet } from "./lib/wallet-calls";

type ViewTab = "overview" | "markets" | "agent";
type PlanState = { kind: "idle" | "planning" | "ready" | "signing" | "waiting" | "submitted" | "error"; message?: string };
type IndexChain = ChainSlug | "solana";
type IndexMarket = {
  market: CuratedMarket | SolanaCuratedMarket;
  chain: IndexChain;
  indexWeightBps: number;
};

const CHAIN_SHARES: Record<IndexChain, number> = { base: 6_000, robinhood: 1_500, solana: 2_500 };

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
  const [actionPlan, setActionPlan] = useState<PositionActionPlan | null>(null);
  const [actionState, setActionState] = useState<PlanState>({ kind: "idle" });

  const wallet = useMemo(() => {
    const preferred = user?.wallet?.address?.toLowerCase();
    return wallets.find((candidate) => candidate.address.toLowerCase() === preferred) ?? wallets[0];
  }, [user?.wallet?.address, wallets]);
  const solanaWallet = useMemo(() => solanaWallets.find((candidate) => candidate.standardWallet.name.toLowerCase().includes("privy")) ?? solanaWallets[0], [solanaWallets]);
  const address = wallet?.address ?? user?.wallet?.address;

  const loadPositions = useCallback(async () => {
    if (!authenticated || !address) {
      setPositions([]);
      setPositionsState("idle");
      return;
    }
    setPositionsState("loading");
    try {
      const payloads = await Promise.all((["base", "robinhood"] as const).map(async (chain) => {
        const response = await fetch(`/api/positions?owner=${encodeURIComponent(address)}&chain=${chain}`);
        const payload = await response.json() as { positions?: unknown[]; error?: string };
        if (!response.ok || payload.error) throw new Error(payload.error ?? `Could not load ${chain} positions`);
        return payload.positions ?? [];
      }));
      const next = payloads.flat().map((row) => row && typeof row === "object" ? lightRowToView(row as Record<string, unknown>) : null)
        .filter((row): row is PositionView => Boolean(row));
      setPositions(next);
      setPositionsState("ready");
    } catch {
      setPositions([]);
      setPositionsState("error");
    }
  }, [address, authenticated]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const requested = params.get("view");
    if (requested === "markets" || requested === "agent") setTab(requested);
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
  const metrics = portfolioMetrics(positions);
  const feePace = weightedFeePace(activeMarkets, stats);

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
    setPlanState({ kind: "planning", message: "Finding the cleanest route into every market…" });
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
      setPlanState({ kind: "ready", message: "Your deposit is ready. Una handles every market and network." });
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
      setPlanState({ kind: "waiting", message: "Una is moving your deposit into all three networks…" });
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
      setPlanState({ kind: "submitted", message: "You are making markets across Base, Robinhood, and Solana. Your positions live in your wallets." });
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
      const response = await fetch("/api/portfolio/action", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ owner: address, chain: position.chain, tokenId: position.tokenId, action }),
      });
      const payload = await response.json() as { plan?: PositionActionPlan; error?: string };
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
      await sendWalletCalls({ wallet: wallet as unknown as ConnectedEvmWallet, owner: address, chainId: actionPlan.chainId, transactions: actionPlan.transactions });
      setActionState({ kind: "submitted", message: "Submitted. Your position will refresh after confirmation." });
      window.setTimeout(() => void loadPositions(), 8_000);
    } catch (error) {
      setActionState({ kind: "error", message: error instanceof Error ? error.message : "Wallet submission failed" });
    }
  }

  return (
    <main className="index-app">
      <header className="index-nav">
        <button className="una-wordmark" type="button" onClick={() => changeTab("overview")} aria-label="Una overview">
          <span className="una-mark" aria-hidden="true"><i /><b /></span>
          <span>Una</span>
        </button>
        <nav aria-label="Primary navigation">
          {(["overview", "markets", "agent"] as const).map((item) => (
            <button key={item} type="button" className={tab === item ? "is-active" : ""} onClick={() => changeTab(item)}>{capitalize(item)}</button>
          ))}
        </nav>
        <div className="nav-actions">
          <span className="chain-live"><i /><span>Base · Robinhood · Solana</span></span>
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

      {tab === "agent" ? (
        <AgentWorkspace authenticated={authenticated} onLogin={() => void login()} />
      ) : (
        <div className="index-shell" data-view={tab}>
          <section className="index-main">
            <header className="index-title-row">
              <div>
                <h1>{tab === "markets" ? "The meme markets" : "The meme market maker"}</h1>
                <p>{tab === "markets" ? "The pools Una manages inside one index." : "Deposit once. Earn the trading fees across Base, Robinhood, and Solana."}</p>
              </div>
              <button className="icon-button" type="button" onClick={() => void (previewMode ? Promise.resolve() : loadPositions())} aria-label="Refresh portfolio"><RefreshIcon /></button>
            </header>

            {tab === "overview" ? (
              <>
                <IndexHero feePace={feePace} markets={activeMarkets} stats={stats} loading={marketsState === "loading"} positions={positions} metrics={metrics} />
                <MarketLedger markets={activeMarkets} stats={stats} state={marketsState} compact />
              </>
            ) : (
              <MarketLedger markets={activeMarkets} stats={stats} state={marketsState} />
            )}

            <PositionLedger
              authenticated={authenticated || previewMode}
              positions={positions}
              state={positionsState}
              onLogin={() => void login()}
              onAction={preparePositionAction}
              actionPlan={actionPlan}
              actionState={actionState}
              onExecute={executePositionAction}
              onCancel={() => { setActionPlan(null); setActionState({ kind: "idle" }); }}
            />
          </section>

          <MarketAction
            amount={amount}
            onAmount={setAmount}
            constituentCount={activeMarkets.length}
            feePace={feePace}
            feeBps={markets.catalog.fees.allocateBps}
            authenticated={authenticated}
            ready={ready && solanaReady}
            onPrepare={() => void prepareIndex()}
            plan={plan}
            state={planState}
            onExecute={() => void executeIndex()}
            onCancel={() => { setPlan(null); setPlanState({ kind: "idle" }); }}
          />
        </div>
      )}
      <footer className="index-footer"><span>Self-custodial by design</span><span>Una is independent from Uniswap, Meteora, Robinhood, Privy, and Relay.</span></footer>
    </main>
  );
}

function MarketAction({ amount, onAmount, constituentCount, feePace, feeBps, authenticated, ready, onPrepare, plan, state, onExecute, onCancel }: {
  amount: string;
  onAmount: (amount: string) => void;
  constituentCount: number;
  feePace: number | null;
  feeBps: number;
  authenticated: boolean;
  ready: boolean;
  onPrepare: () => void;
  plan: MemeIndexPlan | null;
  state: PlanState;
  onExecute: () => void;
  onCancel: () => void;
}) {
  return (
    <aside className="market-action" aria-label="Make markets">
      <div className="action-head">
        <div><span className="eyebrow">ONE DEPOSIT · EVERY MARKET</span><h2>Make markets</h2><p>ETH in. Trading fees back to you.</p></div>
        <ShieldIcon />
      </div>
      <label className="amount-field">
        <span>You deposit</span>
        <span className="amount-input"><input inputMode="decimal" value={amount} onChange={(event) => onAmount(event.target.value)} aria-label="ETH amount" /><b>ETH</b></span>
      </label>

      <div className="index-facts" aria-label="Index coverage">
        <span><b>{constituentCount || "—"}</b> meme markets</span>
        <span><b>3</b> networks</span>
        <span><b>1</b> index</span>
      </div>

      <div className="action-economics">
        <div><span>Observed fees yesterday</span><b>{feePace === null ? "Unavailable" : `$${feePace.toFixed(2)} / $1k`}</b></div>
        <div><span>Una deposit fee</span><b>{(feeBps / 100).toFixed(2)}%</b></div>
        <div><span>Position owner</span><b>You</b></div>
      </div>
      <p className="pace-note">Fee pace follows live pool activity. It is not an APY or return promise.</p>

      {state.kind !== "idle" ? <PlanPreview plan={plan} state={state} onExecute={onExecute} onCancel={onCancel} /> : (
        <button className="fund-button" type="button" disabled={!ready} onClick={onPrepare}>
          {!ready ? "Loading wallets…" : authenticated ? "Review deposit" : "Continue with email"}<ArrowIcon />
        </button>
      )}
      <p className="custody-note"><LockIcon />You own every position. Withdraw anytime.</p>
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
  const title = state.kind === "ready" ? "Ready to make markets" : state.kind === "error" ? "Needs attention" : state.kind === "submitted" ? "Markets made" : "Una is working";
  return (
    <section className={`plan-preview is-${state.kind}`} aria-live="polite">
      <header><span>{title}</span><button type="button" onClick={onCancel} disabled={busy}>Close</button></header>
      <p>{state.message}</p>
      {plan ? <dl>
        <div><dt>Your deposit</dt><dd>{trimEth(BigInt(plan.totalAmountWei))} ETH</dd></div>
        <div><dt>Index</dt><dd>{plan.constituentCount} markets · 3 networks</dd></div>
        <div><dt>Una fee</dt><dd>{trimEth(feeWei)} ETH</dd></div>
        <div><dt>Network routing</dt><dd>{relayFee > 0 ? `$${relayFee.toFixed(2)}` : "Included in quote"}</dd></div>
      </dl> : <div className="plan-loading"><i /><i /><i /></div>}
      {state.kind === "ready" && plan ? <>
        <p className="approval-note">One Una action, then {plan.expectedWalletSteps} wallet approvals: Base, Robinhood, and one Solana review. This keeps every position self-custodial.</p>
        <p className="risk-note">Meme prices can fall, and trading fees may not cover losses.</p>
        <button className="fund-button" type="button" onClick={onExecute}>Make markets<ArrowIcon /></button>
      </> : null}
      {state.kind === "error" ? <button className="secondary-button" type="button" onClick={onCancel}>Try again</button> : null}
    </section>
  );
}

function IndexHero({ feePace, markets, stats, loading, positions, metrics }: {
  feePace: number | null;
  markets: IndexMarket[];
  stats: Map<string, MarketStats>;
  loading: boolean;
  positions: PositionView[];
  metrics: ReturnType<typeof portfolioMetrics>;
}) {
  return <section className="portfolio-hero" aria-label="Meme liquidity index summary">
    <div className="hero-value">
      <span>Observed fees</span>
      <strong>{loading || feePace === null ? "—" : `$${feePace.toFixed(2)}`}</strong>
      <small>per $1,000 of liquidity yesterday</small>
    </div>
    <MarketPulse markets={markets} stats={stats} loading={loading} />
    <dl className="hero-metrics">
      <div><dt>Networks</dt><dd>Base · Robinhood · Solana</dd></div>
      <div><dt>Your liquidity</dt><dd>{metrics.hasValue ? money(metrics.value) : positions.length ? money(metrics.value) : "No deposit yet"}</dd></div>
      <div><dt>Unclaimed fees</dt><dd>{positions.length ? money(metrics.fees) : "—"}</dd></div>
    </dl>
  </section>;
}

function MarketPulse({ markets, stats, loading }: { markets: IndexMarket[]; stats: Map<string, MarketStats>; loading: boolean }) {
  const values = markets.map(({ market }) => stats.get(market.id)?.dailyFeesPer1000Usd ?? 0);
  const max = Math.max(1, ...values);
  return <div className="index-trace">
    <header><span>Fee pace by market</span><small>{loading ? "Reading live markets" : `${markets.length} live constituents`}</small></header>
    <div className="fee-bars" role="img" aria-label="Observed fee pace by index constituent">
      {markets.map(({ market }, index) => <span key={market.id}>
        <i style={{ height: `${Math.max(4, (values[index]! / max) * 100)}%`, background: market.color, animationDelay: `${index * 55}ms` }} />
        <small>{market.symbol}</small>
      </span>)}
    </div>
  </div>;
}

function MarketLedger({ markets, stats, state, compact = false }: { markets: IndexMarket[]; stats: Map<string, MarketStats>; state: "loading" | "ready" | "error"; compact?: boolean }) {
  return (
    <section className={`market-ledger ${compact ? "is-compact" : ""}`}>
      <header><div><h2>Inside the index</h2><p>Una selects and manages every pool.</p></div><span>{markets.length} live</span></header>
      <div className="market-table-wrap">
        <table className="market-table">
          <thead><tr><th>Pair</th><th>1D fee pace</th><th>Network</th><th>Liquidity</th><th>Risk</th></tr></thead>
          <tbody>
            {state === "loading" ? Array.from({ length: compact ? 5 : 8 }, (_, index) => <tr className="skeleton-row" key={index}><td colSpan={5}><i /></td></tr>) : null}
            {state === "error" ? <tr><td colSpan={5} className="table-message">Live market readings are temporarily unavailable.</td></tr> : null}
            {state === "ready" ? markets.map(({ market, chain }) => {
              const row = stats.get(market.id);
              const quote = chain === "solana" ? "SOL" : "WETH";
              return <tr key={market.id}>
                <td><span className="pair-cell"><i style={{ background: market.color }}>{market.symbol.slice(0, 1)}</i><span><b>{market.symbol}/{quote}</b><small>{market.name}</small></span></span></td>
                <td><b className="fee-pace">{row?.dailyFeesPer1000Usd == null ? "—" : `$${row.dailyFeesPer1000Usd.toFixed(2)}`}</b><small className="cell-note">per $1k</small></td>
                <td><span className={`chain-pill is-${chain}`}><i />{chainLabel(chain)}</span></td>
                <td>{compactMoney(row?.liquidityUsd)}</td>
                <td><span className={`risk-pill is-${market.risk}`}>{market.risk}</span></td>
              </tr>;
            }) : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function PositionLedger({ authenticated, positions, state, onLogin, onAction, actionPlan, actionState, onExecute, onCancel }: {
  authenticated: boolean;
  positions: PositionView[];
  state: "idle" | "loading" | "ready" | "error";
  onLogin: () => void;
  onAction: (position: PositionView, action: "compound" | "withdraw") => void;
  actionPlan: PositionActionPlan | null;
  actionState: PlanState;
  onExecute: () => void;
  onCancel: () => void;
}) {
  return (
    <section className="position-ledger">
      <header><div><h2>Your liquidity</h2><p>Your positions and fees, held in your wallets.</p></div>{!authenticated ? <button type="button" onClick={onLogin}>Connect wallet</button> : null}</header>
      {actionState.kind !== "idle" ? (
        <section className={`action-preview is-${actionState.kind}`} aria-live="polite">
          <div><b>{actionPlan ? `${actionPlan.kind === "compound" ? "Collect fees" : "Withdraw"} · ${actionPlan.pair}` : "Preparing your position"}</b><p>{actionState.message}</p></div>
          {actionPlan ? <span>{(actionPlan.serviceFeeBps / 100).toFixed(2)}% Una fee</span> : null}
          <div className="action-buttons">{actionState.kind === "ready" ? <button className="small-primary" type="button" onClick={onExecute}>Approve</button> : null}<button type="button" onClick={onCancel} disabled={actionState.kind === "planning" || actionState.kind === "signing"}>Close</button></div>
        </section>
      ) : null}
      {!authenticated ? <div className="position-empty"><LockIcon /><p>Connect to see your liquidity, fees, and performance.</p></div> : null}
      {authenticated && state === "loading" ? <div className="position-empty"><p>Reading your positions…</p></div> : null}
      {authenticated && state === "error" ? <div className="position-empty"><p>Your positions could not be loaded. Your wallets are unaffected.</p></div> : null}
      {authenticated && state === "ready" && positions.length === 0 ? <div className="position-empty"><p>No Una liquidity in this wallet yet.</p></div> : null}
      {positions.length ? <div className="position-list">{positions.map((position) => <article key={`${position.chain}-${position.tokenId}`}>
        <span className="position-pair"><i>{position.symbol0.slice(0, 1)}</i><span><b>{position.pair}</b><small>{position.chainLabel}</small></span></span>
        <span><small>Value</small><b>{money(position.lpUsd ?? 0)}</b></span>
        <span><small>Fees</small><b>{money(position.feesUsd ?? 0)}</b></span>
        <span><small>vs HOLD</small><b className={(position.holdDeltaUsd ?? 0) >= 0 ? "positive" : "negative"}>{signedMoney(position.holdDeltaUsd ?? 0)}</b></span>
        <span className={`position-range is-${position.status}`}><i />{position.status === "in-range" ? "Earning" : position.status === "oor" ? "Needs attention" : "Closed"}</span>
        <span className="position-actions"><button type="button" onClick={() => onAction(position, "compound")} disabled={position.closed}>Collect + earn</button><button type="button" onClick={() => onAction(position, "withdraw")} disabled={position.closed}>Withdraw</button></span>
      </article>)}</div> : null}
    </section>
  );
}

function AgentWorkspace({ authenticated, onLogin }: { authenticated: boolean; onLogin: () => void }) {
  return <div className="agent-workspace">
    <aside><span className="agent-orbit"><i /><b /></span><h1>Ask Una.</h1><p>Understand the index, check your fees, or prepare a withdrawal. Una can prepare actions, but only you can approve them.</p><dl><div><dt>Reads</dt><dd>Markets + wallet positions</dd></div><div><dt>Changes</dt><dd>Only what you approve</dd></div><div><dt>Custody</dt><dd>Always yours</dd></div></dl></aside>
    <Chat authenticated={authenticated} onLogin={onLogin} />
  </div>;
}

function weightedFeePace(markets: IndexMarket[], stats: Map<string, MarketStats>): number | null {
  const available = markets.filter(({ market }) => stats.get(market.id)?.dailyFeesPer1000Usd != null);
  if (!available.length) return null;
  const weight = available.reduce((sum, row) => sum + row.indexWeightBps, 0);
  return available.reduce((sum, row) => sum + (stats.get(row.market.id)!.dailyFeesPer1000Usd! * row.indexWeightBps) / weight, 0);
}

function portfolioMetrics(positions: PositionView[]) {
  const value = positions.reduce((sum, position) => sum + (position.lpUsd ?? 0), 0);
  return {
    value,
    fees: positions.reduce((sum, position) => sum + (position.feesUsd ?? 0), 0),
    holdDelta: positions.reduce((sum, position) => sum + (position.holdDeltaUsd ?? 0), 0),
    inRange: positions.filter((position) => position.status === "in-range").length,
    hasValue: value > 0,
  };
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

function trimEth(value: bigint): string {
  const formatted = formatEther(value);
  const [whole, fraction = ""] = formatted.split(".");
  return fraction ? `${whole}.${fraction.slice(0, 6).replace(/0+$/, "") || "0"}` : whole!;
}

function short(value: string): string {
  return value.startsWith("0x") && value.length > 12 ? `${value.slice(0, 6)}…${value.slice(-4)}` : value;
}

function capitalize(value: string): string {
  return value.slice(0, 1).toUpperCase() + value.slice(1);
}

function WalletIcon() { return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7.5A2.5 2.5 0 0 1 6.5 5H18v3H6.5a1.5 1.5 0 0 0 0 3H20v8H6a2 2 0 0 1-2-2V7.5Z"/><circle cx="16.5" cy="15" r="1.25"/></svg>; }
function RefreshIcon() { return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 11a8 8 0 1 0-2.34 5.66M20 11V5m0 6h-6"/></svg>; }
function ShieldIcon() { return <svg className="shield-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 5 6v5c0 4.6 2.8 8.3 7 10 4.2-1.7 7-5.4 7-10V6l-7-3Z"/><path d="m9.5 12 1.7 1.7 3.6-4"/></svg>; }
function LockIcon() { return <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="10" width="14" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg>; }
function ArrowIcon() { return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14m-5-5 5 5-5 5"/></svg>; }
