import { NextResponse } from "next/server";
import { z } from "zod";
import { quoteBaseToRobinhoodEth } from "../../../lib/portfolio-server";

export const runtime = "nodejs";

const Body = z.object({
  owner: z.string(),
  amountInWei: z.string().regex(/^\d+$/),
});

export async function POST(request: Request) {
  try {
    const body = Body.parse(await request.json());
    const quote = await quoteBaseToRobinhoodEth({ owner: body.owner, amountInWei: BigInt(body.amountInWei) });
    return NextResponse.json({ quote });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not quote Relay" },
      { status: 400 },
    );
  }
}
