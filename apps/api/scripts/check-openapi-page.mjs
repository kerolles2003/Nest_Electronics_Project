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
 * It also compares the VENDORED Swagger UI. The page loads `swagger-ui-bundle.js`
 * and `swagger-ui.css` from beside itself rather than from a CDN, which makes
 * those two files part of the deliverable: a missing one opens a blank page, and
 * an altered one is unreviewed code running with the contract in hand. Neither
 * is visible to the spec comparison, so the generator records their hashes and
 * this checks them.
 *
 * It deliberately does NOT boot the API. This gate is cheap, needs no database,
 * and answers a different question from `openapi:check`: that one asks whether
 * the artifact still matches the code, this one asks whether the page still
 * matches the artifact. Running it first means the cheap failure reports first.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const DOCS = resolve(HERE, '../../../docs/api');
const ARTIFACT = resolve(DOCS, 'openapi.v1.json');
const PAGE = resolve(DOCS, 'index.html');

const REBUILD = 'pnpm --filter api openapi:export';

function fail(message) {
  process.stderr.write(`openapi page gate: ${message}\n`);
  process.exitCode = 1;
}

/**
 * Everything runs inside a function so a failure can `return`.
 *
 * `fail()` already sets `process.exitCode`, so there is nothing an explicit
 * `process.exit()` adds — and on Windows, which is where this repository is
 * developed and where somebody runs this before pushing, `process.stderr` is
 * ASYNCHRONOUS for pipes. Exiting in the same tick as the write truncates or
 * drops the message. Those messages are the entire value of this gate over a
 * plain diff: they say what drifted and which one command rebuilds it.
 */
function main() {
  let artifactRaw;
  try {
    artifactRaw = readFileSync(ARTIFACT, 'utf8');
  } catch {
    fail(`no artifact at docs/api/openapi.v1.json\n  Generate it with: ${REBUILD}`);
    return;
  }

  let pageRaw;
  try {
    pageRaw = readFileSync(PAGE, 'utf8');
  } catch {
    fail(
      'docs/api/index.html is missing.\n' +
        `  It is generated, not written by hand. Run: ${REBUILD}`,
    );
    return;
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
    return;
  }

  let embedded;
  try {
    embedded = JSON.parse(match[1]);
  } catch (error) {
    fail(
      `the embedded spec in docs/api/index.html is not valid JSON: ${String(error)}\n` +
        `  Run: ${REBUILD}`,
    );
    return;
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
    return;
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
    return;
  }

  // The vendored Swagger UI, held to the same rule as the spec.
  //
  // The page loads `./swagger-ui-bundle.js` and `./swagger-ui.css` from beside
  // itself rather than from a CDN, so those two files are now part of the
  // deliverable: if either is missing or altered, the page renders nothing or
  // renders through code nobody reviewed, and the embedded-spec check above
  // cannot see either case. The generator records their hashes; this compares.
  const declared = [...pageRaw.matchAll(/name="vendored-asset-sha256" content="([^" ]+) ([0-9a-f]{64})"/g)];

  if (declared.length === 0) {
    fail(
      'docs/api/index.html declares no vendored asset hashes.\n' +
        '  Swagger UI is vendored next to the page, not loaded from a CDN, and the\n' +
        `  page must record what it was built against. Run: ${REBUILD}`,
    );
    return;
  }

  for (const [, name, expected] of declared) {
    let assetRaw;
    try {
      assetRaw = readFileSync(resolve(DOCS, name), 'utf8');
    } catch {
      fail(
        `docs/api/${name} is missing, but docs/api/index.html loads it.\n` +
          '  Swagger UI is vendored, not fetched — without this file the page opens\n' +
          '  blank. The two curl commands that restore it are in the header comment\n' +
          '  of apps/api/scripts/build-openapi-page.mjs.',
      );
      return;
    }

    const got = createHash('sha256').update(assetRaw, 'utf8').digest('hex');

    if (got !== expected) {
      fail(
        `docs/api/${name} is not the file docs/api/index.html was built against.\n` +
          `  recorded: ${expected.slice(0, 12)}…\n` +
          `  actual:   ${got.slice(0, 12)}…\n\n` +
          '  This page executes that file with the contract in hand, so a version\n' +
          '  it does not recognise is not something to wave through. If the bump is\n' +
          `  intended, change SWAGGER_UI_VERSION and run: ${REBUILD}`,
      );
      return;
    }
  }

  process.stdout.write(
    'openapi page gate: OK, docs/api/index.html embeds docs/api/openapi.v1.json ' +
      `(${Object.keys(artifact.paths ?? {}).length} paths, sha256 ${actual.slice(0, 12)}…, ` +
      `${declared.length} vendored assets verified)\n`,
  );
}

main();
