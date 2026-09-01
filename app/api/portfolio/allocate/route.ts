import { NextResponse } from "next/server";
import { z } from "zod";
import { planAllocation } from "../../../lib/portfolio-server";
import { apiErrorResponse, readApiJson } from "../../../lib/api-request-server";

export const runtime = "nodejs";

const Body = z.object({
  owner: z.string(),
  amountWei: z.string().regex(/^\d+$/),
  chain: z.enum(["base", "robinhood"]),
  marketId: z.string().min(1),
  protocol: z.enum(["V2", "V3", "V4"]).optional(),
});

export async function POST(request: Request) {
  try {
    const body = Body.parse(await readApiJson(request));
    const amountWei = BigInt(body.amountWei);
    const plan = await planAllocation({
      owner: body.owner,
      chain: body.chain,
      amountWei,
      marketId: body.marketId,
      protocol: body.protocol,
    });
    return NextResponse.json({ plan });
  } catch (error) {
    return apiErrorResponse(error, "Could not build allocation plan");
  }
}
