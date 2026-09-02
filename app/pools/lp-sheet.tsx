"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { formatEther, formatUnits, parseEther, parseUnits } from "viem";
import { getBalance, readContract } from "wagmi/actions";
import { useConfig } from "wagmi";
import type { PositionView } from "../lib/cards";
import type { ChainSlug } from "../lib/chains";
import { compactRaw, compactTokenAmount, ethValue, money } from "../lib/format";
import { createPositionUrl, managePositionUrl, venueLabelFor, type LinkVenue } from "../lib/links";
import { readJsonPayload } from "../lib/api-payload";
import { RELAY_CHAINS, type CuratedPool, type RelaySwapQuote } from "../lib/portfolio-types";
import { relaySucceeded, sendPlanTransactions } from "../lib/wallet-calls";
import { reportClientError, trackProductEvent } from "../lib/telemetry-client";
import { CheckIcon, CloseIcon, ExternalLinkIcon, TokenIcon } from "../ui/icons";

/**
 * The monetised Relay step. Wizzy swaps the wallet into the exact tokens a
 * pool needs (or back out of them), taking its fee inside the Relay quote,
 * then hands the user to the venue's own page to finish.
 */
export type LpTarget =
  | { kind: "new"; pool: CuratedPool }
  | { kind: "add"; position: PositionView; meme: { address: string; symbol: string; decimals: number }; image?: string | null }
  | { kind: "sell"; position: PositionView; token: { address: string; symbol: string; decimals: number }; image?: string | null };

type Phase = "form" | "quoting" | "quoted" | "executing" | "done" | "error";
type Leg = { label: string; quote: RelaySwapQuote };
const NATIVE = "0x0000000000000000000000000000000000000000";
const STATUS_POLL_MS = 3_000;
const STATUS_TIMEOUT_MS = 6 * 60_000;
const ERC20_BALANCE_ABI = [{ type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "owner", type: "address" }], outputs: [{ type: "uint256" }] }] as const;

