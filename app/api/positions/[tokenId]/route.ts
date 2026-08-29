import { NextResponse } from "next/server";
import { fetchPositionStatus } from "../../../lib/hosted-server";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  context: { params: Promise<{ tokenId: string }> },
) {
  const { tokenId } = await context.params;
  try {
    const payload = await fetchPositionStatus(tokenId);
    return NextResponse.json(payload);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 400 },
    );
  }
}
