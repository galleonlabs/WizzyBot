import { NextResponse } from "next/server";
import { parseChainSlug, type ChainSlug } from "../../lib/chains";
import { fetchPositionList } from "../../lib/hosted-server";

export const runtime = "nodejs";

function chainFromRequest(request: Request): ChainSlug {
  try {
    return parseChainSlug(new URL(request.url).searchParams.get("chain"));
  } catch {
    return "base";
  }
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const owner = url.searchParams.get("owner") ?? undefined;
  const chain = chainFromRequest(request);
  const payload = await fetchPositionList(owner, chain);
  return NextResponse.json(payload);
}
