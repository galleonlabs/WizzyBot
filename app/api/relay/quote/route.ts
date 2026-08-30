import { NextResponse } from "next/server";
import { z } from "zod";
import { quoteEthToRobinhood } from "../../../lib/portfolio-server";
import { apiErrorResponse, readApiJson } from "../../../lib/api-request-server";

export const runtime = "nodejs";

const Body = z.object({
  owner: z.string(),
  amountInWei: z.string().regex(/^\d+$/),
  originChainId: z.number().int().positive().default(8453),
});

export async function POST(request: Request) {
  try {
    const body = Body.parse(await readApiJson(request));
    const quote = await quoteEthToRobinhood({ owner: body.owner, amountInWei: BigInt(body.amountInWei), originChainId: body.originChainId });
    return NextResponse.json({ quote });
  } catch (error) {
    return apiErrorResponse(error, "Could not quote Relay");
  }
}
