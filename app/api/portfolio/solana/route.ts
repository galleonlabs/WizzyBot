import { NextResponse } from "next/server";
import { z } from "zod";
import { planSolanaZap } from "../../../lib/solana-zap-server";
import { apiErrorResponse, readApiJson } from "../../../lib/api-request-server";

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
    const body = Body.parse(await readApiJson(request));
    const plan = await planSolanaZap({
      owner: body.owner,
      marketId: body.marketId,
      amountLamports: BigInt(body.amountLamports),
      position: body.position,
    });
    return NextResponse.json({ plan });
  } catch (error) {
    return apiErrorResponse(error, "Could not prepare Solana liquidity");
  }
}
