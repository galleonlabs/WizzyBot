import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { coinbaseSettings, connectProvider, publicDataProbe, doctor } from "../src/onboarding";
import catalog from "../catalog/skills.json";
import { parseCatalog } from "../src/core";

async function temporary(run: (root: string) => Promise<void>) {
  const root = await realpath(await mkdtemp(join(tmpdir(), "boomkin-onboard-")));
  try { await run(root); } finally { await rm(root, { recursive: true, force: true }); }
}
test("public data probe performs only MCP discovery and honors the negotiated session", async () => {
  const methods: string[] = [];
  const probe = await publicDataProbe(async (url, options) => {
    expect(url).toBe("https://mcp.api.coingecko.com/mcp");
    expect(options.redirect).toBe("error");
    const body = JSON.parse(options.body as string); methods.push(body.method);
    if (body.method === "initialize") return Response.json({ result: { protocolVersion: "2025-03-26", serverInfo: { name: "coingecko" } } }, { headers: { "mcp-session-id": "test-session" } });
    expect((options.headers as Record<string, string>)["Mcp-Session-Id"]).toBe("test-session");
    if (body.method === "notifications/initialized") return new Response(null, { status: 202 });
    return new Response('event: message\ndata: {"result":{"tools":[{"name":"execute"},{"name":"search_docs"}]}}\n\n', { headers: { "Content-Type": "text/event-stream" } });
  });
  expect(probe.status).toBe("verified");
  expect(methods).toEqual(["initialize", "notifications/initialized", "tools/list"]);
});
test("provider outage, malformed results and contract changes are unavailable without raw errors", async () => {
  const secret = "private-diagnostic-fixture";
  for (const response of [new Response(secret, { status: 429 }), Response.json({ result: {} }), new Response("bad " + secret), Response.json({ error: { message: secret } })]) {
    const result = await publicDataProbe(async () => response);
    expect(result.status).toBe("unavailable");
    expect(JSON.stringify(result)).not.toContain(secret);
  }
  const result = await publicDataProbe(async () => { throw new Error(secret); });
  expect(JSON.stringify(result)).not.toContain(secret);
});
test("Coinbase configuration isolates both config directory and native keychain environment", async () => {
  await temporary(async root => {
    const a = coinbaseSettings(root), b = coinbaseSettings(root + "-other");
    expect(a.env.COINBASE_ENV).not.toBe(b.env.COINBASE_ENV);
    expect(a.env.COINBASE_CONFIG_DIR.startsWith(root + "/")).toBe(true);
    expect(a.tools.include.some(name => /trade|transfer|payment|create|delete/.test(name))).toBe(false);
    await connectProvider(root, "coinbase");
    const text = await readFile(join(root, "config.yaml"), "utf8");
    expect(text).toContain("@coinbase/coinbase-cli@0.0.7");
    expect(a.env.COINBASE_KEY_ID).toBe("");
    expect(a.env.COINBASE_KEY_SECRET).toBe("");
    expect(a.env.COINBASE_URL).toBe("");
  });
});
test("readiness reports missing installations and never asserts model authentication", async () => {
  await temporary(async root => {
    const result = await doctor(join(root, "fresh"), parseCatalog(catalog));
    expect(result.state).toBe("needs-setup");
    expect(result.authenticated).toBe("unverified");
    expect(result.packs).toEqual([]);
    expect(result.publicData.status).toBe("not-tested");
  });
});
test("onboard dry run never creates the selected profile", async () => {
  await temporary(async root => {
    const path = join(root, "fresh");
    const child = Bun.spawn([process.execPath, "src/cli.ts", "onboard", "--directory", path, "--dry-run"], { stdout: "pipe", stderr: "pipe" });
    const output = await new Response(child.stdout).text();
    const errors = await new Response(child.stderr).text();
    expect(await child.exited).toBe(0);
    expect(errors).toBe("");
    expect(output).toContain("Hermes home:");
    await expect(readFile(path)).rejects.toThrow();
  });
});


test("onboarding-only and connection-only options cannot be silently ignored", async () => {
  for (const args of [["doctor", "--dry-run"], ["setup", "--all-packs"], ["start", "--live"], ["doctor", "--provider", "alchemy"], ["connect", "--provider", "alchemy", "--key-file", "/tmp/key.json"]]) {
    const child = Bun.spawn([process.execPath, "src/cli.ts", ...args], { stdout: "pipe", stderr: "pipe" });
    expect(await child.exited).toBe(1);
  }
});
