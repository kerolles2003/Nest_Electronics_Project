import { afterAll, describe, expect, it } from '@jest/globals';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * No live credential value may reach a committed file.
 *
 * ## The incident this exists to prevent recurring
 *
 * A test asserted `expect(process.env['CLOUDINARY_API_KEY']).toBeUndefined()`.
 * It was written when no Cloudinary account existed, encoding one machine's
 * temporary state as a permanent property. The moment the account was supplied
 * it failed — and **jest printed the API key into the failure output**, from
 * where it would have reached any CI log holding it.
 *
 * The audit that followed found nothing in git. That is the outcome to keep, and
 * "we were careful" is not a mechanism.
 *
 * ## What this checks, and what it deliberately does not
 *
 * It checks that no credential VALUE appears in any git-tracked file. That is
 * the property that matters: `WORK-LOG.md`, `HANDOFF.md`, `docs/`, fixtures,
 * snapshots and the OpenAPI artifact are all tracked, so all of them are
 * covered without listing any of them.
 *
 * It does NOT try to parse test sources for risky-looking expressions. A rule
 * like "no `expect()` near a secret name" is easy to write, easy to work
 * around, and would have passed the original defect anyway — the assertion
 * there was on `toBeUndefined()`, which looks entirely harmless. Checking the
 * outcome rather than the shape is the check that cannot be fooled.
 *
 * ## Nothing here ever prints a value
 *
 * A guard that reports "found SECRET_X = abc123 in file.md" would leak the
 * value into exactly the place it is trying to keep clean — a CI log. Every
 * failure names the VARIABLE, the FILE and the LINE NUMBERS, and nothing else.
 */

const REPO_ROOT = resolve(__dirname, '../../../..');

/**
 * A variable name whose value must never be committed.
 *
 * Pattern-based rather than a hand-maintained list, so a `STRIPE_SECRET_KEY`
 * added next year is covered on the day it is added rather than on the day
 * somebody remembers to extend an array.
 */
const SECRET_NAME = /(SECRET|API_KEY|PASSWORD|PASSWD|TOKEN|CREDENTIAL|PRIVATE_KEY)/;

/**
 * Names that do not match the pattern but are still worth keeping out of the
 * repository.
 *
 * `CLOUDINARY_CLOUD_NAME` is not a secret — it appears in every delivery URL —
 * but the account is shared with an unrelated application, so committing it
 * publishes which account this shop uses. Cheap to keep out.
 */
const ALSO_SECRET = new Set(['CLOUDINARY_CLOUD_NAME']);

/**
 * Names that MATCH the pattern but carry no secret.
 *
 * `CLOUDINARY_INTEGRATION` is an opt-in flag whose value is `1`; scanning the
 * repository for `1` would report every file in it.
 */
const NOT_SECRET = new Set(['CLOUDINARY_INTEGRATION', 'AUTH_REQUIRE_EMAIL_VERIFICATION']);

/** Shortest value worth searching for. Below this, matches are meaningless. */
const MIN_LENGTH = 8;

interface Candidate {
  readonly name: string;
  readonly value: string;
}

/**
 * Every credential value available to this process, from the environment file
 * and from the real environment.
 *
 * Both, because they are populated differently: a developer has `.env`, and CI
 * has real environment variables and no file. A guard that read only one of
 * them would pass vacuously in exactly the place it matters most.
 */
function candidates(): Candidate[] {
  const found = new Map<string, string>();

  const add = (name: string, raw: string): void => {
    const value = raw.trim().replace(/^['"]|['"]$/g, '');

    if (value.length < MIN_LENGTH) return;
    if (NOT_SECRET.has(name)) return;
    if (!SECRET_NAME.test(name) && !ALSO_SECRET.has(name) && name !== 'MONGODB_URI') return;

    /*
     * A connection string is only a secret when it carries credentials. The
     * development URI is `mongodb://127.0.0.1:27017/…` and appears in
     * `.env.example` and the sandbox guide ON PURPOSE — reporting it would
     * train whoever reads this failure to ignore it, which is how a real
     * finding gets waved through.
     */
    if (name === 'MONGODB_URI' && !/^mongodb(\+srv)?:\/\/[^/@]+@/.test(value)) return;

    found.set(name, value);
  };

  for (const file of ['apps/api/.env', 'apps/api/.env.local']) {
    const path = join(REPO_ROOT, file);
    if (!existsSync(path)) continue;

    for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
      const match = /^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*)$/.exec(line);
      if (match !== null && !line.trimStart().startsWith('#')) {
        add(match[1] as string, match[2] as string);
      }
    }
  }

  for (const [name, value] of Object.entries(process.env)) {
    if (value !== undefined) add(name, value);
  }

  return [...found].map(([name, value]) => ({ name, value }));
}

