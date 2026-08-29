import { NextResponse } from "next/server";
import { relayIntentStatus } from "../../../lib/portfolio-server";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const requestId = new URL(request.url).searchParams.get("requestId") ?? "";
    return NextResponse.json(await relayIntentStatus(requestId));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not read Relay status" },
      { status: 400 },
    );
  }
}
