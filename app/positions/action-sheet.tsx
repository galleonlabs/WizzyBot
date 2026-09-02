"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { formatEther, parseEther } from "viem";
import type { PositionView } from "../lib/cards";
import type { PositionActionKind, PositionActionPlan } from "../lib/portfolio-types";
import { compactRaw, compactTokenAmount, ethValue, formatPrice, money } from "../lib/format";
import {
  memePriceNow,
  positionOrientation,
  rangeBounds,
  rangeFromMemePrices,
  rangeFromPercent,
  recenteredRange,
} from "../lib/position-math";
import { CheckIcon, CloseIcon, TokenIcon } from "../ui/icons";
import { hasCollectibleFees, positionFeesLabel, venueLabel } from "./position-card";
import { RangeChart, type ProposedRange } from "./range-chart";

export type ActionRequest = {
  action: PositionActionKind;
  amountWei?: string;
  percent?: number;
  tickLower?: number;
  tickUpper?: number;
  settle?: "eth" | "tokens";
};

export type PlanState = { kind: "idle" | "planning" | "ready" | "signing" | "waiting" | "submitted" | "error"; message?: string };
export type BalanceState = { kind: "idle" | "loading" | "ready" | "error"; balanceWei?: string };

type RangeMode = "recenter" | "10" | "25" | "50" | "custom";

const TITLES: Record<PositionActionKind, string> = {
  collect: "Collect fees",
  compound: "Reinvest fees",
  increase: "Add liquidity",
  decrease: "Reduce position",
  rebalance: "Reposition range",
  withdraw: "Exit position",
};

const SUCCESS: Record<PositionActionKind, string> = {
  collect: "Fees are in your wallet.",
  compound: "Fees are back at work.",
  increase: "Liquidity added to this position.",
  decrease: "Tokens are back in your wallet.",
  rebalance: "Your liquidity is earning in its new range.",
  withdraw: "Position closed.",
};

/** ETH pairs on V3 or Slipstream can leave the pool as native ETH in one plan. */
export function settlesToEth(view: PositionView): boolean {
  return view.protocol === "V3" && view.chain !== "solana" && positionOrientation(view).quoteIsToken0 !== null;
}

