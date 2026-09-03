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

/**
 * A SECOND admin dev server, pointed at an API that is not there.
 *
 * ## Why a whole extra server exists
 *
 * `readIdentity()` has a branch for "the API could not be asked", which is
 * different from "you are not signed in" — one renders the shell with the
 * identity stated as unavailable, the other redirects to the sign-in page. The
 * distinction is load-bearing: collapsing it signs an operator out whenever the
 * API hiccups.
 *
 * That branch is unreachable from a normal test. `GET /auth/me` is called
 * SERVER-side by the Next process, so `page.route()` cannot intercept it, and
 * stopping the real API would break every other spec in the run.
 *
 * So this server is the same application with `API_BASE_URL` pointed at port 9
 * — the discard port, which refuses connections immediately. Cookies are scoped
 * by HOST and not by port, so a spec signs in against the healthy server and
 * then navigates here carrying the same session: a valid session, an
 * unreachable API, which is exactly the state under test.
 *
 * Used by ONE spec (`admin-identity.spec.ts`). It costs a second `next dev`
 * compile; the alternative was asserting the guarantee by reading the source,
 * which is not a test.
 */
export const DEAD_API_PORT = process.env['E2E_DEAD_API_PORT'] ?? '3201';

export const DEAD_API_BASE_URL = `http://${HOST}:${DEAD_API_PORT}`;

/**
 * Port 9 is DISCARD (RFC 863). Nothing listens, and a connection to it is
 * refused at once rather than hanging — so the identity fetch fails fast and
 * the page renders, which is the behaviour being asserted.
 */
export const UNREACHABLE_API_BASE_URL = `http://${HOST}:9/api/v1`;

/**
 * THE database this suite owns, and the only one it may touch.
 *
 * ## Written from the damage this suite did
 *
 * These specs place a real order each, through the real checkout, which really
 * does decrement stock. For several runs there was no teardown at all, and they
 * left the SHARED development database holding 62 accounts, 35 orders and four
 * products at zero stock out of thirty-four. The failure surfaced in the
 * STOREFRONT suite — a stock filter and a purchase journey with nothing to do
 * with the admin — while this suite stayed green.
 *
 * A teardown was added and fixed that instance. It did not fix the class: a
 * teardown only runs when the process survives to run it, and a killed run, a
 * dead database container or a crashed editor all skip it. With a database of
 * its own, a crashed run can damage only this, and the next run drops it.
 *
 * ## Why the name is written out rather than imported
 *
 * `apps/api/src/database/testing/scratch-databases.ts` is the authority and it
 * lives in another workspace; importing it would pull NestJS and Mongoose types
 * into this application's type-check to obtain one string. The API refuses to
 * drop any database not in its own list, so a drifted value fails the next run
 * by name, and `apps/api/test/database/scratch-databases.spec.ts` reads THIS
 * file and asserts the two agree.
 */
export const SCRATCH_DATABASE = 'nest_electronics_scratch_admin';

/** The suite's name to `pnpm --filter api test-db`. Paired with the above. */
export const SCRATCH_SUITE = 'admin-e2e';
