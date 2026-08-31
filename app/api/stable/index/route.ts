import { NextResponse } from "next/server";
import { z } from "zod";
import { planStableIndex } from "../../../lib/portfolio-server";
import { apiErrorResponse, readApiJson } from "../../../lib/api-request-server";

export const runtime = "nodejs";

const Body = z.object({
  owner: z.string(),
  amountUnits: z.string().regex(/^\d+$/),
});

export async function POST(request: Request) {
  try {
    const body = Body.parse(await readApiJson(request));
    const plan = await planStableIndex({ owner: body.owner, amountUnits: BigInt(body.amountUnits) });
    return NextResponse.json({ plan });
  } catch (error) {
    return apiErrorResponse(error, "Could not plan the yield deposit");
  }
}
