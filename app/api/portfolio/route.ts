import { NextResponse } from "next/server";

export const runtime = "nodejs";

// The portfolio namespace only serves its sub-routes; answering here keeps
// stray probes from crashing into the framework's missing-page fallback.
export async function GET() {
  return NextResponse.json(
    { error: "Use /api/portfolio/allocate, /api/portfolio/action, or /api/portfolio/migrate" },
    { status: 404 },
  );
}
