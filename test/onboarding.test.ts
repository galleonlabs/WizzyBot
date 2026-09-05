import { expect, test } from "bun:test";
import { mkdtemp, mkdir, chmod, readFile, writeFile, rm, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { aixbtConfig, coinbaseSettings, connectProvider, publicDataProbe, doctor } from "../src/onboarding";
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


test("AIXBT discovery is credential-free and verifies the reviewed read tools", async () => {
  const methods: string[] = [];
  const probe = await publicDataProbe(async (url, options) => {
    expect(url).toBe("https://api.aixbt.tech/mcp");
    expect(options.redirect).toBe("error");
    expect(Object.keys(options.headers as Record<string, string>).some(key => /authorization/i.test(key))).toBe(false);
    const body = JSON.parse(options.body as string); methods.push(body.method);
    if (body.method === "initialize") return Response.json({ result: { protocolVersion: "2025-03-26", serverInfo: { name: "aixbt" } } });
    if (body.method === "notifications/initialized") return new Response(null, { status: 202 });
    return Response.json({ result: { tools: [...aixbtConfig.tools.include, "unreviewed_future_tool"].map(name => ({ name })) } });
  }, "aixbt");
  expect(probe.status).toBe("verified");
  expect(probe.provider).toBe("aixbt");
  expect(probe.tools).toEqual(aixbtConfig.tools.include);
  expect(methods).toEqual(["initialize", "notifications/initialized", "tools/list"]);
});

test("AIXBT discovery fails closed on removed tools and does not expose server errors", async () => {
  for (const result of [{ tools: [{ name: "list_topics" }] }, { tools: "malformed" }]) {
    const probe = await publicDataProbe(async (_url, options) => {
      const body = JSON.parse(options.body as string);
      if (body.method === "initialize") return Response.json({ result: { protocolVersion: "2025-03-26", serverInfo: { name: "aixbt" } } });
      if (body.method === "notifications/initialized") return new Response(null, { status: 202 });
      return Response.json({ result });
    }, "aixbt");
    expect(probe.status).toBe("unavailable");
  }
  const probe = await publicDataProbe(async () => { throw new Error("private-error-fixture"); }, "aixbt");
  expect(probe.status).toBe("unavailable");
  expect(JSON.stringify(probe)).not.toContain("private-error-fixture");
});

test("AIXBT configuration retains only environment references, preserves config, and diagnoses missing credentials", async () => {
  await temporary(async root => {
    const bin = join(root, ".boomkin/runtime/venv/bin");
    await mkdir(bin, { recursive: true });
    await writeFile(join(bin, "hermes"), '#!/bin/sh\necho "Hermes Agent v0.21.0"\n');
    await chmod(join(bin, "hermes"), 0o700);
    await writeFile(join(root, "config.yaml"), "# Keep my configuration\nmodel:\n  default: existing-model\n");
    // A blank profile value intentionally overrides any inherited environment.
    await writeFile(join(root, ".env"), "AIXBT_API_KEY=\n");
    await expect(connectProvider(root, "aixbt")).rejects.toThrow("Provider setup is incomplete");
    let profile = await doctor(root, parseCatalog(catalog));
    expect(profile.mcpServers.find(server => server.name === "aixbt")?.missingEnvironment).toEqual(["AIXBT_API_KEY"]);
    await writeFile(join(root, ".env"), "AIXBT_API_KEY=fixture-never-sent-to-network\n");
    await connectProvider(root, "aixbt");
    const config = await readFile(join(root, "config.yaml"), "utf8");
    expect(config).toContain("Bearer ${AIXBT_API_KEY}");
    expect(config).not.toContain("fixture-never-sent-to-network");
    expect(config).toContain("# Keep my configuration");
    expect(config).toContain("default: existing-model");
    expect(config).toContain("trust: untrusted");
    profile = await doctor(root, parseCatalog(catalog));
    expect(profile.mcpServers.find(server => server.name === "aixbt")?.missingEnvironment).toEqual([]);
    expect(profile.optionalData).toEqual([]);
    expect(JSON.stringify(profile)).not.toContain("fixture-never-sent-to-network");
  });
});

test("AIXBT connection dry run creates no profile", async () => {
  await temporary(async root => {
    const path = join(root, "fresh");
    await connectProvider(path, "aixbt", true);
    await expect(readFile(join(path, "config.yaml"))).rejects.toThrow();
  });
});
