import { deflateSync } from 'node:zlib';

/**
 * A real PNG, built here, because the image manager needs one and this
 * workspace has no image library.
 *
 * ## Why not a fixture file on disk
 *
 * The API does not take the browser's word for anything about an upload: it
 * sniffs magic bytes, decodes the image, reads its true dimensions and refuses
 * anything whose short edge is under 200px (`media.config.ts`). So the file has
 * to be a genuinely valid PNG of a genuine size — a renamed text file or a 1×1
 * placeholder is rejected before the code under test runs, and the spec then
 * fails for a reason that has nothing to do with the image manager.
 *
 * A binary fixture would do that job, and it would also be an opaque blob in
 * the repository that nobody can check. This is forty lines that say exactly
 * what the bytes are.
 *
 * ## Why not sharp
 *
 * `apps/api` has it. This application does not, and should not acquire an image
 * dependency to support a test — the same argument `global-teardown.ts` makes
 * about not acquiring MongoDB.
 */

/** CRC-32, as PNG defines it. Node's `zlib.crc32` is too new to rely on here. */
function crc32(bytes: Buffer): number {
  let crc = 0xffffffff;

  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
  }

  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);

  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));

  return Buffer.concat([length, body, crc]);
}

/**
 * A deterministic, non-uniform PNG of the given size.
 *
 * Non-uniform on both axes on purpose: a flat colour compresses to almost
 * nothing and would make "the bytes arrived" indistinguishable from "an empty
 * file arrived". `seed` changes the pattern, so two uploads in one spec are
 * genuinely different images rather than the same bytes twice.
 */
export function pngBuffer(width = 320, height = 240, seed = 0): Buffer {
  const raw = Buffer.alloc(height * (1 + width * 3));

  for (let y = 0; y < height; y += 1) {
    const row = y * (1 + width * 3);
    raw[row] = 0; // filter: none

    for (let x = 0; x < width; x += 1) {
      const at = row + 1 + x * 3;
      raw[at] = (x * 7 + y * 3 + seed * 53) % 256;
      raw[at + 1] = (x * 3 + y * 11 + seed * 29) % 256;
      raw[at + 2] = ((x ^ y) * 5 + seed * 17) % 256;
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: truecolour RGB
  ihdr[10] = 0; // deflate
  ihdr[11] = 0; // adaptive filtering
  ihdr[12] = 0; // no interlace

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
