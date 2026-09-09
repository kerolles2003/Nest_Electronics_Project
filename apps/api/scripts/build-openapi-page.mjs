#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Renders `docs/api/index.html` from `docs/api/openapi.v1.json`.
 *
 * Authority: PLAN.md Phase 3; docs/architecture/API-CONTRACT.md §8.
 *
 * ## Why the spec is EMBEDDED and not fetched
 *
 * The mobile developer should be able to read the contract before running
 * anything — open the file, get Swagger UI. A page that does
 * `SwaggerUIBundle({ url: './openapi.v1.json' })` cannot do that: over
 * `file://` the browser treats the sibling file as a cross-origin request and
 * blocks it, so the page renders an error and nothing else. It would need a
 * web server to read at all, which is the exact requirement this page exists
 * to remove.
 *
 * So the document is inlined into a `<script type="application/json">` block
 * and handed to Swagger UI as a `spec`, not a `url`. No fetch, no server.
 *
 * ## Why it is GENERATED and never edited
 *
 * This page contains a second copy of the contract, and a second copy is a
 * thing that can disagree with the first. That is the failure this repository
 * spends a whole CI job preventing for the artifact itself, so the copy gets
 * the same treatment: it is generated from the artifact, and
 * `check-openapi-page.mjs` fails the build if the two ever differ.
 *
 * Do not hand-edit `docs/api/index.html`. Run `pnpm --filter api openapi:export`.
 *
 * ## Why `<` is escaped
 *
 * A JSON document can only contain `<` inside a string literal, so replacing
 * every `<` with its `<` escape yields a document that parses to an
 * IDENTICAL object and cannot terminate the surrounding `</script>` tag. The
 * checker compares parsed objects, so this transformation is invisible to it.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const ARTIFACT = resolve(HERE, '../../../docs/api/openapi.v1.json');
const OUTPUT = resolve(HERE, '../../../docs/api/index.html');

/**
 * Pinned, deliberately.
 *
 * `latest` would mean the page a developer opens on Tuesday is not the page
 * that was reviewed on Monday, and a Swagger UI regression would arrive
 * unannounced in a document this team treats as frozen. Bumping it is a commit.
 */
const SWAGGER_UI_VERSION = '5.17.14';
const CDN = `https://cdn.jsdelivr.net/npm/swagger-ui-dist@${SWAGGER_UI_VERSION}`;

const raw = readFileSync(ARTIFACT, 'utf8');

// Parsed once here purely to fail loudly on a corrupt artifact rather than
// emitting a page that renders nothing.
const document = JSON.parse(raw);

const title = document?.info?.title ?? 'API';
const version = document?.info?.version ?? 'v1';
const sha256 = createHash('sha256').update(raw, 'utf8').digest('hex');
const embedded = raw.replaceAll('<', '\\u003c');

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title} ${version} — API reference</title>
<!--
  GENERATED FILE — DO NOT EDIT.

  Source:    docs/api/openapi.v1.json
  Generator: apps/api/scripts/build-openapi-page.mjs
  Rebuild:   pnpm --filter api openapi:export
  Verify:    pnpm --filter api openapi:page:check

  The spec below is embedded so this file works when opened directly from
  disk. CI fails if it disagrees with docs/api/openapi.v1.json.
-->
<meta name="openapi-artifact-sha256" content="${sha256}">
<meta name="swagger-ui-version" content="${SWAGGER_UI_VERSION}">
<link rel="stylesheet" href="${CDN}/swagger-ui.css">
<style>
  body { margin: 0; background: #fafafa; }
  .nest-offline-note {
    display: none;
    margin: 0;
    padding: 12px 16px;
    font: 14px/1.5 system-ui, -apple-system, Segoe UI, sans-serif;
    background: #fff4e5;
    border-bottom: 1px solid #ffd8a8;
    color: #7a4100;
  }
  .nest-offline-note code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
</style>
</head>
<body>
<p class="nest-offline-note" id="offline-note">
  Swagger UI's own assets could not be loaded from the CDN, so this page cannot
  render. The API contract itself is embedded in this file and is readable
  without it: open <code>docs/api/openapi.v1.json</code>.
</p>
<div id="swagger-ui"></div>
<script type="application/json" id="openapi-spec">${embedded}</script>
<script src="${CDN}/swagger-ui-bundle.js" crossorigin="anonymous"></script>
<script>
  (function () {
    if (typeof SwaggerUIBundle !== 'function') {
      document.getElementById('offline-note').style.display = 'block';
      return;
    }

    SwaggerUIBundle({
      // A spec, not a url: see the header comment. Fetching a sibling file
      // over file:// is blocked, which would make this page useless offline.
      spec: JSON.parse(document.getElementById('openapi-spec').textContent),
      dom_id: '#swagger-ui',
      deepLinking: true,
      docExpansion: 'none',
      defaultModelsExpandDepth: 1,
      tryItOutEnabled: false,
      presets: [SwaggerUIBundle.presets.apis],
    });
  })();
</script>
</body>
</html>
`;

writeFileSync(OUTPUT, html, 'utf8');

process.stdout.write(
  `openapi page: wrote docs/api/index.html ` +
    `(${title} ${version}, spec sha256 ${sha256.slice(0, 12)}…, swagger-ui ${SWAGGER_UI_VERSION})\n`,
);
