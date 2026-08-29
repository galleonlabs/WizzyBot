import { copyFileSync, existsSync, mkdirSync, realpathSync } from "node:fs";
import { resolve } from "node:path";
import { build } from "esbuild";

const outfile = resolve("vendor/hosted-cjs/index.cjs");

await build({
  entryPoints: ["src/hosted-bundle.ts"],
  bundle: true,
  platform: "node",
  format: "cjs",
  outfile,
  target: "node20",
  sourcemap: false,
  logLevel: "info",
});

// bun `file:` may copy vendor/hosted-cjs at install time, before index.cjs
// existed. Copy the generated file into node_modules so package-name require
// also works on Vercel after this step.
const destDir = resolve("node_modules/unabot-hosted-cjs");
mkdirSync(destDir, { recursive: true });
const destFile = resolve(destDir, "index.cjs");
const srcPkg = resolve("vendor/hosted-cjs/package.json");
const destPkg = resolve(destDir, "package.json");

function sameFile(a, b) {
  try {
    return realpathSync(a) === realpathSync(b);
  } catch {
    return false;
  }
}

if (!sameFile(outfile, destFile)) {
  copyFileSync(outfile, destFile);
}
if (existsSync(srcPkg) && !sameFile(srcPkg, destPkg)) {
  copyFileSync(srcPkg, destPkg);
}

if (!existsSync(outfile) || !existsSync(destFile)) {
  throw new Error(`hosted-cjs missing after bundle: ${outfile} / ${destFile}`);
}

console.log("hosted-cjs vendor:", outfile);
console.log("hosted-cjs node_modules:", destFile);