export function LpSheet({ target, owner, onClose, onCompleted }: {
  target: LpTarget;
  owner: `0x${string}` | undefined;
  onClose: () => void;
  onCompleted?: () => void;
}) {
  const config = useConfig();
  const destination = destinationFor(target);
  const [phase, setPhase] = useState<Phase>("form");
  const [originChainId, setOriginChainId] = useState(destination.chainId);
  const [amount, setAmount] = useState(target.kind === "sell" ? "" : "0.05");
  const [share, setShare] = useState(50);
  const [legs, setLegs] = useState<Leg[]>([]);
  const [progress, setProgress] = useState<string>("");
  const [error, setError] = useState<string>("");
  const [balance, setBalance] = useState<{ chainId: number; wei: bigint } | null>(null);
  const [tokenBalance, setTokenBalance] = useState<bigint | null>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const executing = phase === "executing";
  const sell = target.kind === "sell";

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

  // Live wallet balance on the pay-from network, read through the app's own RPC transports.
  useEffect(() => {
    if (!owner) return;
    let active = true;
    setBalance(null);
    getBalance(config, { address: owner, chainId: originChainId as 8453 })
      .then((result) => { if (active) setBalance({ chainId: originChainId, wei: result.value }); })
      .catch(() => { if (active) setBalance(null); });
    return () => { active = false; };
  }, [config, owner, originChainId]);

  useEffect(() => {
    if (!owner || target.kind !== "sell") return;
    let active = true;
    readContract(config, { address: target.token.address as `0x${string}`, abi: ERC20_BALANCE_ABI, functionName: "balanceOf", args: [owner], chainId: destination.chainId as 8453 })
      .then((result) => {
        if (!active) return;
        setTokenBalance(result);
        setAmount(trimUnits(formatUnits(result, target.token.decimals)));
      })
      .catch(() => { if (active) setTokenBalance(null); });
    return () => { active = false; };
  }, [config, owner, target, destination.chainId]);

  const amountWei = useMemo(() => {
    try {
      if (!amount) return 0n;
      return sell ? parseUnits(amount, target.token.decimals) : parseEther(amount);
    } catch {
      return 0n;
    }
  }, [amount, sell, target]);
  const crossChain = !sell && originChainId !== destination.chainId;
  const insufficient = sell ? tokenBalance !== null && amountWei > tokenBalance : balance?.chainId === originChainId && amountWei > balance.wei;
  const canQuote = Boolean(owner) && amountWei > 0n && !insufficient && (sell || share > 0);
  const originLabel = RELAY_CHAINS.find((chain) => chain.id === originChainId)?.label ?? "this network";

  async function quoteLeg(input: { label: string; originChainId: number; destinationChainId: number; originCurrency: string; destinationCurrency: string; amountWei: bigint }): Promise<Leg> {
    const response = await fetch("/api/relay/quote", {
      method: "POST",
      headers: { "content-type": "application/json" },
      cache: "no-store",
      body: JSON.stringify({ owner, originChainId: input.originChainId, destinationChainId: input.destinationChainId, originCurrency: input.originCurrency, destinationCurrency: input.destinationCurrency, amountWei: input.amountWei.toString() }),
    });
    const payload = await readJsonPayload(response) as { quote?: RelaySwapQuote; error?: string };
    if (!response.ok || !payload.quote) throw new Error(payload.error ?? "Relay could not quote this step");
    return { label: input.label, quote: payload.quote };
  }

  async function buildLegs(): Promise<Leg[]> {
    if (sell) {
      return [await quoteLeg({ label: `Sell ${target.token.symbol} for ETH`, originChainId: destination.chainId, destinationChainId: destination.chainId, originCurrency: target.token.address, destinationCurrency: NATIVE, amountWei })];
    }
    const meme = destination.meme;
    if (!crossChain) {
      const swapWei = (amountWei * BigInt(share)) / 100n;
      if (swapWei <= 0n) throw new Error("Choose a share to swap into the token");
      return [await quoteLeg({ label: `Swap ETH for ${meme.symbol}`, originChainId: destination.chainId, destinationChainId: destination.chainId, originCurrency: NATIVE, destinationCurrency: meme.address, amountWei: swapWei })];
    }
    const bridge = await quoteLeg({ label: `Move ETH from ${originLabel} to ${destination.chainLabel}`, originChainId, destinationChainId: destination.chainId, originCurrency: NATIVE, destinationCurrency: NATIVE, amountWei });
    const swapWei = (BigInt(bridge.quote.minimumAmountOut) * BigInt(share)) / 100n;
    const swap = await quoteLeg({ label: `Swap ETH for ${meme.symbol} on ${destination.chainLabel}`, originChainId: destination.chainId, destinationChainId: destination.chainId, originCurrency: NATIVE, destinationCurrency: meme.address, amountWei: swapWei });
    return [bridge, swap];
  }

  async function prepare() {
    if (!canQuote) return;
    setPhase("quoting");
    setError("");
    try {
      setLegs(await buildLegs());
      setPhase("quoted");
      trackProductEvent("Relay Quote Ready", { mode: target.kind, chainId: destination.chainId });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Relay could not quote this");
      setPhase("error");
      reportClientError("relay", caught);
    }
  }

  async function execute() {
    if (!owner || !legs.length) return;
    setPhase("executing");
    setError("");
    try {
      const fresh = await buildLegs();
      const completed: Leg[] = [];
      for (const [index, leg] of fresh.entries()) {
        let current = leg;
        if (index > 0) {
          // Re-quote the destination swap against what the bridge actually guarantees.
          setProgress(`Refreshing ${leg.label.toLowerCase()}…`);
          const previous = completed[index - 1]!;
          const swapWei = (BigInt(previous.quote.minimumAmountOut) * BigInt(share)) / 100n;
          current = await quoteLeg({ label: leg.label, originChainId: leg.quote.originChainId, destinationChainId: leg.quote.destinationChainId, originCurrency: leg.quote.currencyIn.address, destinationCurrency: leg.quote.currencyOut.address, amountWei: swapWei });
        }
        for (const step of current.quote.steps) {
          setProgress(`${current.label} · ${step.description}`);
          await sendPlanTransactions({
            config,
            owner,
            chainId: current.quote.originChainId,
            transactions: step.transactions,
            onProgress: ({ description }) => setProgress(`${current.label} · ${description}`),
          });
        }
        setProgress(`${current.label} · waiting for Relay to fill…`);
        await waitForRelay(current.quote.statusPath);
        completed.push(current);
        setLegs([...completed, ...fresh.slice(index + 1)]);
      }
      setLegs(completed);
      setPhase("done");
      trackProductEvent("Relay Step Confirmed", { mode: target.kind, chainId: destination.chainId, legs: completed.length });
      onCompleted?.();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The Relay step did not complete");
      setPhase("error");
      reportClientError("relay", caught);
    }
  }

  const delivered = deliveredSummary(target, legs, amountWei, share, crossChain);
  const totalAppUsd = legs.reduce((sum, leg) => sum + Number(leg.quote.fees.appUsd ?? 0), 0);
  const totalRelayUsd = legs.reduce((sum, leg) => sum + Number(leg.quote.fees.relayerUsd ?? 0) + Number(leg.quote.fees.gasUsd ?? 0), 0);
  const finishUrl = target.kind === "new"
    ? createPositionUrl({ venue: target.pool.venue, chain: target.pool.chain, token: target.pool.token.address, quote: target.pool.quote.address, fee: target.pool.fee, tickSpacing: target.pool.tickSpacing })
    : target.kind === "add"
      ? managePositionUrl({ venue: linkVenue(target.position), chain: target.position.chain === "robinhood" ? "robinhood" : "base", tokenId: target.position.tokenId, pool: target.position.pool })
      : null;
  const finishLabel = target.kind === "new" ? `Open pool on ${venueLabelFor(target.pool.venue)}` : target.kind === "add" ? `Add on ${venueLabelFor(linkVenue(target.position))}` : "Done";
  const title = target.kind === "new" ? "LP this pool" : target.kind === "add" ? "Add to position" : `Sell ${target.token.symbol}`;
  const subtitle = destination.pair;

  return createPortal(<div className="sheet-backdrop" onPointerDown={(event) => { if (event.currentTarget === event.target && !executing) onClose(); }}>
    <section className={`sheet is-lp ${phase === "done" ? "is-done" : ""}`} role="dialog" aria-modal="true" aria-labelledby="lp-sheet-title">
      <header className="sheet-head">
        <span className="sheet-identity">
          <TokenIcon symbol={destination.meme.symbol} src={destination.image} size={34} />
          <span><small>{subtitle}</small><b id="lp-sheet-title">{title}</b></span>
        </span>
        <button type="button" className="sheet-close" onClick={onClose} disabled={executing} aria-label="Close"><CloseIcon /></button>
      </header>

      {phase === "done" ? <div className="sheet-done">
        <span className="sheet-done-mark"><img src="/brand/wizzy-mascot-dark.svg" alt="" /><i><CheckIcon /></i></span>
        <h2>{sell ? "Sold to ETH" : "Tokens are ready"}</h2>
        <p>{delivered.map((entry) => `${entry.amount} ${entry.symbol}`).join(" + ")} {sell ? "is in your wallet." : `landed in your wallet on ${destination.chainLabel}.`}</p>
        {finishUrl ? <a className="sheet-primary sheet-link" href={finishUrl} target="_blank" rel="noreferrer" onClick={() => trackProductEvent("Venue Opened", { mode: target.kind, chainId: destination.chainId })}>{finishLabel}<ExternalLinkIcon /></a> : <button type="button" className="sheet-primary" onClick={onClose}>Done</button>}
        {finishUrl ? <p className="sheet-note">Set your range and confirm there. Wizzy never holds your funds.</p> : null}
      </div> : <>
        <div className="sheet-body">
          {!owner ? <p className="sheet-warning">Connect a wallet to continue.</p> : null}
          {!sell ? <label className="sheet-field">
            <small>Pay from</small>
            <select value={originChainId} disabled={phase === "quoting" || executing} onChange={(event) => { setOriginChainId(Number(event.target.value)); setLegs([]); setPhase("form"); }} aria-label="Pay from network">
              {RELAY_CHAINS.map((chain) => <option key={chain.id} value={chain.id}>{chain.label}{chain.id === destination.chainId ? " · same network" : ""}</option>)}
            </select>
          </label> : null}
          <label className="sheet-amount">
            <span><small>{sell ? `Amount of ${target.token.symbol}` : "Amount"}</small><small>Balance {sell ? (tokenBalance === null ? "—" : compactTokenAmount(formatUnits(tokenBalance, target.token.decimals))) : balance?.chainId === originChainId ? `${trimUnits(formatEther(balance.wei))} ETH` : "…"}{(sell ? tokenBalance !== null : balance?.chainId === originChainId) ? <button type="button" disabled={executing} onClick={() => setAmount(sell ? trimUnits(formatUnits(tokenBalance!, target.token.decimals)) : maxSpendable(balance!.wei))}>Max</button> : null}</small></span>
            <span><input type="text" inputMode="decimal" enterKeyHint="done" value={amount} onChange={(event) => { setAmount(event.target.value); setLegs([]); setPhase("form"); }} aria-label={sell ? "Token amount" : "ETH amount"} disabled={phase === "quoting" || executing} autoFocus /><b>{sell ? target.token.symbol : "ETH"}</b></span>
          </label>
          {insufficient ? <p className="sheet-warning">Not enough balance on {sell ? destination.chainLabel : originLabel}.</p> : null}
          {!sell ? <div className="sheet-split">
            <span><small>Swap into {destination.meme.symbol}</small><b>{share}%</b><small>keep {100 - share}% as ETH</small></span>
            <input className="sheet-slider" type="range" min={10} max={90} step={5} value={share} disabled={phase === "quoting" || executing} onChange={(event) => { setShare(Number(event.target.value)); setLegs([]); setPhase("form"); }} aria-label="Share of ETH to swap into the token" />
            <p className="sheet-note">A 50/50 split fits a range centred on the current price. Lean towards {destination.meme.symbol} for a range above it, towards ETH for a range below.</p>
          </div> : null}

          {legs.length && (phase === "quoted" || executing) ? <dl className="sheet-review" aria-live="polite">
            {legs.map((leg) => <div key={leg.quote.requestId}><dt>{leg.label}</dt><dd>{formatOut(leg.quote)}</dd></div>)}
            <div><dt>You end with ≈</dt><dd>{delivered.map((entry) => `${entry.amount} ${entry.symbol}`).join(" + ")}</dd></div>
            <div><dt>Wizzy fee</dt><dd>{legs[0]!.quote.fees.appBps / 100}% · {money(totalAppUsd)}</dd></div>
            <div><dt>Relay + gas</dt><dd>≈ {money(totalRelayUsd)}</dd></div>
            <div><dt>Wallet steps</dt><dd>{legs.reduce((sum, leg) => sum + leg.quote.transactions.length, 0)}</dd></div>
          </dl> : null}
          {phase === "error" ? <p className="sheet-error" role="alert">{error}</p> : null}
          {phase === "form" && !sell ? <p className="sheet-note">Relay swaps you into the exact tokens, then Wizzy opens {venueLabelFor(target.kind === "new" ? target.pool.venue : linkVenue(target.position))} with this pool preselected so you set the range yourself.</p> : null}
        </div>
        <footer className="sheet-foot">
          {executing ? <span className="sheet-progress" aria-live="polite"><i /><span>{progress || "Confirm in your wallet"}</span></span> : null}
          <div className="sheet-buttons">
            {phase === "quoted" ? <button type="button" className="sheet-secondary" onClick={() => { setLegs([]); setPhase("form"); }}>Edit</button> : null}
            <button type="button" className="sheet-primary" disabled={!canQuote || phase === "quoting" || executing} onClick={phase === "quoted" ? execute : prepare}>
              {executing ? "Working…" : phase === "quoting" ? "Quoting…" : phase === "quoted" ? (sell ? "Sell for ETH" : crossChain ? "Bridge and swap" : "Swap") : "Get quote"}
            </button>
          </div>
        </footer>
      </>}
    </section>
  </div>, document.body);

  async function waitForRelay(statusPath: string): Promise<void> {
    const started = Date.now();
    while (Date.now() - started < STATUS_TIMEOUT_MS) {
      const response = await fetch(statusPath, { cache: "no-store" });
      const payload = await readJsonPayload(response) as { status?: string; error?: string };
      if (relaySucceeded(payload)) return;
      const status = String(payload.status ?? "").toLowerCase();
      if (status === "failure" || status === "refund") throw new Error(status === "refund" ? "Relay could not fill this and refunded your wallet." : "Relay reported the fill failed.");
      await new Promise((resolve) => setTimeout(resolve, STATUS_POLL_MS));
    }
    throw new Error("Relay is taking longer than expected. Check your wallet before retrying.");
  }
}

