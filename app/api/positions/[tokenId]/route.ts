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

export async function GET(
  request: Request,
  context: { params: Promise<{ tokenId: string }> },
) {
  const { tokenId } = await context.params;
  const chain = chainFromRequest(request);
  try {
    const payload = await fetchPositionStatus(tokenId, chain);
    if (payload && typeof payload === "object") {
      return NextResponse.json({ ...payload, chain });
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
