import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import { createHash } from "node:crypto";
import { installedVersion, parseCatalog, parseConfig, selectPacks, identity, type Catalog } from "./core.ts";
import { ensureRuntime, runHermes, initializeProfile, configureMcpServers, localProfileStatus, setMcpTrustUntrusted } from "./hermes.ts";

export const defaultProfile = () => join(homedir(), ".boomkin", "hermes");
export const providers = {
  coingecko: { url: "https://mcp.api.coingecko.com/mcp", access: "Public data; no key. Enabled by onboard with a reviewed tool selection." },
  defillama: { url: "https://mcp.defillama.com/mcp", access: "Optional API subscription and OAuth; queries consume credits. One MCP client per account." },
  alchemy: { url: "https://mcp.alchemy.com/mcp", access: "Optional OAuth and selected app. Review tool selection, RPC limits and app costs." },
} as const;
export const coinGeckoConfig = {
  url: providers.coingecko.url,
  enabled: true,
  trust: "untrusted",
  tools: { include: ["execute", "search_docs"], resources: false, prompts: false },
};

export function coinbaseSettings(directory: string) {
  const environment = `live-boomkin-${createHash("sha256").update(directory).digest("hex").slice(0, 12)}`;
  return {
    command: "npx", args: ["--yes", "@coinbase/coinbase-cli@0.0.7", "mcp"],
    env: { COINBASE_CONFIG_DIR: join(directory, ".boomkin", "coinbase"), COINBASE_ENV: environment, COINBASE_KEY_ID: "", COINBASE_KEY_SECRET: "", COINBASE_URL: "", npm_config_ignore_scripts: "true" },
    enabled: true, trust: "untrusted",
    tools: { include: ["coinbase_balance", "coinbase_portfolios_list", "coinbase_portfolios_get", "coinbase_products_get", "coinbase_products_list", "coinbase_fees"], resources: false, prompts: false },
  };
}

export async function prepareHermes(directory: string, options: { install: boolean; dryRun?: boolean; skipModelSetup?: boolean }) {
  if (!options.dryRun) await initializeProfile(directory, identity);
  const executable = await ensureRuntime(directory, options);
  if (options.dryRun) return;
  await configureMcpServers(directory, { coingecko: coinGeckoConfig });
  if (!options.skipModelSetup) {
    if (!process.stdin.isTTY) throw new Error("Hermes model setup needs a terminal. Rerun onboard interactively, or use --skip-model-setup to prepare the profile and configure it later.");
    await runHermes(directory, ["setup", "model"], { executable });
  }
}

export async function connectProvider(directory: string, provider: string, dryRun = false, keyFile?: string) {
  if (provider === "coinbase") {
    const settings = coinbaseSettings(directory);
    console.log("Coinbase uses its official local MCP, with read tools only. Node.js 22+, a supported OS keychain and a scoped Coinbase key are required; login and account permissions remain separate.");
    if (dryRun) return;
    await configureMcpServers(directory, { coinbase: settings });
    if (keyFile) {
      const env: NodeJS.ProcessEnv = { ...process.env, ...settings.env };
      // Native environment-scoped keychain storage must not be overridden by a
      // different globally configured account or API endpoint.
      for (const key of ["COINBASE_KEY_ID", "COINBASE_KEY_SECRET", "COINBASE_URL"]) delete env[key];
      const child = Bun.spawn(["npx", "--yes", "@coinbase/coinbase-cli@0.0.7", "env", settings.env.COINBASE_ENV, "--key-file", keyFile], { cwd: directory, env, stdin: "inherit", stdout: "inherit", stderr: "inherit" });
      if (await child.exited !== 0) throw new Error("Coinbase's native credential setup failed. Resolve its keychain or key-file issue; Boomkin never enables plaintext secret storage.");
    }
    console.log(JSON.stringify({ configDirectory: settings.env.COINBASE_CONFIG_DIR, environment: settings.env.COINBASE_ENV, nextAction: "Use connect --provider coinbase --key-file /absolute/path/to/scoped-key.json to configure the native CLI, or follow docs/CONNECTIONS.md. Balances and account authority have not been checked." }, null, 2));
    return;
  }
  if (!Object.hasOwn(providers, provider)) throw new Error("Choose coingecko, defillama, alchemy or coinbase. Agentic Wallet setup is a separate official CLI path in docs/CONNECTIONS.md.");
  const selected = providers[provider as keyof typeof providers];
  console.log(`${provider}: ${selected.access}`);
  if (dryRun) return;
  if (provider === "coingecko") {
    await configureMcpServers(directory, { coingecko: coinGeckoConfig });
  } else {
    if (!process.stdin.isTTY) throw new Error("This provider requires interactive OAuth and tool selection. Run connect in your terminal.");
    await runHermes(directory, ["mcp", "add", provider, "--url", selected.url, "--auth", "oauth"]);
  }
  // Native MCP setup can exit successfully after cancellation or a failed probe.
  const status = await localProfileStatus(directory);
  const server = status.mcpServers.find(entry => entry.name === provider);
  if (!server?.enabled || server.missingEnvironment.length) throw new Error("Provider setup is incomplete. Resolve its native authentication/configuration before relying on it.");
  if (provider !== "coingecko") await setMcpTrustUntrusted(directory, provider);
  console.log(`${provider} configuration is present. Restart Hermes to load it; configuration alone does not prove a successful data read.`);
}