export function ActionSheet({ position, action, ethUsd, image, balance, plan, state, onPlan, onExecute, onReset, onClose, onFund }: {
  position: PositionView;
  action: PositionActionKind;
  ethUsd?: number;
  image?: string | null;
  balance: BalanceState | null;
  plan: PositionActionPlan | null;
  state: PlanState;
  onPlan: (request: ActionRequest) => void;
  onExecute: () => void;
  onReset: () => void;
  onClose: () => void;
  onFund: () => void;
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
  const unit: "usd" | "eth" = ethUsd ? "usd" : "eth";
  const scale = ethUsd ?? 1;
  const canSettleEth = settlesToEth(position);

  const [amount, setAmount] = useState("0.05");
  const [percent, setPercent] = useState(50);
  const [rangeMode, setRangeMode] = useState<RangeMode>(() => {
    // Recentring a position that already sits on the live price is a no-op, so start from a fresh width instead.
    try {
      const recentred = recenteredRange(position);
      return recentred.tickLower === position.tickLower && recentred.tickUpper === position.tickUpper ? "25" : "recenter";
    } catch {
      return "25";
    }
  });
  const [customMin, setCustomMin] = useState("");
  const [customMax, setCustomMax] = useState("");
  const [settle, setSettle] = useState<"eth" | "tokens">(canSettleEth ? "eth" : "tokens");
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
    if (action === "collect") planRef.current({ action: "collect" });
  }, [action]);
  useEffect(() => {
    if (action !== "withdraw") return;
    planRef.current({ action: "withdraw", settle });
  }, [action, settle]);

  // Editing the form after a quote means the quote no longer matches it.
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    resetRef.current();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [amount, percent, rangeMode, customMin, customMax]);

  const currentBounds = useMemo(() => rangeBounds(position), [position]);
  useEffect(() => {
    if (rangeMode !== "custom" || customMin || customMax) return;
    setCustomMin(editablePrice(currentBounds.min * scale));
    setCustomMax(currentBounds.max === null ? "" : editablePrice(currentBounds.max * scale));
  }, [rangeMode, customMin, customMax, currentBounds, scale]);

  const proposal = useMemo<{ range: ProposedRange | null; error?: string }>(() => {
    if (action !== "rebalance") return { range: null };
    try {
      if (rangeMode === "recenter") return { range: recenteredRange(position) };
      if (rangeMode === "custom") {
        const min = Number(customMin) / scale;
        const max = Number(customMax) / scale;
        if (!customMin || !customMax) return { range: null };
        return { range: rangeFromMemePrices(position, min, max) };
      }
      return { range: rangeFromPercent(position, Number(rangeMode)) };
    } catch (error) {
      return { range: null, error: error instanceof Error ? error.message : "Choose a valid range" };
    }
  }, [action, rangeMode, customMin, customMax, position, scale]);
  const plannedRange = plan?.kind === "rebalance" && plan.range ? { tickLower: plan.range.tickLower, tickUpper: plan.range.tickUpper } : null;
  const chartRange = plannedRange ?? proposal.range;
  const proposalUnchanged = Boolean(proposal.range && proposal.range.tickLower === position.tickLower && proposal.range.tickUpper === position.tickUpper);

  const amountValid = isPositiveEth(amount);
  const insufficient = hasInsufficientBalance(amount, balance);
  const balanceLabel = balance?.kind === "ready" && balance.balanceWei !== undefined ? `${formatEth(balance.balanceWei)} ETH` : balance?.kind === "loading" ? "…" : "—";
  const decimals = { d0: plan?.tokens?.decimals0 ?? 18, d1: plan?.tokens?.decimals1 ?? 18 };

  function submit() {
    if (action === "increase") {
      if (!amountValid || insufficient) return;
      onPlan({ action: "increase", amountWei: parseEther(amount).toString() });
    } else if (action === "decrease") {
      onPlan({ action: "decrease", percent });
    } else if (action === "rebalance") {
      if (!proposal.range || proposalUnchanged) return;
      onPlan({ action: "rebalance", tickLower: proposal.range.tickLower, tickUpper: proposal.range.tickUpper });
    } else if (action === "withdraw") {
      onPlan({ action: "withdraw", settle });
    } else {
      onPlan({ action });
    }
  }

  const needsReview = action === "increase" || action === "decrease" || action === "rebalance";
  const submitDisabled = busy
    || (action === "increase" && (!amountValid || insufficient))
    || (action === "rebalance" && (!proposal.range || proposalUnchanged));
  const primaryLabel = executing
    ? (state.message ?? "Confirm in your wallet")
    : reviewing
      ? confirmLabel(action, plan, settle)
      : state.kind === "planning"
        ? "Quoting…"
        : needsReview ? "Review" : confirmLabel(action, plan, settle);
  const steps = plan?.transactions.length ?? 0;

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
        <p>{state.message ?? SUCCESS[action]}</p>
        <button type="button" className="sheet-primary" onClick={onClose}>Done</button>
      </div> : <>
        <div className="sheet-body">
          {action === "collect" ? <div className="sheet-block">
            <div className="sheet-figure"><small>Ready to collect</small><b className="positive">{hasCollectibleFees(position) ? positionFeesLabel(position) : "—"}</b></div>
            <dl className="sheet-rows">
              <div><dt>{position.symbol0}</dt><dd>{compactTokenAmount(position.uncollected0)}</dd></div>
              <div><dt>{position.symbol1}</dt><dd>{compactTokenAmount(position.uncollected1)}</dd></div>
            </dl>
            <p className="sheet-note">Fees return to your wallet. Your liquidity and range stay exactly as they are.</p>
          </div> : null}

          {action === "increase" ? <div className="sheet-block">
            <label className="sheet-amount">
              <span><small>Amount to add</small><small>Balance {balanceLabel}{balance?.kind === "ready" && balance.balanceWei ? <button type="button" onClick={() => setAmount(maxSpendable(balance.balanceWei!))} disabled={busy}>Max</button> : null}</small></span>
              <span><input type="text" inputMode="decimal" enterKeyHint="done" value={amount} onChange={(event) => setAmount(event.target.value)} aria-label="ETH amount" disabled={busy} autoFocus /><b>ETH</b></span>
            </label>
            {insufficient ? <p className="sheet-warning">Not enough {position.chainLabel} ETH for this amount. <button type="button" onClick={onFund}>Get {position.chainLabel} ETH</button></p> : null}
            <p className="sheet-note">Wizzy splits your ETH to match the current range, swaps through this pool, and adds to the same NFT. The range stays unchanged.</p>
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
            <p className="sheet-note">Any fees owed come out with it. The rest keeps earning in the same range. Need everything out? Use Exit.</p>
          </div> : null}

          {action === "rebalance" ? <div className="sheet-block">
            <div className="sheet-chips" role="group" aria-label="New range">
              {([["recenter", "Recentre"], ["10", "±10%"], ["25", "±25%"], ["50", "±50%"], ["custom", "Custom"]] as Array<[RangeMode, string]>).map(([mode, label]) => (
                <button key={mode} type="button" className={rangeMode === mode ? "is-active" : ""} aria-pressed={rangeMode === mode} disabled={busy} onClick={() => setRangeMode(mode)}>{label}</button>
              ))}
            </div>
            {rangeMode === "custom" ? <div className="sheet-range-inputs">
              <label><small>Min price ({unit === "usd" ? "USD" : "ETH"})</small><input type="text" inputMode="decimal" value={customMin} onChange={(event) => setCustomMin(event.target.value)} disabled={busy} aria-label="Minimum price" /></label>
              <label><small>Max price ({unit === "usd" ? "USD" : "ETH"})</small><input type="text" inputMode="decimal" value={customMax} onChange={(event) => setCustomMax(event.target.value)} disabled={busy} aria-label="Maximum price" /></label>
            </div> : null}
            <RangeChart view={position} ethUsd={ethUsd} proposed={chartRange ?? undefined} compact />
            {proposal.error ? <p className="sheet-warning">{proposal.error}</p> : null}
            {proposalUnchanged ? <p className="sheet-warning">That is the current range. Pick a different one.</p> : null}
            <dl className="sheet-rows">
              <div><dt>{orientation.memeSymbol} now</dt><dd>{formatPrice(memePriceNow(position) * scale, unit)}</dd></div>
              {chartRange ? <div><dt>New range</dt><dd>{rangeLabel(position, chartRange, scale, unit)}</dd></div> : null}
            </dl>
            <p className="sheet-note">Wizzy closes the current position, swaps only what the new range needs, and opens the new range in one wallet sequence.</p>
          </div> : null}

          {action === "withdraw" ? <div className="sheet-block">
            {canSettleEth ? <div className="sheet-segmented" role="group" aria-label="Receive">
              <button type="button" className={settle === "eth" ? "is-active" : ""} aria-pressed={settle === "eth"} disabled={busy} onClick={() => setSettle("eth")}>Receive ETH</button>
              <button type="button" className={settle === "tokens" ? "is-active" : ""} aria-pressed={settle === "tokens"} disabled={busy} onClick={() => setSettle("tokens")}>Receive both tokens</button>
            </div> : null}
            <dl className="sheet-rows">
              <div><dt>Position</dt><dd>{compactTokenAmount(position.amount0)} {position.symbol0} + {compactTokenAmount(position.amount1)} {position.symbol1}</dd></div>
              {hasCollectibleFees(position) ? <div><dt>Plus fees</dt><dd>{compactTokenAmount(position.uncollected0)} {position.symbol0} + {compactTokenAmount(position.uncollected1)} {position.symbol1}</dd></div> : null}
            </dl>
            <p className="sheet-note">{settle === "eth" && canSettleEth
              ? `Everything leaves the pool, ${orientation.memeSymbol} is swapped through this pool, and native ETH lands in your wallet.`
              : "Everything leaves the pool and both tokens land in your wallet. No swap is taken."}</p>
          </div> : null}

          {reviewing && plan ? <dl className="sheet-review" aria-live="polite">
            {plan.kind === "increase" && plan.funding ? <div><dt>You add</dt><dd>{compactRaw(plan.funding.quoteAmount, 18)} {plan.funding.quoteSymbol} + {compactRaw(plan.funding.memeAmount, memeDecimals(plan))} {plan.funding.memeSymbol}</dd></div> : null}
            {plan.kind === "decrease" && plan.removal ? <div><dt>You receive ≈</dt><dd>{compactRaw(plan.removal.amount0, decimals.d0)} {position.symbol0} + {compactRaw(plan.removal.amount1, decimals.d1)} {position.symbol1}</dd></div> : null}
            {plan.kind === "rebalance" && plan.range ? <div><dt>New range</dt><dd>{rangeLabel(position, plan.range, scale, unit)}</dd></div> : null}
            {plan.kind === "rebalance" && plan.range?.swap ? <div><dt>Swap</dt><dd>{compactRaw(plan.range.swap.amountIn, symbolDecimals(plan, plan.range.swap.tokenIn))} {plan.range.swap.tokenIn} → {plan.range.swap.tokenOut}</dd></div> : null}
            {plan.kind === "rebalance" && !plan.range?.swap ? <div><dt>Swap</dt><dd>None needed</dd></div> : null}
            {plan.kind === "withdraw" && plan.settlement ? <div><dt>You receive</dt><dd>at least {ethValue(Number(formatEther(BigInt(plan.settlement.minimumAmountWei))))}</dd></div> : null}
            {plan.kind === "withdraw" && !plan.settlement && plan.removal ? <div><dt>You receive ≈</dt><dd>{compactRaw(plan.removal.amount0, decimals.d0)} {position.symbol0} + {compactRaw(plan.removal.amount1, decimals.d1)} {position.symbol1}</dd></div> : null}
            <div><dt>Wallet steps</dt><dd>{steps} {steps === 1 ? "confirmation" : "confirmations"}</dd></div>
            <div><dt>Wizzy fee</dt><dd>None</dd></div>
          </dl> : null}

          {state.kind === "error" ? <p className="sheet-error" role="alert">{state.message}</p> : null}
        </div>
        <footer className="sheet-foot">
          {executing ? <span className="sheet-progress" aria-live="polite"><i /><span>{state.message ?? "Confirm in your wallet"}</span></span> : null}
          <div className="sheet-buttons">
            {reviewing && needsReview && !executing ? <button type="button" className="sheet-secondary" onClick={onReset}>Edit</button> : null}
            <button type="button" className="sheet-primary" disabled={submitDisabled || executing || (reviewing && !plan)} onClick={reviewing ? onExecute : submit}>{primaryLabel}</button>
          </div>
        </footer>
      </>}
    </section>
  </div>, document.body);
}

