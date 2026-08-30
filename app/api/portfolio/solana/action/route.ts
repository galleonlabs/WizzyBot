import { NextResponse } from "next/server";
import { z } from "zod";
import { planSolanaPositionAction } from "../../../../lib/solana-position-server";
import { apiErrorResponse, readApiJson } from "../../../../lib/api-request-server";

export const runtime = "nodejs";

const Base58 = z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
const Body = z.object({
  owner: Base58,
  marketId: z.string().regex(/^[a-z0-9-]+$/),
  position: Base58,
  action: z.enum(["compound", "withdraw"]),
});

export async function POST(request: Request) {
  try {
    const body = Body.parse(await readApiJson(request));
    const plan = await planSolanaPositionAction(body);
    return NextResponse.json({ plan });
  } catch (error) {
    return apiErrorResponse(error, "Could not prepare Solana position action");
  }
}
