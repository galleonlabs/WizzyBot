import { NextResponse } from "next/server";
import { z } from "zod";
import { planPositionAction } from "../../../lib/portfolio-server";
import { apiErrorResponse, readApiJson } from "../../../lib/api-request-server";

export const runtime = "nodejs";

const Body = z.object({
  owner: z.string(),
  chain: z.enum(["base", "robinhood"]),
  tokenId: z.string().regex(/^\d+$/),
  action: z.enum(["collect", "compound", "increase", "decrease", "rebalance", "withdraw"]),
  amountWei: z.string().regex(/^\d+$/).optional(),
  percent: z.number().int().min(1).max(99).optional(),
  protocol: z.enum(["V2", "V3", "V4"]).optional(),
  venue: z.enum(["uniswap-v3", "aerodrome-slipstream"]).optional(),
  positionManager: z.string().optional(),
  rangePreset: z.enum(["focused", "balanced", "wide"]).optional(),
  tickLower: z.number().int().optional(),
  tickUpper: z.number().int().optional(),
  settle: z.enum(["eth", "tokens"]).optional(),
});

export async function POST(request: Request) {
  try {
    const body = Body.parse(await readApiJson(request));
    const plan = await planPositionAction({
      owner: body.owner,
      chain: body.chain,
      tokenId: BigInt(body.tokenId),
      action: body.action,
      amountWei: body.amountWei ? BigInt(body.amountWei) : undefined,
      percent: body.percent,
      protocol: body.protocol,
      venue: body.venue,
      positionManager: body.positionManager,
      rangePreset: body.rangePreset,
      tickLower: body.tickLower,
      tickUpper: body.tickUpper,
      settle: body.settle,
    });
    return NextResponse.json({ plan });
  } catch (error) {
    return apiErrorResponse(error, "Could not prepare position action");
  }
}