function confirmLabel(action: PositionActionKind, plan: PositionActionPlan | null, settle: "eth" | "tokens"): string {
  if (action === "collect") return "Collect fees";
  if (action === "compound") return "Reinvest fees";
  if (action === "increase") return "Add liquidity";
  if (action === "decrease") return `Remove ${plan?.removal?.percent ?? ""}%`.replace(" %", "");
  if (action === "rebalance") return "Reposition";
  return plan?.settlement || settle === "eth" ? "Exit to ETH" : "Exit position";
}

function doneTitle(action: PositionActionKind, plan: PositionActionPlan | null): string {
  if (action === "collect") return "Fees collected";
  if (action === "compound") return "Fees reinvested";
  if (action === "increase") return "Liquidity added";
  if (action === "decrease") return `${plan?.removal?.percent ?? ""}% removed`.trim();
  if (action === "rebalance") return "Range moved";
  return plan?.settlement ? "Exited to ETH" : "Position exited";
}

function memeDecimals(plan: PositionActionPlan): number {
  if (!plan.tokens || !plan.funding) return 18;
  return plan.funding.memeSymbol === plan.tokens.symbol0 ? plan.tokens.decimals0 : plan.tokens.decimals1;
}

function symbolDecimals(plan: PositionActionPlan, symbol: string): number {
  if (!plan.tokens) return 18;
  return symbol === plan.tokens.symbol0 ? plan.tokens.decimals0 : plan.tokens.decimals1;
}

