/**
 * Which sharp binary is actually running, and saying so out loud.
 *
 * ## Why this file exists
 *
 * `sharp` ships two kinds of backend and picks one at require time without
 * telling anybody. Its loader (`dist/sharp.cjs`) tries, in order:
 *
 *   1. a locally-compiled addon               (we never build one)
 *   2. a locally-compiled wasm addon          (likewise)
 *   3. `@img/sharp-<platform>` — NATIVE       (installed for every target)
 *   4. `@img/sharp-wasm32` — WebAssembly      (the last resort)
 *
 * Native therefore wins wherever it loads: WebAssembly is reached only when the
 * native `require` THROWS. That ordering is sharp's, not ours, and it is the
 * real guarantee that production keeps the native build.
 *
 * We carry `@img/sharp-wasm32` as an optional dependency because on at least
 * one development machine step 3 throws: Windows Smart App Control refuses to
 * load unsigned native addons, and without a fallback the API cannot start at
 * all. The images the two backends produce are identical — same libvips, and
 * the equivalence is asserted in `test/media/sharp-backend.spec.ts` — but the
 * WASM build is several times slower, so it is a way to keep working, not a way
 * to serve traffic.
 *
 * ## And why it LOGS rather than refuses
 *
 * A production box on the WASM path is misconfigured, but its output is
 * correct — just slow. Refusing to boot would turn a performance problem into
 * an outage, so the answer is volume, not a veto: an ERROR in production and a
 * one-line note everywhere else. The thing that must never happen is the
 * fallback becoming the production path SILENTLY, and it cannot now.
 */

/** The two backends sharp can end up on, plus the case we could not determine. */
export type SharpBackend = 'native' | 'wasm' | 'unknown';

/**
 * The `@img/sharp-<target>` package a resolved path belongs to, if any.
 *
 * Matched on the PACKAGE directory rather than on a `.node` suffix. The WASM
 * build is reached through an exports map (`./sharp.node` -> `./index.cjs`) and
 * its addon file is called `sharp-wasm32-<version>.node.js`, so a filename test
 * finds the native addon and misses the WebAssembly one — reporting `unknown`
 * on precisely the machine this whole mechanism exists for.
 */
const SHARP_PACKAGE = /[\\/]@img[\\/](sharp-[^\\/]+)[\\/]/;

/**
 * Reads the backend out of the module cache.
 *
 * Requiring `sharp` leaves the resolved path of whatever it loaded in
 * `require.cache`, and that path names the package it came from. This is an
 * observation of what LOADED, which is the question; asking the resolver what
 * it *would* load answers a different one.
 *
 * A require that threw leaves nothing behind — Node drops a module from the
 * cache when its execution fails — so a fallback shows only the package that
 * answered, never the one that refused.
 *
 * Returns `unknown` rather than guessing if the layout ever changes, because a
 * detector that reports `native` when it cannot tell is worse than one that
 * admits it: the whole point of this file is to be believed.
 */
export function detectSharpBackend(): SharpBackend {
  for (const path of Object.keys(require.cache)) {
    const match = SHARP_PACKAGE.exec(path);

    if (match !== null) {
      return match[1] === 'sharp-wasm32' ? 'wasm' : 'native';
    }
  }

  return 'unknown';
}

/** What to say about a backend, and how loudly. */
export interface SharpBackendReport {
  readonly backend: SharpBackend;
  readonly level: 'log' | 'warn' | 'error';
  readonly message: string;
}

export function describeSharpBackend(
  backend: SharpBackend,
  isProduction: boolean,
): SharpBackendReport {
  if (backend === 'native') {
    return { backend, level: 'log', message: 'image processing: sharp native backend' };
  }

  if (backend === 'unknown') {
    return {
      backend,
      level: 'warn',
      message:
        'image processing: could not determine which sharp backend loaded. Images will still ' +
        'be processed correctly; only this report is unreliable.',
    };
  }

  return {
    backend,
    level: isProduction ? 'error' : 'warn',
    message: isProduction
      ? 'image processing: sharp fell back to the WebAssembly backend (@img/sharp-wasm32). ' +
        'THIS IS NOT A PRODUCTION CONFIGURATION — the native addon for this platform failed ' +
        'to load, and uploads will be several times slower. Output is still correct. Install ' +
        `@img/sharp-${process.platform}-${process.arch} and restart.`
      : 'image processing: sharp is using the WebAssembly backend (@img/sharp-wasm32) because ' +
        'the native addon would not load here. Output is identical; uploads are slower.',
  };
}
