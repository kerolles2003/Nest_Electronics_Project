/**
 * THE host, and everything derived from it.
 *
 * `next dev` refuses cross-origin requests for `/_next/*` dev assets, and it
 * treats `127.0.0.1` and `localhost` as different origins. So three things have
 * to name the same host or the browser gets no client chunks and React never
 * boots:
 *
 *   1. the origin the tests drive        -> `baseURL`
 *   2. the host the dev server binds to  -> `next dev --hostname`
 *   3. the origin the dev server trusts  -> `allowedDevOrigins` in next.config
 *
 * They used to be written out separately, two of them in another file, and they
 * drifted — which cost every browser test in the suite its client-side
 * behaviour for months without a single failure.
 *
 * This module is that one source. `playwright.config.ts` reads it, passes it to
 * both servers, and `e2e/global-setup.ts` reads it to probe the API before the
 * run starts. The hydration canary in `fixtures/browser-health.ts` fails every
 * spec immediately if they ever disagree again.
 */

export const HOST = process.env['E2E_HOST'] ?? '127.0.0.1';

/**
 * A dedicated port, not 3000.
 *
 * A developer very often already has `next dev` on 3000. Next.js does not fail
 * in that case — it quietly starts on the next free port — so the suite would
 * sit waiting for a server that came up somewhere else and then time out with
 * a message about the web server rather than about the port. Overridable, so
 * CI or a second checkout can move it.
 */
export const PORT = process.env['E2E_PORT'] ?? '3100';

export const BASE_URL = `http://${HOST}:${PORT}`;

/** The API's port. Its own default; the suite does not move it. */
export const API_PORT = '3002';

export const API_BASE_URL = `http://${HOST}:${API_PORT}/api/v1`;