type Fetcher = (url: string, options: RequestInit) => Promise<Response>;
export async function publicDataProbe(fetcher: Fetcher = fetch) {
  // Only this keyless public endpoint is probed. No paid MCP, wallet or model calls.
  let session: string | null = null;
  let protocol: string | undefined;
  async function call(body: unknown) {
    const response = await fetcher(providers.coingecko.url, {
      method: "POST", redirect: "error", signal: AbortSignal.timeout(15_000),
      headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", ...(session ? { "Mcp-Session-Id": session } : {}), ...(protocol ? { "MCP-Protocol-Version": protocol } : {}) },
      body: JSON.stringify(body),
    });
    if (!response.ok) throw new Error(`public MCP HTTP ${response.status}`);
    session = response.headers.get("mcp-session-id") ?? session;
    if (response.status === 202 || response.status === 204) return null;
    const reader = response.body?.getReader();
    if (!reader) throw new Error("empty MCP response");
    let text = "", length = 0;
    const decoder = new TextDecoder();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > 256_000) { await reader.cancel(); throw new Error("oversized MCP response"); }
      text += decoder.decode(value, { stream: true });
      // Streamable HTTP servers may keep an SSE response open after the result.
      if (text.startsWith("event:") || text.startsWith("data:")) {
        const data = text.split(/\r?\n/).filter(line => line.startsWith("data:")).map(line => line.slice(5).trim()).join("\n");
        try { const parsed = JSON.parse(data); if (parsed.result || parsed.error) { await reader.cancel(); return parsed; } } catch { /* Wait for a complete event. */ }
      }
    }
    return JSON.parse(text);
  }
  try {
    const init = await call({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "boomkin-doctor", version: "0.4.1" } } });
    if (!init.result?.serverInfo || init.error) throw new Error("MCP initialization failed");
    protocol = init.result.protocolVersion;
    await call({ jsonrpc: "2.0", method: "notifications/initialized" });
    const tools = await call({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
    const names = tools.result?.tools?.map((tool: { name: string }) => tool.name);
    if (!Array.isArray(names) || !coinGeckoConfig.tools.include.every(name => names.includes(name))) throw new Error("reviewed MCP tool contract changed");
    return { provider: "coingecko", status: "verified" as const, observedAt: new Date().toISOString(), evidence: "public MCP initialization and reviewed tool discovery", tools: coinGeckoConfig.tools.include, marketRead: "not-tested", scope: "Provider connectivity only; Hermes tool loading is checked by the native runtime" };
  } catch {
    return { provider: "coingecko", status: "unavailable" as const, observedAt: new Date().toISOString(), evidence: "Public MCP could not verify the reviewed tool contract. Retry later or use the data skill's public REST diagnostic." };
  }
}

export async function doctor(directory: string, catalog: Catalog, live = false) {
  const profile = await localProfileStatus(directory);
  const gaps: string[] = [];
  const packs: { id: string; version: string; installed: boolean }[] = [];
  try {
    const config = parseConfig(JSON.parse(await readFile(join(directory, ".boomkin/config.json"), "utf8")), directory);
    if (config.harness !== "hermes") throw new Error("Not a Hermes profile");
    for (const pack of selectPacks(parseCatalog(catalog), config.packs).packs) {
      let installed = true;
      for (const skill of pack.skills) {
        try { if (installedVersion(await readFile(join(directory, "skills", skill, "SKILL.md"), "utf8")) !== pack.version) installed = false; }
        catch { installed = false; }
      }
      packs.push({ id: pack.id, version: pack.version, installed });
      if (!installed) gaps.push(`Update ${pack.id}`);
    }
  } catch { gaps.push("Run onboard in this Hermes profile"); }
  if (!profile.runtime.available) gaps.push("Install Hermes with onboard");
  if (!profile.hasSoul) gaps.push("Initialize the Boomkin profile with onboard");
  if (!profile.modelConfigured) gaps.push("Complete native Hermes model setup");
  if (!profile.mcpServers.some(server => server.name === "coingecko" && server.enabled)) gaps.push("Connect public CoinGecko data with onboard or connect --provider coingecko");
  for (const server of profile.mcpServers) if (server.missingEnvironment.length) gaps.push(`Configure missing environment for ${server.name}`);
  const publicData = live ? await publicDataProbe() : { status: "not-tested", nextAction: "Run doctor --live for a keyless public MCP connection check" };
  return { directory, state: gaps.length ? "needs-setup" : "configured", ...profile, packs, publicData, gaps, financialAccess: "No wallet, payment or trading authority is granted by onboarding", nextAction: gaps.length ? gaps[0] : "Run start; authentication and a successful model response are verified by Hermes at use time" };
}
