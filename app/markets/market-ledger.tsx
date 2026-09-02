"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { formatEther, parseEther } from "viem";
import type { ChainSlug } from "../lib/chains";
import type { AllocationPlan, CuratedMarket, MarketStats } from "../lib/portfolio-types";
import { compactMoney, compactRaw, formatPercent } from "../lib/format";
import type { BalanceState, PlanState } from "../positions/action-sheet";
import { BRAND_ASSETS, BrandLogo, CloseIcon, SearchIcon, TokenIcon } from "../ui/icons";

export type MarketChain = ChainSlug | "solana";
export type MarketEntry = { market: CuratedMarket; chain: MarketChain };

const MARKET_SKELETON_COUNT = 6;
const MARKETS_PER_PAGE = 8;
const FOMO_REFERRER = "makemememarkets";

export function chainLabel(chain: MarketChain): string {
  if (chain === "base") return "Base";
  if (chain === "robinhood") return "Robinhood";
  return "Solana";
}

export function fomoTokenUrl(chain: MarketChain, token: string): string {
  return `https://fomo.family/tokens/${chain}/${token.toLowerCase()}?r=${FOMO_REFERRER}`;
}

export function MarketLedger({ markets, stats, state, zapMarketId, zapAmount, zapPlan, zapState, onOpenZap, onZapAmount, onPrepareZap, onExecuteZap, onCloseZap, balances, onFund }: {
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
  balances: Record<ChainSlug, BalanceState> | null;
  onFund: (chain: ChainSlug) => void;
}) {
  const [chainFilter, setChainFilter] = useState<"all" | ChainSlug>("all");
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
                <td><b className="fee-apr">{formatPercent(row?.trailingFeeAprPct ?? null)}</b></td>
                <td>{compactMoney(row?.volume24hUsd)}</td>
                <td>{compactMoney(row?.liquidityUsd)}</td>
                <td><span className="market-links">
                  {zappable ? <button className="market-link zap-link" type="button" aria-haspopup="dialog" onClick={() => onOpenZap(market.id)} aria-label={`Add liquidity to ${market.symbol}/WETH`}><span className="market-link-label">Add liquidity</span></button> : null}
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
  return <div className="zap-panel" aria-label={`Add liquidity to ${market.symbol}/WETH`}>
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
      <div><dt>You add</dt><dd>{formatWalletBalance(planMarket.mintQuote)} {planMarket.quoteSymbol} + {compactRaw(planMarket.mintMeme, 18)} {market.symbol}</dd></div>
      <div><dt>Wizzy fee</dt><dd>None</dd></div>
    </dl> : null}
    {state.kind === "submitted" || state.kind === "error" ? <p className={`funding-status is-${state.kind === "submitted" ? "submitted" : "error"}`} aria-live="polite">{state.message}</p> : null}
  </div>;
}

function VenueTrail({ chain, protocol }: { chain: MarketChain; protocol: CuratedMarket["protocol"] }) {
  return <span className="venue-trail">
    <BrandLogo brand={chain} label={chainLabel(chain)} compact />
    <span>{chainLabel(chain)}</span><i>{protocol === "AERODROME_SLIPSTREAM" ? "Aerodrome Slipstream" : "Uniswap v3"}</i>
  </span>;
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

function hasInsufficientBalance(amount: string, balance: BalanceState | null): boolean {
  if (balance?.kind !== "ready" || balance.balanceWei === undefined) return false;
  try {
    return parseEther(amount || "0") > BigInt(balance.balanceWei);
  } catch {
    return false;
  }
}

function formatWalletBalance(balanceWei: string): string {
  const value = Number(formatEther(BigInt(balanceWei)));
  if (value === 0) return "0";
  if (value < 0.0001) return "<0.0001";
  return new Intl.NumberFormat("en-GB", { maximumFractionDigits: value < 1 ? 4 : 3 }).format(value);
}
