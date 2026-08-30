import { Transaction } from "@solana/web3.js";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getSolanaConnection } from "../../../../lib/solana-rpc-server";
import { apiErrorResponse, readApiJson } from "../../../../lib/api-request-server";

export const runtime = "nodejs";

const Base58 = z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
const Body = z.object({
  owner: Base58,
  transactionBase64: z.string().min(100).max(2_500),
});

export async function POST(request: Request) {
  try {
    const body = Body.parse(await readApiJson(request, 4_096));
    const bytes = Buffer.from(body.transactionBase64, "base64");
    const transaction = Transaction.from(bytes);
    if (transaction.feePayer?.toBase58() !== body.owner) {
      return NextResponse.json({ error: "transaction fee payer does not match wallet" }, { status: 400 });
    }
    transaction.serialize({ requireAllSignatures: true, verifySignatures: true });
    const signature = await getSolanaConnection().sendRawTransaction(bytes, { maxRetries: 3, skipPreflight: false });
    return NextResponse.json({ signature }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return apiErrorResponse(error, "Could not submit Solana transaction");
  }
}
