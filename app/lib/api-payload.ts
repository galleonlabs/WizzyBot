const RETRYABLE_STATUS_ERROR = "The network is busy right now. Please retry in a moment.";

/**
 * Reads a JSON API payload without letting a non-JSON body (rate-limit text,
 * proxy error page) surface as a raw parse error in the UI or telemetry.
 * Non-ok responses always come back with a readable `error` string.
 */
export async function readJsonPayload(response: Response): Promise<Record<string, unknown> & { error?: string }> {
  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    if (response.ok) throw new Error("Unexpected response from the server. Please retry.");
    payload = {};
  }
  const record: Record<string, unknown> = payload && typeof payload === "object" ? { ...(payload as Record<string, unknown>) } : {};
  if (typeof record.error !== "string" || !record.error.trim()) {
    if (response.ok) delete record.error;
    else record.error = fallbackHttpError(response.status);
  }
  return record as Record<string, unknown> & { error?: string };
}

function fallbackHttpError(status: number): string {
  if (status === 429) return RETRYABLE_STATUS_ERROR;
  if (status >= 500) return "The server had a problem. Please retry.";
  return `Request failed (${status})`;
}
