import { build } from "esbuild";

await build({
  entryPoints: ["src/hosted-bundle.ts"],
  bundle: true,
  platform: "node",
  format: "cjs",
  outfile: "vendor/hosted-cjs/index.cjs",
  target: "node20",
  sourcemap: false,
  logLevel: "info",
});
