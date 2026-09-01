#!/usr/bin/env node
/**
 * Runs the Cloudinary integration suite, and nothing else.
 *
 *   pnpm --filter api test:cloudinary
 *
 * ## Why a script rather than `CLOUDINARY_INTEGRATION=1 jest ...`
 *
 * That form is a shell-ism: it works in bash and is a syntax error in `cmd`,
 * which is what pnpm uses on Windows. The alternative is a `cross-env`
 * dependency added for one line. Six lines of Node cost less and behave the
 * same everywhere.
 *
 * ## Why the suite is opt-in at all
 *
 * It makes real, authenticated calls to the owner's Cloudinary account. Running
 * that from `pnpm test` would upload from every developer's machine on every
 * run, fail wherever there is no network, and bill the owner for CI — the media
 * form of the 225 live email sends F-07 found. The default suite proves the
 * same pipeline against the in-memory adapter; this proves the vendor behind it.
 */
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

/**
 * Loads `.env` into this process, so the spec can read the credentials.
 *
 * Jest does not run `ConfigModule`, and nothing else puts `CLOUDINARY_*` into
 * `process.env`. Parsed here rather than with `dotenv`, which is not a direct
 * dependency of this package — eight lines against a new dependency for one
 * script.
 *
 * `.env.local` wins over `.env`, matching `ConfigModule`'s own order, so a
 * developer pointing at their own sandbox account is not overridden.
 */
function loadEnvFile(file) {
  if (!fs.existsSync(file)) return;

  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (match === null || line.trimStart().startsWith('#')) continue;

    const [, key, raw] = match;
    if (process.env[key] !== undefined) continue;

    process.env[key] = raw.trim().replace(/^['"]|['"]$/g, '');
  }
}

for (const file of ['.env.local', '.env']) {
  loadEnvFile(path.join(__dirname, '..', file));
}

if (process.env.CLOUDINARY_CLOUD_NAME === undefined) {
  process.stderr.write(
    'No CLOUDINARY_* credentials found in apps/api/.env or the environment.\n' +
      'This suite makes real calls and cannot run without them.\n',
  );
  process.exit(1);
}

const result = spawnSync(
  process.execPath,
  [
    path.join(__dirname, '..', 'node_modules', 'jest', 'bin', 'jest.js'),
    'test/media/cloudinary-integration',
    // One at a time and no bail: every case cleans up after itself, and a
    // failure part-way through must still let the later cleanup run.
    '--runInBand',
    ...process.argv.slice(2),
  ],
  {
    cwd: path.join(__dirname, '..'),
    stdio: 'inherit',
    env: { ...process.env, CLOUDINARY_INTEGRATION: '1' },
  },
);

process.exit(result.status ?? 1);
