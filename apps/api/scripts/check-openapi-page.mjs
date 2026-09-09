#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The drift gate for `docs/api/index.html`.
 *
 * Authority: PLAN.md Phase 3; docs/architecture/API-CONTRACT.md §8.
 *
 * ## Why this gate exists at all
 *
 * `docs/api/index.html` embeds a COPY of `docs/api/openapi.v1.json`. The whole
 * contract discipline in this repository rests on there being one document
 * that a client can be written against, and a second copy of it is exactly the
 * thing that rots: someone edits the page to fix a typo, or regenerates the
 * artifact and forgets the page, and now the browsable reference the mobile
 * developer actually reads describes an API that no longer exists. That is
 * worse than having no page, because it is believed.
 *
 * So the copy is held to the same rule as the artifact: any difference fails
 * the build.
 *
 * ## What it compares
 *
 * The PARSED documents, not the bytes. The generator escapes `<` on the way in,
 * which changes the text and not the document, and a byte comparison would
 * report drift on every run for a difference that does not exist. Comparing
 * parsed objects also means a hand-reformatted page still fails if — and only
 * if — its content actually differs.
 *
 * It deliberately does NOT boot the API. This gate is cheap, needs no database,
 * and answers a different question from `openapi:check`: that one asks whether
 * the artifact still matches the code, this one asks whether the page still
 * matches the artifact. Running it first means the cheap failure reports first.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const ARTIFACT = resolve(HERE, '../../../docs/api/openapi.v1.json');
const PAGE = resolve(HERE, '../../../docs/api/index.html');

const REBUILD = 'pnpm --filter api openapi:export';

function fail(message) {
  process.stderr.write(`openapi page gate: ${message}\n`);
  process.exitCode = 1;
}

let artifactRaw;
try {
  artifactRaw = readFileSync(ARTIFACT, 'utf8');
} catch {
  fail(`no artifact at docs/api/openapi.v1.json\n  Generate it with: ${REBUILD}`);
  process.exit();
}

let pageRaw;
try {
  pageRaw = readFileSync(PAGE, 'utf8');
} catch {
  fail(
    'docs/api/index.html is missing.\n' +
      `  It is generated, not written by hand. Run: ${REBUILD}`,
  );
  process.exit();
}

const match = pageRaw.match(
  /<script type="application\/json" id="openapi-spec">([\s\S]*?)<\/script>/,
);

if (match === null) {
  fail(
    'docs/api/index.html has no embedded spec block.\n' +
      '  The page must carry the contract inline — a page that FETCHES\n' +
      '  openapi.v1.json is blocked by the browser over file:// and cannot be\n' +
      `  read without a server. Run: ${REBUILD}`,
  );
  process.exit();
}

let embedded;
try {
  embedded = JSON.parse(match[1]);
} catch (error) {
  fail(
    `the embedded spec in docs/api/index.html is not valid JSON: ${String(error)}\n` +
      `  Run: ${REBUILD}`,
  );
  process.exit();
}

const artifact = JSON.parse(artifactRaw);

if (JSON.stringify(embedded) !== JSON.stringify(artifact)) {
  const ev = embedded?.info?.version ?? '(none)';
  const av = artifact?.info?.version ?? '(none)';
  const ep = Object.keys(embedded?.paths ?? {}).length;
  const ap = Object.keys(artifact?.paths ?? {}).length;

  fail(
    'docs/api/index.html does NOT match docs/api/openapi.v1.json.\n\n' +
      `  page:     version ${ev}, ${ep} paths\n` +
      `  artifact: version ${av}, ${ap} paths\n\n` +
      '  The browsable reference and the frozen contract disagree, which means\n' +
      '  the page is describing an API that does not exist. Do not edit the page\n' +
      `  to fix this — it is generated. Run: ${REBUILD}\n` +
      '  Then commit docs/api/index.html in the SAME pull request.',
  );
  process.exit();
}

// Provenance: the page records the hash of the artifact it was built from. A
// mismatch here means the page was edited by hand even though its content
// still happens to agree — worth failing, because the next edit may not.
const recorded = pageRaw.match(/name="openapi-artifact-sha256" content="([0-9a-f]{64})"/);
const actual = createHash('sha256').update(artifactRaw, 'utf8').digest('hex');

if (recorded === null || recorded[1] !== actual) {
  fail(
    'docs/api/index.html records a different artifact hash than the artifact has.\n' +
      `  recorded: ${recorded === null ? '(absent)' : recorded[1].slice(0, 12)}…\n` +
      `  actual:   ${actual.slice(0, 12)}…\n\n` +
      '  The embedded spec agrees, so this is a formatting or hand-edit\n' +
      `  difference rather than a contract change. Run: ${REBUILD}`,
  );
  process.exit();
}

process.stdout.write(
  'openapi page gate: OK, docs/api/index.html embeds docs/api/openapi.v1.json ' +
    `(${Object.keys(artifact.paths ?? {}).length} paths, sha256 ${actual.slice(0, 12)}…)\n`,
);
