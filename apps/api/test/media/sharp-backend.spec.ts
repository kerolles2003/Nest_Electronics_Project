import { describe, expect, it } from '@jest/globals';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import sharp from 'sharp';
import {
  describeSharpBackend,
  detectSharpBackend,
  type SharpBackend,
} from '../../src/modules/media/application/sharp-backend';
import { processUploadedImage } from '../../src/modules/media/application/image-processing';

/**
 * sharp has two backends, and product photographs must not depend on which one
 * ran.
 *
 * ## Why the project carries both
 *
 * `@img/sharp-wasm32` is a dependency of this package. It exists for a machine
 * where the NATIVE addon cannot be loaded at all — Windows Smart App Control
 * refuses unsigned native code, and without a fallback the API does not start.
 * sharp's own loader reaches for it only after the native `require` throws, so
 * carrying it cannot move production off the native build; that ordering is
 * asserted below by observing what actually loaded.
 *
 * It is a REQUIRED dependency rather than an optional one, and that is a fix
 * rather than a preference. sharp 0.35 dropped `@img/sharp-wasm32` from its own
 * optional dependencies (it now lists `@img/sharp-webcontainers-wasm32` and
 * `@img/sharp-freebsd-wasm32`, both `cpu: [wasm32]`), while its loader still
 * falls back to `require('@img/sharp-wasm32/sharp.node')`. Declared as OPTIONAL
 * here, the package became reachable only as a child of those two — which are
 * correctly skipped on an x64 host — and `pnpm install --frozen-lockfile`
 * inherited that skip and never installed it. A full `pnpm install` did install
 * it, which is why this suite passed on a developer machine whose node_modules
 * predated the change, and failed on CI, which always installs frozen. The
 * package carries no `os`, `cpu` or `libc` constraint, so requiring it costs
 * nine megabytes and breaks no platform.
 *
 * ## Why the equivalence is asserted rather than assumed
 *
 * Both builds embed the same libvips, which is a good reason to EXPECT
 * identical output and not a reason to believe it. Catalogue images are the
 * product. So a second process is started with the native addon made
 * unloadable — standing in for the OS policy, without touching the filesystem —
 * and the bytes it produces are compared with this process's.
 */

const LIMITS = { minEdge: 200, maxEdge: 2000 };

/**
 * A deterministic, non-uniform source image.
 *
 * A flat colour would survive any resampler and prove nothing; this pattern
 * changes on both axes, so a difference in scaling, colour handling or channel
 * order would move the hash.
 */
async function sourceImage(width: number, height: number, orientation: number | null): Promise<Buffer> {
  const channels = 3;
  const raw = Buffer.alloc(width * height * channels);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * channels;
      raw[i] = (x * 7 + y * 3) % 256;
      raw[i + 1] = (x * 3 + y * 11) % 256;
      raw[i + 2] = ((x ^ y) * 5) % 256;
    }
  }

  const pipeline = sharp(raw, { raw: { width, height, channels } });

  return orientation === null
    ? pipeline.jpeg({ quality: 90 }).toBuffer()
    : pipeline
        .withMetadata({ orientation, exif: { IFD0: { Copyright: 'Nest', Artist: 'somebody' } } })
        .jpeg({ quality: 90 })
        .toBuffer();
}

const sha256 = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex');

describe('the sharp backend is reported, never guessed at', () => {
  it('names the backend that actually loaded', () => {
    const backend = detectSharpBackend();

    /*
     * Not asserted to be `native`. On a machine with Smart App Control
     * enforcing, the WASM path IS the correct answer, and a test that failed
     * there would be failing the environment the fallback exists to serve.
     * What must hold is that the detector reaches a verdict at all — an
     * `unknown` means the module layout moved and every report below it is
     * worthless.
     */
    expect(['native', 'wasm']).toContain(backend);
  });

  it('is quiet about native, loud about WASM, and loudest about WASM in production', () => {
    expect(describeSharpBackend('native', true).level).toBe('log');
    expect(describeSharpBackend('native', false).level).toBe('log');

    expect(describeSharpBackend('wasm', false).level).toBe('warn');

    const production = describeSharpBackend('wasm', true);
    expect(production.level).toBe('error');
    expect(production.message).toContain('NOT A PRODUCTION CONFIGURATION');

    // An undetectable backend is a broken report, not a broken installation.
    expect(describeSharpBackend('unknown', true).level).toBe('warn');
  });
});

