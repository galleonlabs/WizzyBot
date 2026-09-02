"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { PositionView } from "../lib/cards";
import type { PositionActionKind, PositionActionPlan } from "../lib/portfolio-types";
import { compactRaw, compactTokenAmount, money } from "../lib/format";
import { positionOrientation } from "../lib/position-math";
import { CheckIcon, CloseIcon, TokenIcon } from "../ui/icons";
import { hasCollectibleFees, positionFeesLabel, venueLabel } from "./position-row";

/**
 * In-app actions are single wallet transactions: collect, reduce, exit.
 * Everything else is handed to the venue; a Relay sell is offered after exit.
 */
export type ActionRequest = { action: PositionActionKind; percent?: number };
export type PlanState = { kind: "idle" | "planning" | "ready" | "signing" | "waiting" | "submitted" | "error"; message?: string };
export type BalanceState = { kind: "idle" | "loading" | "ready" | "error"; balanceWei?: string };

const TITLES: Record<PositionActionKind, string> = {
  collect: "Collect fees",
  decrease: "Reduce position",
  withdraw: "Exit position",
};

export function ActionSheet({ position, action, image, plan, state, onPlan, onExecute, onReset, onClose, onSell }: {
  position: PositionView;
  action: PositionActionKind;
  image?: string | null;
  plan: PositionActionPlan | null;
  state: PlanState;
  onPlan: (request: ActionRequest) => void;
  onExecute: () => void;
  onReset: () => void;
  onClose: () => void;
  onSell: (token: { address: string; symbol: string; decimals: number }) => void;
}) {
  const busy = state.kind === "planning" || state.kind === "signing" || state.kind === "waiting";
  const executing = state.kind === "signing" || state.kind === "waiting";
  const done = state.kind === "submitted";
  const reviewing = Boolean(plan) && (state.kind === "ready" || executing);
  const planRef = useRef(onPlan);
  planRef.current = onPlan;
  const resetRef = useRef(onReset);
  resetRef.current = onReset;
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const orientation = positionOrientation(position);
  const [percent, setPercent] = useState(50);
  const firstRender = useRef(true);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !executing) closeRef.current();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [executing]);

  // Collect and exit need no input, so quote them as soon as the sheet opens.
  useEffect(() => {
    if (action === "collect" || action === "withdraw") planRef.current({ action });
  }, [action]);

  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    resetRef.current();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [percent]);

  const decimals = { d0: plan?.tokens.decimals0 ?? position.decimals0 ?? 18, d1: plan?.tokens.decimals1 ?? position.decimals1 ?? 18 };
  const memeToken = plan ? (orientation.quoteIsToken0 ? { address: plan.tokens.address1, symbol: plan.tokens.symbol1, decimals: plan.tokens.decimals1 } : { address: plan.tokens.address0, symbol: plan.tokens.symbol0, decimals: plan.tokens.decimals0 }) : null;
  const primaryLabel = executing
    ? (state.message ?? "Confirm in your wallet")
    : reviewing
      ? confirmLabel(action, plan)
      : state.kind === "planning" ? "Quoting…" : action === "decrease" ? "Review" : confirmLabel(action, plan);
  const submitDisabled = busy || (reviewing && !plan);

  return createPortal(<div className="sheet-backdrop" onPointerDown={(event) => { if (event.currentTarget === event.target && !executing) onClose(); }}>
    <section className={`sheet is-${action} ${done ? "is-done" : ""}`} role="dialog" aria-modal="true" aria-labelledby="sheet-title">
      <header className="sheet-head">
        <span className="sheet-identity">
          <TokenIcon symbol={orientation.memeSymbol} src={image} size={34} />
          <span><small>{position.symbol0} / {position.symbol1} · {venueLabel(position)} · {position.chainLabel}</small><b id="sheet-title">{TITLES[action]}</b></span>
        </span>
        <button type="button" className="sheet-close" onClick={onClose} disabled={executing} aria-label="Close"><CloseIcon /></button>
      </header>

      {done ? <div className="sheet-done">
        <span className="sheet-done-mark"><img src="/brand/wizzy-mascot-dark.svg" alt="" /><i><CheckIcon /></i></span>
        <h2>{doneTitle(action, plan)}</h2>
        <p>{state.message}</p>
        {action !== "collect" && memeToken && orientation.quoteIsToken0 !== null ? <button type="button" className="sheet-primary" onClick={() => onSell(memeToken)}>Sell {memeToken.symbol} for ETH</button> : null}
        <button type="button" className={action !== "collect" && memeToken ? "sheet-secondary sheet-wide" : "sheet-primary"} onClick={onClose}>Done</button>
        {action !== "collect" && memeToken ? <p className="sheet-note">Selling goes through Relay with Wizzy's 0.3% fee. Your ETH stays in your wallet either way.</p> : null}
      </div> : <>
        <div className="sheet-body">
          {action === "collect" ? <div className="sheet-block">
            <div className="sheet-figure"><small>Ready to collect</small><b className="positive">{hasCollectibleFees(position) ? positionFeesLabel(position) : "—"}</b></div>
            <dl className="sheet-rows">
              <div><dt>{position.symbol0}</dt><dd>{compactTokenAmount(position.uncollected0)}</dd></div>
              <div><dt>{position.symbol1}</dt><dd>{compactTokenAmount(position.uncollected1)}</dd></div>
            </dl>
            <p className="sheet-note">One transaction. Fees return to your wallet; liquidity and range stay exactly as they are.</p>
          </div> : null}

          {action === "decrease" ? <div className="sheet-block">
            <div className="sheet-figure"><small>Remove</small><b>{percent}%</b></div>
            <div className="sheet-chips" role="group" aria-label="Share to remove">
              {[25, 50, 75].map((choice) => <button key={choice} type="button" className={percent === choice ? "is-active" : ""} aria-pressed={percent === choice} disabled={busy} onClick={() => setPercent(choice)}>{choice}%</button>)}
            </div>
            <input className="sheet-slider" type="range" min={1} max={99} value={percent} disabled={busy} onChange={(event) => setPercent(Number(event.target.value))} aria-label="Percent of liquidity to remove" />
            <dl className="sheet-rows">
              <div><dt>You receive ≈</dt><dd>{scaledAmount(position.amount0, percent)} {position.symbol0} + {scaledAmount(position.amount1, percent)} {position.symbol1}</dd></div>
              {position.positionUsd ? <div><dt>Value</dt><dd>{money((position.positionUsd * percent) / 100)}</dd></div> : null}
            </dl>
            <p className="sheet-note">One transaction. Fees owed come out with it; the rest keeps earning in the same range.</p>
          </div> : null}

          {action === "withdraw" ? <div className="sheet-block">
            <dl className="sheet-rows">
              <div><dt>Position</dt><dd>{compactTokenAmount(position.amount0)} {position.symbol0} + {compactTokenAmount(position.amount1)} {position.symbol1}</dd></div>
              {hasCollectibleFees(position) ? <div><dt>Plus fees</dt><dd>{compactTokenAmount(position.uncollected0)} {position.symbol0} + {compactTokenAmount(position.uncollected1)} {position.symbol1}</dd></div> : null}
            </dl>
            <p className="sheet-note">One transaction closes the position and burns the NFT. Both tokens land in your wallet; you can sell {orientation.memeSymbol} for ETH right after.</p>
          </div> : null}

          {reviewing && plan ? <dl className="sheet-review" aria-live="polite">
            {plan.removal && action !== "withdraw" ? <div><dt>You receive ≈</dt><dd>{compactRaw(plan.removal.amount0, decimals.d0)} {position.symbol0} + {compactRaw(plan.removal.amount1, decimals.d1)} {position.symbol1}</dd></div> : null}
            {plan.removal && action === "withdraw" ? <div><dt>You receive ≈</dt><dd>{compactRaw(plan.removal.amount0, decimals.d0)} {position.symbol0} + {compactRaw(plan.removal.amount1, decimals.d1)} {position.symbol1}</dd></div> : null}
            <div><dt>Wallet steps</dt><dd>1 transaction</dd></div>
            <div><dt>Wizzy fee</dt><dd>None</dd></div>
          </dl> : null}
          {state.kind === "error" ? <p className="sheet-error" role="alert">{state.message}</p> : null}
        </div>
        <footer className="sheet-foot">
          {executing ? <span className="sheet-progress" aria-live="polite"><i /><span>{state.message ?? "Confirm in your wallet"}</span></span> : null}
          <div className="sheet-buttons">
            {reviewing && action === "decrease" && !executing ? <button type="button" className="sheet-secondary" onClick={onReset}>Edit</button> : null}
            <button type="button" className="sheet-primary" disabled={submitDisabled || executing} onClick={reviewing ? onExecute : () => onPlan({ action, percent: action === "decrease" ? percent : undefined })}>{primaryLabel}</button>
          </div>
        </footer>
      </>}
    </section>
  </div>, document.body);
}

function confirmLabel(action: PositionActionKind, plan: PositionActionPlan | null): string {
  if (action === "collect") return "Collect fees";
  if (action === "decrease") return plan?.removal ? `Remove ${plan.removal.percent}%` : "Remove";
  return "Exit position";
}

function doneTitle(action: PositionActionKind, plan: PositionActionPlan | null): string {
  if (action === "collect") return "Fees collected";
  if (action === "decrease") return `${plan?.removal?.percent ?? ""}% removed`.trim();
  return "Position exited";
}

function scaledAmount(formatted: string, percent: number): string {
  const numeric = Number(formatted.replaceAll(",", ""));
  if (!Number.isFinite(numeric)) return formatted;
  return compactTokenAmount(String((numeric * percent) / 100));
}
