import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const here = dirname(fileURLToPath(import.meta.url));
const dist = join(here, "..", "dist", "unabot.cjs");
if (!existsSync(dist)) {
  console.error("build missing");
  process.exit(1);
}
createRequire(import.meta.url)(dist);
