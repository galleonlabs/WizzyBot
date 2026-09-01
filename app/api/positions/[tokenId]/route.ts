import { NextResponse } from "next/server";
import { parseChainSlug, type ChainSlug } from "../../../lib/chains";
import { fetchPositionStatus } from "../../../lib/hosted-server";

export const runtime = "nodejs";

function chainFromRequest(request: Request): ChainSlug {
  try {
    return parseChainSlug(new URL(request.url).searchParams.get("chain"));
  } catch {
    return "base";
  }
}

function protocolFromRequest(request: Request): "V2" | "V3" | "V4" {
  const protocol = new URL(request.url).searchParams.get("protocol")?.toUpperCase();
  if (!protocol) return "V3";
  if (protocol === "V2" || protocol === "V3" || protocol === "V4") return protocol;
  throw new Error("Unknown protocol. Use V2, V3, or V4.");
}

export async function GET(
  request: Request,
  context: { params: Promise<{ tokenId: string }> },
) {
  const { tokenId } = await context.params;
  const chain = chainFromRequest(request);
  try {
    const url = new URL(request.url);
    const protocol = protocolFromRequest(request);
    const positionManager = url.searchParams.get("positionManager") ?? undefined;
    const payload = await fetchPositionStatus(tokenId, chain, protocol, positionManager);
    if (payload && typeof payload === "object") {
      return NextResponse.json({ ...payload, chain, protocol });
    }
    return NextResponse.json(payload);
  } catch (err) {
    console.error("[wizzy-position-status-error]", err instanceof Error ? err.name : "UnknownError");
    return NextResponse.json(
      { error: "Could not read this position", chain },
      { status: 400, headers: { "Cache-Control": "private, no-store" } },
    );
  }
}
