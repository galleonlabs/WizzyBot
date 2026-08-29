import { NextResponse } from "next/server";
import { z } from "zod";
import { planSolanaZap } from "../../../lib/solana-zap-server";

export const runtime = "nodejs";
export const maxDuration = 45;

const Base58 = z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
const Body = z.object({
  owner: Base58,
  marketId: z.string().regex(/^[a-z0-9-]+$/),
  amountLamports: z.string().regex(/^\d+$/),
  position: Base58,
});

export async function POST(request: Request) {
  try {
    const body = Body.parse(await request.json());
    const plan = await planSolanaZap({
      owner: body.owner,
      marketId: body.marketId,
      amountLamports: BigInt(body.amountLamports),
      position: body.position,
    });
    return NextResponse.json({ plan });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not prepare Solana liquidity";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
