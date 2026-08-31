import { NextResponse } from "next/server";
import { z } from "zod";
import { planStableWithdraw } from "../../../lib/portfolio-server";
import { apiErrorResponse, readApiJson } from "../../../lib/api-request-server";

export const runtime = "nodejs";

const Body = z.object({
  owner: z.string(),
  fractionBps: z.number().int().min(1).max(10_000).optional(),
});

export async function POST(request: Request) {
  try {
    const body = Body.parse(await readApiJson(request));
    const plan = await planStableWithdraw({ owner: body.owner, fractionBps: body.fractionBps });
    return NextResponse.json({ plan });
  } catch (error) {
    return apiErrorResponse(error, "Could not plan the withdrawal");
  }
}
