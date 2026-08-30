import { mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const fontDir = join(root, "assets", "fonts");
const workDir = await mkdtemp(join(tmpdir(), "wizzy-social-"));
const fontConfig = join(workDir, "fonts.conf");

const xmlEscape = (value) => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

await writeFile(
  fontConfig,
  `<?xml version="1.0"?>
<!DOCTYPE fontconfig SYSTEM "fonts.dtd">
<fontconfig>
  <dir>${xmlEscape(fontDir)}</dir>
  <cachedir>${xmlEscape(join(workDir, "cache"))}</cachedir>
</fontconfig>`,
);

process.env.FONTCONFIG_FILE = fontConfig;
process.env.FONTCONFIG_PATH = workDir;

try {
  const { default: sharp } = await import("sharp");
  const source = await readFile(join(root, "public", "brand", "wizzy-social.svg"));

  const target = join(root, "public", "brand", "wizzy-social-unbounded-v1.png");
  const pending = `${target}.next`;
  await sharp(source).png({ compressionLevel: 9, palette: true }).toFile(pending);
  await rename(pending, target);
} finally {
  await rm(workDir, { recursive: true, force: true });
}
