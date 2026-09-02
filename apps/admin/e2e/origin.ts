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
 * This is not a hypothetical. In the storefront those three were written out
 * separately, two of them in another file, and they drifted — which cost **44
 * browser tests their client-side behaviour for five phases** without a single
 * failure. Pages server-render and forms submit by progressive enhancement, so
 * everything looked green while no `useEffect` in the application had ever run.
 *
 * The admin is a SECOND Next application with its own dev server, its own
 * config and its own suite. It would have made the same mistake independently,
 * in a place nobody is watching, so it gets the same single source.
 *
 * The pin is cheap insurance, not the guarantee. On Next 16.2.4 a deliberate
 * mismatch between these three did NOT reproduce a refusal — see
 * `hydration-canary.spec.ts` for what was measured — so the thing that actually
 * protects this suite is the canary in `fixtures/browser-health.ts`, which
 * asserts React mounted before every spec's body runs regardless of WHY it
 * might not have. This module keeps the three from drifting anyway, because a
 * future Next release can tighten the rule again and the cost of the pin is one
 * constant.
 */

export const HOST = process.env['E2E_HOST'] ?? '127.0.0.1';

/**
 * A dedicated port, not 3000 and not the storefront's 3100.
 *
 * `next dev` does not fail when a port is taken — it quietly starts on the next
 * free one — so a collision shows up as the suite waiting for a server that
 * came up somewhere else and then timing out with a message about the web
 * server rather than about the port. Overridable, so CI or a second checkout
 * can move it, and distinct from the storefront's so both suites can run at
 * once.
 */
export const PORT = process.env['E2E_PORT'] ?? '3200';

export const BASE_URL = `http://${HOST}:${PORT}`;

/**
 * `basePath` from `next.config.ts`. Every route in this application, and every
 * dev asset, is served beneath it.
 *
 * Declared here rather than assumed at each call site because Playwright's
 * `baseURL` cannot carry it: `page.goto('/login')` against a base URL of
 * `http://host:port/admin` resolves to `http://host:port/login`, since an
 * absolute path replaces the whole path component. So the base URL is the
 * ORIGIN and `route()` below adds the prefix.
 */
export const BASE_PATH = '/admin';

/** A path inside the admin app. `route('/orders')` -> `/admin/orders`. */
export function route(path: string): string {
  return `${BASE_PATH}${path.startsWith('/') ? path : `/${path}`}`;
}

/** The API's port. Its own default; neither suite moves it. */
export const API_PORT = '3002';

export const API_BASE_URL = `http://${HOST}:${API_PORT}/api/v1`;
