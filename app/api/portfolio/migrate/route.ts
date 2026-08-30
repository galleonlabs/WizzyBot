import { NextResponse } from "next/server";
import { z } from "zod";
import { planIndexMigration } from "../../../lib/portfolio-server";
import { apiErrorResponse, readApiJson } from "../../../lib/api-request-server";

export const runtime = "nodejs";

const Body = z.object({
  owner: z.string(),
  tokenId: z.string().regex(/^\d+$/),
  migrationId: z.string().regex(/^[a-z0-9-]+$/),
});

export async function POST(request: Request) {
  try {
    const body = Body.parse(await readApiJson(request));
    const plan = await planIndexMigration({
      owner: body.owner,
      tokenId: BigInt(body.tokenId),
      migrationId: body.migrationId,
    });
    return NextResponse.json({ plan });
  } catch (error) {
    return apiErrorResponse(error, "Could not prepare the index update");
  }
}
