"use client";

import { compositionShares, pct, priceLabel, statusLabel, usd, type PositionView } from "./lib/cards";
import type { PanelState } from "./lib/panel";
import { PairDiscs } from "./pair-discs";
import { RangeStrip } from "./range-strip";

export function LpPanel({
  connected,
  ready,
  onLogin,
  onNew,
  state,
  onSelect,
}: {
  connected: boolean;
  ready: boolean;
  onLogin: () => void;
  onNew: () => void;
  state: PanelState;
  onSelect: (view: PositionView) => void;
}) {
  if (!ready) {
    return (
      <aside className="lp-board">
        <div className="lp-col">
          <PanelHead onNew={onNew} />
          <div className="lp-empty">
            <p>Loading wallet…</p>
          </div>
        </div>
      </aside>
    );
  }

  if (!connected) {
    return (
      <aside className="lp-board">
        <div className="lp-col">
          <PanelHead onNew={onNew} />
          <div className="lp-empty">
            <h2>No LP yet.</h2>
            <p>Continue with email to load the wallet. Ask the agent to quote a mint.</p>
            <button className="btn btn-accent" type="button" onClick={onLogin}>
              Continue with email
            </button>
          </div>
        </div>
      </aside>
    );
  }

  const selected = state.selected;
  const projection = state.projection;
  const empty = state.positions.length === 0 && !selected && !projection;

  return (
    <aside className="lp-board">
      <div className="lp-col">
        <PanelHead count={state.positions.length} onNew={onNew} />
        {state.loadError ? <p className="lp-err">{state.loadError}</p> : null}

        {empty ? (
          <div className="lp-empty">
            <h2>No LP yet.</h2>
            <p>Ask the agent to quote a mint. Dry-run first. Confirm to go live.</p>
            <button className="btn btn-accent" type="button" onClick={onNew}>
              Quote a mint
            </button>
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
                <PairDiscs symbol0={view.symbol0} symbol1={view.symbol1} />
                <div className="lp-id">
                  <span className="lp-pair">{view.pair}</span>
                  <span className="lp-id-meta">
                    {view.feeLabel} · {view.protocol.toLowerCase()}
                    {view.tokenId ? ` · #${view.tokenId}` : ""}
                  </span>
                </div>
                <StatusPill status={view.status} fullRange={view.fullRange} />
                <RangeStrip live={view} compact />
                <div className="lp-money">
                  <span className="lp-usd-n">{usd(view.lpUsd ?? view.positionUsd)}</span>
                  <span className="muted">uncollected {usd(view.feesUsd)}</span>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {selected || projection ? <PositionDetail live={selected} projection={projection} /> : null}
    </aside>
  );
}

function PanelHead({ count, onNew }: { count?: number; onNew: () => void }) {
  return (
    <header className="lp-head">
      <span>
        Positions
        {count !== undefined ? <span className="muted"> {count}</span> : null}
      </span>
      <button className="btn btn-new" type="button" onClick={onNew}>
        New
      </button>
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
        <PairDiscs symbol0={view.symbol0} symbol1={view.symbol1} large />
        <div className="lp-detail-id">
          <h3>{view.pair}</h3>
          <p>
            {view.protocol.toLowerCase()} · {view.feeLabel}
            {view.tokenId ? ` · #${view.tokenId}` : ""}
          </p>
        </div>
        <div className="lp-kinds">
          <StatusPill status={view.status} fullRange={view.fullRange} />
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
          <h4>Uncollected</h4>
          <strong>{usd(view.feesUsd)}</strong>
          <p>
            {view.uncollected0} {view.symbol0}
            <br />
            {view.uncollected1} {view.symbol1}
          </p>
        </article>
        {view.feeApr !== undefined ? (
          <article className="lp-card">
            <h4>Fee APR</h4>
            <strong>{pct(view.feeApr)}</strong>
          </article>
        ) : null}
        {view.totalApr !== undefined ? (
          <article className="lp-card">
            <h4>Total APR</h4>
            <strong data-delta={deltaTone(view.totalApr)}>{pct(view.totalApr)}</strong>
          </article>
        ) : null}
        {view.holdDeltaPct !== undefined || view.divergence !== undefined || view.holdUsd !== undefined ? (
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
        ) : null}
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
            Projected ticks [{projection.tickLower}, {projection.tickUpper}] vs live [{live.tickLower}, {live.tickUpper}]
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
