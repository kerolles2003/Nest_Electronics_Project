/**
 * Placeholder product photographs, for looking at the storefront.
 *
 * ## Why this exists
 *
 * `NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME` is unset — the account is an owner
 * deliverable — so `imageUrl()` returns `null` and every product renders its
 * letter placeholder. That is *correct behaviour*, and it is also useless for
 * judging the layout: a grid of blank boxes is uniform in a way a grid of
 * photographs never is. Overflow, clipped titles, cards of unequal height,
 * aspect-ratio handling and the "many images" gallery are all invisible until
 * something actually occupies the boxes.
 *
 * So this generates bytes for the images the seed already declares. It invents
 * nothing: the `publicId`, `version`, `format` and — crucially — the exact
 * `width` and `height` come from the database, which is where the storefront
 * gets them too. A generated file is therefore the same shape as the image the
 * page reserved space for, which is the only way the reserved space can be
 * checked.
 *
 * ## They go through the real pipeline
 *
 * The drawn bytes are handed to `processUploadedImage()` — the same function
 * `MediaService.upload()` calls — so they are decoded, oriented, stripped of
 * metadata, capped at the real `maxEdge` and re-encoded by the same sharp
 * build that serves production. If a placeholder survives that, a real upload
 * of the same dimensions will too.
 *
 * ## They are not content
 *
 * No photograph is copied from anywhere. Each is drawn from the product's own
 * slug: a flat board shape, a deterministic hue, and the slug written on it, so
 * a screenshot says which product it belongs to. Output is gitignored.
 *
 *   pnpm --filter api media:placeholders
 *
 * See `apps/storefront/e2e/qa/` for the harness that serves them to a browser.
 */

import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import mongoose from 'mongoose';
import sharp from 'sharp';

import { processUploadedImage } from '../dist/modules/media/application/image-processing.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_ROOT = join(HERE, '..', 'dev-media');

/**
 * The same limits `media.config.ts` gives the upload endpoint.
 *
 * Hard-coded rather than imported because importing the Nest config would mean
 * booting the config module, and the point of the exercise is that a
 * placeholder passes the same gate a real file does — not that it shares a
 * constant with it.
 */
const LIMITS = { minEdge: 200, maxEdge: 4000 };

/** A stable hue per product, so the same board is the same colour every run. */
function hueFor(slug) {
  return createHash('sha256').update(slug).digest()[0] * (360 / 256);
}

/**
 * One flat "board on a light backdrop", drawn to fill the declared dimensions.
 *
 * Deliberately plain. A placeholder that is busier than the real photographs
 * will be would make the layout look worse than it is, and a placeholder that
 * is emptier would hide the crowding a real photograph causes.
 */
function boardSvg({ slug, index, width, height }) {
  const hue = hueFor(slug);
  const board = `hsl(${hue.toFixed(0)}, 34%, 42%)`;
  const boardDark = `hsl(${hue.toFixed(0)}, 34%, 31%)`;
  const short = Math.min(width, height);

  // The board occupies the middle, inset by a margin that scales with the
  // image, so a 1600x900 and a 900x1600 both look like a product shot rather
  // than a stretched one.
  const bw = Math.round(width * 0.66);
  const bh = Math.round(height * 0.5);
  const bx = Math.round((width - bw) / 2);
  const by = Math.round((height - bh) / 2);
  const r = Math.round(short * 0.02);

  // Pin headers along the top and bottom edges: enough small high-contrast
  // detail that a 400px thumbnail is not a flat rectangle.
  const pitch = Math.max(8, Math.round(bw / 26));
  const pinW = Math.round(pitch * 0.45);
  const pinH = Math.round(short * 0.022);
  let pins = '';
  for (let x = bx + pitch; x < bx + bw - pitch; x += pitch) {
    pins += `<rect x="${x}" y="${by + Math.round(pinH * 0.6)}" width="${pinW}" height="${pinH}" fill="#1f2430" opacity="0.72"/>`;
    pins += `<rect x="${x}" y="${by + bh - Math.round(pinH * 1.6)}" width="${pinW}" height="${pinH}" fill="#1f2430" opacity="0.72"/>`;
  }

  const chipW = Math.round(bw * 0.3);
  const chipH = Math.round(bh * 0.34);
  const label = `${slug} · ${index}`;
  const fontSize = Math.max(14, Math.round(short * 0.035));

  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
      <rect width="${width}" height="${height}" fill="#f2f3f5"/>
      <rect x="${bx}" y="${by}" width="${bw}" height="${bh}" rx="${r}" fill="${board}"/>
      <rect x="${bx + Math.round(bw * 0.1)}" y="${by + Math.round(bh * 0.33)}"
            width="${chipW}" height="${chipH}" rx="${Math.round(r / 2)}" fill="${boardDark}"/>
      <rect x="${bx + Math.round(bw * 0.55)}" y="${by + Math.round(bh * 0.4)}"
            width="${Math.round(chipW * 0.55)}" height="${Math.round(chipH * 0.5)}"
            rx="${Math.round(r / 2)}" fill="#c8ccd4"/>
      ${pins}
      <text x="${Math.round(width / 2)}" y="${by + bh + Math.round(short * 0.09)}"
            font-family="DejaVu Sans, Verdana, sans-serif" font-size="${fontSize}"
            fill="#5b6270" text-anchor="middle">${label}</text>
      <text x="${Math.round(width / 2)}" y="${by + bh + Math.round(short * 0.09) + Math.round(fontSize * 1.5)}"
            font-family="DejaVu Sans, Verdana, sans-serif" font-size="${Math.round(fontSize * 0.8)}"
            fill="#9aa1ad" text-anchor="middle">${width}×${height}</text>
    </svg>`,
    'utf8',
  );
}

async function main() {
  const uri = process.env.MONGODB_URI ?? 'mongodb://127.0.0.1:27017/nest_electronics_dev?replicaSet=rs0';
  await mongoose.connect(uri);

  try {
    const products = mongoose.connection.db.collection('products');
    const images = await products
      .aggregate([
        { $unwind: '$images' },
        {
          $project: {
            _id: 0,
            publicId: '$images.publicId',
            width: '$images.width',
            height: '$images.height',
            format: '$images.format',
          },
        },
      ])
      .toArray();

    if (images.length === 0) {
      throw new Error('no product images in the database — run `pnpm --filter api seed` first');
    }

    let written = 0;

    for (const image of images) {
      // `nest/products/<slug>/<n>` — the namespace the upload API writes to.
      const parts = image.publicId.split('/');
      const index = parts.at(-1);
      const slug = parts.at(-2) ?? 'product';

      const drawn = await sharp(boardSvg({ slug, index, width: image.width, height: image.height }))
        .webp({ quality: 82 })
        .toBuffer();

      // The real gate. If a placeholder cannot pass it, neither could a
      // photograph of the same dimensions.
      const processed = await processUploadedImage(drawn, LIMITS);

      if (processed.width !== image.width || processed.height !== image.height) {
        throw new Error(
          `${image.publicId}: pipeline returned ${processed.width}x${processed.height}, ` +
            `but the catalogue says ${image.width}x${image.height} — the storefront reserves ` +
            'the catalogue size, so these must agree',
        );
      }

      const file = join(OUT_ROOT, `${image.publicId}.${processed.format}`);
      await mkdir(dirname(file), { recursive: true });
      await writeFile(file, processed.bytes);
      written += 1;
    }

    process.stdout.write(`${written} placeholder images written to ${OUT_ROOT}\n`);
  } finally {
    await mongoose.disconnect();
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
