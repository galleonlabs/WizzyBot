"use client";

import { useMemo, useState } from "react";
import type { ChainSlug } from "../lib/chains";
import type { CuratedPool, PoolFlag } from "../lib/portfolio-types";
import { compactMoney, formatPercent } from "../lib/format";
import { fomoTokenUrl } from "../lib/links";
import { BRAND_ASSETS, BrandLogo, SearchIcon, TokenIcon } from "../ui/icons";

type ChainFilter = "all" | ChainSlug;
type VenueFilter = "all" | "uniswap" | "aerodrome";
type SortKey = "volume" | "apr" | "liquidity" | "age";

const PAGE_SIZE = 12;

const FLAG_COPY: Record<PoolFlag, { label: string; tone: "good" | "info" | "warn"; title: string }> = {
  reviewed: { label: "Curated", tone: "good", title: "Listed by Wizzy's curator agent, which re-reviews both chains every six hours" },
  new: { label: "New", tone: "info", title: "Pool is under three days old. Early liquidity earns the most fees and carries the most risk" },
  thin: { label: "Thin", tone: "info", title: "Under $50k of liquidity, so prices move fast and exits can slip" },
  quiet: { label: "Quiet", tone: "info", title: "Under $1k traded in the last day, so fee income is small for now" },
  unchecked: { label: "Unchecked", tone: "warn", title: "No contract security scan exists for this token yet, so rug checks could not run" },
  unverified: { label: "Unverified", tone: "warn", title: "Contract source is not verified, so nobody can audit what it does" },
  mintable: { label: "Mintable", tone: "warn", title: "The owner can mint more supply and dilute holders" },
  pausable: { label: "Pausable", tone: "warn", title: "The owner can pause transfers, which would trap liquidity" },
  blacklist: { label: "Blacklist", tone: "warn", title: "The contract can blacklist addresses from trading" },
  "hidden-owner": { label: "Hidden owner", tone: "warn", title: "Ownership is obscured, so renouncement cannot be verified" },
  proxy: { label: "Proxy", tone: "warn", title: "Upgradeable contract, so its rules can change after you deposit" },
  tax: { label: "Tax", tone: "warn", title: "The token charges a buy or sell tax under 10%, which eats into every swap" },
};

export function PoolTable({ pools, state, onSelect, onRetry }: {
  pools: CuratedPool[];
  state: "loading" | "ready" | "error";
  onSelect: (pool: CuratedPool) => void;
  onRetry: () => void;
}) {
  const [chain, setChain] = useState<ChainFilter>("all");
  const [venue, setVenue] = useState<VenueFilter>("all");
  const [reviewedOnly, setReviewedOnly] = useState(false);
  const [sort, setSort] = useState<SortKey>("volume");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const normalizedQuery = query.trim().toLocaleLowerCase();

  const filtered = useMemo(() => {
    const rows = pools.filter((pool) => {
      if (chain !== "all" && pool.chain !== chain) return false;
      if (venue === "uniswap" && pool.venue === "aerodrome-slipstream") return false;
      if (venue === "aerodrome" && pool.venue !== "aerodrome-slipstream") return false;
      if (reviewedOnly && !pool.reviewed) return false;
      if (normalizedQuery && !`${pool.token.symbol} ${pool.token.name}`.toLocaleLowerCase().includes(normalizedQuery)) return false;
      return true;
    });
    const value = (pool: CuratedPool) => sort === "apr" ? pool.feeApr24hPct ?? -1 : sort === "liquidity" ? pool.liquidityUsd : sort === "age" ? -(pool.ageDays ?? Number.MAX_SAFE_INTEGER) : pool.volume24hUsd;
    return rows.sort((a, b) => value(b) - value(a));
  }, [pools, chain, venue, reviewedOnly, normalizedQuery, sort]);
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const start = (currentPage - 1) * PAGE_SIZE;
  const visible = filtered.slice(start, start + PAGE_SIZE);
  const reset = () => setPage(1);

  return <section className="pool-ledger">
    <div className="market-table-wrap">
      <div className="market-toolbar pool-toolbar">
        <div className="pool-filter-groups">
          <div className="market-filters" aria-label="Filter pools by chain">
            {(["all", "base", "robinhood"] as const).map((option) => <button key={option} type="button" className={chain === option ? "is-active" : ""} aria-pressed={chain === option} onClick={() => { setChain(option); reset(); }}>{option === "all" ? "All chains" : option === "base" ? "Base" : "Robinhood"}</button>)}
          </div>
          <div className="market-filters" aria-label="Filter pools by venue">
            {(["all", "uniswap", "aerodrome"] as const).map((option) => <button key={option} type="button" className={venue === option ? "is-active" : ""} aria-pressed={venue === option} onClick={() => { setVenue(option); reset(); }}>{option === "all" ? "All venues" : option === "uniswap" ? "Uniswap" : "Aerodrome"}</button>)}
          </div>
          <button type="button" className={`pool-toggle ${reviewedOnly ? "is-active" : ""}`} aria-pressed={reviewedOnly} onClick={() => { setReviewedOnly((current) => !current); reset(); }}>Curated only</button>
        </div>
        <div className="pool-toolbar-right">
          <label className="pool-sort"><span>Sort</span><select value={sort} onChange={(event) => { setSort(event.target.value as SortKey); reset(); }} aria-label="Sort pools">
            <option value="volume">24h volume</option>
            <option value="apr">Fee APR</option>
            <option value="liquidity">Liquidity</option>
            <option value="age">Newest</option>
          </select></label>
          <label className="market-search"><SearchIcon /><input type="search" value={query} onChange={(event) => { setQuery(event.target.value); reset(); }} placeholder="Search pools" aria-label="Search pools" /></label>
        </div>
      </div>
      <table className="market-table pool-table">
        <thead><tr><th>Pool</th><th>Fee APR · 24h</th><th>Volume · 24h</th><th>Liquidity</th><th>Age</th><th>Checks</th><th>Action</th></tr></thead>
        <tbody>
          {state === "loading" ? Array.from({ length: 8 }, (_, index) => <tr className="skeleton-row" key={index}><td colSpan={7}><i /></td></tr>) : null}
          {state === "error" ? <tr><td colSpan={7} className="table-message">Pool discovery is temporarily unavailable. <button type="button" className="table-retry" onClick={onRetry}>Try again</button></td></tr> : null}
          {state === "ready" && !visible.length ? <tr><td colSpan={7} className="table-message">No pools match those filters.</td></tr> : null}
          {state === "ready" ? visible.map((pool) => <PoolRow key={pool.id} pool={pool} onSelect={() => onSelect(pool)} />) : null}
        </tbody>
      </table>
      {state === "ready" && filtered.length ? <nav className="market-pagination" aria-label="Pool pages">
        <span>{start + 1}–{Math.min(start + PAGE_SIZE, filtered.length)} of {filtered.length} pools</span>
        <div>
          <button type="button" disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)}>Previous</button>
          <span>Page {currentPage} of {pageCount}</span>
          <button type="button" disabled={currentPage === pageCount} onClick={() => setPage(currentPage + 1)}>Next</button>
        </div>
      </nav> : null}
    </div>
  </section>;
}