describe('native and WebAssembly sharp produce the same image', () => {
  /**
   * The fallback has to BE there before anything below can mean anything.
   *
   * This assertion exists because its absence cost a week of misreading. With
   * the package missing, sharp's loader tried the native addon (blocked by the
   * probe, on purpose), then `@img/sharp-wasm32/sharp.node`, and threw
   *
   *     Could not load the "sharp" module using the linux-x64 runtime
   *
   * naming the NATIVE runtime — because sharp filters `MODULE_NOT_FOUND` out of
   * that message (`dist/sharp.cjs`, `if (!err.code.endsWith('MODULE_NOT_FOUND'))`).
   * The one error that said what was actually wrong was the one suppressed. CI
   * read as "the runner cannot load native sharp" while the runner was loading
   * native sharp perfectly well in every other test in this file.
   *
   * So the precondition is checked here, by name, and says what to do.
   */
  it('carries the WebAssembly fallback that the loader falls back TO', () => {
    // Resolved from sharp's OWN directory, because that is where the failing
    // `require` runs. Resolving from this test file would answer a different
    // question and could pass while the real lookup fails.
    const fromSharp = dirname(require.resolve('sharp'));

    let resolved: string | null = null;
    try {
      resolved = require.resolve('@img/sharp-wasm32/sharp.node', { paths: [fromSharp] });
    } catch {
      resolved = null;
    }

    if (resolved === null) {
      throw new Error(
        [
          '@img/sharp-wasm32 is not installed, so sharp has no WebAssembly backend to fall back to.',
          '',
          'This is an INSTALL fault, not a runtime one, and the three equivalence cases below',
          'cannot run without it. sharp itself will not say so: it filters MODULE_NOT_FOUND out',
          'of its error and reports the native runtime instead.',
          '',
          `Looked for "@img/sharp-wasm32/sharp.node" from ${fromSharp}`,
          '',
          'Fix: it must be a REQUIRED dependency of apps/api, never an optional one — see this',
          "file's header. Then `pnpm install` and commit pnpm-lock.yaml.",
        ].join('\n'),
      );
    }
  });

  /**
   * Runs the upload pipeline in a fresh process with the native addon blocked.
   *
   * The block is a `require` patch rather than a moved file: it exercises
   * exactly the ladder in sharp's loader — native throws, `@img/sharp-wasm32`
   * answers — and leaves `node_modules` untouched, so a failure here cannot
   * damage the checkout.
   */
  function runOnWasm(inputPath: string): { backend: SharpBackend; sha256: string; width: number; height: number; format: string; exifPresent: boolean } {
    const dir = mkdtempSync(join(tmpdir(), 'sharp-wasm-'));
    const script = join(dir, 'probe.cjs');

    writeFileSync(
      script,
      `
const Module = require('node:module');
const original = Module.prototype.require;
Module.prototype.require = function (id) {
  if (typeof id === 'string' && id.endsWith('.node') && !id.includes('wasm32')) {
    const error = new Error('blocked by the test, standing in for an Application Control policy');
    error.code = 'ERR_DLOPEN_FAILED';
    throw error;
  }
  return original.apply(this, arguments);
};

const fs = require('node:fs');
const crypto = require('node:crypto');
const sharp = require(${JSON.stringify(require.resolve('sharp'))});

const found = Object.keys(require.cache)
  .map((p) => /[\\\\/]@img[\\\\/](sharp-[^\\\\/]+)[\\\\/]/.exec(p))
  .find((m) => m !== null && m !== undefined);
const backend = !found ? 'unknown' : (found[1] === 'sharp-wasm32' ? 'wasm' : 'native');

(async () => {
  const input = fs.readFileSync(${JSON.stringify(inputPath)});
  const pipeline = sharp(input, { failOn: 'error' }).rotate();
  const metadata = await pipeline.metadata();
  const longest = Math.max(metadata.width, metadata.height);
  const resized = longest > ${String(LIMITS.maxEdge)}
    ? pipeline.resize({ width: ${String(LIMITS.maxEdge)}, height: ${String(LIMITS.maxEdge)}, fit: 'inside' })
    : pipeline;
  const { data, info } = await resized.toBuffer({ resolveWithObject: true });
  const after = await sharp(data).metadata();
  process.stdout.write(JSON.stringify({
    backend,
    sha256: crypto.createHash('sha256').update(data).digest('hex'),
    width: info.width,
    height: info.height,
    format: info.format,
    exifPresent: after.exif !== undefined,
  }));
})().catch((error) => { console.error(error); process.exit(1); });
`,
      'utf8',
    );

    try {
      const stdout = execFileSync(process.execPath, [script], {
        encoding: 'utf8',
        cwd: process.cwd(),
        timeout: 120_000,
      });
      return JSON.parse(stdout) as ReturnType<typeof runOnWasm>;
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  const cases: readonly { readonly label: string; readonly width: number; readonly height: number; readonly orientation: number | null }[] = [
    { label: 'an ordinary photograph', width: 900, height: 600, orientation: null },
    { label: 'one large enough to be downscaled', width: 3000, height: 1800, orientation: null },
    { label: 'one whose orientation lives in EXIF', width: 800, height: 1200, orientation: 6 },
  ];

  it.each(cases)('produces identical bytes for $label', async ({ width, height, orientation }) => {
    const dir = mkdtempSync(join(tmpdir(), 'sharp-input-'));
    const inputPath = join(dir, 'source.jpg');

    try {
      writeFileSync(inputPath, await sourceImage(width, height, orientation));

      const here = await processUploadedImage(
        await sourceImage(width, height, orientation),
        LIMITS,
      );
      const there = runOnWasm(inputPath);

      // The child really did run on the other backend. Without this the test
      // could pass by comparing native with native and prove nothing.
      expect(there.backend).toBe('wasm');

      expect({
        sha256: there.sha256,
        width: there.width,
        height: there.height,
        format: there.format,
        exifPresent: there.exifPresent,
      }).toEqual({
        sha256: sha256(here.bytes),
        width: here.width,
        height: here.height,
        format: here.format,
        exifPresent: false,
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 180_000);
});
