import { NextResponse } from "next/server";
import { z } from "zod";
import { planPositionAction } from "../../../lib/portfolio-server";
import { apiErrorResponse, readApiJson } from "../../../lib/api-request-server";

export const runtime = "nodejs";

// Only single-transaction actions are prepared here. Multi-step management
// happens on the venue's own interface, optionally after a Relay step.
const Body = z.object({
  owner: z.string(),
  chain: z.enum(["base", "robinhood"]),
  tokenId: z.string().regex(/^\d+$/),
  action: z.enum(["collect", "decrease", "withdraw"]),
  percent: z.number().int().min(1).max(99).optional(),
  protocol: z.enum(["V2", "V3", "V4"]).optional(),
  venue: z.enum(["uniswap-v3", "aerodrome-slipstream"]).optional(),
  positionManager: z.string().optional(),
});

export async function POST(request: Request) {
  try {
    const body = Body.parse(await readApiJson(request));
    const plan = await planPositionAction({
      owner: body.owner,
      chain: body.chain,
      tokenId: BigInt(body.tokenId),
      action: body.action,
      percent: body.percent,
      protocol: body.protocol,
      venue: body.venue,
      positionManager: body.positionManager,
    });
    return NextResponse.json({ plan });
  } catch (error) {
    return apiErrorResponse(error, "Could not prepare position action");
  }
}
