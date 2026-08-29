
import { build } from "esbuild";

await build({
  entryPoints: ["src/cli/index.ts"],
  bundle: true,
  platform: "node",
  format: "cjs",
  outfile: "dist/unabot.cjs",
  target: "node20",
  sourcemap: false,
  logLevel: "info",
});
