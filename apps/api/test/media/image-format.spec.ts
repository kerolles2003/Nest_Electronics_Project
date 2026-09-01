import { describe, expect, it } from '@jest/globals';
import sharp from 'sharp';
import {
  mimeTypeForFormat,
  sniffImageFormat,
} from '../../src/modules/media/application/image-format';

/**
 * Magic-byte sniffing — MEDIA-MODEL.md §5 item 3.
 *
 * > "`file-type` inspects actual bytes. A file declaring `image/png` whose
 * > content is not PNG is rejected. **Legacy trusted the declared type.**"
 *
 * Every fixture here is a REAL image produced by sharp rather than a
 * hand-written byte array. A hand-written array proves the sniffer recognises
 * the bytes somebody wrote to satisfy it, which is a different and much weaker
 * claim — and it would not have caught, for instance, a WebP branch that only
 * handled the lossy chunk when sharp emits lossless by default.
 */

const solid = (format: 'jpeg' | 'png' | 'webp', width = 240, height = 180): Promise<Buffer> =>
  sharp({ create: { width, height, channels: 3, background: { r: 200, g: 60, b: 40 } } })
    .toFormat(format)
    .toBuffer();

describe('sniffImageFormat', () => {
  it.each(['jpeg', 'png', 'webp'] as const)('recognises a real %s', async (format) => {
    expect(sniffImageFormat(await solid(format))).toBe(format);
  });

  it('recognises a LOSSLESS webp as well as a lossy one', async () => {
    // Different RIFF chunk types (`VP8L` vs `VP8 `) behind the same container
    // signature. A sniffer keyed on the chunk rather than the container would
    // pass one and fail the other, and which one it saw would depend on
    // whatever encoder produced the upload.
    const lossless = await sharp({
      create: { width: 240, height: 180, channels: 3, background: { r: 1, g: 2, b: 3 } },
    })
      .webp({ lossless: true })
      .toBuffer();

    expect(sniffImageFormat(lossless)).toBe('webp');
  });

  it('rejects a GIF, a TIFF and an AVIF — formats that ARE images but are not allowed', async () => {
    // The allow-list is three formats. Everything else must be indistinguishable
    // from garbage as far as this function is concerned, including things that
    // are perfectly valid images: recognising more formats would only create
    // the opportunity to accept one.
    const gif = Buffer.from('GIF89a', 'ascii');
    const tiff = Buffer.from([0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00]);
    const avif = await sharp({
      create: { width: 240, height: 180, channels: 3, background: { r: 1, g: 2, b: 3 } },
    })
      .avif({ effort: 0 })
      .toBuffer();

    expect({ gif: sniffImageFormat(gif), tiff: sniffImageFormat(tiff), avif: sniffImageFormat(avif) }).toEqual(
      { gif: null, tiff: null, avif: null },
    );
  });

  it('rejects an SVG, which is the one that matters most', async () => {
    // MEDIA-MODEL.md §5 item 6, a HARD rule: SVG is executable markup, and one
    // served from a whitelisted image host is a stored-XSS vector (Phase 0 M3).
    // It is also the format most likely to be submitted in good faith, because
    // it is an image everywhere else.
    const svg = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
      'utf8',
    );

    expect(sniffImageFormat(svg)).toBeNull();
  });

  it('rejects a PNG whose signature has been altered by a single byte', async () => {
    const png = await solid('png');
    const tampered = Buffer.from(png);
    tampered[3] = 0x00; // the 'G' of the PNG signature

    expect({ original: sniffImageFormat(png), tampered: sniffImageFormat(tampered) }).toEqual({
      original: 'png',
      tampered: null,
    });
  });

  it('rejects a file that is a PNG header glued to something else', async () => {
    // The attack the sniffer does NOT stop on its own, asserted so the limit is
    // recorded rather than assumed: a valid header followed by arbitrary bytes
    // still sniffs as PNG. What stops it is the re-encode in image-processing —
    // sniffing is the cheap first filter, not the security boundary.
    const png = await solid('png');
    const glued = Buffer.concat([png.subarray(0, 8), Buffer.from('<?php system($_GET[0]); ?>')]);

    expect(sniffImageFormat(glued)).toBe('png');
  });

  it.each([
    ['empty', Buffer.alloc(0)],
    ['one byte', Buffer.from([0xff])],
    ['shorter than the shortest signature', Buffer.from([0x89, 0x50])],
    ['RIFF with no WEBP form type', Buffer.from('RIFF____WAVE', 'ascii')],
  ])('returns null for %s rather than throwing', (_label, buffer) => {
    expect(sniffImageFormat(buffer)).toBeNull();
  });
});

describe('mimeTypeForFormat', () => {
  it('maps each allowed format to exactly one declared type', () => {
    expect({
      jpeg: mimeTypeForFormat('jpeg'),
      png: mimeTypeForFormat('png'),
      webp: mimeTypeForFormat('webp'),
    }).toEqual({ jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' });
  });
});
