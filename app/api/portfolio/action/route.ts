import { NextResponse } from "next/server";
import { z } from "zod";
import { planPositionAction } from "../../../lib/portfolio-server";

export const runtime = "nodejs";

const Body = z.object({
  owner: z.string(),
  chain: z.enum(["base", "robinhood"]),
  tokenId: z.string().regex(/^\d+$/),
  action: z.enum(["compound", "withdraw"]),
});

export async function POST(request: Request) {
  try {
    const body = Body.parse(await request.json());
    const plan = await planPositionAction({
      owner: body.owner,
      chain: body.chain,
      tokenId: BigInt(body.tokenId),
      action: body.action,
    });
    return NextResponse.json({ plan });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not prepare position action" },
      { status: 400 },
    );
  }
}
