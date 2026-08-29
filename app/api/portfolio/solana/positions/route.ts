import { NextResponse } from "next/server";
import { fetchSolanaPositionList } from "../../../../lib/solana-position-server";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const owner = new URL(request.url).searchParams.get("owner");
    if (!owner) throw new Error("owner is required");
    return NextResponse.json(await fetchSolanaPositionList(owner));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not read Solana positions" },
      { status: 400 },
    );
  }
}
