import { NextResponse } from "next/server";
import { Connection } from "@solana/web3.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_SOLANA_RPC = "https://api.mainnet-beta.solana.com";

export async function GET(request: Request) {
  const signature = new URL(request.url).searchParams.get("signature") ?? "";
  if (!/^[1-9A-HJ-NP-Za-km-z]{64,90}$/.test(signature)) return NextResponse.json({ error: "invalid signature" }, { status: 400 });
  try {
    const connection = new Connection(process.env.SOLANA_RPC_URL ?? DEFAULT_SOLANA_RPC, "confirmed");
    const result = await connection.getSignatureStatus(signature, { searchTransactionHistory: true });
    if (result.value?.err) return NextResponse.json({ status: "failed", error: "The Solana transaction reverted" });
    if (result.value?.confirmationStatus === "confirmed" || result.value?.confirmationStatus === "finalized") return NextResponse.json({ status: "confirmed" });
    return NextResponse.json({ status: "pending" });
  } catch {
    return NextResponse.json({ status: "pending" });
  }
}
