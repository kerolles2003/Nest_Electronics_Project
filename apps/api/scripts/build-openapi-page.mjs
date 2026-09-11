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
 *
 * The SAME reasoning applies to `info.title` and `info.version`, which come out
 * of the same document and go into markup rather than into a script block. They
 * are escaped through `escapeHtml` below. An earlier version interpolated them
 * raw, which meant a title containing `<` — legal in OpenAPI, and the sibling
 * `info.description` already carries markdown — broke out of `<title>` in a
 * committed file the README tells a mobile developer to open.
 *
 * ## Why Swagger UI is VENDORED and not loaded from a CDN
 *
 * `swagger-ui-bundle.js` and `swagger-ui.css` are committed next to this page.
 * They used to be `<script src>`/`<link href>` at jsDelivr, pinned by version
 * and marked `crossorigin="anonymous"` — which without an `integrity` hash does
 * nothing at all, because a version tag on a CDN is a mutable pointer to bytes
 * rather than the bytes themselves. Anything that can answer for that host can
 * change what this page executes, and the page executes it with the contract in
 * hand.
 *
 * Vendoring closes that and also finishes the job the page was built for: the
 * old offline path rendered a banner apologising that Swagger UI could not be
 * reached, which is a page that does not work offline. Classic `<script src>`
 * and `<link href>` both load from `file://` — unlike the `fetch` this page
 * already works around — so the whole thing now works from disk with no
 * network. `SWAGGER_UI_VERSION` stays as the record of which release these
 * bytes are; bumping it means re-downloading both files in the same commit.
 *
 * ## Why this page is COMMITTED at all, given it duplicates the artifact
 *
 * Publishing `docs/` through GitHub Pages would serve the page over http, where
 * `SwaggerUIBundle({ url: './openapi.v1.json' })` just works — no second copy,
 * no escaping, no drift gate, no ~430KB per contract change. That is a real
 * alternative and it was weighed. It is not taken because it trades away the
 * property this page exists for: reading the contract with no server, no
 * network, and no repository settings, which is the first thing README.md asks
 * a mobile developer to do. The duplicate is the price, and
 * `check-openapi-page.mjs` is what keeps the price honest.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const DOCS = resolve(HERE, '../../../docs/api');
const ARTIFACT = resolve(DOCS, 'openapi.v1.json');
const OUTPUT = resolve(DOCS, 'index.html');

/**
 * The Swagger UI release these vendored bytes came from.
 *
 * Pinned, deliberately: `latest` would mean the page a developer opens on
 * Tuesday is not the page that was reviewed on Monday, and a Swagger UI
 * regression would arrive unannounced in a document this team treats as frozen.
 *
 * Bumping it is a commit, and the commit must re-download BOTH files:
 *
 *   curl -sSL -o docs/api/swagger-ui-bundle.js \
 *     https://cdn.jsdelivr.net/npm/swagger-ui-dist@<version>/swagger-ui-bundle.js
 *   curl -sSL -o docs/api/swagger-ui.css \
 *     https://cdn.jsdelivr.net/npm/swagger-ui-dist@<version>/swagger-ui.css
 *
 * Then `pnpm secrets:scan-file` each one before `git add` — they are bytes from
 * outside this repository, and a false positive discovered after the commit
 * costs an allowlist entry.
 */
const SWAGGER_UI_VERSION = '5.17.14';

const ASSETS = [
  ['swagger-ui-bundle.js', resolve(DOCS, 'swagger-ui-bundle.js')],
  ['swagger-ui.css', resolve(DOCS, 'swagger-ui.css')],
];

const sha256Of = (text) => createHash('sha256').update(text, 'utf8').digest('hex');

/**
 * For values that land in MARKUP rather than in the JSON script block.
 *
 * `info.title` and `info.version` are attacker-adjacent in the same sense the
 * spec body is: they come out of a document this script does not author. See
 * the header comment.
 */
const escapeHtml = (value) =>
  String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

const raw = readFileSync(ARTIFACT, 'utf8');

// Parsed once here purely to fail loudly on a corrupt artifact rather than
// emitting a page that renders nothing.
const document = JSON.parse(raw);

// The vendored assets are read, not just referenced: a page pointing at a file
// that is not there renders nothing, and it should fail here rather than in a
// browser. Their hashes go into the page so `check-openapi-page.mjs` can tell
// a missing or edited asset from an intact one.
const assetHashes = ASSETS.map(([name, path]) => {
  let text;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    process.stderr.write(
      `openapi page: docs/api/${name} is missing.\n` +
        '  Swagger UI is vendored, not fetched from a CDN — see the header comment\n' +
        '  in this file for the two curl commands that restore it.\n',
    );
    process.exit(1);
  }
  return [name, sha256Of(text)];
});

const title = document?.info?.title ?? 'API';
const rawVersion = String(document?.info?.version ?? '1');
// `setVersion("1")` makes info.version the bare string "1", so an unprefixed
// title reads "Nest Electronics API 1", which looks like a truncation next to
// `/api/v1`, `openapi.v1.json` and every other surface. Prefix it for display
// only — the frozen artifact is not this script's to edit.
const version = /^\d/.test(rawVersion) ? `v${rawVersion}` : rawVersion;
const sha256 = sha256Of(raw);
const embedded = raw.replaceAll('<', '\\u003c');

const assetMeta = assetHashes
  .map(([name, hash]) => `<meta name="vendored-asset-sha256" content="${name} ${hash}">`)
  .join('\n');

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)} ${escapeHtml(version)} — API reference</title>
<!--
  GENERATED FILE — DO NOT EDIT.

  Source:    docs/api/openapi.v1.json
  Generator: apps/api/scripts/build-openapi-page.mjs
  Rebuild:   pnpm --filter api openapi:export
  Verify:    pnpm --filter api openapi:page:check

  The spec below is embedded so this file works when opened directly from
  disk. CI fails if it disagrees with docs/api/openapi.v1.json.

  Swagger UI is vendored alongside this file rather than loaded from a CDN,
  so the whole page works with no server and no network.
-->
<meta name="openapi-artifact-sha256" content="${sha256}">
<meta name="swagger-ui-version" content="${SWAGGER_UI_VERSION}">
${assetMeta}
<link rel="stylesheet" href="./swagger-ui.css">
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
  <code>swagger-ui-bundle.js</code> did not load, so this page cannot render. It
  sits next to this file — if you copied <code>index.html</code> somewhere on its
  own, copy its two siblings too. The API contract itself is embedded in this
  file and is readable without them: open
  <code>docs/api/openapi.v1.json</code>.
</p>
<div id="swagger-ui"></div>
<script type="application/json" id="openapi-spec">${embedded}</script>
<script src="./swagger-ui-bundle.js"></script>
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
    `(${title} ${version}, spec sha256 ${sha256.slice(0, 12)}…, ` +
    `swagger-ui ${SWAGGER_UI_VERSION} vendored: ${assetHashes.map(([n]) => n).join(', ')})\n`,
);
