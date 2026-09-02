import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * Does this value appear, verbatim, anywhere in this repository?
 *
 * ## Why a provisioning command needs to ask
 *
 * This engagement has already found a JWT signing key that shipped in
 * `.env.example` and **passed its own validator**, because the placeholder was
 * 57 characters and the rule was "at least 32". Every machine that skipped the
 * setup step signed tokens with a key anybody could read.
 *
 * The lesson is not "write a longer placeholder". It is that a value nothing
 * rejects IS a default, whatever it is called — and the only check that cannot
 * be satisfied by a sufficiently impressive-looking string is one that asks
 * whether the value is already written down.
 *
 * So the staff provisioning path asks. A password an operator types is refused
 * if it appears in a tracked file, and the refusal names the files.
 *
 * ## The value never leaves this process
 *
 * `test/infrastructure/secret-hygiene.spec.ts` does the same search with
 * `git grep -F -e <value>`, which is right there: it is scanning values that
 * are already in the environment, and it is far faster.
 *
 * Here the value is a password a human just typed, so it must not become a
 * subprocess ARGUMENT — `ps` on a shared machine would show it, and so would a
 * shell history if anybody wrapped the command. `git` is therefore asked only
 * for the LIST of tracked files, and the comparison happens in memory.
 *
 * Nothing here ever prints or returns the value. Callers get file paths.
 */

/** Files that cannot usefully contain a typed password, and are large. */
const SKIP_EXTENSIONS: ReadonlySet<string> = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif', '.ico', '.svg',
  '.woff', '.woff2', '.ttf', '.otf', '.eot',
  '.pdf', '.zip', '.gz', '.mp4', '.webm', '.wasm',
]);

/**
 * Above this, a file is skipped.
 *
 * `pnpm-lock.yaml` alone is 375 KB and there is a 40 KB seed-data module; the
 * cap is well above both. It exists so a large committed fixture cannot turn a
 * one-off command into a minute of I/O, not because big files are exempt in
 * principle.
 */
const MAX_FILE_BYTES = 4 * 1024 * 1024;

/** Thrown when the repository cannot be enumerated, so the answer is UNKNOWN. */
export class RepositoryNotScannableError extends Error {
  constructor(readonly detail: string) {
    super(`the repository could not be scanned: ${detail}`);
    this.name = 'RepositoryNotScannableError';
  }
}

/**
 * The repository root, found by walking up for the workspace marker.
 *
 * Derived rather than configured: a path in an environment variable is a path
 * that can be pointed at an empty directory, and this check passing vacuously
 * is precisely the failure mode it exists to prevent.
 */
function repositoryRoot(): string {
  let current = resolve(__dirname, '..', '..', '..');

  for (let depth = 0; depth < 8; depth += 1) {
    if (existsSync(join(current, 'pnpm-workspace.yaml'))) return current;

    const parent = resolve(current, '..');
    if (parent === current) break;
    current = parent;
  }

  throw new RepositoryNotScannableError(
    'no pnpm-workspace.yaml was found above this module, so this is not a checkout',
  );
}

/**
 * Every path git would consider part of this repository. The only thing a
 * subprocess is asked for.
 *
 * `--cached --others --exclude-standard` — committed files AND untracked ones
 * that are not ignored. The untracked half matters: a password being added to
 * a seed module or a document is, at the moment somebody runs this command,
 * very often still uncommitted. `--cached` alone answered "clean" for exactly
 * that case, which was found by the test that provisions with the development
 * admin's own password before it was committed.
 *
 * `--exclude-standard` is what keeps `.env`, `node_modules`, `dist` and
 * `.next` out: they are ignored, so they are not "in the repository" in the
 * sense that matters here — nothing in them is published to a reader of the
 * code.
 */
function trackedFiles(root: string): string[] {
  let output: string;

  try {
    output = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], {
      cwd: root,
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
    });
  } catch (error) {
    throw new RepositoryNotScannableError(
      `git ls-files failed (${error instanceof Error ? error.message : String(error)})`,
    );
  }

  const files = output.split('\0').filter((path) => path.length > 0);

  if (files.length === 0) {
    // An empty answer is not "clean" — it is a scan that examined nothing, and
    // reporting it as clean is how a guard passes vacuously.
    throw new RepositoryNotScannableError('git reported no files');
  }

  // `--cached` and `--others` can both name a path in some states; a duplicate
  // would only mean reading one file twice, but it would also double-count it
  // in a refusal's file list, which reads like two leaks.
  return [...new Set(files)];
}

/**
 * Tracked files containing `value`, or `[]`.
 *
 * Throws `RepositoryNotScannableError` when the repository cannot be read.
 * That is deliberately NOT the same as "clean": a caller enforcing a security
 * rule must be able to tell "I looked and found nothing" from "I could not
 * look", and only one of those is a reason to proceed.
 */
export function trackedFilesContaining(value: string): string[] {
  if (value.length === 0) return [];

  const root = repositoryRoot();
  const matches: string[] = [];

  for (const relative of trackedFiles(root)) {
    const dot = relative.lastIndexOf('.');
    if (dot !== -1 && SKIP_EXTENSIONS.has(relative.slice(dot).toLowerCase())) continue;

    const absolute = join(root, relative);

    try {
      if (statSync(absolute).size > MAX_FILE_BYTES) continue;

      const contents = readFileSync(absolute, 'utf8');

      // A NUL in the first block means binary; `readFileSync` as utf8 would
      // have produced replacement characters rather than a useful comparison.
      if (contents.slice(0, 8192).includes('\0')) continue;

      if (contents.includes(value)) matches.push(relative);
    } catch {
      /*
       * A tracked path that cannot be read right now — deleted in the working
       * tree, a permission problem, a symlink to nowhere. Skipped rather than
       * fatal: one unreadable file must not make the whole check unavailable,
       * and the enumeration itself succeeded, which is what separates this
       * from the `RepositoryNotScannableError` above.
       */
      continue;
    }
  }

  return matches;
}
