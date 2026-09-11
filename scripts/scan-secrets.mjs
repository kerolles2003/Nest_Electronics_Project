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
  // The shape AGENTS.md §"Supabase MCP" tells a reader to paste a real password
  // into, and the one actually sitting in the working tree: `.mcp.json` is
  // gitignored and has never been committed, but its sibling `.mcp.json.example`
  // IS tracked, and the two differ by one field. Without this pattern, pasting
  // into the wrong one of them commits a live credential with the gate green.
  //
  // The lookaheads keep the blobs already in history green, and they are the
  // whole reason this pattern can exist without turning the check permanently
  // red: `YOUR_DB_PASSWORD` in .mcp.json.example and AGENTS.md, the literal
  // `user:pass@` in WORK-LOG.md and docs/phase-2/PHASE-2.4-REPORT.md, and the
  // password-less `postgres://localhost/db` in the scratch-database tests.
  [
    'postgres uri with password',
    /postgres(ql)?:\/\/(?!YOUR_|<|user:pass)[^:@/\s"']+:(?!YOUR_|<|pass@)[^@/\s"']+@/,
    cat('postgresql:', '//', 'appuser:S3cr3tPassw0rd@db.example.supabase.co:5432/postgres'),
  ],
  ['aws access key', /AKIA[0-9A-Z]{16}/, cat('AKIA', 'IOSFODNN7EXAMPLE')],
  [
    'private key block',
    /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
    cat('-----', 'BEGIN RSA PRIVATE KEY', '-----'),
  ],
  ['github token', /gh[pousr]_[A-Za-z0-9]{30,}/, cat('ghp', '_', ALNUM)],
  /*
   * npm publish tokens, in both shapes they appear in.
   *
   * Added after one was found in the machine's GLOBAL ~/.npmrc — outside this
   * repository, and so never something this scanner had a chance to catch. That
   * is the point: it had no chance because it had no pattern. A `.npmrc`
   * committed by anyone, or a token pasted into a workflow, would have passed
   * fifteen clean patterns and been published.
   *
   * The second entry is the assignment rather than the token shape, because a
   * private registry's token is not `npm_`-prefixed and would otherwise be
   * invisible. `${...}`, `REPLACE_` and `YOUR_` are excluded: those are the
   * indirection this repository already requires, not a credential.
   */
  ['npm token', /\bnpm_[A-Za-z0-9]{30,}/, cat('npm', '_', ALNUM)],
  [
    'npmrc auth token',
    /_authToken[\s]*=[\s]*['"]?(?!\$\{|REPLACE_|YOUR_|<)[A-Za-z0-9_.=+/-]{16,}/,
    cat('//registry.npmjs.org/:_authToken', '=', ALNUM),
  ],
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

/**
 * Each pattern must detect a fake secret of its own class, or the build fails.
 *
 * Returns the number of patterns proven, or `null` if any failed — the caller
 * sets the exit code and returns rather than calling `process.exit()` here. On
 * Windows `process.stderr` is asynchronous for pipes, so exiting in the same
 * tick as the write can truncate or lose the message entirely, and the message
 * is the whole point: an exit code alone does not say WHICH pattern went blind.
 */
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
    return null;
  }

  return PATTERNS.length;
}

/**
 * `--file <path>`: scan ONE working-tree file and stop.
 *
 * For checking something BEFORE it becomes a blob, which is the only moment a
 * secret is still cheap to remove. Once it is committed and pushed the blob is
 * in the history permanently and rotation is the only remedy, so this is the
 * cheap half of the same job the CI scan does expensively.
 *
 * Two uses it is actually for: a file you are about to `git add` that came from
 * somewhere else — a vendored bundle, a pasted config, a downloaded fixture —
 * and a gitignored file you want to confirm is still gitignored-for-a-reason.
 * Run it as `pnpm secrets:scan-file <path>`.
 *
 * It is NOT how this file proves it does not trip its own patterns. That is
 * done by the full scan, which reads `scripts/scan-secrets.mjs` as an ordinary
 * blob like every other — see the note on `cat` above for why that risk is real
 * and not hypothetical.
 */
