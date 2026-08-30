export const TELEMETRY_AREAS = [
  "auth",
  "markets",
  "positions",
  "index-plan",
  "index-submit",
  "cross-chain-funding",
  "position-action",
  "index-migration",
  "render",
] as const;

export type TelemetryArea = (typeof TELEMETRY_AREAS)[number];

const EMAIL = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const EVM_SECRET_OR_ADDRESS = /\b0x[a-fA-F0-9]{40,}\b/g;
const LONG_TOKEN = /\b[A-Za-z0-9_-]{64,}\b/g;

export function sanitizeTelemetryText(value: unknown): string {
  const message = value instanceof Error ? value.message : typeof value === "string" ? value : "Unknown error";
  return message
    .replace(EMAIL, "[email]")
    .replace(EVM_SECRET_OR_ADDRESS, "[evm]")
    .replace(LONG_TOKEN, "[token]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 300) || "Unknown error";
}

export function isTelemetryArea(value: unknown): value is TelemetryArea {
  return typeof value === "string" && (TELEMETRY_AREAS as readonly string[]).includes(value);
}
