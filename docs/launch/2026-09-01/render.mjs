import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../../..");
const source = join(here, "launch-card.svg");
const master = join(here, "launch-card-1600x900.png");
const preview = join(here, "launch-card-1200x675.png");
const workDir = await mkdtemp(join(tmpdir(), "wizzy-launch-"));
const fontConfig = join(workDir, "fonts.conf");

const xmlEscape = (value) => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

await writeFile(
  fontConfig,
  `<?xml version="1.0"?>
<!DOCTYPE fontconfig SYSTEM "fonts.dtd">
<fontconfig>
  <dir>${xmlEscape(join(root, "assets", "fonts"))}</dir>
  <cachedir>${xmlEscape(join(workDir, "cache"))}</cachedir>
</fontconfig>`,
);

process.env.FONTCONFIG_FILE = fontConfig;
process.env.FONTCONFIG_PATH = workDir;

try {
  const { default: sharp } = await import("sharp");
  const input = await readFile(source);
  await sharp(input, { density: 144 })
    .resize(1600, 900, { fit: "fill" })
    .png({ compressionLevel: 9 })
    .toFile(master);

  await sharp(master)
    .resize(1200, 675, { fit: "fill" })
    .png({ compressionLevel: 9 })
    .toFile(preview);

  process.stdout.write(`Rendered ${master}\nRendered ${preview}\n`);
} finally {
  await rm(workDir, { recursive: true, force: true });
}
