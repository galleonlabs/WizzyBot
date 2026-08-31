import { describe, expect, it } from "vitest";
import { readJsonPayload } from "../app/lib/api-payload.js";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("readJsonPayload", () => {
  it("passes JSON payloads through with their error strings", async () => {
    await expect(readJsonPayload(jsonResponse({ balanceWei: "1" }))).resolves.toEqual({ balanceWei: "1" });
    await expect(readJsonPayload(jsonResponse({ error: "A valid wallet address is required" }, 400)))
      .resolves.toEqual({ error: "A valid wallet address is required" });
  });

  it("turns a plain-text rate limit body into a readable error", async () => {
    const payload = await readJsonPayload(new Response("Too Many Requests", { status: 429 }));
    expect(payload.error).toMatch(/busy right now/);
  });

  it("gives non-ok responses without a usable error a status fallback", async () => {
    await expect(readJsonPayload(new Response("upstream exploded", { status: 502 })))
      .resolves.toMatchObject({ error: expect.stringMatching(/server had a problem/) });
    await expect(readJsonPayload(jsonResponse({ error: { code: -32600 } }, 500)))
      .resolves.toMatchObject({ error: expect.stringMatching(/server had a problem/) });
  });

  it("rejects a 200 response whose body is not JSON", async () => {
    await expect(readJsonPayload(new Response("<html>", { status: 200 }))).rejects.toThrow(/Unexpected response/);
  });

  it("drops a malformed error field on successful responses", async () => {
    await expect(readJsonPayload(jsonResponse({ plan: { id: 1 }, error: {} })))
      .resolves.toEqual({ plan: { id: 1 } });
  });
});
