import { NextResponse } from "next/server";
import { fetchPositionList } from "../../lib/hosted-server";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const owner = new URL(request.url).searchParams.get("owner") ?? undefined;
  const payload = await fetchPositionList(owner);
  return NextResponse.json(payload);
}
