#!/usr/bin/env node
import { spawn, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

/**
 * The secret scanner. Blocking check — a finding fails the build.
 *
 * Authority: SECURITY.md.
 *
 * ## Why this is a CI job and not a habit
 *
 * It found a live `ANTHROPIC_API_KEY` on its first real run — committed in the
 * INITIAL commit, deleted from the tree four months later, still reachable from
 * every branch, and already sitting on the remote. An audit roughly forty
 * commits earlier had called the repository clean. Nobody was careless; a
 * manual audit is just a thing you have to remember to do, and the one time it
 * is skipped is the time it was needed.
 *
 * Pushing is irreversible. Once a credential reaches a remote, rotating it is
 * the only remedy, and the window between "committed" and "noticed" is the
 * whole risk. This closes that window to one CI run.
 *
 * ## It scans CONTENTS, over every blob on every ref
 *
 * Not filenames — the key that was found lived in a file called `test.md`. Not
 * the tip tree either: deleting a secret does nothing, because the blob stays
 * in the history and the history is what gets cloned. Every blob reachable
 * from every ref is the only scope that means anything.
 *
 * This needs full history. In Actions that means `fetch-depth: 0`; with the
 * default shallow clone the scan would pass by finding nothing to look at,
 * which is the worst possible way for it to pass.
 *
 * ## It proves itself before it trusts itself, every run
 *
 * `selfTest()` runs each pattern against a fake secret of its own class and
 * fails the build if any pattern does not fire. A scanner that has never found
 * anything is indistinguishable from one that cannot.
 *
 * That is not hypothetical here. Writing this, the private-key pattern reported
 * a MISS because the shell parsed its leading `-----` as command-line options —
 * the pattern was right and the harness was wrong, and only a canary could tell
 * the difference. A separate hole was worse: an early version of the needle
 * extraction filtered out digit-only values as noise, which would have excluded
 * `CLOUDINARY_API_KEY` — a 15-digit number — from the scan entirely, and
 * produced a clean result that looked exactly like a real one.
 */

/**
 * Joins the pieces of a canary sample.
 *
 * Every sample below is written in FRAGMENTS and assembled here at runtime,
 * which looks like an affectation and is not. This file is itself a blob in the
 * repository, so it is scanned like every other blob — and the first version of
 * it, with the samples written out as ordinary string literals, matched all
 * fifteen of its own patterns the moment it was committed. The scan went red
 * and stayed red, pointing at the scanner.
 *
 * That is the exact failure this whole check is supposed to prevent: a gate
 * that is permanently red is a gate everybody learns to skip, and one that
 * cries wolf about itself teaches the habit fastest.
 *
 * Splitting each sample at a point the pattern requires to be contiguous — the
 * `//` in a URI, the `=` after a key name, the prefix of a token — means the
 * assembled VALUE still exercises the pattern exactly as a real secret would,
 * while the source TEXT contains no substring that matches anything. The canary
 * is undiminished; only its storage changed.
 *
 * If you add a pattern, add its sample the same way, and check the scan is
 * still green against this file.
 */
const cat = (...parts) => parts.join('');

const HEX16 = '0123456789abcdef';
const ALNUM = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

const PATTERNS = [
  // [name, regex, a fake sample of this class that MUST be detected]
  [
    'cloudinary url',
    /cloudinary:\/\/[0-9]{6,}:[A-Za-z0-9_-]{10,}@[A-Za-z0-9_-]+/,
    cat('cloudinary:', '//', '123456789012345:AbCdEfGhIjKlMnOpQrStUvWxYz0@democloud'),
  ],
  [
    'cloudinary api secret',
    /CLOUDINARY_API_SECRET[\s]*[:=][\s]*['"]?(?!YOUR_|REPLACE_|<)[A-Za-z0-9_-]{20,}/,
    cat('CLOUDINARY_API_SECRET', '=AbCdEfGhIjKlMnOpQrStUvWxYz0'),
  ],
  [
    'cloudinary api key',
    /CLOUDINARY_API_KEY[\s]*[:=][\s]*['"]?(?!YOUR_|REPLACE_|<)[0-9]{12,}/,
    cat('CLOUDINARY_API_KEY', '=123456789012345'),
  ],
  [
    'brevo api key',
    /xkeysib-[0-9a-f]{40,}-[A-Za-z0-9]{10,}/,
    cat('xkeysib', '-', HEX16.repeat(4), '-AbCdEfGhIjKlMnOp'),
  ],
  [
    'brevo smtp key',
    /xsmtpsib-[0-9a-f]{40,}-[A-Za-z0-9]{10,}/,
    cat('xsmtpsib', '-', HEX16.repeat(4), '-AbCdEfGhIjKlMnOp'),
  ],
  [
    'jwt / session token',
    /eyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/,
    cat(
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9',
      '.',
      'eyJzdWIiOiIxMjM0NTY3ODkwIn0',
      '.',
      'dBjftJeZ4CVPmB92K27uhbUJU1p1r3wa',
    ),
  ],
  [
    'mongo uri with password',
    /mongodb(\+srv)?:\/\/(?!YOUR_|<|user:pass)[^:@/\s"']+:(?!YOUR_|<|pass@|p%40ss@)[^@/\s"']+@/,
    cat('mongodb+srv:', '//', 'appuser:S3cr3tPassw0rd@cluster0.abcde.mongodb.net/db'),
  ],
  ['aws access key', /AKIA[0-9A-Z]{16}/, cat('AKIA', 'IOSFODNN7EXAMPLE')],
  [
    'private key block',
    /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
    cat('-----', 'BEGIN RSA PRIVATE KEY', '-----'),
  ],
  ['github token', /gh[pousr]_[A-Za-z0-9]{30,}/, cat('ghp', '_', ALNUM)],
  [
    'openai / anthropic style key',
    /\bsk-(?:ant-)?[A-Za-z0-9_-]{20,}/,
    cat('sk', '-', ALNUM, 'abcd'),
  ],
  ['stripe live key', /\b[ps]k_live_[A-Za-z0-9]{16,}/, cat('sk', '_live_', ALNUM)],
  [
    'signed url',
    /X-Amz-Signature=[0-9a-f]{32,}/,
    cat('https://x/y?X-Amz-Signature', '=', HEX16.repeat(4)),
  ],
  [
    'jwt secret',
    /JWT_SECRET[\s]*[:=][\s]*['"]?(?!REPLACE_|YOUR_|<)[A-Za-z0-9+/=_-]{24,}/,
    cat('JWT_SECRET', '=Zm9vYmFyYmF6cXV4MTIzNDU2Nzg5MA=='),
  ],
  [
    'session secret',
    /SESSION_SECRET[\s]*[:=][\s]*['"]?(?!REPLACE_|YOUR_|<)[A-Za-z0-9+/=_-]{24,}/,
    cat('SESSION_SECRET', '=Zm9vYmFyYmF6cXV4MTIzNDU2Nzg5MA=='),
  ],
];

/**
 * Blobs that are known, recorded, and dealt with.
 *
 * An allowlist is a liability, so it is keyed on the blob's SHA — the content
 * itself, not a path or a pattern. Nothing else in the repository is excused,
 * and a single edited byte produces a new blob that is NOT on this list and
 * fails the build.
 *
 * A permanently-red check gets ignored, which is the only outcome worse than
 * not having one. The entry below exists so this scanner can be green and mean
 * it — see SECURITY.md for what was rotated and when.
 */
const ALLOWLIST = new Map([
  /*
   * The ANTHROPIC_API_KEY blob (826d18a…) was here, and is deliberately gone.
   *
   * This repository's history was rewritten once, before its first push, to
   * remove `apps/admin/src/test.md` entirely — so there is no credential in any
   * commit to excuse. The entry was deleted with the blob rather than left
   * behind: an allowlist naming an object that no longer exists is a note that
   * cannot be verified, and it would quietly keep excusing that SHA if it ever
   * came back. See SECURITY.md.
   */
  [
    '37e824593b8b0a2d7c3354283cc84047f40486b5',
    'scripts/scan-secrets.mjs as first committed in 8eb46c3 — this scanner, back ' +
      'when its canary samples were written as plain string literals, so it ' +
      'matched all fifteen of its own patterns. Every value in it is a FAKE ' +
      'built for the self-test; none was ever a credential. The live version ' +
      'assembles them at runtime and is clean; this entry covers the one blob ' +
      'already in the history. Verify with: git cat-file blob 37e8245.',
  ],
]);

function git(args) {
  const out = spawnSync('git', args, { encoding: 'utf8', maxBuffer: 1024 * 1024 * 256 });
  if (out.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${out.stderr}`);
  return out.stdout;
}

/** Each pattern must detect a fake secret of its own class, or the build fails. */
function selfTest() {
  const broken = [];

  for (const [name, regex, sample] of PATTERNS) {
    if (!regex.test(sample)) broken.push(name);
  }

  if (broken.length > 0) {
    process.stderr.write(
      'secret scan: THE SCANNER IS BROKEN. These patterns did not detect their own canary:\n' +
        broken.map((n) => `  - ${n}\n`).join('') +
        '\nA scan that cannot find a planted secret cannot find a real one. Fixing the\n' +
        'pattern is the remedy; deleting the canary is not.\n',
    );
    process.exit(1);
  }

  return PATTERNS.length;
}

/**
 * `--file <path>`: scan ONE working-tree file and stop.
 *
 * For checking something before it becomes a blob, which is the only moment a
 * secret is still cheap to remove. It is also how this file proves it does not
 * trip its own patterns — see the note on `cat` above for why that is a real
 * risk and not a hypothetical one.
 */
function scanOneFile(path) {
  const proven = selfTest();
  const text = readFileSync(path, 'utf8');
  const hits = [];

  for (const [name, regex] of PATTERNS) {
    const match = text.match(regex);
    if (match !== null) hits.push({ name, match: match[0] });
  }

  if (hits.length > 0) {
    process.stderr.write(`secret scan: ${hits.length} match(es) in ${path}\n`);
    for (const h of hits) {
      process.stderr.write(`  ${h.name}: ${h.match.slice(0, 6)}…${h.match.slice(-2)}\n`);
    }
    process.exit(1);
  }

  process.stdout.write(
    `secret scan: ${path} is clean (${proven} patterns, each proven against its own canary).\n`,
  );
}

async function main() {
  const fileFlag = process.argv.indexOf('--file');
  if (fileFlag !== -1 && process.argv[fileFlag + 1] !== undefined) {
    scanOneFile(process.argv[fileFlag + 1]);
    return;
  }

  const proven = selfTest();

  const objects = git(['rev-list', '--objects', '--all']).split('\n');
  const paths = new Map();

  for (const line of objects) {
    const space = line.indexOf(' ');
    if (space > 0) paths.set(line.slice(0, space), line.slice(space + 1));
  }

  const checks = git(['cat-file', '--batch-check', '--batch-all-objects']).split('\n');
  const blobs = [];

  for (const line of checks) {
    const [oid, type, size] = line.split(' ');
    // Skip anything huge: lockfiles and images, never credentials, and reading
    // them is most of the runtime.
    if (type === 'blob' && paths.has(oid) && Number(size) < 2_000_000) blobs.push(oid);
  }

  if (blobs.length === 0) {
    process.stderr.write(
      'secret scan: no blobs to scan. This is a SHALLOW clone — the scan would\n' +
        'pass by looking at nothing. Set fetch-depth: 0 on actions/checkout.\n',
    );
    process.exit(1);
  }

  const findings = [];
  const allowed = [];

  await new Promise((resolve, reject) => {
    const cat = spawn('git', ['cat-file', '--batch'], { stdio: ['pipe', 'pipe', 'inherit'] });
    let buffer = Buffer.alloc(0);
    let index = 0;

    cat.stdout.on('data', (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);

      for (;;) {
        const newline = buffer.indexOf(0x0a);
        if (newline === -1) return;

        const header = buffer.subarray(0, newline).toString('utf8');
        const [oid, type, sizeText] = header.split(' ');
        const size = Number(sizeText);

        if (type !== 'blob' || Number.isNaN(size)) {
          // Not a blob header we can act on; drop the line and continue.
          buffer = buffer.subarray(newline + 1);
          continue;
        }

        const end = newline + 1 + size + 1;
        if (buffer.length < end) return;

        const body = buffer.subarray(newline + 1, newline + 1 + size);
        buffer = buffer.subarray(end);
        index += 1;

        // Binary blobs hold no credentials worth grepping and produce noise.
        if (!body.includes(0x00)) {
          const text = body.toString('utf8');

          for (const [name, regex] of PATTERNS) {
            const match = text.match(regex);
            if (match === null) continue;

            const record = { oid, path: paths.get(oid) ?? '(unknown)', name, match: match[0] };
            if (ALLOWLIST.has(oid)) allowed.push(record);
            else findings.push(record);
          }
        }

        if (index === blobs.length) cat.stdin.end();
      }
    });

    cat.on('close', () => resolve());
    cat.on('error', reject);
    cat.stdin.on('error', () => {});
    cat.stdin.write(`${blobs.join('\n')}\n`);
  });

  // One line per allowlisted BLOB, not per pattern it trips. The scanner's own
  // historical blob matches all fifteen, and printing the same paragraph
  // fifteen times is how a green log becomes one nobody reads.
  const byBlob = new Map();

  for (const entry of allowed) {
    if (!byBlob.has(entry.oid)) byBlob.set(entry.oid, { path: entry.path, names: [] });
    byBlob.get(entry.oid).names.push(entry.name);
  }

  for (const [oid, { path, names }] of byBlob) {
    process.stdout.write(
      `secret scan: allowlisted — ${path} ` +
        `(${names.length} pattern${names.length === 1 ? '' : 's'}: ${names.join(', ')})\n` +
        `  ${ALLOWLIST.get(oid)}\n`,
    );
  }

  if (findings.length > 0) {
    process.stderr.write(
      `\nsecret scan: ${findings.length} SECRET(S) FOUND IN HISTORY.\n\n`,
    );

    for (const f of findings) {
      // Redacted: the point is to name the credential, not to print it into a
      // build log that is itself readable by more people than the repository.
      const shown = `${f.match.slice(0, 6)}…${f.match.slice(-2)} (${f.match.length} chars)`;
      process.stderr.write(`  ${f.name}\n    in: ${f.path}\n    blob: ${f.oid}\n    value: ${shown}\n\n`);
    }

    process.stderr.write(
      'Do NOT "fix" this by deleting the file: the blob stays in the history and\n' +
        'the history is what gets cloned. Pushing is irreversible, so treat the\n' +
        'credential as compromised and ROTATE it. Then decide, with the owner,\n' +
        'whether to rewrite history or to record it as inert in SECURITY.md and\n' +
        'add the blob SHA to the allowlist in this file.\n',
    );
    process.exit(1);
  }

  process.stdout.write(
    `secret scan: clean — ${blobs.length} blobs across every ref, ` +
      `${proven} patterns each proven against its own canary this run.\n`,
  );
}

main().catch((error) => {
  process.stderr.write(`secret scan failed to run: ${String(error)}\n`);
  process.exit(1);
});
