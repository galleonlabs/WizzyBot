import { NextResponse } from "next/server";
import { z } from "zod";
import { planIndexMigration } from "../../../lib/portfolio-server";

export const runtime = "nodejs";

const Body = z.object({
  owner: z.string(),
  tokenId: z.string().regex(/^\d+$/),
  migrationId: z.string().regex(/^[a-z0-9-]+$/),
});

export async function POST(request: Request) {
  try {
    const body = Body.parse(await request.json());
    const plan = await planIndexMigration({
      owner: body.owner,
      tokenId: BigInt(body.tokenId),
      migrationId: body.migrationId,
    });
    return NextResponse.json({ plan });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not prepare the index update" },
      { status: 400 },
    );
  }
}
