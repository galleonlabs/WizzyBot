#!/usr/bin/env bun
import { runCurator } from "./run.js";

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const stateDir = argument("--state-dir");
const persist = !process.argv.includes("--no-write");

try {
  const report = await runCurator({ stateDir, persist });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} catch (error) {
  process.stderr.write(`Curator failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
