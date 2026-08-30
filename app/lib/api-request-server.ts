import { NextResponse } from "next/server";
import { ZodError } from "zod";

const DEFAULT_MAX_BYTES = 16_384;

export class ApiRequestError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

export async function readApiJson(request: Request, maximumBytes = DEFAULT_MAX_BYTES): Promise<unknown> {
  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(declaredLength) && declaredLength > maximumBytes) throw new ApiRequestError("payload too large", 413);

  const origin = request.headers.get("origin");
  const fetchSite = request.headers.get("sec-fetch-site");
  const requestOrigin = new URL(request.url).origin;
  if ((origin && origin !== requestOrigin) || (!origin && fetchSite !== "same-origin")) {
    throw new ApiRequestError("same-origin request required", 403);
  }
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    throw new ApiRequestError("application/json required", 415);
  }

  const body = await request.text();
  if (Buffer.byteLength(body, "utf8") > maximumBytes) throw new ApiRequestError("payload too large", 413);
  try {
    return JSON.parse(body);
  } catch {
    throw new ApiRequestError("invalid JSON", 400);
  }
}

export function apiErrorResponse(error: unknown, fallback: string): NextResponse {
  if (error instanceof ApiRequestError) {
    return NextResponse.json({ error: error.message }, { status: error.status, headers: { "Cache-Control": "private, no-store" } });
  }
  if (error instanceof ZodError) {
    return NextResponse.json({ error: "invalid request" }, { status: 400, headers: { "Cache-Control": "private, no-store" } });
  }
  console.error("[wizzy-api-error]", redactServerError(error));
  return NextResponse.json({ error: fallback }, { status: 400, headers: { "Cache-Control": "private, no-store" } });
}

function redactServerError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message
    .replace(/\b(?:https?|wss?):\/\/[^\s"')]+/gi, "[url]")
    .replace(/\b(?:authorization|api[-_ ]?key|token|secret|password)\b\s*[:=]\s*\S+/gi, "$1=[redacted]")
    .replace(/\b[A-Za-z0-9_-]{48,}\b/g, "[token]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 500);
}