function PoolRow({ pool, onSelect }: { pool: CuratedPool; onSelect: () => void }) {
  const flags = pool.flags.filter((flag) => flag !== "reviewed");
  return <tr className={pool.reviewed ? "is-reviewed" : ""}>
    <td>
      <span className="pair-cell">
        <TokenIcon symbol={pool.token.symbol} src={pool.token.imageUrl} />
        <span>
          <b>{pool.token.symbol} / {pool.quote.symbol}{pool.fee ? <small className="pool-fee"> {formatFee(pool.fee)}</small> : null}</b>
          <span className="venue-trail"><BrandLogo brand={pool.chain} label={pool.chain === "base" ? "Base" : "Robinhood"} compact /><span>{pool.chain === "base" ? "Base" : "Robinhood"}</span><i>{pool.venueLabel}</i></span>
        </span>
      </span>
    </td>
    <td><b className="fee-apr">{formatPercent(pool.feeApr24hPct)}</b></td>
    <td>{compactMoney(pool.volume24hUsd)}</td>
    <td>{compactMoney(pool.liquidityUsd)}</td>
    <td>{formatAge(pool.ageDays)}</td>
    <td>
      <span className="pool-flags">
        {pool.reviewed ? <Flag tone="good" label={FLAG_COPY.reviewed.label} tip={FLAG_COPY.reviewed.title} /> : null}
        {flags.map((flag) => <Flag key={flag} tone={FLAG_COPY[flag].tone} label={FLAG_COPY[flag].label} tip={FLAG_COPY[flag].title} />)}
        {!pool.reviewed && !flags.length ? <Flag tone="good" label="Clean" tip="Security scan came back clean, with healthy liquidity and volume" /> : null}
      </span>
    </td>
    <td>
      <span className="market-links">
        <button className="market-link zap-link" type="button" aria-haspopup="dialog" onClick={onSelect} aria-label={`Provide liquidity to ${pool.token.symbol}/${pool.quote.symbol}`}><span className="market-link-label">LP this pool</span></button>
        <a className="market-link fomo-link" href={fomoTokenUrl(pool.chain, pool.token.address)} target="_blank" rel="noreferrer" aria-label={`Trade ${pool.token.symbol} on Fomo`}><img src={BRAND_ASSETS.fomo} alt="" /><span className="market-link-label">Fomo</span></a>
      </span>
    </td>
  </tr>;
}

function Flag({ tone, label, tip }: { tone: "good" | "info" | "warn"; label: string; tip: string }) {
  return <i className={`tip is-${tone}`} data-tip={tip} tabIndex={0} aria-label={`${label}: ${tip}`}>{label}</i>;
}

export function formatFee(pips: number): string {
  const pct = pips / 10_000;
  return `${pct >= 1 ? pct.toFixed(pct % 1 ? 2 : 0) : pct.toFixed(pct >= 0.1 ? 2 : 3).replace(/0+$/, "").replace(/\.$/, "")}%`;
}

export function formatAge(days: number | null): string {
  if (days === null) return "—";
  if (days < 1) return `${Math.max(1, Math.round(days * 24))}h`;
  if (days < 60) return `${Math.round(days)}d`;
  if (days < 730) return `${Math.round(days / 30)}mo`;
  return `${(days / 365).toFixed(1)}y`;
}