function destinationFor(target: LpTarget): { chainId: number; chainLabel: string; pair: string; meme: { address: string; symbol: string; decimals: number }; image: string | null | undefined } {
  if (target.kind === "new") {
    return {
      chainId: target.pool.chainId,
      chainLabel: target.pool.chain === "robinhood" ? "Robinhood Chain" : "Base",
      pair: `${target.pool.token.symbol} / ${target.pool.quote.symbol} · ${target.pool.venueLabel} · ${target.pool.chain === "robinhood" ? "Robinhood" : "Base"}`,
      meme: { address: target.pool.token.address, symbol: target.pool.token.symbol, decimals: 18 },
      image: target.pool.token.imageUrl,
    };
  }
  const chainId = target.position.chain === "robinhood" ? 4663 : 8453;
  const chainLabel = target.position.chain === "robinhood" ? "Robinhood Chain" : "Base";
  const meme = target.kind === "add" ? target.meme : target.token;
  return { chainId, chainLabel, pair: `${target.position.symbol0} / ${target.position.symbol1} · ${chainLabel}`, meme, image: target.image };
}

export function linkVenue(position: PositionView): LinkVenue {
  if (position.venue === "aerodrome-slipstream") return "aerodrome-slipstream";
  if (position.protocol === "V2") return "uniswap-v2";
  if (position.protocol === "V4") return "uniswap-v4";
  return "uniswap-v3";
}

