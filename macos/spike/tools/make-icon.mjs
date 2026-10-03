// Renders App/AppIcon.svg into App/Assets.xcassets/AppIcon.appiconset (PNGs + Contents.json).
// The SVG is the landing page favicon (packages/worker/public/favicon.svg) scaled into the macOS
// icon grid: an 824 px rounded square centered on a transparent 1024 px canvas.
//
//   cd "$(mktemp -d)" && npm init -y >/dev/null && npm i sharp >/dev/null \
//     && node /path/to/macos/spike/tools/make-icon.mjs
//
// (sharp is not a dependency of this repo; the PNGs are committed, so this only runs when the design changes.)
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.join(process.cwd(), 'noop.js'));
const sharp = require('sharp');

const svg = fs.readFileSync(path.join(here, '..', 'App', 'AppIcon.svg'));
const out = path.join(here, '..', 'App', 'Assets.xcassets', 'AppIcon.appiconset');
fs.mkdirSync(out, { recursive: true });

const images = [];
for (const size of [16, 32, 128, 256, 512]) {
  for (const scale of [1, 2]) {
    const px = size * scale;
    const file = `icon_${size}x${size}${scale === 2 ? '@2x' : ''}.png`;
    await sharp(svg, { density: ((72 * px) / 1024) * 4 })
      .resize(px, px)
      .png()
      .toFile(path.join(out, file));
    images.push({ filename: file, idiom: 'mac', scale: `${scale}x`, size: `${size}x${size}` });
  }
}
fs.writeFileSync(
  path.join(out, 'Contents.json'),
  JSON.stringify({ images, info: { author: 'xcode', version: 1 } }, null, 2) + '\n',
);
fs.writeFileSync(
  path.join(out, '..', 'Contents.json'),
  JSON.stringify({ info: { author: 'xcode', version: 1 } }, null, 2) + '\n',
);
console.log(`wrote ${images.length} images to ${out}`);
