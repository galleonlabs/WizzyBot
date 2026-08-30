import { NextResponse } from "next/server";
import { z } from "zod";
import { planRobinhoodIndex } from "../../../lib/portfolio-server";
import { apiErrorResponse, readApiJson } from "../../../lib/api-request-server";

export const runtime = "nodejs";

const Body = z.object({
  owner: z.string(),
  amountWei: z.string().regex(/^\d+$/),
  originChainId: z.number().int().positive().optional(),
});

export async function POST(request: Request) {
  try {
    const body = Body.parse(await readApiJson(request));
    const plan = await planRobinhoodIndex({
      owner: body.owner,
      totalAmountWei: BigInt(body.amountWei),
      originChainId: body.originChainId,
    });
    return NextResponse.json({ plan });
  } catch (error) {
    return apiErrorResponse(error, "Could not quote the Robinhood index");
  }
}