function deliveredSummary(target: LpTarget, legs: Leg[], amountWei: bigint, share: number, crossChain: boolean): Array<{ amount: string; symbol: string }> {
  if (!legs.length) return [];
  if (target.kind === "sell") {
    const leg = legs[0]!;
    return [{ amount: trimUnits(formatEther(BigInt(leg.quote.expectedAmountOut))), symbol: "ETH" }];
  }
  const swap = legs[legs.length - 1]!;
  const ethIn = crossChain ? BigInt(legs[0]!.quote.minimumAmountOut) : amountWei;
  const keptEth = ethIn - BigInt(swap.quote.amountIn);
  return [
    { amount: trimUnits(formatEther(keptEth > 0n ? keptEth : 0n)), symbol: "ETH" },
    { amount: compactRaw(swap.quote.expectedAmountOut, swap.quote.currencyOut.decimals), symbol: swap.quote.currencyOut.symbol },
  ].filter((entry) => Number(entry.amount) > 0 || share === 100);
}

function formatOut(quote: RelaySwapQuote): string {
  const amount = quote.currencyOut.address.toLowerCase() === NATIVE ? ethValue(Number(formatEther(BigInt(quote.expectedAmountOut)))) : `${compactRaw(quote.expectedAmountOut, quote.currencyOut.decimals)} ${quote.currencyOut.symbol}`;
  return quote.amountOutUsd ? `${amount} · ${money(Number(quote.amountOutUsd))}` : amount;
}

function maxSpendable(balanceWei: bigint): string {
  const reserve = parseEther("0.003");
  return trimUnits(formatEther(balanceWei > reserve ? balanceWei - reserve : 0n));
}

function trimUnits(value: string): string {
  const [whole, fraction = ""] = value.split(".");
  const trimmed = fraction.slice(0, 6).replace(/0+$/, "");
  return trimmed ? `${whole}.${trimmed}` : whole!;
}

export function chainSlugOf(position: PositionView): ChainSlug {
  return position.chain === "robinhood" ? "robinhood" : "base";
}
