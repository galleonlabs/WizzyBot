"use client";

import { usd, type ConfirmView } from "./lib/cards";

export function ConfirmCard({
  confirm,
  prompt,
  options,
  onPick,
}: {
  confirm?: ConfirmView;
  prompt?: string;
  options?: { id: string; label: string }[];
  onPick: (optionId: string) => void;
}) {
  return (
    <section className="confirm-card">
      <header>
        <h3>Review transaction</h3>
        <span>Nothing signs until you approve.</span>
      </header>
      {confirm ? (
        <dl>
          <dt>action</dt>
          <dd>
            {confirm.action} · {confirm.protocol} · {confirm.pair} {confirm.feeLabel}
          </dd>
          {confirm.tokenId ? (
            <>
              <dt>token</dt>
              <dd>#{confirm.tokenId}</dd>
            </>
          ) : null}
          {confirm.tickLower !== undefined && confirm.tickUpper !== undefined ? (
            <>
              <dt>range</dt>
              <dd>
                [{confirm.tickLower}, {confirm.tickUpper}]
                {confirm.tickCurrent !== undefined ? ` · current ${confirm.tickCurrent}` : ""}
              </dd>
            </>
          ) : null}
          {confirm.amount0 || confirm.amount1 ? (
            <>
              <dt>amounts</dt>
              <dd>
                {confirm.amount0} {confirm.symbol0} + {confirm.amount1} {confirm.symbol1}
              </dd>
            </>
          ) : null}
          <dt>est. fees</dt>
          <dd>{usd(confirm.feesUsd)}</dd>
          <dt>gas</dt>
          <dd>{usd(confirm.gasUsd)}</dd>
          <dt>protocol</dt>
          <dd>
            {confirm.protocolFeeBps !== undefined
              ? `${(confirm.protocolFeeBps / 100).toFixed(2)}% take${confirm.protocolFeeUsd !== undefined ? ` · ${usd(confirm.protocolFeeUsd)}` : ""}`
              : confirm.protocol}
            {confirm.protocolFeeSource ? ` · ${confirm.protocolFeeSource}` : ""}
          </dd>
        </dl>
      ) : prompt ? (
        <p>{prompt}</p>
      ) : (
        <p>This transaction is ready for your review.</p>
      )}
      {confirm?.reason ? <p className="confirm-reason">{confirm.reason}</p> : null}
      <div className="confirm-row">
        {options?.map((option, i) => (
          <button
            key={option.id}
            className={i === 0 ? "btn btn-accent" : "btn"}
            type="button"
            onClick={() => onPick(option.id)}
          >
            {option.label}
          </button>
        ))}
      </div>
    </section>
  );
}
