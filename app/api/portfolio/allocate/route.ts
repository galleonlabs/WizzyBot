import { NextResponse } from "next/server";
import { z } from "zod";
import { planAllocation, selectBestMarketVenue } from "../../../lib/portfolio-server";
import { apiErrorResponse, readApiJson } from "../../../lib/api-request-server";

export const runtime = "nodejs";

const Body = z.object({
  owner: z.string(),
  amountWei: z.string().regex(/^\d+$/),
  chain: z.enum(["base", "robinhood"]),
  marketId: z.string().min(1),
}).strict();

export async function POST(request: Request) {
  try {
    const body = Body.parse(await readApiJson(request));
    const amountWei = BigInt(body.amountWei);
    const venueSelection = await selectBestMarketVenue(body.chain, body.marketId);
    const plan = await planAllocation({
      owner: body.owner,
      chain: body.chain,
      amountWei,
      marketId: body.marketId,
      protocol: venueSelection.selectedKey === "V2" || venueSelection.selectedKey === "V4"
        ? venueSelection.selectedKey
        : undefined,
    }) as Record<string, unknown>;
    return NextResponse.json({
      plan: {
        ...plan,
        venueSelection,
        notices: [
          ...(Array.isArray(plan.notices) ? plan.notices : []),
          ...venueSelection.decisionReasons,
        ],
      },
    });
  } catch (error) {
    return apiErrorResponse(error, "Could not build allocation plan");
  }
}
