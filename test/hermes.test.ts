import { expect, test, spyOn } from "bun:test";
import { mkdtemp, mkdir, readFile, rm, writeFile, chmod, symlink, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { configureMcpServers, initializeProfile, localProfileStatus, runHermes, ensureRuntime, HERMES_VERSION, type McpServer, setMcpTrustUntrusted } from "../src/hermes";

const server: McpServer = { url: "https://example.org/mcp", trust: "untrusted", tools: { include: ["read_price"], resources: false, prompts: false } };
async function fixture(run: (root: string) => Promise<void>) {
  const root = await realpath(await mkdtemp(join(tmpdir(), "boomkin-hermes-")));
  try { await run(root); } finally { await rm(root, { recursive: true, force: true }); }
}
async function fakeRuntime(root: string, script: string) {
  const bin = join(root, ".boomkin/runtime/venv/bin");
  await mkdir(bin, { recursive: true });
  const file = join(bin, "hermes");
  await writeFile(file, `#!/bin/sh\n${script}\n`);
  await chmod(file, 0o700);
  return file;
}
test("profile initialization preserves existing identity and secrets", async () => {
  await fixture(async root => {
    await writeFile(join(root, ".env"), "OPENAI_API_KEY=private-user-value\n");
    expect(await initializeProfile(root, "# Boomkin\n")).toEqual({ createdSoul: true });
    expect(await initializeProfile(root, "# Replacement\n")).toEqual({ createdSoul: false });
    expect(await readFile(join(root, "SOUL.md"), "utf8")).toBe("# Boomkin\n");
    expect(await readFile(join(root, ".env"), "utf8")).toContain("private-user-value");
  });
});
test("MCP edits preserve YAML comments and unknown fields and are idempotent", async () => {
  await fixture(async root => {
    await writeFile(join(root, "config.yaml"), "# User config\ncustom_feature: true\nmodel:\n  default: user-model # preserve\n");
    expect(await configureMcpServers(root, { prices: server })).toEqual(["prices"]);
    const first = await readFile(join(root, "config.yaml"), "utf8");
    expect(first).toContain("# User config");
    expect(first).toContain("user-model # preserve");
    expect(first).toContain("custom_feature: true");
    expect(await configureMcpServers(root, { prices: server })).toEqual([]);
    expect(await readFile(join(root, "config.yaml"), "utf8")).toBe(first);
  });
});
test("conflicting MCP batches and malformed YAML make no partial changes or secret errors", async () => {
  await fixture(async root => {
    await configureMcpServers(root, { prices: server });
    const before = await readFile(join(root, "config.yaml"), "utf8");
    await expect(configureMcpServers(root, { added: server, prices: { ...server, headers: { Authorization: "secret-value" } } })).rejects.toThrow("existing configuration was preserved");
    expect(await readFile(join(root, "config.yaml"), "utf8")).toBe(before);
    await writeFile(join(root, "config.yaml"), "sensitive: [secret-value");
    await expect(configureMcpServers(root, { added: server })).rejects.toThrow("valid YAML mapping");
    expect(await readFile(join(root, "config.yaml"), "utf8")).toBe("sensitive: [secret-value");
  });
});
test("MCP setup rejects broad tools and credential-bearing URLs", async () => {
  await fixture(async root => {
    await expect(configureMcpServers(root, { prices: { ...server, tools: { ...server.tools, include: ["*"] } } })).rejects.toThrow("explicit tool names");
    await expect(configureMcpServers(root, { prices: { ...server, url: "https://example.org/mcp?key=private" } })).rejects.toThrow("environment-backed headers");
  });
});
test("Hermes launches use selected home and explicit default profile despite sticky preferences", async () => {
  await fixture(async root => {
    await fakeRuntime(root, 'if [ "$3" = "--version" ]; then echo "Hermes 0.21.0"; exit 0; fi\nprintf "%s\\n" "$HERMES_HOME" "$HERMES_CONFIG" "$PWD" "$@" > launch.txt');
    const executable = await ensureRuntime(root, { install: false });
    await runHermes(root, ["chat"], { executable });
    expect((await readFile(join(root, "launch.txt"), "utf8")).split("\n")).toEqual([root, join(root, "config.yaml"), root, "--profile", "default", "chat", ""]);
    await expect(runHermes(root, ["--profile", "personal", "chat"])).rejects.toThrow("directory");
  });
});
test("readiness distinguishes local configuration from authentication and redacts secrets", async () => {
  await fixture(async root => {
    await fakeRuntime(root, 'echo "Hermes Agent v0.21.0 (2026.8.31)"');
    await initializeProfile(root, "# Boomkin");
    await configureMcpServers(root, { prices: { ...server, headers: { Authorization: "Bearer ${BOOMKIN_TEST_MISSING_KEY}" } } });
    await writeFile(join(root, ".env"), "OPENAI_API_KEY=private-user-value\n");
    const result = await localProfileStatus(root);
    expect(result.runtime.version).toBe("0.21.0");
    expect(result.credentialConfigured).toBe(true);
    expect(result.modelConfigured).toBe(false);
    expect(result.authenticated).toBe("unverified");
    expect(result.mcpServers[0].missingEnvironment).toEqual(["BOOMKIN_TEST_MISSING_KEY"]);
    expect(JSON.stringify(result)).not.toContain("private-user-value");
  });
});
test("native executable failures do not count as runtime readiness", async () => {
  await fixture(async root => {
    await fakeRuntime(root, "exit 7");
    expect((await localProfileStatus(root)).runtime.available).toBe(false);
    await expect(ensureRuntime(root, { install: false })).rejects.toThrow("valid version");
    await expect(runHermes(root, ["chat"])).rejects.toThrow("Hermes command failed");
  });
});
test("profile writes reject redirected files and leave their targets untouched", async () => {
  await fixture(async root => {
    const target = join(root, "other-profile.yaml");
    await writeFile(target, "owned: elsewhere\n");
    await symlink(target, join(root, "config.yaml"));
    await expect(configureMcpServers(root, { prices: server })).rejects.toThrow("symlink");
    expect(await readFile(target, "utf8")).toBe("owned: elsewhere\n");
  });
});

test("dry runs never launch an existing runtime or create profile state", async () => {
  await fixture(async root => {
    const executable = await fakeRuntime(root, "touch native-was-run; echo 'Hermes 0.21.0'");
    const logs: string[] = [];
    const log = spyOn(console, "log").mockImplementation(message => { logs.push(String(message)); });
    try {
      expect(await ensureRuntime(root, { install: true, dryRun: true })).toBe(executable);
      expect(logs).toEqual([`Would reuse the existing Hermes executable at ${executable}`]);
      expect(await Bun.file(join(root, "native-was-run")).exists()).toBe(false);
    } finally { log.mockRestore(); }
  });
});
test("dry run reports a planned Hermes install without writing a runtime", async () => {
  await fixture(async root => {
    const which = spyOn(Bun, "which").mockReturnValue(null);
    const logs: string[] = [];
    const log = spyOn(console, "log").mockImplementation(message => { logs.push(String(message)); });
    try {
      const planned = join(root, ".boomkin/runtime/venv/bin/hermes");
      expect(await ensureRuntime(root, { install: true, dryRun: true })).toBe(planned);
      expect(logs).toEqual([`Would install Hermes ${HERMES_VERSION} at ${planned}`]);
      expect(await Bun.file(planned).exists()).toBe(false);
    } finally { which.mockRestore(); log.mockRestore(); }
  });
});
test("a changed upstream installer is rejected before execution", async () => {
  await fixture(async root => {
    const which = spyOn(Bun, "which").mockReturnValue(null);
    const fetcher = spyOn(globalThis, "fetch").mockResolvedValue(new Response("echo never-execute-unverified-code"));
    try {
      await expect(ensureRuntime(root, { install: true })).rejects.toThrow("checksum mismatch");
      expect(await Bun.file(join(root, ".boomkin/runtime/venv/bin/hermes")).exists()).toBe(false);
      expect(await Bun.file(join(root, "config.yaml")).exists()).toBe(false);
    } finally { which.mockRestore(); fetcher.mockRestore(); }
  });
});

test("doctor on an absent profile reports gaps without launching or creating it", async () => {
  await fixture(async root => {
    const executable = await fakeRuntime(root, "touch native-was-run; echo 'Hermes 0.21.0'");
    const which = spyOn(Bun, "which").mockReturnValue(executable);
    try {
      const status = await localProfileStatus(join(root, "absent"));
      expect(status.runtime.available).toBe(false);
      expect(status.hasSoul).toBe(false);
      expect(await Bun.file(join(root, "native-was-run")).exists()).toBe(false);
    } finally { which.mockRestore(); }
  });
});

test("native MCP trust tightening preserves tool choices, OAuth and user configuration", async () => {
  await fixture(async root => {
    await writeFile(join(root, "config.yaml"), "# User comment\nmcp_servers:\n  alchemy:\n    url: https://mcp.example.org/mcp\n    auth: oauth\n    tools:\n      include: [get_balance, get_chain]\n      resources: true\ncustom: keep\n");
    await setMcpTrustUntrusted(root, "alchemy");
    const after = await readFile(join(root, "config.yaml"), "utf8");
    expect(after).toContain("# User comment");
    expect(after).toContain("auth: oauth");
    expect(after).toContain("include: [ get_balance, get_chain ]");
    expect(after).toContain("trust: untrusted");
    expect(after).toContain("resources: false");
    expect(after).toContain("prompts: false");
    expect(after).toContain("custom: keep");
    await expect(setMcpTrustUntrusted(root, "absent")).rejects.toThrow("missing");
    expect(await readFile(join(root, "config.yaml"), "utf8")).toBe(after);
  });
});
