import { NextResponse } from "next/server";
import { isTelemetryArea, sanitizeTelemetryText } from "../../lib/telemetry";

export async function POST(request: Request) {
  if (Number(request.headers.get("content-length") ?? 0) > 4_096) {
    return NextResponse.json({ error: "payload too large" }, { status: 413 });
  }

  const fetchSite = request.headers.get("sec-fetch-site");
  const origin = request.headers.get("origin");
  const requestOrigin = new URL(request.url).origin;
  if ((origin && origin !== requestOrigin) || (!origin && fetchSite !== "same-origin")) {
    return NextResponse.json({ error: "same-origin request required" }, { status: 403 });
  }

  try {
    const body = await request.text();
    if (body.length > 4_096) return NextResponse.json({ error: "payload too large" }, { status: 413 });
    const payload = JSON.parse(body) as { area?: unknown; message?: unknown };
    if (!isTelemetryArea(payload.area)) {
      return NextResponse.json({ error: "invalid telemetry area" }, { status: 400 });
    }

    console.error("[wizzy-client-error]", {
      area: payload.area,
      message: sanitizeTelemetryText(payload.message),
    });
    return new NextResponse(null, { status: 204 });
  } catch {
    return NextResponse.json({ error: "invalid telemetry payload" }, { status: 400 });
  }
}
