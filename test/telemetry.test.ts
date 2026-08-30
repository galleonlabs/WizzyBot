import { describe, expect, it } from "vitest";
import { isTelemetryArea, sanitizeTelemetryText } from "../app/lib/telemetry.js";

describe("telemetry hygiene", () => {
  it("redacts wallet addresses, long secrets, and email addresses", () => {
    const message = sanitizeTelemetryText(
      "Wallet 0x1111111111111111111111111111111111111111 for person@example.com rejected abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-token",
    );

    expect(message).toContain("[evm]");
    expect(message).toContain("[email]");
    expect(message).toContain("[token]");
    expect(message).not.toContain("11111111");
    expect(message).not.toContain("person@example.com");
  });

  it("accepts only bounded product areas", () => {
    expect(isTelemetryArea("index-submit")).toBe(true);
    expect(isTelemetryArea("wallet-private-key")).toBe(false);
  });
});
