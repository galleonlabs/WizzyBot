import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const here = dirname(fileURLToPath(import.meta.url));
const source = join(here, "product-surface.png");
const master = join(here, "launch-card-1600x900.png");
const preview = join(here, "launch-card-1200x675.png");

const input = await readFile(source);
const liveDataMask = Buffer.from(`
  <svg width="150" height="84" xmlns="http://www.w3.org/2000/svg">
    <rect width="150" height="84" fill="#111116"/>
    <text x="150" y="50" text-anchor="end" fill="#6ceac8" font-family="Arial, sans-serif" font-size="14" font-weight="700" letter-spacing="1.2">LIVE DATA</text>
  </svg>
`);

await sharp(input)
  .extract({ left: 0, top: 0, width: 1600, height: 900 })
  .composite([{ input: liveDataMask, left: 1240, top: 400 }])
  .png({ compressionLevel: 9 })
  .toFile(master);

await sharp(master)
  .resize(1200, 675, { fit: "fill" })
  .png({ compressionLevel: 9 })
  .toFile(preview);

process.stdout.write(`Rendered ${master}\nRendered ${preview}\n`);
