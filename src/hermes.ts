import { access, chmod, lstat, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { resolve, join } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { isMap, parseDocument } from "yaml";

export const HERMES_VERSION = "0.21.0";
export const HERMES_COMMIT = "2e24e06e5513fa425ccf935d2e41991cb11ff383";
export const HERMES_INSTALLER_SHA256 = "5854b15670b51a8daae8f59ddfa917062de9f74be261eb73b4b8d719710f8968";
export const HERMES_INSTALLER_URL = `https://raw.githubusercontent.com/NousResearch/hermes-agent/${HERMES_COMMIT}/scripts/install.sh`;
export type McpServer = { url?: string; command?: string; args?: string[]; headers?: Record<string, string>; env?: Record<string, string>; enabled?: boolean; trust?: string; tools?: { include?: string[]; resources?: boolean; prompts?: boolean }; [key: string]: unknown };

function absent(error: unknown): boolean { return (error as NodeJS.ErrnoException).code === "ENOENT"; }
async function safePath(path: string): Promise<void> {
  try { if ((await lstat(path)).isSymbolicLink()) throw new Error("Refusing a symlink in the Hermes profile path"); }
  catch (error) { if (!absent(error)) throw error; }
}
async function profilePath(directory: string): Promise<string> {
  const root = resolve(directory);
  await safePath(root);
  await safePath(join(root, ".boomkin"));
  return root;
}
async function textOrEmpty(path: string): Promise<string> {
  await safePath(path);
  try { return await readFile(path, "utf8"); }
  catch (error) { if (absent(error)) return ""; throw error; }
}
function document(text: string) {
  const doc = parseDocument(text || "{}\n", { uniqueKeys: true });
  if (doc.errors.length || !isMap(doc.contents)) throw new Error("Hermes config must be a valid YAML mapping; existing configuration was preserved");
  try { doc.toJS({ maxAliasCount: 0 }); } catch { throw new Error("Hermes config aliases are unsupported; existing configuration was preserved"); }
  return doc;
}
export async function readHermesConfig(directory: string): Promise<Record<string, unknown>> {
  const root = await profilePath(directory);
  return document(await textOrEmpty(join(root, "config.yaml"))).toJS({ maxAliasCount: 0 });
}
async function executableAt(path: string): Promise<boolean> {
  try { await access(path, constants.X_OK); return true; } catch { return false; }
}
export async function findRuntime(directory: string): Promise<string | undefined> {
  const root = await profilePath(directory);
  const runtime = join(root, ".boomkin", "runtime");
  await safePath(runtime);
  for (const path of [join(runtime, ".venv", "bin", "hermes"), join(runtime, "venv", "bin", "hermes")]) {
    if (await executableAt(path)) return path;
  }
  return Bun.which("hermes") ?? undefined;
}
function nativeEnvironment(root: string): NodeJS.ProcessEnv {
  // Explicit root selector prevents a sticky profile preference from redirecting this launch.
  return { ...process.env, HERMES_HOME: root, HERMES_CONFIG: join(root, "config.yaml"), HERMES_ENV: join(root, ".env") };
}
export async function runHermes(directory: string, args: string[], options: { executable?: string } = {}): Promise<void> {
  const root = await profilePath(directory);
  const executable = options.executable ?? await findRuntime(root);
  if (!executable) throw new Error("Hermes runtime is missing. Run onboarding with runtime installation enabled.");
  if (args.some(arg => ["-p", "--profile"].includes(arg) || arg.startsWith("--profile="))) throw new Error("Select the Boomkin directory instead of overriding its Hermes profile");
  const child = Bun.spawn([executable, "--profile", "default", ...args], { cwd: root, env: nativeEnvironment(root), stdin: "inherit", stdout: "inherit", stderr: "inherit" });
  if (await child.exited !== 0) throw new Error("Hermes command failed; review its native output above.");
}
export async function ensureRuntime(directory: string, options: { install: boolean; dryRun?: boolean }): Promise<string> {
  const root = await profilePath(directory);
  const existing = await findRuntime(root);
  if (existing) {
    if (options.dryRun) {
      console.log(`Would reuse the existing Hermes executable at ${existing}`);
      return existing;
    }
    await mkdir(root, { recursive: true, mode: 0o700 });
    const status = await localProfileStatus(root);
    if (!status.runtime.available) throw new Error("The existing Hermes executable did not report a valid version; repair it before onboarding");
    const [major, minor] = status.runtime.version!.split(".").map(Number);
    if (major === 0 && minor! < 21) throw new Error("Boomkin requires Hermes 0.21.0 or newer for the reviewed profile and MCP controls. Update Hermes through its native flow, then rerun onboard.");
    return existing;
  }
  if (!options.install) throw new Error("Hermes runtime is missing. Run onboarding with runtime installation enabled.");
  const runtime = join(root, ".boomkin", "runtime");
  if (options.dryRun) {
    const planned = join(runtime, "venv", "bin", "hermes");
    console.log(`Would install Hermes ${HERMES_VERSION} at ${planned}`);
    return planned;
  }
  if (process.platform === "win32") throw new Error("Install Hermes with the official Windows installer first, then rerun Boomkin onboarding.");
  await mkdir(join(root, ".boomkin"), { recursive: true, mode: 0o700 });
  const response = await fetch(HERMES_INSTALLER_URL, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`Official Hermes installer download failed (${response.status})`);
  const installer = await response.text();
  if (createHash("sha256").update(installer).digest("hex") !== HERMES_INSTALLER_SHA256) throw new Error("Official Hermes installer checksum mismatch; nothing was executed");
  const path = join(root, ".boomkin", `hermes-installer-${randomUUID()}.sh`);
  await writeFile(path, installer, { flag: "wx", mode: 0o600 });
  try {
    console.log("Installing the official Hermes runtime. Its installer also manages the user-level hermes command and runtime dependencies.");
    const child = Bun.spawn(["bash", path, "--commit", HERMES_COMMIT, "--dir", runtime, "--hermes-home", root, "--skip-setup", "--skip-browser", "--skip-computer-use", "--non-interactive"], { cwd: root, env: nativeEnvironment(root), stdin: "inherit", stdout: "inherit", stderr: "inherit" });
    if (await child.exited !== 0) throw new Error("The official Hermes installer failed. Resolve its reported issue and retry onboarding.");
    const installed = await findRuntime(root);
    if (!installed || !installed.startsWith(runtime + "/")) throw new Error("The installer completed without a usable profile-managed Hermes executable");
    const git = Bun.spawn(["git", "-C", runtime, "rev-parse", "HEAD"], { stdout: "pipe", stderr: "ignore" });
    const revision = (await new Response(git.stdout).text()).trim();
    if (await git.exited !== 0 || revision !== HERMES_COMMIT) throw new Error("Hermes installed revision differs from the reviewed pin. Existing runtime was preserved; review it before continuing.");
    if (!(await localProfileStatus(root)).runtime.available) throw new Error("Installed Hermes cannot report its version; runtime readiness is incomplete");
    return installed;
  } finally { await rm(path, { force: true }); }
}
export async function initializeProfile(directory: string, identity: string): Promise<{ createdSoul: boolean }> {
  const root = await profilePath(directory);
  await mkdir(root, { recursive: true, mode: 0o700 });
  await safePath(join(root, "SOUL.md"));
  try { await writeFile(join(root, "SOUL.md"), identity, { flag: "wx", mode: 0o600 }); return { createdSoul: true }; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "EEXIST") return { createdSoul: false }; throw error; }
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => `${JSON.stringify(key)}:${canonical(child)}`).join(",")}}`;
  return JSON.stringify(value);
}
export async function configureMcpServers(directory: string, servers: Record<string, McpServer>): Promise<string[]> {
  const root = await profilePath(directory);
  await mkdir(root, { recursive: true, mode: 0o700 });
  const path = join(root, "config.yaml");
  const before = await textOrEmpty(path);
  const doc = document(before);
  const config = doc.toJS({ maxAliasCount: 0 });
  const current = config.mcp_servers ?? {};
  if (!current || typeof current !== "object" || Array.isArray(current)) throw new Error("Existing MCP configuration is not a mapping; it was preserved");
  const added: string[] = [];
  for (const [name, server] of Object.entries(servers)) {
    if (!/^[a-z][a-z0-9_-]*$/.test(name)) throw new Error("Invalid MCP server name");
    if (server.trust !== "untrusted" || !Array.isArray(server.tools?.include) || server.tools.include.some(name => !name || /[*?\[\]]/.test(name)) || server.tools.resources !== false || server.tools.prompts !== false) throw new Error("Boomkin MCP setup requires untrusted servers, explicit tool names, and disabled resource/prompt utilities");
    if (Boolean(server.url) === Boolean(server.command)) throw new Error("Choose one MCP transport");
    if (server.url) {
      const url = new URL(server.url);
      if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) throw new Error("Remote MCP setup requires HTTPS and credentials in environment-backed headers");
    }
    if (Object.hasOwn(current, name)) {
      if (canonical(current[name]) !== canonical(server)) throw new Error(`MCP server ${name} already has different settings; existing configuration was preserved`);
    } else added.push(name);
  }
  if (!added.length) return [];
  if (!doc.has("mcp_servers")) doc.set("mcp_servers", doc.createNode({}));
  for (const name of added) doc.setIn(["mcp_servers", name], doc.createNode(servers[name]));
  const temporary = join(root, `.config-boomkin-${randomUUID()}.yaml`);
  try {
    await writeFile(temporary, doc.toString(), { flag: "wx", mode: 0o600 });
    if (await textOrEmpty(path) !== before) throw new Error("Hermes config changed during setup; retry after the other editor finishes");
    await rename(temporary, path);
    await chmod(path, 0o600);
  } finally { await rm(temporary, { force: true }); }
  return added;
}
export async function setMcpTrustUntrusted(directory: string, name: string): Promise<void> {
  const root = await profilePath(directory);
  if (!/^[a-z][a-z0-9_-]*$/.test(name)) throw new Error("Invalid MCP server name");
  const path = join(root, "config.yaml");
  const before = await textOrEmpty(path);
  const doc = document(before);
  const entry = doc.getIn(["mcp_servers", name], true);
  if (!isMap(entry)) throw new Error("MCP server is missing; finish native setup first");
  const tools = doc.getIn(["mcp_servers", name, "tools"], true);
  if (tools !== undefined && !isMap(tools)) throw new Error("MCP tool selection is malformed; existing configuration was preserved");
  doc.setIn(["mcp_servers", name, "trust"], "untrusted");
  if (!tools) doc.setIn(["mcp_servers", name, "tools"], doc.createNode({}));
  doc.setIn(["mcp_servers", name, "tools", "resources"], false);
  doc.setIn(["mcp_servers", name, "tools", "prompts"], false);
  const temporary = join(root, `.config-boomkin-${randomUUID()}.yaml`);
  try {
    await writeFile(temporary, doc.toString(), { flag: "wx", mode: 0o600 });
    if (await textOrEmpty(path) !== before) throw new Error("Hermes config changed during setup; retry after the other editor finishes");
    await rename(temporary, path);
    await chmod(path, 0o600);
  } finally { await rm(temporary, { force: true }); }
}

function envValues(text: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (match) result[match[1]] = match[2].replace(/^(["'])(.*)\1$/, "$2").replace(/\s+#.*$/, "");
  }
  return result;
}
export async function localProfileStatus(directory: string) {
  const root = await profilePath(directory);
  const executable = await findRuntime(root);
  let version: string | undefined;
  let rootExists = false;
  try { rootExists = (await lstat(root)).isDirectory(); } catch (error) { if (!absent(error)) throw error; }
  if (executable && rootExists) {
    const child = Bun.spawn([executable, "--profile", "default", "--version"], { cwd: root, env: nativeEnvironment(root), stdout: "pipe", stderr: "ignore", timeout: 15_000 });
    const output = await new Response(child.stdout).text();
    if (await child.exited === 0) version = output.match(/\bHermes(?: Agent)?\s+v?(\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?)/i)?.[1];
  }
  const config = await readHermesConfig(root);
  const env = { ...process.env, ...envValues(await textOrEmpty(join(root, ".env"))) };
  const model = config.model && typeof config.model === "object" ? config.model as Record<string, unknown> : {};
  const modelConfigured = typeof model.default === "string" && !!model.default.trim();
  const knownModelKeys = ["OPENROUTER_API_KEY", "OPENAI_API_KEY", "ANTHROPIC_API_KEY", "NOUS_API_KEY", "GEMINI_API_KEY", "GROQ_API_KEY", "DEEPSEEK_API_KEY", "XAI_API_KEY"];
  const credentialConfigured = knownModelKeys.some(key => !!env[key]?.trim() && !env[key]?.includes("${"));
  const servers = config.mcp_servers && typeof config.mcp_servers === "object" && !Array.isArray(config.mcp_servers) ? config.mcp_servers as Record<string, McpServer> : {};
  return {
    runtime: { available: !!version, executable, version },
    hasSoul: !!(await textOrEmpty(join(root, "SOUL.md"))).trim(),
    modelConfigured, credentialConfigured, authenticated: "unverified" as const,
    mcpServers: Object.entries(servers).map(([name, server]) => ({
      name, enabled: server.enabled !== false,
      missingEnvironment: [...new Set([...JSON.stringify(server).matchAll(/\$\{(?:env:)?([A-Za-z_][A-Za-z0-9_]*)\}/g)].map(match => match[1]).filter(key => !env[key]?.trim()))],
    })),
  };
}
