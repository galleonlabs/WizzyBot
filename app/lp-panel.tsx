"use client";

import { compositionShares, pct, priceLabel, statusLabel, usd, type PositionView } from "./lib/cards";
import type { PanelState } from "./lib/panel";
import { RangeStrip } from "./range-strip";

export function LpPanel({
  connected,
  ready,
  onLogin,
  state,
  onSelect,
}: {
  connected: boolean;
  ready: boolean;
  onLogin: () => void;
  state: PanelState;
  onSelect: (view: PositionView) => void;
}) {
  if (!ready) {
    return (
      <aside className="lp-panel">
        <PanelHead />
        <div className="lp-empty">
          <p>Loading wallet…</p>
        </div>
      </aside>
    );
  }

  if (!connected) {
    return (
      <aside className="lp-panel">
        <PanelHead />
        <div className="lp-empty">
          <h2>Your positions live here.</h2>
          <p>Continue with email to load the wallet. You keep the NFT.</p>
          <button className="btn btn-accent" type="button" onClick={onLogin}>
            Continue with email
          </button>
        </div>
      </aside>
    );
  }

  const selected = state.selected;
  const projection = state.projection;

  return (
    <aside className="lp-panel">
      <PanelHead count={state.positions.length} />
      {state.loadError ? <p className="lp-err">{state.loadError}</p> : null}

      {state.positions.length === 0 && !selected && !projection ? (
        <div className="lp-empty">
          <h2>No LP yet.</h2>
          <p>Ask the agent to quote a mint. Dry-run first. Confirm to go live.</p>
        </div>
      ) : (
        <div className="lp-list">
          {state.positions.map((view) => (
            <button
              key={view.tokenId ?? view.pair}
              className={`lp-row ${state.selectedId === view.tokenId ? "is-on" : ""}`}
              type="button"
              onClick={() => onSelect(view)}
            >
              <div className="lp-row-top">
                <span className="lp-pair">{view.pair}</span>
                <StatusPill status={view.status} fullRange={view.fullRange} />
              </div>
              <div className="lp-row-meta">
                <span>{view.protocol.toLowerCase()}</span>
                <span>{view.feeLabel}</span>
                {view.tokenId ? <span>#{view.tokenId}</span> : null}
              </div>
              <RangeStrip live={view} compact />
              <div className="lp-row-stats">
                <span>{usd(view.lpUsd ?? view.positionUsd)}</span>
                <span className="muted">fees {usd(view.feesUsd)}</span>
                {view.feeApr !== undefined ? <span className="muted">APR {pct(view.feeApr)}</span> : null}
                {view.holdDeltaPct !== undefined || view.divergence !== undefined ? (
                  <span data-delta={deltaTone(view.holdDeltaPct ?? view.divergence)}>
                    vs HOLD {pct(view.holdDeltaPct ?? view.divergence)}
                  </span>
                ) : null}
              </div>
            </button>
          ))}
        </div>
      )}

      {selected || projection ? (
        <PositionDetail live={selected} projection={projection} />
      ) : null}
    </aside>
  );
}

function PanelHead({ count }: { count?: number }) {
  return (
    <header className="lp-head">
      <span>Positions</span>
      {count !== undefined ? <span className="muted">{count}</span> : <span className="muted">Base</span>}
    </header>
  );
}

function StatusPill({ status, fullRange }: { status: PositionView["status"]; fullRange?: boolean }) {
  return (
    <span className="pill" data-status={fullRange && status !== "closed" ? "full" : status}>
      {fullRange && status !== "closed" ? "full range" : statusLabel(status)}
    </span>
  );
}

function PositionDetail({ live, projection }: { live?: PositionView; projection?: PositionView }) {
  const view = live ?? projection;
  if (!view) return null;
  const shares = compositionShares(view);
  const kind = projection && !live ? "projected" : live?.kind === "projected" ? "projected" : "live";

  return (
    <section className="lp-detail">
      <header className="lp-detail-head">
        <div>
          <h3>{view.pair}</h3>
          <p>
            {view.protocol.toLowerCase()} · {view.feeLabel}
            {view.tokenId ? ` · #${view.tokenId}` : ""}
          </p>
        </div>
        <div className="lp-kinds">
          {live ? (
            <span className="kind-tag" data-kind="live">
              Live
            </span>
          ) : null}
          {projection ? (
            <span className="kind-tag" data-kind="projected">
              Projected
            </span>
          ) : null}
          {!live && !projection ? (
            <span className="kind-tag" data-kind={kind}>
              {kind === "projected" ? "Projected" : "Live"}
            </span>
          ) : null}
        </div>
      </header>

      <div className="lp-usd">
        <strong>{usd(view.lpUsd ?? view.positionUsd)}</strong>
        <StatusPill status={view.status} fullRange={view.fullRange} />
      </div>

      <div className="comp-bar" aria-hidden="true">
        <i style={{ width: `${shares.share0}%` }} />
        <b style={{ width: `${shares.share1}%` }} />
      </div>
      <div className="comp-legend">
        <span>
          {view.amount0} {view.symbol0}
          {view.amount0Usd !== undefined ? ` · ${usd(view.amount0Usd)}` : ""}
        </span>
        <span>
          {view.amount1} {view.symbol1}
          {view.amount1Usd !== undefined ? ` · ${usd(view.amount1Usd)}` : ""}
        </span>
      </div>

      <div className="lp-grid">
        <article className="lp-card">
          <h4>Fees</h4>
          <strong>{usd(view.feesUsd)}</strong>
          <p>
            {view.uncollected0} {view.symbol0}
            <br />
            {view.uncollected1} {view.symbol1}
          </p>
        </article>
        <article className="lp-card">
          <h4>vs HOLD</h4>
          <strong data-delta={deltaTone(view.holdDeltaPct ?? view.divergence)}>
            {usd(view.holdDeltaUsd)} {pct(view.holdDeltaPct ?? view.divergence)}
          </strong>
          <p>
            HOLD {usd(view.holdUsd)}
            <br />
            fees {usd(view.feesUsd)} vs IL {usd(view.ilUsd)}
          </p>
        </article>
      </div>

      <article className="lp-card lp-range">
        <h4>Range</h4>
        <div className="range-nums">
          <span>
            <em>min</em>
            {view.fullRange ? "0" : priceLabel(view.priceMin)}
          </span>
          <span>
            <em>current</em>
            {priceLabel(view.price)}
          </span>
          <span>
            <em>max</em>
            {view.fullRange ? "∞" : priceLabel(view.priceMax, view.priceMax === null)}
          </span>
        </div>
        <RangeStrip live={live} projected={projection} />
        {projection && live ? (
          <p className="proj-note">
            Projected ticks [{projection.tickLower}, {projection.tickUpper}] vs live [{live.tickLower}, {live.tickUpper}
            ]
          </p>
        ) : null}
      </article>
    </section>
  );
}

function deltaTone(n?: number): "up" | "down" | "flat" {
  if (n === undefined || Math.abs(n) < 0.0005) return "flat";
  return n > 0 ? "up" : "down";
}