/**
 * Tracked files containing `value`, with the line numbers, or `[]`.
 *
 * `git grep` rather than a manual walk: it already knows what is tracked, it is
 * far faster than reading the tree in JavaScript, and `-F` with an argument
 * array means a value containing regex or shell metacharacters is searched for
 * literally and never interpreted.
 */
function trackedFilesContaining(value: string): string[] {
  try {
    const output = execFileSync(
      'git',
      ['grep', '--fixed-strings', '--no-color', '-I', '--line-number', '-e', value],
      { cwd: REPO_ROOT, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 },
    );

    // `path:line:content` — the content is DISCARDED before it can be printed.
    return output
      .split('\n')
      .filter((line) => line.length > 0)
      .map((line) => line.split(':').slice(0, 2).join(':'));
  } catch (error) {
    // git grep exits 1 when it matches nothing, which is the good case.
    const status = (error as { status?: number }).status;
    if (status === 1) return [];

    throw error;
  }
}

describe('no live credential reaches a committed file', () => {
  it('finds at least one credential to check, or says so', () => {
    /*
     * Guards against the worst failure mode of a guard: passing because it had
     * nothing to look for. On a machine with no `.env` and no secrets in the
     * environment this test still passes — but it prints that fact, so a green
     * run cannot be mistaken for a verified one.
     */
    const values = candidates();

    if (values.length === 0) {
      console.warn(
        'secret-hygiene: no credentials available in .env or the environment — ' +
          'this run verified NOTHING. Expected on a fresh checkout; not expected on a ' +
          'developer machine.',
      );
    }

    expect(values.every((candidate) => candidate.value.length >= MIN_LENGTH)).toBe(true);
  });

  it('actually detects a value it is given — the canary', () => {
    /*
     * A scanner that has never been shown to detect anything is worth nothing,
     * and this one reports "clean" on every ordinary run. So it is pointed at a
     * file that definitely contains a value, and must find it.
     *
     * The canary is written INSIDE the repository because `git grep` searches
     * tracked files — and an untracked file is not tracked, so `--untracked` is
     * passed for this case only. The value is a fabricated string that is not a
     * credential of anything.
     */
    const canaryValue = 'zz-canary-not-a-real-secret-9f3a2b1c';
    const canaryPath = join(REPO_ROOT, 'apps/api/zz-secret-hygiene-canary.tmp');

    writeFileSync(canaryPath, `value = ${canaryValue}\n`, 'utf8');

    try {
      const output = execFileSync(
        'git',
        [
          'grep',
          '--fixed-strings',
          '--untracked',
          '--no-color',
          '-I',
          '--line-number',
          '-e',
          canaryValue,
        ],
        { cwd: REPO_ROOT, encoding: 'utf8' },
      );

      expect(output).toContain('zz-secret-hygiene-canary.tmp');
    } finally {
      rmSync(canaryPath, { force: true });
    }

    // And the canary is gone, so it cannot be committed by the next `git add`.
    expect(existsSync(canaryPath)).toBe(false);
  });

  it('finds no credential value in any tracked file', () => {
    const leaks: { name: string; locations: string[] }[] = [];

    for (const candidate of candidates()) {
      const locations = trackedFilesContaining(candidate.value);

      if (locations.length > 0) {
        leaks.push({ name: candidate.name, locations: locations.slice(0, 20) });
      }
    }

    /*
     * The VARIABLE, the FILE and the LINE. Never the value — a guard that
     * printed what it found would put the credential into the CI log it exists
     * to keep clean.
     */
    expect(
      leaks.map((leak) => `${leak.name} appears in: ${leak.locations.join(', ')}`),
    ).toEqual([]);
  });
});

afterAll(() => {
  // Belt and braces: if a case above threw between writing and removing, the
  // canary must still not survive into somebody's next commit.
  rmSync(join(REPO_ROOT, 'apps/api/zz-secret-hygiene-canary.tmp'), { force: true });
});
