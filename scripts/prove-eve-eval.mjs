import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const vendorCjs = resolve("vendor/hosted-cjs/index.cjs");
const nodeModulesCjs = resolve("node_modules/unabot-hosted-cjs/index.cjs");
if (!existsSync(vendorCjs)) throw new Error("missing " + vendorCjs);
if (!existsSync(nodeModulesCjs)) throw new Error("missing " + nodeModulesCjs);
console.log("hosted-cjs vendor", vendorCjs);
console.log("hosted-cjs node_modules", nodeModulesCjs);

const loaderUrl = pathToFileURL(resolve("node_modules/eve/dist/src/internal/authored-module-loader.js")).href;
const { loadAuthoredModuleNamespace } = await import(loaderUrl);
const files = [
  "agent/tools/compound.ts",
  "agent/tools/exit.ts",
  "agent/tools/list.ts",
  "agent/tools/mint.ts",
  "agent/tools/range.ts",
  "agent/tools/status.ts",
  "agent/schedules/keeper.ts",
  "agent/channels/eve.ts",
  "agent/agent.ts",
];
for (const file of files) {
  const abs = resolve(file);
  const ns = await loadAuthoredModuleNamespace(abs);
  if (!ns.default) throw new Error("missing default export: " + file);
  console.log("ok", file);
}
console.log("all authored modules loaded");
