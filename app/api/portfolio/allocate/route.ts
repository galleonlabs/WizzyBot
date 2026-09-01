import { NextResponse } from "next/server";
import { z } from "zod";
import { planAllocation, planDualChainAllocation } from "../../../lib/portfolio-server";
import { apiErrorResponse, readApiJson } from "../../../lib/api-request-server";

export const runtime = "nodejs";

const Body = z.object({
  owner: z.string(),
  amountWei: z.string().regex(/^\d+$/),
  chain: z.enum(["base", "robinhood", "both"]),
  robinhoodShareBps: z.number().int().min(1_000).max(9_000).optional(),
  marketIds: z.array(z.string()).max(12).optional(),
  baseMarketIds: z.array(z.string()).max(12).optional(),
  robinhoodMarketIds: z.array(z.string()).max(12).optional(),
  protocol: z.enum(["V2", "V3", "V4"]).optional(),
});

export async function POST(request: Request) {
  try {
    const body = Body.parse(await readApiJson(request));
    if (body.chain === "both" && body.protocol) throw new Error("Choose one chain before selecting a pool version");
    const amountWei = BigInt(body.amountWei);
    const plan = body.chain === "both"
      ? await planDualChainAllocation({
          owner: body.owner,
          totalAmountWei: amountWei,
          robinhoodShareBps: body.robinhoodShareBps,
          baseMarketIds: body.baseMarketIds,
          robinhoodMarketIds: body.robinhoodMarketIds,
        })
      : await planAllocation({
          owner: body.owner,
          chain: body.chain,
          amountWei,
          marketIds: body.marketIds,
          protocol: body.protocol,
        });
    return NextResponse.json({ plan });
  } catch (error) {
    return apiErrorResponse(error, "Could not build allocation plan");
  }
}
