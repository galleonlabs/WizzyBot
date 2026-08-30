"use client";

import { track } from "@vercel/analytics";
import { sanitizeTelemetryText, type TelemetryArea } from "./telemetry";

type EventProperty = string | number | boolean | null | undefined;

export function trackProductEvent(name: string, properties?: Record<string, EventProperty>) {
  try {
    track(name, properties);
  } catch {
    // Analytics must never interrupt wallet or market flows.
  }
}

export function reportClientError(area: TelemetryArea, error: unknown) {
  const message = sanitizeTelemetryText(error);
  trackProductEvent("App Error", { area });
  console.error(`[wizzy:${area}]`, message);
  void fetch("/api/telemetry", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ area, message }),
    keepalive: true,
  }).catch(() => undefined);
}
