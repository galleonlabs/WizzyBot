import { NextResponse } from "next/server";
import { z } from "zod";
import { quoteRelaySwap } from "../../../lib/portfolio-server";
import { apiErrorResponse, readApiJson } from "../../../lib/api-request-server";

export const runtime = "nodejs";

const Body = z.object({
  owner: z.string(),
  originChainId: z.number().int().positive(),
  destinationChainId: z.number().int().positive(),
  originCurrency: z.string().min(3),
  destinationCurrency: z.string().min(3),
  amountWei: z.string().regex(/^\d+$/),
}).strict();

export async function POST(request: Request) {
  try {
    const body = Body.parse(await readApiJson(request));
    const quote = await quoteRelaySwap({ ...body, amountWei: BigInt(body.amountWei) });
    return NextResponse.json({ quote }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return apiErrorResponse(error, "Could not quote Relay");
  }
}