function rangeLabel(position: PositionView, range: ProposedRange, scale: number, unit: "usd" | "eth"): string {
  const bounds = rangeBounds(position, range);
  return `${formatPrice(bounds.min * scale, unit)} – ${formatPrice((bounds.max ?? 0) * scale, unit)}`;
}

function scaledAmount(formatted: string, percent: number): string {
  const numeric = Number(formatted.replaceAll(",", ""));
  if (!Number.isFinite(numeric)) return formatted;
  return compactTokenAmount(String((numeric * percent) / 100));
}

function editablePrice(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "";
  if (value >= 1) return value.toFixed(value >= 1000 ? 0 : 4).replace(/\.?0+$/, "");
  return value.toFixed(Math.min(18, Math.max(4, 4 - Math.floor(Math.log10(value))))).replace(/0+$/, "");
}

function isPositiveEth(amount: string): boolean {
  try {
    return parseEther(amount || "0") > 0n;
  } catch {
    return false;
  }
}

function hasInsufficientBalance(amount: string, balance: BalanceState | null): boolean {
  if (balance?.kind !== "ready" || balance.balanceWei === undefined) return false;
  try {
    return parseEther(amount || "0") > BigInt(balance.balanceWei);
  } catch {
    return false;
  }
}

/** Leave a little gas behind when the user taps Max. */
function maxSpendable(balanceWei: string): string {
  const reserve = parseEther("0.002");
  const balance = BigInt(balanceWei);
  const spendable = balance > reserve ? balance - reserve : 0n;
  return trimEth(spendable);
}

function formatEth(balanceWei: string): string {
  const value = Number(formatEther(BigInt(balanceWei)));
  if (value === 0) return "0";
  if (value < 0.0001) return "<0.0001";
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: value < 1 ? 4 : 3 }).format(value);
}

function trimEth(value: bigint): string {
  const formatted = formatEther(value);
  const [whole, fraction = ""] = formatted.split(".");
  return fraction ? `${whole}.${fraction.slice(0, 6).replace(/0+$/, "") || "0"}` : whole!;
}
