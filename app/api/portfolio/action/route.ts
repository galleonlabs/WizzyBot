import { NextResponse } from "next/server";
import { z } from "zod";
import { planPositionAction } from "../../../lib/portfolio-server";
import { apiErrorResponse, readApiJson } from "../../../lib/api-request-server";

export const runtime = "nodejs";

const Body = z.object({
  owner: z.string(),
  chain: z.enum(["base", "robinhood"]),
  tokenId: z.string().regex(/^\d+$/),
  action: z.enum(["compound", "rebalance", "withdraw"]),
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
      venue: body.venue,
      positionManager: body.positionManager,
    });
    return NextResponse.json({ plan });
  } catch (error) {
    return apiErrorResponse(error, "Could not prepare position action");
  }
}