function scanOneFile(path) {
  const proven = selfTest();
  if (proven === null) return false;

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
    process.stderr.write(
      '\nDo not commit this file. If it is already staged, unstage it; if the value is\n' +
        'real, treat it as compromised the moment it reaches a remote.\n',
    );
    return false;
  }

  process.stdout.write(
    `secret scan: ${path} is clean (${proven} patterns, each proven against its own canary).\n`,
  );
  return true;
}

async function main() {
  const fileFlag = process.argv.indexOf('--file');
  if (fileFlag !== -1 && process.argv[fileFlag + 1] !== undefined) {
    if (!scanOneFile(process.argv[fileFlag + 1])) process.exitCode = 1;
    return;
  }

  const proven = selfTest();
  if (proven === null) {
    process.exitCode = 1;
    return;
  }

  const objects = git(['rev-list', '--objects', '--all']).split('\n');

  // oid -> every path the blob is reachable at, not just one.
  //
  // `rev-list --objects` emits a blob once per (commit, path) pair, so a single
  // blob legitimately has several paths: a `.env` copied to a backup, a snippet
  // duplicated into a doc. Keeping only the last one git happened to print
  // means a finding names a file that need not contain the secret — and the
  // first thing somebody reading "rotate first" does is open that file, find
  // nothing at HEAD, and decide the report was spurious.
  const paths = new Map();

  for (const line of objects) {
    const space = line.indexOf(' ');
    if (space <= 0) continue;

    const oid = line.slice(0, space);
    if (!paths.has(oid)) paths.set(oid, new Set());
    paths.get(oid).add(line.slice(space + 1));
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
    process.exitCode = 1;
    return;
  }

  const findings = [];
  const allowed = [];

  // How many blob bodies were actually READ, and any header that could not be
  // turned into one. Both are reported below, because the number of blobs this
  // scan intended to read and the number it managed to read are different
  // facts, and only the second one says anything about whether it is clean.
  let parsed = 0;
  const unreadable = [];

  await new Promise((resolve, reject) => {
    const cat = spawn('git', ['cat-file', '--batch'], { stdio: ['pipe', 'pipe', 'inherit'] });
    let buffer = Buffer.alloc(0);

    cat.stdout.on('data', (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);

      for (;;) {
        const newline = buffer.indexOf(0x0a);
        if (newline === -1) return;

        const header = buffer.subarray(0, newline).toString('utf8');
        const [oid, type, sizeText] = header.split(' ');
        const size = Number(sizeText);

        if (type !== 'blob' || Number.isNaN(size)) {
          // `<oid> missing`, or any header this cannot act on. Every oid written
          // to this process came from `--batch-check --batch-all-objects`, so an
          // unreadable one is an anomaly — a partial clone, an object pruned
          // between the two git calls — and NOT a line to shrug off. Record it
          // and fail after the stream closes, rather than silently scanning
          // fewer blobs than the summary will claim.
          unreadable.push(header);
          buffer = buffer.subarray(newline + 1);
          continue;
        }

        const end = newline + 1 + size + 1;
        if (buffer.length < end) return;

        const body = buffer.subarray(newline + 1, newline + 1 + size);
        buffer = buffer.subarray(end);
        parsed += 1;

        // Binary blobs hold no credentials worth grepping and produce noise.
        if (!body.includes(0x00)) {
          const text = body.toString('utf8');

          for (const [name, regex] of PATTERNS) {
            const match = text.match(regex);
            if (match === null) continue;

            const where = paths.get(oid);
            const record = {
              oid,
              paths: where === undefined ? ['(unknown)'] : [...where],
              name,
              match: match[0],
            };
            if (ALLOWLIST.has(oid)) allowed.push(record);
            else findings.push(record);
          }
        }
      }
    });

    // Terminated by EOF, not by a count of what was parsed.
    //
    // This used to close stdin only once it had parsed `blobs.length` bodies,
    // which meant one header it could not parse — a single `missing` line —
    // left stdin open, git waiting for input that never came, and this promise
    // never settling. The job produced no output at all and ran until the
    // Actions timeout killed it. Writing the whole list and closing immediately
    // lets git read to EOF and exit on its own, so no count can strand it.
    cat.on('close', (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(
        new Error(
          `git cat-file --batch exited ${code} after reading ${parsed} of ${blobs.length} blobs`,
        ),
      );
    });
    cat.on('error', reject);
    cat.stdin.on('error', () => {});
    cat.stdin.end(`${blobs.join('\n')}\n`);
  });

  // A scan that read less than it queued has not scanned the repository, and
  // reporting "clean" for it is the exact failure this whole check exists to
  // prevent — see the header. The shallow-clone guard above cannot see this
  // case, because there the blob list is empty rather than short.
  if (unreadable.length > 0 || parsed !== blobs.length) {
    process.stderr.write(
      `secret scan: INCOMPLETE — read ${parsed} of ${blobs.length} blobs.\n\n` +
        unreadable.slice(0, 5).map((h) => `  unreadable: ${h}\n`).join('') +
        (unreadable.length > 5 ? `  … and ${unreadable.length - 5} more\n` : '') +
        '\nThis is NOT a clean result. Every object came from --batch-all-objects, so\n' +
        'git should have been able to read all of them; a short read means the scan\n' +
        'looked at less of the history than it was asked to and cannot vouch for the\n' +
        'rest. Check for a partial or promisor clone, then re-run.\n',
    );
    process.exitCode = 1;
    return;
  }

  // One line per allowlisted BLOB, not per pattern it trips. The scanner's own
  // historical blob matches all fifteen, and printing the same paragraph
  // fifteen times is how a green log becomes one nobody reads.
  const byBlob = new Map();

  for (const entry of allowed) {
    if (!byBlob.has(entry.oid)) byBlob.set(entry.oid, { paths: entry.paths, names: [] });
    byBlob.get(entry.oid).names.push(entry.name);
  }

  for (const [oid, { paths: where, names }] of byBlob) {
    process.stdout.write(
      `secret scan: allowlisted — ${where.join(', ')} ` +
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
      // EVERY path, because the blob may be reachable at several and the one
      // git printed last is not necessarily where it was introduced — nor need
      // it still exist at HEAD, which is the case this scanner is for.
      const where =
        f.paths.length === 1
          ? f.paths[0]
          : `${f.paths.length} paths — ${f.paths.join(', ')}`;
      process.stderr.write(`  ${f.name}\n    in: ${where}\n    blob: ${f.oid}\n    value: ${shown}\n\n`);
    }

    process.stderr.write(
      'Do NOT "fix" this by deleting the file: the blob stays in the history and\n' +
        'the history is what gets cloned. Pushing is irreversible, so treat the\n' +
        'credential as compromised and ROTATE it. Then decide, with the owner,\n' +
        'whether to rewrite history or to record it as inert in SECURITY.md and\n' +
        'add the blob SHA to the allowlist in this file.\n',
    );
    process.exitCode = 1;
    return;
  }

  // `parsed`, not `blobs.length`: the count of blobs actually read, which is the
  // only one that makes this sentence true. They are equal by the check above —
  // printing the verified number is what keeps them honest if that ever changes.
  process.stdout.write(
    `secret scan: clean — ${parsed} blobs across every ref, ` +
      `${proven} patterns each proven against its own canary this run.\n`,
  );
}

main().catch((error) => {
  process.stderr.write(`secret scan failed to run: ${String(error)}\n`);
  process.exit(1);
});
