"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { formatEther, isAddress, parseEther } from "viem";
import { sendValidationError } from "./lib/send-eth";

type SendPhase = "form" | "review" | "signing" | "waiting" | "success" | "error";

export function SendEthDialog({ open, owner, balanceWei, onClose, onSend }: {
  open: boolean;
  owner: string;
  balanceWei?: string;
  onClose: () => void;
  onSend: (recipient: `0x${string}`, amountWei: string, onSubmitted: () => void) => Promise<`0x${string}` | null>;
}) {
  const dialogRef = useRef<HTMLElement>(null);
  const [recipient, setRecipient] = useState("");
  const [amount, setAmount] = useState("");
  const [phase, setPhase] = useState<SendPhase>("form");
  const [message, setMessage] = useState<string | null>(null);
  const [transactionHash, setTransactionHash] = useState<`0x${string}` | null>(null);
  const busy = phase === "signing" || phase === "waiting";
  const busyRef = useRef(busy);
  const onCloseRef = useRef(onClose);
  busyRef.current = busy;
  onCloseRef.current = onClose;
  const amountWei = useMemo(() => parseAmount(amount), [amount]);

  useEffect(() => {
    if (!open) return;
    setRecipient("");
    setAmount("");
    setPhase("form");
    setMessage(null);
    setTransactionHash(null);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.requestAnimationFrame(() => dialogRef.current?.querySelector<HTMLElement>('button:not(:disabled), input:not(:disabled)')?.focus());
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busyRef.current) {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current) return;
      const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), a[href], [tabindex]:not([tabindex="-1"])'));
      if (!focusable.length) return;
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKeyDown);
      window.requestAnimationFrame(() => {
        const fallback = document.querySelector<HTMLElement>(".wallet-menu-root > .wallet-button");
        (previouslyFocused?.isConnected ? previouslyFocused : fallback)?.focus();
      });
    };
  }, [open]);

  if (!open || typeof document === "undefined") return null;

  const review = () => {
    const error = sendValidationError({ owner, recipient, amountWei, balanceWei });
    if (error) {
      setMessage(error);
      return;
    }
    setMessage(null);
    setPhase("review");
  };

  const submit = async () => {
    const error = sendValidationError({ owner, recipient, amountWei, balanceWei });
    if (error || amountWei === null || !isAddress(recipient)) {
      setMessage(error ?? "Check the recipient and amount.");
      setPhase("form");
      return;
    }
    setMessage("Approve this Robinhood Chain transfer.");
    setPhase("signing");
    try {
      const hash = await onSend(recipient, amountWei.toString(), () => {
        setPhase("waiting");
        setMessage("Approved. Robinhood Chain is confirming your transfer.");
      });
      setTransactionHash(hash);
      setPhase("success");
      setMessage(`${displayEth(amountWei)} ETH is on its way to ${shortAddress(recipient)}.`);
    } catch (error) {
      setPhase("error");
      setMessage(error instanceof Error ? error.message : "The transfer could not be completed.");
    }
  };

  return createPortal(<div className="send-eth-backdrop" onPointerDown={(event) => { if (event.currentTarget === event.target && !busy) onClose(); }}>
    <section ref={dialogRef} className={`send-eth-dialog is-${phase}`} role="dialog" aria-modal="true" aria-labelledby="send-eth-title" aria-describedby="send-eth-description">
      <header>
        <span><img src="/brand/wizzy-mascot-32.png" alt="" /><span><small>Your wallet</small><b>Robinhood Chain</b></span></span>
        <button type="button" onClick={onClose} disabled={busy}>Close</button>
      </header>

      {phase === "form" ? <div className="send-eth-body">
        <div className="send-eth-heading"><h2 id="send-eth-title">Send ETH</h2><p id="send-eth-description">Move ETH from your wallet to another address.</p></div>
        <label className="send-eth-field">
          <span>Recipient</span>
          <input name="sendRecipient" autoComplete="off" spellCheck={false} value={recipient} placeholder="0x…" onChange={(event) => { setRecipient(event.target.value.trim()); setMessage(null); }} />
        </label>
        <label className="send-eth-field">
          <span><span>Amount</span><small>Balance {balanceWei ? displayEth(BigInt(balanceWei)) : "—"} ETH</small></span>
          <span className="send-eth-amount"><input name="sendAmount" inputMode="decimal" value={amount} placeholder="0.00" onChange={(event) => { setAmount(event.target.value); setMessage(null); }} /><button type="button" disabled={!balanceWei || BigInt(balanceWei) === 0n} onClick={() => { if (balanceWei) setAmount(formatEther(BigInt(balanceWei))); setMessage(null); }}>Max</button><b>ETH</b></span>
        </label>
        {message ? <p className="send-eth-error" role="alert">{message}</p> : null}
        <div className="send-eth-network"><img src="https://assets.relay.link/icons/4663/light.png" alt="" /><span><b>Robinhood Chain</b><small>Network fee paid from your wallet</small></span></div>
        <button className="send-eth-primary" type="button" onClick={review}>Review transfer</button>
      </div> : null}

      {phase === "review" ? <div className="send-eth-body">
        <div className="send-eth-heading"><h2 id="send-eth-title">Review transfer</h2><p id="send-eth-description">Check the destination before approving.</p></div>
        <dl className="send-eth-review">
          <div><dt>You send</dt><dd>{amountWei === null ? "—" : displayEth(amountWei)} ETH</dd></div>
          <div><dt>To</dt><dd title={recipient}>{recipient}</dd></div>
          <div><dt>Network</dt><dd>Robinhood Chain</dd></div>
          <div><dt>Network fee</dt><dd>Sponsored</dd></div>
        </dl>
        <p className="send-eth-warning">Only send to an address that supports Robinhood Chain.</p>
        <div className="send-eth-buttons"><button type="button" onClick={() => setPhase("form")}>Back</button><button className="send-eth-primary" type="button" onClick={() => void submit()}>Send ETH</button></div>
      </div> : null}

      {busy ? <div className="send-eth-status" aria-live="polite">
        <div className="plan-loading" role="status" aria-label={message ?? "Sending ETH"}><i /><i /><i /></div>
        <h2 id="send-eth-title">{phase === "signing" ? "Approve transfer" : "Sending ETH"}</h2>
        <p id="send-eth-description">{message}</p>
      </div> : null}

      {phase === "error" ? <div className="send-eth-status" aria-live="polite">
        <span className="send-eth-status-mark is-error">!</span>
        <h2 id="send-eth-title">Transfer not sent</h2>
        <p id="send-eth-description">{message}</p>
        <div className="send-eth-buttons"><button type="button" onClick={() => setPhase("form")}>Edit transfer</button><button className="send-eth-primary" type="button" onClick={() => void submit()}>Try again</button></div>
      </div> : null}

      {phase === "success" ? <div className="send-eth-status" aria-live="polite">
        <span className="send-eth-status-mark is-success"><img src="/brand/wizzy-mascot-32.png" alt="" /><CheckIcon /></span>
        <h2 id="send-eth-title">ETH sent</h2>
        <p id="send-eth-description">{message}</p>
        {transactionHash ? <a className="send-eth-explorer" href={`https://robinhoodchain.blockscout.com/tx/${transactionHash}`} target="_blank" rel="noreferrer">View transaction <ExternalLinkIcon /></a> : null}
        <button className="send-eth-primary" type="button" onClick={onClose}>Done</button>
      </div> : null}
    </section>
  </div>, document.body);
}

function parseAmount(value: string): bigint | null {
  try {
    return parseEther(value);
  } catch {
    return null;
  }
}

function displayEth(value: bigint): string {
  const [whole, fraction = ""] = formatEther(value).split(".");
  const trimmed = fraction.replace(/0+$/, "");
  return trimmed ? `${whole}.${trimmed}` : whole!;
}

function shortAddress(value: string): string {
  return `${value.slice(0, 6)}…${value.slice(-4)}`;
}

function CheckIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 12.5 4 4 8-9" /></svg>;
}

function ExternalLinkIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 5h5v5M19 5l-8 8M17 13v5a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1h5" /></svg>;
}
