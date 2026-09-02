/**
 * Cuts a full-page screenshot into viewport-sized tiles.
 *
 * A 390x5181 home page scaled to fit a reading pane is 7% of its true size,
 * which is exactly the "reasoning from a clean build" the QA pass exists to
 * stop. Tiles are 1:1 pixels, so what is read is what a customer sees.
 *
 *   node e2e/qa/slice.mjs qa-shots/home@390.png [tileHeight]
 */

import { mkdir } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { createRequire } from 'node:module';

// sharp is the API workspace's dependency, not the storefront's; this is a
// throwaway viewing aid and does not justify adding it here.
const require = createRequire(import.meta.url);
const sharp = require('../../../api/node_modules/sharp');

const [, , file, height = '820'] = process.argv;

if (file === undefined) {
  process.stderr.write('usage: node e2e/qa/slice.mjs <png> [tileHeight]\n');
  process.exit(1);
}

const tile = Number(height);
const outDir = join('qa-shots', 'tiles');

const image = sharp(file);
const { width, height: full } = await image.metadata();
await mkdir(outDir, { recursive: true });

const stem = basename(file, '.png');
const count = Math.ceil(full / tile);

for (let i = 0; i < count; i += 1) {
  const top = i * tile;
  const out = join(outDir, `${stem}--${String(i + 1).padStart(2, '0')}.png`);
  await sharp(file)
    .extract({ left: 0, top, width, height: Math.min(tile, full - top) })
    .toFile(out);
  process.stdout.write(`${out}\n`);
}
