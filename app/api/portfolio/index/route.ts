import { NextResponse } from "next/server";
import { z } from "zod";
import { planMemeIndex } from "../../../lib/portfolio-server";

export const runtime = "nodejs";

const Body = z.object({
  owner: z.string(),
  solanaOwner: z.string(),
  amountWei: z.string().regex(/^\d+$/),
});

export async function POST(request: Request) {
  try {
    const body = Body.parse(await request.json());
    const plan = await planMemeIndex({
      owner: body.owner,
      solanaOwner: body.solanaOwner,
      totalAmountWei: BigInt(body.amountWei),
    });
    return NextResponse.json({ plan });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not quote the meme index";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
