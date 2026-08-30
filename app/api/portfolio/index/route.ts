import { NextResponse } from "next/server";
import { z } from "zod";
import { planRobinhoodIndex } from "../../../lib/portfolio-server";

export const runtime = "nodejs";

const Body = z.object({
  owner: z.string(),
  amountWei: z.string().regex(/^\d+$/),
  originChainId: z.number().int().positive().optional(),
});

export async function POST(request: Request) {
  try {
    const body = Body.parse(await request.json());
    const plan = await planRobinhoodIndex({
      owner: body.owner,
      totalAmountWei: BigInt(body.amountWei),
      originChainId: body.originChainId,
    });
    return NextResponse.json({ plan });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not quote the Robinhood index";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
