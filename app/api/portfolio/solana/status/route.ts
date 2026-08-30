import { NextResponse } from "next/server";
import { getSolanaConnection } from "../../../../lib/solana-rpc-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const signature = new URL(request.url).searchParams.get("signature") ?? "";
  if (!/^[1-9A-HJ-NP-Za-km-z]{64,90}$/.test(signature)) return NextResponse.json({ error: "invalid signature" }, { status: 400 });
  try {
    const result = await getSolanaConnection().getSignatureStatus(signature, { searchTransactionHistory: true });
    const headers = { "Cache-Control": "private, no-store" };
    if (result.value?.err) return NextResponse.json({ status: "failed", error: "The Solana transaction reverted" }, { headers });
    if (result.value?.confirmationStatus === "confirmed" || result.value?.confirmationStatus === "finalized") return NextResponse.json({ status: "confirmed" }, { headers });
    return NextResponse.json({ status: "pending" }, { headers });
  } catch {
    return NextResponse.json({ status: "pending" }, { headers: { "Cache-Control": "private, no-store" } });
  }
}
