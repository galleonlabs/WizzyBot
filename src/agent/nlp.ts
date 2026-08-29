import type { Protocol } from "../types.js";
import { parseProtocol } from "../core/protocol.js";

export type SimulateAction = "compound" | "range" | "exit" | "mint";

export type Intent =
  | { verb: "status"; tokenId?: bigint; owner?: string; protocol: Protocol }
  | { verb: "list"; owner?: string; protocol: Protocol }
  | { verb: "mint"; token0?: string; token1?: string; fee?: number; widthPct?: number; tickLower?: number; tickUpper?: number; amount?: string; protocol: Protocol }
  | { verb: "compound"; tokenId: bigint; noFee?: boolean; protocol: Protocol }
  | { verb: "rerange"; tokenId: bigint; oorPercent?: number; protocol: Protocol }
  | { verb: "exit"; tokenId: bigint; swapTo?: string; protocol: Protocol }
  | { verb: "simulate"; action?: SimulateAction; tokenId?: bigint; protocol: Protocol }
  | { verb: "help" }
  | { verb: "unknown"; text: string };

export function protocolOf(intent: Intent): Protocol {
  return "protocol" in intent && intent.protocol ? intent.protocol : "V3";
}

export function captureProtocol(text: string): Protocol {
  const flagged = text.match(/(?:--)?protocol\s*[:=]?\s*(\S+)/i);
  if (flagged) return parseProtocol(flagged[1]);
  const bare = text.match(/(?:^|[\s/])(v[234])(?:\s|$)/i);
  if (bare) return parseProtocol(bare[1]);
  return "V3";
}

export function parseIntent(text: string): Intent {
  const raw = text.trim();
  const lower = raw.toLowerCase();
  const protocol = captureProtocol(raw);

  if (!raw || /^(help|\?)$/.test(lower)) return { verb: "help" };

  if (/\bsimulate\b/.test(lower)) {
    const rest = raw.replace(/\bsimulate\b/i, " ").trim();
    const inner = rest ? parseIntent(rest) : { verb: "unknown" as const, text: raw };
    const action: SimulateAction | undefined =
      inner.verb === "compound" || inner.verb === "exit" || inner.verb === "mint"
        ? inner.verb
        : inner.verb === "rerange"
          ? "range"
          : undefined;
    const tokenId = "tokenId" in inner && inner.tokenId !== undefined ? inner.tokenId : captureTokenId(raw);
    return { verb: "simulate", action, tokenId, protocol };
  }

  if (/\b(list|positions|nfts)\b/.test(lower)) {
    return { verb: "list", owner: captureAddress(raw), protocol };
  }

  if (/\b(status|card|pnl|position)\b/.test(lower)) {
    return { verb: "status", tokenId: captureTokenId(raw), owner: captureAddress(raw), protocol };
  }

  if (/\b(compound|reinvest)\b/.test(lower)) {
    const tokenId = captureTokenId(raw);
    if (tokenId === undefined) return { verb: "unknown", text: raw };
    return { verb: "compound", tokenId, noFee: /\bno-?fee\b/.test(lower), protocol };
  }

  if (/\b(range|re-?range|rerange|recenter|auto-?range)\b/.test(lower)) {
    const tokenId = captureTokenId(raw);
    if (tokenId === undefined) return { verb: "unknown", text: raw };
    const oor = raw.match(/oor(?:\s*percent)?\s*[:=]?\s*(\d+(?:\.\d+)?)/i);
    return { verb: "rerange", tokenId, oorPercent: oor ? Number(oor[1]) : undefined, protocol };
  }

  if (/\b(exit|close|withdraw)\b/.test(lower)) {
    const tokenId = captureTokenId(raw);
    if (tokenId === undefined) return { verb: "unknown", text: raw };
    const swap = raw.match(/\bto\s+([A-Za-z0-9]+)/i);
    return { verb: "exit", tokenId, swapTo: swap?.[1], protocol };
  }

  if (/\b(mint|open|create)\b/.test(lower)) {
    const pair = raw.match(/([A-Za-z0-9]{2,10})\s*[\/-]\s*([A-Za-z0-9]{2,10})/);
    const fee = raw.match(/(\d+(?:\.\d+)?)\s*%/);
    const width = raw.match(/width\s*[:=]?\s*(\d+(?:\.\d+)?)/i);
    const ticks = raw.match(/ticks?\s*[:=]?\s*(-?\d+)\s*[,/]\s*(-?\d+)/i);
    const amount = raw.match(/amount\s*[:=]?\s*([0-9.]+)/i);
    let feeAmount: number | undefined;
    if (fee) {
      const n = Number(fee[1]);
      feeAmount = n < 10 ? Math.round(n * 10_000) : n;
    }
    return {
      verb: "mint",
      token0: pair?.[1],
      token1: pair?.[2],
      fee: feeAmount,
      widthPct: width ? Number(width[1]) : undefined,
      tickLower: ticks ? Number(ticks[1]) : undefined,
      tickUpper: ticks ? Number(ticks[2]) : undefined,
      amount: amount?.[1],
      protocol,
    };
  }

  return { verb: "unknown", text: raw };
}

function captureTokenId(text: string): bigint | undefined {
  const m = text.match(/#?(\d{3,})/);
  return m ? BigInt(m[1]!) : undefined;
}

function captureAddress(text: string): string | undefined {
  const m = text.match(/0x[a-fA-F0-9]{40}/);
  return m?.[0];
}

export function confirmPhrase(intent: Intent): string {
  const proto = protocolOf(intent).toLowerCase();
  switch (intent.verb) {
    case "compound":
      return `Compound tokenId ${intent.tokenId}${intent.noFee ? " with --no-fee" : ""} protocol=${proto}? Type yes to broadcast.`;
    case "rerange":
      return `Re-range tokenId ${intent.tokenId} protocol=${proto}? Type yes to broadcast.`;
    case "exit":
      return `Exit tokenId ${intent.tokenId}${intent.swapTo ? ` into ${intent.swapTo}` : ""} protocol=${proto}? Type yes to broadcast.`;
    case "mint":
      return `Mint ${intent.token0 ?? "?"}/${intent.token1 ?? "?"} fee=${intent.fee ?? "?"} protocol=${proto}? Type yes to broadcast.`;
    default:
      return "This is a read. No confirmation needed.";
  }
}

export function isWrite(intent: Intent): boolean {
  return intent.verb === "compound" || intent.verb === "rerange" || intent.verb === "exit" || intent.verb === "mint";
}
